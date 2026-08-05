/**
 * QA Testing Page
 * ===============
 * Structured testing dashboard — systematic verification of every system.
 * Doubles as a training tool: each entry tells you what to test, how to test it,
 * and what to expect.
 *
 * Features:
 * - 26 test items across 7 areas
 * - Status toggle: untested → passed → failed → needs retest
 * - Per-item feedback notes (stored in localStorage)
 * - Priority badges (critical/high/medium/low)
 * - Category badges (API/Directive/Protocol/Integration/Feature/Safety/UI)
 * - Filter by area, status, priority
 * - Progress bar showing completion %
 */

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import QA_CHECKLIST from '../data/qa-checklist';
import './qa-testing.css';
import PageInfoPopover from '../components/PageInfoPopover';

const STORAGE_KEY = 'tcs-qa-testing-state';

const STATUS_ORDER = ['untested', 'passed', 'failed', 'needs-retest'];
const STATUS_COLORS = {
  untested: { color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', label: 'Untested' },
  passed: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', label: 'Passed' },
  failed: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', label: 'Failed' },
  'needs-retest': { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Needs Retest' },
};
const PRIORITY_COLORS = {
  critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#94a3b8',
};
const CATEGORY_COLORS = {
  API: '#6366f1', Directive: '#8b5cf6', Protocol: '#a855f7',
  Integration: '#06b6d4', Feature: '#22c55e', Safety: '#ef4444', UI: '#ec4899',
};

const AREAS = ['All', ...new Set(QA_CHECKLIST.map(q => q.area))];
const PRIORITIES = ['All', 'critical', 'high', 'medium', 'low'];
const STATUSES = ['All', 'untested', 'passed', 'failed', 'needs-retest'];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export default function QATestingPage() {
  const [state, setState] = useState(loadState);
  const [areaFilter, setAreaFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { saveState(state); }, [state]);

  const items = useMemo(() => {
    let filtered = QA_CHECKLIST;
    if (areaFilter !== 'All') filtered = filtered.filter(q => q.area === areaFilter);
    if (priorityFilter !== 'All') filtered = filtered.filter(q => q.priority === priorityFilter);
    if (statusFilter !== 'All') filtered = filtered.filter(q => (state[q.id] || 'untested') === statusFilter);
    return filtered;
  }, [areaFilter, priorityFilter, statusFilter, state]);

  const stats = useMemo(() => {
    const total = QA_CHECKLIST.length;
    const counts = { untested: 0, passed: 0, failed: 0, 'needs-retest': 0 };
    QA_CHECKLIST.forEach(q => { counts[state[q.id] || 'untested']++; });
    const tested = total - counts.untested;
    const pct = total > 0 ? Math.round((counts.passed / total) * 100) : 0;
    return { total, tested, ...counts, pct };
  }, [state]);

  const getStatus = (id) => state[id] || 'untested';
  const getFeedback = (id) => state[`${id}-feedback`] || '';

  const cycleStatus = (id) => {
    setState(prev => {
      const current = prev[id] || 'untested';
      const idx = STATUS_ORDER.indexOf(current);
      const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
      return { ...prev, [id]: next };
    });
  };

  return (
    <div className="qa-page">
      <header className="qa-header">
        <div>
          <h1>QA Testing
          <PageInfoPopover>
            Systematic verification of every system. Each entry is a guided test procedure — follow it,
            record the result, and leave feedback. This is how you learn your own app.
          </PageInfoPopover>
        </h1>
        </div>
      </header>

      {/* ── Progress Bar ── */}
      <div className="qa-progress-wrap">
        <div className="qa-progress-bar">
          <div className="qa-progress-fill" style={{ width: `${stats.pct}%` }} />
        </div>
        <div className="qa-progress-stats">
          <span className="qa-stat qa-stat-passed">{stats.passed} passed</span>
          <span className="qa-stat qa-stat-failed">{stats.failed} failed</span>
          <span className="qa-stat qa-stat-retest">{stats['needs-retest']} retest</span>
          <span className="qa-stat qa-stat-untested">{stats.untested} untested</span>
          <span className="qa-stat qa-stat-total">of {stats.total}</span>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="qa-filters">
        <select className="qa-filter-select" value={areaFilter} onChange={e => setAreaFilter(e.target.value)}>
          {AREAS.map(a => <option key={a} value={a}>Area: {a}</option>)}
        </select>
        <select className="qa-filter-select" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
          {PRIORITIES.map(p => <option key={p} value={p}>Priority: {p}</option>)}
        </select>
        <select className="qa-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {STATUSES.map(s => <option key={s} value={s}>Status: {s}</option>)}
        </select>
      </div>

      {/* ── Items ── */}
      <div className="qa-list">
        {items.map(item => {
          const status = getStatus(item.id);
          const st = STATUS_COLORS[status];
          const isExpanded = expandedId === item.id;
          const feedback = getFeedback(item.id);

          return (
            <motion.div
              key={item.id}
              className={`qa-item ${isExpanded ? 'qa-expanded' : ''}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="qa-item-header" onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                <div className="qa-item-left">
                  <span className="qa-item-id">{item.id}</span>
                  <div className="qa-item-info">
                    <span className="qa-item-name">{item.name}</span>
                    <span className="qa-item-system">{item.system} · {item.area}</span>
                  </div>
                </div>
                <div className="qa-item-right">
                  <span className="qa-priority-badge" style={{ color: PRIORITY_COLORS[item.priority] }}>{item.priority}</span>
                  <span className="qa-category-badge" style={{ color: CATEGORY_COLORS[item.category], background: CATEGORY_COLORS[item.category] + '18' }}>{item.category}</span>
                  <span
                    className="qa-status-badge"
                    style={{ color: st.color, background: st.bg, cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); cycleStatus(item.id); }}
                    title="Click to cycle status"
                  >{st.label}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="qa-item-body">
                  <div className="qa-procedure">
                    <h4>Test Procedure</h4>
                    <pre className="qa-pre">{item.procedure}</pre>
                  </div>
                  <div className="qa-expected">
                    <h4>Expected Behavior</h4>
                    <p>{item.expected}</p>
                  </div>
                  {item.versionNote && (
                    <div className="qa-version">📌 {item.versionNote}</div>
                  )}
                  {feedback && (
                    <div className="qa-feedback-existing">
                      <h4>📝 Previous Feedback</h4>
                      <p>{feedback}</p>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="qa-empty">
          <p>No items match your filters. Try broadening the criteria.</p>
        </div>
      )}
    </div>
  );
}
