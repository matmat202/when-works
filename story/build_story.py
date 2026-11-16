#!/usr/bin/env python3
"""site/data/places.json + holidays.json -> site/story/story.json: do two strangers ever share a working hour?

    python3 build_story.py          # BUILD_OUT=... writes elsewhere (publish.sh compares)

Pairs of people: N pairs of towns drawn with a fixed seed, each town as often as its
GeoNames population (a pair of the same town drawn again). For each pair, every day of
YEAR in the first town's calendar, the way the page draws it: site/when-logic.js's grid(),
one row per real hour of the first town's day starting at its local midnight, each town's
wall clock at the row's instant, each cell 'work' (9 to 5 on a working day), 'awake' (7 am
to 11 pm) or 'sleep', weekends and public holidays (national and the town's state's) as
classify() and holidaysOf() read them.

Per pair: `work` days of the year with at least one row where both are at work; `clock`
the same with every day a working day (so only the clocks decide); `awake` rows of the
year where both are awake or at work; `gap` the commonest gap between the two clocks at
the first town's noon, folded to 0-12 h (a 20 h gap is 4 h the other way round);
`moves` 1 if that gap is not the same all year.

test/story.test.mjs re-does a sample of pairs with the real JS grid() and requires the
same counts.
"""
import bisect
import datetime as dt
import json
import os
import random
from collections import Counter
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
PLACES = os.path.join(HERE, "site", "data", "places.json")
HOLS = os.path.join(HERE, "site", "data", "holidays.json")
OUT = os.environ.get("BUILD_OUT", os.path.join(HERE, "site", "story", "story.json"))
N, SEED, YEAR = 4000, 20261116, 2026
WORK, AWAKE = (540, 1020), (420, 1380)
EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
T0 = int((dt.datetime(YEAR - 1, 12, 30, tzinfo=dt.timezone.utc) - EPOCH).total_seconds() // 60)
T1 = int((dt.datetime(YEAR + 1, 1, 3, tzinfo=dt.timezone.utc) - EPOCH).total_seconds() // 60)

_TR = {}
def transitions(tz):
    """[(utc minute, offset minutes)] covering the year: the offset from each utc minute on"""
    if tz in _TR:
        return _TR[tz]
    zi = ZoneInfo(tz)
    off = lambda m: int((EPOCH + dt.timedelta(minutes=m)).astimezone(zi).utcoffset().total_seconds() // 60)
    out = [(T0, off(T0))]
    for m in range(T0 + 60, T1, 60):
        o = off(m)
        if o != out[-1][1]:
            lo, hi = m - 60, m     # off(lo) is the old offset, off(hi) the new: find the minute
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if off(mid) == o: hi = mid
                else: lo = mid
            out.append((hi, o))
    _TR[tz] = (out, [t for t, _ in out])
    return _TR[tz]

def offset(tz, m):
    out, ts = transitions(tz)
    return out[bisect.bisect_right(ts, m) - 1][1]

DAY0 = dt.date(1970, 1, 1)
def wall(tz, m):
    """-> (ymd ordinal, minute of day, weekday 0=Sunday), as when-logic.js wall()"""
    t = m + offset(tz, m)
    d, mm = divmod(t, 1440)
    return d, mm, (d + 4) % 7      # 1970-01-01 was a Thursday

def day_start(tz, d):
    """when-logic.js dayStart(): the first utc minute whose local day is d (days since 1970)"""
    lo, hi = d * 1440 - 15 * 60, d * 1440 + 15 * 60
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if wall(tz, mid)[0] < d: lo = mid
        else: hi = mid
    return hi

def in_weekend(wd, fl):
    a, b = fl
    return a <= wd <= b if a <= b else wd >= a or wd <= b

def town(p, Z, WE, H):
    cc, a1 = p[3], p[1]
    off = set(H["off"].get(cc, {}))
    code = H["a1"].get(cc, {}).get(a1)
    if code:
        off |= set(H["reg"].get(cc, {}).get(code, {}))
    to_ord = lambda ymd: (dt.date.fromisoformat(ymd) - DAY0).days
    return {"tz": Z[p[5]], "we": WE.get(cc, [6, 0]), "off": {to_ord(y) for y in off}, "work": {to_ord(y) for y in H["work"].get(cc, [])}}

def cls(t, w, every_day_works=False):
    d, mm, wd = w
    if mm < AWAKE[0] or mm >= AWAKE[1]:
        return "sleep"
    day_off = False if every_day_works else (d in t["off"] or (in_weekend(wd, t["we"]) and d not in t["work"]))
    return "work" if not day_off and WORK[0] <= mm < WORK[1] else "awake"

def pair(a, b):
    first, last = (dt.date(YEAR, 1, 1) - DAY0).days, (dt.date(YEAR, 12, 31) - DAY0).days
    work = clock = awake = 0
    gaps = []
    for d in range(first, last + 1):
        s = day_start(a["tz"], d)
        both_work = both_clock = False
        m = s
        while True:
            wa = wall(a["tz"], m)
            if wa[0] != d:
                break
            wb = wall(b["tz"], m)
            ca, cb = cls(a, wa), cls(b, wb)
            if ca == "work" and cb == "work": both_work = True
            if ca != "sleep" and cb != "sleep": awake += 1
            if cls(a, wa, True) == "work" and cls(b, wb, True) == "work": both_clock = True
            m += 60
        work += both_work
        clock += both_clock
        noon = s + 720
        g = abs(offset(b["tz"], noon) - offset(a["tz"], noon)) % 1440
        gaps.append(min(g, 1440 - g))
    c = Counter(gaps)
    gap = max(c, key=lambda k: (c[k], -k))
    return [gap, work, clock, awake, int(len(c) > 1)]

def check(pairs):
    """layout.js stats(), done again here: the test requires the two to agree.
    A pair row: [from, to, gap, work, clock, awake, moves, flags]"""
    share = lambda f, rs: sum(1 for p in rs if f(p)) / len(rs) if rs else 0
    mid = lambda xs: sorted(xs)[(len(xs) - 1) // 2] if xs else 0
    out = {}
    for key, keep in SEL.items():
        P = [p for p in pairs if keep(p)]
        never = [p for p in P if p[3] == 0]
        out[key] = {
            "n": len(P),
            "never": share(lambda p: p[3] == 0, P),
            "never_clock": share(lambda p: p[4] == 0, P),
            "agree": share(lambda p: (p[3] == 0) == (p[4] == 0), P),
            "near_never": share(lambda p: p[3] == 0, [p for p in P if p[2] < 420]),
            "far_never": share(lambda p: p[3] == 0, [p for p in P if p[2] >= 540]),
            "never_awake": share(lambda p: p[5] == 0, P),
            "never_awake_rows": mid([p[5] / 365 for p in never]),
            "can_days": mid([p[3] for p in P if p[3] > 0]),
            "moves": share(lambda p: p[6] == 1, P),
            "part_year": share(lambda p: 0 < p[4] < 365, P),
        }
    return out


SEL = {"all": lambda p: True, "nochina": lambda p: not p[7] & 2, "noindia": lambda p: not p[7] & 4, "intl": lambda p: not p[7] & 1}


def main():
    D, H = json.load(open(PLACES)), json.load(open(HOLS))
    P, Z, WE = D["places"], D["zones"], D["weekend"]
    rng = random.Random(SEED)
    cum, acc = [], 0
    for p in P:
        acc += p[4]
        cum.append(acc)
    T = {}
    pairs = []
    while len(pairs) < N:
        i, j = rng.choices(range(len(P)), cum_weights=cum, k=2)
        if i == j:
            continue
        for k in (i, j):
            if k not in T: T[k] = town(P[k], Z, WE, H)
        pairs.append([i, j] + pair(T[i], T[j]) + [int(P[i][3] == P[j][3]) | (2 if "CN" in (P[i][3], P[j][3]) else 0) | (4 if "IN" in (P[i][3], P[j][3]) else 0)])
    out = {
        "source": D["source"] + "; holidays: " + H["source"] + ", as the page ships them in site/data/",
        "seed": SEED, "year": YEAR, "n_towns": len(P), "people": sum(p[4] for p in P),
        "cols": ["from", "to", "gap min", "work days", "clock days", "awake rows", "gap moves", "flags"],
        "pairs": pairs,
    }
    out["check"] = check(pairs)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    for key, c in out["check"].items():
        print(f"{key:8s} " + "  ".join(f"{k} {v:.3f}" if isinstance(v, float) else f"{k} {v}" for k, v in c.items()))

if __name__ == "__main__":
    main()
