import { Injectable, Logger, Optional } from '@nestjs/common';
import { AdapterFactory } from '../providers/adapter-factory';
import { ProviderDegradationService } from '../providers/provider-degradation.service';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { BrokerConfigService } from './broker-config.service';

/**
 * BrokerCapabilityService — ONE answer to "what can this broker actually do, and is it up?"
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────
 * `GET /api/brokers` returns `broker_config` ONLY: persisted INTENT (displayName,
 * tradingEnabled, supportedStyles). `GET /api/providers/health` returns CONNECTION
 * state only. Neither can answer the question the Accounts page must answer, so the
 * page would have to join two endpoints client-side — and a client-side join of two
 * independently-cached endpoints is exactly how a stale "Connected" badge is born.
 *
 * ── THE RULE THIS FILE IS BUILT AROUND ─────────────────────────────────────────
 * A declaration is not validated by being well-formed. So every capability below is
 * answered from the ADAPTER OBJECT ITSELF (`typeof adapter.placeOrder === 'function'`),
 * not from a table of strings. Measured 2026-11-10, method presence is:
 *
 *   mt5                  placeOrder ✔  modifyPosition ✔  closePosition ✔  getPositions ✔
 *   capital.com          placeOrder ✔  modifyPosition ✘  closePosition ✘  getPositions ✔
 *   trading212           placeOrder ✔  modifyPosition ✘  closePosition ✘  getPositions ✔
 *   interactive-brokers  placeOrder ✔  modifyPosition ✘  closePosition ✘  getPositions ✔
 *   alpaca / binance     (no brokerage methods at all)
 *
 * ⇒ ONLY MT5 can move a stop. A trailing-stop feature that assumes otherwise is wrong on
 * three of four brokerage adapters, and would fail silently at runtime.
 *
 * 🛑 **BUT `canModifyStop` DESCRIBES THE ADAPTER, NOT A WORKING FEATURE — measured 2026-11-10.**
 * `mt5.adapter.ts:1385` defines `modifyPosition` and **NOTHING CALLS IT**. The only
 * `modifyPosition` call sites in the whole backend are PaperTradingService and
 * Mt5TradingService — neither is an adapter. MT5's real stop management goes
 * `mt5-trading.service` → bridge HTTP, bypassing the adapter entirely.
 * ⇒ So on every non-MT5 broker there is **no broker-agnostic stop-management path at all**,
 * and implementing `modifyPosition` on a second adapter today would create a SECOND dead
 * method, because no caller exists to invoke it. Read this field as "the adapter defines
 * the method"; read it as "trailing stops work here" and you will be wrong.
 * Order PLACEMENT does not have this problem — `adapterFactory.create(id).placeOrder(...)`
 * is the live path.
 *
 * ⚠️ `closePosition` has the same shape (MT5 adapter defines it, nothing calls it).
 *
 * ⚠️ `interactive-brokers` reports `placeOrder` present but it is a MOCK STUB. Method
 * presence proves a method EXISTS, not that it reaches a venue. That is reported as
 * `runtime.canPlaceOrder: true` + `runtime.mockSuspect: true` rather than being hidden —
 * and the fix is to implement the adapter, not to soften this probe.
 *
 * ── THE TWO LISTS DO NOT OVERLAP ───────────────────────────────────────────────
 * `broker_config` holds INTENT (mt5, trading212, paper, capital.com). The adapter factory
 * holds REGISTRATIONS (including providers that trade nothing). A broker in config with no
 * registration has `tradingEnabled: true` and cannot trade — so the join is reported as a
 * UNION with `registrationMissing` / `configMissing` flags. Collapsing the two would render
 * "cannot judge" as "fine".
 */
/**
 * Phrases an adapter uses when it is telling you it does not execute. Matched against the
 * adapter's OWN `placeOrder` source at runtime — not its class name, which is a guess.
 */
const STUB_MARKERS = /\bmock\b|\bstub\b|no real execution|not implemented|placeholder/i;

@Injectable()
export class BrokerCapabilityService {
  private readonly logger = new Logger(BrokerCapabilityService.name);

