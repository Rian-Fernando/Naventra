#!/usr/bin/env python3
"""Weekly model training + honest evaluation for Naventra.

Pulls the labeled dataset the always-on worker collects — the WHOLE history,
page by page, so every season seen so far is in it — VALIDATES every row (so the
model never learns from incorrect or insufficient data), builds a weather- and
traffic-aware feature vector, trains a per-airport multinomial-softmax runway
classifier and a touchdown-ETA correction in numpy (so they serve as plain JS
inference), and evaluates both HEAD-TO-HEAD against what is live.

Staying right across seasons:
  * Recency weighting — older rows count less, with a half-life chosen per
    airport on an inner validation split (never on the test window), from
    {no decay, 60, 30, 14 days}. Old seasons still inform the model; the
    current one leads.
  * The adoption test is always the most recent 21 days, so a model is only
    switched on if it wins in the season we're in now.
  * Day-of-year features exist in the vector from day one but stay at zero
    until the data spans ~a full year (SEASONAL_MIN_DAYS): a seasonal pattern
    learned from half a year would be a guess, and nothing here guesses.
  * The report tracks every month (engine accuracy, ETA bias, weather, the
    runways in use) and flags drift between the last 30 days and the 30 before.

Run the self-tests first:  python3 scripts/test_train.py
Then:                      python3 scripts/train_model.py [dataset.jsonl]
                           (no arg → fetch every page from the tracker API)
"""
import json, math, sys, os, time, bisect, urllib.request
from datetime import datetime, timezone
import numpy as np
from collections import defaultdict, Counter

TRACKER = os.environ.get("TRACKER_URL", "https://naventra-tracker.rianfernando.workers.dev")
PAGE_ROWS = 20000       # the API's per-request cap
MAX_PAGES = 60          # safety stop (1.2M rows)
MIN_ROWS = 150          # clean rows needed per airport
MIN_WIN_PTS = 3.0       # model must beat engine by this on the time-split to adopt
MIN_Z = 1.64            # ...and the paired win must be significant (one-sided 95%)
TEST_DAYS = 21          # adoption is judged on the most recent three weeks
HALF_LIVES = [None, 60, 30, 14]   # candidate recency half-lives (days); None = no decay
PREFER_SIMPLE_PTS = 0.5           # a decay must beat "no decay" by this on validation
SEASONAL_MIN_DAYS = 330           # day-of-year features unlock after ~a year of data
DAY_MS = 86400000

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
    "sin_doy", "cos_doy",                       # season (zeroed until a year of data)
]
SEASONAL = ("sin_doy", "cos_doy")


# --------------------------------------------------------------- validation ---
def validate_core(r):
    """Checks every training row must pass. Returns the reject reason or None."""
    o = r.get("octant")
    if o is None or not (0 <= o <= 7):
        return "octant"              # no usable approach direction
    a = r.get("alt_ft")
    if a is None or a < -500 or a > 60000:
        return "altitude"            # bad barometric reading
    g = r.get("agl_ft")
    if g is not None and g < -300:
        return "agl_negative"        # below-ground artifact
    gs = r.get("gs_kt")
    if gs is None or gs < 30 or gs > 400:
        return "groundspeed"         # noise / not an approach
    return None


def validate(r):
    """Runway-model rows: (ok, reason). Rejects rows we must not learn from."""
    if not r.get("actual_runway"):
        return False, "no_runway"    # landing runway couldn't be told from the track
    why = validate_core(r)
    return (why is None), why


# --------------------------------------------------------------- time/season ---
def day_of_year(r):
    """Day of year (1..366) at lock; older rows predate the `doy` field, so it is
    derived from the landing timestamp (minutes later — same day)."""
    d = r.get("doy")
    if d:
        return int(d)
    ts = r.get("ts")
    return datetime.fromtimestamp(ts / 1000, timezone.utc).timetuple().tm_yday if ts else 1


def month_of(ts):
    return datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m")


def season_of(ts):
    """Meteorological season (all tracked hubs are northern-hemisphere)."""
    d = datetime.fromtimestamp(ts / 1000, timezone.utc)
    name = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
            6: "summer", 7: "summer", 8: "summer"}.get(d.month, "autumn")
    year = d.year + 1 if d.month == 12 else d.year   # Dec belongs to next year's winter
    return f"{name} {year}"


