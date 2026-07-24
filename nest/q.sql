SELECT type, COUNT(*) as cnt FROM alert WHERE dismissed = 0 GROUP BY type ORDER BY cnt DESC LIMIT 10;
