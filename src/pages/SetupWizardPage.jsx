/**
 * SetupWizardPage — the first-run experience, at /status/setup.
 * ============================================================
 * Ships to every user, and `/status/setup` is reachable from the Status area, so for many this is
 * the first screen the app shows them.
 *
 * ⚠️ WHAT THIS REPLACED, AND WHY (measured 2026-09-25). The previous version was a seven-chip
 * wizard that revealed one screen of developer diagnostics per click, and its copy told the user
 * to run `npx prisma db seed`, to copy `.env.example`, and to `docker compose up`. Three defects,
 * all still visible in its stylesheet and its strings:
 *
 *   1. A DEVELOPER CHECKLIST on a user-facing first run — contradicts C1
 *      (FREE-EDITION-PLAN.md §7: installation must be "user-oriented and guided, not a
 *      developer checklist").
 *   2. HARDCODED HEX throughout its CSS (#00f5ff, #1a1a1a, #888 …) — contradicts both
 *      `ui-standards` ("never hardcode a hex value in a page/component CSS file") and
 *      `accessibility-policy` ("no hardcoded hex values in page/component CSS").
 *   3. NOT THEME-AWARE, so it rendered dark-on-dark in light mode — the cyan/green it used were
 *      not any theme's tokens.
 *
 * The technical strings are NOT deleted. They moved behind `Show technical details`, so the owner
 * keeps the diagnostic and a new user is never handed a shell command by default.
 *
 * ⚠️ NO TIMERS, AND NO FAKE PROGRESS. A step's state is DERIVED from its queries:
 *       any query still loading -> running | every REQUIRED check passes -> done | else attention
 * A bar advanced on a timer would be a fabricated number — the failure mode
 * `development-philosophy.instructions.md` §7 names.
 *
 * ⚠️ ALL STEPS ARE VISIBLE AT ONCE and complete in sequence. The old version made the reader click
 * through chips to discover whether their install worked, and tabs let them jump to a step that
 * could not have run yet — a state it could actually present.
 *
 * ⚠️ Animation is CSS-only, deliberately: the global `prefers-reduced-motion` query in `index.css`
 * covers CSS animations, whereas `motion/react` would need its own handling to satisfy the
 * accessibility policy. Same reason there is no spinner library here.
 *
 * Data: GET /api/version · /api/symbols · /api/market-data/freshness · /api/providers/health
 */
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './setup-wizard.css'

/** The three things that must be true before the app is usable. Order is the running order. */
const STEPS = [
  {
    id: 'services',
    title: 'The app is running',
    promise: 'Its background service and your database answered.',
  },
  {
    id: 'market',
    title: 'Market data is loaded',
    promise: 'Instruments, and the price history behind them.',
  },
  {
    id: 'connections',
    title: 'Your data sources are connected',
    promise: 'The providers this app reads from.',
  },
]

/** Plain-language state words. The row's accessible name carries these — never the glyph alone. */
const STATE_WORD = {
  running: 'In progress',
  done: 'Complete',
  attention: 'Needs attention',
}

/**
 * A check carries TWO sentences on purpose:
 *   `plain`     — what a new user needs: what is wrong, with no shell command in sight.
 *   `technical` — the owner's diagnostic: the command or the raw value.
 * `optional: true` means the app is usable without it, so it renders as a note and never blocks
 * the step. Collapsing "fine" into "failed" is the defect `development-philosophy` §7 names.
 */
function Check({ ok, optional, label, plain, technical }) {
  const state = ok ? 'pass' : optional ? 'note' : 'fail'
  return (
    <li className={`sfr-check sfr-check--${state}`}>
      <span className="sfr-check-mark" aria-hidden="true">{ok ? '✓' : optional ? '·' : '✗'}</span>
      <span className="sfr-check-body">
        <span className="sfr-check-label">
          {label}
          {optional && !ok && <span className="sfr-check-opt"> — optional</span>}
        </span>
        {!ok && <span className="sfr-check-plain">{plain}</span>}
        {/* Native disclosure: keyboard-accessible and screen-reader-correct without any state. */}
        {technical && (
          <details className="sfr-check-tech">
            <summary>Details</summary>
            <code>{technical}</code>
          </details>
        )}
      </span>
    </li>
  )
}

