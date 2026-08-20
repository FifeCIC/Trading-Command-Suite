/**
 * Signals Overview — the /signals/ area landing page.
 * =====================================================
 * Signals = the best of opportunities, surfaced for action: the strongest
 * ranked setups with trade buttons for the user, and indicators showing
 * whether the trading bot has already acted on a signal.
 *
 * Contrast with /scoring/ (SEES monitoring: every ladder, all scores —
 * including the poor ones). This page is the shell; the live best-of
 * ladder, trade actions, and bot-action indicators are built out in
 * subsequent passes (backend issues filed for the API work).
 */
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import PageInfoPopover from '../components/PageInfoPopover';
import './signals-overview.css';

const PLANNED = [
  {
    title: 'Best-of ladder',
    desc: 'Signals ranked by opportunity — the strongest setups first, ready to act on. Unlike Scoring, this ladder surfaces only the top candidates.',
    status: 'Planned',
  },
  {
    title: 'Bot-action indicators',
    desc: 'See whether the trading bot has already acted on a signal (filled / pending / none) so you always know who is in control.',
    status: 'Backend issue filed',
  },
  {
    title: 'Trade buttons',
    desc: 'One-click trade a signal manually when you are in control, using the same risk gates and sizing as the bot.',
    status: 'Backend issue filed',
  },
];

export default function SignalsOverviewPage() {
  return (
    <div className="sig-page">
      <motion.header className="sig-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Signals
          <PageInfoPopover>
            The best of opportunities, surfaced for action. Contrast with Scoring (SEES monitoring — every ladder and all scores). This area is the shell being built out with trade actions and bot-action indicators.
          </PageInfoPopover>
        </h1>
      </motion.header>

      <p className="sig-intro">
        Signals turns the strongest SEES output into an actionable shortlist — with the option to trade it yourself or let the bot act.
      </p>

      <div className="sig-grid">
        {PLANNED.map((card, i) => (
          <motion.div
            key={card.title}
            className="sig-card"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
          >
            <div className="sig-card-title">{card.title}</div>
            <div className="sig-card-desc">{card.desc}</div>
            <span className="sig-card-status">{card.status}</span>
          </motion.div>
        ))}
      </div>

      <div className="sig-links">
        <Link to="/scoring/symbols-ladder" className="sig-link">View the full Symbols Ladder (Scoring)</Link>
        <Link to="/scoring/live-ordering-stack" className="sig-link">View the Scoring Ladder</Link>
      </div>
    </div>
  );
}
