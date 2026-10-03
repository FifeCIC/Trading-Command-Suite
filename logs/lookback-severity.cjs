/**
 * logs/lookback-severity.cjs — is the deep-lookback directive ACTIVE, or merely declared?
 *
 * `protocol_directive_entry` -> `protocol_directive_group` -> protocol. Reading the chain rather
 * than guessing it: entry has `groupId`, not `protocolId`.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== protocol_directive_group columns (to join the chain correctly) ==');
  console.log(await query(
    `SELECT COLUMN_NAME AS col FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA='tradingcs' AND TABLE_NAME='protocol_directive_group'`, c));

  console.log('== deep-lookback directives and whether their protocol is active ==');
  console.log(await query(
    `SELECT e.directiveId, e.active AS entry_active,
            g.protocolId, pr.slug, pr.active AS protocol_active
     FROM protocol_directive_entry e
     JOIN protocol_directive_group g ON g.id = e.groupId
     LEFT JOIN protocol pr ON pr.id = g.protocolId OR pr.slug = g.protocolId
     WHERE e.directiveId IN ('btc-halving-cycle','bollinger-squeeze','ema-structure','hurst-memory')
     ORDER BY pr.active DESC LIMIT 20`, c));
})();
