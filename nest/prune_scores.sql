DELETE s FROM score s
INNER JOIN (
  SELECT id FROM (
    SELECT id, symbolId,
      ROW_NUMBER() OVER (PARTITION BY symbolId ORDER BY timestamp DESC) AS rn
    FROM score
  ) ranked WHERE rn > 10
) to_delete ON s.id = to_delete.id;
