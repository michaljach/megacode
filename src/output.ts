/** Character budgets are provider-neutral bounds, not token estimates. */
export const OUTPUT_CHARS = 12_000;
export const READ_LINES = 200;

/** Keep both setup/errors at the start and summaries/failures at the end. */
export function previewOutput(text: string, budget = OUTPUT_CHARS): string {
  if (text.length <= budget) return text;
  const head = Math.ceil(budget / 2);
  const tail = Math.floor(budget / 2);
  return `${text.slice(0, head)}\n... [${text.length - budget} chars omitted]\n${text.slice(-tail)}`;
}

/** Never cut a source line silently. A single oversized line is returned in full. */
export function filePage(text: string, offset = 1, limit = READ_LINES): string {
  if (!Number.isInteger(offset) || offset < 1 || !Number.isInteger(limit) || limit < 1)
    throw new Error("offset and limit must be positive integers");
  const lines = text.split("\n");
  if (offset > lines.length) return `[EOF: ${lines.length} lines]`;
  const page: string[] = [];
  let size = 0;
  let next = offset;
  for (; next <= lines.length && next < offset + limit; next++) {
    const line = `${next}\t${lines[next - 1]}`;
    if (page.length && size + line.length + 1 > OUTPUT_CHARS) break;
    page.push(line);
    size += line.length + 1;
  }
  if (next <= lines.length) page.push(`[${lines.length} lines total; continue with offset=${next}]`);
  return page.join("\n");
}
