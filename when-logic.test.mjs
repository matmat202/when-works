// node site/when-logic.test.mjs — the logic against test/facts.json (Python zoneinfo) and by hand.
// LOGIC=path/to/mutant.js runs the same suite against a planted copy (test/plant.sh).
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(resolve(process.env.LOGIC || join(here, 'when-logic.js'))).href);
// The suite also runs from the published copy, where facts.json sits in test/ beside it.
const factsPath = [join(here, '..', 'test', 'facts.json'), join(here, 'test', 'facts.json')].find(existsSync);
const F = JSON.parse(readFileSync(factsPath, 'utf8'));

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`FAIL ${name}\n  got  ${g.slice(0, 300)}\n  want ${w.slice(0, 300)}`); }
};

// ---- every case, row by row, against zoneinfo ----------------------------------------
for (const c of F.cases) {
  const name = `${c.ymd} ${c.towns.map((t) => L.short(t.label)).join('/')}`;
  const towns = c.towns.map((t) => ({ tz: t.tz, weekend: t.weekend }));
  const g = L.grid(towns, c.ymd);
  eq(`${name}: row count`, g.length, c.rows.length);
  eq(`${name}: rows`, g.map((r) => [r.ms, r.cells.map((x) => [x.ymd, x.min, x.wd, x.cls])]), c.rows);
  eq(`${name}: best`, L.best(g), c.best);
  eq(`${name}: clock changes`, L.changes(towns, c.ymd), c.changes);
}

// ---- weekends, from the built table ---------------------------------------------------
const built = JSON.parse(readFileSync(join(here, 'data', 'places.json'), 'utf8')).weekend;
for (const c of F.cases) for (const t of c.towns) eq(`weekend of ${t.cc}`, L.weekendOf(t.cc, built), t.weekend);
eq('Sat-Sun', [0, 1, 5, 6].map((d) => L.inWeekend(d, [6, 0])), [true, false, false, true]);
eq('Thu-Fri', [3, 4, 5, 6].map((d) => L.inWeekend(d, [4, 5])), [false, true, true, false]);
eq('Sunday only', [0, 6, 1].map((d) => L.inWeekend(d, [0, 0])), [true, false, false]);

// ---- the edges of a class ------------------------------------------------------------
const wk = [6, 0];
eq('6:59 am asleep, 7 am awake', [L.classify({ min: 419, wd: 2 }, wk), L.classify({ min: 420, wd: 2 }, wk)], ['sleep', 'awake']);
eq('9 am at work, 4:59 pm at work, 5 pm not', [540, 1019, 1020].map((m) => L.classify({ min: m, wd: 2 }, wk)), ['work', 'work', 'awake']);
eq('10:59 pm awake, 11 pm asleep', [1379, 1380].map((m) => L.classify({ min: m, wd: 2 }, wk)), ['awake', 'sleep']);
eq('Saturday at 10 am is not work', L.classify({ min: 600, wd: 6 }, wk), 'awake');

// ---- best: the three kinds, on a made-up grid ----------------------------------------
const mk = (rows) => rows.map((r) => ({ cells: r.map((cls) => ({ cls })) }));
eq('best: work wins over awake', L.best(mk([['awake', 'awake'], ['work', 'work'], ['work', 'work'], ['work', 'awake']])),
  { kind: 'work', runs: [[1, 2]], asleep: 0 });
eq('best: two separate runs', L.best(mk([['work', 'work'], ['sleep', 'work'], ['work', 'work']])),
  { kind: 'work', runs: [[0, 0], [2, 2]], asleep: 0 });
eq('best: fewest asleep', L.best(mk([['sleep', 'sleep', 'work'], ['sleep', 'work', 'work'], ['sleep', 'sleep', 'sleep']])),
  { kind: 'fewest', runs: [[1, 1]], asleep: 1 });

