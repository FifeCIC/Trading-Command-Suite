import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './setup-wizard.css'

const STEPS = [
  { id: 'api', label: 'API Connection', summary: 'Check the backend is reachable.' },
  { id: 'database', label: 'Database', summary: 'Verify MySQL is connected and tables exist.' },
  { id: 'symbols', label: 'Symbols', summary: 'Confirm test symbols are seeded.' },
  { id: 'providers', label: 'Providers', summary: 'Check API provider credentials.' },
  { id: 'done', label: 'Ready', summary: 'System health summary.' },
]

function StepCheck({ ok, label, detail }) {
  return (
    <div className={`wizard-check ${ok ? 'pass' : 'fail'}`}>
      <span className="wizard-icon">{ok ? '✓' : '✗'}</span>
      <div>
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
    </div>
  )
}

export default function SetupWizardPage() {
  const [step, setStep] = useState(0)

  const version = useQuery({
    queryKey: ['setup-version'],
    queryFn: () => apiGet('/api/version'),
    refetchInterval: step === 0 ? 5000 : false,
  })

  const symbols = useQuery({
    queryKey: ['setup-symbols'],
    queryFn: () => apiGet('/api/symbols'),
    enabled: step >= 1,
    refetchInterval: step === 2 ? 5000 : false,
  })

  const providers = useQuery({
    queryKey: ['setup-providers'],
    queryFn: () => apiGet('/api/providers/health'),
    enabled: step >= 3,
  })

  const v = version.data ?? {}
  const svc = v.services ?? {}
  const s = symbols.data ?? {}
  const syms = Array.isArray(s.symbols) ? s.symbols : []
  const p = providers.data ?? {}
  const provs = Array.isArray(p.providers) ? p.providers : []

  const apiOk = Boolean(v.version)
  const dbOk = svc.databaseConnected === true
  const dbConfigured = svc.database === true
  const symbolsOk = syms.length >= 3
  const providersOk = provs.length > 0

  const checks = [
    { label: 'API online', ok: apiOk, detail: apiOk ? `Version ${v.version}` : 'Backend not reachable. Start it with: npm --prefix nest run start:dev' },
    { label: 'Database connected', ok: dbOk, detail: dbOk ? 'MySQL connected and verified.' : dbConfigured ? 'DATABASE_URL is set but connection failed. Check that MySQL is running.' : 'DATABASE_URL not set. Copy .env.example to .env and update credentials.' },
    { label: 'Symbols seeded', ok: symbolsOk, detail: symbolsOk ? `${syms.length} symbols in database.` : 'No symbols found. Run: npx prisma db seed in the nest/ folder.' },
    { label: 'Providers visible', ok: providersOk, detail: providersOk ? `${provs.length} providers registered.` : 'Provider health endpoint returned no data.' },
  ]

  const allOk = checks.every((c) => c.ok)
  const currentChecks = checks.slice(0, step === STEPS.length - 1 ? checks.length : step + 1)

  return (
    <div className="setup-wizard">
      <header className="wizard-header">
        <p>This wizard checks your system and guides you to a working state.</p>
      </header>

      <nav className="wizard-steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`wizard-step-chip ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            onClick={() => setStep(i)}
          >
            <span className="step-number">{i + 1}</span>
            <span className="step-label">{s.label}</span>
          </button>
        ))}
      </nav>

      <section className="wizard-body">
        <h2>{STEPS[step].label}</h2>
        <p className="wizard-summary">{STEPS[step].summary}</p>

        <div className="wizard-checks">
          {currentChecks.map((check) => (
            <StepCheck key={check.label} ok={check.ok} label={check.label} detail={check.detail} />
          ))}
        </div>

        {step === STEPS.length - 1 && (
          <div className={`wizard-result ${allOk ? 'all-ok' : 'needs-work'}`}>
            <h3>{allOk ? '✓ System is ready' : '⚠ Some items need attention'}</h3>
            {allOk ? (
              <p>The backend is connected, the database has test symbols, and providers are registered. You can now use the SEES Live Stack and Architecture pages.</p>
            ) : (
              <p>Address the items marked above, then revisit this wizard. Each check includes instructions for what to fix.</p>
            )}
          </div>
        )}

        {step === 2 && !symbolsOk && (
          <div className="wizard-action">
            <p>To seed symbols, run this command in a terminal:</p>
            <code>cd c:\wamp64\www\trading-command-suite\nest && npx prisma db seed</code>
          </div>
        )}
      </section>

      <footer className="wizard-footer">
        <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>
          ← Back
        </button>
        <span>Step {step + 1} of {STEPS.length}</span>
        <button type="button" disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>
          Next →
        </button>
      </footer>
    </div>
  )
}
