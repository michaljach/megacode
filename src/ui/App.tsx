import { Box, Static, Text, useAnimation, useApp, useInput } from "ink";
import { useRef, useState } from "react";
import type { Agent, AgentEvents } from "../agent.ts";
import { loadAuth, saveAuth, saveSettings } from "../config.ts";
import { authStatus, isConfigured, PROVIDER_INFO, PROVIDERS, providerInfo, resetProvider } from "../providers/index.ts";
import type { Approve } from "../tools.ts";
import type { ToolCall } from "../types.ts";
import { formatCall, lastSafeBreak, previewOutput, renderMarkdown } from "./format.ts";
import { loadHistory, saveHistory } from "./history.ts";
import { LoginDialog } from "./LoginDialog.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { PromptInput, type Command } from "./PromptInput.tsx";
import { Select } from "./Select.tsx";

type Item =
  | { kind: "banner" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; first: boolean }
  | { kind: "tool"; call: ToolCall; output: string; isError: boolean }
  | { kind: "notice"; text: string; level: "info" | "warn" | "error" };

type Mode = "ask" | "accept-edits" | "yolo";
const MODES: Mode[] = ["ask", "accept-edits", "yolo"];
const EDIT_TOOLS = new Set(["write_file", "edit_file"]);

type Dialog = { type: "model"; query?: string } | { type: "login"; provider?: string; welcome?: boolean } | { type: "logout" };

type ApprovalRequest = Parameters<Approve>[0] & { resolve: (ok: boolean) => void };

const COMMANDS: Command[] = [
  { name: "/model", description: "Switch model (or /model provider:model)" },
  { name: "/login", description: "Connect a provider (API key or local server)" },
  { name: "/logout", description: "Remove saved credentials" },
  { name: "/clear", description: "Clear conversation history and screen" },
  { name: "/usage", description: "Show token usage for this session" },
  { name: "/help", description: "Show commands and keyboard shortcuts" },
  { name: "/exit", description: "Exit megacode" },
];

const SHORTCUTS: [string, string][] = [
  ["enter", "send message (queued while running)"],
  ["\\ + enter, option+enter", "newline"],
  ["↑ / ↓", "prompt history"],
  ["/", "commands"],
  ["esc", "interrupt · clear input"],
  ["shift+tab", "cycle permission mode"],
  ["ctrl+a / ctrl+e", "start / end of line"],
  ["ctrl+u / ctrl+k / ctrl+w", "delete to start / end / word"],
  ["ctrl+c", "interrupt · clear · exit (twice)"],
];

const VERBS = ["Thinking", "Pondering", "Working", "Crafting", "Computing", "Tinkering"];