// ---- day starts and lengths ----------------------------------------------------------
eq('Havana 14 Mar 2027 starts at 1 am', L.wall('America/Havana', L.dayStart('America/Havana', '2027-03-14')).min, 60);
eq('Palo Alto 1 Nov 2026 has 25 hours', L.dayRows('America/Los_Angeles', '2026-11-01').length, 25);
eq('Palo Alto 14 Mar 2027 has 23 hours', L.dayRows('America/Los_Angeles', '2027-03-14').length, 23);
eq('Kathmandu 2026-10-30 starts at 18:15 UTC', new Date(L.dayStart('Asia/Kathmandu', '2026-10-30')).toISOString(), '2026-10-29T18:15:00.000Z');
eq('Apia starts its day 13 h before UTC', new Date(L.dayStart('Pacific/Apia', '2026-10-29')).toISOString(), '2026-10-28T11:00:00.000Z');
eq('offset: Kathmandu +5:45, Palo Alto in October -7', [L.offsetMin('Asia/Kathmandu', Date.UTC(2026, 9, 27)), L.offsetMin('America/Los_Angeles', Date.UTC(2026, 9, 27))], [345, -420]);
eq('offset: Kathmandu was +5:30 until 1986', L.offsetMin('Asia/Kathmandu', 0), 330);

// ---- transitions found to the minute -------------------------------------------------
eq('London went back at 01:00 UTC on 25 Oct 2026',
  L.transitions('Europe/London', Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 30)).map((e) => [new Date(e.ms).toISOString(), e.before, e.after]),
  [['2026-10-25T01:00:00.000Z', 60, 0]]);
eq('Tokyo never changes', L.transitions('Asia/Tokyo', Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1)), []);
eq('a change just before the window is not in it',
  L.transitions('Europe/London', Date.UTC(2026, 9, 25, 1, 1), Date.UTC(2026, 9, 30)), []);

eq('a change just after the window is not in it',
  L.transitions('Europe/London', Date.UTC(2026, 9, 24, 20), Date.UTC(2026, 9, 25, 0, 59)), []);
// London and Paris change at the same instant, so the gap holds: home's change is still said, Paris's is not.
eq('home changes, no gap moves', L.changes([{ tz: 'Europe/London' }, { tz: 'Europe/Paris' }], '2026-10-20'),
  [{ ms: Date.UTC(2026, 9, 25, 1), tz: 'Europe/London', by: -60, gaps: [] }]);

// ---- words ---------------------------------------------------------------------------
eq('time', [0, 540, 765, 720, 1425].map(L.time), ['12 am', '9 am', '12:45 pm', '12 pm', '11:45 pm']);
eq('hm', [420, 330, 45, -480].map(L.hm), ['7 h', '5 h 30 min', '45 min', '8 h']);
eq('gapWords', [480, -150, 0].map(L.gapWords), ['8 h ahead of', '2 h 30 min behind', 'on the same time as']);
eq('dateWords', [L.dateWords('2026-11-01'), L.dateWords('2027-03-14')], ['Sun 1 Nov', 'Sun 14 Mar']);
eq('addDays across a month and a year', [L.addDays('2026-10-31', 1), L.addDays('2027-01-01', -1)], ['2026-11-01', '2026-12-31']);
eq('dayMark', [L.dayMark({ ymd: 'a', wd: 3 }, { ymd: 'a' }), L.dayMark({ ymd: 'b', wd: 3 }, { ymd: 'a' })], ['', 'Wed']);

// ---- places and the URL --------------------------------------------------------------
const doc = JSON.parse(readFileSync(join(here, 'data', 'places.json'), 'utf8'));
eq('"palo alto" finds California', L.placeLabel(L.matchPlaces(doc.places, 'palo alto')[0]), 'Palo Alto, California, United States');
eq('"tromso" finds Tromsø', L.short(L.placeLabel(L.matchPlaces(doc.places, 'tromso')[0])), 'Tromsø');
eq('"london, can" finds Ontario', L.placeLabel(L.matchPlaces(doc.places, 'london, can')[0]), 'London, Ontario, Canada');
for (const c of F.cases) for (const t of c.towns) {
  const p = L.placeByLabel(doc.places, t.label);
  eq(`${t.label} is a town with the case's zone`, p && L.toTown(p, doc.zones, doc.weekend), { label: t.label, cc: t.cc, tz: t.tz, weekend: t.weekend });
}
eq('biggest town in Asia/Kolkata', L.placeLabel(L.biggestIn(doc.places, doc.zones, 'Asia/Kolkata')), 'Mumbai, Maharashtra, India');
const s = L.encodeState({ towns: ['Palo Alto, California, United States', 'London, England, United Kingdom'], ymd: '2026-11-02' });
eq('url round trip', L.decodeState(s), { towns: ['Palo Alto, California, United States', 'London, England, United Kingdom'], ymd: '2026-11-02' });
eq('url: a bad date is dropped, towns capped', L.decodeState('?d=2026-13-99&' + 'abcdefgh'.split('').map((x) => `t=${x}`).join('&')),
  { towns: ['a', 'b', 'c', 'd', 'e', 'f'], ymd: null });

