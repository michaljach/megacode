import { Box, Static, Text, useAnimation, useApp, useInput } from "ink";
import os from "node:os";
import { useEffect, useRef, useState } from "react";
import type { Agent, AgentEvents } from "../agent.ts";
import { loadAuth, saveAuth, updateSettings, type PermissionMode, type Settings } from "../config.ts";
import { authStatus, isConfigured, PROVIDER_INFO, PROVIDERS, providerInfo, resetProvider } from "../providers/index.ts";
import type { Approve } from "../tools.ts";
import type { ToolCall } from "../types.ts";
import { mcp } from "../mcp.ts";
import { mainRoot, openWorktree, removeWorktree, type Worktree } from "../worktree.ts";
import { ConfigMenu } from "./ConfigMenu.tsx";
import { formatCall, lastSafeBreak, previewOutput, previewPrompt, renderMarkdown } from "./format.ts";
import { loadHistory, saveHistory } from "./history.ts";
import { LoginDialog } from "./LoginDialog.tsx";
import { McpMenu } from "./McpMenu.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { PromptInput, type Command } from "./PromptInput.tsx";
import { Select } from "./Select.tsx";
import { Questionnaire } from "./Questionnaire.tsx";
import type { Answer, Question } from "../questionnaire.ts";
import { ExitWorktreeDialog, WorktreeMenu } from "./WorktreeMenu.tsx";

type Item =
  | { kind: "banner" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; first: boolean }
  | { kind: "tool"; call: ToolCall; output: string; isError: boolean; changePreview?: string }
  | { kind: "notice"; text: string; level: "info" | "warn" | "error" };

type Mode = PermissionMode;
const MODES: Mode[] = ["ask", "accept-edits", "yolo"];
const EDIT_TOOLS = new Set(["write_file", "edit_file"]);

type Dialog =
  | { type: "model"; query?: string }
  | { type: "login"; provider?: string; welcome?: boolean }
  | { type: "logout" }
  | { type: "config" }
  | { type: "worktree" }
  | { type: "mcp" }
  | { type: "exit-worktree" };

type ApprovalRequest = Parameters<Approve>[0] & { resolve: (ok: boolean) => void };

const COMMANDS: Command[] = [
  { name: "/model", description: "Switch model (or /model provider:model)" },
  { name: "/login", description: "Connect a provider (API key or local server)" },
  { name: "/logout", description: "Remove saved credentials" },
  { name: "/config", description: "View and change settings" },
  { name: "/mcp", description: "Manage MCP servers (add, remove, reconnect, see tools)" },
  { name: "/worktree", description: "Create or switch git worktrees (or /worktree name)" },
  { name: "/clear", description: "Clear conversation history and screen" },
  { name: "/usage", description: "Show token usage for this session" },
  { name: "/help", description: "Show commands and keyboard shortcuts" },
  { name: "/exit", description: "Exit megacode" },
];

function isCommand(text: string): boolean {
  const name = text.split(/\s+/, 1)[0];
  return name === "/quit" || name === "/settings" || COMMANDS.some((command) => command.name === name);
}

const SHORTCUTS: [string, string][] = [
  ["enter", "send message (queued while running)"],
  ["ctrl+s", "send queued messages now (interrupts the running turn)"],
  ["\\ + enter, option+enter", "newline"],
  ["↑ / ↓", "prompt history"],
  ["alt+← / alt+→", "move cursor by word"],
  ["/", "commands"],
  ["esc", "interrupt · clear input"],
  ["shift+tab", "cycle permission mode"],
  ["ctrl+a / ctrl+e", "start / end of line"],
  ["ctrl+u / ctrl+k / ctrl+w", "delete to start / end / word"],
  ["ctrl+c", "interrupt · clear · exit (twice)"],
];

const VERBS = ["Thinking", "Pondering", "Working", "Crafting", "Computing", "Tinkering"];

