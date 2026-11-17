import { isAlreadyInCanonicalNews } from './news-dedupe';

describe('isAlreadyInCanonicalNews — the writer-side guard that makes the dedupe stick', () => {
  it('SKIPS when the story is already in newsarticle', async () => {
    const probe = jest.fn().mockResolvedValue(true);
    await expect(isAlreadyInCanonicalNews('https://x.test/a', probe)).resolves.toBe(true);
    expect(probe).toHaveBeenCalledWith('https://x.test/a');
  });

  it('INSERTS when the story is not in newsarticle', async () => {
    const probe = jest.fn().mockResolvedValue(false);
    await expect(isAlreadyInCanonicalNews('https://x.test/b', probe)).resolves.toBe(false);
  });

  it('passes the url through EXACTLY — no trimming, casing or query-stripping', async () => {
    // Widening the match would drop stories that were never duplicates.
    const probe = jest.fn().mockResolvedValue(false);
    const odd = '  HTTPS://X.test/A?utm=1#frag  ';
    await isAlreadyInCanonicalNews(odd, probe);
    expect(probe).toHaveBeenCalledWith(odd);
  });

  describe('an unmatchable item is allowed through, never silently dropped', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty', ''],
      ['whitespace only', '   '],
    ])('%s url → not a duplicate, and the probe is never called', async (_label, url) => {
      const probe = jest.fn().mockResolvedValue(true);
      await expect(isAlreadyInCanonicalNews(url, probe)).resolves.toBe(false);
      expect(probe).not.toHaveBeenCalled();
    });
  });

  it('FAILS OPEN when the probe throws — a duplicate is recoverable, a lost story is not', async () => {
    const probe = jest.fn().mockRejectedValue(new Error('newsarticle does not exist yet'));
    await expect(isAlreadyInCanonicalNews('https://x.test/c', probe)).resolves.toBe(false);
  });
});
