#!/usr/bin/env python3
"""Weekly model training + honest evaluation for Naventra.

Pulls the labeled dataset the always-on worker collects, trains a per-airport
multinomial-softmax runway classifier (pure numpy so it serves as plain JS
inference), and evaluates it HEAD-TO-HEAD against the live expert-system engine
using each row's recorded `runway_ok`.

Two evaluations are reported:
  * time-split  — train on the older 75%, test on the most recent 25%. This is
    the production-realistic number and the one that gates deployment.
  * random-split — the model's ceiling if regimes don't shift.

Outputs public/model.json (weights + eval) and docs/model-report.md. The engine
is only worth replacing at an airport where the model wins the time-split by a
clear margin — see MIN_WIN_PTS. Usage:

    python3 scripts/train_model.py [dataset.jsonl]
    (no arg → fetch from the tracker API)
"""
import json, math, sys, os, urllib.request
import numpy as np
from collections import defaultdict

TRACKER = os.environ.get("TRACKER_URL", "https://naventra-tracker.rianfernando.workers.dev")
MIN_ROWS = 150          # need enough per airport to train/test
MIN_WIN_PTS = 3.0       # model must beat the engine by this on the time-split to adopt
FEATURES = [
    "sin_oct", "cos_oct", "sin_wind", "cos_wind", "sin_brg", "cos_brg",
    "sin_hour", "cos_hour", "wind_kt", "head_kt", "cross_kt", "gust_kt", "arr_rate", "bias",
]


def load(path):
    if path and os.path.exists(path):
        return [json.loads(l) for l in open(path) if l.strip()]
    url = f"{TRACKER}/api/dataset.jsonl?limit=200000"
    with urllib.request.urlopen(url, timeout=120) as r:
        return [json.loads(l) for l in r.read().decode().splitlines() if l.strip()]


def feat(r):
    o = (r.get("octant", 0) or 0) * math.pi / 4
    wd = (r.get("wind_dir") or 0) * math.pi / 180
    br = (r.get("brg") or 0) * math.pi / 180
    hl = (r.get("hour_local") or 0) * math.pi / 12
    g = lambda k: float(r.get(k) or 0)
    return [math.sin(o), math.cos(o), math.sin(wd), math.cos(wd), math.sin(br), math.cos(br),
            math.sin(hl), math.cos(hl), g("wind_kt") / 20, g("head_kt") / 20, g("cross_kt") / 20,
            g("gust_kt") / 20, g("arr_rate_1h") / 30, 1.0]


def softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def train(X, y, k, iters=700, lr=0.3, lam=1e-3):
    W = np.zeros((X.shape[1], k))
    Y = np.eye(k)[y]
    for _ in range(iters):
        W -= lr * (X.T @ (softmax(X @ W) - Y) / len(y) + lam * W)
    return W


def main():
    rows = load(sys.argv[1] if len(sys.argv) > 1 else None)
    by_ap = defaultdict(list)
    for r in rows:
        if r.get("actual_runway") and r.get("octant") is not None:
            by_ap[r["icao"]].append(r)

    model = {"features": FEATURES, "airports": {}, "trainedRows": len(rows)}
    report = ["# Model training report", "",
              f"Dataset: **{len(rows):,}** labeled rows from the always-on tracker.", "",
              "| Airport | rows | runways | engine (time) | model (time) | model (random) | adopt |",
              "|---|--:|--:|--:|--:|--:|:--:|"]
    mtot = etot = ntot = 0
    for ap, rs in sorted(by_ap.items()):
        if len(rs) < MIN_ROWS:
            continue
        rs.sort(key=lambda r: r["ts"])
        classes = sorted({r["actual_runway"] for r in rs})
        if len(classes) < 2:
            continue
        ci = {c: i for i, c in enumerate(classes)}
        X = np.array([feat(r) for r in rs])
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
        # retrain on ALL data for the shipped weights
        W_all = train(X, y, len(classes))
        model["airports"][ap] = {
            "classes": classes, "W": [[round(v, 5) for v in row] for row in W_all.tolist()],
            "engineAccT": round(e_time * 100, 1), "modelAccT": round(m_time * 100, 1),
            "modelAccRand": round(m_rand * 100, 1), "adopt": bool(adopt),
        }
        report.append(f"| {ap} | {n:,} | {len(classes)} | {e_time*100:.1f}% | {m_time*100:.1f}% | "
                      f"{m_rand*100:.1f}% | {'✅' if adopt else '—'} |")
        mtot += (np.argmax(X[cut:] @ Wt, 1) == y[cut:]).sum(); etot += eng[cut:].sum(); ntot += n - cut

    pooled_e = 100 * etot / ntot if ntot else 0
    pooled_m = 100 * mtot / ntot if ntot else 0
    model["pooled"] = {"engine": round(pooled_e, 1), "model": round(pooled_m, 1), "testRows": ntot}
    adopted = [a for a, v in model["airports"].items() if v["adopt"]]
    report += ["",
               f"**Pooled time-split:** engine {pooled_e:.1f}% vs model {pooled_m:.1f}% "
               f"over {ntot:,} recent test rows.", "",
               f"**Adopt (model beats engine by ≥{MIN_WIN_PTS} pts, time-split):** "
               f"{', '.join(adopted) if adopted else 'none — the expert engine wins everywhere else'}.", "",
               "The engine leans on observed-config inference (it reads which runways live traffic is "
               "actually using), which is near-unbeatable for absolute runway choice; the model only adds "
               "signal at complex multi-runway fields. This report is regenerated weekly as data grows."]

    os.makedirs("public", exist_ok=True); os.makedirs("docs", exist_ok=True)
    json.dump(model, open("public/model.json", "w"), separators=(",", ":"))
    open("docs/model-report.md", "w").write("\n".join(report) + "\n")
    print("\n".join(report))
    print(f"\nWrote public/model.json ({os.path.getsize('public/model.json')} bytes) and docs/model-report.md")


if __name__ == "__main__":
    main()
