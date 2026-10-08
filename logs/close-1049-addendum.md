## The one criterion this was left open for is now OBSERVED — closing

**Criterion:** *"A re-import produces no new duplicate (the audit's count stops growing)."* It required a full daily-bar cycle to run after the 10-01 fix; none had. It has now been through the Friday 10-02 week-close plus a week of cycles.

**Measured 2026-10-08** (same strict definition as filing — open, high, low, close AND volume all identical to the previous bar, provider mt5):

| check | value |
|---|---|
| strict duplicates with bar time **≥ 2026-10-02** (after the fix) | **0** |
| newest duplicate bar in the whole table | **2026-09-11 21:00** — three weeks before the fix |
| total duplicates now (was 205 at filing) | 185 — all historical |

So the writer stopped emitting them: the Friday signature is gone from everything written since 10-01, and one complete Friday cycle (10-02) produced no new row.

**Deferred (as stated at filing, unchanged):** the 185 historical rows are NOT deleted by this issue — that stays an explicit decision for a later pass (the audit warns rather than fails, by design). The other two criteria (writer named; rule + unit tests both directions) were verified on 10-01.