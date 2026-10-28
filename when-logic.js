// When Works? — the logic, with no DOM, so node can test it (site/when-logic.test.mjs).
// Every time-zone answer comes from the browser's own Intl rules; test/facts.py computes the
// same days with Python's zoneinfo, a different implementation of the same IANA database.

// ---- the hours of a day --------------------------------------------------------------

export const HOUR = 3600000, MIN = 60000, DAY = 86400000;
export const WORK = [9 * 60, 17 * 60];   // 9 am to 5 pm on a working day
export const AWAKE = [7 * 60, 23 * 60];  // 7 am to 11 pm

const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// The wall clock in a zone at an instant: { ymd: "2026-10-27", min: minutes since local midnight, wd: 0..6 }.
export function wall(tz, ms) {
  const p = {};
  for (const { type, value } of fmt(tz).formatToParts(new Date(ms))) p[type] = value;
  return { ymd: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), wd: WD[p.weekday] };
}

// Minutes east of UTC in a zone at an instant, from Intl ("GMT+5:45", "GMT-07:00", "GMT").
// Copied from projects/how-far/site/far-logic.js.
export function offsetMin(tz, ms) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName').value;
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}

const utcOf = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };

// The first minute of a local day. Searched rather than computed, because a day can start
// at 1 am when the clocks jump forward at midnight (as Havana's and Santiago's do). No zone is
// more than 14 h from UTC, so the answer lies within 15 h of the UTC midnight.
export function dayStart(tz, ymd) {
  let lo = utcOf(ymd) - 15 * HOUR, hi = utcOf(ymd) + 15 * HOUR; // wall(lo) is the day before, wall(hi) is this day
  while (hi - lo > MIN) {
    const mid = lo + Math.floor((hi - lo) / 2 / MIN) * MIN;
    if (wall(tz, mid).ymd < ymd) lo = mid; else hi = mid;
  }
  return hi;
}

// One row per real hour of the home town's day: 24 rows, or 23 and 25 on the days its
// clocks change. A row is the instant it starts.
export function dayRows(tz, ymd) {
  const rows = [];
  for (let ms = dayStart(tz, ymd); wall(tz, ms).ymd === ymd; ms += HOUR) rows.push(ms);
  return rows;
}

// Is a weekday (0 = Sunday) in a weekend [first, last]? The pair can wrap (Thu-Fri does not,
// Sat-Sun does not, Sun-Sun is one day).
export function inWeekend(wd, [first, last]) {
  return first <= last ? wd >= first && wd <= last : wd >= first || wd <= last;
}
export const WORLD_WEEKEND = [6, 0];
export const weekendOf = (cc, table) => (table && table[cc]) || WORLD_WEEKEND;

// A town's public holidays, from data/holidays.json: { off: { ymd: name }, work: [ymd] }, where
// `work` is the weekend days its country makes into working days (China moves several a year).
// `off` is the country's nationwide holidays plus, given the town's admin1, the ones held only
// in its state or province (table.a1 names the subdivision, table.reg holds its days), each
// named with the admin1 so a card can say "Victoria Day (Ontario)". A nationwide holiday on the
// same date keeps its own name. No table (still loading, or a country without one) means no
// holidays; an admin1 the table does not know means nationwide holidays only.
export function holidaysOf(cc, table, a1) {
  const nat = (table && table.off && table.off[cc]) || {};
  const work = (table && table.work && table.work[cc]) || [];
  const code = a1 && table && table.a1 && table.a1[cc] && table.a1[cc][a1];
  const reg = code && table.reg && table.reg[cc] && table.reg[cc][code];
  if (!reg) return { off: nat, work };
  const off = { ...nat };
  for (const [ymd, name] of Object.entries(reg)) if (!off[ymd]) off[ymd] = `${name} (${a1})`;
  return { off, work };
}

// Is a town's local day a day off? A public holiday is; a weekend day is, unless it was made a working day.
export function dayOff(w, weekend, hol) {
  if (hol && hol.off[w.ymd]) return true;
  return inWeekend(w.wd, weekend) && !(hol && hol.work.includes(w.ymd));
}

// 'work' (a working day, 9 to 5), 'awake' (7 am to 11 pm otherwise) or 'sleep'.
export function classify(w, weekend, hol) {
  if (w.min < AWAKE[0] || w.min >= AWAKE[1]) return 'sleep';
  if (!dayOff(w, weekend, hol) && w.min >= WORK[0] && w.min < WORK[1]) return 'work';
  return 'awake';
}

// The grid: for each row, each town's wall clock and class. towns: [{ tz, weekend, hol? }].
export function grid(towns, ymd) {
  const home = towns[0];
  return dayRows(home.tz, ymd).map((ms) => ({
    ms,
    cells: towns.map((t) => { const w = wall(t.tz, ms); return { ...w, cls: classify(w, t.weekend, t.hol) }; }),
  }));
}

