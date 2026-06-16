import { useState, useEffect, useCallback, useRef } from 'react';
import './ServerControlsPage.css';

const TASK_API = '/api/processes';
const POLL_MS = 5000;

function StatusDot({ running }) {
  return (
    <span className={`sc-status-dot ${running ? 'sc-online' : 'sc-offline'}`}>
      <span className="sc-dot-inner" />
      {running ? 'Online' : 'Offline'}
    </span>
  );
}

export default function ServerControlsPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionState, setActionState] = useState({});
  const mountedRef = useRef(true);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(TASK_API, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!mountedRef.current) return;
      setTasks(data.tasks || []);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError('Could not reach the NestJS process manager. Ensure the API server is running.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchTasks();
    const interval = setInterval(fetchTasks, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchTasks]);

  const doAction = useCallback(async (taskId, action) => {
    setActionState((prev) => ({ ...prev, [taskId]: action }));
    try {
      const res = await fetch(`${TASK_API}/${encodeURIComponent(taskId)}/${action}`, {
        method: 'POST',
        cache: 'no-store',
      });
      // Poll until status stabilizes
      if (action === 'start') {
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const sRes = await fetch(`${TASK_API}/${encodeURIComponent(taskId)}`, { cache: 'no-store' });
            const sData = await sRes.json();
            if (sData.running || attempts > 15) {
              clearInterval(poll);
              fetchTasks();
            }
          } catch {
            clearInterval(poll);
            fetchTasks();
          }
        }, 2000);
      } else {
        setTimeout(() => fetchTasks(), 1000);
      }
    } catch {
      // Will refresh on next poll
    } finally {
      setActionState((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }
  }, [fetchTasks]);

  if (loading) {
    return (
      <div className="sc-page">
        <header className="sc-header">
          <h2>Server Controls</h2>
          <p className="muted">Start and stop Trading Command Suite services.</p>
        </header>
        <div className="sc-loading">Checking service statuses...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sc-page">
        <header className="sc-header">
          <h2>Server Controls</h2>
          <p className="muted">Start and stop Trading Command Suite services.</p>
        </header>
        <div className="sc-error">{error}</div>
        <button type="button" className="sc-retry-btn" onClick={fetchTasks}>Retry</button>
      </div>
    );
  }

  return (
    <div className="sc-page">
      <header className="sc-header">
        <h2>Server Controls</h2>
        <p className="muted">Start and stop Trading Command Suite services directly from here.</p>
      </header>

      <div className="sc-grid">
        {tasks.map((task) => {
          const busy = actionState[task.id];
          const running = task.running;
          const hasIssue = !!task.issue;
          const disableStart = running || hasIssue || !!busy;
          const disableStop = !running || hasIssue || !!busy;

          return (
            <article key={task.id} className={`sc-card ${running ? 'sc-card--live' : ''} ${hasIssue ? 'sc-card--issue' : ''}`}>
              <div className="sc-card-header">
                <span className="sc-card-icon">⚙️</span>
                <h3>{task.label}</h3>
              </div>

              <div className="sc-card-body">
                <StatusDot running={running} />

                <div className="sc-card-meta">
                  {task.port && <span>Port: {task.port}</span>}
                  {task.pid && <span>PID: {task.pid}</span>}
                  {task.listenerPid > 0 && (
                    <span className="sc-listener-info">
                      Listener: {task.listenerPid}
                      {task.listenerProcess ? ` (${task.listenerProcess})` : ''}
                    </span>
                  )}
                </div>

                {hasIssue && (
                  <div className="sc-issue">
                    {task.issue === 'port_owned_by_other_process' && (
                      <>⚠️ Port occupied by PID {task.listenerPid} ({task.listenerProcess || 'unknown'})</>
                    )}
                    {task.issue === 'port_in_use_unknown_owner' && (
                      <>⚠️ Port in use by unknown process</>
                    )}
                  </div>
                )}

                {task.logTail && (
                  <pre className="sc-log">{task.logTail}</pre>
                )}

                <div className="sc-actions">
                  <button
                    type="button"
                    className="sc-btn sc-btn--start"
                    disabled={disableStart}
                    onClick={() => doAction(task.id, 'start')}
                  >
                    {busy === 'start' ? 'Starting...' : 'Start'}
                  </button>
                  <button
                    type="button"
                    className="sc-btn sc-btn--stop"
                    disabled={disableStop}
                    onClick={() => doAction(task.id, 'stop')}
                  >
                    {busy === 'stop' ? 'Stopping...' : 'Stop'}
                  </button>
                  {task.port && (
                    <button
                      type="button"
                      className="sc-btn sc-btn--open"
                      disabled={!running}
                      onClick={() => window.open(`http://localhost:${task.port}`, '_blank', 'noopener')}
                    >
                      Open
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <p className="sc-footnote muted">
        Services are managed by the NestJS process manager. Status refreshes every {POLL_MS / 1000}s.
      </p>
    </div>
  );
}
