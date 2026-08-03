// Feedex feedback widget — runtime glue.
//
// The <script> tag is injected at build time by the Vite plugin (vite/feedex.js)
// only when a key is configured. This module attaches context to submissions via
// the window.Feedex API so reports are actionable.
//
// Everything here is best-effort and MUST NOT throw into the app: the script is
// deferred, so window.Feedex may not exist yet, and it may never load at all
// (offline, blocked, or no key configured). We wait with a bounded retry and give
// up silently.
//
// PRIVACY: a report carries only non-sensitive context — the route path, the app
// name, and the version/build. Never live traffic, aircraft, user content, or any
// key/token. Naventra has no accounts, so we deliberately do NOT call identify():
// there is no signed-in email to attach, which keeps the "no personal data" claim
// on the Privacy page true.

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

function context() {
  return {
    route: (typeof location !== 'undefined' && location.pathname) || '/',
    app: 'naventra',
    app_version: VERSION, // metadata keys ≤64 chars, values ≤512 — all well under
    build: BUILD,
  };
}

function push(fx) {
  try { fx.setMetadata(context()); } catch { /* never throw into the app */ }
}

// Bounded wait for the deferred widget (~6s), then give up silently.
function whenReady(cb, tries = 40) {
  const fx = typeof window !== 'undefined' && window.Feedex;
  if (fx && typeof fx.setMetadata === 'function') { cb(fx); return; }
  if (tries <= 0) return;
  setTimeout(() => whenReady(cb, tries - 1), 150);
}

export function initFeedex() {
  if (typeof window === 'undefined') return;
  whenReady((fx) => {
    push(fx);
    // Keep `route` fresh across this app's client-side navigation without coupling
    // to its router: refresh on popstate and wrap pushState. (Feedex also captures
    // the URL automatically at submission, so this is belt-and-suspenders.)
    try {
      const update = () => push(fx);
      window.addEventListener('popstate', update);
      const orig = window.history.pushState;
      window.history.pushState = function (...args) {
        const r = orig.apply(this, args);
        update();
        return r;
      };
    } catch { /* history unavailable — the initial push already ran */ }
  });
}
