// Email alerts for the always-on tracker, sent through Resend from the worker's
// own cron. Free (Resend's free tier is 3,000 emails/month; this sends a few),
// and it only speaks when something changes:
//
//   SETUP       once, when alerts first come online, so you know they work
//   DOWN        a hub hasn't completed a tick for 2 hours (no live data, or the
//               database refusing writes); repeats every 24 h while it lasts
//   RECOVERED   every hub is updating again after a DOWN, with the outage length
//   DATABASE    D1 refused this minute's writes (e.g. the free daily limit) —
//               immediately, at most once per UTC day
//   STALE MODEL the trained model is over 10 days old (weekly retrain stopped);
//               repeats weekly
//
// Every email comes from "<Project> Alerts <project-alerts@rianfernando.com>"
// with the subject "[<Project>] STATUS — detail", a format shared across
// projects so inbox filters can sort them (one sender address per project).
// Resend's Idempotency-Key stops a retried tick from sending an email twice.
//
// Configuration lives in Worker secrets, never in the repo:
//   RESEND_API_KEY   a Resend key with "Sending access" only (named
//                    "naventra-alerts" in Resend, to match the sender)
//   ALERT_TO         where alerts go
//   ALERT_FROM       optional override of the sender below (any address on a
//                    domain verified in Resend)
//   GITHUB_DISPATCH_TOKEN  optional fine-grained token (this repo, Actions:
//                    read & write) — lets a STALE model re-run the retrain itself
// Without RESEND_API_KEY and ALERT_TO, alerting is off and costs nothing.
//
// What the worker cannot report is its own death, so a separate GitHub Actions
// watchdog checks /api/health from outside (GitHub runs it every few hours).

