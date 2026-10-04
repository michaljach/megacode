// Cursor movement in the multi-line prompt, kept apart from rendering so it can be tested.

/** Start and end (exclusive, at the newline) of the line the cursor is on. */
export function lineBounds(text: string, cursor: number): { start: number; end: number } {
  const end = text.indexOf("\n", cursor);
  return { start: text.lastIndexOf("\n", cursor - 1) + 1, end: end === -1 ? text.length : end };
}

/** The cursor one line up or down, in the same column or at the end of a shorter line. */
export function verticalMove(text: string, cursor: number, dir: -1 | 1): number {
  const { start, end } = lineBounds(text, cursor);
  const column = cursor - start;
  if (dir === -1) return start === 0 ? cursor : Math.min(lineBounds(text, start - 1).start + column, start - 1);
  return end === text.length ? cursor : Math.min(end + 1 + column, lineBounds(text, end + 1).end);
}

/** Start of the word before the cursor, skipping whitespace first (alt+←, ctrl+w). */
export function wordStart(text: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  return i;
}

/** End of the word after the cursor, skipping whitespace first (alt+→). */
export function wordEnd(text: string, cursor: number): number {
  let i = cursor;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  while (i < text.length && !/\s/.test(text[i]!)) i++;
  return i;
}