  /**
   * Runtime probe results, memoised per adapter id. The answer depends only on which
   * methods a CLASS defines, so it can never change at runtime — but `create()` constructs
   * an instance, and doing that per request for every broker is needless work.
   * Bounded to the number of registered adapters (~12), so it cannot grow.
   */
  private readonly probeCache = new Map<string, RuntimeCapability>();

  constructor(
    private readonly brokerConfig: BrokerConfigService,
    private readonly adapterFactory: AdapterFactory,
    private readonly degradation: ProviderDegradationService,
    /**
     * ⚠️ OPTIONAL ON PURPOSE (#1313). Existing construction sites and specs pass three
     * arguments; a fourth required one would break them for a capability they do not test.
     * When it is absent, every row behaves exactly as before.
     */
    @Optional() private readonly mt5Connection?: Mt5ConnectionManager,
  ) {}

  /**
   * `liveTrade()` — what each MT5 BRIDGE currently says about trading, keyed by provider id.
   *
   * ⚠️ WHY THIS EXISTS (#1313, measured 2026-11-19). `connection.status` came only from the
   * degradation tracker, which had no `mt5` entry, so it reported `unknown` — while both
   * bridges were answering `/health` with the answer. Worse, `runtime.canPlaceOrder: true`
   * read as "this broker can place orders" when `tradeAllowed: false` on :5001 meant EVERY
   * order was refused `retcode 10027`. One broker kept trading, so nothing alerted: the
   * all-or-nothing `checkTradeDisabled()` stayed silent and the surface said "canPlaceOrder".
   *
   * `canTrade` is a THREE-state value, and `null` is not `false`:
   *   true  — a bridge reported `tradeAllowed: true` and the API trade path is not disabled
   *   false — a bridge reported `tradeAllowed: false` or `tradeapiDisabled: true` (definite)
   *   null  — no bridge answered, or the field was unreadable. "Cannot judge" is its own
   *           answer and must never be rendered as a capability, in either direction.
   */
  private async liveTrade(): Promise<Map<string, LiveTrade>> {
    const out = new Map<string, LiveTrade>();
    if (!this.mt5Connection || typeof this.mt5Connection.getAllBrokerHealths !== 'function') return out;
    let healths: any[] = [];
    try {
      healths = await this.mt5Connection.getAllBrokerHealths();
    } catch (err) {
      this.logger.warn(`[brokers] MT5 bridge health read failed; canTrade will read 'null': ${String(err)}`);
      return out;
    }
    const perBridge = (Array.isArray(healths) ? healths : []).map((h: any) => {
      const hh = h?.health ?? {};
      const blocked = hh.tradeAllowed === false || hh.tradeapiDisabled === true;
      return {
        brokerId: h?.brokerId ?? null,
        connected: hh.connected === true,
        tradeAllowed: hh.tradeAllowed ?? null,
        tradeapiDisabled: hh.tradeapiDisabled ?? null,
        account: hh.account ?? null,
        canTrade: hh.connected === true ? !blocked : null,
      };
    });
    if (perBridge.length === 0) return out;
    const anyReadable = perBridge.some((b) => b.canTrade !== null);
    out.set('mt5', {
      observed: true,
      // TRUE when at least one bridge can trade — a broker is usable if any account is.
      canTrade: anyReadable ? perBridge.some((b) => b.canTrade === true) : null,
      connected: perBridge.some((b) => b.connected),
      // ⚠️ PARTIAL IS ITS OWN STATE (#1313). A canary caught the first version reporting
      // `healthy` while its own warning said one bridge was refusing every order. One working
      // account beside one dead account is not "healthy" — that word is read as "nothing to do".
      partiallyBlocked: perBridge.some((b) => b.canTrade === false) && perBridge.some((b) => b.canTrade === true),
      brokers: perBridge,
    });
    return out;
  }

