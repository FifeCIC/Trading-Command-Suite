import fs from 'fs';
const lines = fs.readFileSync('src/components/ScreenOptions.jsx', 'utf-8').split('\n');
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  let inStr = false;
  let strChar = '';
  for (let j = 0; j < l.length; j++) {
    const c = l[j];
    if (inStr) {
      if (c === strChar) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strChar = c; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (depth < 0 && i < 626) {
      console.log('NEGATIVE at line ' + (i+1) + ' col ' + (j+1));
      console.log('  ' + l.substring(Math.max(0,j-20), Math.min(l.length, j+20)));
      process.exit(1);
    }
  }
}
console.log('Depth at end of function body (line 626):', depth);
