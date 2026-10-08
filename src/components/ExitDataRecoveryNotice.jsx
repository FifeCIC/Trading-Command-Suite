/**
 * ExitDataRecoveryNotice — the OPTIONAL prompt + button for exit-data gaps (#1093).
 *
 * ⚠️ WHY THIS EXISTS, IN THE OWNER'S OWN TERMS. The recovery below replaces a manual desktop
 * ritual: formerly, chasing an old close meant *"Toolbox → History tab → right-click → Period →
 * Custom, set 15 Sep 2026 → now"* inside the MT5 terminal — which the owner rejected outright as
 * falling *"way outside the automation this app is designed to offer"*. The direction given was
 * *"an optional prompt with button where/when there is a gap in the information and the user
 * feels they need that data"*. So this renders ONLY when the gap count is non-zero, says how many
 * closed trades lack a recorded exit, and offers one button that asks the brokers' terminals
 * again from inside the app.
 *
 * ⚠️ OPTIONAL MEANS DISMISSIBLE, AND DISMISSAL SURVIVES NEW GAPS ONLY BY CHANGING COUNT.
 * The dismissal stores the count it was dismissed AT; the prompt returns when the count differs
 * (i.e. new unattributed closes have appeared). It is a prompt, not a nag.
 *
 * ⚠️ THE RESULT IS RENDERED VERBATIM FROM THE SERVER. That note is generated server-side
 * (`recoverExitDataGaps`) precisely so this component cannot embellish it — the first live run of
 * the button produced a report that counted re-finalisations as recoveries and spoke for a broker
 * that was never asked, and the fix was to make the server's note authoritative. Do not paraphrase
 * it here.
 *
 * ⚠️ DATA HONESTY. `gaps` failing to load renders NOTHING, deliberately: this is an optional
 * prompt, and a failed check makes no claim either way — but the two must not be conflated, so the
 * failure is logged to the console rather than painted as "no gaps". (The journal itself always
 * shows the real chips; this banner is additive.)
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error';
import NoticeBlock from './NoticeBlock';
import './exit-data-recovery-notice.css';

const DISMISS_KEY = 'tj-exit-gaps-dismissed-at';

const readDismissedAt = () => {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
};

export default function ExitDataRecoveryNotice() {
  const qc = useQueryClient();
  const [dismissedAt, setDismissedAt] = useState(readDismissedAt);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);

  const gapsQuery = useQuery({
    queryKey: ['exit-data-gaps'],
    queryFn: () => apiGet('/api/providers/exit-data/gaps?provider=mt5'),
    staleTime: 60_000,
    retry: false,
  });

  const recover = useMutation({
    mutationFn: () => apiPost('/api/providers/exit-data/recover?provider=mt5'),
    onSuccess: (data) => {
      setFailure(null);
      setResult(data);
      qc.invalidateQueries({ queryKey: ['exit-data-gaps'] });
    },
    onError: (err) => setFailure(noticeFromError(err)),
  });

  const gaps = gapsQuery.data;
  const count = gaps?.count ?? 0;

  // Render nothing until there is a MEASURED gap, and nothing while dismissed at this count.
  if (gapsQuery.isError) {
    // eslint-disable-next-line no-console
    console.debug('[exit-data-recovery] gap check failed — not rendering the optional prompt');
    return null;
  }
  if (!gaps || count === 0) return null;
  // ⚠️ DISMISSAL WINS OVER A VISIBLE RESULT. The first version kept the banner up while a result
  // was on screen (`!result && …`), so pressing Dismiss after a recovery did nothing visible —
  // the button appeared dead. Measured in the browser, 2026-10-08. The result is transient; the
  // dismissal is the user's decision.
  if (dismissedAt != null && String(dismissedAt) === String(count)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(count));
    } catch {
      /* private mode — dismissal is then session-only, which is acceptable */
    }
    setDismissedAt(String(count));
  };

  const symbols = (gaps.bySymbol || []).slice(0, 4)
    .map((s) => `${s.symbol} ×${s.n}`)
    .join(' · ');

  return (
    <section className="edrn" aria-label="Exit data recovery">
      <div className="edrn-head">
        <span className="edrn-icon" aria-hidden="true">🩺</span>
        <div className="edrn-copy">
          <p className="edrn-title">
            <strong>{count}</strong> closed trade{count === 1 ? '' : 's'} have no recorded exit reason
          </p>
          <p className="edrn-sub">
            They were finalised from a price snapshot rather than the broker&rsquo;s own closing deal, so
            &ldquo;what closed it&rdquo; is unknown for them. Most by volume: {symbols}.
          </p>
        </div>
        <div className="edrn-actions">
          <button
            type="button"
            className="edrn-btn edrn-btn-primary"
            onClick={() => recover.mutate()}
            disabled={recover.isPending}
            aria-busy={recover.isPending}
          >
            {recover.isPending ? 'Asking the terminals…' : result ? 'Try again' : 'Try to recover'}
          </button>
          <button type="button" className="edrn-btn" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>

      {failure && (
        <div className="edrn-result">
          <NoticeBlock notice={failure} compact />
        </div>
      )}

      {result && (
        <div className="edrn-result" role="status">
          <p className="edrn-result-line">
            <strong>
              Recovered {result.recovered} of {result.requested}
            </strong>
            {result.recovered > 0 && ' — those rows now name their closer.'}
          </p>
          <p className="edrn-result-note">{result.note}</p>
        </div>
      )}
    </section>
  );
}
