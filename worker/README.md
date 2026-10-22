# Naventra Tracker — always-on learning worker

A Cloudflare Worker that runs **24/7 on a 1-minute cron**, independent of any
browser. Each tick it polls live ADS-B and METARs for the tracked hubs (**JFK,
LAX, LHR**), runs Naventra's exact prediction + grading engine (shared from
`../src/engine/*`), grades landings and departures against reality, and updates a
**shared self-learning model** in a free **D1** database. The frontend reads the
global scorecard from this worker, so every visitor sees the same
continuously-improving numbers.

ADS-B comes from adsb.lol through the site's own relay (the same path every
visitor's browser uses), then adsb.lol direct. adsb.fi deliberately blocks
Cloudflare Workers, so the worker only re-probes it every 6 hours rather than
route around the block. Requests identify themselves, stay ≥1.1 s apart per
upstream and honour `Retry-After`.

```
scheduled()  every minute → tick each hub → lock / grade / learn / log → D1
             → heartbeat → email alerts if something changed (Resend)
fetch()      GET /api/scorecard?icao=KJFK   global accuracy + recent landings
             GET /api/model                  learned priors + departure flow (all hubs)
             GET /api/health                  per-hub freshness + config, model in use,
                                              503 when a hub is stale
             GET /api/dataset.jsonl[?icao=&limit=&before=]
                                              the training dataset (JSONL, paged)
```

## The training dataset

Every graded landing is logged to the `samples` table as one **labeled row**: the
full lock-time feature vector (≈25 factors — approach octant/bearing, distance,
altitude, speed, aircraft type + wake category, airline, wind dir/speed/gust and
head/crosswind to the predicted runway, visibility, ceiling, flight category,
temperature, QNH, UTC + local hour, day-of-week, active runway config, inbound
count, sector traffic, arrival rate, runway sequence) **plus the observed
outcome** (actual runway, runway/config/ETA/sequence correctness, ETA error).

Pull it as JSONL for offline model training. A request returns up to 20,000
rows, newest first; the `X-Next-Before` response header is the cursor for the
next (older) page — pass it as `?before=` until the header is absent:

```bash
curl -D - "https://naventra-tracker.<subdomain>.workers.dev/api/dataset.jsonl?limit=20000" -o page1.jsonl
# X-Next-Before: 37691  →  ...?limit=20000&before=37691  for the next page
```

`scripts/train_model.py` walks every page automatically.

A minimal training recipe (free, offline — no keys, no API):

```python
import pandas as pd
df = pd.read_json("naventra.jsonl", lines=True)
# Runway classifier: which end did it actually land on?
X = pd.get_dummies(df[["octant","wake","head_kt","cross_kt","wind_dir","hour_local",
                       "dow","n_arr_rwy","inbound_count","seq_rwy","flt_cat","airline"]])
y = df["actual_runway"]
from sklearn.ensemble import GradientBoostingClassifier
# ... train/test split, fit, then export small weights to serve in the Worker
```

The model that comes out is served the same way the learned priors are —
pure-JS inference in the Worker and browser, still $0 and keyless.

## Email alerts (free, via Resend)

The worker emails you when something changes — never per tick:

| Email | When |
|---|---|
| **Naventra alerts are on** | once, the first minute alerts are configured (proves it works) |
| **No live data at …** | a hub has had no successful tick for 2 hours; repeats every 24 h while down |
| **Live data restored** | every hub is live again, with the outage length |
| **Model retrain hasn't run** | `public/model.json` is over 10 days old (GitHub skipped the weekly schedule); weekly |

Setup (secrets live in Cloudflare, never in the repo):

1. In Resend → **API Keys** → *Create API key*: permission **Sending access**,
   domain **rianfernando.com** (already verified there).
