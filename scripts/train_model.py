#!/usr/bin/env python3
"""Weekly model training + honest evaluation for Naventra.

Pulls the labeled dataset the always-on worker collects, VALIDATES every row
(so the model never learns from incorrect or insufficient data), builds a rich
weather- and traffic-aware feature vector, trains a per-airport multinomial-
softmax runway classifier in numpy (so it serves as plain JS inference), and
evaluates it HEAD-TO-HEAD against the live engine using each row's `runway_ok`.

Run the self-tests first:  python3 scripts/test_train.py
Then:                      python3 scripts/train_model.py [dataset.jsonl]
                           (no arg → fetch from the tracker API)
"""
import json, math, sys, os, urllib.request
import numpy as np
from collections import defaultdict, Counter

TRACKER = os.environ.get("TRACKER_URL", "https://naventra-tracker.rianfernando.workers.dev")
MIN_ROWS = 150          # clean rows needed per airport
MIN_WIN_PTS = 3.0       # model must beat engine by this on the time-split to adopt

FEATURES = [
    "sin_oct", "cos_oct",                       # approach octant
    "sin_wind", "cos_wind", "wind_calm",        # wind direction (+ calm/VRB flag)
    "wind_kt", "head_kt", "cross_kt", "gust_kt",  # wind strength & components
    "sin_brg", "cos_brg",                       # bearing to the field
    "sin_hour", "cos_hour",                     # diurnal pattern
    "visib", "ceiling", "no_ceiling",           # weather: visibility + ceiling (+flag)
    "is_mvfr", "is_ifr", "is_lifr",             # flight category (VFR = baseline)
    "temp", "arr_rate", "inbound", "sector",    # temp + traffic density (congestion)
    "bias",
]


# --------------------------------------------------------------- validation ---
def validate(r):
    """Return (ok, reason). Rejects rows we must not learn from."""
    if not r.get("actual_runway"):
        return False, "no_runway"           # departures / unclassifiable landings
    o = r.get("octant")
    if o is None or not (0 <= o <= 7):
        return False, "octant"              # no usable approach direction
    a = r.get("alt_ft")
    if a is None or a < -500 or a > 60000:
        return False, "altitude"            # bad barometric reading
    g = r.get("agl_ft")
    if g is not None and g < -300:
        return False, "agl_negative"        # below-ground artifact
    gs = r.get("gs_kt")
    if gs is None or gs < 30 or gs > 400:
        return False, "groundspeed"         # noise / not an approach
    return True, None


# -------------------------------------------------------------- featurizer ---
def featurize(r):
    """Weather- and traffic-aware feature vector. Nulls handled explicitly:
    VRB/calm wind is flagged (not treated as north); a missing ceiling means
    'no ceiling' (clear), not zero."""
    def g(k, d=0.0):
        v = r.get(k)
        return float(v) if v is not None else float(d)

    o = r["octant"] * math.pi / 4
    wd = r.get("wind_dir")
    calm = 1.0 if wd is None else 0.0
    wr = (wd or 0) * math.pi / 180
    br = (r.get("brg") or 0) * math.pi / 180
    hl = (r.get("hour_local") or 0) * math.pi / 12
    ceil = r.get("ceiling_ft")
    no_ceil = 1.0 if ceil is None else 0.0
    fc = r.get("flt_cat") or "VFR"
    return [
        math.sin(o), math.cos(o),
        0.0 if calm else math.sin(wr), 0.0 if calm else math.cos(wr), calm,
        g("wind_kt") / 20, g("head_kt") / 20, g("cross_kt") / 20, g("gust_kt") / 20,
        math.sin(br), math.cos(br),
        math.sin(hl), math.cos(hl),
        g("visib_sm", 10) / 10, (min(ceil, 20000) / 20000 if ceil is not None else 0.0), no_ceil,
        1.0 if fc == "MVFR" else 0.0, 1.0 if fc == "IFR" else 0.0, 1.0 if fc == "LIFR" else 0.0,
        g("temp_c") / 30, g("arr_rate_1h") / 60, g("inbound_count") / 50, g("sector_count") / 200,
        1.0,
    ]


# ------------------------------------------------------------------ model ----
def softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def train(X, y, k, iters=800, lr=0.3, lam=1e-3):
    W = np.zeros((X.shape[1], k))
    Y = np.eye(k)[y]
    for _ in range(iters):
        W -= lr * (X.T @ (softmax(X @ W) - Y) / len(y) + lam * W)
    return W


