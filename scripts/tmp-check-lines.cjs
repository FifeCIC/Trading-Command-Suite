const fs = require('fs');
const path = 'C:/wamp64/www/trading-command-suite/nest/src/modules/directives/directive-groups.ts';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');
console.log('Lines:', lines.length);
// Find where PROTOCOL_REGISTRY starts
for (let i = 285; i < Math.min(310, lines.length); i++) {
  console.log(i + 1 + ':', lines[i].substring(0, 80));
}
