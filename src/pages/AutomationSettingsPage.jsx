/**
 * AutomationSettingsPage — what the automation loop is, and WHAT IS INCLUDED IN IT. (#617)
 *
 * WHAT THIS PAGE OWNS
 * -------------------
 *   1. The loop itself — running/stopped, tick cadence, emergency stop.
 *   2. The QUEUE — the bot queue kill switch and its inter-trade pacing.
 *   3. INCLUSION — the META.Stack layer switches, i.e. which layers are allowed to take
 *      part in a tick at all.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN
 * ---------------------------------
 *   - Per-bot configuration (bars, size, SL/TP) → Trading. This page decides whether the
 *     loop runs; the Trading page decides what each bot does when it does.
 *   - Scoring behaviour → Scoring.
 *
 * ⚠️ FRAMING — "Automation" is the LOOP, not a bot.
 *   There are many bots and the user can create more; each trading setup is its own bot.
 *   A page called "Bot & Automation" implied a single bot, which is why the two are split:
 *   Automation is the machinery that runs bots, and the bots live with the trading config.
 *
 * ⚠️ INCLUSION SWITCHES ARE DUPLICATED ON PURPOSE (#617 decision).
 *   `MetaStackLayerSwitch` also appears on Trading and Scoring. The duplication is the
 *   feature: seeing "trading is OFF" on the page that governs trading is how the link
 *   between the loop and the layer stays visible. They share one component and one React
 *   Query cache key, so the two copies cannot disagree.
 *
 * ⚠️ NO directives/bots kill switch exists at this level, and this page does NOT pretend
 *   otherwise. POST /api/automation/layer accepts only 'protocols' and 'trading' and throws
 *   BadRequest for anything else (automation-loop.service.ts `setLayer`). Directive `active`
 *   and per-bot enablement are row-level flags with their own endpoints, so this page links
 *   to them instead of drawing a switch that would silently do nothing.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error.js';
import NoticeBlock from '../components/NoticeBlock';
import MetaStackLayerSwitch from '../components/MetaStackLayerSwitch';
import { SettingRow, SettingsSection, TogglePair, MovedNote } from '../components/SettingsControls';
import { usePreferences } from '../core/hooks/usePreferences';
import './settings.css';

/** `loopEnabled` etc. all come from GET /api/automation/status. */
function LoopSection() {
  const qc = useQueryClient();
  const { prefs, set } = usePreferences();

  const { data: status, isLoading } = useQuery({
    queryKey: ['automation-status-settings'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['automation-status-settings'] });
    qc.invalidateQueries({ queryKey: ['automation-layers'] });
  };

  const start = useMutation({ mutationFn: () => apiPost('/api/automation/start'), onSuccess: invalidate });
  const stop = useMutation({ mutationFn: () => apiPost('/api/automation/stop'), onSuccess: invalidate });
  const emergency = useMutation({ mutationFn: () => apiPost('/api/automation/emergency-stop'), onSuccess: invalidate });
  const interval = useMutation({
    mutationFn: (ms) => apiPost('/api/automation/interval', { ms }),
    onSuccess: invalidate,
  });

  const loopEnabled = status?.loopEnabled ?? null;
  const exec = status?.execution;

  return (
    <>
      <SettingRow
        label="Loop"
        hint="The tick engine. When running, it evaluates every active bot on each tick — whether anything is DISPATCHED is decided separately by the layer switches below."
      >
        {isLoading ? (
          <span className="settings-hint-text">reading…</span>
        ) : loopEnabled == null ? (
          // ⚠️ "cannot judge" is rendered differently from "off". An unreachable API must
          // never look like a stopped loop — that is the silent-empty anti-pattern.
          <span className="threshold-unknown">status unavailable</span>
        ) : (
          <div className="inline-actions">
            <button type="button" className={loopEnabled ? 'cta' : ''} onClick={() => start.mutate()} disabled={loopEnabled}>
              ▶ Run
            </button>
            <button type="button" className={!loopEnabled ? 'cta' : ''} onClick={() => stop.mutate()} disabled={!loopEnabled}>
              ■ Stop
            </button>
          </div>
        )}
      </SettingRow>

      <SettingRow
        label="Tick interval"
        hint="Milliseconds between loop ticks. Lower is more responsive and more expensive; each tick re-evaluates every active bot."
      >
        <input
          type="number" min="1000" max="600000" step="1000"
          className="settings-input settings-input-sm"
          value={status?.tickIntervalMs ?? 15000}
          onChange={(e) => interval.mutate(Math.max(1000, parseInt(e.target.value, 10) || 15000))}
        />
      </SettingRow>

      <SettingRow
        label="Effective execution"
        hint="Gate 7 needs BOTH the trading layer AND a broker flag. The layer switch alone is NOT enough to place a real order, so this states the resolved result rather than one input to it."
      >
        <code>{exec?.mode ?? 'unknown'}</code>
      </SettingRow>

      <SettingRow
        label="Auto-Start on Server Boot"
        hint="When ON, the loop and MT5 trading state are restored automatically when the server starts. When OFF, you must start the loop by hand. Note this only restores the loop — trading itself stays OFF until you switch the trading layer on."
      >
        <TogglePair value={prefs.autoStartAutomation} onChange={(next) => set('autoStartAutomation', next)} />
      </SettingRow>

      <SettingRow
        label="Emergency stop"
        hint="Switches the trading layer OFF immediately and persists it, so an operator stop survives a restart. Scoring and signals keep running — this stops orders, not analysis."
      >
        <button
          type="button"
          className="cta"
          onClick={() => { if (window.confirm('Switch the trading layer OFF and block all dispatch?')) emergency.mutate(); }}
        >
          ✕ Emergency Stop
        </button>
      </SettingRow>

      {(start.isError || stop.isError || emergency.isError || interval.isError) && (
        <NoticeBlock
          notice={noticeFromError(
            start.error || stop.error || emergency.error || interval.error,
            'TCS-SYS-007',
            { operation: 'control the automation loop' },
          )}
          compact
        />
      )}
    </>
  );
}

