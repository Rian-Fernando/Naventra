#!/usr/bin/env python3
"""Self-tests for the training data pipeline — validation + featurization.
Run before any training so the model can never learn from bad or misread data.

    python3 scripts/test_train.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_model import validate, featurize, FEATURES

fails = 0
def check(name, cond):
    global fails
    print(("PASS" if cond else "FAIL"), name)
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

print()
if fails:
    print(f"{fails} test(s) FAILED")
    sys.exit(1)
print("All data-pipeline tests passed.")
