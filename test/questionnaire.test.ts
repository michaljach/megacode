import assert from "node:assert/strict";
import test from "node:test";
import { builtinTools } from "../src/adapters/tools/index.ts";
import { parseQuestions } from "../src/adapters/tools/questions.ts";
import type { AskQuestions } from "../src/core/tools.ts";

const call = { id: "q1", name: "ask_questions", input: { questions: [{ question: "Which framework?", options: ["React", "Vue"] }, { question: "Any constraints?" }] } };
const approve = async () => { throw new Error("Questions must not use permission approvals"); };
const execute = (input: typeof call, askQuestions?: AskQuestions, signal?: AbortSignal) =>
  builtinTools.execute(input, { approve, askQuestions, signal });

test("questionnaire is advertised and returns structured user answers", async () => {
  assert.ok(builtinTools.specs().some((tool) => tool.name === call.name));
  const answers = [{ question: "Which framework?", answer: "React" }, { question: "Any constraints?", answer: "No dependencies" }];
  const result = await execute(call, async (questions) => {
    assert.deepEqual(questions, call.input.questions);
    return answers;
  });
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.output), { answers });
});

test("questionnaire validates nested model input", () => {
  for (const input of [null, {}, [], Array(9).fill({ question: "Q" }), [null], [{ question: " " }], [{ question: "Q", options: [] }], [{ question: "Q", options: [42] }]]) {
    assert.throws(() => parseQuestions(input));
  }
  assert.deepEqual(parseQuestions([{ question: " Q ", options: [" A "] }]), [{ question: "Q", options: ["A"] }]);
});

test("invalid arguments never open the form", async () => {
  const result = await execute({ ...call, input: { questions: [{ question: "" }] } } as typeof call, async () => {
    assert.fail("must not open");
  });
  assert.equal(result.isError, true);
});

test("plain mode has an explicit non-blocking fallback", async () => {
  const result = await execute(call);
  assert.equal(result.isError, true);
  assert.match(result.output, /unavailable/);
});

test("cancellation does not fabricate answers", async () => {
  const result = await execute(call, async () => null);
  assert.equal(result.isError, true);
  assert.match(result.output, /No answers submitted/);
});

test("already aborted calls never open the form", async () => {
  const result = await execute(call, async () => {
    assert.fail("must not open");
  }, AbortSignal.abort());
  assert.equal(result.isError, true);
});
