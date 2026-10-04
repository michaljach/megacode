/** Suggestions are display-only until explicitly accepted. */
export function promptCompletion(value: string, cursor: number, suggestion: string, enabled: boolean): string {
  if (!enabled || cursor !== value.length || value.trimStart().startsWith("/")) return "";
  return suggestion.startsWith(value) ? suggestion.slice(value.length) : "";
}
