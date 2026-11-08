-- #763 — consolidate duplicate watchlists onto the UUID-identified row.
--
-- WHY A MERGE AND NOT A DELETE
-- ----------------------------
-- Five watchlists exist twice: once with a slug-shaped id (`leverage-long`) and once
-- with a UUID. They are NOT accidental copies — they are two storage formats of
-- overlapping content:
--
--   uuid row -> bare tickers    ["NVDA", "MSTR", ...]
--   slug row -> rich objects    [{"name":"NVIDIA Corp","ticker":"NVDA"}, ...]
--
-- So deleting either side loses something real: the uuid row loses display names, the
-- slug row loses nothing in most cases but in `dxy-sensitive` the CONTENT DIFFERS
-- (12 symbols vs 10 — `USDCNH` and `USDSEK` are only on the uuid row).
--
-- Resolution was `LIMIT 1` with no `ORDER BY`, so which row a protocol read depended on
-- storage order — for `dxy-sensitive` that silently meant two extra or two missing
-- currency pairs in the DXY basket.
--
-- The fix: keep the UUID row (the FK-shaped identity), merge in any symbol the slug row
-- has that the uuid row lacks, then remove the slug row. Rich objects are preserved
-- because the uuid row's bare-ticker form is the one the reader normalises anyway.
--
-- Idempotent: re-running finds no slug duplicates and does nothing.

-- 1) Report the pairs before touching anything.
SELECT 'BEFORE' AS phase, a.name AS slug_row, b.name AS uuid_row,
       JSON_LENGTH(a.symbols) AS slug_n, JSON_LENGTH(b.symbols) AS uuid_n
  FROM watchlist a
  JOIN watchlist b
    ON LOWER(REPLACE(REPLACE(a.name,'-',' '),'_',' ')) = LOWER(REPLACE(REPLACE(b.name,'-',' '),'_',' '))
   AND a.id < b.id
 WHERE a.id NOT REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-'
   AND b.id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-';

-- 2) Merge: for each pair, give the uuid row the UNION of both symbol lists.
--    Done in JS-free SQL via JSON_MERGE_PRESERVE on the two JSON arrays, then the
--    application's normaliser (which reads either `"TICKER"` or `{"ticker":...}`)
--    handles the mixed shape. Concatenation is safe because duplicates are deduped
--    by the resolver, and preserving the richer objects keeps display names.
UPDATE watchlist b
  JOIN watchlist a
    ON LOWER(REPLACE(REPLACE(a.name,'-',' '),'_',' ')) = LOWER(REPLACE(REPLACE(b.name,'-',' '),'_',' '))
   AND a.id <> b.id
   SET b.symbols = JSON_MERGE_PRESERVE(a.symbols, b.symbols),
       b.updatedAt = NOW()
 WHERE a.id NOT REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-'
   AND b.id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-';

-- 3) Link the surviving row to any protocol the doomed row pointed at, so an FK is
--    never lost in the consolidation.
UPDATE watchlist b
  JOIN watchlist a
    ON LOWER(REPLACE(REPLACE(a.name,'-',' '),'_',' ')) = LOWER(REPLACE(REPLACE(b.name,'-',' '),'_',' '))
   AND a.id <> b.id
   SET b.protocolId = COALESCE(b.protocolId, a.protocolId)
 WHERE a.id NOT REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-'
   AND b.id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-'
   AND a.protocolId IS NOT NULL;

-- 4) Remove the slug-identified duplicates now that their content is merged.
DELETE a FROM watchlist a
 WHERE a.id NOT REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-'
   AND EXISTS (
     SELECT 1 FROM (SELECT * FROM watchlist) b
      WHERE LOWER(REPLACE(REPLACE(b.name,'-',' '),'_',' ')) = LOWER(REPLACE(REPLACE(a.name,'-',' '),'_',' '))
        AND b.id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-'
        AND b.id <> a.id
   );

-- 5) Confirm.
SELECT 'AFTER' AS phase, COUNT(*) AS remaining_slug_id_rows
  FROM watchlist WHERE id NOT REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-';
