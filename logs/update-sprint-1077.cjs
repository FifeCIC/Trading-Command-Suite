const fs = require("fs");
const j = JSON.parse(fs.readFileSync("logs/1081-body.json", "utf8"));
let b = j.body;
const anchor = "- [ ] #1077 supertrend does not compute SuperTrend — bands from one bar";
if (!b.includes(anchor)) { console.error("MISSING anchor"); process.exit(1); }
b = b.replace(anchor, "- [ ] #1077 supertrend does not compute SuperTrend — bands from one bar — ⏳ shadow evidence refreshed 2026-10-09: 475 gate-crosses → only **9 material tighten events** (7 tickets), and **none** was reached by later price; the gate is not the binding constraint (466/475 would stay at-target). Decision B/C/D pending (exit-path maths).");
fs.writeFileSync("logs/1081-body-new.md", b, "utf8");
console.log("sprint line updated");
