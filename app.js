// When Works? — the page. Logic lives in when-logic.js; this file only reads and draws.
import * as L from './when-logic.js';

const $ = (id) => document.getElementById(id);
let PLACES = [], ZONES = [], WEEKEND = {};
const state = { towns: [], ymd: null, pick: null, mins: 60 };

const homeToday = () => L.wall(state.towns[0].tz, Date.now()).ymd;
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  e.append(...kids);
  return e;
};

function sync() {
  const today = homeToday();
  history.replaceState(null, '', location.pathname + L.encodeState({
    towns: state.towns.map((t) => t.label), ymd: state.ymd === today ? null : state.ymd,
  }));
}

// ---- the towns --------------------------------------------------------------------------

function drawTowns() {
  const ol = $('towns');
  ol.replaceChildren(...state.towns.map((t, i) => {
    const li = el('li');
    if (i === 0) li.append(el('span', { class: 'home' }, 'home'));
    li.append(t.label);
    if (i > 0) {
      const up = el('button', { type: 'button', 'aria-label': `Make ${L.short(t.label)} home`, title: 'Make this the home town (the rows)' }, '⌂');
      up.addEventListener('click', () => { state.towns.unshift(...state.towns.splice(i, 1)); draw(); });
      li.append(up);
    }
    if (state.towns.length > 1) {
      const x = el('button', { type: 'button', 'aria-label': `Remove ${L.short(t.label)}` }, '×');
      x.addEventListener('click', () => { state.towns.splice(i, 1); draw(); });
      li.append(x);
    }
    return li;
  }));
  const full = state.towns.length >= L.MAX_TOWNS;
  $('add').disabled = full;
  $('add').placeholder = full ? `${L.MAX_TOWNS} towns at most` : 'Add a town or city';
}

// ---- the day's best hours --------------------------------------------------------------

function span(g, [i, j], k) {
  const a = g[i].cells[k], b = L.wall(state.towns[k].tz, g[j].ms + L.HOUR), home = g[i].cells[0];
  const mark = L.dayMark(a, home);
  return `${L.time(a.min)} – ${L.time(b.min)}${mark ? ` (${mark})` : ''}`;
}

function drawBest(g, b) {
  const box = $('best'), n = state.towns.length;
  const home = L.short(state.towns[0].label);
  const len = ([i, j]) => j - i + 1;
  const runs = [...b.runs].sort((x, y) => len(y) - len(x) || x[0] - y[0]).slice(0, 3);
  const hrs = (r) => `${len(r)} hour${len(r) > 1 ? 's' : ''}`;
  let head;
  if (n === 1) head = `Add a town to compare with ${home}.`;
  else if (b.kind === 'work') head = `Everyone is at work for ${hrs(runs[0])}: ${span(g, runs[0], 0)} in ${home}.`;
  else if (b.kind === 'awake') head = `No hour has everyone at work. Everyone is awake for ${hrs(runs[0])}: ${span(g, runs[0], 0)} in ${home}.`;
  else head = `No hour has everyone awake. The fewest asleep is ${b.asleep} of ${n}: ${span(g, runs[0], 0)} in ${home}.`;
  const kids = [el('p', { class: 'head' }, head)];
  if (n > 1) {
    runs.forEach((r, ri) => {
      if (ri) kids.push(el('p', {}, `Also ${span(g, r, 0)} in ${home} (${hrs(r)}):`));
      kids.push(el('ul', {}, ...state.towns.map((t, k) => el('li', {}, `${L.short(t.label)}: ${span(g, r, k)}`))));
    });
    if (b.runs.length > 3) kids.push(el('p', { class: 'note' }, `And ${b.runs.length - 3} shorter stretch${b.runs.length - 3 > 1 ? 'es' : ''}, marked in the table.`));
  }
  box.replaceChildren(...kids);
}

// ---- the table ------------------------------------------------------------------------

const CLS = { work: 'at work', awake: 'awake', sleep: 'asleep' };

