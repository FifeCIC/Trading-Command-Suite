export const IMPORT_QUEUE = 'market-imports';

export type ImportJobPayload = {
  runId: string;
  symbolId: string;
  timeframe: string;
  provider: string;
  source: string;
};
