import { loadEnv } from 'vite';

// Feedex feedback widget — build-time injection.
//
// The widget is one <script> tag (https://feedex.rianfernando.com/docs/quickstart).
// We inject it from Vite's transformIndexHtml so the publishable key never has to
// be hardcoded in index.html or committed to source, and so it can be switched on
// or off purely via an env var. If no key is configured we inject NOTHING — that
// keeps local dev from posting into the real feedback inbox — and warn on the
// console so it is never a silent no-op.

const WIDGET_SRC = 'https://feedex.rianfernando.com/widget.js';

// The env-var trap: Vite only exposes VITE_-prefixed vars to *client* code, so
// `import.meta.env.NEXT_PUBLIC_FEEDEX_KEY` would be undefined and the widget would
// silently never appear. This resolver runs in Node during the build, where every
// variable is visible regardless of prefix, so it accepts both names — preferring
// the VITE_ one — matching whatever is set in Vercel (NEXT_PUBLIC_…) or locally.
export function resolveFeedexKey(env) {
  const key = (env?.VITE_FEEDEX_KEY || env?.NEXT_PUBLIC_FEEDEX_KEY || '').trim();
  return key || null;
}

// Appearance is pinned on the tag itself (not left to dashboard remote config) so
// the launcher matches Naventra's brand on first paint with no restyle flash:
//  - accent  #4cc9f0  — the project's cyan interactive accent (--cyan), not the
//                       Feedex default purple (#B58BF9).
//  - theme   dark      — the console/landing are dark-only.
//  - position bottom-right — the free corner: the landing hero's scroll hint sits
//                       bottom-left (.lp-scroll-hint), and nothing viewport-fixed
//                       occupies bottom-right. (Only bottom-left/right are allowed.)
// data-feedex-no-remote-config keeps the dashboard from restyling after load, which
// is what would otherwise cause the first-paint flash.
export function feedexTagAttrs(key) {
  return {
    src: WIDGET_SRC,
    'data-feedex-key': key,
    'data-feedex-position': 'bottom-right',
    'data-feedex-accent': '#4cc9f0',
    'data-feedex-theme': 'dark',
    'data-feedex-icon': 'chat',
    'data-feedex-label': 'Feedback',
    'data-feedex-title': 'Send feedback',
    'data-feedex-description': 'Found a bug or have an idea for Naventra? Let us know.',
    'data-feedex-no-remote-config': 'true',
    defer: true,
  };
}

// Vite plugin: inject the tag at build time when (and only when) a key is set.
export function feedexPlugin(mode) {
  return {
    name: 'feedex-widget',
    transformIndexHtml() {
      const env = loadEnv(mode, process.cwd(), ''); // '' → all vars, any prefix
      const key = resolveFeedexKey(env);
      if (!key) {
        console.warn('[feedex] No key set (VITE_FEEDEX_KEY or NEXT_PUBLIC_FEEDEX_KEY) — feedback widget NOT injected.');
        return [];
      }
      if (!key.startsWith('pk_fdx_')) {
        console.warn('[feedex] Key does not look like a publishable key (expected "pk_fdx_…"); injecting anyway.');
      }
      return [{ tag: 'script', attrs: feedexTagAttrs(key), injectTo: 'body' }];
    },
  };
}
