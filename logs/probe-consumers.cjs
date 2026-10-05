// SCRATCH PROBE — do Transient Method symbols carry `declarations`?
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'nest', 'node_modules', 'typescript'));
const base = path.join(ROOT, 'nest');
const read = ts.readConfigFile(path.join(base, 'tsconfig.build.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, base);
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, incremental: false, declaration: false });
const checker = program.getTypeChecker();

const key = (sym) => {
  const ds = sym && sym.declarations;
  if (!ds || !ds.length) return null;
  const d = ds[0];
  return `${d.getSourceFile().fileName.split('\\').pop()}:${d.pos}:${ts.SyntaxKind[d.kind]}`;
};
const alias = (sym) => {
  if (!sym) return null;
  try { return (sym.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(sym) : sym; } catch { return sym; }
};

let declSym = null;
for (const sf of program.getSourceFiles()) {
  if (!sf.fileName.endsWith('mt5-trading.service.ts')) continue;
  (function visit(n) {
    if (ts.isMethodDeclaration(n) && n.name && n.name.getText() === 'placeOrder') declSym = checker.getSymbolAtLocation(n.name);
    ts.forEachChild(n, visit);
  })(sf);
}
console.log('DECL  key =', key(declSym));

let calls = 0;
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  (function visit(n) {
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      const simple = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
      if (simple === 'placeOrder') {
        calls++;
        const at = ts.isPropertyAccessExpression(c) ? c.name : c;
        const sym = alias(checker.getSymbolAtLocation(at));
        const rel = path.relative(ROOT, sf.fileName).replace(/\\/g, '/');
        console.log(`call ${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
        console.log(`     flags=${sym.flags} key=${key(sym)} MATCH=${key(sym) === key(declSym)}`);
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
}
console.log('calls:', calls);
