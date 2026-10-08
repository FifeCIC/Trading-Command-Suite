const fs = require("fs");
const j = JSON.parse(fs.readFileSync("logs/1081-body.json", "utf8"));
let b = j.body;
const anchor = "- [ ] #1013 btc-speed-v1: 4 of 13 directives starved to 0 on 99.6% of ticks";
if (!b.includes(anchor)) { console.error("MISSING anchor"); process.exit(1); }
b = b.replace(anchor, "- [x] #1013 ✅ **CLOSED 2026-10-08** — 09-28 fix re-verified live (the 4 directives score again; 0 starvation reasons in 24h; Opportunity 698). Guard made REAL: `resolveBaseBarCount()` exported + spec exercises the shipped function — canaried M1 (2 failures) / M2 (4 failures), restore SHA256-verified. Suite 177/177 · 1659 tests.");
fs.writeFileSync("logs/1081-body-new.md", b, "utf8");
console.log("sprint line ticked");
