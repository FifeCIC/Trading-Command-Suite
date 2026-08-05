## Source

`/scoring/directives-manager` — `<th>Protocols</th>`

## Problem

The "Protocols" column in the directives table shows counts (e.g., 2, 3) but the user suspects the counter is wrong — there are no directives that actually have 2 or more protocols associated.

## Expected

- Investigate how the Protocols count is computed
- Fix the count to accurately reflect the number of protocols each directive belongs to
- If a directive is in 0 protocols, show "0" or "—" rather than an incorrect positive number

## Element

```html
<th>Protocols</th>
```
