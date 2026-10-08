// Wording helpers.

/** Short joining words that stay lower case in title case, unless first or last. */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'with']);

/**
 * Title case for controls (buttons, labels, chips): "Add an account" → "Add an Account".
 * Only first letters are raised, so acronyms, amounts and names keep their own case ("Sync IBKR Now").
 */
export function titleCase(text) {
  const words = String(text ?? '').split(' ');
  return words.map((w, i) => {
    const small = i > 0 && i < words.length - 1 && SMALL_WORDS.has(w);
    return small ? w : w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}