/**
 * BotQueueSection — the bot queue kill switch and pacing.
 *
 * ⚠️ This is the surface issue #722 said had gone missing ("bot-queue settings lost their
 *   only UI surface"). The config has existed at GET/POST /api/automation/bot-queue since
 *   #714 Stage 3, persisted in global_setting — reachable from the API and from nowhere in
 *   the UI. A stored setting nobody can see is indistinguishable from a setting that does
 *   not exist, which is why it lands here rather than staying buried.
 */
function BotQueueSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['automation-bot-queue'],
    queryFn: () => apiGet('/api/automation/bot-queue').catch(() => null),
    refetchInterval: 20_000,
  });

  const save = useMutation({
    mutationFn: (body) => apiPost('/api/automation/bot-queue', body),
    onSuccess: (fresh) => qc.setQueryData(['automation-bot-queue'], fresh),
  });

  return (
    <>
      <SettingRow
        label="Bot queue"
        hint="When ON, bot entries are serialised through a queue instead of firing together. OFF means every bot that clears its bar can dispatch on the same tick."
      >
        <TogglePair
          value={data?.enabled === true}
          onChange={(next) => save.mutate({ enabled: next })}
        />
      </SettingRow>
      <SettingRow
        label="Inter-trade delay (minutes)"
        hint="Minimum gap the queue leaves between two bot trades. 0 = no pacing. This is a throttle on how fast the queue drains, not a cooldown on any one bot."
      >
        <input
          type="number" min="0" max="1440" step="1"
          className="settings-input settings-input-sm"
          value={data?.interTradeDelayMinutes ?? 0}
          onChange={(e) => save.mutate({ interTradeDelayMinutes: Math.max(0, parseInt(e.target.value, 10) || 0) })}
        />
      </SettingRow>
      <SettingRow
        label="Last bot trade"
        hint="When the queue last let a bot trade through. A queue that is ON with no timestamp has not yet admitted anything — which is a different situation from a queue that is OFF."
      >
        <code>{data?.lastBotTradeAt ? new Date(data.lastBotTradeAt).toLocaleString() : 'never'}</code>
      </SettingRow>
      <SettingRow
        label="Job queue mode"
        hint="Background job processing is set by QUEUE_MODE in nest/.env and requires a server restart — it is not a user toggle, which is why it is shown rather than offered."
      >
        <code>env: QUEUE_MODE</code>
      </SettingRow>
      <MovedNote>
        Inspect and cancel individual queued protocol runs on{' '}
        <a href="/protocols/protocol-queue">Protocol Queue</a> and scheduled jobs on{' '}
        <a href="/status/scheduled-jobs">Scheduled Jobs</a> — both moved out of the deleted
        /automation/execution-queue page (2026-10-02, owner direction). Live loop activity is now on{' '}
        <a href="/trading/trade-journal">the Trade Journal</a>, and the global safety rules are in
        the section below.
      </MovedNote>
      {save.isError && (
        <NoticeBlock
          notice={noticeFromError(save.error, 'TCS-SYS-007', { operation: 'save the bot queue settings' })}
          compact
        />
      )}
    </>
  );
}

