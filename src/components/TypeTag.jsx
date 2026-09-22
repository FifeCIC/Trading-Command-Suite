/**
 * TypeTag — the "(proto)" / "(bot)" / "(strategy)" suffix that states WHAT an identifier is.
 * =========================================================================================
 * Owner, 2026-09-22: *"One thing [I'm not] liking throughout this app is strings like this not
 * being clear as a protocol or a bot or a strategy... Maybe we need to start appending (bot) or
 * (proto) — lets try it on this view."* (`btc-speed-v1` rendered bare on /trading/strategies-derived.)
 *
 * ⚠️ THIS IS A DISPLAY CONVENTION, NOT DECORATION. The same string can be a protocol id, a bot
 * name, a strategy name or a strategyKey, and the repo has already paid for that ambiguity in
 * data (#801: `trading_strategy.protocolId` is slug-or-UUID — lookups silently return wrong
 * answers). A bare string asks the reader to remember which layer it came from; a suffixed one
 * states it. Where an identifier is rendered in a context that answers "what is this?", add a tag.
 *
 * Kept deliberately tiny and shared: two pages use it today (the Strategies list and the A/B
 * Strategies view), and a second implementation per page is the drift this repo keeps paying for.
 */
import styles from './type-tag.module.css';

const LABELS = {
  proto: 'proto',
  bot: 'bot',
  strategy: 'strategy',
};

export default function TypeTag({ kind }) {
  const label = LABELS[kind] ?? kind;
  return <span className={styles.tag}>({label})</span>;
}
