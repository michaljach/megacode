import type { Question, Tool } from "../../core/tools.ts";

const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 8;
const MAX_QUESTION_LENGTH = 1000;
const MAX_OPTION_LENGTH = 200;

const isText = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && v.length <= max;
const inRange = (list: unknown[], max: number) => list.length >= 1 && list.length <= max;

function parseQuestion(item: unknown): Question {
  const obj = typeof item === "object" && item !== null ? item : {};
  const { question, options } = obj as { question?: unknown; options?: unknown };
  if (!isText(question, MAX_QUESTION_LENGTH))
    throw new Error(`Each question must have non-empty question text (up to ${MAX_QUESTION_LENGTH} characters).`);
  if (options === undefined) return { question: question.trim() };
  if (!Array.isArray(options) || !inRange(options, MAX_OPTIONS) || !options.every((o) => isText(o, MAX_OPTION_LENGTH)))
    throw new Error(`options must contain 1 to ${MAX_OPTIONS} non-empty strings (up to ${MAX_OPTION_LENGTH} characters each).`);
  return { question: question.trim(), options: options.map((o: string) => o.trim()) };
}

/** Validate model-supplied input before opening an interactive form. */
export function parseQuestions(input: unknown): Question[] {
  if (!Array.isArray(input) || !inRange(input, MAX_QUESTIONS))
    throw new Error(`questions must contain between 1 and ${MAX_QUESTIONS} questions.`);
  return input.map(parseQuestion);
}

export const askQuestions: Tool<{ questions: unknown }> = {
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
