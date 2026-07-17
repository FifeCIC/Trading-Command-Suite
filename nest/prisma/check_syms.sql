SELECT id, name, JSON_EXTRACT(symbols, '$[0]') as first_symbol FROM Watchlist LIMIT 5;
