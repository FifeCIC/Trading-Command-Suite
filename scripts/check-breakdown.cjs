const m = require('mysql2/promise');
(async () => {
  try {
    const c = await m.createConnection('mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs');
    const [r] = await c.execute(
      "SELECT breakdown FROM Score WHERE JSON_EXTRACT(breakdown, '$.source') = 'protocol-gating' ORDER BY timestamp DESC LIMIT 1"
    );
    await c.end();
    if (r.length === 0) {
      console.log('NO protocol-gating scores found');
    } else {
      const b = r[0].breakdown;
      console.log('Top-level keys:', Object.keys(b));
      console.log('JSON:', JSON.stringify(b).substring(0, 2000));
    }
  } catch (e) {
    console.log('ERROR: ' + e.message);
  }
})();
