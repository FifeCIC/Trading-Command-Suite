/**
 * SupporterPrompt — the in-app support ask (#1147 §2.2, phase 2).
 *
 * STEP IN THE PIPELINE: none. It sits in the app shell beside `PwaInstallPrompt` and touches no
 * trading path. It asks one question once every `supporter.cadenceDays`, and records the answer.
 *
 * ── WHERE THE DECISION COMES FROM ────────────────────────────────────────────────────────────────
 * `GET /api/supporter/status` returns the VERDICT (`eligible`), not the raw inputs. Re-computing
 * "should we ask?" here would create a second definition of the cadence, and the two would drift
 * while both looking plausible. The component's only jobs are: render what it is told, and report
 * the answer.
 *
 * ── WHY NOTHING RENDERS ON AN ERROR STATE ────────────────────────────────────────────────────────
 * `status: 'unavailable'` (and a failed request) render NOTHING — deliberately, and not as an
 * "empty fallback". A donation panel shipped in September 2026 whose only reachable state was the
 * unresolved-view fallback, i.e. it appeared exactly when the app could not answer. It was deleted
 * on 2026-09-17 for that reason. **An interruption triggered by an error is a bug wearing a banner**,
 * so silence is the correct render here — and it is silence about a PROMPT, never about data.
 * This is also why the non-render is not a `catch(() => ({}))` shape: there is no fabricated state,
 * only a decision not to interrupt.
 *
 * ── THE "SHOWN" RECORD ───────────────────────────────────────────────────────────────────────────
 * Rendering the prompt POSTs a "shown" record. Without it the cooldown would never start, and a
 * user who ignored the prompt would be asked again on the next request — the opposite of the
 * owner's constraint, *"wouldn't want to hassle users"*.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import styles from './SupporterPrompt.module.css';

const KIND = 'general';

export default function SupporterPrompt() {
  const [answered, setAnswered] = useState(false);
  const shownRecorded = useRef(false);

  const { data, isError } = useQuery({
    queryKey: ['supporter-status', KIND],
    queryFn: () => apiGet(`/api/supporter/status?kind=${KIND}`),
    // One attempt: this is an optional ask, not data the page needs. A retry storm on every page
    // load would cost more than the prompt is worth.
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const eligible = !isError && data?.status === 'ok' && data?.eligible === true;

  const record = useCallback((response) => {
    const body = { kind: KIND, response, context: window.location.pathname };
    return apiPost('/api/supporter/interaction', body).catch((err) => {
      // The answer is lost, but the prompt must still close — leaving it on screen after the user
      // said "not now" would be worse than the missing row. The server-side "shown" row has already
      // started the cooldown, so the next ask is still governed.
      // ⚠️ The error is logged WHOLE on purpose: `validate-notices.cjs` counts `x.message` renders in
      // this folder, and there is no human-readable string to render here anyway — the prompt never
      // surfaces this failure, it only declines to interrupt again.
      console.warn('[supporter] could not record response:', err);
    });
  }, []);

  // A ref, not state: this must fire once per MOUNT, and a re-render must not post again. A reload
  // posts again only if the server still says eligible — which it will not, because the shown row
  // is what the cooldown reads.
  useEffect(() => {
    if (!eligible || shownRecorded.current) return;
    shownRecorded.current = true;
    apiPost('/api/supporter/interaction', { kind: KIND, context: window.location.pathname }).catch(
      (err) => console.warn('[supporter] could not record shown:', err),
    );
  }, [eligible]);

  if (!eligible || answered) return null;

  const close = (response) => {
    setAnswered(true);
    record(response);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') close('dismissed');
  };

  const targets = Array.isArray(data.targets) ? data.targets : [];
  const donate = targets.find((t) => t.kind === 'donate');
  const secondary = targets.filter((t) => t.kind !== 'donate');

  return (
    <aside
      className={styles.prompt}
      aria-label="Supporter Programme"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className={styles.close}
        aria-label="Close the support prompt"
        onClick={() => close('dismissed')}
      >
        ✕
      </button>

      <p className={styles.title}>💚 Supporter Programme</p>

      <p className={styles.body}>
        This app is free, complete and open source — nothing is withheld. It is one
        person&rsquo;s work and it has no income. If it has earned its keep, you can help it
        keep going.
      </p>

      {donate && (
        <a
          className={styles.cta}
          href={donate.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => close('opened')}
        >
          {donate.label} <span aria-hidden="true">↗</span>
        </a>
      )}

      {secondary.length > 0 && (
        <p className={styles.links}>
          {secondary.map((t) => (
            <a
              key={t.id}
              href={t.url}
              target="_blank"
              rel="noopener noreferrer"
              title={t.note}
            >
              {t.label}
            </a>
          ))}
        </p>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.quiet} onClick={() => close('snoozed')}>
          Not now
        </button>
        <button type="button" className={styles.quiet} onClick={() => close('muted')}>
          Don&rsquo;t ask again
        </button>
      </div>

      <p className={styles.footnote}>
        Both options are in Settings → General → Supporter Programme.
      </p>
    </aside>
  );
}
