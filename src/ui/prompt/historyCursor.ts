/**
 * The history-cursor state machine behind the prompt's ↑/↓ browsing. Kept out of the
 * component so its transitions are unit testable; the component only feeds it keys
 * and the current history/value and applies the result.
 */
export type HistoryCursor = {
  /** Index into the history, or null when editing a fresh (not yet browsed) draft. */
  pos: number | null;
  /** The text the user had when navigation began; returned to when browsing ends. */
  draft: string | null;
};

export const freshCursor: HistoryCursor = { pos: null, draft: null };

/** History direction: -1 is up (older), 1 is down (newer). */
export type HistoryDirection = -1 | 1;

/** The result of one arrow press: the cursor after it and the text to load, or null to keep the current value. */
export type MoveResult = { cursor: HistoryCursor; text: string | null };

/**
 * What an arrow does given the current cursor, the history (newest last), and the current value.
 * Returns null text when the press keeps the existing value (at the oldest, or a no-op).
 */
export function moveCursor(
  cursor: HistoryCursor,
  dir: HistoryDirection,
  history: readonly string[],
  value: string,
): MoveResult {
  if (!history.length) return { cursor, text: null };
  if (cursor.pos === null) {
    // Editing a fresh draft: up starts from the newest entry and remembers the value to return to.
    if (dir === 1) return { cursor, text: null };
    const newest = history.length - 1;
    return { cursor: { pos: newest, draft: value }, text: history[newest]! };
  }
  const pos = cursor.pos;
  if (dir === -1) {
    if (pos === 0) return { cursor, text: null };
    return { cursor: { pos: pos - 1, draft: cursor.draft }, text: history[pos - 1]! };
  }
  // Down at the newest returns to the draft; otherwise steps toward it.
  if (pos === history.length - 1) {
    return { cursor: freshCursor, text: cursor.draft ?? null };
  }
  return { cursor: { pos: pos + 1, draft: cursor.draft }, text: history[pos + 1]! };
}

/** Editing the text restarts navigation: the next arrow resumes from the newest entry. */
export function commitCursor(cursor: HistoryCursor): HistoryCursor {
  return { pos: null, draft: cursor.draft };
}
