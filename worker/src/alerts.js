// Email alerts for the always-on tracker, sent through Resend from the worker's
// own cron. Free (Resend's free tier is 3,000 emails/month; this sends a few),
// and it only speaks when something changes:
//
//   DOWN       a hub has had no successful tick (no live data) for 2 hours
//   RECOVERED  every hub is live again after a DOWN, with the outage length
//   STALE      the trained model is over 10 days old (weekly retrain stopped)
//   SETUP      once, when alerts first come online, so you know they work
//
// A DOWN that persists repeats once every 24 h; STALE repeats weekly. Resend's
// Idempotency-Key stops a retried tick from sending the same email twice.
//
// Configuration lives in Worker secrets, never in the repo:
//   RESEND_API_KEY   a Resend key with "Sending access" only
//   ALERT_TO         where alerts go
//   ALERT_FROM       optional; default below (a domain verified in Resend)
//   GITHUB_DISPATCH_TOKEN  optional fine-grained token (this repo, Actions:
//                    read & write) — lets a STALE model re-run the retrain itself
// Without RESEND_API_KEY and ALERT_TO, alerting is off and costs nothing.
//
// What the worker cannot report is its own death (or its database's), so a
// separate GitHub Actions watchdog checks /api/health from outside each hour.

const DEFAULT_FROM = 'Naventra Alerts <alerts@rianfernando.com>';
export const DOWN_AFTER_MS = 2 * 3600 * 1000;
export const FRESH_MS = 10 * 60 * 1000;
const REMIND_DOWN_MS = 24 * 3600 * 1000;
export const MODEL_STALE_MS = 10 * 24 * 3600 * 1000;
const REMIND_STALE_MS = 7 * 24 * 3600 * 1000;
const DISPATCH_AFTER_MS = 8 * 24 * 3600 * 1000;
const DISPATCH_EVERY_MS = 24 * 3600 * 1000;
const SEND_RETRY_MS = 30 * 60 * 1000;
const HEALTH_URL = 'https://naventra-tracker.rianfernando.workers.dev/api/health';
const TRAIN_URL = 'https://github.com/Rian-Fernando/Naventra/actions/workflows/train.yml';
const DISPATCH_API = 'https://api.github.com/repos/Rian-Fernando/Naventra/actions/workflows/train.yml/dispatches';

export const alertsConfigured = (env) => !!(env.RESEND_API_KEY && env.ALERT_TO);

const fmtTs = (ts) => (ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'never');