function drawGrid(g, b) {
  const t = $('grid'), mid = g[Math.floor(g.length / 2)].ms, home = state.towns[0];
  const head = el('tr', {}, ...state.towns.map((x, k) => {
    const gap = L.offsetMin(x.tz, mid) - L.offsetMin(home.tz, mid);
    return el('th', { scope: 'col' }, L.short(x.label),
      el('small', {}, k === 0 ? 'home' : gap ? `${gap > 0 ? '+' : '−'}${L.hm(gap)}` : 'same time'));
  }));
  const best = new Set(b.runs.flatMap(([i, j]) => Array.from({ length: j - i + 1 }, (_, n) => i + n)));
  const now = Date.now();
  const rows = g.map((r, i) => {
    const tr = el('tr', { class: [best.has(i) && state.towns.length > 1 ? 'best' : '', now >= r.ms && now < r.ms + L.HOUR ? 'now' : '',
      r.ms === state.pick && state.towns.length > 1 ? 'picked' : ''].join(' ').trim() || null });
    tr.addEventListener('click', () => { state.pick = r.ms; drawSlot(g); drawGrid(g, b); });
    r.cells.forEach((c, k) => {
      const mark = L.dayMark(c, r.cells[0]);
      const td = el('td', { class: c.cls, title: `${L.short(state.towns[k].label)}: ${CLS[c.cls]}` }, L.time(c.min));
      if (mark) td.append(el('small', {}, mark));
      tr.append(td);
    });
    return tr;
  });
  t.replaceChildren(el('thead', {}, head), el('tbody', {}, ...rows));
}

// ---- one hour, to a calendar ----------------------------------------------------------

// The pick survives a redraw only if it is still a row of the day; otherwise the start of the
// longest best stretch, as the summary above names it.
function pickIn(g, b) {
  if (g.some((r) => r.ms === state.pick)) return;
  const len = ([i, j]) => j - i + 1;
  const run = [...b.runs].sort((x, y) => len(y) - len(x) || x[0] - y[0])[0];
  state.pick = g[run ? run[0] : 0].ms;
}

function drawSlot(g) {
  const box = $('slot');
  box.hidden = state.towns.length < 2;
  if (box.hidden) return;
  const start = $('slotStart'), len = $('slotLen'), home = state.towns[0];
  start.replaceChildren(...g.map((r) => {
    const w = r.cells[0];
    return el('option', { value: r.ms }, `${L.time(w.min)} in ${L.short(home.label)}`);
  }));
  start.value = String(state.pick);
  len.replaceChildren(...L.LENGTHS.map((m) => el('option', { value: m }, m < 60 ? `${m} min` : L.hm(m))));
  len.value = String(state.mins);
  const lines = L.slotLines(state.towns, state.pick, state.mins), title = L.slotTitle(state.towns);
  const details = `${lines.join('\n')}\n\nWhen Works? ${location.href}`;
  $('slotLines').replaceChildren(...lines.map((s) => el('li', {}, s)));
  $('gcal').href = L.gcalUrl({ title, ms: state.pick, mins: state.mins, details });
  const cal = L.ics({ title, ms: state.pick, mins: state.mins, details, url: location.href, stampMs: Date.now() });
  $('icsLink').href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(cal);
  $('copied').textContent = '';
  box.dataset.text = `${title}\n${lines.join('\n')}`;
}

// ---- the clock changes -----------------------------------------------------------------

function drawChanges() {
  const ul = $('changes').querySelector('ul');
  const ev = L.changes(state.towns, state.ymd);
  const now = Date.now(), home = state.towns[0];
  if (!ev.length) {
    ul.replaceChildren(el('li', {}, `No clocks change in ${state.towns.length > 1 ? 'these towns' : L.short(home.label)} in the four weeks from ${L.dateWords(state.ymd)}.`));
    return;
  }
  ul.replaceChildren(...ev.map((e) => {
    const who = state.towns.filter((t) => t.tz === e.tz).map((t) => L.short(t.label)).join(' and ');
    const day = L.dateWords(L.wall(e.tz, e.ms - L.MIN).ymd);
    const past = e.ms <= now;
    const verb = `${past ? 'went' : 'go'} ${e.by < 0 ? 'back' : 'forward'} ${L.hm(e.by)}`;
    let say = `${day}: the clocks in ${who} ${verb}.`;
    for (const gp of e.gaps) {
      const t = L.short(state.towns[gp.i].label);
      say += ` ${t} ${past ? 'became' : 'becomes'} ${L.gapWords(gp.after)} ${L.short(home.label)} (${gp.before ? L.hm(gp.before) : 'the same time'} until then).`;
    }
    return el('li', {}, say);
  }));
}

function draw() {
  if (!state.ymd) state.ymd = homeToday();
  sync();
  drawTowns();
  $('date').value = state.ymd;
  const g = L.grid(state.towns, state.ymd);
  const b = L.best(g);
  drawBest(g, b);
  pickIn(g, b);
  drawSlot(g);
  drawGrid(g, b);
  drawChanges();
}

