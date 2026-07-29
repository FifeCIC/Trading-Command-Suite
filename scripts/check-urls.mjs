#!/usr/bin/env node
/**
 * Broken Link Checker — checks all external URLs in the registry.
 *
 * Usage:
 *   node scripts/check-urls.mjs              # check all URLs
 *   node scripts/check-urls.mjs --quick      # HEAD only, no retries
 *   node scripts/check-urls.mjs --verbose    # show all results
 *
 * Exit code: 0 if all URLs respond (2xx/3xx), 1 if any are broken (4xx/5xx/timeout).
 *
 * Designed for CI and scheduled checks. Uses native fetch (Node 18+).
 */

import { getCheckableUrls } from '../src/data/external-urls.js';

const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const CONCURRENCY = 5;

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const VERBOSE = args.includes('--verbose');

const STATUS = {
  ok: { symbol: '✅', emoji: 'OK' },
  redirected: { symbol: '↪️', emoji: 'REDIRECT' },
  broken: { symbol: '❌', emoji: 'BROKEN' },
  timeout: { symbol: '⏱️', emoji: 'TIMEOUT' },
  error: { symbol: '⚠️', emoji: 'ERROR' },
};

async function checkUrl(name, url, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        method: QUICK ? 'HEAD' : 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'TCS-URL-Checker/1.0' },
        redirect: 'manual',
      });
      clearTimeout(timer);

      if (resp.ok) return { status: 'ok', code: resp.status };
      if (resp.status >= 300 && resp.status < 400) {
        return { status: 'redirected', code: resp.status, location: resp.headers.get('location') };
      }
      return { status: 'broken', code: resp.status };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        if (attempt < retries) continue;
        return { status: 'timeout' };
      }
      if (attempt < retries) continue;
      return { status: 'error', message: err.message };
    }
  }
  return { status: 'error', message: 'max retries exceeded' };
}

async function main() {
  const urls = getCheckableUrls();
  console.log(`\n🔗 TCS External URL Checker — ${urls.length} URLs to check\n`);

  const results = [];
  let checked = 0;

  // Process in batches for concurrency
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (u) => {
        const result = await checkUrl(u.name, u.url);
        checked++;
        const pct = Math.round((checked / urls.length) * 100);
        process.stdout.write(`\r  [${String(checked).padStart(3)}/${urls.length}] ${pct}% — ${u.name}`);
        return { ...u, ...result };
      })
    );
    results.push(...batchResults);
  }

  // Clear progress line
  process.stdout.write('\r' + ' '.repeat(60) + '\r');

  // Summary
  const ok = results.filter(r => r.status === 'ok').length;
  const redirected = results.filter(r => r.status === 'redirected').length;
  const broken = results.filter(r => r.status === 'broken').length;
  const timeouts = results.filter(r => r.status === 'timeout').length;
  const errors = results.filter(r => r.status === 'error').length;

  console.log(`\n📊 Results: ${ok} OK  ${redirected} Redirects  ${broken} Broken  ${timeouts} Timeouts  ${errors} Errors\n`);

  // Show broken/timeout/error
  const problems = results.filter(r => r.status !== 'ok');
  if (problems.length > 0) {
    console.log('⚠️  Issues found:\n');
    for (const p of problems) {
      const s = STATUS[p.status];
      console.log(`  ${s.symbol} [${p.category}] ${p.name}`);
      console.log(`     ${p.url}`);
      if (p.code) console.log(`     HTTP ${p.code}`);
      if (p.location) console.log(`     → ${p.location}`);
      if (p.message) console.log(`     ${p.message}`);
      console.log();
    }
  }

  // Verbose: show all OK results too
  if (VERBOSE) {
    console.log('✅ Successful URLs:\n');
    for (const r of results.filter(r => r.status === 'ok')) {
      console.log(`  ✅ [${r.category}] ${r.name} — HTTP ${r.code}`);
    }
  }

  const exitCode = broken > 0 || timeouts > 0 ? 1 : 0;
  console.log(`${exitCode === 0 ? '✅ All URLs reachable.' : '❌ Some URLs are broken.'}\n`);
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(2);
});
