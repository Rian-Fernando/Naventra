# Naventra Tracker — always-on learning worker

A Cloudflare Worker that runs **24/7 on a 1-minute cron**, independent of any
browser. Each tick it polls live ADS-B (airplanes.live) and METARs for the
tracked hubs (**JFK, LAX, LHR**), runs Naventra's exact prediction + grading
engine (shared from `../src/engine/*`), grades landings against reality, and
updates a **shared self-learning model** in a free **D1** database. The frontend
reads the global scorecard from this worker, so every visitor sees the same
continuously-improving numbers.

```
scheduled()  every minute → tick each hub → lock / grade / learn / log → D1
fetch()      GET /api/scorecard?icao=KJFK   global accuracy + recent landings
             GET /api/model                  learned priors (all hubs)
             GET /api/health                  liveness + dataset size
             GET /api/dataset.jsonl[?icao=]   the training dataset (JSONL)
```

## The training dataset

Every graded landing is logged to the `samples` table as one **labeled row**: the
full lock-time feature vector (≈25 factors — approach octant/bearing, distance,
altitude, speed, aircraft type + wake category, airline, wind dir/speed/gust and
head/crosswind to the predicted runway, visibility, ceiling, flight category,
temperature, QNH, UTC + local hour, day-of-week, active runway config, inbound
count, sector traffic, arrival rate, runway sequence) **plus the observed
outcome** (actual runway, runway/config/ETA/sequence correctness, ETA error).

Pull it as JSONL for offline model training:

```bash
curl https://naventra-tracker.<subdomain>.workers.dev/api/dataset.jsonl > naventra.jsonl
```

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

- Workers: 100k requests/day. Cron = 1440/day × 3 hubs of subrequests ≈ a few
  thousand/day. Comfortable.
- D1: 5 GB storage, 5M reads + 100k writes/day. A handful of writes per tick.

## Optional: custom API domain

To serve the API from `tracker.naventra.rianfernando.com` instead of the
`workers.dev` URL, add a **proxied** (orange-cloud) CNAME for `tracker.naventra`
and a Worker route — see Cloudflare's "Add a custom domain" for Workers. The
`workers.dev` URL works fine without this.
