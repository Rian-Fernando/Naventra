#!/usr/bin/env python3
"""Rigorous effectiveness/reliability eval of the LIVE touchdown-ETA correction.

Every post-integration landing carries the RAW engine error (eta_err_sec, vs the
uncorrected prediction), the served prediction (pred_eta_ts) and the actual
touchdown (land_ts). So for the *exact same flights* we can reconstruct both
errors to the second — raw vs corrected — and compare the two systems head to
head, isolating the model's effect from traffic/weather variance: per airport,
over time, how big the correction is, and where it helped vs hurt.

    python3 scripts/eval_eta.py [dataset.jsonl]   (default: fetch from tracker)
"""
import json, sys, os, urllib.request, datetime
from statistics import mean, median
from collections import defaultdict

INTEGRATION_MS = datetime.datetime(2026, 7, 24, 1, 40, tzinfo=datetime.timezone.utc).timestamp() * 1000
OK_S, VOID_S = 150, 1800  # ±2.5 min hit window; >30 min off raw = voided go-around/divert
CLAMP_LO, CLAMP_HI = -600, 900  # correction clamp in etaModel.js


def load(path):
    if path and os.path.exists(path):
        return [json.loads(l) for l in open(path) if l.strip()]
    req = urllib.request.Request("https://naventra-tracker.rianfernando.workers.dev/api/dataset.jsonl?limit=200000",
                                 headers={"User-Agent": "naventra-eval/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return [json.loads(l) for l in r.read().decode().splitlines() if l.strip()]


def prep(r):
    """Attach raw & corrected error in seconds and the applied correction."""
    r["raw_err"] = r["eta_err_sec"]
    r["corr_err"] = (r["land_ts"] - r["pred_eta_ts"]) / 1000
    r["applied"] = r["raw_err"] - r["corr_err"]
    return r


def band(rs):
    raw = [abs(r["raw_err"]) for r in rs]
    cor = [abs(r["corr_err"]) for r in rs]
    r_ok = sum(1 for r in rs if abs(r["raw_err"]) <= OK_S)
    c_ok = sum(1 for r in rs if abs(r["corr_err"]) <= OK_S)
    helped = sum(1 for r in rs if abs(r["raw_err"]) > OK_S and abs(r["corr_err"]) <= OK_S)
    hurt = sum(1 for r in rs if abs(r["raw_err"]) <= OK_S and abs(r["corr_err"]) > OK_S)
    n = len(rs)
    return dict(n=n, r_ok=r_ok, c_ok=c_ok, r_mae=mean(raw), c_mae=mean(cor),
                r_med=median(raw), c_med=median(cor), helped=helped, hurt=hurt)


def line(ap, b):
    return (f"{ap:6}{b['n']:>7}{100*b['r_ok']/b['n']:>8.1f}%{100*b['c_ok']/b['n']:>9.1f}%"
            f"{100*(b['c_ok']-b['r_ok'])/b['n']:>+7.1f}{b['r_mae']:>9.0f}s{b['c_mae']:>8.0f}s"
            f"{b['helped']:>8}{b['hurt']:>6}")


def main():
    rows = load(sys.argv[1] if len(sys.argv) > 1 else None)
    post = [prep(r) for r in rows if r["ts"] >= INTEGRATION_MS
            and r.get("eta_err_sec") is not None and r.get("land_ts") and r.get("pred_eta_ts")]
    gradeable = [r for r in post if abs(r["raw_err"]) <= VOID_S]
    voided = [r for r in post if abs(r["raw_err"]) > VOID_S]

    print(f"Post-integration landings: {len(post):,}  "
          f"({len(gradeable):,} gradeable, {len(voided):,} go-arounds voided by the grader)\n")

    # 1. Is the correction actually firing / sane? (applied = raw_err - corr_err)
    ap_all = [r["applied"] for r in gradeable]
    clamp = sum(1 for a in ap_all if a <= CLAMP_LO + 1 or a >= CLAMP_HI - 1)
    print("Correction engine — is it firing sanely?")
    print(f"  applied correction: median {median(ap_all):+.0f}s  mean {mean(ap_all):+.0f}s  "
          f"range [{min(ap_all):+.0f}, {max(ap_all):+.0f}]s  at-clamp {100*clamp/len(ap_all):.1f}%\n")

    # 2. Head to head on identical flights: accuracy (±2.5min) AND error magnitude.
    print("Same flights, two systems — RAW engine vs served MODEL:")
    print(f"{'AP':6}{'n':>7}{'raw ok':>9}{'model ok':>9}{'lift':>7}{'raw MAE':>10}{'mdl MAE':>9}{'helped':>8}{'hurt':>6}")
    byap = defaultdict(list)
    for r in gradeable:
        byap[r["icao"]].append(r)
    for ap in sorted(byap):
        print(line(ap, band(byap[ap])))
    tot = band(gradeable)
    print(line("ALL", tot))

    # 3. Consistency over time (6h buckets since integration).
    print("\nConsistency over time (6h buckets):")
    print(f"{'bucket':>10}{'n':>7}{'raw ok':>9}{'model ok':>9}{'lift':>7}{'mdl MAE':>10}")
    b = defaultdict(list)
    for r in gradeable:
        b[int((r["ts"] - INTEGRATION_MS) // (6 * 3600 * 1000))].append(r)
    for k in sorted(b):
        x = band(b[k])
        print(f"{f'{k*6}-{k*6+6}h':>10}{x['n']:>7}{100*x['r_ok']/x['n']:>8.1f}%"
              f"{100*x['c_ok']/x['n']:>8.1f}%{100*(x['c_ok']-x['r_ok'])/x['n']:>+7.1f}{x['c_mae']:>8.0f}s")

    # 4. Verdict.
    lift = 100 * (tot["c_ok"] - tot["r_ok"]) / tot["n"]
    mae_cut = 100 * (tot["r_mae"] - tot["c_mae"]) / tot["r_mae"]
    reliable = lift > 5 and tot["helped"] > tot["hurt"] * 2 and tot["c_mae"] < tot["r_mae"]
    print(f"\nVERDICT: on {tot['n']:,} identical flights the model hits ±2.5min {100*tot['c_ok']/tot['n']:.1f}% "
          f"vs raw {100*tot['r_ok']/tot['n']:.1f}% ({lift:+.1f} pts) and cuts mean error "
          f"{tot['r_mae']:.0f}s → {tot['c_mae']:.0f}s ({mae_cut:.0f}% lower). "
          f"Fixed {tot['helped']:,} misses, broke {tot['hurt']:,} (net {tot['helped']-tot['hurt']:+,}); "
          f"{len(voided):,} go-arounds voided. "
          f"{'CONSISTENT NET GAIN — reliable.' if reliable else 'MARGINAL — keep watching.'}")


if __name__ == "__main__":
    main()
