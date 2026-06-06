import { z } from 'zod';

const FlushIntervalSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') {
      return 30000;
    }

    return Number(value);
  },
  z.number().int().min(5000).max(300000)
);

const EnvSchema = z.object({
  VITE_API_BASE_URL: z.string().url().default('http://localhost:3001'),
  VITE_ENABLE_DEV_RUNTIME: z.enum(['true', 'false']).default('true'),
  VITE_ENABLE_AWS_BEDROCK: z.enum(['true', 'false']).default('false'),
  VITE_ANALYTICS_ENABLED: z.enum(['true', 'false']).default('true'),
  VITE_ANALYTICS_ENDPOINT: z.string().default(''),
  VITE_ANALYTICS_APP_ID: z.string().default('tradingcs'),
  VITE_ANALYTICS_FLUSH_INTERVAL_MS: FlushIntervalSchema.default(30000),
  VITE_PERF_MONITORING_ENABLED: z.enum(['true', 'false']).default('true'),
  VITE_THEME_POLICY_ENFORCED: z.enum(['true', 'false']).default('false'),
  VITE_THEME_POLICY_FAIL_CLOSED: z.enum(['true', 'false']).default('false'),
  VITE_THEME_ALLOWLIST_PACKS: z.string().default('core,oceanic,scifi'),
  VITE_THEME_ALLOWLIST_ADAPTERS: z.string().default('vanilla,mantine,mui')
});

const parsed = EnvSchema.safeParse(import.meta.env);

if (!parsed.success) {
  throw new Error(`Invalid environment config: ${parsed.error.message}`);
}

export const env = parsed.data;