export function App({ agent, initialMode }: { agent: Agent; initialMode: Mode }) {
  const { exit } = useApp();
  const [items, setItems] = useState<Item[]>([{ kind: "banner" }]);
  const [epoch, setEpoch] = useState(0); // bump to remount <Static> after /clear
  const [streaming, setStreaming] = useState("");
  const [running, setRunning] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolCall | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  // First run with nothing configured: open the login flow right away.
  const [dialog, setDialog] = useState<Dialog | null>(() =>
    PROVIDER_INFO.some((p) => !p.local && isConfigured(p.name)) ? null : { type: "login", welcome: true },
  );
  const picker = dialog !== null;
  const [showHelp, setShowHelp] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [value, setValue] = useState("");
  const [queued, setQueuedState] = useState<string[]>([]);
  const queue = useRef<string[]>([]);
  const setQueued = (q: string[]) => setQueuedState((queue.current = q));
  const [exitArmed, setExitArmed] = useState(false);
  const [model, setModel] = useState(agent.model);
  const [history, setHistory] = useState(loadHistory);

  const controller = useRef<AbortController | null>(null);
  const denied = useRef(false);
  const buffer = useRef(""); // streamed text not yet moved into <Static>
  const firstChunk = useRef(true);
  const flushTimer = useRef<NodeJS.Timeout | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const alwaysAllow = useRef(new Set<string>());
  const verb = useRef(VERBS[0]!);

  const push = (...add: Item[]) => setItems((prev) => [...prev, ...add]);
  const notice = (text: string, level: "info" | "warn" | "error" = "info") => push({ kind: "notice", text, level });

  // Move finished paragraphs of streamed text into <Static> so the live area stays short.
  const flush = (all: boolean) => {
    flushTimer.current = null;
    const text = buffer.current;
    const cut = all ? text.length : lastSafeBreak(text);
    if (cut > 0 && text.slice(0, cut).trim()) {
      push({ kind: "assistant", text: text.slice(0, cut).trim(), first: firstChunk.current });
      firstChunk.current = false;
    }
    buffer.current = cut > 0 ? text.slice(cut) : text;
    setStreaming(buffer.current);
  };

  const approve: Approve = (req) => {
    if (modeRef.current === "yolo" || alwaysAllow.current.has(req.tool)) return Promise.resolve(true);
    if (modeRef.current === "accept-edits" && EDIT_TOOLS.has(req.tool)) return Promise.resolve(true);
    return new Promise((resolve) => setApproval({ ...req, resolve }));
  };

  const events: AgentEvents = {
    approve,
    onText(delta) {
      buffer.current += delta;
      flushTimer.current ??= setTimeout(() => flush(false), 40);
    },
    onStepEnd() {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flush(true);
      firstChunk.current = true;
    },
    onToolStart: (call) => setActiveTool(call),
    onToolEnd(call, r) {
      setActiveTool(null);
      push({ kind: "tool", call, ...r });
    },
    onNotice: notice,
  };

  const providerOf = (spec: string) => spec.split(":")[0]!;

  async function run(text: string) {
    const provider = providerOf(agent.model);
    if (PROVIDERS.includes(provider) && !isConfigured(provider)) {
      setValue(text);
      notice(`Not logged in to ${providerInfo(provider).label}.`, "warn");
      return setDialog({ type: "login", provider });
    }
    push({ kind: "user", text });
    setRunning(true);
    verb.current = VERBS[Math.floor(Math.random() * VERBS.length)]!;
    denied.current = false;
    const ctrl = (controller.current = new AbortController());
    let interrupted = false;
    try {
      await agent.send(text, ctrl.signal, events);
    } catch (e) {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flush(true);
      interrupted = ctrl.signal.aborted;
      if (denied.current) notice("Denied. Tell megacode what to do instead.", "warn");
      else if (interrupted) notice("Interrupted. What should megacode do instead?", "warn");
      else if ([401, 403].includes((e as { status?: number }).status!))
        notice(`${providerInfo(provider).label} rejected the credentials. Run /login to update them.`, "error");
      else notice((e as Error).message, "error");
    } finally {
      firstChunk.current = true;
      controller.current = null;
      setActiveTool(null);
      setRunning(false);
    }
    // Send queued messages next; after an interrupt, hand them back to the input instead.
    const next = queue.current.join("\n");
    setQueued([]);
    if (next && interrupted) setValue(next);
    else if (next) run(next);
  }

  function interrupt() {
    if (approval) {
      approval.resolve(false);
      setApproval(null);
    }
    controller.current?.abort();
  }

  function answerApproval(choice: "yes" | "always" | "no") {
    if (!approval) return;
    if (choice === "always") {
      if (EDIT_TOOLS.has(approval.tool)) setMode("accept-edits");
      else alwaysAllow.current.add(approval.tool);
    }
    approval.resolve(choice !== "no");
    setApproval(null);
    if (choice === "no") {
      denied.current = true;
      controller.current?.abort();
    }
  }

  function command(input: string) {
    const [cmd, ...args] = input.split(/\s+/);
    const arg = args.join(" ");
    switch (cmd) {
      case "/exit":
      case "/quit":
        return exit();
      case "/help":
        return setShowHelp(true);
      case "/usage":
        return notice(`Tokens this session: ${agent.usage.input.toLocaleString()} in · ${agent.usage.output.toLocaleString()} out`);
      case "/clear":
        if (running) return notice("Can't clear while a turn is running (esc to interrupt).", "warn");
        agent.clear();
        process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
        setItems([{ kind: "banner" }]);
        setEpoch((e) => e + 1);
        return;
      case "/model":
        if (!arg) return setDialog({ type: "model" });
        return selectModel(arg);
      case "/login":
        if (arg && !PROVIDERS.includes(arg)) return notice(`Unknown provider "${arg}". Available: ${PROVIDERS.join(", ")}`, "warn");
        return setDialog({ type: "login", provider: arg || undefined });
      case "/logout":
        if (arg) return logout(arg);
        if (!Object.keys(loadAuth()).length) return notice("No saved credentials. (Keys from environment variables aren't stored by megacode.)");
        return setDialog({ type: "logout" });
      default:
        notice(`Unknown command ${cmd}. Type / to see commands.`, "warn");
    }
  }

  function selectModel(spec: string) {
    setDialog(null);
    try {
      agent.setModel(spec);
      setModel(spec);
      saveSettings({ model: spec });
      const provider = providerOf(spec);
      if (isConfigured(provider)) return notice(`Model set to ${spec}`);
      notice(`Model set to ${spec}. Log in to ${providerInfo(provider).label} to use it.`, "warn");
      setDialog({ type: "login", provider });
    } catch (e) {
      notice((e as Error).message, "error");
    }
  }

  function loggedIn(provider: string, count: number) {
    notice(`✔ Logged in to ${providerInfo(provider).label} · ${count} model${count === 1 ? "" : "s"} available`);
    // Show that provider's models so picking one is the next step.
    setDialog({ type: "model", query: `${provider}:` });
  }

  function logout(provider: string) {
    setDialog(null);
    const auth = loadAuth();
    if (!auth[provider]) return notice(`No saved credentials for ${provider}.`, "warn");
    delete auth[provider];
    saveAuth(auth);
    resetProvider(provider);
    const env = providerInfo(provider).env.find((k) => process.env[k]);
    notice(`Removed saved credentials for ${providerInfo(provider).label}${env ? ` ($${env} is still set in your environment)` : ""}.`);
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setValue("");
    setShowHelp(false);
    const nextHistory = [...history.filter((h) => h !== trimmed), trimmed];
    setHistory(nextHistory);
    saveHistory(nextHistory);
    if (trimmed.startsWith("/")) return command(trimmed);
    if (running) return setQueued([...queue.current, trimmed]);
    run(trimmed);
  }

  // Global shortcuts.
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (running) return interrupt();
      if (picker) return setDialog(null);
      if (value) return setValue("");
      if (exitArmed) return exit();
      setExitArmed(true);
      setTimeout(() => setExitArmed(false), 1500);
      return;
    }
    if (key.ctrl && input === "d" && !value && !running) return exit();
    if (approval || picker) return; // those dialogs handle their own keys
    if (key.escape) {
      if (running) return interrupt();
      setShowHelp(false);
      return setValue("");
    }
    if (key.shift && key.tab) setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]!);
  });

  return (
    <Box flexDirection="column">
      <Static key={epoch} items={items}>
        {(item, i) => <ItemView key={i} item={item} model={model} />}
      </Static>

      {streaming.trim() && (
        <Box marginTop={firstChunk.current ? 1 : 0}>
          <Text>{firstChunk.current ? "⏺ " : "  "}</Text>
          <Text>{renderMarkdown(streaming.trimEnd())}</Text>
        </Box>
      )}

      {activeTool && !approval && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Blink /> <Text bold>{formatCall(activeTool)}</Text>
          </Text>
          <Text dimColor>{"  ⎿  Running…"}</Text>
        </Box>
      )}

      {approval && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
          <Text bold color="yellow">
            {approval.title}
          </Text>
          <Box paddingLeft={2} marginY={1}>
            <Text>{approval.body}</Text>
          </Box>
          <Text>Do you want to proceed?</Text>
          <Select
            options={[
              { label: "Yes", value: "yes" as const },
              {
                label: EDIT_TOOLS.has(approval.tool)
                  ? "Yes, allow all edits this session"
                  : `Yes, and don't ask again for ${approval.tool} this session`,
                value: "always" as const,
              },
              { label: "No, and tell megacode what to do differently", value: "no" as const, hint: "(esc)" },
            ]}
            onSelect={answerApproval}
            onCancel={() => answerApproval("no")}
          />
        </Box>
      )}

      {dialog?.type === "model" && (
        <ModelPicker
          current={model}
          initialQuery={dialog.query}
          onSelect={selectModel}
          onLogin={(provider) => setDialog({ type: "login", provider })}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.type === "login" && (
        <LoginDialog
          initialProvider={dialog.provider}
          welcome={dialog.welcome}
          onDone={loggedIn}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.type === "logout" && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
          <Text bold>Remove saved credentials</Text>
          <Box marginTop={1}>
            <Select
              options={Object.keys(loadAuth()).map((n) => ({ label: providerInfo(n).label, value: n, hint: authStatus(n) }))}
              onSelect={logout}
              onCancel={() => setDialog(null)}
            />
          </Box>
        </Box>
      )}

      {running && !approval && <Spinner verb={verb.current} />}

      {queued.map((q, i) => (
        <Text key={i} dimColor>
          {"  ⏳ queued: "}
          {q}
        </Text>
      ))}

      {!picker && !approval && (
        <Box marginTop={1} flexDirection="column">
          <PromptInput
            value={value}
            onChange={(v) => {
              setValue(v);
              setShowHelp(false);
            }}
            onSubmit={submit}
            onHelp={() => setShowHelp((s) => !s)}
            isActive
            history={history}
            commands={COMMANDS}
            placeholder={'Try "explain this codebase" or "fix the failing test"'}
          />
          <StatusLine mode={mode} model={model} loggedIn={!PROVIDERS.includes(providerOf(model)) || isConfigured(providerOf(model))} exitArmed={exitArmed} usage={agent.usage} />
          {showHelp && <Help />}
        </Box>
      )}
    </Box>
  );
}