export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} days ${h % 24} h`;
}

function hubLines(tracked, hubs, now) {
  return tracked.map((i) => {
    const h = hubs[i] || {};
    const age = h.lastOkTs ? `last live data ${fmtDur(now - h.lastOkTs)} ago` : 'no live data recorded';
    const state = h.ok ? `live — ${h.tracked ?? '?'} aircraft via ${h.source || '?'}` : `failing (${age})${h.error ? `\n        ${h.error}` : ''}`;
    return `  ${i}  ${state}`;
  }).join('\n');
}

// Pure decision: given the latest heartbeat and the stored alert state, which
// emails are due. Each email carries the state change to keep once it is sent;
// `patch` holds changes that need no email. No I/O — unit-tested directly.
export function planAlerts({ now, tracked, hubs, modelGeneratedAt, modelSource = 'github', state }) {
  const s = state || {};
  const emails = [];
  const patch = {};
  const downHubs = tracked.filter((i) => !hubs[i]?.lastOkTs || now - hubs[i].lastOkTs > DOWN_AFTER_MS);
  const allFresh = tracked.every((i) => hubs[i]?.ok && hubs[i].lastOkTs && now - hubs[i].lastOkTs <= FRESH_MS);
  const status = hubLines(tracked, hubs, now);

  if (!s.setupTs) {
    emails.push({
      kind: 'setup',
      idem: 'naventra-setup-v1',
      subject: 'Naventra alerts are on',
      text: `This is a one-time confirmation that the Naventra tracker can email you.\n\nRight now:\n${status}\n\nModel trained: ${fmtTs(modelGeneratedAt)}\n\nYou'll hear from this address only when live data stalls for 2 hours, when it recovers, or when the weekly model retrain stops running.\n\nLive status: ${HEALTH_URL}\n`,
      patch: { setupTs: now },
    });
  }

  if (downHubs.length) {
    const since = Math.min(...downHubs.map((i) => hubs[i]?.lastOkTs || now));
    if (!s.down) {
      emails.push({
        kind: 'down',
        idem: `naventra-down-${since}`,
        subject: `Naventra: no live data at ${downHubs.join(', ')} for ${fmtDur(now - since)}`,
        text: `The always-on tracker hasn't completed a live-data tick at ${downHubs.join(', ')} since ${fmtTs(since)}.\n\n${status}\n\nNothing is made up while it's down: ticks without live data are skipped, so the scorecard and dataset simply pause.\n\nLive status: ${HEALTH_URL}\nYou'll get one email when it recovers, and a reminder every 24 h while it stays down.\n`,
        patch: { down: { since, hubs: downHubs, sentTs: now } },
      });
    } else if (now - s.down.sentTs >= REMIND_DOWN_MS) {
      emails.push({
        kind: 'down-reminder',
        idem: `naventra-still-${s.down.since}-${Math.floor(now / REMIND_DOWN_MS)}`,
        subject: `Naventra: still no live data at ${downHubs.join(', ')} (${fmtDur(now - s.down.since)})`,
        text: `Still down since ${fmtTs(s.down.since)}.\n\n${status}\n\nLive status: ${HEALTH_URL}\n`,
        patch: { down: { ...s.down, hubs: downHubs, sentTs: now } },
      });
    }
  } else if (s.down && allFresh) {
    emails.push({
      kind: 'recovered',
      idem: `naventra-recovered-${s.down.since}`,
      subject: `Naventra: live data restored (down ${fmtDur(now - s.down.since)})`,
      text: `Live data is flowing at every hub again. It had stopped at ${s.down.hubs.join(', ')} from ${fmtTs(s.down.since)} — about ${fmtDur(now - s.down.since)}.\n\n${status}\n\nLive status: ${HEALTH_URL}\n`,
      patch: { down: null },
    });
  }

  if (modelGeneratedAt && now - modelGeneratedAt > MODEL_STALE_MS) {
    if (!s.staleSentTs || now - s.staleSentTs >= REMIND_STALE_MS) {
      emails.push({
        kind: 'stale',
        idem: `naventra-stale-${modelGeneratedAt}-${Math.floor(now / REMIND_STALE_MS)}`,
        subject: `Naventra: the weekly model retrain hasn't run in ${fmtDur(now - modelGeneratedAt)}`,
        text: `public/model.json was last generated ${fmtTs(modelGeneratedAt)}. The weekly "Train model" GitHub Actions schedule has probably stopped — GitHub can skip scheduled runs without notice.\n\nTo retrain now: ${TRAIN_URL} → "Run workflow".\n\nThe tracker keeps grading live traffic meanwhile; only the offline model is getting old.\n${modelSource === 'bundled' ? '\nNote: the worker is running the copy bundled at deploy time because it could not download the latest model.json from GitHub — so the retrain may be fine and that download is what is failing.\n' : ''}`,
        patch: { staleSentTs: now },
      });
    }
  } else if (s.staleSentTs) {
    patch.staleSentTs = null;
  }

  return { emails, patch };
}

async function sendEmail(env, email, ua) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': email.idem,
      'User-Agent': ua,
    },
    body: JSON.stringify({ from: env.ALERT_FROM || DEFAULT_FROM, to: [env.ALERT_TO], subject: email.subject, text: email.text }),
    signal: AbortSignal.timeout(8000),
  });
  // 409 = this Idempotency-Key was already used: the email went out on an
  // earlier attempt, so treat it as sent rather than retrying forever.
  if (!res.ok && res.status !== 409) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

// Ask GitHub to run the retrain workflow now (only with GITHUB_DISPATCH_TOKEN).
async function dispatchRetrain(env, ua) {
  const res = await fetch(DISPATCH_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': ua,
    },
    body: JSON.stringify({ ref: 'main' }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status !== 204) throw new Error(`GitHub dispatch ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

// Run once per cron tick, after the heartbeat. Returns the new state to persist
// (or null when nothing changed).
export async function runAlerts(env, { now, tracked, hubs, modelGeneratedAt, modelSource, state, ua }) {
  const prev = state || {};
  const s = { ...prev };

  if (env.GITHUB_DISPATCH_TOKEN && modelGeneratedAt && now - modelGeneratedAt > DISPATCH_AFTER_MS
      && (!prev.dispatchTs || now - prev.dispatchTs >= DISPATCH_EVERY_MS)) {
    s.dispatchTs = now;
    try { await dispatchRetrain(env, ua); console.log('alerts: retrain dispatched (model stale)'); }
    catch (e) { console.error('alerts: retrain dispatch failed', String(e.message || e)); }
  }

  if (alertsConfigured(env) && !(prev.sendFailTs && now - prev.sendFailTs < SEND_RETRY_MS)) {
    const plan = planAlerts({ now, tracked, hubs, modelGeneratedAt, modelSource, state: s });
    Object.assign(s, plan.patch);
    for (const email of plan.emails) {
      try {
        await sendEmail(env, email, ua);
        Object.assign(s, email.patch);
        s.sendFailTs = null;
        console.log('alerts: sent', email.kind);
      } catch (e) {
        // Keep the state unchanged for this email so it is retried — in 30 min,
        // not every minute, if Resend keeps refusing (bad key, unverified domain).
        console.error('alerts: send failed', email.kind, String(e.message || e));
        s.sendFailTs = now;
        break;
      }
    }
  }

  return JSON.stringify(s) === JSON.stringify(prev) ? null : s;
}