  /** The joined view the Accounts page reads. One call, one cache lifetime. */
  async getBrokerStatus(): Promise<BrokerStatusResponse> {
    const [configs, registrations] = await Promise.all([
      this.safeConfigs(),
      Promise.resolve(this.adapterFactory.listAdapters()),
    ]);

    const configById = new Map(configs.map((c) => [String(c.id), c]));
    const regById = new Map(registrations.map((r) => [String(r.id), r]));

    // Connection state, keyed. A provider with no entry here has NOT been observed —
    // which is reported as `observed: false`, never as "healthy".
    const connById = new Map<string, { status: string; reason: string | null }>();
    try {
      for (const d of this.degradation.getAll()) {
        connById.set(String(d.providerId), {
          status: String(d.status),
          reason: d.reason ? String(d.reason) : null,
        });
      }
    } catch (err) {
      this.logger.warn(`[brokers] degradation read failed, connection state will read 'unknown': ${String(err)}`);
    }

    // Live bridge truth, which the degradation tracker does not carry for `mt5` (#1313).
    const liveById = await this.liveTrade();

    const allIds = new Set<string>([...configById.keys(), ...regById.keys()]);
    const brokers: BrokerStatusRow[] = [];

    for (const id of allIds) {
      const cfg = configById.get(id);
      const reg = regById.get(id);
      const runtime = reg ? this.probeRuntime(id) : null;
      const conn = connById.get(id) ?? null;
      // Live bridge state for THIS provider, if one reported anything (#1313).
      const live = liveById.get(id) ?? null;

      brokers.push({
        id,
        displayName: String(cfg?.displayName ?? reg?.name ?? id),
        // ── what KIND of thing this is ──
        // The adapter factory registers ~10 DATA providers alongside the brokers. Presenting
        // Yahoo Finance as a "broker with tradingEnabled: null" is noise on a broker list, so
        // the role is stated rather than left for the UI to infer from a missing field.
        role: cfg || reg?.capabilities?.includes('trades') ? 'broker' : 'data-provider',
        // ── intent (broker_config) ──
        isActive: cfg ? Boolean(cfg.isActive) : null,
        tradingEnabled: cfg ? Boolean(cfg.tradingEnabled) : null,
        supportedStyles: cfg?.supportedStyles ?? [],
        supportedAssetTypes: cfg?.supportedAssetTypes ?? [],
        note: cfg?.note ?? null,
        sortOrder: cfg?.sortOrder ?? 999,
        // ── registration (adapter factory) ──
        registered: Boolean(reg),
        declaredCapabilities: reg?.capabilities ?? [],
        // ⚠️ MEASURED 2026-11-10 — this field inherits a PRE-EXISTING false negative.
        // `providers.module.ts:98` registers MT5 with `apiKeyEnv: 'MT5_ACCOUNT'`, but
        // `nest/.env` defines `MT5_ACCOUNT_1.. MT5_ACCOUNT_4` and NEVER bare `MT5_ACCOUNT`.
        // So `hasCredentials('mt5')` is permanently FALSE regardless of how many MT5 accounts
        // are configured — and `providers.service.ts:101,144` already report that false value
        // on `/api/providers/health`. It is returned here unchanged rather than papered over,
        // because the same number in two places must agree; the fix belongs in the registration.
        // Do NOT read `false` here as "this broker is not configured".
        credentialsConfigured: reg ? (reg.apiKeyEnv ? this.safeHasCredentials(id) : null) : null,
        // ── proof (runtime probe) ──
        runtime,
        // ── connection ──
        // A live bridge reading beats the degradation tracker: it is the thing that actually
        // answers. When neither has an entry, this stays `observed: false / unknown`, which is
        // the honest answer and the one the existing spec pins.
        connection: live
          ? {
              observed: true,
              status:
                live.canTrade === false
                  ? 'trading-disabled'
                  : live.partiallyBlocked
                    ? 'degraded'
                    : live.canTrade === true
                      ? 'healthy'
                      : 'unknown',
              reason:
                live.canTrade === false
                  ? 'connected, but AutoTrading is OFF in the terminal (or the API trade path is disabled) — every order is refused'
                  : live.partiallyBlocked
                    ? 'at least one bridge is refusing every order while another can trade — see `trade.brokers`'
                    : null,
            }
          : {
              observed: Boolean(conn),
              status: conn?.status ?? 'unknown',
              reason: conn?.reason ?? null,
            },
        // ── can it actually TRADE, per bridge? ──
        trade: live,
        // ── the two lists disagreeing is a FINDING, not a detail ──
        warnings: this.buildWarnings(id, cfg, reg, runtime, live),
      });
    }

    brokers.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

    return {
      brokers,
      summary: {
        total: brokers.length,
        registered: brokers.filter((b) => b.registered).length,
        // "tradeable" means PROVEN, not intended: intent without a placeOrder is a lie.
        // A self-declared stub is excluded — it reports success without reaching a venue.
        provenTradeable: brokers.filter((b) => b.runtime?.canPlaceOrder === true && !b.runtime.mockSuspect).length,
        provenStopMovable: brokers.filter((b) => b.runtime?.canModifyStop === true).length,
        up: brokers.filter((b) => b.connection.status === 'healthy').length,
        unobserved: brokers.filter((b) => !b.connection.observed).length,
        withWarnings: brokers.filter((b) => b.warnings.length > 0).length,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ── the probe: asks the ADAPTER, not a table ─────────────────────────────────

  private probeRuntime(id: string): RuntimeCapability {
    const cached = this.probeCache.get(id);
    if (cached) return cached;

    let result: RuntimeCapability;
    try {
      const adapter = this.adapterFactory.create(id) as any;
      if (!adapter) {
        // Registered but not instantiable (usually missing credentials). Every answer is
        // null = CANNOT JUDGE. Never false, which would claim proof of absence.
        result = {
          probed: false,
          supportsBrokerageDeclared: null,
          canReadPositions: null,
          canPlaceOrder: null,
          canModifyStop: null,
          canClosePosition: null,
          mockSuspect: false,
          probeError: 'adapter could not be instantiated (credentials missing?)',
        };
      } else {
        const canPlaceOrder = typeof adapter.placeOrder === 'function';
        const placeOrderSrc =
          canPlaceOrder && typeof adapter.placeOrder?.toString === 'function'
            ? String(adapter.placeOrder.toString())
            : '';
        result = {
          probed: true,
          supportsBrokerageDeclared:
            typeof adapter.supportsBrokerage === 'boolean' ? adapter.supportsBrokerage : null,
          canReadPositions: typeof adapter.getPositions === 'function',
          canPlaceOrder,
          canModifyStop: typeof adapter.modifyPosition === 'function',
          canClosePosition: typeof adapter.closePosition === 'function',
          // ── STUB DETECTION: read the adapter's OWN source, don't guess from its class name ──
          // ⚠️ Measured 2026-11-10: a class-name heuristic (/mock|stub/) MISSED
          // `InteractiveBrokersAdapter.placeOrder`, which logs "IBKR placeOrder called in mock
          // mode — no real execution" and then returns `{ success: true }`. That is a FAKE FILL
          // reported as a success, and it was counted in `provenTradeable`.
          // A self-declared stub is the only kind detectable at runtime, and it is the kind that
          // matters most: the adapter is telling you it does not work.
          mockSuspect: canPlaceOrder && STUB_MARKERS.test(placeOrderSrc),
          probeError: null,
        };
      }
    } catch (err) {
      result = {
        probed: false,
        supportsBrokerageDeclared: null,
        canReadPositions: null,
        canPlaceOrder: null,
        canModifyStop: null,
        canClosePosition: null,
        mockSuspect: false,
        probeError: String(err),
      };
    }

    this.probeCache.set(id, result);
    return result;
  }

  // ── warnings: the places a UI would otherwise show a confident lie ────────────

  private buildWarnings(
    id: string,
    cfg: any,
    reg: any,
    runtime: RuntimeCapability | null,
    live: LiveTrade | null = null,
  ): string[] {
    const w: string[] = [];

    // ── #1313 — CONNECTED BUT CANNOT TRADE ────────────────────────────────────────────────
    // Measured 2026-11-19: :5001 answered `/health` with `connected: true, tradeAllowed: false`
    // and refused every order `retcode 10027`. `runtime.canPlaceOrder` was `true` throughout,
    // because that field asks "does the adapter HAVE a placeOrder method", not "will the broker
    // accept one". Both facts are true and only one of them matters to whoever is reading.
    if (live && (live.canTrade === false || live.partiallyBlocked)) {
      const dead = (live.brokers ?? []).filter((b) => b.canTrade === false);
      const names = dead
        .map((b) => `#${b.brokerId ?? '?'}${b.account ? ` (${b.account})` : ''}`)
        .join(', ');
      // ⚠️ The partial case is the one that hid for 10 hours: one account works, so no alert
      // fired and every surface stayed green while the other account refused 100% of orders.
      const scope = live.partiallyBlocked
        ? '. Another account CAN trade, so NOTHING alerts about this one'
        : ', so the broker cannot trade at all';
      w.push(
        `CONNECTED BUT CANNOT TRADE — ${names || 'a bridge'} reports AutoTrading OFF or the API trade path disabled: ` +
        `EVERY order routed there is refused (retcode 10027)${scope}. ` +
        '`runtime.canPlaceOrder` describes the adapter, not the broker.',
      );
    }

    if (cfg && !reg) {
      w.push(
        `'${id}' is configured in broker_config but has no adapter registration — its ` +
          `tradingEnabled flag describes intent nothing can act on.`,
      );
    }
    if (!cfg && reg) {
      w.push(`'${id}' has an adapter registration but no broker_config row, so the app cannot show it.`);
    }
    if (cfg?.tradingEnabled === true && runtime && runtime.canPlaceOrder === false) {
      w.push(`tradingEnabled is true but the adapter defines no placeOrder — orders cannot be sent.`);
    }
    if (cfg?.tradingEnabled === true && runtime && runtime.probed === false) {
      w.push(`tradingEnabled is true but the adapter could not be instantiated, so it cannot be verified.`);
    }
    if (runtime?.supportsBrokerageDeclared === true && runtime.canPlaceOrder === false) {
      w.push(`supportsBrokerage is declared true but placeOrder is absent — the declaration is wrong.`);
    }
    if (runtime?.mockSuspect) {
      w.push(`placeOrder exists but the adapter class looks like a mock/stub; a returned order is not a fill.`);
    }

    return w;
  }

  private async safeConfigs(): Promise<any[]> {
    try {
      const res: any = await this.brokerConfig.findAll();
      return Array.isArray(res) ? res : (res?.brokers ?? []);
    } catch (err) {
      this.logger.warn(`[brokers] broker_config read failed: ${String(err)}`);
      return [];
    }
  }

  private safeHasCredentials(id: string): boolean | null {
    try {
      return this.adapterFactory.hasCredentials(id);
    } catch {
      return null;
    }
  }
}

export interface RuntimeCapability {
  /** false when the adapter exists but could not be constructed — every other field is null. */
  probed: boolean;
  supportsBrokerageDeclared: boolean | null;
  canReadPositions: boolean | null;
  canPlaceOrder: boolean | null;
  canModifyStop: boolean | null;
  canClosePosition: boolean | null;
  mockSuspect: boolean;
  probeError: string | null;
}

export interface LiveBridgeTrade {
  brokerId: number | null;
  connected: boolean;
  tradeAllowed: boolean | null;
  tradeapiDisabled: boolean | null;
  account: string | null;
  /** true = can trade now · false = definitely blocked · null = cannot judge. */
  canTrade: boolean | null;
}

export interface LiveTrade {
  observed: boolean;
  canTrade: boolean | null;
  connected: boolean;
  /** Some bridges blocked and some not — never rendered as plain 'healthy'. */
  partiallyBlocked: boolean;
  brokers: LiveBridgeTrade[];
}

export interface BrokerStatusRow {
  id: string;
  displayName: string;
  /** 'broker' when something can place an order or broker_config declares intent; else a data provider. */
  role: 'broker' | 'data-provider';
  isActive: boolean | null;
  tradingEnabled: boolean | null;
  supportedStyles: string[];
  supportedAssetTypes: string[];
  note: string | null;
  sortOrder: number;
  registered: boolean;
  declaredCapabilities: string[];
  credentialsConfigured: boolean | null;
  runtime: RuntimeCapability | null;
  connection: { observed: boolean; status: string; reason: string | null };
  /** Live per-bridge trading capability, when a bridge reported anything (#1313). */
  trade: LiveTrade | null;
  warnings: string[];
}

export interface BrokerStatusResponse {
  brokers: BrokerStatusRow[];
  summary: {
    total: number;
    registered: number;
    provenTradeable: number;
    provenStopMovable: number;
    up: number;
    unobserved: number;
    withWarnings: number;
  };
  generatedAt: string;
}
