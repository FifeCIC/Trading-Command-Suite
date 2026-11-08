export default {
  datasource: {
    // ⚠️ No fallback literal. Prisma loads `nest/.env` before it evaluates this file (observed:
  // "Environment variables loaded from .env" precedes "Prisma schema loaded"), so an absent
  // DATABASE_URL is a configuration error to report, not a default to invent (#1252).
  url: process.env.DATABASE_URL,
  },
};
