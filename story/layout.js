/* Where every mark sits on each step of the story. Pure: no DOM, so test/story.test.mjs
 * runs every layout at several plot sizes. Modelled on how-far/site/story.
 *
 * Every step is the same chart: the pairs of people by how far apart their clocks are, in
 * half hours (folded: 20 h one way is 4 h the other).
 *   "gap":   grey bars, how many pairs; the red dot is the middle pair
 *   "never": each half hour as 100% of its pairs, red where they never share a working hour
 *   "moves": red where the gap between their clocks changes during the year
 * A pair: [from, to, gap min, work days, clock days, awake rows, gap moves, flags].
 */
export const COL = { hit: '#b3261e', faint: '#cfcac3' };
export const BIN = 30, GAP_MAX = 750, NBINS = GAP_MAX / BIN;
export const STEPS = { gap: 'gap', never: 'never', moves: 'moves' };
export const SEL = {
  all: () => true,
  nochina: (p) => (p[7] & 2) === 0,
  noindia: (p) => (p[7] & 4) === 0,
  intl: (p) => (p[7] & 1) === 0,
};
const mid = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : 0; };

const memo = new WeakMap();
/* -> the numbers the story quotes, for the pairs SEL[sel] keeps; build_story.py's `check` holds the same */
export function stats(D, sel = 'all') {
  if (!SEL[sel]) throw new Error(`unknown selection ${sel}`);
  if (!memo.has(D)) memo.set(D, {});
  const m = memo.get(D);
  if (m[sel]) return m[sel];
  const P = D.pairs.filter(SEL[sel]);
  const share = (f, rs = P) => (rs.length ? rs.filter(f).length / rs.length : 0);
  const never = P.filter((p) => p[3] === 0);
  m[sel] = {
    n: P.length,
    never: share((p) => p[3] === 0),
    never_clock: share((p) => p[4] === 0),
    agree: share((p) => (p[3] === 0) === (p[4] === 0)),
    near_never: share((p) => p[3] === 0, P.filter((p) => p[2] < 420)),
    far_never: share((p) => p[3] === 0, P.filter((p) => p[2] >= 540)),
    never_awake: share((p) => p[5] === 0),
    never_awake_rows: mid(never.map((p) => p[5] / 365)),
    can_days: mid(P.filter((p) => p[3] > 0).map((p) => p[3])),
    moves: share((p) => p[6] === 1),
    part_year: share((p) => p[4] > 0 && p[4] < 365),
  };
  return m[sel];
}
export const medianGap = (D) => mid(D.pairs.map((p) => p[2]));

/* -> [{n, hit}] per half hour: pairs in it, and how many of them the step's red marks */
export function bins(D, name) {
  const out = Array.from({ length: NBINS }, () => ({ n: 0, hit: 0 }));
  const red = name === 'never' ? (p) => p[3] === 0 : name === 'moves' ? (p) => p[6] === 1 : () => false;
  for (const p of D.pairs) {
    const b = out[Math.min(NBINS - 1, Math.floor(p[2] / BIN))];
    b.n++; if (red(p)) b.hit++;
  }
  return out;
}

/* -> {X, Y, base, room, bars: [{x,y,w,h,n,cls}], real: [{x,y,r,fill,op}]} in px of w x h */
export function layout(name, D, w, h) {
  if (!STEPS[name]) throw new Error(`unknown step ${name}`);
  const pad = 8;
  const X = (min) => pad + (min / GAP_MAX) * (w - 2 * pad);
  const base = h - pad, room = h - 2 * pad - 20;
  const B = bins(D, name);
  const most = Math.max(...B.map((b) => b.n));
  // "gap" is counts (the fullest half hour is full height); the others are shares of each
  const Y = name === 'gap' ? (v) => base - (room * v) / most : (v) => base - room * v;
  const bw = Math.max(1, (X(BIN) - X(0)) * 0.84);
  const bars = [];
  B.forEach((b, k) => {
    if (!b.n) return;
    const x = X(k * BIN + BIN / 2) - bw / 2;
    if (name === 'gap') bars.push({ x, y: Y(b.n), w: bw, h: base - Y(b.n), n: b.n, cls: 'bar' });
    else {
      bars.push({ x, y: Y(1), w: bw, h: room, n: b.n, cls: 'bar' });
      if (b.hit) bars.push({ x, y: Y(b.hit / b.n), w: bw, h: base - Y(b.hit / b.n), n: b.hit, cls: 'hit', of: b.n });
    }
  });
  const r = Math.max(3.5, Math.min(7, h * 0.012));
  const g = medianGap(D);
  const real = name === 'gap' ? [{ x: X(Math.floor(g / BIN) * BIN + BIN / 2), y: base - r, r, fill: COL.hit, op: 1 }] : [{ x: X(0), y: base, r: 0, fill: COL.hit, op: 0 }];
  return { kind: name, X, Y, base, room, bars, real };
}
