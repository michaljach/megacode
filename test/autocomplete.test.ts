import assert from "node:assert/strict";
import { test } from "node:test";
import { promptCompletion } from "../src/ui/prompt/autocomplete.ts";

test("contextual suggestions display on an empty prompt and complete matching prefixes", () => {
  assert.equal(promptCompletion("", 0, "Run the tests", true), "Run the tests");
  assert.equal(promptCompletion("Run", 3, "Run the tests", true), " the tests");
  assert.equal(promptCompletion("Run the tests", 13, "Run the tests", true), "");
});

test("disabled, mismatching, mid-edit and slash prompts have no ghost text", () => {
  assert.equal(promptCompletion("", 0, "Run tests", false), "");
  assert.equal(promptCompletion("Fix", 3, "Run tests", true), "");
  assert.equal(promptCompletion("Run", 1, "Run tests", true), "");
  assert.equal(promptCompletion("/", 1, "/config", true), "");
  assert.equal(promptCompletion("", 0, "", true), "");
});
