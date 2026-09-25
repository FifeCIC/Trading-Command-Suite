/**
 * AlertTriggerService
 * ===================
 * Evaluates real trading conditions on a configurable interval and creates
 * real alerts via AlertsService — replacing simulated alerts with live monitoring.
 *
 * Trigger types:
 *  - position-pnl      — position profit/loss exceeds $ or %
 *  - swap-accrual      — daily swap cost exceeds threshold
 *  - margin-utilization — margin used exceeds % of equity
 *  - data-staleness    — last quote older than N seconds
 *  - provider-degraded — provider health changes
 *  - mt5-disconnected  — MT5 bridge connection lost
 *  - market-close      — time until session close < N minutes
 *  - weekend-gap-risk  — projected gap risk exceeds % of equity
 *  - earnings-proximity — earnings event within N hours
 *  - bridge-clock-skew — MT5 bridge clock-offset telemetry missing or implausible (#750)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AlertsService, type AlertSeverity } from './alerts.service';
import { PrismaService } from '../../database/prisma.service';
import { MarketCalendarService } from '../calendar/market-calendar.service';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import {
  summariseExposure,
  parseIntent,
  overrideKey,
  type PositionIntent,
} from '../risk/position-intent';
import * as http from 'http';

interface TriggerConfig {
  enabled: boolean;
  cooldownSeconds: number;
  severity: AlertSeverity;
  threshold?: number;
}

@Injectable()
export class AlertTriggerService implements OnModuleInit {
  private readonly logger = new Logger(AlertTriggerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFired = new Map<string, number>(); // triggerKey → timestamp
  private lastHousekeepingAt = 0; // → autoDismissStale(), at most hourly
  private readonly POLL_INTERVAL_MS = 60_000; // 60 seconds

  // Default trigger configs
  private readonly configs: Record<string, TriggerConfig> = {
    'position-pnl':      { enabled: true, cooldownSeconds: 300, severity: 'warning', threshold: 5 },    // 5% P&L
    'swap-accrual':      { enabled: true, cooldownSeconds: 3600, severity: 'warning', threshold: 1 },    // $1/day
    'margin-utilization':{ enabled: true, cooldownSeconds: 300, severity: 'high', threshold: 50 },       // 50%
    'data-staleness':    { enabled: true, cooldownSeconds: 600, severity: 'warning', threshold: 300 },   // 5 min
    'provider-degraded': { enabled: true, cooldownSeconds: 600, severity: 'high' },
    'mt5-disconnected':  { enabled: true, cooldownSeconds: 120, severity: 'critical' },
    'market-close':      { enabled: true, cooldownSeconds: 900, severity: 'info', threshold: 30 },       // 30 min
    'weekend-gap-risk':  { enabled: true, cooldownSeconds: 3600, severity: 'warning', threshold: 2 },    // 2%
    'earnings-proximity':{ enabled: true, cooldownSeconds: 7200, severity: 'info', threshold: 24 },      // 24h
    // threshold is HOURS here (the only trigger that is): a real broker offset is at
    // most ±14h, so anything larger means the measurement itself is broken.
    'bridge-clock-skew': { enabled: true, cooldownSeconds: 3600, severity: 'high', threshold: 14 },      // 14h
    // threshold is MINIMUM SCORES in 24h — see checkSymbolSilent(). 20 is deliberately low:
    // a symbol scoring 20+ times a day is being evaluated continuously, so producing zero
    // executions is a signal about the PATH, not about the market being quiet.
    'symbol-silent':     { enabled: true, cooldownSeconds: 3600, severity: 'warning', threshold: 20 },
  };

  constructor(
    private readonly alerts: AlertsService,
    private readonly prisma: PrismaService,
    private readonly calendar: MarketCalendarService,
    private readonly mt5Connection: Mt5ConnectionManager,
  ) {}

  onModuleInit() {
    this.start();
  }

  start() {
    if (this.timer) return;
    this.logger.log('AlertTriggerService started — polling every 60s');
    this.timer = setInterval(() => this.evaluateAll(), this.POLL_INTERVAL_MS);
    // Run first evaluation after 10s delay
    setTimeout(() => this.evaluateAll(), 10_000);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // ── Main evaluation loop ────────────────────────────

  private async evaluateAll() {
    const promises = Object.entries(this.configs)
      .filter(([, cfg]) => cfg.enabled)
      .map(([key, cfg]) => this.evaluateTrigger(key, cfg));
    await Promise.allSettled(promises);

    // Housekeeping (2026-09-23) — enforce the DECLARED autoDismissDays.
    //
    // `autoDismissDays: 3` has been in the notification settings (and on the Settings page) since
    // the beginning, while nothing enforced it: condition alerts fired for months and nothing
    // aged them out (12,865 undismissed rows, 9,818 "runs"). The rule lives in
    // AlertsService.autoDismissStale() — ONE owner — and this loop only decides WHEN to run it.
    // First run happens on the evaluation 10s after boot, so the setting takes effect live.
    if (Date.now() - this.lastHousekeepingAt > 3_600_000) {
      this.lastHousekeepingAt = Date.now();
      void this.alerts.autoDismissStale();
    }
  }

  private async evaluateTrigger(key: string, cfg: TriggerConfig) {
    try {
      let condition: { triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null = null;

      switch (key) {
        case 'mt5-disconnected':   condition = await this.checkMt5Connection(); break;
        case 'provider-degraded':  condition = await this.checkProviderHealth(); break;
        case 'data-staleness':     condition = await this.checkDataStaleness(cfg); break;
        case 'position-pnl':       condition = await this.checkPositionPnl(cfg); break;
        case 'swap-accrual':       condition = await this.checkSwapAccrual(cfg); break;
        case 'margin-utilization': condition = await this.checkMarginUtilization(cfg); break;
        case 'market-close':       condition = await this.checkMarketClose(cfg); break;
        case 'weekend-gap-risk':   condition = await this.checkWeekendGapRisk(cfg); break;
        case 'earnings-proximity': condition = await this.checkEarningsProximity(cfg); break;
        case 'bridge-clock-skew':  condition = await this.checkBridgeClockSkew(cfg); break;
        case 'symbol-silent':      condition = await this.checkSymbolSilent(cfg); break;
      }

      if (condition?.triggered) {
        this.fireAlert(key, cfg, condition.title, condition.message, condition.severity || cfg.severity);
      }
    } catch (err) {
      this.logger.warn(`Trigger "${key}" evaluation failed: ${(err as Error).message}`);
    }
  }

  // ── Trigger checks ──────────────────────────────────

  private async checkMt5Connection(): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    try {
      const brokers = await this.mt5Connection.getAllBrokerHealths();
      if (brokers.length === 0) {
        return { triggered: true, title: 'MT5 Bridge Unreachable', message: 'No MT5 broker bridges configured.' };
      }
      const down = brokers.filter((b) => !b.reachable || !b.health?.connected);

      /**
       * #984 — name the broker, and NEVER render a bare `?`.
       *
       * The message used `b.server`. That field is null when the bridge cannot be reached — and a
       * failed probe is EXACTLY when this alert fires, so the live alert read
       * `MT5 Bridge(s) Down: ? unreachable`, which cannot be acted on because it does not say
       * WHICH broker is down.
       *
       * `brokerId` comes from `MT5_ACTIVE_BROKERS` and is ALWAYS known, so it leads; the server
       * name is appended when available. This is the substance of #984 — its own words are
       * *"a single `mt5` bucket cannot answer 'is my second broker working?'"*
       */
      const label = (b: { brokerId: number; server?: string | null }) => {
        // ⚠️ MEASURED LIVE, 2026-09-25: when broker 3's bridge is STOPPED,
        // `getAllBrokerHealths()` reports `server: '?'` — a literal placeholder, NOT null. My first
        // version checked truthiness only, which would have rendered `broker 3 (?)`: it names the
        // broker (the point of #984) but still prints the meaningless mark, so it is only
        // half-fixed. The placeholder is treated as unknown here.
        const named = b.server && b.server !== '?' ? ` (${b.server})` : '';
        return `broker ${b.brokerId}${named}`;
      };

      if (down.length === brokers.length) {
        const servers = down.map(label).join(', ');
        return { triggered: true, title: 'All MT5 Bridges Disconnected', message: `${servers} not connected. Automated trading disabled.` };
      }
      if (down.length > 0) {
        const servers = down.map(label).join(', ');
        // ⚠️ TITLE MUST NOT CARRY THE COUNT (2026-09-23). The title is the collapse key for
        // `collapseOrCreateAlert()` — "1 MT5 Bridge(s) Down" and "2 MT5 Bridge(s) Down" were two
        // DIFFERENT keys for ONE condition, so the row fractured every time the number moved.
        // The counts stay in the message, where a human still reads them.
        return { triggered: true, title: 'MT5 Bridge(s) Down', message: `${servers} unreachable. Only ${brokers.length - down.length}/${brokers.length} active.`, severity: 'warning' };
      }
      return { triggered: false, title: '', message: '' };
    } catch {
      return { triggered: true, title: 'MT5 Bridge Error', message: 'Failed to query MT5 bridge health.' };
    }
  }

  private async checkProviderHealth(): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    try {
      const res = await this.httpGet('http://localhost:3201/api/providers/health');
      const data = JSON.parse(res);
      const degraded = Array.isArray(data) ? data.filter((p: any) => p.status === 'degraded' || p.status === 'failed') : [];
      if (degraded.length > 0) {
        const names = degraded.map((p: any) => p.name || p.id).join(', ');
        // ⚠️ STABLE TITLE — see the note on the MT5 title above. `${degraded.length} Provider(s)`
        // was a collapse key that changed whenever the set of degraded providers changed size.
        return { triggered: true, title: 'Provider(s) Degraded', message: `${degraded.length} degraded: ${names} — scoring may be affected.`, severity: degraded.some((p: any) => p.status === 'failed') ? 'critical' : 'warning' };
      }
      return { triggered: false, title: '', message: '' };
    } catch {
      return null; // API unavailable — don't fire alert
    }
  }

  private async checkDataStaleness(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string } | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      const threshold = new Date(Date.now() - (cfg.threshold || 300) * 1000);
      const staleCount = await this.prisma.marketBar.count({
        where: { timestamp: { lt: threshold } },
      });
      if (staleCount > 0) {
        const minutes = Math.round((cfg.threshold || 300) / 60);
        return { triggered: true, title: 'Market Data Stale', message: `${staleCount} market bar(s) older than ${minutes} minutes. Import fresh data.` };
      }
      return { triggered: false, title: '', message: '' };
    } catch { return null; }
  }

  private async checkPositionPnl(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      const positions = await this.prisma.position.findMany({ where: { pnl: { not: null } } });
      const thresholdPct = cfg.threshold || 5;
      for (const pos of positions) {
        if (pos.pnl != null && pos.avgPrice > 0) {
          const pnlPct = Math.abs(pos.pnl / (pos.avgPrice * pos.quantity)) * 100;
          if (pnlPct > thresholdPct) {
            const dir = pos.pnl > 0 ? 'profit' : 'loss';
            return { triggered: true, title: `${pos.symbol} P&L Alert`, message: `${pos.symbol} ${dir}: ${pos.pnl.toFixed(2)} (${pnlPct.toFixed(1)}%).`, severity: pos.pnl < 0 ? 'warning' : 'info' };
          }
        }
      }
      return { triggered: false, title: '', message: '' };
    } catch { return null; }
  }

  private async checkSwapAccrual(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string } | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      const positions = await this.prisma.position.findMany({ where: { provider: 'mt5' } });
      let totalSwap = 0;
      for (const pos of positions) {
        // Approximate swap from stored data — real implementation would query MT5
        totalSwap += 0;
      }
      if (totalSwap > (cfg.threshold || 1)) {
        return { triggered: true, title: 'Swap Cost Alert', message: `Daily swap costs estimated at $${totalSwap.toFixed(2)}.` };
      }
      return { triggered: false, title: '', message: '' };
    } catch { return null; }
  }

  private async checkMarginUtilization(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    try {
      const acc = await this.mt5Connection.getAccountInfo();
      if (!acc) return null;
      if (acc.margin && acc.equity) {
        const utilPct = (acc.margin / acc.equity) * 100;
        if (utilPct > (cfg.threshold || 50)) {
          return { triggered: true, title: 'Margin Utilization High', message: `Margin at ${utilPct.toFixed(1)}% of equity (threshold: ${cfg.threshold}%).`, severity: utilPct > 80 ? 'critical' : 'high' };
        }
      }
      return { triggered: false, title: '', message: '' };
    } catch { return null; }
  }

  private async checkMarketClose(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string } | null> {
    const status = this.calendar.getMarketStatus('US');
    if (!status.isOpen && status.status === 'pre-market') {
      // Market hasn't opened yet — no close alert needed
      return { triggered: false, title: '', message: '' };
    }
    if (status.minutesUntilClose != null && status.minutesUntilClose > 0 && status.minutesUntilClose < (cfg.threshold || 30)) {
      const label = status.holidayName ? `${status.holidayName} (Early Close)` : 'US Session';
      return {
        triggered: true,
        title: `${label} Closing Soon`,
        message: `US market closes in ${status.minutesUntilClose} minutes${status.holidayName ? ` (${status.holidayName})` : ''}.`,
      };
    }
    return { triggered: false, title: '', message: '' };
  }

  /**
   * weekend-gap-risk — counts positions a WEEKEND GAP can actually hurt.
   *
   * ⚠️ This used to report `position.length` — every row, with no concept of what a position is
   * FOR. On Friday 2026-09-18 that produced:
   *
   *     "26 position(s) open going into weekend. Consider flattening or tightening stops."
   *
   * Measured: 5 were MT5 CFD positions opened within 30 hours (genuine gap risk) and **21 were
   * Trading212 equity holdings**, the oldest opened 25 July, aggregate −996 and held deliberately.
   * "Consider flattening" applied to a long-term holding is the opposite of the correct advice,
   * and because it repeats every Friday it trains the reader to ignore the alert entirely.
   *
   * The fix is not a filter on `provider` — that would hard-code today's two brokers into a
   * heuristic and silently mis-handle a third. Intent is resolved by `position-intent.ts`, where
   * the provider defaults are declared and labelled as inference, and where an unknown provider
   * becomes a QUESTION rather than either a nag or a silent omission.
   */
  private async checkWeekendGapRisk(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string } | null> {
    const now = new Date();
    const day = now.getUTCDay();
    // Friday check
    if (day !== 5) return { triggered: false, title: '', message: '' };
    if (!this.prisma.isAvailable) return null;
    try {
      const positions = await this.prisma.position.findMany();
      if (positions.length === 0) return { triggered: false, title: '', message: '' };

      const overrides = await this.loadIntentOverrides();
      const { exposed, held, needingDecision } = summariseExposure(positions, overrides);

      if (exposed.length === 0) {
        // No gap-exposed position. Not an alert — and specifically NOT the old behaviour of
        // reporting the whole ledger. Returning `triggered:false` here is what stops the Friday
        // noise; the held/unknown counts are stated below so their absence is not mistaken for
        // the check having failed to run ("fine" must not look like "cannot judge").
        if (needingDecision.length > 0) {
          return {
            triggered: true,
            title: 'Position Intent Unconfirmed',
            message:
              `No gap-exposed positions. ${needingDecision.length} position(s) on a provider with ` +
              `no declared intent (${needingDecision.map((p) => p.symbol).join(', ')}) — the app will ` +
              'not decide these for you. Set an intent to include them in risk checks.',
          };
        }
        return { triggered: false, title: '', message: '' };
      }

      const byProvider = new Map<string, number>();
      for (const p of exposed) byProvider.set(p.provider, (byProvider.get(p.provider) || 0) + 1);
      const breakdown = [...byProvider.entries()].map(([k, v]) => `${v} ${k}`).join(', ');

      return {
        triggered: true,
        title: 'Weekend Gap Risk',
        message:
          `${exposed.length} gap-exposed position(s) open going into weekend (${breakdown}). ` +
          `Consider flattening or tightening stops. ${held.length} long-term holding(s) are ` +
          'excluded by intent.' +
          (needingDecision.length > 0
            ? ` ${needingDecision.length} further position(s) are unclassified and were NOT ` +
              'assessed — set an intent to include them.'
            : ''),
      };
    } catch { return null; }
  }

  /**
   * Reads per-position intent overrides into the map `position-intent.ts` expects.
   *
   * ⚠️ A read FAILURE must not look like "no overrides". With an empty map every position falls
   * back to its provider default — for `trading212` that is `long-term`, i.e. a database hiccup
   * would silently EXEMPT the account's holdings from the alert. The failure is therefore logged
   * and rethrown so `checkWeekendGapRisk` returns null (cannot judge) rather than a clean pass.
   */
  private async loadIntentOverrides(): Promise<Map<string, PositionIntent>> {
    const rows = await this.prisma.positionIntentSetting.findMany();
    const map = new Map<string, PositionIntent>();
    for (const r of rows) {
      const parsed = parseIntent(r.intent);
      if (parsed) map.set(overrideKey(r.provider, r.symbol), parsed);
      else this.logger.warn(`position_intent row ${r.provider}/${r.symbol} has unreadable intent "${r.intent}" — ignored`);
    }
    return map;
  }

  private async checkEarningsProximity(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string } | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      const threshold = new Date(Date.now() + (cfg.threshold || 24) * 3600 * 1000);
      const upcoming = await this.prisma.earningsEvent.findMany({
        where: { reportDate: { lte: threshold, gte: new Date() } },
        take: 5,
      });
      if (upcoming.length > 0) {
        const symbols = [...new Set(upcoming.map(e => e.symbol))].slice(0, 3).join(', ');
        return { triggered: true, title: 'Earnings Events Approaching', message: `${upcoming.length} earnings event(s) in next ${cfg.threshold}h: ${symbols}...` };
      }
      return { triggered: false, title: '', message: '' };
    } catch { return null; }
  }

  /**
   * Bridge clock-offset telemetry (#750).
   *
   * WHY THIS ALERT EXISTS
   * ---------------------
   * The MT5 bridge measures the broker's server-clock offset (+3h on MetaQuotes-Demo)
   * and subtracts it in `utc_iso()`, so every MT5-sourced timestamp is true UTC. Two
   * failure modes are silent and expensive, and both look like healthy data:
   *
   *  1. **The telemetry is gone.** A bridge build from before #750 (or a rollback)
   *     stamps raw server-clock epochs as UTC, so every bar lands ~3h in the FUTURE.
   *     `computeMarketStatus` then computes a negative `ageMs`, which can never exceed
   *     the staleness threshold — the tradability gate fails OPEN and a stale or
   *     weekend feed reads as tradable. Nothing else in the app complains; scores
   *     still compute, they just describe the wrong moment.
   *  2. **The offset is implausible.** A broken measurement applies a nonsense
   *     conversion to every timestamp. Real broker offsets are within ±14h.
   *
   * Only evaluated while a bridge is reachable AND connected — an unreachable bridge is
   * already covered by `mt5-disconnected`, and firing both would be noise.
   *
   * `cfg.threshold` is in HOURS. This is intentionally an in-app alert rather than a
   * silent log line: the pre-#750 failure survived for weeks because nothing surfaced it.
   */
  private async checkBridgeClockSkew(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    try {
      const brokers = await this.mt5Connection.getAllBrokerHealths();
      const live = brokers.filter((b) => b.reachable && b.health?.connected);
      if (live.length === 0) return { triggered: false, title: '', message: '' };

      const missing = live.filter((b) => typeof b.health?.serverUtcOffsetSeconds !== 'number');
      if (missing.length > 0) {
        const servers = missing.map((b) => b.server || `broker ${b.brokerId}`).join(', ');
        return {
          triggered: true,
          title: 'MT5 Clock-Offset Telemetry Missing',
          message: `${servers}: /health reports no serverUtcOffsetSeconds, so the bridge is stamping broker SERVER time as UTC again (pre-#750 build). Timestamps will run ~3h ahead and the market-status gate will fail open. Redeploy scripts/mt5-bridge/mt5_bridge_v2.py.`,
          severity: 'critical',
        };
      }

      const limitHours = cfg.threshold ?? 14;
      const implausible = live.filter((b) => Math.abs(b.health!.serverUtcOffsetSeconds!) > limitHours * 3600);
      if (implausible.length > 0) {
        const detail = implausible
          .map((b) => `${b.server || `broker ${b.brokerId}`} ${(b.health!.serverUtcOffsetSeconds! / 3600).toFixed(2)}h`)
          .join(', ');
        return {
          triggered: true,
          title: 'MT5 Clock-Offset Implausible',
          message: `Measured server-clock offset beyond ±${limitHours}h: ${detail}. Every MT5-sourced timestamp is being shifted by a suspect offset — check GET :5000/health.`,
          severity: 'high',
        };
      }

      return { triggered: false, title: '', message: '' };
    } catch {
      return null; // bridge health unavailable — mt5-disconnected covers this case
    }
  }

  // ── Helpers ─────────────────────────────────────────

  /**
   * checkSymbolSilent() — A SYMBOL THAT IS BEING SCORED AND NEVER TRADES (#946).
   *
   * ---------------------------------------------------------------------------------
   * WHY THIS TRIGGER EXISTS
   * ---------------------------------------------------------------------------------
   * ⚠️ VOCABULARY, because getting it wrong here is how it drifts into the code:
   *   a PROTOCOL scores a symbol. A BOT consumes the score and decides whether to trade.
   *   Bots do not score. `score` rows are written per (symbol, protocol) — never per bot —
   *   so every count in this method is a count for the SYMBOL, not for any one bot.
   *
   * Measured 2026-09-22: five USD majors (AUDUSD, EURUSD, GBPUSD, USDCAD, USDCHF) each had
   * an `active=1` auto bot, live prices and live bars, and their SYMBOLS produced **no score,
   * no decision and no trade for a week** — because nothing had assigned them a protocol, so
   * no protocol was scoring them. No error was raised anywhere. the only reason it was found is that the owner asked why nothing was
   * trading.
   *
   * VIX is the second instance: its SYMBOL was scored 5–190 times a day by its protocols, and
   * its trades were refused 82 times in 24h with `price is 0 (no quote for VIX)`. Again: no
   * alert, no error surface — just a log line and a silent symbol.
   *
   * ⚠️ THIS IS A SYMPTOM TRIGGER, DELIBERATELY. It does not care WHY a symbol is silent.
   * The two known instances have *different* causes (a missing assignment vs a quote
   * resolved against the wrong bridge), and neither cause would have been expressible as a
   * check when this was written. A cause trigger would need the theory to be right; this one
   * fires on the observable outcome instead, which is the property that makes it worth having.
   *
   * ---------------------------------------------------------------------------------
   * WHY THE BLOCK REASON IS IN THE MESSAGE
   * ---------------------------------------------------------------------------------
   * `scores but never executes` is a symptom; the operator needs the NEXT STEP. So the
   * trigger carries the dominant BLOCKED reason for each symbol — the difference between
   * "VIX is silent" (unactionable) and "VIX refused 82× on price is 0" (a lead).
   *
   * ⚠️ ONE ALERT FOR ALL SILENT SYMBOLS, not one each. The cooldown in fireAlert() is keyed
   * per TRIGGER, so per-symbol alerts would collide and only the first would survive — and
   * five single-symbol alerts is how an alert channel stops being read. One alert listing
   * them is both cheaper and more complete.
   */
  private async checkSymbolSilent(
    cfg: TriggerConfig,
  ): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    try {
      const minScores = cfg.threshold ?? 20;

      // Only symbols the app is actually TRYING to trade. A manual-mode bot never
      // executes by design, and alerting on it would be a false positive on day one.
      // NOTE: this selects the SYMBOLS that have an active bot. The counts below are the
      // symbol's, not the bot's — a symbol may carry up to four bots and still have one
      // shared score series.
      const bots = await this.prisma.tradingStrategy.findMany({
        where: { active: true, mode: { not: 'manual' } },
        select: { symbol: true },
      });
      const botSymbols = [...new Set(bots.map((b) => String(b.symbol || '').toUpperCase()).filter(Boolean))];
      if (botSymbols.length === 0) return { triggered: false, title: '', message: '' };

      // ⚠️ UTC_TIMESTAMP(), not NOW(). `score.timestamp` and `decision_log.timestamp` are
      // stored in UTC while the MySQL session runs in local time (BST here), so a window
      // built from NOW() is an hour out and silently reports nothing. Cost an hour of
      // misreading on 2026-09-22 before it was spotted.
      const scores = await this.prisma.$queryRawUnsafe<Array<{ sym: string; n: bigint }>>(
        `SELECT UPPER(s.ticker) sym, COUNT(*) n
           FROM score sc JOIN symbol s ON s.id = sc.symbolId
          WHERE sc.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
          GROUP BY UPPER(s.ticker)`,
      );
      const executed = await this.prisma.$queryRawUnsafe<Array<{ sym: string; n: bigint }>>(
        `SELECT UPPER(symbol) sym, COUNT(*) n FROM decision_log
          WHERE decision = 'EXECUTED' AND timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
          GROUP BY UPPER(symbol)`,
      );
      const blocked = await this.prisma.$queryRawUnsafe<Array<{ sym: string; n: bigint; reason: string }>>(
        `SELECT UPPER(symbol) sym, COUNT(*) n, MIN(LEFT(reason, 120)) reason FROM decision_log
          WHERE decision = 'BLOCKED' AND timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
          GROUP BY UPPER(symbol)`,
      );

      const toMap = <T extends { sym: string }>(rows: T[]) =>
        Object.fromEntries(rows.map((r) => [String(r.sym).toUpperCase(), r]));
      const S = toMap(scores);
      const E = toMap(executed);
      const B = toMap(blocked);

      const silent = botSymbols
        .map((sym) => ({
          sym,
          scores: Number(S[sym]?.n ?? 0),
          executed: Number(E[sym]?.n ?? 0),
          blocked: Number(B[sym]?.n ?? 0),
          reason: B[sym]?.reason ?? null,
        }))
        .filter((x) => x.scores >= minScores && x.executed === 0)
        .sort((a, b) => b.scores - a.scores);

      if (silent.length === 0) return { triggered: false, title: '', message: '' };

      const detail = silent
        .slice(0, 6)
        .map((x) =>
          `${x.sym} (${x.scores} scores, ${x.executed} trades${x.blocked ? `, blocked ${x.blocked}× — ${x.reason}` : ', never blocked'})`,
        )
        .join('; ');

      return {
        triggered: true,
        // ⚠️ STABLE TITLE — `${silent.length} Symbol(s)…` fractured into separate rows for 8, 9 and
        // 10 silent symbols (all one condition). The count is in the message below.
        title: 'Symbols Scoring But Never Trading',
        message:
          `Scored ${minScores}+ times in 24h and produced ZERO executions: ${detail}` +
          (silent.length > 6 ? `; +${silent.length - 6} more` : '') +
          '. A symbol that is scored continuously and never trades is usually a broken PATH, not a quiet market.',
        severity: 'warning' as AlertSeverity,
      };
    } catch (err) {
      // An unreadable count must NOT read as "no silent symbols" — that is the defect this
      // whole trigger exists to catch, pointed the other way. Surface it as a trigger.
      return {
        triggered: true,
        title: 'Symbol-silent check could not run',
        message: `The silent-symbol probe failed: ${(err as Error).message}. Absence of this alert cannot be taken as evidence that every symbol is trading.`,
        severity: 'high' as AlertSeverity,
      };
    }
  }

  private fireAlert(key: string, cfg: TriggerConfig, title: string, message: string, severity: AlertSeverity) {
    const now = Date.now();
    const last = this.lastFired.get(key) || 0;
    if (now - last < cfg.cooldownSeconds * 1000) return;

    this.lastFired.set(key, now);
    // ⚠️ ARGUMENT ORDER — AlertsService.addAlert(type, title, detail, severity, ticker?, link?).
    // These four args were previously shifted by one (`severity, 'trading', title, message`),
    // so every stored alert had title='trading' and the human message landed in the
    // `severity` column — the Alert Center and the notification bell then showed useless
    // titles and could not colour by severity. Frontend expects `type` to be a CATEGORY
    // (AlertCenterPage TYPE_FALLBACKS: signal | drawdown | daily | backtest | system | trading),
    // not the trigger key. Keep 'trading' as the category, pass the message as `detail`.
    this.alerts.addAlert('trading', title, message, severity);
    this.logger.log(`ALERT [${severity}] ${title}: ${message}`);
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      http.get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }
}
