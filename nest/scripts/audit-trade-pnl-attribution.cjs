/**
 * audit-trade-pnl-attribution.cjs — is a position's realised P&L attributed to the rows that own it?
 *
 * ── WHAT THIS DETECTS (#1014) ───────────────────────────────────────────────────────────────
 *
 * The account is NETTING, so every order on a symbol merges into ONE broker position, while our book
 * writes ONE `trade` row per order. N rows therefore carry the same `brokerTicket`, and each of them
 * resolves to the SAME closing deals.
 *
 * Before the volume split, the reconciler booked the position's **ENTIRE net** to whichever row it
 * was reconciling. It did that once per row, so a 4-order scale-in put **4× the real P&L** in the
 * ledger, with plausible numbers and no error anywhere.
 *
 * ⚠️ THE SIGNATURE IS IDENTICAL VALUES, NOT A LARGE ONE. Every row over the same position runs the
 * same `reduce` over the same deals, so the overstatement shows up as N rows carrying the **same**
 * non-zero `pnl` — which looks like a perfectly reasonable result. A correct volume split gives rows
 * in **different** proportions (`0.01/0.04` each, say), so equality is the tell.
 *
 * ── WHY A DETECTOR RATHER THAN A GUARD ──────────────────────────────────────────────────────
 *
 * The split is guarded at the arithmetic level by `pnl-split.spec.ts` (18 cases). What no unit test
 * can see is the DATA: whether a given book currently holds a multi-row position whose rows sum to
 * more than the position earned. That is a query, and it is why this exists.
 *
 * ⚠️ IT READS THE `trade` TABLE ONLY. It does not call the broker, so it runs with the bridges down.
 *
 * ── WHAT IT CANNOT SEE — stated, not implied ────────────────────────────────────────────────
 *
 * A row that booked the whole net for a position whose OTHER rows were later swept/closed
 * differently, or a position whose other rows live in a different `provider`. Grouping is by
 * `(provider, brokerTicket)`, and the audit says so rather than implying global coverage.
 *
 * ⚠️ MEASURED LIMIT (2026-10-07, #1080): a pile whose sibling rows carry ORDER tickets forms NO
 * group here — grouping is by ticket, so the ×1.9 overstatement on the 2026-09-30 A/B pile (ten
 * rows summing −613.07 for a −322.67 position) was invisible to this report. It was found by
 * summing rows in a `closedAt` group instead. Grouping by the RESOLVED positionId needs deal
 * history; that is deliberate future work, not an oversight.
 *
 * Usage:
 *   node nest/scripts/audit-trade-pnl-attribution.cjs               # report
 *   node nest/scripts/audit-trade-pnl-attribution.cjs --self-test   # prove the detector can fail
 */

const { runCases } = require('../../scripts/lib/validator-helpers.cjs');

/** A trade row, reduced to what attribution depends on. */
const shape = (r) => ({
  id: String(r.id),
  provider: String(r.provider),
  brokerTicket: r.brokerTicket == null ? null : String(r.brokerTicket),
  symbol: r.symbol == null ? null : String(r.symbol),
  quantity: r.quantity == null ? null : Number(r.quantity),
  pnl: r.pnl == null ? null : Number(r.pnl),
  status: String(r.status ?? ''),
  pnlInvalid: Number(r.pnlInvalid ?? 0),
});

/**
 * groupByPosition() — rows sharing one position id, keyed on `(provider, brokerTicket)`.
 *
 * ⚠️ Grouped on the PAIR, not on the ticket alone. Two brokers can issue the same numeric ticket,
 * and merging them would invent a multi-row position that does not exist — a false positive in the
 * audit whose obvious repair is to trust it less. Rows with no ticket are dropped: the symbol
 * fallback path identifies ONE lifecycle by construction, so there is no group to compare.
 */