/** One step: a status glyph, a title, and its checks. */
function Step({ title, promise, status, checks, index }) {
  return (
    <li className={`sfr-step sfr-step--${status}`} style={{ animationDelay: `${index * 0.04}s` }}>
      <span className="sfr-glyph" aria-hidden="true">
        {status === 'done' ? '✓' : status === 'attention' ? '!' : ''}
      </span>
      <div className="sfr-step-body">
        <p className="sfr-step-title">{title}</p>
        <p className="sfr-step-promise">{promise}</p>
        <ul className="sfr-checks">
          {checks.map((c) => (
            <Check key={c.label} {...c} />
          ))}
        </ul>
      </div>
      <span className="sfr-step-state">{STATE_WORD[status]}</span>
    </li>
  )
}

export default function SetupWizardPage() {
  const version = useQuery({ queryKey: ['setup-version'], queryFn: () => apiGet('/api/version') })
  const symbols = useQuery({ queryKey: ['setup-symbols'], queryFn: () => apiGet('/api/symbols') })
  const freshness = useQuery({
    queryKey: ['setup-freshness'],
    queryFn: () => apiGet('/api/market-data/freshness'),
  })
  const providers = useQuery({
    queryKey: ['setup-providers'],
    queryFn: () => apiGet('/api/providers/health'),
  })

  const v = version.data ?? {}
  const svc = v.services ?? {}
  const s = symbols.data ?? {}
  const syms = Array.isArray(s.symbols) ? s.symbols : []
  const f = freshness.data ?? {}
  const freshes = Array.isArray(f.results) ? f.results : []
  const marketDataOk = freshes.length > 0
  const freshCount = freshes.filter((r) => r.status === 'fresh').length
  const p = providers.data ?? {}
  const provs = Array.isArray(p.providers) ? p.providers : []

  const apiOk = Boolean(v.version)
  const dbOk = svc.databaseConnected === true
  const dbConfigured = svc.database === true
  const symbolsOk = syms.length >= 3
  const providersOk = provs.length > 0
  const queueEnabled = svc.queue === true
  const alpacaConfigured = provs.some((pr) => pr.provider === 'alpaca' && pr.credentialsConfigured)

  /**
   * Per-step checks. Every entry carries TWO sentences deliberately:
   *   `plain`     — for a new user: what is wrong, with no shell command in sight.
   *   `technical` — for the owner: the command or the raw value, behind a disclosure.
   * `optional: true` means the app is usable without it, so it renders as a note and NEVER blocks
   * the step. Collapsing "fine" into "failed" is the defect `development-philosophy` §7 names.
   */
  const checksByStep = {
    services: [
      {
        ok: apiOk,
        label: 'Background service responding',
        plain: 'The service that does the work is not answering yet.',
        technical: apiOk ? `Version ${v.version}.` : 'Start it with: npm --prefix nest run start',
      },
      {
        ok: dbOk,
        label: 'Database reachable',
        plain:
          'Your database is not reachable yet. It has to be running before the app can store anything.',
        technical: dbOk
          ? 'MySQL connected and verified.'
          : dbConfigured
            ? 'DATABASE_URL is set but the connection failed — check that MySQL is running.'
            : 'DATABASE_URL is not set. Copy .env.example to .env and update the credentials.',
      },
    ],
    market: [
      {
        ok: symbolsOk,
        label: 'Instruments available',
        plain: 'No instruments have been added yet, so there is nothing to chart or trade.',
        technical: symbolsOk
          ? `${syms.length} symbols in the database.`
          : 'Run: npx prisma db seed (in the nest/ folder)',
      },
      {
        ok: marketDataOk,
        label: 'Price history present',
        plain: 'No price history has been downloaded yet, so charts will be empty.',
        technical: marketDataOk
          ? `${freshCount} fresh of ${freshes.length} tracked.`
          : 'Run: npm run seed:market-data (in the nest/ folder)',
      },
    ],
    connections: [
      {
        ok: providersOk,
        label: 'Data providers registered',
        plain: 'No data providers were found, so there are no market prices to read.',
        technical: providersOk
          ? `${provs.length} providers registered.`
          : 'The provider health endpoint returned no data.',
      },
      {
        ok: alpacaConfigured,
        optional: true,
        label: 'Provider credentials',
        plain:
          'No provider credentials yet. The app still runs, but on sample data rather than live prices.',
        technical: alpacaConfigured
          ? 'Credentials configured — live data mode.'
          : 'No provider API key is set. Add one when you are ready for live data.',
      },
      {
        ok: queueEnabled,
        optional: true,
        label: 'Background queue',
        plain:
          'The background queue is off, so jobs run straight away instead of in the background. That is fine for a single user.',
        technical: queueEnabled
          ? 'Queue enabled (QUEUE_MODE=local).'
          : 'Queue disabled (QUEUE_MODE=off). Set to local if Redis is available.',
      },
    ],
  }

  /** A step is `running` while its queries are in flight — derived, never timed. */
  const loadingByStep = {
    services: version.isLoading,
    market: symbols.isLoading || freshness.isLoading,
    connections: providers.isLoading,
  }

  const steps = STEPS.map((s) => {
    const checks = checksByStep[s.id] ?? []
    const required = checks.filter((c) => !c.optional)
    const status = loadingByStep[s.id]
      ? 'running'
      : required.every((c) => c.ok)
        ? 'done'
        : 'attention'
    return { ...s, checks, status }
  })

  const doneCount = steps.filter((s) => s.status === 'done').length
  const allDone = doneCount === steps.length
  const needsAttention = steps.filter((s) => s.status === 'attention').length
  const busy = steps.some((s) => s.status === 'running')

  const retryAll = () => {
    version.refetch()
    symbols.refetch()
    freshness.refetch()
    providers.refetch()
  }

  const enterApp = () => {
    try {
      localStorage.setItem('tcs-setup-completed', 'true')
    } catch {
      /* private mode — the visit still counts, it just will not be remembered */
    }
    window.location.href = '/dashboard'
  }

  return (
    <div className="sfr-stage">
      <header className="sfr-hero">
        <p className="sfr-eyebrow">First run</p>
        <h1 className="sfr-title">Let us get you set up</h1>
        <p className="sfr-lede">
          Checking the things the app needs. It takes a few seconds, and you can carry on either
          way — anything missing is listed with what to do about it.
        </p>
      </header>

      <div className="sfr-progress">
        <div
          className="sfr-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          aria-label="Setup progress"
        >
          <span className="sfr-progress-fill" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
        <p className="sfr-progress-text" role="status">
          {allDone ? 'All checks passed' : `${doneCount} of ${steps.length} checks passed`}
        </p>
      </div>

      <ul className="sfr-steps">
        {steps.map((s, i) => (
          <Step key={s.id} index={i} {...s} />
        ))}
      </ul>

      <section className={`sfr-outcome sfr-outcome--${allDone ? 'ready' : 'pending'}`}>
        {allDone ? (
          <>
            <h2 className="sfr-outcome-title">Everything checks out</h2>
            <p className="sfr-outcome-text">
              The app is connected and has the data it needs. You can start using it now.
            </p>
            <div className="sfr-actions">
              <button type="button" className="sfr-btn sfr-btn--primary" onClick={enterApp}>
                Open the dashboard
              </button>
              <button type="button" className="sfr-btn" onClick={retryAll} disabled={busy}>
                Check again
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="sfr-outcome-title">
              {busy
                ? 'Still checking — one moment'
                : needsAttention === 1
                  ? 'One thing needs your attention'
                  : `${needsAttention} things need your attention`}
            </h2>
            <p className="sfr-outcome-text">
              Each one above says what it means and what to do. You can carry on and come back to
              this page at any time from the sidebar.
            </p>
            <div className="sfr-actions">
              <button type="button" className="sfr-btn sfr-btn--primary" onClick={retryAll} disabled={busy}>
                Check again
              </button>
              <button type="button" className="sfr-btn" onClick={enterApp}>
                Carry on anyway
              </button>
            </div>
          </>
        )}
      </section>

      <footer className="sfr-footnote">
        <p>
          Some checks are optional — the app runs without them. Nothing here needs a terminal, but
          if you want the underlying command for a failed check, open <strong>Details</strong> beside it.
        </p>
      </footer>
    </div>
  )
}
