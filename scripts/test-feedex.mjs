// Tests for the Feedex build-time injection (vite/feedex.js).
//   node scripts/test-feedex.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolveFeedexKey, feedexTagAttrs } from '../vite/feedex.js';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name} — ${e.message}`); fail++; }
};

// --- key resolution: no key → nothing injected -----------------------------
check('no key configured → null (nothing injected)', () => assert.strictEqual(resolveFeedexKey({}), null));
check('empty / whitespace key → null', () => assert.strictEqual(resolveFeedexKey({ VITE_FEEDEX_KEY: '   ' }), null));
check('undefined env → null (never throws)', () => assert.strictEqual(resolveFeedexKey(undefined), null));

// --- the env-var trap: both names resolve, VITE_ preferred -----------------
check('VITE_FEEDEX_KEY resolves', () => assert.strictEqual(resolveFeedexKey({ VITE_FEEDEX_KEY: 'pk_fdx_vite' }), 'pk_fdx_vite'));
check('NEXT_PUBLIC_FEEDEX_KEY resolves (Vercel / Feedex docs name)', () => assert.strictEqual(resolveFeedexKey({ NEXT_PUBLIC_FEEDEX_KEY: 'pk_fdx_next' }), 'pk_fdx_next'));
check('VITE_ preferred over NEXT_PUBLIC_', () => assert.strictEqual(
  resolveFeedexKey({ VITE_FEEDEX_KEY: 'pk_fdx_vite', NEXT_PUBLIC_FEEDEX_KEY: 'pk_fdx_next' }), 'pk_fdx_vite'));
check('key is trimmed', () => assert.strictEqual(resolveFeedexKey({ VITE_FEEDEX_KEY: '  pk_fdx_x  ' }), 'pk_fdx_x'));

// --- key present → correct tag ---------------------------------------------
const attrs = feedexTagAttrs('pk_fdx_abc');
check('tag src is the hosted widget', () => assert.strictEqual(attrs.src, 'https://feedex.rianfernando.com/widget.js'));
check('tag carries the resolved key', () => assert.strictEqual(attrs['data-feedex-key'], 'pk_fdx_abc'));
check('tag is deferred (off the critical path)', () => assert.strictEqual(attrs.defer, true));

// --- brand match, not the Feedex default -----------------------------------
check('accent is Naventra cyan (--cyan), not default purple #B58BF9', () => {
  assert.strictEqual(attrs['data-feedex-accent'], '#4cc9f0');
  assert.notStrictEqual(attrs['data-feedex-accent'].toLowerCase(), '#b58bf9');
});
check('theme matches the dark-only app', () => assert.strictEqual(attrs['data-feedex-theme'], 'dark'));
check('appearance pinned on the tag (no remote-config restyle flash)', () => assert.strictEqual(attrs['data-feedex-no-remote-config'], 'true'));

// --- position asserted against the collision it must clear -----------------
// The launcher is viewport-fixed with a huge z-index, so it paints over whatever
// shares its corner. The one bottom-corner element on first paint is the landing
// hero's scroll hint (.lp-scroll-hint). We read its ACTUAL rule and require the
// launcher to sit in the opposite bottom corner — so if someone later moves the
// scroll hint, this test fails instead of the overlap silently returning.
const landing = readFileSync(new URL('../src/styles/landing.css', import.meta.url), 'utf8');
const hintRule = (landing.match(/\.lp-scroll-hint\s*\{[^}]*\}/) || [])[0] || '';
const hintCorner = /left\s*:/.test(hintRule) ? 'bottom-left'
  : /right\s*:/.test(hintRule) ? 'bottom-right' : 'unknown';
check('.lp-scroll-hint still exists and is horizontally anchored', () => {
  assert.ok(hintRule, '.lp-scroll-hint rule not found in landing.css');
  assert.notStrictEqual(hintCorner, 'unknown', 'scroll hint has no left/right anchor');
});
check('launcher sits in the opposite bottom corner from the scroll hint', () => {
  assert.strictEqual(hintCorner, 'bottom-left', `scroll hint moved to ${hintCorner} — re-choose the launcher corner`);
  assert.strictEqual(attrs['data-feedex-position'], 'bottom-right');
});
check('position is a value Feedex supports (bottom-left|bottom-right)', () =>
  assert.ok(['bottom-left', 'bottom-right'].includes(attrs['data-feedex-position'])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
