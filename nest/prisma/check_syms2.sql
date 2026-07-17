SELECT id, LEFT(name,30) as name, LEFT(JSON_TYPE(symbols),20) as sym_type, JSON_LENGTH(symbols) as sym_count FROM Watchlist LIMIT 10;