def recency_weights(ts, ref_ts, half_life_days):
    """Exponential decay by age, normalised to mean 1 (so regularisation keeps
    its meaning). None = every row counts the same."""
    n = len(ts)
    if not half_life_days or n == 0:
        return np.ones(n)
    age = np.clip((ref_ts - np.asarray(ts, dtype=float)) / DAY_MS, 0, None)
    w = 0.5 ** (age / half_life_days)
    return w * n / w.sum()


def time_cut(ts_sorted, days=TEST_DAYS):
    """Index of the first test row: the most recent `days`, unless that window is
    too small (<150 rows) or too large (>40% of rows) — then the last 25%."""
    n = len(ts_sorted)
    i = bisect.bisect_left(ts_sorted, ts_sorted[-1] - days * DAY_MS)
    if n - i < 150 or n - i > 0.4 * n:
        i = int(n * 0.75)
    return i


# -------------------------------------------------------------- featurizer ---
def featurize(r, seasonal=False):
    """Weather- and traffic-aware feature vector. Nulls handled explicitly:
    VRB/calm wind is flagged (not treated as north); a missing ceiling means
    'no ceiling' (clear), not zero. Season inputs are zero unless enabled."""
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
    dy = 2 * math.pi * day_of_year(r) / 365.25
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
        math.sin(dy) if seasonal else 0.0, math.cos(dy) if seasonal else 0.0,
    ]


# ------------------------------------------------------------------ model ----
def softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def train(X, y, k, iters=800, lr=0.3, lam=1e-3, w=None):
    """Softmax regression by gradient descent; optional per-row weights."""
    W = np.zeros((X.shape[1], k))
    Y = np.eye(k)[y]
    sw = (np.ones(len(y)) if w is None else np.asarray(w, dtype=float))
    sw = sw / sw.sum()
    for _ in range(iters):
        W -= lr * (X.T @ ((softmax(X @ W) - Y) * sw[:, None]) + lam * W)
    return W


# --------------------------------------------------------------- ETA model ---
# The engine's straight-line touchdown ETA is systematically early (flights hold,
# get vectored, fly into headwind). We learn the ETA error in seconds from
# lock-time features and add it. MUST mirror src/engine/etaModel.js::etaVec —
# same order and scaling; the season inputs sit after `bias` so models trained
# before they existed still line up.
ETA_FEATURES = ["dist", "gs", "head", "arr_rate", "inbound", "sector", "heavy", "ifr",
                "sin_hour", "cos_hour", "bias", "sin_doy", "cos_doy"]
ETA_CAP_S = 1800  # exclude |error| > 30 min — go-arounds / diversions / stale locks, not real ETAs
ETA_OK_S = 150    # the scorecard's ±2.5 min window
# The tracker's online bias — MUST mirror src/engine/etaModel.js (updateEtaBias /
# etaBiasFrom). It is what runs wherever no model is adopted, so it is the
# baseline a model must beat. The same clip keeps the model's fit robust: holds
# of 10–30 min would otherwise drag a least-squares fit late for everyone.
ETA_BIAS_CLIP_S = 120
ETA_BIAS_ALPHA = 0.1
ETA_BIAS_LAG_MS = 8 * 60000   # a lock is made minutes before touchdown


def eta_feat(r, seasonal=False):
    def g(k, d=0.0):
        v = r.get(k)
        return float(v) if v is not None else float(d)
    hl = (r.get("hour_local") or 0) * math.pi / 12
    dy = 2 * math.pi * day_of_year(r) / 365.25
    return [g("dist_nm") / 16, g("gs_kt") / 200, g("head_kt") / 20, g("arr_rate_1h") / 60,
            g("inbound_count") / 50, g("sector_count") / 200,
            1.0 if r.get("wake") in ("H", "J") else 0.0,
            1.0 if r.get("flt_cat") in ("IFR", "LIFR") else 0.0,
            math.sin(hl), math.cos(hl), 1.0,
            math.sin(dy) if seasonal else 0.0, math.cos(dy) if seasonal else 0.0]


