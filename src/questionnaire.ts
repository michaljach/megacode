export type Question = { question: string; options?: string[] };
export type Answer = { question: string; answer: string };
export type AskQuestions = (questions: Question[], signal?: AbortSignal) => Promise<Answer[] | null>;

/** Validate model-supplied input before opening an interactive form. */
export function parseQuestions(input: unknown): Question[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8)
    throw new Error("questions must contain between 1 and 8 questions.");
  return input.map((item) => {
    if (!item || typeof item !== "object" || typeof item.question !== "string" || !item.question.trim() || item.question.length > 1000)
      throw new Error("Each question must have non-empty question text (up to 1000 characters).");
    if (item.options !== undefined && (!Array.isArray(item.options) || item.options.length < 1 || item.options.length > 8 ||
      item.options.some((option: unknown) => typeof option !== "string" || !option.trim() || option.length > 200)))
      throw new Error("options must contain 1 to 8 non-empty strings (up to 200 characters each).");
    return { question: item.question.trim(), ...(item.options ? { options: item.options.map((s: string) => s.trim()) } : {}) };
  });
}