function ItemView({ item, model }: { item: Item; model: string }) {
  switch (item.kind) {
    case "banner":
      return (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" alignSelf="flex-start">
          <Text>
            <Text color="cyan">✻</Text> Welcome to <Text bold>megacode</Text>
          </Text>
          <Text dimColor>/help for commands · ? for shortcuts</Text>
          <Text dimColor>
            model: {model}
            {"\n"}cwd: {process.cwd()}
          </Text>
        </Box>
      );
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="gray">{"> " + item.text.replace(/\n/g, "\n  ")}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={item.first ? 1 : 0}>
          <Text>{item.first ? "⏺ " : "  "}</Text>
          <Text>{renderMarkdown(item.text)}</Text>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text color={item.isError ? "red" : "green"}>⏺</Text> <Text bold>{formatCall(item.call)}</Text>
          </Text>
          <Box>
            <Text dimColor>{"  ⎿  "}</Text>
            <Text dimColor={!item.isError} color={item.isError ? "red" : undefined}>
              {previewOutput(item.output) || "(no output)"}
            </Text>
          </Box>
        </Box>
      );
    case "notice":
      return (
        <Box marginTop={1}>
          <Text color={item.level === "error" ? "red" : item.level === "warn" ? "yellow" : undefined} dimColor={item.level === "info"}>
            {"  ⎿  "}
            {item.text}
          </Text>
        </Box>
      );
  }
}

const FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

function Spinner({ verb }: { verb: string }) {
  const { frame, time } = useAnimation({ interval: 120 });
  return (
    <Box marginTop={1}>
      <Text color="cyan">
        {FRAMES[frame % FRAMES.length]} {verb}…{" "}
      </Text>
      <Text dimColor>({Math.floor(time / 1000)}s · esc to interrupt)</Text>
    </Box>
  );
}

function Blink() {
  const { frame } = useAnimation({ interval: 500 });
  return <Text color="cyan">{frame % 2 ? " " : "⏺"}</Text>;
}

function StatusLine({
  mode,
  model,
  loggedIn,
  exitArmed,
  usage,
}: {
  mode: Mode;
  model: string;
  loggedIn: boolean;
  exitArmed: boolean;
  usage: { input: number; output: number };
}) {
  const left = exitArmed ? (
    <Text color="yellow">Press Ctrl-C again to exit</Text>
  ) : mode === "accept-edits" ? (
    <Text color="magenta">⏵⏵ accept edits on (shift+tab to cycle)</Text>
  ) : mode === "yolo" ? (
    <Text color="red">⏵⏵ bypass permissions on (shift+tab to cycle)</Text>
  ) : (
    <Text dimColor>? for shortcuts</Text>
  );
  const tokens = usage.input + usage.output;
  return (
    <Box paddingX={2} justifyContent="space-between">
      {left}
      <Text dimColor={loggedIn} color={loggedIn ? undefined : "yellow"}>
        {model}
        {loggedIn ? "" : " · not logged in (/login)"}
        {tokens ? ` · ${tokens < 1000 ? tokens : `${(tokens / 1000).toFixed(1)}k`} tokens` : ""}
      </Text>
    </Box>
  );
}

function Help() {
  return (
    <Box flexDirection="column" paddingX={2} marginTop={1}>
      {SHORTCUTS.map(([k, d]) => (
        <Text key={k}>
          <Text color="cyan">{k.padEnd(26)}</Text>
          <Text dimColor>{d}</Text>
        </Text>
      ))}
      <Box marginTop={1} flexDirection="column">
        {COMMANDS.map((c) => (
          <Text key={c.name}>
            <Text color="cyan">{c.name.padEnd(26)}</Text>
            <Text dimColor>{c.description}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