2. `cd worker && npx wrangler secret put RESEND_API_KEY` and paste the key.
3. `npx wrangler secret put ALERT_TO` — the address alerts go to.
4. Optional: a different sender — add `ALERT_FROM = "Name <addr@your-verified-domain>"`
   under `[vars]` in `wrangler.toml` (default `Naventra Alerts <alerts@rianfernando.com>`).

Within a minute the confirmation email arrives; `/api/health` shows `"alerts": true`.
Resend's free tier is 3,000 emails/month; this sends a handful. Each email carries
an `Idempotency-Key`, so a retried tick can't send it twice; a refused send is
retried after 30 minutes, not every minute.

**Optional self-healing retrain.** With a fine-grained GitHub token (*Repository
access*: only this repo; *Permissions*: **Actions → Read and write**, nothing else)
stored as `npx wrangler secret put GITHUB_DISPATCH_TOKEN`, a model more than 8 days
old makes the worker run the "Train model" workflow itself (at most once a day).

**Outside watchdog.** The worker can't report its own death (a bad deploy, D1 over
its limits, a stopped cron), so `.github/workflows/watchdog.yml` reads
`/api/health` from GitHub every hour and fails — which emails the repo owner — if
the worker is unreachable or hasn't ticked in 20 minutes. No secrets needed.

## The trained model updates itself

`public/model.json` is retrained weekly by GitHub Actions and committed to the
repo. The worker bundles the copy present at deploy time and refreshes it from
GitHub at most hourly, so a retrain reaches the live tracker without a redeploy.
`/api/health` → `model` shows which copy is in use (`github` or `bundled`), when it
was generated and which airports have an adopted model.

## Local development (no Cloudflare account needed)

```bash
cd worker
npm install
npm run db:init:local           # create local SQLite schema
npx wrangler dev --local        # http://localhost:8787
curl http://localhost:8787/api/tick       # run one tick against live data
curl http://localhost:8787/api/scorecard  # see accumulated results
```

Point the frontend at it: `VITE_TRACKER_URL=http://localhost:8787 npm run dev`
(from the repo root).

## Deploy (free tier)

1. **Log in:** `npx wrangler login` (opens the browser once).
2. **Create the D1 database:**
   ```bash
   npx wrangler d1 create naventra
   ```
   Copy the printed `database_id` into `wrangler.toml` (replace
   `REPLACE_WITH_D1_DATABASE_ID`).
3. **Create the tables:** `npm run db:init:remote`
   - **Already deployed an earlier version?** Instead run the migration once to add
     the feature columns + dataset table to your existing database:
     ```bash
     npx wrangler d1 execute naventra --remote --file=./migrations/002_features.sql
     ```
4. **Deploy:** `npm run deploy`
   Wrangler prints the worker URL, e.g.
   `https://naventra-tracker.<your-subdomain>.workers.dev`. The 1-minute cron
   starts automatically.
5. **Warm it up (optional):** hit `.../api/tick` a few times, or just wait — the
   cron fills the database on its own.
6. **Point the site at it:** in the Vercel project → Settings → Environment
   Variables, add `VITE_TRACKER_URL = https://naventra-tracker.<...>.workers.dev`,
   then redeploy. The scorecard flips to **GLOBAL · 24/7**.

## Free-tier headroom

- Workers: 100k requests/day. The cron is 1,440 invocations/day, each making
  ~7 subrequests (3 ADS-B, 3 METAR, at most one model check). Comfortable.
- D1: 5 GB storage, 5M rows read + 100k rows written/day. Measured Oct 2026:
  ~0.3M reads and ~20k writes/day. Departure records are refreshed at most every
  2.5 min and only for aircraft on the field, and the scorecard reads per-hub
  counters instead of scanning the samples table.

## Optional: custom API domain

To serve the API from `tracker.naventra.rianfernando.com` instead of the
`workers.dev` URL, add a **proxied** (orange-cloud) CNAME for `tracker.naventra`
and a Worker route — see Cloudflare's "Add a custom domain" for Workers. The
`workers.dev` URL works fine without this.
