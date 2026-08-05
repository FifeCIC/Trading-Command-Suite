## Source

`/qa/qa-testing` — `<textarea.qa-feedback-input>`

## Problem

The QA testing page has a feedback/notes textarea that will never be used. It adds UI clutter for no value.

## Expected

Remove the feedback textarea entirely.

## Element

```html
<textarea class="qa-feedback-input" placeholder="Leave testing notes or feedback..." rows="2"></textarea>
```
