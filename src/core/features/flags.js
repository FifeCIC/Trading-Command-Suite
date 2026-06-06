import { env } from '../config/env';

export const FEATURE_FLAGS = {
  devRuntime: env.VITE_ENABLE_DEV_RUNTIME === 'true',
  awsBedrock: env.VITE_ENABLE_AWS_BEDROCK === 'true'
};

export function isFeatureEnabled(name) {
  return Boolean(FEATURE_FLAGS[name]);
}
