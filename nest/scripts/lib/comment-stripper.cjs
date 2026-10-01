/**
 * strip-comments.cjs — remove `//` and block comments from TypeScript/JS/JSX source, safely.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Two validators were asking "does this file MENTION X?" using `text.includes('X')` over the whole
 * file — comments included. That produced false positives in both directions:
 *
 *   • `validate-close-attribution.cjs` flagged files that name `closeReason` only in a COMMENT.
 *     Three of its six allowlist entries existed for exactly that reason, and the guard's own
 *     message warns that "a wide allowlist is the same as no guard" — so the fix is to stop the
 *     false positive, not to keep writing exemptions for it.
 *   • `validate-create-form-coverage.cjs` read a payload whose `//` comment contained BACKTICKS.
 *     The scanner treats a backtick as a string delimiter, so the comment opened a fake string and
 *     swallowed real keys: **23 keys read as 19, and the guard still printed OK.**
 *
 * ⚠️ THE POINT IS NOT "IGNORE COMMENTS TO SILENCE A WARNING". A comment is not code: it cannot
 * write a column and it cannot submit a form field. Including comment text in a code-mention check
 * means the check is measuring prose.
 *
 * ⚠️ WHY NOT A REGEX. `/\/\/.*$/gm` cuts a line at `https://` inside a string literal, hiding real
 * code on that line — trading a false positive for a false NEGATIVE, which is strictly worse. This
 * scanner tracks string and template-literal state so a `//` inside a string is left alone.
 *
 * ⚠️ NOT HANDLED: a regular-expression literal containing `//` (e.g. `/a\/\/b/`). A regex literal is
 * indistinguishable from division without a full parser, and no file this is used on contains one.
 * Stated rather than left as an assumption, because the failure would be a silently truncated line.
 */
'use strict';

/**
 * @param {string} text
 * @returns {string} the same text with comment CONTENT removed, keeping line breaks so any
 *   line-number arithmetic over the result still lines up.
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  let inString = null; // the opening quote character, or null

  while (i < text.length) {
    const c = text[i];

    if (inString) {
      out += c;
      if (c === '\\') {
        // Escape sequence — copy the escaped character verbatim so `\'` cannot close a string.
        if (i + 1 < text.length) out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i++;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      inString = c;
      out += c;
      i++;
      continue;
    }

    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue; // the newline itself is copied on the next iteration
    }

    if (c === '/' && text[i + 1] === '*') {
      // A block comment may span lines; emit one newline per line consumed so line numbers hold.
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i += 2; // consume the closing */
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

module.exports = { stripComments };