export function App({
  agent,
  initialMode,
  initialWorktree = null,
  home = process.cwd(),
  onExitMessage,
}: {
  agent: Agent;
  initialMode: Mode;
  /** Worktree the session started in (-w). */
  initialWorktree?: Worktree | null;
  /** Directory to return to when leaving a worktree. */
  home?: string;
  /** Receives a message to print after the UI closes. */
  onExitMessage?: (message: string) => void;
}) {
  const { exit } = useApp();
  const [worktree, setWorktree] = useState<Worktree | null>(initialWorktree);
  const [items, setItems] = useState<Item[]>([{ kind: "banner" }]);
  const [epoch, setEpoch] = useState(0); // bump to remount <Static> after /clear
  const [streaming, setStreaming] = useState("");
  const [running, setRunning] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolCall | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [questionnaire, setQuestionnaire] = useState<{ questions: Question[]; resolve: (answers: Answer[] | null) => void } | null>(null);
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
  const sendNow = useRef(false); // interrupted with ctrl+s: run the queue instead of handing it back
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
    askQuestions: (questions, signal) => new Promise((resolve) => {
      if (signal?.aborted) return resolve(null);
      const finish = (answers: Answer[] | null) => {
        signal?.removeEventListener("abort", abort);
        setQuestionnaire(null);
        resolve(answers);
      };
      const abort = () => finish(null);
      signal?.addEventListener("abort", abort, { once: true });
      setQuestionnaire({ questions, resolve: finish });
    }),
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
    sendNow.current = false;
    const ctrl = (controller.current = new AbortController());
    let interrupted = false;
    try {
      await agent.send(text, ctrl.signal, events);
    } catch (e) {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flush(true);
      interrupted = ctrl.signal.aborted;
      if (denied.current) notice("Denied. Tell megacode what to do instead.", "warn");
      else if (interrupted && sendNow.current) notice("Interrupted to send queued messages.");
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
    // Send queued messages next; after an interrupt (other than ctrl+s), hand them back to the input instead.
    const next = queue.current.join("\n");
    setQueued([]);
    if (next && interrupted && !sendNow.current) setValue(next);
    else if (next) run(next);
  }

  function interrupt() {
    if (approval) {
      approval.resolve(false);
      setApproval(null);
    }
    controller.current?.abort();
  }

  /** ctrl+s: queue whatever is in the input, then stop the running turn so the queue is sent right away. */
  function sendQueuedNow() {
    const text = value.trim();
    if (!running) return text ? submit(text) : undefined;
    if (text && !isCommand(text)) {
      setValue("");
      setQueued([...queue.current, text]);
    }
    if (!queue.current.length) return;
    sendNow.current = true;
    interrupt();
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
        return quit();
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
      case "/config":
      case "/settings":
        return setDialog({ type: "config" });
      case "/mcp":
        return setDialog({ type: "mcp" });
      case "/worktree":
        if (arg) return enterWorktree(arg);
        try {
          mainRoot();
        } catch (e) {
          return notice((e as Error).message, "warn");
        }
        return setDialog({ type: "worktree" });
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
      updateSettings({ model: spec });
      const provider = providerOf(spec);
      if (isConfigured(provider)) return notice(`Model set to ${spec}`);
      notice(`Model set to ${spec}. Log in to ${providerInfo(provider).label} to use it.`, "warn");
      setDialog({ type: "login", provider });
    } catch (e) {
      notice((e as Error).message, "error");
    }
  }

  // Connect MCP servers in the background; their tools join the next turn once ready.
  useEffect(() => {
    mcp.start().then(() => {
      for (const s of mcp.servers())
        if (s.status.state === "failed") notice(`MCP server ${s.name} failed to connect: ${s.status.error} (/mcp to manage)`, "warn");
    });
  }, []);

  // Leaving a worktree asks whether to keep it, like Claude Code.
  function quit() {
    if (worktree) return setDialog({ type: "exit-worktree" });
    exit();
  }

  function moveTo(dir: string) {
    process.chdir(dir);
    agent.reloadSystemPrompt(); // the system prompt includes the working directory
  }

  /** Switches to the named worktree, creating it if needed; no name creates one with a random name. */
  function enterWorktree(name?: string) {
    setDialog(null);
    if (running) return notice("Can't switch worktrees while a turn is running (esc to interrupt).", "warn");
    try {
      const wt = openWorktree(name);
      moveTo(wt.path);
      setWorktree(wt);
      notice(`${wt.created ? "Created" : "Switched to"} worktree ${wt.name} on branch ${wt.branch} · ${wt.path}`);
    } catch (e) {
      notice((e as Error).message, "error");
    }
  }

  /** Returns to `home`, optionally removing the worktree and its branch. Returns what happened. */
  function leaveWorktree(remove: boolean): string {
    const wt = worktree!;
    moveTo(home);
    setWorktree(null);
    if (!remove) return `Kept worktree ${wt.name} at ${wt.path} (branch ${wt.branch}). Return with megacode -w ${wt.name}.`;
    removeWorktree(wt);
    return `Removed worktree ${wt.name} and branch ${wt.branch}.`;
  }

  function leaveFromMenu(remove: boolean) {
    setDialog(null);
    if (running) return notice("Can't leave the worktree while a turn is running (esc to interrupt).", "warn");
    try {
      notice(leaveWorktree(remove));
    } catch (e) {
      notice((e as Error).message, "error");
    }
  }

  function exitWorktree(remove: boolean) {
    controller.current?.abort();
    try {
      onExitMessage?.(leaveWorktree(remove));
    } catch (e) {
      onExitMessage?.((e as Error).message);
    }
    exit();
  }

  function changeSettings(patch: Partial<Settings>) {
    updateSettings(patch);
    if (patch.permissionMode) setMode(patch.permissionMode);
    if (patch.projectInstructions !== undefined) agent.reloadSystemPrompt();
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
    if (isCommand(trimmed)) return command(trimmed);
    if (running) return setQueued([...queue.current, trimmed]);
    run(trimmed);
  }

  // Global shortcuts.
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (running) return interrupt();
      if (picker) return setDialog(null);
      if (value) return setValue("");
      if (exitArmed) return quit();
      setExitArmed(true);
      setTimeout(() => setExitArmed(false), 1500);
      return;
    }
    if (key.ctrl && input === "d" && !value && !running) return quit();
    if (approval || questionnaire || picker) return; // those dialogs handle their own keys
    if (key.ctrl && input === "s") return sendQueuedNow();
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
          <Box width={2} flexShrink={0}><Text>{firstChunk.current ? "⏺ " : "  "}</Text></Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text>{renderMarkdown(streaming.trimEnd())}</Text>
          </Box>
        </Box>
      )}

      {activeTool && !approval && !questionnaire && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Blink /> <Text bold>{formatCall(activeTool)}</Text>
          </Text>
          <Text dimColor>{"  ⎿  Running…"}</Text>
        </Box>
      )}

      {questionnaire && (
        <Questionnaire questions={questionnaire.questions} onSubmit={questionnaire.resolve} onCancel={interrupt} />
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

      {dialog?.type === "config" && (
        <ConfigMenu
          model={model}
          mode={mode}
          onChange={changeSettings}
          onModel={() => setDialog({ type: "model" })}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.type === "worktree" && (
        <WorktreeMenu
          current={worktree}
          onCreate={enterWorktree}
          onOpen={(wt) => enterWorktree(wt.name)}
          onLeave={leaveFromMenu}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.type === "mcp" && <McpMenu onClose={() => setDialog(null)} />}

      {dialog?.type === "exit-worktree" && worktree && (
        <ExitWorktreeDialog worktree={worktree} onSelect={exitWorktree} onCancel={() => setDialog(null)} />
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

      {running && !approval && !questionnaire && <Spinner verb={verb.current} />}

      {queued.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          {queued.map((q, i) => (
            <Text key={i} dimColor wrap="wrap">
              {"⏳ "}
              {previewPrompt(q)}
              {" (ctrl+s to send now)"}
            </Text>
          ))}
        </Box>
      )}

      {!picker && !approval && !questionnaire && (
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
            placeholder={running ? "queue another message..." : 'tiny moon vibes'}
          />
          <StatusLine mode={mode} model={model} loggedIn={!PROVIDERS.includes(providerOf(model)) || isConfigured(providerOf(model))} exitArmed={exitArmed} usage={agent.usage} worktree={worktree?.name} />
          {showHelp && <Help />}
        </Box>
      )}
    </Box>
  );
}

export function ItemView({ item, model }: { item: Item; model: string }) {
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
          <Box width={2} flexShrink={0}><Text dimColor>{"> "}</Text></Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="wrap">{previewPrompt(item.text)}</Text>
          </Box>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={item.first ? 1 : 0}>
          <Box width={2} flexShrink={0}><Text>{item.first ? "⏺ " : "  "}</Text></Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text>{renderMarkdown(item.text)}</Text>
          </Box>
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
          {!item.isError && item.changePreview && (
            <Box marginLeft={5}><Text>{item.changePreview}</Text></Box>
          )}
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
  worktree,
}: {
  mode: Mode;
  model: string;
  loggedIn: boolean;
  exitArmed: boolean;
  usage: { input: number; output: number };
  worktree?: string;
}) {
  // Bypass is the default, so only the other modes get a label.
  const modeLabel = mode === "accept-edits" ? <Text color="magenta">⏵⏵ accept edits </Text> : mode === "ask" ? <Text color="cyan">ask mode </Text> : null;
  const cwd = process.cwd().replace(os.homedir(), "~");
  const tokens = usage.input + usage.output;
  // Give exit confirmation the whole row instead of competing with model/worktree metadata.
  if (exitArmed) {
    return (
      <Box paddingX={2}>
        <Text color="yellow">Press Ctrl-C again to exit</Text>
      </Box>
    );
  }
  return (
    <Box paddingX={2} justifyContent="space-between" gap={2}>
      <Box flexShrink={1}>
        {modeLabel}
        <Text dimColor wrap="truncate-start">
          {cwd}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text dimColor={loggedIn} color={loggedIn ? undefined : "yellow"}>
          {model}
          {loggedIn ? "" : " · not logged in (/login)"}
          {worktree ? ` · ⎇ ${worktree}` : ""}
          {tokens ? ` · ${tokens < 1000 ? tokens : `${(tokens / 1000).toFixed(1)}k`} tokens` : ""}
        </Text>
      </Box>
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
