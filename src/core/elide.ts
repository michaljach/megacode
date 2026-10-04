/** `text` cut to about `budget` characters, keeping the start (setup, errors) and the end (summaries, failures). */
export function elideMiddle(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const head = Math.ceil(budget / 2);
  const tail = Math.floor(budget / 2);
  return `${text.slice(0, head)}\n... [${text.length - budget} chars omitted]\n${text.slice(-tail)}`;
}
