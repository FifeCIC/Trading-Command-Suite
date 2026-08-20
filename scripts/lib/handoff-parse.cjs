/**
 * handoff-parse.cjs — shared handoff markdown parsing.
 * =====================================================================
 * Used by scripts/handoff-to-discord.cjs (phase 1, #652) and
 * scripts/weekly-digest-discord.cjs (phase 2, #653). One parser for the
 * handoff frontmatter + "What Changed" summary + issue references.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Extract YAML frontmatter ({key: value} lines between leading --- fences). */
function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return fm;
}

/** First non-empty paragraph under `## What Changed` (case-insensitive), collapsed to one line. */
function oneLineSummary(md, heading = 'What Changed') {
  const section = md.match(new RegExp(`^##\\s+${heading}\\s*\\r?\\n([\\s\\S]*?)(?=\\n##\\s|\\Z)`, 'im'));
  if (!section) return null;
  const para = section[1].split(/\r?\n\r?\n/).map((p) => p.trim()).find(Boolean);
  if (!para) return null;
  const one = para.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length > 280 ? `${one.slice(0, 277)}…` : one;
}

/** Unique issue numbers referenced anywhere in the doc: (#652), #652, issue 652. */
function referencedIssues(md) {
  const set = new Set();
  const re = /(?:^|[^\w#])#(\d{2,})\b|issue\s+#?(\d{2,})\b/gi;
  let m;
  while ((m = re.exec(md)) !== null) set.add(Number(m[1] || m[2]));
  return [...set].sort((a, b) => a - b);
}

/** Date from frontmatter, else from a YYYY-MM-DD filename prefix. */
function handoffDate(fm, filePath) {
  if (fm.date) return fm.date;
  const fn = path.basename(filePath);
  const m = fn.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Parse a handoff file into a uniform shape.
 * @returns {{file, date, area, type, title, summary, issues}}
 */
function parseHandoffFile(filePath) {
  const md = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(md);
  return {
    file: path.basename(filePath),
    date: handoffDate(fm, filePath),
    area: fm.area || 'general',
    type: fm.type || 'update',
    title: fm.title || null,
    summary: oneLineSummary(md),
    issues: referencedIssues(md),
  };
}

module.exports = { parseFrontmatter, oneLineSummary, referencedIssues, handoffDate, parseHandoffFile };
