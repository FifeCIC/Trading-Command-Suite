const fs = require("fs");
const j = JSON.parse(fs.readFileSync("logs/1081-body.json", "utf8"));
let b = j.body;
const anchor = "- [ ] #996 Index protocols score under 6×/hour on a declared 5s–30s cadence";
if (!b.includes(anchor)) { console.error("MISSING anchor"); process.exit(1); }
b = b.replace(anchor, "- [x] #996 ✅ **CLOSED 2026-10-09 — cause isolated; NOT a cadence problem.** Every tick already scores every protocol (`protocol_score_status.lastTickAt` advances for all, incl. these). A no-direction tick is `NO_DATA` and persists nothing (#758); the five are LONG_ONLY so bearish readings are ineligible; their designed voice (analyst-adjustments) reports UNMEASURED (no feed). `scoreIntervalMs` is the issue hypothesis — **refuted and dead**: read by nothing. Remaining lever = directional capacity/eligibility → queue R51.");
fs.writeFileSync("logs/1081-body-new.md", b, "utf8");
console.log("sprint line ticked");
