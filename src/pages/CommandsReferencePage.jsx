import { useState } from 'react';
import { motion } from 'motion/react';
import './commands-reference.css';
import PageInfoPopover from '../components/PageInfoPopover';

// ── Command categories ──────────────────────────────────

const CATEGORIES = {
  all: 'All',
  services: '🔧 Services',
  health: '🩺 Health & Diagnostics',
  build: '🏗️ Build & Deploy',
  db: '🗄️ Database',
  debug: '🐛 Debug & Logs',
  trading: '📈 Trading',
};

const COMMANDS = [
  // ── Services ──
  { cat: 'services', cmd: 'pwsh -File scripts/tcs-launch.ps1', desc: 'Start all TCS services (MT5 Bridge → NestJS → Vite)' },
  { cat: 'services', cmd: 'pwsh -File scripts/tcs-stop.ps1', desc: 'Stop all TCS services' },
  { cat: 'services', cmd: 'npm --prefix nest run start', desc: 'Start NestJS only (port 3201)' },
  { cat: 'services', cmd: 'npm run dev', desc: 'Start Vite dev server (port 5173)' },
  { cat: 'services', cmd: 'Get-NetTCPConnection -LocalPort 3201 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }', desc: 'Kill NestJS by port' },

  // ── Health & Diagnostics ──
  { cat: 'health', cmd: 'pwsh scripts/health-check.ps1', desc: 'Quick health summary for agents (CPU/RAM/DB/providers)' },
  { cat: 'health', cmd: 'curl -s http://localhost:3201/api/system/health-summary', desc: 'Compact agent-readable health (JSON)' },
  { cat: 'health', cmd: 'curl -s http://localhost:3201/api/system/health-dashboard', desc: 'Full diagnostics payload (all sections)' },
  { cat: 'health', cmd: 'curl -s http://localhost:3201/api/health', desc: 'Basic API health (db + providers + mode)' },
  { cat: 'health', cmd: 'curl -s http://localhost:3201/api/system/health-check', desc: 'Run all system checks (DB/tables/watchlists/protocols/bridge/automation)' },

  // ── Build & Deploy ──
  { cat: 'build', cmd: 'npm --prefix nest run build', desc: 'Build NestJS (tsc)' },
  { cat: 'build', cmd: 'npm run build', desc: 'Build Vite frontend for production' },
  { cat: 'build', cmd: 'npm run preview', desc: 'Preview production build locally' },

  // ── Database ──
  // ⚠️ `prisma db push` is deliberately NOT listed here. It treats `schema.prisma` as the whole truth
  // and DROPS every unmodelled table — 13 in this repo, including the trade execution queue (#769).
  { cat: 'db', cmd: 'npm --prefix nest run db:check', desc: 'Verify schema safety — ALWAYS run before any schema change' },
  { cat: 'db', cmd: '$env:DATABASE_URL = "mysql://USER:PASSWORD@localhost:3306/DB"; npx prisma studio', desc: 'Open Prisma Studio GUI (Prisma does not read .env)' },
  { cat: 'db', cmd: 'curl -s http://localhost:3201/api/database/table-stats', desc: 'DB table row counts and sizes' },
  { cat: 'db', cmd: 'curl -s -X POST "http://localhost:3201/api/system/data-retention/prune-all"', desc: 'Prune all tables to retention targets' },
  { cat: 'db', cmd: 'curl -s "http://localhost:3201/api/system/data-retention/stats"', desc: 'Data retention stats (counts, ages, sizes)' },

  // ── Debug & Logs ──
  { cat: 'debug', cmd: 'curl -s http://localhost:3201/api/system/logs?category=all&limit=50', desc: 'Recent system logs' },
  { cat: 'debug', cmd: 'curl -s http://localhost:3201/api/system/logs/status', desc: 'Log file status (directory, files, sizes)' },
  { cat: 'debug', cmd: 'curl -s http://localhost:3201/api/automation/events?limit=30', desc: 'Recent automation events (ticks, decisions)' },
  { cat: 'debug', cmd: 'curl -s http://localhost:3201/api/automation/queue', desc: 'Current protocol execution queue' },
  { cat: 'debug', cmd: 'curl -s http://localhost:3201/api/alerts?active=true', desc: 'Active alerts' },

  // ── Trading ──
  { cat: 'trading', cmd: 'curl -s http://localhost:3201/api/providers/mt5/diagnostics', desc: 'MT5 bridge diagnostics + positions' },
  { cat: 'trading', cmd: 'curl -s http://localhost:3201/api/portfolio?source=mt5', desc: 'MT5 portfolio positions' },
  { cat: 'trading', cmd: 'curl -s http://localhost:3201/api/portfolio?source=trading212', desc: 'Trading212 portfolio positions' },
  { cat: 'trading', cmd: 'curl -s http://localhost:3201/api/scoring/gated/ranked?protocol=mt5-technical-core-v1', desc: 'Ranked scores for a protocol' },
];

// ── Component ───────────────────────────────────────────

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export default function CommandsReferencePage() {
  const [filter, setFilter] = useState('all');
  const [copied, setCopied] = useState(null);

  const filtered = filter === 'all' ? COMMANDS : COMMANDS.filter(c => c.cat === filter);

  const handleCopy = (cmd) => {
    copyToClipboard(cmd);
    setCopied(cmd);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="cr-page">
      <motion.header className="cr-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Commands Reference
          <PageInfoPopover>
            Quick-access CLI commands for developers and agents. Click any command to copy it.
          </PageInfoPopover>
        </h1>
      </motion.header>

      {/* Filter tabs */}
      <motion.div className="cr-filters" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.04 }}>
        {Object.entries(CATEGORIES).map(([key, label]) => (
          <button
            key={key}
            className={`cr-filter-btn ${filter === key ? 'cr-filter-active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </motion.div>

      {/* Command list */}
      <motion.div className="cr-list" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        {filtered.map((item, i) => (
          <motion.div
            key={item.cmd}
            className="cr-item"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.02 * i }}
            onClick={() => handleCopy(item.cmd)}
            title="Click to copy"
          >
            <div className="cr-item-cmd">
              <code>{item.cmd}</code>
              <span className={`cr-copy-icon ${copied === item.cmd ? 'cr-copied' : ''}`}>
                {copied === item.cmd ? '✓ Copied' : '📋'}
              </span>
            </div>
            <span className="cr-item-desc">{item.desc}</span>
          </motion.div>
        ))}
      </motion.div>

      <motion.footer className="cr-footer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
        <p>💡 <strong>Tip:</strong> Run <code>pwsh scripts/health-check.ps1</code> at the start of every session. Agents: call <code>GET /api/system/health-summary</code> first — it costs ~300 tokens for full system awareness.</p>
        <p>See also: <a href="/status/health-check">🩺 Health Dashboard</a> · <a href="/status/system-log">📋 System Log</a> · <a href="/status/setup">◉ Setup & Diagnostics</a></p>
      </motion.footer>
    </div>
  );
}
