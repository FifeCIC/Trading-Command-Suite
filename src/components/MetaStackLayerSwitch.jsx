/**
 * MetaStackLayerSwitch — the META.Stack inclusion switch for ONE layer (#615).
 *
 * BEFORE: the only copy of this control lived inline in SettingsPage's "Automation"
 * section, where it rendered BOTH layers under one "META.Stack Control" heading.
 * AFTER:  each page embeds just its own layer, so the switch sits on the page it governs.
 * NEXT:   Automation embeds both (it owns "what is included in the loop"), Trading embeds
 *         `trading`, Scoring embeds `protocols`.
 *
 * WHY IT IS SHARED AND DELIBERATELY DUPLICATED
 * --------------------------------------------
 * The same switch appearing on two pages is intentional here, not an accident: the two
 * pages answer different questions ("is trading on, globally?" vs "may this loop dispatch?"),
 * and seeing the same control in both places is what makes the link between them legible.
 * Duplication is only a hazard when the two copies can DISAGREE — so this is one component
 * with one query key, not two implementations.
 *
 * ⚠️ WARNING — the previous inline version swallowed failures:
 *     apiPost('/api/automation/layer', …).catch(() => {})
 *   A rejected switch looked identical to a successful one: the buttons re-read stale state
 *   and the user was told nothing. Turning trading OFF is the safety-critical direction, so a
 *   silent failure here is the worst kind — the user believes trading is off and it is not.
 *   The error is now surfaced via NoticeBlock. (Same class as the market-tape two-store
 *   no-op and the seeder's silent partial success.)
 *
 * ⚠️ The mandate hierarchy is Protocol → Trading, and it is REAL:
 *   - Protocols OFF → the tick skips scoring entirely: no scoring, no signals, no trading.
 *   - Trading OFF   → scores and signals are still produced; dispatch is blocked.
 *   Trading OFF is also the restart default (`automation-loop.service.ts`), so no restart can
 *   silently re-enable trading. The hint text states this because the asymmetry is not
 *   guessable from two identical-looking buttons.
 *
 * ⚠️ Only 'protocols' and 'trading' are accepted by POST /api/automation/layer. There is NO
 *   directives or bots kill switch at this level — directive `active` and per-bot enablement
 *   are row-level flags with their own endpoints. Do not add a layer here without adding it
 *   to `setLayer()` first; the endpoint throws BadRequest for an unknown layer.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error.js';
import NoticeBlock from './NoticeBlock';
import { SettingRow, TogglePair } from './SettingsControls';

const LAYER_META = {
  protocols: {
    label: 'Protocols / Scoring',
    hint:
      'OFF stops protocol scoring entirely — no scoring, no signals, no trading. This is the ' +
      'first gate in the mandate hierarchy, so it also silences every bot below it.',
  },
  trading: {
    label: 'Trading',
    hint:
      'OFF keeps scoring and signals running but blocks every dispatch. Restricted to paper. ' +
      'Defaults OFF after every restart — no restart can silently re-enable trading.',
  },
};

export default function MetaStackLayerSwitch({ layer }) {
  const qc = useQueryClient();
  const meta = LAYER_META[layer];

  const { data: status } = useQuery({
    queryKey: ['automation-layers'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 15_000,
  });

  const mutation = useMutation({
    mutationFn: (enabled) => apiPost('/api/automation/layer', { layer, enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-layers'] }),
  });

  if (!meta) return null;

  // `?? true` for protocols / `?? false` for trading mirrors the backend's own defaults in
  // automation-loop.service.ts — if the status read fails, the switch shows what the loop
  // would actually be doing, rather than a guess that happens to look reassuring.
  const enabled = layer === 'protocols'
    ? (status?.layers?.protocolsEnabled ?? true)
    : (status?.layers?.tradingEnabled ?? false);

  return (
    <>
      <SettingRow label={meta.label} hint={meta.hint}>
        <TogglePair value={enabled} onChange={(next) => mutation.mutate(next)} />
      </SettingRow>
      {mutation.isError && (
        <NoticeBlock
          notice={noticeFromError(mutation.error, 'TCS-SYS-007', {
            operation: `switch the ${meta.label} layer`,
          })}
          compact
        />
      )}
    </>
  );
}
