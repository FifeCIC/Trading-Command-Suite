/**
 * EpisodeTracker — proving `count` counts episodes, not polls.
 *
 * ⚠️ The failure these cases exist to prevent is not a crash: it is a plausible number. A fault
 * counted once per poll looks exactly like a fault counted once per episode, right up until someone
 * reads "1,440 occurrences" as "this happened 1,440 times".
 */
import { EpisodeTracker } from './episode-tracker';

describe('EpisodeTracker', () => {
  it('counts ONE for a condition observed on 100 consecutive polls', () => {
    const t = new EpisodeTracker();
    const events = Array.from({ length: 100 }, () => t.observe('data-staleness', true));

    expect(events.filter((e) => e === 'started')).toHaveLength(1);
    expect(events.filter((e) => e === 'ongoing')).toHaveLength(99);
  });

  it('counts AGAIN after the condition clears and returns — recurrence is the whole value', () => {
    const t = new EpisodeTracker();

    expect(t.observe('data-staleness', true)).toBe('started');
    expect(t.observe('data-staleness', false)).toBe('quiet');
    expect(t.observe('data-staleness', true)).toBe('started');
  });

  it('tracks conditions independently', () => {
    const t = new EpisodeTracker();

    expect(t.observe('mt5-disconnected', true)).toBe('started');
    expect(t.observe('data-staleness', true)).toBe('started');
    expect(t.observe('mt5-disconnected', true)).toBe('ongoing');
    expect(t.activeKeys().sort()).toEqual(['data-staleness', 'mt5-disconnected']);
  });

  it('ADOPTED episodes are not counted again — a restart must not inflate the count', () => {
    const t = new EpisodeTracker();
    // What a booting process does with the faults it reads back from the table.
    t.adopt(['TCS-ALERT-DATA-STALENESS', 'TCS-ALERT-POSITION-PNL']);

    expect(t.observe('TCS-ALERT-DATA-STALENESS', true)).toBe('ongoing');
    expect(t.observe('TCS-ALERT-POSITION-PNL', true)).toBe('ongoing');
    // …but a fault that was NOT adopted is still a new episode.
    expect(t.observe('TCS-ALERT-SYMBOL-SILENT', true)).toBe('started');
  });

  it('stays quiet for a condition that was never active', () => {
    const t = new EpisodeTracker();

    expect(t.observe('earnings-proximity', false)).toBe('quiet');
    expect(t.activeKeys()).toEqual([]);
  });
});
