#!/usr/bin/env python3
"""Self-tests for the training data pipeline — validation + featurization.
Run before any training so the model can never learn from bad or misread data.

    python3 scripts/test_train.py
"""
import sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_model import (validate, validate_eta, featurize, FEATURES, eta_feat, ETA_FEATURES, ridge, train,
                         recency_weights, time_cut, select_half_life, fetch_all, dedupe, monthly_trend, drift,
                         season_of, day_of_year, live_eta_err, replay_online_bias, paired_z, SEASONAL, DAY_MS)

fails = 0
def check(name, cond, detail=""):
    global fails
    print(("PASS" if cond else "FAIL"), name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        fails += 1

CLEAN = {"actual_runway": "22L", "octant": 2, "alt_ft": 3000, "agl_ft": 2800, "gs_kt": 140,
         "wind_dir": 250, "wind_kt": 10, "head_kt": 8, "cross_kt": 3, "gust_kt": 18, "brg": 40,
         "hour_local": 14, "flt_cat": "VFR", "visib_sm": 10, "ceiling_ft": 6000, "temp_c": 22,
         "arr_rate_1h": 50, "inbound_count": 40, "sector_count": 200}

# --- validation rejects everything we must not learn from --------------------
check("reject missing runway", not validate({**CLEAN, "actual_runway": None})[0])
check("reject bad octant (9)", not validate({**CLEAN, "octant": 9})[0])
check("reject missing octant", not validate({**CLEAN, "octant": None})[0])
check("reject negative agl", not validate({**CLEAN, "agl_ft": -500})[0])
check("reject absurd altitude", not validate({**CLEAN, "alt_ft": 70000})[0])
check("reject slow groundspeed", not validate({**CLEAN, "gs_kt": 10})[0])
check("reject fast groundspeed", not validate({**CLEAN, "gs_kt": 500})[0])
check("accept a clean row", validate(CLEAN)[0])
check("reason given on reject", validate({**CLEAN, "gs_kt": 10})[1] == "groundspeed")

# --- featurization: length, finiteness, explicit null handling ---------------
f = featurize(CLEAN)
check("feature length matches FEATURES", len(f) == len(FEATURES))
check("all features finite numbers", all(isinstance(x, float) and x == x and abs(x) != float("inf") for x in f))

fv = featurize({**CLEAN, "wind_dir": None})  # VRB / calm wind
check("VRB wind sets calm flag", fv[FEATURES.index("wind_calm")] == 1.0)
check("VRB wind zeroes wind dir", fv[FEATURES.index("sin_wind")] == 0.0 and fv[FEATURES.index("cos_wind")] == 0.0)

fn = featurize({**CLEAN, "ceiling_ft": None})  # clear sky
check("no ceiling sets flag", fn[FEATURES.index("no_ceiling")] == 1.0)
check("no ceiling → zero ceiling input", fn[FEATURES.index("ceiling")] == 0.0)

fg = {**CLEAN}; fg.pop("gust_kt")
check("missing gust → 0 (no gust)", featurize(fg)[FEATURES.index("gust_kt")] == 0.0)

check("featurize survives all-missing context", len(featurize({"octant": 0})) == len(FEATURES))

# --- ETA model: features + ridge solver -------------------------------------
check("eta feature length matches", len(eta_feat(CLEAN)) == len(ETA_FEATURES))
check("eta features finite", all(isinstance(x, float) and x == x for x in eta_feat(CLEAN)))
check("eta featurize survives missing context", len(eta_feat({})) == len(ETA_FEATURES))
_rng = np.random.default_rng(0)
_X = _rng.normal(size=(200, 3)); _X[:, 2] = 1.0
_w = np.array([2.0, -1.0, 5.0])
check("ridge recovers a linear fit", np.allclose(ridge(_X, _X @ _w, lam=1e-6), _w, atol=0.05))

# --- seasonal pipeline -------------------------------------------------------
fs = featurize(CLEAN, seasonal=False)
check("season inputs are zero until enabled", all(fs[FEATURES.index(k)] == 0.0 for k in SEASONAL))
fs_on = featurize({**CLEAN, "doy": 100}, seasonal=True)
check("season inputs carry the day of year when enabled", fs_on[FEATURES.index("sin_doy")] != 0.0)
check("eta season inputs zero until enabled", eta_feat(CLEAN)[-2:] == [0.0, 0.0])
check("day of year falls back to the timestamp", day_of_year({"ts": 1784471701274}) == 200)  # 2026-07-19
check("seasons: Dec counts toward next year's winter", season_of(1796083200000) == "winter 2027")  # 2026-12-01
check("seasons: July is summer", season_of(1784471701274) == "summer 2026")

GOLDEN = [0.625, 0.7, 0.4, 0.5, 0.4, 0.5, 1.0, 1.0, -0.5, -0.866025, 1.0, 0.988854, -0.14889]
gv = eta_feat({"dist_nm": 10, "gs_kt": 140, "head_kt": 8, "arr_rate_1h": 30, "inbound_count": 20, "sector_count": 100,
               "wake": "H", "flt_cat": "IFR", "hour_local": 14, "doy": 100}, seasonal=True)
check("eta vector matches the JS server (golden vector)", all(abs(a - b) < 1e-5 for a, b in zip(gv, GOLDEN)) and len(gv) == len(GOLDEN))

w = recency_weights([0, 30 * DAY_MS, 60 * DAY_MS], 60 * DAY_MS, 30)
check("recency weights halve per half-life", abs(w[1] / w[2] - 0.5) < 1e-9 and abs(w[0] / w[2] - 0.25) < 1e-9)
check("recency weights average 1", abs(w.mean() - 1) < 1e-9)
check("no half-life = equal weights", list(recency_weights([0, 1, 2], 2, None)) == [1.0, 1.0, 1.0])

ts = [i * DAY_MS // 10 for i in range(1000)]          # 100 days, 10 rows/day
c = time_cut(ts)
check("test window = the last 21 days", abs((ts[-1] - ts[c]) / DAY_MS - 21) < 0.2 and ts[c] > ts[c - 1])
check("thin data falls back to a 25% split", time_cut(list(range(100))) == 75)

check("ETA rows don't need a classified runway", validate_eta({**CLEAN, "actual_runway": None, "eta_err_sec": 90})[0])
check("ETA rows need a timing label", validate_eta({**CLEAN})[1] == "no_eta")
check("ETA outliers rejected", validate_eta({**CLEAN, "eta_err_sec": 4000})[1] == "eta_outlier")
check("live ETA error from graded prediction", live_eta_err({"land_ts": 1_000_000, "pred_eta_ts": 940_000}) == 60.0)

# Weighted training really follows the recent regime: old rows say class 0, new
# rows say class 1, same features — a short half-life must predict 1.
Xd = np.ones((400, 1)); yd = np.array([0] * 300 + [1] * 100)
tsd = [i * DAY_MS / 4 for i in range(400)]
p_flat = np.argmax(Xd[:1] @ train(Xd, yd, 2), 1)[0]
p_recent = np.argmax(Xd[:1] @ train(Xd, yd, 2, w=recency_weights(tsd, tsd[-1], 7)), 1)[0]
check("unweighted model follows the old majority", p_flat == 0)
check("recency-weighted model follows the current regime", p_recent == 1)

rows_hl = [{"ts": t, "y": (0 if i < 200 else 1)} for i, t in enumerate(tsd)]   # regime flips half-way
def _fit(part, h, ref):
    return train(np.ones((len(part), 1)), np.array([r["y"] for r in part]), 2, w=recency_weights([r["ts"] for r in part], ref, h))
def _acc(W, part):
    return float((np.argmax(np.ones((len(part), 1)) @ W, 1) == np.array([r["y"] for r in part])).mean())
h, sc = select_half_life(rows_hl[:380], _fit, _acc)
check("half-life selection picks a decay when the regime changed", h is not None, f"{h} {sc}")
stable = [{"ts": t, "y": 0} for t in tsd]
check("half-life selection keeps no decay when nothing changed", select_half_life(stable, _fit, _acc)[0] is None)

pages = {None: ([{"id": 9}, {"id": 8}], 8), 8: ([{"id": 7}, {"id": 6}], 6), 6: ([{"id": 5}], None)}
got, n = fetch_all(lambda before: pages[before], pause=0)
check("paged loader walks every page", [r["id"] for r in got] == [9, 8, 7, 6, 5] and n == 3)
legacy, n1 = fetch_all(lambda before: ([{"id": 1}], None), pause=0)
check("paged loader works with an older tracker (one page)", len(legacy) == 1 and n1 == 1)
check("dedupe drops repeated rows", len(dedupe([{"id": 1}, {"id": 1}, {"icao": "X", "ts": 1, "callsign": "A"}])) == 2)

mt = monthly_trend([{**CLEAN, "ts": 1784471701274, "runway_ok": 1, "eta_ok": 1, "eta_err_sec": 60},
                    {**CLEAN, "ts": 1784471701274, "runway_ok": 0, "eta_ok": 0, "eta_err_sec": 300}])
check("monthly trend aggregates a month", len(mt) == 1 and mt[0]["month"] == "2026-07" and mt[0]["rwyAcc"] == 50.0 and mt[0]["n"] == 2)
check("drift needs enough data on both sides", drift([{**CLEAN, "ts": 1}], 2) is None)

# Online ETA bias replay must match the JS tracker (src/engine/etaModel.js) —
# golden sequence shared with scripts/ci-regression.mjs.
BIAS_GOLDEN = [0.0, 0.0, 0.0, 98.7, 100.83, 92.747, 71.4723, 73.3251]
rb = replay_online_bias([{"ts": i * 600000, "eta_err_sec": e} for i, e in enumerate([300, -50, 60, 1500, 20, -400, 90, -10])])
check("online-bias replay matches the JS tracker (golden)", all(abs(a - b) < 1e-3 for a, b in zip(rb, BIAS_GOLDEN)), str([round(x, 4) for x in rb]))
check("online bias never exceeds its clip", max(abs(x) for x in rb) <= 120)

check("paired z counts only disagreements", abs(paired_z([1, 1, 1, 0, 1], [1, 0, 0, 0, 1]) - 2 ** 0.5) < 1e-9)
check("paired z is 0 when they always agree", paired_z([1, 0, 1], [1, 0, 1]) == 0.0)
check("a 2-pt edge on 236 rows is not significant", paired_z([1] * 10 + [0] * 5 + [1] * 221, [0] * 10 + [1] * 5 + [1] * 221) < 1.64)

print()
if fails:
    print(f"{fails} test(s) FAILED")
    sys.exit(1)
print("All data-pipeline tests passed.")
