#!/usr/bin/env node
/**
 * phantom-predicate.cjs — the ONE definition of "this closed row is not a trade" (#931).
 * =====================================================================================
 *
 * THE CLASS
 * ---------
 * A `trade` row with `status='closed'` but **no brokerTicket AND no exitPrice** is a
 * phantom by CONSTRUCTION: there was no fill, so there was no trade. Any query that
 * filters on `status='closed'` counts it as one — and any win-rate query counts its
 * `pnl` (usually 0) as a WIN, because 0 >= 0.
 *
 * Measured 2026-09-21 (#931): 99 of 206 rows (48%) were phantoms from bulk reconciler
 * writes. 82 were flagged by a one-off pass whose marker was a DATE WINDOW
 * ("pre-2026-09-10") — so the batch that ran ON 2026-09-10 (17 rows) escaped, and
 * USDCAD's "20 trades / 15% wins" was really "3 trades / 3 wins".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Both the repair (`quarantine-phantom-closes.cjs`) and the guard
 * (`validate-trade-phantoms.cjs`) must use the EXACT SAME predicate, or the guard
 * can pass while rows the repair targets remain. Copying the block into both files
 * was rejected by `validate-duplication.cjs` (INV-NO-NEW-DUPLICATION) — correctly:
 * a second copy is the expensive kind of debt, because both copies drift and only
 * one gets the next fix. Extract, don't copy.
 *
 * ⚠️ If you change the predicate, change it HERE and both scripts follow.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** nest/ root — one level up from nest/scripts, two from nest/scripts/lib. */
const NEST_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Loads nest/.env into process.env. Mirrors the house pattern in
 * validate-config-db-refs.cjs — Prisma does NOT auto-load .env, so scripts that
 * construct PrismaClient themselves must do this first or they cannot connect.
 */
function loadEnv() {
  const envPath = path.join(NEST_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/**
 * THE PREDICATE. Structural — deliberately no date window (that was the defect).
 *
 * ⚠️ WIDENED 2026-10-01 (#1044). It used to require `brokerTicket IS NULL`, which missed a whole
 * second shape of the same fault: a row that **has** a ticket (a real position existed) but whose
 * exit price was never captured, carrying a placeholder `pnl = 0` and NO flag. Measured then:
 * **21** such rows, still being written (the newest that morning), all invisible to
 * `pnlInvalid`-only filters — so two consumers of the same table disagreed about its size
 * (264 rows vs 243) and neither reported an error.
 *
 * The two shapes are the same thing: a close with no exit evidence. So the ticket is no longer
 * required, and instead the `pnl = 0` placeholder is made explicit — a NON-zero `pnl` with a
 * missing exit price is a real number recovered from deal history and is NOT flagged.
 *
 *   (no ticket AND no exit)  OR  (no exit AND placeholder zero)
 */
const PREDICATE =
  "status = 'closed' AND pnlInvalid = 0 AND exitPrice IS NULL AND (brokerTicket IS NULL OR pnl = 0)";

const REASON =
  'Structural phantom - closed with no exit price and no broker counterpart (#931, #1044)';

module.exports = { NEST_ROOT, loadEnv, PREDICATE, REASON };
