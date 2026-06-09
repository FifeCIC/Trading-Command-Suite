import { useUiStore } from '../stores/useUiStore'
import './theme-page.css'

export default function ThemePage() {
  const themePack = useUiStore((state) => state.themePack)

  return (
    <div className="theme-page">
      <header className="page-header">
        <h1>Theme Packs</h1>
        <p>Active: <strong>{themePack}</strong> — Feature examples and UI components are displayed here to preview theme behaviour.</p>
      </header>

      <section className="theme-content">
        {themePack === 'core' && <p className="placeholder-text">Core theme active. Feature examples will appear here.</p>}
        {themePack === 'oceanic' && <p className="placeholder-text">Oceanic theme active. Feature examples will appear here.</p>}
        {themePack === 'scifi' && <p className="placeholder-text">Sci-Fi theme active. Feature examples will appear here.</p>}
        {themePack === 'terminal' && <p className="placeholder-text">Terminal theme active. Feature examples will appear here.</p>}
        {themePack === 'void' && <p className="placeholder-text">Void theme active. Feature examples will appear here.</p>}
      </section>
    </div>
  )
}
