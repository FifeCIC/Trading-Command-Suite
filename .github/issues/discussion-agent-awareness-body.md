## Discussion: Agent Self-Awareness, Error Monitoring & Priority Alerting

### Motivation

Recent development sessions have revealed a pattern where coding agents (including Copilot) continue burning tokens on failed approaches without recognizing the problem, surfacing it, or changing tactics. Additionally, non-critical warnings (tool warnings, lint noise, build warnings) accumulate silently in terminal output without being captured or actioned.

This discussion explores three interlocking goals:

---

### Goal A: Improved Agent Error Handling & Self-Awareness

**Problem:** Agents lack a mechanism to recognize when they're stuck (repeated same error, no progress after N attempts) and record the issue for later action instead of continuing to burn tokens.

**Proposed approach:**
- Create a shared `agent-priority-log.json` file (in the intranet `/data/` directory) that any agent can write to
- Define a schema: `{ id, timestamp, source, severity, project, category, title, description, resolved }`
- Add an agent instruction: "If you retry the same approach 3+ times without progress, write a priority-log entry and either change tactic or ask the user"
- Explore existing libraries for agent self-diagnosis, or develop a lightweight one if none are suitable

**Settings to consider:**
- Which events trigger a priority log entry (configurable per project)
- Whether to pause the agent or continue after logging
- Notification routing (log only vs log + alert)

---

### Goal B: Cross-Project Priority & Health Monitoring

**Problem:** There's no centralized place to see errors, warnings, or concerns across all projects. Each project has its own logs but nothing aggregates them.

**Proposed approach (phased):**
1. **Phase 1 (immediate):** intranet-hosted `agent-priority-log.json` with a simple table viewer page
2. **Phase 2:** Health check API endpoints for each project, polled by the intranet
3. **Phase 3:** Alert routing — email, browser notifications, Windows OS notifications

**Notification systems to explore:**
- **Browser Notification API** (`Notification.permission` + `new Notification(...)`) — works while the intranet tab is open
- **Windows Toast Notifications** — via a small PowerShell helper or Node.js script that reads the log and fires OS-level toasts
- **Email integration** — for critical/financial/security events

**Configuration:**
- Per-service toggles (which services can alert)
- Severity thresholds (only critical → alert, or warnings too)
- Quiet hours
- Cooldown period (don't re-alert for same event within X minutes)

---

### Goal C: Agent Performance Tracking & Optimization

**Problem:** Long-term, it's unclear which approaches, models, and configurations lead to efficient work vs token waste. A visual dashboard showing agent session summaries, retry counts, error types, and estimated token cost would help optimize the workflow.

**Future possibilities:**
- Agent session summaries pushed to the priority log automatically
- A visual "agent orchestration" page on the intranet showing what each agent worked on, how many attempts, and outcomes
- A cost-per-task estimate based on agent session data (from the chronicle/Copilot session store)
- Rule-based agent routing: if a task matches certain patterns (e.g., "this has been retried 5 times"), route to a different agent or model

---

### Implementation Plan (Phase 3 — Post-Public Launch)

- [ ] Research existing agent monitoring/diagnosis libraries and document findings here
- [ ] Design the final priority-log schema (extend the current JSON format as needed)
- [ ] Create an API endpoint on the intranet for writing to the log (so agents can POST from any project)
- [ ] Design the intranet priority-log viewer page
- [ ] Implement Windows Toast notification sender (Node.js or PowerShell script)
- [ ] Implement Browser Notification API integration
- [ ] Create configuration UI for notification settings (services, severity, quiet hours)
- [ ] Add agent instructions for writing to the priority log
- [ ] Build a visual agent orchestration page (stretch goal)
- [ ] Integrate with chronicle/agent session data for cost tracking (stretch goal)

### Related

- #419 — Symbol Company Name Enrichment (example of a well-scoped task with clear steps)
- Intranet priority log already created at `C:\wamp64\www\intranet\data\agent-priority-log.json`
- Intranet viewer page: `C:\wamp64\www\intranet\agent-priority-log.php`