def validate_eta(r):
    """ETA-model rows: the core checks plus a usable timing label. The landing
    runway is NOT required — timing is known even when the runway isn't."""
    why = validate_core(r)
    if why:
        return False, why
    e = r.get("eta_err_sec")
    if e is None:
        return False, "no_eta"
    if abs(e) > ETA_CAP_S:
        return False, "eta_outlier"
    return True, None


def live_eta_err(r):
    """Error (s) of the ETA that was actually graded live (raw + whatever
    correction was in force), or None if the row predates those fields."""
    land, pred = r.get("land_ts"), r.get("pred_eta_ts")
    if land and pred:
        return (land - pred) / 1000.0
    return None


def replay_online_bias(rows, lag_ms=ETA_BIAS_LAG_MS):
    """Replay the tracker's online ETA bias over time-sorted rows: each row gets
    the correction the tracker would have applied at lock (built only from
    landings at least `lag_ms` earlier). Returns a list of corrections (s)."""
    out, ema, n, j = [], 0.0, 0, 0
    for r in rows:
        while j < len(rows) and rows[j]["ts"] <= r["ts"] - lag_ms:
            e = rows[j].get("eta_err_sec")
            if e is not None:
                x = max(-ETA_BIAS_CLIP_S, min(ETA_BIAS_CLIP_S, e))
                ema = x if (n == 0 or abs(ema) > ETA_BIAS_CLIP_S) else ema * (1 - ETA_BIAS_ALPHA) + x * ETA_BIAS_ALPHA
                n += 1
            j += 1
        out.append(max(-ETA_BIAS_CLIP_S, min(ETA_BIAS_CLIP_S, ema)) if n >= 3 else 0.0)
    return out


def ridge(X, y, lam=1.0, w=None):
    d = X.shape[1]
    if w is None:
        return np.linalg.solve(X.T @ X + lam * np.eye(d), X.T @ y)
    Xw = X * np.asarray(w, dtype=float)[:, None]
    return np.linalg.solve(X.T @ Xw + lam * np.eye(d), Xw.T @ y)


def paired_z(model_hits, base_hits):
    """McNemar-style z for 'model beats baseline' on the SAME test rows: only the
    rows where exactly one of them is right carry information."""
    m = np.asarray(model_hits, dtype=bool)
    b = np.asarray(base_hits, dtype=bool)
    wins, losses = int((m & ~b).sum()), int((~m & b).sum())
    return (wins - losses) / math.sqrt(wins + losses) if wins + losses else 0.0


def select_half_life(rows, fit, score):
    """Pick the recency half-life on an inner split of the TRAINING rows (the
    last 20% of them, by time). Returns (half_life, {label: score})."""
    c = int(len(rows) * 0.8)
    tr, va = rows[:c], rows[c:]
    scores = {}
    for h in HALF_LIVES:
        scores[h] = score(fit(tr, h, tr[-1]["ts"]), va) if len(va) >= 30 else 0.0
    best = max(HALF_LIVES, key=lambda h: scores[h])
    if best is not None and scores[best] - scores[None] < PREFER_SIMPLE_PTS / 100:
        best = None
    return best, {("none" if h is None else f"{h}d"): round(s * 100, 1) for h, s in scores.items()}