// ---- one hour, to a calendar ------------------------------------------------------------
// 27 Oct 2026, 7 am in Palo Alto (PDT, -7) is 14:00 UTC: the shot's Palo Alto/London/New Delhi day.
const tz3 = [{ label: 'Palo Alto, California, United States', tz: 'America/Los_Angeles' },
  { label: 'London, England, United Kingdom', tz: 'Europe/London' }, { label: 'New Delhi, Delhi, India', tz: 'Asia/Kolkata' }];
const at = Date.UTC(2026, 9, 27, 14);
eq('slotLines: each town its own clock', L.slotLines(tz3, at, 60),
  ['Palo Alto: 7 am – 8 am, Tue 27 Oct', 'London: 2 pm – 3 pm, Tue 27 Oct', 'New Delhi: 7:30 pm – 8:30 pm, Tue 27 Oct']);
eq('slotLines: 90 min, and a town already on the next day', L.slotLines([tz3[0], { label: 'Tokyo, Japan', tz: 'Asia/Tokyo' }], Date.UTC(2026, 9, 28, 0), 90),
  ['Palo Alto: 5 pm – 6:30 pm, Tue 27 Oct', 'Tokyo: 9 am – 10:30 am, Wed 28 Oct']);
eq('slotTitle', L.slotTitle(tz3), 'Call: Palo Alto / London / New Delhi');
eq('utcStamp', L.utcStamp(at), '20261027T140000Z');
const gq = new URL(L.gcalUrl({ title: 'Call: A & B', ms: at, mins: 30, details: 'x\ny' }));
eq('gcal: host, action, dates, text', [gq.origin + gq.pathname, gq.searchParams.get('action'), gq.searchParams.get('dates'), gq.searchParams.get('text'), gq.searchParams.get('details')],
  ['https://calendar.google.com/calendar/render', 'TEMPLATE', '20261027T140000Z/20261027T143000Z', 'Call: A & B', 'x\ny']);
