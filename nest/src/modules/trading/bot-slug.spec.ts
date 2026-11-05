/**
 * bot-slug.spec.ts — the BOT naming rule, canaried in both directions.
 *
 * Owner direction, 2026-11-05: *"force '-bot' onto slug and 'Bot' suffix onto name"*.
 *
 * canary: remove `.replace(/-?bot$/, '')` from `botSlug()` and the double-suffix case fails
 * (`gold-scalp-m5-bot-bot`). Remove the `/bot$/i` test from `normaliseBotName()` and the
 * "already ends Bot" case fails with `Gold Scalp M5 Bot Bot`.
 */
import { normaliseBotName, botSlug } from './bot-slug';

describe('bot naming', () => {
  it('adds the Bot suffix when it is missing', () => {
    expect(normaliseBotName('Gold Scalp M5')).toBe('Gold Scalp M5 Bot');
  });

  it('does not add it twice — case-insensitive, so "self-trading BOT" stays as it is', () => {
    expect(normaliseBotName('Gold Scalp M5 Bot')).toBe('Gold Scalp M5 Bot');
    expect(normaliseBotName('Self-Trading BOT')).toBe('Self-Trading BOT');
  });

  it('an empty name still yields something addressable rather than an empty tile', () => {
    expect(normaliseBotName('   ')).toBe('Unnamed Bot');
    expect(botSlug('   ')).toBe('unnamed-bot');
  });

  it('every slug ends -bot, including one built from a name that already ends Bot', () => {
    expect(botSlug('Gold Scalp M5 Bot')).toBe('gold-scalp-m5-bot');
    expect(botSlug('Gold Scalp M5')).toBe('gold-scalp-m5-bot');
  });

  it('never produces -bot-bot', () => {
    for (const name of ['Bot', 'X Bot', 'BOT', 'A (Bot)']) {
      expect(botSlug(name).endsWith('-bot-bot')).toBe(false);
    }
  });

  it('punctuation and spacing collapse, so two spellings of one name agree', () => {
    expect(botSlug('US500  VWAP-Bands  Bot')).toBe(botSlug('us500 vwap bands bot'));
  });
});
