const fs = require("fs");
const j = JSON.parse(fs.readFileSync("logs/1081-body.json", "utf8"));
let b = j.body;
const anchor = "**decision needed on the running pair**";
if (!b.includes(anchor)) { console.error("MISSING anchor"); process.exit(1); }
b = b.replace(anchor, "**DECIDED 2026-10-08 (R49): stays PARKED — the measurement path is the backtest (#965); a restart is the owner's to authorise and would today place nothing (arms both `mt5`; two-account fix refuses). Register row 74**");
fs.writeFileSync("logs/1081-body-new.md", b, "utf8");
console.log("sprint line amended");