// ---- the add box (as in projects/how-far) ---------------------------------------------

function combo() {
  const box = $('add'), ul = $('addList'), listId = 'addList';
  let opts = [], active = -1;
  const close = () => { opts = []; active = -1; ul.hidden = true; box.setAttribute('aria-expanded', 'false'); box.removeAttribute('aria-activedescendant'); };
  const drawOpts = () => {
    ul.replaceChildren();
    opts.forEach((p, i) => {
      const li = el('li', { id: `${listId}${i}`, role: 'option', 'data-i': i, 'aria-selected': String(i === active) }, L.placeLabel(p));
      ul.append(li);
    });
    if (!opts.length) ul.append(el('li', { class: 'none' }, 'No town by that name. Try a bigger place nearby.'));
    ul.hidden = false;
    box.setAttribute('aria-expanded', 'true');
    if (active >= 0) { box.setAttribute('aria-activedescendant', `${listId}${active}`); $(`${listId}${active}`).scrollIntoView({ block: 'nearest' }); }
  };
  const pick = (p) => {
    close(); box.value = '';
    const t = L.toTown(p, ZONES, WEEKEND);
    if (!state.towns.some((x) => x.label === t.label) && state.towns.length < L.MAX_TOWNS) state.towns.push(t);
    draw();
  };
  box.addEventListener('input', () => {
    if (!box.value.trim()) { close(); return; }
    opts = L.matchPlaces(PLACES, box.value); active = opts.length ? 0 : -1; drawOpts();
  });
  box.addEventListener('keydown', (e) => {
    if (ul.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!opts.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length; drawOpts(); e.preventDefault();
    } else if (e.key === 'Enter') { if (opts[active]) pick(opts[active]); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); e.preventDefault(); }
  });
  ul.addEventListener('mousedown', (e) => e.preventDefault());
  ul.addEventListener('click', (e) => { const i = e.target.closest('li[data-i]')?.dataset.i; if (i != null && opts[i]) pick(opts[i]); });
  box.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== box) close(); }, 150));
}

function wire() {
  combo();
  $('date').addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test($('date').value)) { state.ymd = $('date').value; draw(); } });
  $('prev').addEventListener('click', () => { state.ymd = L.addDays(state.ymd, -1); draw(); });
  $('next').addEventListener('click', () => { state.ymd = L.addDays(state.ymd, 1); draw(); });
  $('today').addEventListener('click', () => { state.ymd = homeToday(); draw(); });
  const redraw = () => { const g = L.grid(state.towns, state.ymd); drawSlot(g); drawGrid(g, L.best(g)); };
  $('slotStart').addEventListener('change', () => { state.pick = Number($('slotStart').value); redraw(); });
  $('slotLen').addEventListener('change', () => { state.mins = Number($('slotLen').value); redraw(); });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('slot').dataset.text); $('copied').textContent = 'Copied.'; }
    catch { $('copied').textContent = 'Could not copy: select the lines above instead.'; }
  });
  setInterval(() => { if (state.towns.length) drawGrid(L.grid(state.towns, state.ymd), L.best(L.grid(state.towns, state.ymd))); }, 60000);
}

async function main() {
  let doc;
  try {
    const r = await fetch('data/places.json');
    if (!r.ok) throw new Error(r.status);
    doc = await r.json();
  } catch (e) { $('best').firstChild.textContent = `Could not load the list of towns (${e.message}). Reload to try again.`; return; }
  PLACES = doc.places; ZONES = doc.zones; WEEKEND = doc.weekend;
  const find = (label) => { const p = label && L.placeByLabel(PLACES, label); return p ? L.toTown(p, ZONES, WEEKEND) : null; };
  const want = L.decodeState(location.search);
  let towns = want.towns.map(find).filter(Boolean);
  if (!towns.length) {
    let mine = null;
    try { mine = L.biggestIn(PLACES, ZONES, Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* no zone */ }
    towns = [mine && L.toTown(mine, ZONES, WEEKEND), find('London, England, United Kingdom'), find('Tokyo, Japan'), find('New York City, New York, United States')]
      .filter(Boolean);
    towns = towns.filter((t, i) => towns.findIndex((x) => x.tz === t.tz) === i).slice(0, 3);
  }
  state.towns = towns.filter((t, i) => towns.findIndex((x) => x.label === t.label) === i);
  state.ymd = want.ymd;
  wire();
  draw();
}
main();
