const fs = require("fs");
const j = JSON.parse(fs.readFileSync("logs/1081-body.json", "utf8"));
let b = j.body;
const anchor = "- [ ] #1077 supertrend does not compute SuperTrend — bands from one bar — ⏳ shadow evidence refreshed 2026-10-09: 475 gate-crosses → only **9 material tighten events** (7 tickets), and **none** was reached by later price; the gate is not the binding constraint (466/475 would stay at-target). Decision B/C/D pending (exit-path maths).";
if (!b.includes(anchor)) { console.error("MISSING anchor"); process.exit(1); }
b = b.replace(anchor, "- [x] #1077 ✅ **CLOSED 2026-10-09 — owner ruled \"B\" (queue R50).** The directive is REPLACED by a canonical ratcheting SuperTrend (`directives/utils/supertrend.ts` — ONE home), flat 55 both directions, unestablished = named neutral; the shadow module deleted. Canaried both ways (old formula fails 1 case, dead ratchet fails 2). Register row 75. Deployed — API 0.121.5, live lines show the retired shadow field gone.");
fs.writeFileSync("logs/1081-body-new.md", b, "utf8");
console.log("sprint line ticked");
