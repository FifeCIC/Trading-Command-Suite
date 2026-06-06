export function withDevTag(tag, meta = {}) {
  return {
    'data-dev-tag': tag,
    'data-dev-meta': JSON.stringify(meta)
  };
}

export function findTaggedElements() {
  return Array.from(document.querySelectorAll('[data-dev-tag]')).map((node) => ({
    tag: node.getAttribute('data-dev-tag'),
    meta: node.getAttribute('data-dev-meta') || '{}'
  }));
}
