CREATE TABLE IF NOT EXISTS ai_api_call (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  feature VARCHAR(50) DEFAULT 'general',
  model VARCHAR(80) NOT NULL,
  tokensIn INT DEFAULT 0,
  tokensOut INT DEFAULT 0,
  cost FLOAT DEFAULT 0,
  durationMs INT NULL,
  success BOOLEAN DEFAULT TRUE,
  error TEXT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ai_feature (feature, createdAt),
  INDEX idx_ai_created (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
