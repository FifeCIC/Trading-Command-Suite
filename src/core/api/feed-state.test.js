/**
 * feedState — the four states, and the one that used to be invisible.
 *
 * The 'unknown' case is the whole point of the module and it is a MEASURED case, not a hypothetical:
 * a 404-ing query reported `isError: false` for the entire retry wait while `data` was undefined.
 * Any page that tests `isError` alone renders its empty state during that window.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { feedState, feedUnavailable } from './feed-state.js';

test('a request in flight with nothing yet is loading, not empty', () => {
  assert.equal(feedState({ isError: false, data: undefined, isPending: true, isFetching: true }), 'loading');
});

test('a settled answer is ready — even when the answer is an empty list', () => {
  assert.equal(feedState({ isError: false, data: [], isPending: false, isFetching: false }), 'ready');
  assert.equal(feedState({ isError: false, data: { runs: [] }, isPending: false }), 'ready');
});

test('a failed request is error', () => {
  assert.equal(feedState({ isError: true, data: undefined, isPending: false, isFetching: false }), 'error');
});

test('the RETRY WAIT is unknown — this is the case that printed a false zero', () => {
  // Exact shape observed 2026-11-06 against a URL that returns 404: failureCount 1, between attempts.
  assert.equal(feedState({ isError: false, data: undefined, isPending: true, isFetching: false }), 'unknown');
});

test('a paused query is unknown, not empty', () => {
  // `enabled: false` never sets isPending true in every version, so absence of data is the signal.
  assert.equal(feedState({ isError: false, data: undefined, isPending: false, isFetching: false }), 'unknown');
});

test('null data counts as an answer when the caller asked for null', () => {
  // `.catch(() => null)` is the ALLOWED pattern: the caller can tell null from [].
  assert.equal(feedState({ isError: false, data: null }), 'ready');
});

test('feedUnavailable covers error and unknown but not loading or ready', () => {
  assert.equal(feedUnavailable({ isError: true }), true);
  assert.equal(feedUnavailable({ isError: false, data: undefined, isPending: true, isFetching: false }), true);
  assert.equal(feedUnavailable({ isError: false, data: undefined, isPending: true, isFetching: true }), false);
  assert.equal(feedUnavailable({ isError: false, data: [] }), false);
});

test('a missing query object is unknown rather than a crash', () => {
  assert.equal(feedState(undefined), 'unknown');
  assert.equal(feedState(null), 'unknown');
});
