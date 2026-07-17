/**
 * CopyViewData — Floating action button that copies the current view's
 * data as formatted Markdown to the clipboard.
 *
 * Usage:
 *   <CopyViewData getMarkdown={() => generateMarkdown(data)} />
 *
 * Renders a small disc button consistent with the existing floating
 * action buttons (Bookmark, Calculators, Screen Options).
 */

import { useState, useCallback } from 'react';
import './copy-view-data.css';

export default function CopyViewData({ getMarkdown }) {
  const [feedback, setFeedback] = useState('');

  const handleCopy = useCallback(async () => {
    try {
      const md = getMarkdown();
      await navigator.clipboard.writeText(md);
      setFeedback('Copied!');
    } catch {
      setFeedback('Failed');
    }
    setTimeout(() => setFeedback(''), 1800);
  }, [getMarkdown]);

  if (typeof getMarkdown !== 'function') return null;

  return (
    <button
      className="cvd-disc"
      onClick={handleCopy}
      title="Copy view data as Markdown"
      aria-label="Copy view data"
    >
      {feedback ? (
        <span className="cvd-feedback">{feedback}</span>
      ) : (
        <span className="cvd-icon">📋</span>
      )}
    </button>
  );
}