# ------------------------------------------------------------------- data ----
def fetch_page(before=None):
    q = f"limit={PAGE_ROWS}" + (f"&before={before}" if before else "")
    req = urllib.request.Request(f"{TRACKER}/api/dataset.jsonl?{q}",
                                 headers={"User-Agent": "naventra-trainer/1.1 (+https://github.com/Rian-Fernando/Naventra)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read().decode()
        nxt = r.headers.get("X-Next-Before")
    return [json.loads(l) for l in body.splitlines() if l.strip()], (int(nxt) if nxt else None)


def fetch_all(fetch=fetch_page, pause=1.0):
    """Walk every page newest → oldest. An older tracker without paging just
    returns one page (no X-Next-Before), which ends the walk."""
    rows, before, pages = [], None, 0
    while pages < MAX_PAGES:
        page, nxt = fetch(before)
        rows += page
        pages += 1
        if not nxt or not page:
            break
        before = nxt
        time.sleep(pause)   # gentle on the free database's read budget
    return rows, pages


def dedupe(rows):
    seen, out = set(), []
    for r in rows:
        k = r.get("id") or (r.get("icao"), r.get("ts"), r.get("callsign"))
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def load(path):
    if path and os.path.exists(path):
        return dedupe([json.loads(l) for l in open(path) if l.strip()]), 1
    rows, pages = fetch_all()
    return dedupe(rows), pages


# ------------------------------------------------------------ seasonal view ---
def monthly_trend(rows):
    """Per UTC month: rows, live engine runway accuracy, live ETA ±2.5 min rate,
    median raw ETA error (positive = lands later than the straight-line ETA),
    IFR share, mean wind, and the arrival runway used most."""
    by = defaultdict(list)
    for r in rows:
        if r.get("ts"):
            by[month_of(r["ts"])].append(r)
    out = []
    for m in sorted(by):
        rs = by[m]
        rw = [r["runway_ok"] for r in rs if r.get("actual_runway") and r.get("runway_ok") is not None]
        ok = [r["eta_ok"] for r in rs if r.get("eta_ok") is not None]
        err = [r["eta_err_sec"] for r in rs if r.get("eta_err_sec") is not None and abs(r["eta_err_sec"]) <= ETA_CAP_S]
        ifr = [1 if r.get("flt_cat") in ("IFR", "LIFR") else 0 for r in rs if r.get("flt_cat")]
        wind = [r["wind_kt"] for r in rs if r.get("wind_kt") is not None]
        top = Counter(r["actual_runway"] for r in rs if r.get("actual_runway")).most_common(1)
        nrw = sum(1 for r in rs if r.get("actual_runway"))
        out.append({
            "month": m, "n": len(rs),
            "rwyAcc": round(100 * sum(rw) / len(rw), 1) if rw else None,
            "etaOk": round(100 * sum(ok) / len(ok), 1) if ok else None,
            "etaBias": int(np.median(err)) if err else None,
            "ifr": round(100 * sum(ifr) / len(ifr), 1) if ifr else None,
            "wind": round(sum(wind) / len(wind), 1) if wind else None,
            "topRwy": f"{top[0][0]} ({round(100 * top[0][1] / nrw)}%)" if top else None,
        })
    return out


def drift(rows, now_ts):
    """Last 30 days vs the 30 before: engine runway accuracy, live ETA ok%, and
    median ETA error. Returns None when either window is thin."""
    def window(lo, hi):
        rs = [r for r in rows if r.get("ts") and lo <= r["ts"] < hi]
        rw = [r["runway_ok"] for r in rs if r.get("actual_runway") and r.get("runway_ok") is not None]
        ok = [r["eta_ok"] for r in rs if r.get("eta_ok") is not None]
        err = [r["eta_err_sec"] for r in rs if r.get("eta_err_sec") is not None and abs(r["eta_err_sec"]) <= ETA_CAP_S]
        return len(rs), (100 * np.mean(rw) if rw else None), (100 * np.mean(ok) if ok else None), (float(np.median(err)) if err else None)
    a = window(now_ts - 30 * DAY_MS, now_ts + 1)
    b = window(now_ts - 60 * DAY_MS, now_ts - 30 * DAY_MS)
    if a[0] < 200 or b[0] < 200:
        return None
    d = {"recentN": a[0], "priorN": b[0]}
    for key, i in (("rwyAcc", 1), ("etaOk", 2), ("etaBias", 3)):
        if a[i] is not None and b[i] is not None:
            d[key] = [round(b[i], 1), round(a[i], 1)]
    flags = []
    if "rwyAcc" in d and abs(d["rwyAcc"][1] - d["rwyAcc"][0]) >= 5:
        flags.append("runway accuracy")
    if "etaOk" in d and abs(d["etaOk"][1] - d["etaOk"][0]) >= 5:
        flags.append("ETA hit rate")
    if "etaBias" in d and abs(d["etaBias"][1] - d["etaBias"][0]) >= 45:
        flags.append("ETA bias")
    d["flags"] = flags
    return d


def fmt(v, suffix=""):
    return "—" if v is None else f"{v}{suffix}"


# -------------------------------------------------------------------- main ----
def main():
    rows, pages = load(sys.argv[1] if len(sys.argv) > 1 else None)
    rows.sort(key=lambda r: r.get("ts") or 0)
    if not rows:
        sys.exit("No rows in the dataset — nothing to train on.")
    first_ts, last_ts = rows[0]["ts"], rows[-1]["ts"]
    span_days = (last_ts - first_ts) / DAY_MS
    seasonal = span_days >= SEASONAL_MIN_DAYS
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    assert len(FEATURES) == len(featurize({"octant": 0})), "feature length mismatch"
    assert len(ETA_FEATURES) == len(eta_feat({})), "eta feature length mismatch"

    # Validate everything up front and record why rows are dropped.
    reasons, eta_reasons = Counter(), Counter()
    clean_by_ap, eta_by_ap, all_by_ap = defaultdict(list), defaultdict(list), defaultdict(list)
    for r in rows:
        all_by_ap[r["icao"]].append(r)
        ok, why = validate(r)
        if ok:
            clean_by_ap[r["icao"]].append(r)
        else:
            reasons[why] += 1
        ok, why = validate_eta(r)
        if ok:
            eta_by_ap[r["icao"]].append(r)
        else:
            eta_reasons[why] += 1
    kept = sum(len(v) for v in clean_by_ap.values())
    eta_kept = sum(len(v) for v in eta_by_ap.values())
    seasons, season_start = Counter(), {}
    for r in rows:
        if r.get("ts"):
            k = season_of(r["ts"])
            seasons[k] += 1
            season_start.setdefault(k, r["ts"])   # rows are time-sorted

    model = {
        "generatedAt": generated,
        "features": FEATURES, "trainedRows": len(rows), "cleanRows": kept, "etaRows": eta_kept,
        "data": {
            "firstTs": first_ts, "lastTs": last_ts, "spanDays": round(span_days, 1), "pages": pages,
            "seasons": dict(seasons), "seasonalFeatures": seasonal, "seasonalMinDays": SEASONAL_MIN_DAYS,
        },
        "airports": {},
    }
    unlock = datetime.fromtimestamp((first_ts + SEASONAL_MIN_DAYS * DAY_MS) / 1000, timezone.utc).strftime("%B %Y")
    report = ["# Model training report", "",
              f"Generated {generated} from the always-on tracker's full history: **{len(rows):,}** graded "
              f"landings over **{span_days:.0f} days** ({month_of(first_ts)} → {month_of(last_ts)}, "
              f"{pages} page{'s' if pages != 1 else ''}). **{kept:,}** passed the runway-model checks and "
              f"**{eta_kept:,}** the ETA-model checks.", "",
              "Seasons in the data: " + ", ".join(f"{k} ({seasons[k]:,})" for k in sorted(seasons, key=season_start.get)) + ". "
              + ("Day-of-year (seasonal) features are **on** — the data spans a full year." if seasonal else
                 f"Day-of-year features stay **off** until the data spans {SEASONAL_MIN_DAYS} days (about {unlock}): "
                 "a seasonal pattern learned from part of a year would be a guess. Until then the model adapts "
                 "through recency weighting and the weather inputs that drive seasonal change."), "",
              "### Data quality — rows rejected (never learned from)",
              "| reason | runway model | ETA model |", "|---|--:|--:|"]
    for why in sorted(set(reasons) | set(eta_reasons), key=lambda k: -(reasons[k] + eta_reasons[k])):
        report.append(f"| {why} | {reasons[why]:,} | {eta_reasons[why]:,} |")
    report += ["", "Weather & traffic in the model: wind direction (with a VRB/calm flag), wind "
               "speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight "
               "category, temperature, arrival rate and inbound/sector traffic density. Conflicts are "
               "a real-time safety monitor, not a determinant of runway choice, so they are not a "
               "feature — the congestion that drives them is captured by the traffic-density inputs.", "",
               f"Every comparison below is on the **most recent {TEST_DAYS} days**, trained only on what came "
               "before — so it measures the season we're in now. The recency half-life is picked on a "
               "separate validation slice of the training data, never on the test window. A model is adopted "
               f"only if its win is also significant on those same rows (paired z ≥ {MIN_Z}, counting only "
               "the landings where exactly one of the two was right) — a lucky few weeks can't switch it on.", "",
               "## Runway model", "",
               "| Airport | clean rows | runways | half-life | engine (recent) | model (recent) | model (random) | z | adopt |",
               "|---|--:|--:|--:|--:|--:|--:|--:|:--:|"]

    mtot = etot = ntot = 0
    for ap, rs in sorted(clean_by_ap.items()):
        if len(rs) < MIN_ROWS:
            continue
        rs.sort(key=lambda r: r["ts"])
        classes = sorted({r["actual_runway"] for r in rs})
        if len(classes) < 2:
            continue
        ci = {c: i for i, c in enumerate(classes)}
        feats = {id(r): featurize(r, seasonal) for r in rs}
        X_of = lambda part: np.array([feats[id(r)] for r in part])
        y_of = lambda part: np.array([ci[r["actual_runway"]] for r in part])

        def fit(part, h, ref):
            return train(X_of(part), y_of(part), len(classes), w=recency_weights([r["ts"] for r in part], ref, h))

        def acc(W, part):
            return float((np.argmax(X_of(part) @ W, 1) == y_of(part)).mean())

        n = len(rs)
        cut = time_cut([r["ts"] for r in rs])
        train_rs, test_rs = rs[:cut], rs[cut:]
        h, hscores = select_half_life(train_rs, fit, acc)
        Wt = fit(train_rs, h, train_rs[-1]["ts"])
        m_hits = np.argmax(X_of(test_rs) @ Wt, 1) == y_of(test_rs)
        e_hits = np.array([bool(r.get("runway_ok")) for r in test_rs])
        m_time, e_time = float(m_hits.mean()), float(e_hits.mean())
        z = paired_z(m_hits, e_hits)

        rng = np.random.default_rng(7)
        idx = rng.permutation(n)
        tr_r, te_r = [rs[i] for i in idx[:cut]], [rs[i] for i in idx[cut:]]
        m_rand = acc(train(X_of(tr_r), y_of(tr_r), len(classes)), te_r)

        adopt = (m_time - e_time) * 100 >= MIN_WIN_PTS and z >= MIN_Z
        W_all = fit(rs, h, rs[-1]["ts"])
        model["airports"][ap] = {
            "classes": classes, "W": [[round(v, 5) for v in row] for row in W_all.tolist()],
            "engineAccT": round(e_time * 100, 1), "modelAccT": round(m_time * 100, 1),
            "modelAccRand": round(m_rand * 100, 1), "adopt": bool(adopt), "z": round(z, 2), "n": n,
            "testRows": len(test_rs), "halfLifeDays": h, "halfLifeVal": hscores,
        }
        report.append(f"| {ap} | {n:,} | {len(classes)} | {'none' if h is None else f'{h} d'} | {e_time*100:.1f}% | "
                      f"{m_time*100:.1f}% | {m_rand*100:.1f}% | {z:+.1f} | {'✅' if adopt else '—'} |")
        mtot += m_time * len(test_rs); etot += e_time * len(test_rs); ntot += len(test_rs)

    pe = 100 * etot / ntot if ntot else 0
    pm = 100 * mtot / ntot if ntot else 0
    model["pooled"] = {"engine": round(pe, 1), "model": round(pm, 1), "testRows": ntot}
    adopted = [a for a, v in model["airports"].items() if v["adopt"]]
    report += ["",
               f"**Pooled, last {TEST_DAYS} days:** engine {pe:.1f}% vs model {pm:.1f}% over {ntot:,} test rows.", "",
               f"**Adopt (model beats engine by ≥{MIN_WIN_PTS} pts on the recent window, paired z ≥ {MIN_Z}):** "
               f"{', '.join(adopted) if adopted else 'none — the expert engine wins everywhere'}.", "",
               "The engine reads which runways live traffic is actually using (observed-config inference), "
               "which is near-unbeatable for absolute runway choice; the model only adds signal at complex "
               "multi-runway fields. Regenerated weekly as data grows."]

    # --- touchdown ETA-error model per airport ---
    model["etaFeatures"] = ETA_FEATURES
    eta_rows = []
    eb_tot = el_tot = ec_tot = en_tot = 0
    for ap, er in sorted(eta_by_ap.items()):
        if len(er) < MIN_ROWS or ap not in model["airports"]:
            continue
        er.sort(key=lambda r: r["ts"])
        Xa = np.array([eta_feat(r, seasonal) for r in er])
        ya = np.array([float(r["eta_err_sec"]) for r in er])
        yc = np.clip(ya, -ETA_BIAS_CLIP_S, ETA_BIAS_CLIP_S)   # robust fitting target
        pos = {id(r): i for i, r in enumerate(er)}
        # The online bias as it now runs, replayed over every landing at this
        # airport in time order (all of them feed it, outliers included).
        seq = sorted(all_by_ap[ap], key=lambda r: r["ts"])
        bias_of = dict(zip((id(r) for r in seq), replay_online_bias(seq)))

        def efit(part, h, ref):
            ix = [pos[id(r)] for r in part]
            return ridge(Xa[ix], yc[ix], w=recency_weights([r["ts"] for r in part], ref, h))

        def eok(We, part):
            ix = [pos[id(r)] for r in part]
            return float((np.abs(ya[ix] - Xa[ix] @ We) <= ETA_OK_S).mean())

        ce = time_cut([r["ts"] for r in er])
        tr, te = er[:ce], er[ce:]
        h, hscores = select_half_life(tr, efit, eok)
        We = efit(tr, h, tr[-1]["ts"])
        ix = [pos[id(r)] for r in te]
        resid = ya[ix] - Xa[ix] @ We
        raw_ok = float((np.abs(ya[ix]) <= ETA_OK_S).mean())
        corr_hits = np.abs(resid) <= ETA_OK_S
        corr_ok = float(corr_hits.mean())
        # The online bias as it now runs (the baseline to beat), and what was
        # actually graded at the time (whatever estimator was deployed then).
        bias_hits = np.array([abs(r["eta_err_sec"] - bias_of.get(id(r), 0.0)) <= ETA_OK_S for r in te])
        bias_ok = float(bias_hits.mean())
        ez = paired_z(corr_hits, bias_hits)
        graded = [live_eta_err(r) for r in te]
        graded = [abs(x) <= ETA_OK_S for x in graded if x is not None]
        graded_ok = float(np.mean(graded)) if len(graded) >= 0.8 * len(te) else None
        base_mae, corr_mae = float(np.abs(ya[ix]).mean()), float(np.abs(resid).mean())
        eta_adopt = corr_ok - bias_ok >= 0.02 and ez >= MIN_Z
        model["airports"][ap]["eta"] = {
            "W": [round(v, 4) for v in efit(er, h, er[-1]["ts"]).tolist()],
            "baseMae": round(base_mae), "corrMae": round(corr_mae),
            "baseOkPct": round(raw_ok * 100, 1), "biasOkPct": round(bias_ok * 100, 1),
            "gradedOkPct": None if graded_ok is None else round(graded_ok * 100, 1),
            "corrOkPct": round(corr_ok * 100, 1), "adopt": bool(eta_adopt), "z": round(ez, 2),
            "n": len(er), "testRows": len(te), "halfLifeDays": h, "halfLifeVal": hscores,
        }
        eta_rows.append((ap, len(er), h, round(base_mae), round(corr_mae), round(raw_ok * 100, 1),
                         None if graded_ok is None else round(graded_ok * 100, 1),
                         round(bias_ok * 100, 1), round(corr_ok * 100, 1), round(ez, 1), eta_adopt))
        eb_tot += raw_ok * len(te); el_tot += bias_ok * len(te); ec_tot += corr_ok * len(te); en_tot += len(te)

    eta_outliers = eta_reasons.get("eta_outlier", 0)
    if eta_rows:
        pbo, plo, pco = (100 * x / en_tot for x in (eb_tot, el_tot, ec_tot))
        eta_adopted = [r[0] for r in eta_rows if r[10]]
        report += ["", "## Touchdown ETA model", "",
                   "The engine's straight-line ETA is systematically early (flights hold, get vectored, fly "
                   "into headwind). This learns the ETA error in seconds from lock-time features and adds "
                   "it. *raw* = the straight-line ETA with no correction; *graded* = what the scorecard "
                   "actually graded at the time; *online* = the tracker's online bias as it runs now "
                   f"(each error clipped to ±{ETA_BIAS_CLIP_S} s, α {ETA_BIAS_ALPHA}), replayed over the same "
                   "landings — the baseline a model must beat; *model* = raw + this correction (fitted on the "
                   "same clipped errors). ok% = within ±2.5 min, the scorecard window. Landings whose runway "
                   f"couldn't be classified still have a valid touchdown time, so they train the ETA model too. "
                   f"{eta_outliers:,} rows with |error| > 30 min (go-arounds / diversions / stale locks) were "
                   "excluded as bad ETA labels.", "",
                   "| Airport | rows | half-life | raw MAE | model MAE | raw ok% | graded ok% | online ok% | model ok% | z | adopt |",
                   "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--:|"]
        for ap, ne, h, bm, cm, bo, go, lo, co, zz, ad in eta_rows:
            report.append(f"| {ap} | {ne:,} | {'none' if h is None else f'{h} d'} | {bm}s | {cm}s | {bo}% | "
                          f"{'—' if go is None else f'{go}%'} | {lo}% | {co}% | {zz:+.1f} | {'✅' if ad else '—'} |")
        report += ["", f"**Pooled ETA within ±2.5 min, last {TEST_DAYS} days:** raw {pbo:.1f}% · online bias "
                   f"{plo:.1f}% · model {pco:.1f}% ({pco-plo:+.1f} pts vs the online bias).", "",
                   f"**Adopt (model beats the online bias by ≥2 pts, paired z ≥ {MIN_Z}):** "
                   f"{', '.join(eta_adopted) if eta_adopted else 'none — the online bias stays in charge'}."]

    # --- seasonal trends ---
    report += ["", "## Seasonal trends", "",
               "Month by month, per airport (UTC months): live engine runway accuracy, live ETA hits within "
               "±2.5 min, median ETA error (positive = flights land later than the straight-line ETA), IFR "
               "share, mean surface wind, and the arrival runway used most. This is what the retrain watches "
               "as the seasons turn: wind patterns move the runway configuration, and weather and traffic "
               "move the ETA bias.", ""]
    model["trends"] = {}
    for ap in sorted(all_by_ap):
        trend = monthly_trend(all_by_ap[ap])
        if not trend:
            continue
        model["trends"][ap] = [[t["month"], t["n"], t["rwyAcc"], t["etaOk"], t["etaBias"]] for t in trend]
        report += [f"### {ap}", "",
                   "| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |",
                   "|---|--:|--:|--:|--:|--:|--:|---|"]
        for t in trend:
            report.append(f"| {t['month']} | {t['n']:,} | {fmt(t['rwyAcc'], '%')} | {fmt(t['etaOk'], '%')} | "
                          f"{fmt(t['etaBias'], ' s')} | {fmt(t['ifr'], '%')} | {fmt(t['wind'], ' kt')} | {fmt(t['topRwy'])} |")
        d = drift(all_by_ap[ap], last_ts)
        if d:
            model["airports"].setdefault(ap, {})["drift"] = d
            parts = []
            if "rwyAcc" in d:
                parts.append(f"runway accuracy {d['rwyAcc'][0]}% → {d['rwyAcc'][1]}%")
            if "etaOk" in d:
                parts.append(f"ETA hits {d['etaOk'][0]}% → {d['etaOk'][1]}%")
            if "etaBias" in d:
                parts.append(f"median ETA error {d['etaBias'][0]:.0f} s → {d['etaBias'][1]:.0f} s")
            report += ["", f"Last 30 days vs the 30 before: {'; '.join(parts)}."
                       + (f" **Shift flagged in {', '.join(d['flags'])}** — the recency weighting and the "
                          "recent-window adoption test are what keep the model honest through it." if d["flags"] else
                          " No significant shift.")]
        report.append("")

    os.makedirs("public", exist_ok=True); os.makedirs("docs", exist_ok=True)
    json.dump(model, open("public/model.json", "w"), separators=(",", ":"))
    open("docs/model-report.md", "w").write("\n".join(report).rstrip() + "\n")
    print("\n".join(report))
    print(f"\nWrote public/model.json ({os.path.getsize('public/model.json')} bytes) and docs/model-report.md")


if __name__ == "__main__":
    main()
