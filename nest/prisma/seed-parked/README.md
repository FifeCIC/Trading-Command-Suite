# seed-parked — protocols and bots deliberately NOT shipped (2026-11-02)

The public package seeds **three** protocols and **three** bots. Everything here is removed from
`protocols-seed-data.ts` / `strategy-seed-data.ts` and kept **verbatim**, because a fresh clone
cannot recover it from a database it does not have.

| File | Contents |
|---|---|
| `protocols-*.json` | 45 protocol seed entries, byte-for-byte as they were |
| `bots-*.json` | 35 bot seed entries, with `name` and `protocolId` recorded beside each body |

⚠️ **These are a record, not a mechanism.** Nothing reads these files. Re-shipping an entry means
pasting it back into its seed file — and if it is a bot, its protocol must be re-shipped too, or a
fresh install seeds a strategy pointing at a protocol that does not exist. `split-seed-packaging.cjs`
refuses that combination at split time.

⚠️ **Nothing was deleted from this installation's database.** The seeders only iterate what the seed
declares, so absent entries simply remain: measured the same day, `protocol` 50 rows and
`trading_strategy` 40 rows were unchanged, and the seeder dry-run proposed zero changes.
