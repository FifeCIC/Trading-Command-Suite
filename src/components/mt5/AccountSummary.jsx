export default function AccountSummary({ account, connected }) {
  if (!account) {
    return (
      <div className="mt5-acct-summary mt5-acct-offline">
        <span className="mt5-conn-dot mt5-conn-off" />
        <span>MT5 not connected — start the bridge</span>
      </div>
    );
  }

  const marginLevel = account.margin > 0 ? ((account.equity / account.margin) * 100).toFixed(1) : '—';

  return (
    <div className="mt5-acct-summary">
      <span className={`mt5-conn-dot ${connected ? 'mt5-conn-on' : 'mt5-conn-off'}`} />
      <div className="mt5-acct-item"><span>Balance</span><strong>${account.balance?.toLocaleString() ?? '—'}</strong></div>
      <div className="mt5-acct-item"><span>Equity</span><strong>${account.equity?.toLocaleString() ?? '—'}</strong></div>
      <div className="mt5-acct-item"><span>Margin</span><strong>${account.margin?.toLocaleString() ?? '—'}</strong></div>
      <div className="mt5-acct-item"><span>Free</span><strong>${account.freeMargin?.toLocaleString() ?? '—'}</strong></div>
      <div className="mt5-acct-item">
        <span>Margin Level</span>
        <strong className={Number(marginLevel) > 100 ? 'mt5-green' : 'mt5-red'}>{marginLevel}%</strong>
      </div>
      <div className="mt5-acct-item"><span>Server</span><strong>{account.server || '—'}</strong></div>
      <div className="mt5-acct-item"><span>Account</span><strong>{account.login || '—'}</strong></div>
    </div>
  );
}
