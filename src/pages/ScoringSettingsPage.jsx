/**
 * ScoringSettingsPage — what the scoring layer counts as a signal. (#617)
 *
 * WHY THIS IS ITS OWN PAGE
 * ------------------------
 * "Scoring" is one of the four META.Stack layers, and the most load-bearing one: on
 * 2026-09-10 the app stopped trading entirely because the percentage DENOMINATOR changed and
 * every threshold silently became unreachable. The thresholds that decide BUY / SELL / HOLD
 * are therefore not an incidental setting — they are the thing that was invisible, and they
 * get a page rather than a section buried among a dozen others.
 *
 * ⚠️ `id="trade-thresholds"` is preserved from the original General page. It is an anchor a
 *   previous session referred to by name; renaming it would break that reference silently.
 *
 * ⚠️ The threshold values are READ-ONLY. They are derived from the scoring classification
 *   config, not stored as a preference, so an editable field would be a control that writes
 *   nowhere. `ScoringThresholds` owns the query and the verdict mapping so this page and the
 *   Trading page cannot disagree about what "CANNOT FIRE" means.
 */

import { SettingRow, SettingsSection, MovedNote } from '../components/SettingsControls';
import MetaStackLayerSwitch from '../components/MetaStackLayerSwitch';
import { ThresholdClassification, BotThresholdsTable } from '../components/ScoringThresholds';
import { usePreferences } from '../core/hooks/usePreferences';
import './settings.css';

export default function ScoringSettingsPage() {
  const { prefs, set } = usePreferences();

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Scoring</h1>
        <p>
          What the scoring layer counts as a signal, and the thresholds a reading must clear
          before it can become a trade.
        </p>
      </header>

      <SettingsSection
        id="scoring-layer"
        title="Scoring layer"
        desc="The META.Stack kill switch. This is the first gate in the mandate hierarchy — nothing below it can run while it is off."
      >
        <MetaStackLayerSwitch layer="protocols" />
        <MovedNote>
          The same switch appears on <a href="/settings/automation">Automation</a>, which is
          where the loop and the queue are configured.
        </MovedNote>
      </SettingsSection>

      <SettingsSection
        id="trade-thresholds"
        title="Trade Thresholds"
        desc="Every threshold that decides whether a signal becomes a trade, with the highest score the protocol has actually produced. A threshold above its achieved value is a bot that can never fire."
      >
        <ThresholdClassification />
      </SettingsSection>

      <SettingsSection
        id="scoring-bot-bars"
        title="Bot threshold vs achieved ceiling"
        desc="The same reading, per bot. Each bot has its own threshold, so 'can this bot ever fire?' is a per-bot question."
      >
        <BotThresholdsTable />
      </SettingsSection>

      <SettingsSection
        id="scoring-defaults"
        title="Defaults"
        desc="Pre-filled values for the scoring and research views. These do not change how anything is scored."
      >
        <SettingRow label="Default Protocol" hint="Pre-selected protocol in Scoring Workbench and SEES pages.">
          <input
            type="text"
            className="settings-input"
            value={prefs.defaultProtocol}
            onChange={e => set('defaultProtocol', e.target.value)}
            placeholder="btc-speed-v1"
          />
        </SettingRow>
        <SettingRow label="Default Signal Symbols" hint="Comma-separated tickers pre-filled in Scoring Workbench.">
          <input
            type="text"
            className="settings-input"
            value={prefs.defaultSignalSymbols}
            onChange={e => set('defaultSignalSymbols', e.target.value)}
            placeholder="AAPL, NVDA, MSFT"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="scoring-where"
        title="Where scoring is configured"
        desc="This page holds the thresholds. The building blocks live with the thing they build."
      >
        <MovedNote>
          <a href="/protocols/directives-registry">Directives Registry</a> — add and edit
          directives, and toggle each one active/inactive.{' '}
          <a href="/protocols/protocols-registry">Protocols Registry</a> — compose directives into
          a scored protocol.{' '}
          <a href="/scoring/live-ordering-stack">Ladder</a> — see the scoring line as it runs.
        </MovedNote>
      </SettingsSection>
    </div>
  );
}