/**
 * AutomationRulesSection — DB-backed automation rules.
 *
 * ⚠️ FIXED 2026-09-16 (§617): the toggle previously called
 *     apiGet(`/api/automation/rules/${id}`, { method: 'PUT', body: … })
 *   `apiGet` takes ONE argument and ignores the second, so the "call" was a GET and the
 *   button changed nothing at all — silently, with no error, on a control that looks like
 *   it worked. The brief "no rules configured" text hid it here (the table is empty), but
 *   the bug was live for anyone who did have seeded rules. Now uses apiPut.
 */

/**
 * BrokerConfigSection — which brokers take part in a tick, and how each behaves.
 *
 * ⚠️ MOVED 2026-10-02 (owner, Page Walkthrough — option A) from the "⚙ Broker Config" panel of
 * /automation/automation-dashboard, which is deleted with the Automation area.
 *
 * ⚠️ THIS IS THE ONLY UI FOR THE PER-BROKER `enabled` FLAG. `POST /api/automation/toggle` is called
 * from nowhere else — measured by grepping every `/api/automation/toggle` reference in `src/`.
 * Dropping the panel without moving it would have removed the ability to switch a broker on or off,
 * silently.
 *
 * ⚠️ `enabled` IS NOT `tradingEnabled`. `ScreenOptions` posts `/api/automation/config` with
 * `tradingEnabled` for mt5 only, which is why "Broker Config is already covered" was WRONG when
 * first reported, and why this section exists rather than being skipped.
 */
function BrokerConfigSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['automation-brokers'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 15_000,
  });
  const brokerStates = data?.brokerStates || {};

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation-brokers'] });
  const toggle = useMutation({
    mutationFn: (body) => apiPost('/api/automation/toggle', body),
    onSuccess: invalidate,
  });
  const config = useMutation({
    mutationFn: (body) => apiPost('/api/automation/config', body),
    onSuccess: invalidate,
  });

  if (isLoading) return <p className="settings-section-desc">Loading brokers…</p>;

  const ids = Object.keys(brokerStates);
  if (ids.length === 0) {
    return (
      <p className="settings-section-desc">
        No brokers configured yet. Each broker the loop sees is initialised here on the first tick
        that observes it — an empty list means none has been seen, not that the feature is broken.
      </p>
    );
  }

  return (
    <>
      {ids.map((brokerId) => {
        const bs = brokerStates[brokerId];
        return (
          <SettingRow
            key={brokerId}
            label={brokerId}
            hint="Enabled decides whether this broker takes part in a tick at all."
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <TogglePair
                value={!!bs.enabled}
                onChange={(next) => toggle.mutate({ target: brokerId, enabled: next })}
              />
              {/* ⚠️ §9.14 — switching a broker's Trading flag ON is "start the trading bot" FOR THAT
                  BROKER, so the CONTROL is premium-only, gated by ABSENCE rather than disabled. Its
                  endpoint is deliberately not gated: Threshold and Confirm below use the same one in
                  the free edition. */}
              {bs.enabled && (
                <>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem' }}>
                    Trading
                    <TogglePair
                      value={!!bs.tradingEnabled}
                      onChange={(next) => config.mutate({ brokerId, tradingEnabled: next })}
                    />
                  </label>
                  {/* ⚠️ The bounds were {40,95} with a fallback of `|| 65` (#839) — pre-rescale
                      numbers. The ADR-011 scale measures 10-33, so a bar of 65 could never be
                      cleared: the bot would silently never trade while looking configured here.
                      An EMPTY input must not invent a bar, so the commit is SKIPPED — the server owns
                      this number (src/core/api/signals.js) and a guess here would create a second
                      owner, while skipping cannot. */}
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem' }}>
                    Threshold
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={bs.tradeThreshold ?? ''}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (Number.isFinite(v)) config.mutate({ brokerId, tradeThreshold: v });
                      }}
                      style={{ width: 72, background: 'var(--bg-elev)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 6, padding: '0.15rem 0.35rem' }}
                    />
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem' }}>
                    Confirm
                    <TogglePair
                      value={!!bs.requireConfirmation}
                      onChange={(next) => config.mutate({ brokerId, requireConfirmation: next })}
                    />
                  </label>
                </>
              )}
            </span>
          </SettingRow>
        );
      })}
      {(toggle.isError || config.isError) && (
        <NoticeBlock
          notice={noticeFromError(toggle.error || config.error, 'TCS-SYS-007', {
            operation: 'update the broker config',
          })}
          compact
        />
      )}
    </>
  );
}

function AutomationRulesSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['automation-rules-settings'],
    queryFn: () => apiGet('/api/automation/rules').catch(() => []),
    staleTime: 60_000,
  });
  const rules = Array.isArray(data) ? data : [];

  const toggle = useMutation({
    mutationFn: ({ id, enabled }) => apiPut(`/api/automation/rules/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-rules-settings'] }),
  });

  return (
    <>
      {rules.length === 0 ? (
        <p className="settings-section-desc">
          No automation rules configured. Rules are seeded from the database, so an empty list
          means none have been seeded — not that the feature is broken.
        </p>
      ) : (
        rules.map((rule) => (
          <SettingRow
            key={rule.id}
            label={rule.name}
            // ⚠️ The THRESHOLD is shown because deleting /automation/automation-rules removed the only
            // place that displayed it. It is READ-ONLY here on purpose: the rules page's slider moved
            // LOCAL STATE and never called the API — it looked editable and was not, and it was lost on
            // reload. Reimplementing that control would recreate the defect rather than fix it.
            hint={`${rule.description}${
              rule.config?.threshold != null
                ? ` — Threshold: ${rule.config.threshold}${rule.config.unit || ''}`
                : ''
            }`}
          >
            <TogglePair
              value={!!rule.enabled}
              onChange={(next) => toggle.mutate({ id: rule.id, enabled: next })}
            />
          </SettingRow>
        ))
      )}
      {toggle.isError && (
        <NoticeBlock
          notice={noticeFromError(toggle.error, 'TCS-SYS-007', { operation: 'toggle an automation rule' })}
          compact
        />
      )}
    </>
  );
}

export default function AutomationSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Automation</h1>
        <p>
          The loop, the queue, and which META.Stack layers are allowed to take part. This page
          controls whether automation runs — how each bot behaves is on Trading.
        </p>
      </header>

      <SettingsSection
        id="loop"
        title="Loop"
        desc="The tick engine that evaluates every active bot. Nothing here places an order on its own."
      >
        <LoopSection />
      </SettingsSection>

      <SettingsSection
        id="inclusion"
        title="What is included in the loop"
        desc="META.Stack layer switches. These are the top-level kill switches — they gate every bot below them, so they are duplicated on the pages they govern."
      >
        <MetaStackLayerSwitch layer="protocols" />
        <MetaStackLayerSwitch layer="trading" />
        <MovedNote>
          <strong>Directives</strong> and individual <strong>bots</strong> have no kill switch at
          this level — they are row-level flags. Toggle directives on{' '}
          <a href="/protocols/directives-registry">Directives Registry</a> and each bot on{' '}
          <a href="/settings/trading-settings">Trading</a>. This page deliberately does not
          draw switches for capabilities that do not exist.
        </MovedNote>
      </SettingsSection>

      <SettingsSection
        id="queue"
        title="Queue"
        desc="How eligible bot entries are ordered and paced once the loop has decided they may dispatch."
      >
        <BotQueueSection />
      </SettingsSection>

      <SettingsSection
        id="brokers"
        title="Brokers"
        desc="Which brokers take part in a tick, and how each behaves. Enabled is participation; Trading is the order-placing switch, which is part of the full edition."
      >
        <BrokerConfigSection />
      </SettingsSection>

      {/* ⚠️ ABSORBED /automation/automation-rules 2026-10-02 (owner: "Ensure they exist in the settings
          area as they are styled on this page ... I want this page deleted").
          ⚠️ THE COPY BELOW WAS CORRECTED BEFORE SHIPPING. The first version said "Hard limits no
          strategy can bypass. Every rule is evaluated BEFORE an order is sent" — copied from the old
          page — and that is FALSE. MEASURED the same day: the table is empty (the API returns []) and
          nothing in the backend reads it: the only consumers are a CRUD endpoint and the config
          export. Copying that sentence would have re-created the very defect #1062 records — a claim
          with no observation behind it. */}
      <SettingsSection
        id="rules"
        title="Global safety rules"
        desc="⚠️ NOT ENFORCED YET. Rules are stored in the database and toggled here, but nothing in the backend reads them: measured 2026-10-02 the table is EMPTY (GET /api/automation/rules returns []) and the only consumers are this endpoint and the config export. So a rule enabled here is a DECLARATION, not an active gate. Enforcement is a change to the trade path and needs its own decision — see #1062."
      >
        <AutomationRulesSection />
      </SettingsSection>
    </div>
  );
}
