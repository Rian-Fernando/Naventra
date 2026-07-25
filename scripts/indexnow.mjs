#!/usr/bin/env node
// IndexNow instant-indexing ping. Reads THIS site's own sitemap, extracts every
// URL, and submits them in one batch to IndexNow — so Bing and other participating
// engines (which back AI answer engines like ChatGPT Search and Copilot) re-index
// changes immediately instead of waiting for an organic crawl.
//
//   npm run indexnow
//
// IndexNow is per-site: the key and every submitted URL must live on this exact
// host, and the key must match the file hosted at KEY_LOCATION. As a safety guard
// the script refuses to submit any URL that is not on HOST — never rianfernando.com
// or another subdomain.

const HOST = 'naventra.rianfernando.com';
const KEY = '67565f44977816793a898c9e43a147ae';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITEMAP = `https://${HOST}/sitemap.xml`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';

async function main() {
  const res = await fetch(SITEMAP, { headers: { 'User-Agent': 'naventra-indexnow/1.0' } });
  if (!res.ok) throw new Error(`Could not fetch sitemap (HTTP ${res.status}) at ${SITEMAP}`);
  const xml = await res.text();

  const found = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].trim());
  const urlList = [...new Set(found)].filter((u) => {
    try { return new URL(u).host === HOST; } catch { return false; }
  });

  if (!urlList.length) throw new Error(`No URLs on ${HOST} found in the sitemap.`);
  const skipped = found.length - urlList.length;
  console.log(`Submitting ${urlList.length} URL(s) from ${SITEMAP}` +
    (skipped ? ` (skipped ${skipped} off-host)` : '') + ':');
  urlList.forEach((u) => console.log('  ' + u));

  const post = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
  });
  const detail = await post.text().catch(() => '');

  // IndexNow returns 200 (accepted) or 202 (accepted, key validation pending).
  if (post.status === 200 || post.status === 202) {
    console.log(`\nIndexNow accepted: HTTP ${post.status}. Changed URLs will be crawled shortly.`);
  } else {
    throw new Error(`IndexNow rejected: HTTP ${post.status} ${detail}`.trim());
  }
}

main().catch((e) => { console.error('IndexNow failed:', e.message); process.exit(1); });
