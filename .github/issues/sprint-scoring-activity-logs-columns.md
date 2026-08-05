## Source

`/scoring/scoring-activity-logs` (route uses `/scoring/scoring-runs` data)

## Problem

The column header says "Protocol / Strategy" — conflating two different concepts. A scoring run may involve:
- A protocol (always present — defines what to score)
- A scoring strategy (sometimes present — applies gates and custom rules)

They should be in separate columns.

## Expected

- Split the combined column into two:
  - **Protocol** — always populated
  - **Scoring Strategy** — populated when a scoring strategy was used, empty/"—" otherwise

## Note

This is described as "one of the most plain views in the app but it works as a log" — keep the simplicity, just fix the column confusion.

## Element

```html
<th>Protocol / Strategy</th>
```
