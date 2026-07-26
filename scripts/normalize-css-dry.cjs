// #507 — CSS normalization: rename PascalCase → kebab-case
const fs = require('fs');
const path = require('path');

const srcDir = 'C:/wamp64/www/trading-command-suite/src';
const dryRun = true; // set true to preview only

// ── Find all PascalCase CSS files ──
function findPascalCss(dir) {
  const results = [];
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        walk(path.join(d, e.name));
      } else if (e.name.endsWith('.css') && /[A-Z]/.test(e.name[0])) {
        const fullPath = path.join(d, e.name);
        const relPath = path.relative(srcDir, fullPath).replace(/\\/g, '/');
        const dirName = path.dirname(relPath);
        const kebab = e.name
          .replace(/([A-Z])/g, '-$1')
          .toLowerCase()
          .replace(/^-/, '')
          .replace(/--/g, '-');
        results.push({ fullPath, relPath, dirName, pascal: e.name, kebab, dir: d });
      }
    }
  }
  walk(dir);
  return results;
}

const pascalFiles = findPascalCss(srcDir);
console.log(`Found ${pascalFiles.length} PascalCase CSS files:\n`);

// ── Find all imports of each PascalCase CSS file ──
function findImportRefs(pascalName, kebabName, dirName) {
  const refs = [];
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist') {
        walk(path.join(d, e.name));
      } else if (/\.(jsx|js|tsx|ts)$/.test(e.name)) {
        const filePath = path.join(d, e.name);
        const content = fs.readFileSync(filePath, 'utf8');
        // Match both './DirName.css' and './dir-name.css' style imports
        const patterns = [
          new RegExp(`['"]\\.\\/${pascalName.replace('.', '\\.')}['"]`, 'g'),
          new RegExp(`['"]\\.\\.\\/.*\\/${pascalName.replace('.', '\\.')}['"]`, 'g'),
          new RegExp(`['"].*\\/${pascalName.replace('.', '\\.')}['"]`, 'g'),
        ];
        const imports = [];
        for (const pat of patterns) {
          const matches = content.match(pat);
          if (matches) imports.push(...matches);
        }
        if (imports.length > 0) {
          refs.push({ filePath, imports: [...new Set(imports)] });
        }
      }
    }
  }
  walk(srcDir);
  return refs;
}

// Also find references in nest/ for components that might be shared
function findNestRefs(pascalName) {
  const nestDir = 'C:/wamp64/www/trading-command-suite/nest';
  if (!fs.existsSync(nestDir)) return [];
  const refs = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist') {
        walk(path.join(d, e.name));
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        const filePath = path.join(d, e.name);
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes(pascalName)) {
          refs.push({ filePath, note: 'contains reference (may be comment)' });
        }
      }
    }
  }
  walk(nestDir);
  return refs;
}

let totalRefs = 0;
const operations = [];

for (const pf of pascalFiles) {
  const refs = findImportRefs(pf.pascal, pf.kebab, pf.dirName);
  const nestRefs = findNestRefs(pf.pascal);
  
  console.log(`${pf.relPath}`);
  console.log(`  → ${pf.kebab}  (${refs.length} JSX refs${nestRefs.length ? ', ' + nestRefs.length + ' nest refs' : ''})`);
  
  if (refs.length === 0) {
    console.log(`  ⚠ NO IMPORT REFERENCES FOUND — may be unused!`);
  }
  
  for (const r of refs) {
    const relRef = path.relative(srcDir, r.filePath).replace(/\\/g, '/');
    console.log(`    ref: ${relRef}`);
    totalRefs++;
  }
  
  operations.push({ pf, refs, nestRefs });
}

console.log(`\nTotal: ${pascalFiles.length} renames, ${totalRefs} import updates`);

// ── Also check architecture-framework duplicate ──
const archBase = path.join(srcDir, 'pages');
const archFile1 = path.join(archBase, 'architecture-framework.css');
const archFile2 = path.join(archBase, 'architecture-framework-modern.css');
if (fs.existsSync(archFile1) && fs.existsSync(archFile2)) {
  console.log(`\n─── Duplicate: architecture-framework ───`);
  const size1 = fs.statSync(archFile1).size;
  const size2 = fs.statSync(archFile2).size;
  console.log(`  architecture-framework.css: ${size1} bytes`);
  console.log(`  architecture-framework-modern.css: ${size2} bytes`);
}

// ── Execute if not dry run ──
if (dryRun) {
  console.log('\n🔍 DRY RUN — no changes made. Set dryRun=false to execute.');
  process.exit(0);
}

console.log('\n🔧 Executing renames...');

const gitMoves = [];

for (const op of operations) {
  const oldPath = op.pf.fullPath;
  const newPath = path.join(op.pf.dir, op.pf.kebab);
  
  // Rename file
  fs.renameSync(oldPath, newPath);
  console.log(`  mv ${op.pf.relPath} → ${op.pf.kebab}`);
  gitMoves.push({ old: op.pf.fullPath, new: newPath, relOld: op.pf.relPath, relNew: path.relative(srcDir, newPath).replace(/\\/g, '/') });
  
  // Update JSX imports
  for (const ref of op.refs) {
    let content = fs.readFileSync(ref.filePath, 'utf8');
    for (const imp of ref.imports) {
      const newImp = imp.replace(op.pf.pascal, op.pf.kebab);
      content = content.replace(imp, newImp);
    }
    fs.writeFileSync(ref.filePath, content);
    const relRef = path.relative(srcDir, ref.filePath).replace(/\\/g, '/');
    console.log(`    updated: ${relRef}`);
  }
  
  // Check nest refs (just warn)
  for (const nr of op.nestRefs) {
    console.log(`    ⚠ nest ref (not auto-updated): ${path.relative('C:/wamp64/www/trading-command-suite', nr.filePath)}`);
  }
}

// ── Merge architecture-framework duplicates ──
if (fs.existsSync(archFile1) && fs.existsSync(archFile2)) {
  console.log('\n📦 Merging architecture-framework duplicates...');
  const modern = fs.readFileSync(archFile2, 'utf8');
  fs.appendFileSync(archFile1, '\n\n/* ─── Merged from architecture-framework-modern.css (#507) ─── */\n\n' + modern);
  fs.unlinkSync(archFile2);
  console.log('  architecture-framework-modern.css → merged into architecture-framework.css');
  
  // Find and remove import of architecture-framework-modern.css
  function findAndRemoveArchModernImport() {
    function walk(d) {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
          walk(path.join(d, e.name));
        } else if (/\.(jsx|js)$/.test(e.name)) {
          const fp = path.join(d, e.name);
          let content = fs.readFileSync(fp, 'utf8');
          if (content.includes('architecture-framework-modern.css')) {
            content = content.replace(/import\s+['"]\.\/architecture-framework-modern\.css['"];?\s*/g, '');
            content = content.replace(/\n{3,}/g, '\n\n');
            fs.writeFileSync(fp, content);
            console.log(`  removed import in: ${path.relative(srcDir, fp)}`);
          }
        }
      }
    }
    walk(srcDir);
  }
  findAndRemoveArchModernImport();
}

console.log('\n✅ Done. Run: npm run build  to verify.');
