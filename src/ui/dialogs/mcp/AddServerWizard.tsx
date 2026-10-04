import { Text } from "ink";
import { useState } from "react";
import { draftToConfig, parseExtra, type McpTransport, type ServerDraft } from "../../../adapters/mcp/config.ts";
import { mcp } from "../../../adapters/mcp/manager.ts";
import { Select, type Option } from "../../components/Select.tsx";
import { TextField } from "../../components/TextField.tsx";
import { previousAddStep, serverNameError, targetError, type AddStep } from "./mcpWizard.ts";

type Draft = ServerDraft & { name: string };

const TRANSPORTS: Option<McpTransport>[] = [
  { label: "stdio", value: "stdio", hint: "run a local command (npx, uvx, docker, a binary…)" },
  { label: "http", value: "http", hint: "remote server, streamable HTTP" },
  { label: "sse", value: "sse", hint: "remote server, legacy SSE" },
];

/** /mcp "Add server": name → transport → URL or command → headers or env vars; then saves and connects it. */
export function AddServerWizard({ existing, onAdded, onCancel }: { existing: string[]; onAdded: (name: string) => void; onCancel: () => void }) {
  const [step, setStep] = useState<AddStep>("name");
  const [draft, setDraft] = useState<Draft>({ name: "", type: "stdio", target: "", extras: {} });
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const isUrl = draft.type !== "stdio";

  function go(next: AddStep, patch: Partial<Draft> = {}) {
    setStep(next);
    setDraft((d) => ({ ...d, ...patch }));
    setInput("");
    setError("");
  }

  function back() {
    const previous = previousAddStep(step);
    if (previous) go(previous);
    else onCancel();
  }

  function addExtra(line: string) {
    if (!line) {
      mcp.add(draft.name, draftToConfig(draft));
      return onAdded(draft.name);
    }
    const extra = parseExtra(draft.type, line);
    if (!extra) return setError(isUrl ? "Use the form Name: value" : "Use the form KEY=value");
    go("extras", { extras: { ...draft.extras, [extra[0]]: extra[1] } });
  }

  const field = (prompt: string, placeholder: string, submit: (v: string) => void) => (
    <>
      <Text>{prompt}</Text>
      <TextField
        value={input}
        onChange={(v) => {
          setInput(v);
          setError("");
        }}
        onSubmit={submit}
        onCancel={back}
        placeholder={placeholder}
      />
    </>
  );

  return (
    <>
      {step === "name" &&
        field("Server name (used in tool names, e.g. mcp__github__create_issue):", "e.g. github", (v) => {
          const problem = serverNameError(v, existing);
          if (problem) return setError(problem);
          go("type", { name: v });
        })}
      {step === "type" && (
        <>
          <Text>How does megacode reach {draft.name}?</Text>
          <Select options={TRANSPORTS} onSelect={(type) => go("target", { type, extras: {} })} onCancel={back} />
        </>
      )}
      {step === "target" &&
        field(
          isUrl ? "Server URL:" : "Command to start the server:",
          isUrl ? "https://example.com/mcp" : "npx -y @modelcontextprotocol/server-filesystem ~/projects",
          (v) => {
            const problem = targetError(draft.type, v);
            if (problem) return setError(problem);
            go("extras", { target: v });
          },
        )}
      {step === "extras" && (
        <>
          {Object.keys(draft.extras).map((key) => (
            <Text key={key} dimColor>
              {"  "}
              {isUrl ? `${key}: ••••` : `${key}=••••`}
            </Text>
          ))}
          {field(
            isUrl ? "Add a header (Name: value), or press enter to finish:" : "Add an environment variable (KEY=value), or press enter to finish:",
            isUrl ? "Authorization: Bearer …" : "GITHUB_TOKEN=…",
            addExtra,
          )}
        </>
      )}
      {error && <Text color="red">{error}</Text>}
    </>
  );
}
