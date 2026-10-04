/** "1 line", "1,234 lines". */
export const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
