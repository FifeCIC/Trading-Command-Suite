const fs = require("fs");
const j = JSON.parse(fs.readFileSync("logs/1081-body.json", "utf8"));
let b = j.body;
const anchor = "- [ ] #999 ⚡ 8 of 11 gold directives permanently neutral — 90% of the m15 denominator unreachable";
if (!b.includes(anchor)) { console.error("MISSING anchor"); process.exit(1); }
b = b.replace(anchor, "- [x] #999 ✅ **RESOLVED 2026-10-08** — denominator settled (register rows 2/3/5/9; the reachable-capacity variant was tried and reverted 2026-09-10). The \"m15 can't trade\" premise measured FALSE: signalPath peaked 15.2%, the bot's signal exceeded its 10% bar on 10-07 (refused by the daily-loss cap), 5 trades on record. `audit:data-health` [3/4] fixed — two-source classifier (score + score_snapshot), coverage named, canaried M1/M2, self-test 16 canaries, live exit 0.");
fs.writeFileSync("logs/1081-body-new.md", b, "utf8");
console.log("sprint line ticked");
