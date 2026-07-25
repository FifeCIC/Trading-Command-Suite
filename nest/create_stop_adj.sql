CREATE TABLE IF NOT EXISTS stop_adjustment (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tradeTicket INT NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  oldSl FLOAT NULL,
  newSl FLOAT NULL,
  oldTp FLOAT NULL,
  newTp FLOAT NULL,
  reason VARCHAR(200) NOT NULL,
  directiveScores JSON NULL,
  adjustedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sa_ticket (tradeTicket),
  INDEX idx_sa_symbol (symbol, adjustedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