def load(path):
    if path and os.path.exists(path):
        return [json.loads(l) for l in open(path) if l.strip()]
    req = urllib.request.Request(f"{TRACKER}/api/dataset.jsonl?limit=200000",
                                 headers={"User-Agent": "naventra-trainer/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return [json.loads(l) for l in r.read().decode().splitlines() if l.strip()]


def main():
    rows = load(sys.argv[1] if len(sys.argv) > 1 else None)

    # validate everything up front and record why rows are dropped
    reasons = Counter()
    clean_by_ap = defaultdict(list)
    for r in rows:
        ok, why = validate(r)
        if ok:
            clean_by_ap[r["icao"]].append(r)
        else:
            reasons[why] += 1
    kept = sum(len(v) for v in clean_by_ap.values())

    assert len(FEATURES) == len(featurize({"octant": 0})), "feature length mismatch"

    model = {"features": FEATURES, "trainedRows": len(rows), "cleanRows": kept, "airports": {}}
    report = ["# Model training report", "",
              f"Dataset: **{len(rows):,}** rows from the always-on tracker; "
              f"**{kept:,}** passed validation and were used.", "",
              "### Data quality — rows rejected (never learned from)",
              "| reason | rows |", "|---|--:|"]
    for why, c in reasons.most_common():
        report.append(f"| {why} | {c:,} |")
    report += ["", "Weather & traffic in the model: wind direction (with a VRB/calm flag), wind "
               "speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight "
               "category, temperature, arrival rate and inbound/sector traffic density. Conflicts are "
               "a real-time safety monitor, not a determinant of runway choice, so they are not a "
               "feature — the congestion that drives them is captured by the traffic-density inputs.", "",
               "| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |",
               "|---|--:|--:|--:|--:|--:|:--:|"]

    mtot = etot = ntot = 0
    for ap, rs in sorted(clean_by_ap.items()):
        if len(rs) < MIN_ROWS:
            continue
        rs.sort(key=lambda r: r["ts"])
        classes = sorted({r["actual_runway"] for r in rs})
        if len(classes) < 2:
            continue
        ci = {c: i for i, c in enumerate(classes)}
        X = np.array([featurize(r) for r in rs])
        y = np.array([ci[r["actual_runway"]] for r in rs])
        eng = np.array([1 if r.get("runway_ok") else 0 for r in rs])
        n = len(rs)
        cut = int(n * 0.75)

        Wt = train(X[:cut], y[:cut], len(classes))
        m_time = (np.argmax(X[cut:] @ Wt, 1) == y[cut:]).mean()
        e_time = eng[cut:].mean()

        rng = np.random.default_rng(7)
        idx = rng.permutation(n); tr, te = idx[:cut], idx[cut:]
        Wr = train(X[tr], y[tr], len(classes))
        m_rand = (np.argmax(X[te] @ Wr, 1) == y[te]).mean()

        adopt = (m_time - e_time) * 100 >= MIN_WIN_PTS
        W_all = train(X, y, len(classes))
        model["airports"][ap] = {
            "classes": classes, "W": [[round(v, 5) for v in row] for row in W_all.tolist()],
            "engineAccT": round(e_time * 100, 1), "modelAccT": round(m_time * 100, 1),
            "modelAccRand": round(m_rand * 100, 1), "adopt": bool(adopt), "n": n,
        }
        report.append(f"| {ap} | {n:,} | {len(classes)} | {e_time*100:.1f}% | {m_time*100:.1f}% | "
                      f"{m_rand*100:.1f}% | {'✅' if adopt else '—'} |")
        mtot += (np.argmax(X[cut:] @ Wt, 1) == y[cut:]).sum(); etot += eng[cut:].sum(); ntot += n - cut

    pe = 100 * etot / ntot if ntot else 0
    pm = 100 * mtot / ntot if ntot else 0
    model["pooled"] = {"engine": round(pe, 1), "model": round(pm, 1), "testRows": ntot}
    adopted = [a for a, v in model["airports"].items() if v["adopt"]]
    report += ["",
               f"**Pooled time-split:** engine {pe:.1f}% vs model {pm:.1f}% over {ntot:,} recent test rows.", "",
               f"**Adopt (model beats engine by ≥{MIN_WIN_PTS} pts on the time-split):** "
               f"{', '.join(adopted) if adopted else 'none — the expert engine wins everywhere else'}.", "",
               "The engine reads which runways live traffic is actually using (observed-config inference), "
               "which is near-unbeatable for absolute runway choice; the model only adds signal at complex "
               "multi-runway fields. Regenerated weekly as data grows."]

    os.makedirs("public", exist_ok=True); os.makedirs("docs", exist_ok=True)
    json.dump(model, open("public/model.json", "w"), separators=(",", ":"))
    open("docs/model-report.md", "w").write("\n".join(report) + "\n")
    print("\n".join(report))
    print(f"\nWrote public/model.json ({os.path.getsize('public/model.json')} bytes) and docs/model-report.md")


if __name__ == "__main__":
    main()