const PROJECT = 'Naventra';
const DEFAULT_FROM = `${PROJECT} Alerts <${PROJECT.toLowerCase()}-alerts@rianfernando.com>`;
const subject = (status, detail) => `[${PROJECT}] ${status} — ${detail}`;
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
export function planAlerts({ now, tracked, hubs, prevHubs = null, modelGeneratedAt, modelSource = 'github', state }) {
  const s = state || {};
  const emails = [];
  const patch = {};
  const downHubs = tracked.filter((i) => !hubs[i]?.lastOkTs || now - hubs[i].lastOkTs > DOWN_AFTER_MS);
  const allFresh = tracked.every((i) => hubs[i]?.ok && hubs[i].lastOkTs && now - hubs[i].lastOkTs <= FRESH_MS);
  const status = hubLines(tracked, hubs, now);

  if (!s.setupTs) {
    emails.push({
      kind: 'setup',
      idem: 'naventra-setup-v2',
      subject: subject('ALERTS ON', 'this is what a Naventra alert looks like'),
      text: `This is a one-time confirmation that the Naventra tracker can email you.\n\nRight now:\n${status}\n\nModel trained: ${fmtTs(modelGeneratedAt)}\n\nYou'll hear from this address only when something changes: a hub stops updating for 2 hours (DOWN, then RECOVERED), the database refuses writes (DATABASE), or the weekly retrain stops running (STALE MODEL). Every alert comes from naventra-alerts@rianfernando.com with a subject starting [Naventra], so one inbox filter on that sender catches them all.\n\nLive status: ${HEALTH_URL}\n`,
      patch: { setupTs: now },
    });
  }

  if (downHubs.length) {
    const since = Math.min(...downHubs.map((i) => hubs[i]?.lastOkTs || now));
    if (!s.down) {
      emails.push({
        kind: 'down',
        idem: `naventra-down-${since}`,
        subject: subject('DOWN', `${downHubs.join(', ')} not updating for ${fmtDur(now - since)}`),
        text: `The always-on tracker hasn't completed a tick at ${downHubs.join(', ')} since ${fmtTs(since)}. The last error for each hub is below — usually the live ADS-B feed, sometimes the database.\n\n${status}\n\nNothing is made up while it's down: ticks that fail are skipped, so the scorecard and dataset simply pause.\n\nLive status: ${HEALTH_URL}\nYou'll get one email when it recovers, and a reminder every 24 h while it stays down.\n`,
        patch: { down: { since, hubs: downHubs, sentTs: now } },
      });
    } else if (now - s.down.sentTs >= REMIND_DOWN_MS) {
      emails.push({
        kind: 'down-reminder',
        idem: `naventra-still-${s.down.since}-${Math.floor(now / REMIND_DOWN_MS)}`,
        subject: subject('STILL DOWN', `${downHubs.join(', ')} not updating for ${fmtDur(now - s.down.since)}`),
        text: `Still down since ${fmtTs(s.down.since)}.\n\n${status}\n\nLive status: ${HEALTH_URL}\n`,
        patch: { down: { ...s.down, hubs: downHubs, sentTs: now } },
      });
    }
  } else if (allFresh) {
    // Normally the outage is in the saved alert state. If the database was the
    // thing that failed, that state never got saved — so also read the outage
    // off the previous heartbeat (hubs whose last good tick was >2 h before
    // this one), or the DOWN email would never get its RECOVERED.
    let down = s.down;
    if (!down && prevHubs) {
      const was = tracked.filter((i) => prevHubs[i]?.lastOkTs && now - prevHubs[i].lastOkTs > DOWN_AFTER_MS);
      if (was.length) down = { since: Math.min(...was.map((i) => prevHubs[i].lastOkTs)), hubs: was };
    }
    if (down) {
      emails.push({
        kind: 'recovered',
        idem: `naventra-recovered-${down.since}`,
        subject: subject('RECOVERED', `all hubs updating again (down ${fmtDur(now - down.since)})`),
        text: `Every hub is completing ticks with live data again. It had stopped at ${down.hubs.join(', ')} from ${fmtTs(down.since)} — about ${fmtDur(now - down.since)}.\n\n${status}\n\nLive status: ${HEALTH_URL}\n`,
        patch: { down: null },
      });
    }
  }

  if (modelGeneratedAt && now - modelGeneratedAt > MODEL_STALE_MS) {
    if (!s.staleSentTs || now - s.staleSentTs >= REMIND_STALE_MS) {
      emails.push({
        kind: 'stale',
        idem: `naventra-stale-${modelGeneratedAt}-${Math.floor(now / REMIND_STALE_MS)}`,
        subject: subject('STALE MODEL', `the weekly retrain hasn't run in ${fmtDur(now - modelGeneratedAt)}`),
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

// The database refused this tick's writes. A quota/limit error is never
// transient, so it alerts at once; anything else only after it has failed five
// ticks running in this isolate (D1 has the odd network blip). One email per
// UTC day at most — the key changes daily, and Resend drops repeats of a key.
let dbFailStreak = 0;
const DB_LIMIT = /limit|exceeded|quota/i;

export function planDatabaseAlert(message, now, streak) {
  if (!DB_LIMIT.test(message) && streak < 5) return null;
  const day = new Date(now).toISOString().slice(0, 10);
  const limit = DB_LIMIT.test(message);
  return {
    kind: 'database',
    idem: `naventra-db-${day}`,
    subject: subject('DATABASE', limit ? 'D1 refused writes (free daily limit reached)' : 'D1 errors for 5+ minutes'),
    text: `The tracker's database (Cloudflare D1) is refusing this minute's work:\n\n  ${message.slice(0, 400)}\n\n`
      + (limit
        ? "That's the free tier's daily limit, shared by every D1 database on the Cloudflare account. It resets at midnight UTC; until then the tracker can't save grades, so it pauses (nothing is invented and the website stays up). Check today's usage with: cd worker && npx wrangler d1 info naventra — and whether another project's database is using the same account's allowance.\n"
        : 'Usually a passing Cloudflare issue; if it persists, check https://www.cloudflarestatus.com and the worker logs (npx wrangler tail naventra-tracker).\n')
      + `\nLive status: ${HEALTH_URL}\n`,
  };
}

export async function alertDatabase(env, message, ua, now = Date.now()) {
  dbFailStreak += 1;
  if (!alertsConfigured(env)) return false;
  const email = planDatabaseAlert(message, now, dbFailStreak);
  if (!email) return false;
  await sendEmail(env, email, ua);
  return true;
}

export function resetDatabaseStreak() { dbFailStreak = 0; }

// Run once per cron tick, after the heartbeat. Returns the new state to persist
// (or null when nothing changed).
export async function runAlerts(env, { now, tracked, hubs, prevHubs, modelGeneratedAt, modelSource, state, ua }) {
  const prev = state || {};
  const s = { ...prev };

  if (env.GITHUB_DISPATCH_TOKEN && modelGeneratedAt && now - modelGeneratedAt > DISPATCH_AFTER_MS
      && (!prev.dispatchTs || now - prev.dispatchTs >= DISPATCH_EVERY_MS)) {
    s.dispatchTs = now;
    try { await dispatchRetrain(env, ua); console.log('alerts: retrain dispatched (model stale)'); }
    catch (e) { console.error('alerts: retrain dispatch failed', String(e.message || e)); }
  }

  if (alertsConfigured(env) && !(prev.sendFailTs && now - prev.sendFailTs < SEND_RETRY_MS)) {
    const plan = planAlerts({ now, tracked, hubs, prevHubs, modelGeneratedAt, modelSource, state: s });
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