// What the grid's working hours fall on: every town's local day whose 9-to-5 the grid shows
// (one or two per town, since a far town's day straddles the home day) that is a public holiday
// or a weekend day made a working day. [{ k, ymd, kind: 'off' | 'work', name }], in town order.
// `unknown` lists the years the grid touches that the table does not cover, so a page can say
// "holidays not known" rather than imply there are none.
export function holidayNotes(towns, g, years) {
  const notes = [], seen = new Set(), unknown = new Set();
  g.forEach((r) => r.cells.forEach((c, k) => {
    if (c.min < WORK[0] || c.min >= WORK[1]) return;
    const key = `${k} ${c.ymd}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (years && !years.includes(Number(c.ymd.slice(0, 4)))) { unknown.add(Number(c.ymd.slice(0, 4))); return; }
    const hol = towns[k].hol;
    if (!hol) return;
    if (hol.off[c.ymd]) notes.push({ k, ymd: c.ymd, kind: 'off', name: hol.off[c.ymd] });
    else if (inWeekend(c.wd, towns[k].weekend) && hol.work.includes(c.ymd)) notes.push({ k, ymd: c.ymd, kind: 'work', name: null });
  }));
  return { notes, unknown: [...unknown].sort() };
}

// Runs of consecutive row indices where pred holds: [[first, last], ...].
function runs(n, pred) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!pred(i)) continue;
    if (out.length && out[out.length - 1][1] === i - 1) out[out.length - 1][1] = i; else out.push([i, i]);
  }
  return out;
}

// The best hours: everyone at work if any such hour exists, else everyone awake, else the
// hours that wake the fewest. { kind: 'work' | 'awake' | 'fewest', runs, asleep }.
export function best(g) {
  const n = g.length;
  const work = runs(n, (i) => g[i].cells.every((c) => c.cls === 'work'));
  if (work.length) return { kind: 'work', runs: work, asleep: 0 };
  const awake = runs(n, (i) => g[i].cells.every((c) => c.cls !== 'sleep'));
  if (awake.length) return { kind: 'awake', runs: awake, asleep: 0 };
  const count = g.map((r) => r.cells.filter((c) => c.cls === 'sleep').length);
  const low = Math.min(...count);
  return { kind: 'fewest', runs: runs(n, (i) => count[i] === low), asleep: low };
}

// ---- clock changes -------------------------------------------------------------------

// Every instant in [from, to) where a zone's offset changes: [{ ms, before, after }].
// Sampled every 6 hours (no zone changes twice in that time), then halved to the minute.
export function transitions(tz, from, to) {
  const out = [];
  let prev = offsetMin(tz, from);
  for (let t = from + 6 * HOUR; t < to + 6 * HOUR; t += 6 * HOUR) {
    const o = offsetMin(tz, t);
    if (o === prev) continue;
    let lo = t - 6 * HOUR, hi = t;
    while (hi - lo > MIN) {
      const mid = lo + Math.floor((hi - lo) / 2 / MIN) * MIN;
      if (offsetMin(tz, mid) === prev) lo = mid; else hi = mid;
    }
    if (hi < to) out.push({ ms: hi, before: prev, after: o });
    prev = o;
  }
  return out;
}

// The clock changes in the next `days` after a day starts, and what each does to the gap
// between the home town and the others. towns[0] is home. [{ ms, tz, by, gaps: [{ i, before, after }] }],
// where gaps lists every other town whose difference from home changes at that instant.
export function changes(towns, ymd, days = 28) {
  const from = dayStart(towns[0].tz, ymd), to = from + days * DAY;
  const zones = [...new Set(towns.map((t) => t.tz))];
  const ev = zones.flatMap((tz) => transitions(tz, from, to).map((e) => ({ ...e, tz })));
  ev.sort((a, b) => a.ms - b.ms || (a.tz < b.tz ? -1 : 1));
  const home = towns[0].tz;
  return ev.map((e) => {
    const gaps = [];
    towns.forEach((t, i) => {
      if (!i || t.tz === home) return;
      const before = offsetMin(t.tz, e.ms - MIN) - offsetMin(home, e.ms - MIN);
      const after = offsetMin(t.tz, e.ms) - offsetMin(home, e.ms);
      if (before !== after) gaps.push({ i, before, after });
    });
    return { ms: e.ms, tz: e.tz, by: e.after - e.before, gaps };
  }).filter((e) => e.gaps.length || e.tz === home);
}

// ---- words ---------------------------------------------------------------------------

// 540 -> "9 am", 765 -> "12:45 pm", 0 -> "12 am".
export function time(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

// 420 -> "7 h", 330 -> "5 h 30 min", 45 -> "45 min".
export function hm(min) {
  const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

// "8 h ahead of", "3 h 30 min behind", "the same time as".
export function gapWords(min) {
  return min ? `${hm(min)} ${min > 0 ? 'ahead of' : 'behind'}` : 'on the same time as';
}

// How a cell's day compares with the home row's: "" on the same day, else "Tue" etc.
const DAYNAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayName = (wd) => DAYNAME[wd];
export function dayMark(cell, homeCell) {
  return cell.ymd === homeCell.ymd ? '' : DAYNAME[cell.wd];
}

// "Sun 1 Nov" for a ymd.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateWords(ymd) {
  const d = new Date(utcOf(ymd));
  return `${DAYNAME[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

export function addDays(ymd, n) {
  return new Date(utcOf(ymd) + n * DAY).toISOString().slice(0, 10);
}

// ---- places: [name, admin1, country, cc, pop, tzIndex], most populous first ------------
// Matching copied from projects/how-far/site/far-logic.js, which reads the same GeoNames file.

export const P = { NAME: 0, A1: 1, CN: 2, CC: 3, POP: 4, TZ: 5 };

const LETTERS = { 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ħ': 'h' };
export function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[øæœßłđðþıħ]/g, (c) => LETTERS[c]).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function placeLabel(p) {
  const parts = [p[P.NAME]];
  if (p[P.A1] && p[P.A1] !== p[P.NAME]) parts.push(p[P.A1]);
  parts.push(p[P.CN]);
  return parts.join(', ');
}
export const short = (label) => String(label).split(',')[0];

export function matchPlaces(places, q, limit = 8) {
  const [head, ...rest] = String(q).split(',').map(fold);
  if (!head) return [];
  const exact = [], prefix = [];
  for (const p of places) {
    const n = fold(p[P.NAME]);
    if (!n.startsWith(head)) continue;
    if (rest.some((r) => r && !(fold(p[P.A1]).startsWith(r) || fold(p[P.CN]).startsWith(r)))) continue;
    (n === head ? exact : prefix).push(p);
    if (exact.length >= limit) break;
  }
  return exact.concat(prefix).slice(0, limit);
}

export function placeByLabel(places, label) {
  const f = fold(label);
  return places.find((p) => fold(placeLabel(p)) === f) || null;
}

export function biggestIn(places, zones, tz) {
  const i = zones.indexOf(tz);
  return i < 0 ? null : places.find((p) => p[P.TZ] === i) || null;
}

export const toTown = (p, zones, weekend, holidays) => ({
  label: placeLabel(p), cc: p[P.CC], tz: zones[p[P.TZ]], weekend: weekendOf(p[P.CC], weekend),
  hol: holidaysOf(p[P.CC], holidays, p[P.A1]),
});

// ---- the URL: ?t=Palo Alto, California, United States&t=London, …&d=2026-10-27 ----------

export const MAX_TOWNS = 6;
export function encodeState({ towns, ymd }) {
  const q = new URLSearchParams();
  for (const t of towns) q.append('t', t);
  if (ymd) q.set('d', ymd);
  const s = q.toString();
  return s ? `?${s}` : '';
}
export function decodeState(search) {
  const q = new URLSearchParams(search || '');
  const towns = q.getAll('t').map((v) => v.slice(0, 120).trim()).filter(Boolean).slice(0, MAX_TOWNS);
  const d = q.get('d');
  // A real day only: 2026-13-99 is a valid Date.UTC, so round-trip it.
  const real = /^\d{4}-\d{2}-\d{2}$/.test(d || '') && new Date(utcOf(d)).toISOString().slice(0, 10) === d;
  return { towns, ymd: real ? d : null };
}

// ---- one hour, carried out: to a calendar, or as text -----------------------------------
// The event is written in UTC ("...Z"), so every calendar shows it in its own zone and no
// VTIMEZONE has to be shipped. The towns' wall clocks go in the description for the humans.

export const LENGTHS = [30, 60, 90];   // minutes a slot can last

// Each town's wall clock over [ms, ms + mins): "London: 4 pm – 5 pm, Wed 28 Oct".
export function slotLines(towns, ms, mins) {
  return towns.map((t) => {
    const a = wall(t.tz, ms), b = wall(t.tz, ms + mins * MIN);
    return `${short(t.label)}: ${time(a.min)} – ${time(b.min)}, ${dateWords(a.ymd)}`;
  });
}

export const slotTitle = (towns) => `Call: ${towns.map((t) => short(t.label)).join(' / ')}`;

// 1793116800000 -> "20261028T160000Z".
export const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

// Google Calendar's prefilled "new event" page.
export function gcalUrl({ title, ms, mins, details }) {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${utcStamp(ms)}/${utcStamp(ms + mins * MIN)}`, details });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// RFC 5545 3.3.11 TEXT: backslash, semicolon, comma and newline are escaped.
export const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 3.1: a line over 75 octets folds with CRLF + space, never inside a UTF-8 character.
export function icsFold(line) {
  const enc = new TextEncoder(), parts = [];
  let cur = '', n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function ics({ title, ms, mins, details, url, stampMs }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//when-works//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${utcStamp(ms)}-${mins}-${title.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}@when-works`,
    `DTSTAMP:${utcStamp(stampMs)}`,
    `DTSTART:${utcStamp(ms)}`,
    `DTEND:${utcStamp(ms + mins * MIN)}`,
    `SUMMARY:${icsText(title)}`,
    `DESCRIPTION:${icsText(details)}`];
  if (url) lines.push(`URL:${url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