function groupByPosition(rows) {
  const groups = new Map();
  for (const raw of rows) {
    const r = shape(raw);
    if (!r.brokerTicket) continue;
    const key = `${r.provider}\u0000${r.brokerTicket}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].map(([key, members]) => ({ key, members }));
}

/**
 * detectOverstatement() — the finding, per group.
 *
 * Two distinct defects, kept separate because they need different repairs:
 *
 *   `identical-pnl`  — N rows carry the SAME non-zero pnl. This is the whole-net-booking signature:
 *                      the split did not run, or ran with `rowsSharing <= 1`.
 *   `pnl-invalid`    — a row closed with no computable result. Expected on the rows #1014 was
 *                      opened for, and reported so a reader can tell "not yet reconciled" from
 *                      "attributed wrongly" — the two look the same in a total.
 *
 * ⚠️ A group where every pnl is null is NOT `identical-pnl`: `null === null` is true in JS, and
 * testing it naively reports every unreconciled position as an overstatement. Null is the absence
 * of a number, not a shared number, and the guard distinguishes them explicitly.
 */
function detectOverstatement(group) {
  const { key, members } = group;
  const findings = [];

  if (members.length > 1) {
    const known = members.filter((m) => m.pnl != null);
    const values = known.map((m) => m.pnl);
    const allSame = values.length > 1 && values.every((v) => v === values[0]);
    if (allSame && values[0] !== 0) {
      findings.push({
        kind: 'identical-pnl',
        key,
        symbol: members[0].symbol,
        rows: members.length,
        pnl: values[0],
        // What the position ACTUALLY earned, if the rows over-booked it. A correct split sums to
        // the position; an overstated one sums to `pnl × rows`.
        bookedTotal: values.reduce((s, v) => s + v, 0),
      });
    }
  }

  const invalid = members.filter((m) => m.pnlInvalid === 1);
  if (invalid.length) {
    findings.push({
      kind: 'pnl-invalid',
      key,
      symbol: members[0].symbol,
      rows: invalid.length,
      ofRows: members.length,
    });
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────── self-test ──
if (process.argv.includes('--self-test')) {
  const cases = [];
  const t = (name, fn) => cases.push([name, fn]);

  const row = (over) => ({
    id: 't1', provider: 'mt5', brokerTicket: '152690675067', symbol: 'XAUUSD',
    quantity: 0.01, pnl: null, status: 'closed', pnlInvalid: 0, ...over,
  });

  t('four rows with the SAME non-zero pnl are an overstatement (the #1014 signature)', () =>
    detectOverstatement(groupByPosition([
      row({ id: 't1', pnl: 39.15 }), row({ id: 't2', pnl: 39.15 }),
      row({ id: 't3', pnl: 39.15 }), row({ id: 't4', pnl: 39.15 }),
    ]).find((g) => g.members.length === 4))
      .some((f) => f.kind === 'identical-pnl' && f.bookedTotal === 156.6));

  t('a correct split with UNEQUAL quantities is NOT flagged', () =>
    detectOverstatement(groupByPosition([
      row({ id: 't1', quantity: 0.01, pnl: 10 }),
      row({ id: 't2', quantity: 0.03, pnl: 30 }),
    ]).find((g) => g.members.length === 2))
      .every((f) => f.kind !== 'identical-pnl'));

  t('KNOWN LIMIT — four EQUAL fills split correctly produce equal pnl, so they ARE flagged', () =>
    // ⚠️ A value-only detector cannot tell "four equal shares" from "four rows each booking the
    // whole net" when the quantities are identical, because the numbers coincide. Asserted here so
    // the limit is VISIBLE and the finding is read as "look at this position", never as proof.
    detectOverstatement(groupByPosition([
      row({ id: 't1', quantity: 0.01, pnl: 10 }), row({ id: 't2', quantity: 0.01, pnl: 10 }),
      row({ id: 't3', quantity: 0.01, pnl: 10 }), row({ id: 't4', quantity: 0.01, pnl: 10 }),
    ]).find((g) => g.members.length === 4))
      .some((f) => f.kind === 'identical-pnl'));

  t('the detector is NOT a stub returning [] — it fires on the signature it exists for', () =>
    detectOverstatement({
      key: 'mt5\u0000152690675067',
      members: [
        shape(row({ id: 't1', pnl: 40 })), shape(row({ id: 't2', pnl: 40 })),
      ],
    }).length > 0);

  t('a single row owning the position is NEVER flagged (the sole-owner case must stay silent)', () =>
    detectOverstatement(groupByPosition([row({ pnl: 39.15 })]).find((g) => g.members.length === 1))
      .length === 0);

  t('rows with all-NULL pnl are not an identical-pnl finding (null is not a shared number)', () =>
    detectOverstatement(groupByPosition([
      row({ id: 't1', pnl: null }), row({ id: 't2', pnl: null }),
    ]).find((g) => g.members.length === 2))
      .every((f) => f.kind !== 'identical-pnl'));

  t('rows all at ZERO pnl are not flagged (zero is not an overstatement)', () =>
    detectOverstatement(groupByPosition([
      row({ id: 't1', pnl: 0 }), row({ id: 't2', pnl: 0 }),
    ]).find((g) => g.members.length === 2))
      .every((f) => f.kind !== 'identical-pnl'));

  t('grouping is by (provider, ticket) — the same ticket at two brokers does NOT merge', () =>
    groupByPosition([
      row({ id: 'a', provider: 'mt5', brokerTicket: '777' }),
      row({ id: 'b', provider: 'other', brokerTicket: '777' }),
    ]).every((g) => g.members.length === 1));

  t('rows with NO ticket are dropped — there is no position to compare against', () =>
    groupByPosition([row({ brokerTicket: null }), row({ id: 't2', brokerTicket: null })]).length === 0);

  t('a row closed with no computable result IS reported, as its own kind', () =>
    detectOverstatement(groupByPosition([
      row({ id: 't1', pnlInvalid: 1, pnl: null }), row({ id: 't2', pnlInvalid: 1, pnl: null }),
    ]).find((g) => g.members.length === 2))
      .some((f) => f.kind === 'pnl-invalid' && f.rows === 2));

  t('a numeric ticket and its string form group TOGETHER (Prisma returns one, the DB the other)', () =>
    groupByPosition([
      row({ id: 'a', brokerTicket: 152690675067 }),
      row({ id: 'b', brokerTicket: '152690675067' }),
    ]).find((g) => g.members.length === 2) !== undefined);

  // ⚠️ There is deliberately NO "this case must fail" entry here. A case that fails on purpose makes
  // the whole suite fail, which is indistinguishable from a broken detector — the opposite of what a
  // false-pass probe is for. The proof that this can fail is the CANARY: break `allSame` in
  // `detectOverstatement` and the first case above goes red. Run it with
  // `node nest/scripts/audit-trade-pnl-attribution.cjs --self-test` after any edit to that function.

  const failed = runCases(cases);
  console.log(failed === 0
    ? '\nSELFTEST PASSED — the detector fires on the #1014 signature and stays silent on the correct one'
    : `\nSELFTEST FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

// ─────────────────────────────────────────────────────────────────── live run ──
(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.trade.findMany({
      select: {
        id: true, provider: true, brokerTicket: true, symbol: true,
        quantity: true, pnl: true, status: true, pnlInvalid: true,
      },
    });

    const groups = groupByPosition(rows);
    const multi = groups.filter((g) => g.members.length > 1);
    const findings = groups.flatMap(detectOverstatement);
    const overstated = findings.filter((f) => f.kind === 'identical-pnl');

    // ⚠️ COUNTED OVER **ALL** ROWS, NOT OVER THE GROUPS. Counting the finding only inside grouped
    // rows under-reported it by 6x on the first run of this script: 135 rows carry `pnlInvalid=1`
    // and the grouped subset reported **22**, because rows with NO ticket are dropped from grouping
    // (there is no position to compare) and were therefore never counted. A total that silently
    // measures a subset is the defect this repo keeps re-finding, so both numbers are printed and
    // the difference is named.
    const allInvalid = rows.filter((r) => Number(r.pnlInvalid ?? 0) === 1);
    const invalidNoTicket = allInvalid.filter((r) => r.brokerTicket == null).length;

    console.log(`\ntrade rows read:        ${rows.length}`);
    console.log(`distinct positions:     ${groups.length}`);
    console.log(`multi-row positions:    ${multi.length}  (the population the split exists for)`);
    console.log(`pnlInvalid rows:        ${allInvalid.length}  (${invalidNoTicket} of them carry NO ticket ` +
      'and are outside the grouped population — the symbol-fallback / reaper path, not this one)');

    if (multi.length) {
      console.log('\nMulti-row positions:');
      for (const g of multi.sort((a, b) => b.members.length - a.members.length).slice(0, 20)) {
        const pnls = g.members.map((m) => (m.pnl == null ? 'null' : m.pnl.toFixed(2)));
        const flag = overstated.some((f) => f.key === g.key) ? '  <== OVERSTATED' : '';
        console.log(`  ${g.members[0].symbol ?? '?'} ${g.members[0].provider} ${g.key.split('\u0000')[1]} ` +
          `× ${g.members.length} rows, pnl [${pnls.join(', ')}]${flag}`);
      }
    }

    if (overstated.length === 0) {
      console.log('\n✅ No position has N rows carrying the same non-zero pnl.');
      console.log('   ⚠️ Absence of the signature is NOT proof the split ran: a group that has not been');
      console.log('      reconciled yet carries nulls and is reported below, not here.');
    } else {
      console.log(`\n🛑 ${overstated.length} position(s) show the whole-net-booking signature:`);
      for (const f of overstated) {
        console.log(`   ${f.symbol} ${f.key.split('\u0000')[1]} — ${f.rows} rows each ${f.pnl.toFixed(2)} ` +
          `= ${f.bookedTotal.toFixed(2)} booked (the position earned ${f.pnl.toFixed(2)})`);
      }
    }

    const invalid = findings.filter((f) => f.kind === 'pnl-invalid');
    if (invalid.length) {
      // ⚠️ Two numbers on purpose: the grouped subset (what this audit can reason about) and the
      // true total. Quoting only the first is how the 6x under-report happened.
      console.log(`\n🚧 ${invalid.reduce((s, f) => s + f.rows, 0)} of ${allInvalid.length} pnlInvalid row(s) ` +
        'are reachable by position id; the rest have no ticket at all.');
      console.log('   That is "not yet reconciled", which is a different thing from "attributed wrongly".');
      console.log('   ⚠️ A row carrying an ORDER ticket (a legacy row written before #1014) also lands here:');
      console.log('      it is unrepairable by the write-site fix alone and needs the orderId -> positionId');
      console.log('      resolution to be re-read from deal history.');
    }

    // The audit is a DETECTOR: it reports, and exits 1 only on the defect it was built to find.
    process.exit(overstated.length === 0 ? 0 : 1);
  } catch (err) {
    // ⚠️ A verifier that cannot read its input must ERROR, never pass.
    console.error(`\nAUDIT ERROR: ${err.message}`);
    process.exit(2);
  } finally {
    await prisma.$disconnect();
  }
})();
