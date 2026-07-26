/**
 * GlossaryRichText — renders text with glossary terms linked
 * ==========================================================
 * Takes a plain-text string and replaces known glossary terms with
 * interactive GlossaryPopover links.
 *
 * Algorithm: scans the text for glossary terms (longest match first to
 * avoid partial matches) and wraps them in <GlossaryPopover> components.
 *
 * Usage:
 *   <GlossaryRichText text="Scores pullback quality using ATR-normalized distance" />
 */

import GlossaryPopover from './GlossaryPopover';
import { getAllGlossary } from '../data/glossary';

// Build sorted term list once at module level
let _terms = null;
function getTerms() {
  if (_terms) return _terms;
  try {
    const glossary = getAllGlossary();
    if (!glossary || !Array.isArray(glossary)) {
      _terms = [];
      return _terms;
    }
    const terms = new Set();
    glossary.forEach((entry) => {
      terms.add(entry.term.toLowerCase());
      (entry.aliases || []).forEach((a) => terms.add(a.toLowerCase()));
    });
    _terms = Array.from(terms).sort((a, b) => b.length - a.length);
  } catch {
    _terms = [];
  }
  return _terms;
}

export default function GlossaryRichText({ text }) {
  if (!text || typeof text !== 'string') return <span>{text}</span>;
  return <span>{parseGlossaryText(text)}</span>;
}

/**
 * Splits text into segments, wrapping glossary terms.
 */
function parseGlossaryText(text) {
  const terms = getTerms();
  if (!terms || terms.length === 0) return text;
  const segments = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let found = null;

    // Find the earliest occurrence of any glossary term (case-insensitive)
    for (const term of terms) {
      // Use a word-boundary-aware regex for cleaner matching
      const idx = remaining.toLowerCase().indexOf(term);
      if (idx !== -1 && (found === null || idx < found.idx || (idx === found.idx && term.length > found.term.length))) {
        found = { idx, term, len: term.length };
      }
    }

    if (found === null) {
      // No more glossary terms — push remaining as plain text
      segments.push(<span key={key++}>{remaining}</span>);
      break;
    }

    // Text before the match
    if (found.idx > 0) {
      segments.push(<span key={key++}>{remaining.slice(0, found.idx)}</span>);
    }

    // The glossary term itself (preserve original casing)
    const originalCasing = remaining.slice(found.idx, found.idx + found.len);
    segments.push(
      <GlossaryPopover key={key++} term={found.term}>
        {originalCasing}
      </GlossaryPopover>
    );

    remaining = remaining.slice(found.idx + found.len);
  }

  return segments;
}
