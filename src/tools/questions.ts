import type { Tool } from "./types.ts";

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

export const askQuestions: Tool = {
  name: "ask_questions",
  description: "Ask the user for clarification or preferences using an interactive questionnaire. Use when you need user input before proceeding. Each question accepts a suggested option or a custom text answer. Never invent answers or repeat a cancelled/unavailable questionnaire.",
  parameters: {
    type: "object",
    properties: {
      questions: {
        type: "array", minItems: 1, maxItems: 8,
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question to ask" },
            options: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8, description: "Optional suggested answers; custom text is always allowed" },
          },
          required: ["question"],
        },
      },
    },
    required: ["questions"],
  },
  async run({ questions }, { askQuestions, signal }) {
    const parsed = parseQuestions(questions);
    if (!askQuestions) return { output: "Interactive questionnaires are unavailable in this mode. Ask your questions in your text response instead.", isError: true };
    const answers = await askQuestions(parsed, signal);
    return answers === null
      ? { output: "Questionnaire cancelled by user. No answers submitted.", isError: true }
      : JSON.stringify({ answers });
  },
};
