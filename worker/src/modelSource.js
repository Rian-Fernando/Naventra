// The trained model (scripts/train_model.py → public/model.json) is retrained
// weekly by GitHub Actions and committed to the repo. The worker bundles the
// copy that existed at deploy time and refreshes it from GitHub at most once an
// hour per isolate, so a retrain takes effect without a redeploy. A failed or
// malformed download keeps the last good model.

import BUNDLED from '../../public/model.json';

const MODEL_URL = 'https://raw.githubusercontent.com/Rian-Fernando/Naventra/main/public/model.json';
const REFRESH_MS = 60 * 60 * 1000;

let current = { model: BUNDLED, source: 'bundled', checkedAt: 0 };
let inflight = null;

export function isValidModel(m) {
  return !!m && typeof m === 'object' && !Array.isArray(m)
    && !!m.airports && typeof m.airports === 'object' && Array.isArray(m.features);
}

async function refresh(ua) {
  try {
    const res = await fetch(MODEL_URL, {
      headers: { 'User-Agent': ua, Accept: 'application/json' },
      cf: { cacheTtl: 600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const m = await res.json();
    if (isValidModel(m)) current = { model: m, source: 'github', checkedAt: current.checkedAt };
  } catch { /* keep the last good model */ }
}

export async function trainedModel(ua) {
  if (Date.now() - current.checkedAt < REFRESH_MS) return current.model;
  if (!inflight) {
    current.checkedAt = Date.now();
    inflight = refresh(ua).finally(() => { inflight = null; });
  }
  await inflight;
  return current.model;
}

// What /api/health reports about the model in use.
export function modelInfo() {
  const m = current.model || {};
  const airports = m.airports || {};
  return {
    source: current.source,
    generatedAt: m.generatedAt || null,
    trainedRows: m.trainedRows ?? null,
    spanDays: m.data?.spanDays ?? null,
    etaAdopted: Object.keys(airports).filter((k) => airports[k]?.eta?.adopt),
    runwayAdopted: Object.keys(airports).filter((k) => airports[k]?.adopt),
  };
}
