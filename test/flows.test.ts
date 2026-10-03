import assert from "node:assert/strict";
import { test } from "node:test";
import { providerInfo } from "../src/adapters/providers/catalog.ts";
import { firstStep, friendlyError, stepAfterFailure, stepBack } from "../src/ui/loginFlow.ts";
import { previousAddStep, serverNameError, targetError } from "../src/ui/mcpWizard.ts";

const openai = providerInfo("openai"); // ChatGPT sign-in or a key
const groq = providerInfo("groq"); // key only
const ollama = providerInfo("ollama"); // local server
const compat = providerInfo("compat"); // custom endpoint, key optional

test("login starts at the method choice only when there is one", () => {
  assert.equal(firstStep(openai), "method");
  assert.equal(firstStep(groq), "key");
  assert.equal(firstStep(ollama), "url");
  assert.equal(firstStep(compat), "url");
});

test("esc goes back one step, or closes when there is nothing before", () => {
  assert.equal(stepBack("pick", undefined, false), "close");
  assert.equal(stepBack("method", openai, false), "pick");
  assert.equal(stepBack("method", openai, true), "close"); // opened as /login openai
  assert.equal(stepBack("key", openai, true), "method");
  assert.equal(stepBack("browser", openai, true), "method");
  assert.equal(stepBack("key", groq, false), "pick");
  assert.equal(stepBack("key", groq, true), "close");
  assert.equal(stepBack("key", compat, true), "url"); // the key comes after the endpoint
  assert.equal(stepBack("url", ollama, false), "pick");
});

test("a failure returns to the step that can fix it", () => {
  assert.equal(stepAfterFailure(ollama, undefined, ""), "url"); // not "key": local servers have none
  assert.equal(stepAfterFailure(compat, undefined, ""), "url");
  assert.equal(stepAfterFailure(compat, undefined, "sk-x"), "key");
  assert.equal(stepAfterFailure(groq, undefined, "gsk-x"), "key");
  assert.equal(stepAfterFailure(openai, "key", "sk-x"), "key");
  assert.equal(stepAfterFailure(openai, "chatgpt", ""), "method");
  assert.equal(stepAfterFailure(providerInfo("openrouter"), "openrouter-oauth", "sk-or-x"), "method");
});

test("verification errors say what to do", () => {
  assert.match(friendlyError(Object.assign(new Error("nope"), { status: 401 })), /credentials were rejected/);
  assert.match(friendlyError(new Error("Incorrect API key provided")), /credentials were rejected/);
  assert.equal(friendlyError(new Error("connect ECONNREFUSED"), ollama, "http://localhost:11434/v1"),
    "Couldn't connect. Is Ollama running at http://localhost:11434/v1?");
  assert.equal(friendlyError(new Error("Connection error."), groq), "Couldn't connect. Check the URL and your network.");
  assert.equal(friendlyError(new Error("first line\nstack")), "first line");
});

test("the MCP add wizard steps back in order and validates each answer", () => {
  assert.equal(previousAddStep("extras"), "target");
  assert.equal(previousAddStep("target"), "type");
  assert.equal(previousAddStep("type"), "name");
  assert.equal(previousAddStep("name"), null);

  assert.equal(serverNameError("github", ["slack"]), null);
  assert.match(serverNameError("git hub", [])!, /letters, digits/);
  assert.match(serverNameError("slack", ["slack"])!, /already exists/);

  assert.equal(targetError("stdio", "npx -y server"), null);
  assert.equal(targetError("stdio", "  "), "Enter a command.");
  assert.equal(targetError("http", "https://x/mcp"), null);
  assert.match(targetError("sse", "ftp://x")!, /http:\/\/ or https:\/\//);
  assert.match(targetError("http", "not a url")!, /http:\/\/ or https:\/\//);
});
