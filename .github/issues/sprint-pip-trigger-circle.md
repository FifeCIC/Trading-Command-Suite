## Source

`/trading212/t212-portfolio` — `<button.pip-trigger>`

## Problem

The page info button (ℹ) is a plain square button. It should be a circle with a modern hover effect.

## Expected

- Make the button circular
- Add a modern hover effect (e.g., subtle scale, glow, or color transition)
- Apply the same change to ALL other views that use the pip-trigger/ℹ button

## Element

```html
<button type="button" class="pip-trigger" popovertarget=":r5:" aria-label="Page info" title="Page info">ℹ</button>
```
