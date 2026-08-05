## Source

`/trading212/t212-portfolio` — `<th>Avg Price</th>`

## Problem

The "Avg Price" column in the Trading212 portfolio table is always empty. Either the data isn't being fetched or the column is mapped to the wrong field.

## Expected

- Investigate why the column is empty
- Either populate it with the correct data from the T212 API, or remove the column if the data isn't available from T212

## Element

```html
<th>Avg Price</th>
```
