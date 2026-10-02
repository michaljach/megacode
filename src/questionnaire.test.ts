import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestions } from "./questionnaire.ts";
import { executeTool, toolSpecs } from "./tools.ts";

const call = { id: "q1", name: "ask_questions", input: { questions: [{ question: "Which framework?", options: ["React", "Vue"] }, { question: "Any constraints?" }] } };
const approve = async () => { throw new Error("Questions must not use permission approvals"); };

test("questionnaire is advertised and returns structured user answers", async () => {
  assert.ok(toolSpecs.some((tool) => tool.name === call.name));
  const answers = [{ question: "Which framework?", answer: "React" }, { question: "Any constraints?", answer: "No dependencies" }];
  const result = await executeTool(call, approve, undefined, async (questions) => {
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
  const result = await executeTool({ ...call, input: { questions: [{ question: "" }] } }, approve, undefined, async () => {
    assert.fail("must not open");
  });
  assert.equal(result.isError, true);
});

test("plain mode has an explicit non-blocking fallback", async () => {
  const result = await executeTool(call, approve);
  assert.equal(result.isError, true);
  assert.match(result.output, /unavailable/);
});

test("cancellation does not fabricate answers", async () => {
  const result = await executeTool(call, approve, undefined, async () => null);
  assert.equal(result.isError, true);
  assert.match(result.output, /No answers submitted/);
});

test("already aborted calls never open the form", async () => {
  const result = await executeTool(call, approve, AbortSignal.abort(), async () => {
    assert.fail("must not open");
  });
  assert.equal(result.isError, true);
});
