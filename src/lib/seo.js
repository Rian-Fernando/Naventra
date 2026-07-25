// Central per-route metadata for the SPA. Because every route is served from the
// same index.html, we update the document title, meta description, canonical URL
// and Open Graph / Twitter tags on each client-side navigation — so every route
// presents a unique, extractable summary to crawlers and AI answer engines.

const BASE = 'https://naventra.rianfernando.com';

function set(selector, attr, value) {
  const el = document.querySelector(selector);
  if (el && value != null) el.setAttribute(attr, value);
}

/**
 * Apply per-route metadata.
 * @param {{path?: string, title: string, description: string}} meta
 */
export function applyMeta({ path = '/', title, description }) {
  const url = `${BASE}${path === '/' ? '/' : path}`;
  document.title = title;
  set('meta[name="description"]', 'content', description);
  set('link[rel="canonical"]', 'href', url);
  // Keep Open Graph + Twitter cards in step with the route.
  set('meta[property="og:title"]', 'content', title);
  set('meta[property="og:description"]', 'content', description);
  set('meta[property="og:url"]', 'content', url);
  set('meta[name="twitter:title"]', 'content', title);
  set('meta[name="twitter:description"]', 'content', description);
}
