import { expect } from './playwright.mjs';

// Read the actual rendered ProseMirror document, including exact file tokens.
// Empty trailing <br> nodes are caret placeholders, not authored newlines.
function composerDOMText(element) {
  const read = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.hasAttribute('data-reference-text')) return node.getAttribute('data-reference-text');
      if (node.tagName === 'BR') return node.classList.contains('ProseMirror-trailingBreak') ? '' : '\n';
    }
    return Array.from(node.childNodes).map(child => read(child)).join('');
  };
  return Array.from(element.childNodes).map(node => read(node)).join('\n');
}

export const readComposerText = locator => locator.evaluate(composerDOMText);
export async function expectComposerText(locator, value, options) {
  const actual = expect.poll(() => readComposerText(locator), options);
  if (value instanceof RegExp) await actual.toMatch(value);
  else await actual.toBe(value);
}

// Caret checks use a real DOM Range, never a textarea-compatible property shim.
export async function composerCaretAtStart(locator) {
  await locator.focus();
  await locator.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await expect.poll(() => composerCaretOffset(locator)).toBe(0);
}
export async function composerCaretOffset(locator) {
  return locator.evaluate(element => {
    const selection = getSelection();
    if (!selection?.anchorNode || !element.contains(selection.anchorNode)) return -1;
    const range = document.createRange(); range.selectNodeContents(element); range.setEnd(selection.anchorNode, selection.anchorOffset);
    return range.toString().length;
  });
}