eq('icsText escapes \\ ; , and newlines', L.icsText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
const long = 'DESCRIPTION:' + 'Tromsø, '.repeat(20);
const folded = L.icsFold(long);
eq('icsFold: no line over 75 octets', folded.split('\r\n').map((l) => new TextEncoder().encode(l).length <= 75), folded.split('\r\n').map(() => true));
eq('icsFold: unfolds to the same line', folded.replace(/\r\n /g, ''), long);
eq('icsFold: a short line is left alone', L.icsFold('VERSION:2.0'), 'VERSION:2.0');
// Read the file back the way a calendar does: split on CRLF, unfold, take NAME:VALUE, unescape TEXT.
const cal = L.ics({ title: 'Call: Palo Alto / London', ms: at, mins: 60, details: 'Palo Alto: 7 am – 8 am, Tue 27 Oct\nLondon: 2 pm – 3 pm; then dinner', url: 'https://x.test/?t=a', stampMs: Date.UTC(2026, 9, 27, 10) });
const props = {};
for (const ln of cal.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean)) { const k = ln.indexOf(':'); (props[ln.slice(0, k)] ||= []).push(ln.slice(k + 1)); }
const unesc = (v) => v.replace(/\\(.)/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
eq('ics: CRLF everywhere, ends with one', [/(^|[^\r])\n/.test(cal), cal.endsWith('END:VCALENDAR\r\n')], [false, true]);
eq('ics: one event, start and end in UTC', [props.BEGIN, props.DTSTART, props.DTEND, props.DTSTAMP],
  [['VCALENDAR', 'VEVENT'], ['20261027T140000Z'], ['20261027T150000Z'], ['20261027T100000Z']]);
eq('ics: summary and description read back', [unesc(props.SUMMARY[0]), unesc(props.DESCRIPTION[0])],
  ['Call: Palo Alto / London', 'Palo Alto: 7 am – 8 am, Tue 27 Oct\nLondon: 2 pm – 3 pm; then dinner']);
eq('ics: required VERSION, PRODID, UID', [props.VERSION, !!props.PRODID, /@when-works$/.test(props.UID?.[0])], [['2.0'], true, true]);

// --- exact edges ---------------------------------------------------------------------------
// LA leaves summer time at 2026-11-01 09:00 UTC. Sampling is every 6 h, then halved: the change
// has to be found in the first window, in one that starts past a sample, and never at `to` itself.
const LA = 'America/Los_Angeles', T = Date.UTC(2026, 10, 1, 9), HR = 3600e3;
eq('transitions: half an hour in, 6.5 h in, exactly at `to` (out), and the last window', [L.transitions(LA, T - 0.5 * HR, T + HR), L.transitions(LA, T - 6.5 * HR, T + HR),
  L.transitions(LA, T - HR, T), L.transitions(LA, T - 11 * HR, T + HR)].map((x) => x.map((e) => [e.ms, e.before, e.after])),
  [[[T, -420, -480]], [[T, -420, -480]], [], [[T, -420, -480]]]);
// Every EU zone leaves summer time at 01:00 UTC on 25 October: two changes at one instant, in zone order.
eq('two changes at one instant, in a fixed order', L.changes([{ tz: LA, label: 'h' }, { tz: 'Europe/London', label: 'l' }, { tz: 'Europe/Berlin', label: 'b' }], '2026-10-20')
  .map((e) => [new Date(e.ms).toISOString(), e.tz]), [['2026-10-25T01:00:00.000Z', 'Europe/Berlin'], ['2026-10-25T01:00:00.000Z', 'Europe/London'], ['2026-11-01T09:00:00.000Z', LA]]);
eq('changes look 28 days ahead, not 29', [L.changes([{ tz: LA, label: 'x' }], '2026-10-04').length, L.changes([{ tz: LA, label: 'x' }], '2026-10-05').length], [0, 1]);
eq('time past midnight wraps', [L.time(1440), L.time(1500)], ['12 am', '1 am']);
const named = [['Parisville', '', 'X', 'XX', 9, 0], ['Paris', 'Île-de-France', 'France', 'FR', 8, 0], ['Paris Hill', '', 'X', 'XX', 7, 0], ['Paris', 'Texas', 'United States', 'US', 6, 0]];
eq('whole-name matches before the more populous prefixes', L.matchPlaces(named, 'paris').map(L.placeLabel),
  ['Paris, Île-de-France, France', 'Paris, Texas, United States', 'Parisville, X', 'Paris Hill, X']);
eq('eight by default', L.matchPlaces(Array.from({ length: 12 }, (_, i) => [`Town${i}`, '', 'X', 'XX', 1, 0]), 'town').length, 8);
const pa = L.placeByLabel(doc.places, 'Palo Alto, California, United States');
eq('P names the columns', [pa[L.P.NAME], pa[L.P.A1], pa[L.P.CN], pa[L.P.CC], pa[L.P.POP], doc.zones[pa[L.P.TZ]]], ['Palo Alto', 'California', 'United States', 'US', 66853, LA]);
eq('biggest in the first zone of the list, and in none', [L.placeLabel(L.biggestIn(doc.places, doc.zones, doc.zones[0])), L.biggestIn(doc.places, doc.zones, 'Mars/Olympus')],
  [L.placeLabel(doc.places.find((p) => p[L.P.TZ] === 0)), null]);
eq('a long town is clipped to 120', L.decodeState(`?t=${'x'.repeat(300)}`).towns[0].length, 120);
eq('the lengths on offer', L.LENGTHS, [30, 60, 90]);
// RFC 5545: 75 octets on the first line, then 74 after the leading space.
const foldLens = (n) => L.icsFold('x'.repeat(n)).split('\r\n ').map((x) => x.length);
eq('icsFold: exactly 75 stays one line, then 75 + 74 + rest', [foldLens(75), foldLens(76), foldLens(150)], [[75], [75, 1], [75, 74, 1]]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
