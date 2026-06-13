export default function OpsAreaPage() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20, color: '#e2e8f0' }}>
      <header style={{ marginBottom: 16 }}>
        <h1>Operations</h1>
        <p style={{ color: '#64748b' }}>Background jobs, queues, automation, and system health</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {[
          { name: 'Background Activity', desc: 'Running jobs and scheduled tasks', status: '3 active', color: '#4ade80' },
          { name: 'Execution Queue', desc: 'Pending signal executions', status: '0 queued', color: '#64748b' },
          { name: 'Cron Scheduler', desc: 'Scheduled scoring and imports', status: 'Next: 9:00 AM', color: '#60a5fa' },
          { name: 'Alert Center', desc: 'System alerts and notifications', status: '2 unread', color: '#fbbf24' },
          { name: 'Risk Controls', desc: 'Position limits and drawdown rules', status: 'Active', color: '#4ade80' },
          { name: 'Analytics', desc: 'System usage and performance metrics', status: '7d history', color: '#a78bfa' },
        ].map(item => (
          <div key={item.name} style={{ background: '#1a1d2e', border: '1px solid #2d3040', borderRadius: 10, padding: 14 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>{item.name}</h3>
            <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 8px' }}>{item.desc}</p>
            <span style={{ fontSize: 12, color: item.color }}>{item.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
