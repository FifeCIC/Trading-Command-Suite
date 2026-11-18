/**
 * change-suggestions.spec.ts — the canary for the queue of intended changes.
 *
 * ⚠️ Every case corresponds to a way this list could mislead the owner. It is a list of THINGS TO DO,
 * read by the person deciding what to build next — so a wrong row is worse than a missing one.
 */
import {
  coverageOf,
  validateSuggestion,
  type SuggestionRow,
} from './change-suggestions.service';

const row = (over: Partial<SuggestionRow> = {}): SuggestionRow => ({
  id: 'x',
  scope: 'protocol',
  protocolSlug: 'movers-long-v1',
  botId: null,
  kind: 'add-directive',
  targetKey: 'surge-detection',
  currentValue: null,
  suggestedValue: '100',
  rationale: 'rounded test rationale',
  status: 'queued',
  priority: 3,
  issueUrl: 'https://example/1',
  createdBy: 'test',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('validateSuggestion', () => {
  it('accepts a well-formed protocol suggestion', () => {
    expect(validateSuggestion({
      kind: 'add-directive',
      protocolSlug: 'movers-long-v1',
      rationale: 'surge-detection is the core big-mover detector',
    })).toBeNull();
  });

  it('⚠️ refuses a rationale that does not say why — the queue must not become noise', () => {
    expect(validateSuggestion({ kind: 'param', protocolSlug: 'p', rationale: '   ' })).toContain('rationale');
    expect(validateSuggestion({ kind: 'param', protocolSlug: 'p', rationale: 'better' })).toContain('rationale');
  });

  it('refuses an unknown kind rather than storing a word nothing understands', () => {
    expect(validateSuggestion({ kind: 'make-it-better' as never, protocolSlug: 'p', rationale: 'x'.repeat(20) }))
      .toContain('kind must be one of');
  });

  it('⚠️ refuses a protocol suggestion with no protocol — it could not be displayed on that page', () => {
    expect(validateSuggestion({ kind: 'add-directive', rationale: 'x'.repeat(20) }))
      .toContain('protocolSlug is required');
  });

  it('requires a botId when the scope is bot', () => {
    expect(validateSuggestion({ kind: 'bot-rule', scope: 'bot', rationale: 'x'.repeat(20) }))
      .toContain('botId is required');
  });

  it('bounds priority to 1–5 so ordering cannot be arbitrary', () => {
    expect(validateSuggestion({ kind: 'param', protocolSlug: 'p', rationale: 'x'.repeat(20), priority: 0 })).toContain('priority');
    expect(validateSuggestion({ kind: 'param', protocolSlug: 'p', rationale: 'x'.repeat(20), priority: 6 })).toContain('priority');
    expect(validateSuggestion({ kind: 'param', protocolSlug: 'p', rationale: 'x'.repeat(20), priority: 1 })).toBeNull();
  });
});

describe('coverageOf', () => {
  it('counts every status, including the zeroes', () => {
    const c = coverageOf([row(), row({ status: 'accepted' })]);
    expect(c.total).toBe(2);
    expect(c.byStatus.queued).toBe(1);
    expect(c.byStatus.accepted).toBe(1);
    expect(c.byStatus.rejected).toBe(0); // a present zero, not an absent key
  });

  it('⚠️ counts missing-directive placeholders SEPARATELY — that is the real backlog', () => {
    const c = coverageOf([
      row({ kind: 'missing-directive', targetKey: 'opening-range-breakout' }),
      row({ kind: 'add-directive' }),
      row({ kind: 'missing-directive', targetKey: 'squeeze-risk' }),
    ]);
    expect(c.missingDirectives).toBe(2);
    expect(c.total).toBe(3);
  });

  it('⚠️ REPORTS rows with no issue instead of treating them as satisfied', () => {
    const c = coverageOf([row({ issueUrl: null }), row({ issueUrl: 'https://example/2' })]);
    expect(c.withoutIssue).toBe(1);
  });

  it('is empty-safe', () => {
    const c = coverageOf([]);
    expect(c.total).toBe(0);
    expect(c.missingDirectives).toBe(0);
    expect(c.withoutIssue).toBe(0);
  });
});
