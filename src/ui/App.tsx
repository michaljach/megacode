import { Box, Static, Text, useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import type { Agent, AgentEvents } from "../agent.ts";
import { loadAuth, loadSettings, saveAuth, updateSettings, type PermissionMode, type Settings } from "../config.ts";
import { mcp } from "../mcp.ts";
import { isConfigured, needsLogin, PROVIDER_INFO, PROVIDERS, providerInfo, providerOf, resetProvider } from "../providers/index.ts";
import { providerUsage } from "../providers/usage.ts";
import { autoApproved, EDIT_TOOLS, type Approve } from "../tools/index.ts";
import type { Answer, Question } from "../tools/questions.ts";
import { EFFORTS, type Effort, type ToolCall } from "../types.ts";
import { mainRoot, openWorktree, removeWorktree, type Worktree } from "../worktree.ts";
import { ApprovalDialog, type ApprovalChoice, type ApprovalRequest } from "./ApprovalDialog.tsx";
import { COMMANDS, isCommand } from "./commands.ts";
import { ConfigMenu } from "./ConfigMenu.tsx";
import { previewPrompt } from "./format.ts";
import { Help } from "./Help.tsx";
import { loadHistory, saveHistory } from "./history.ts";
import { usePromptSuggestion, useStreamedText } from "./hooks.ts";
import { LoginDialog, LogoutDialog } from "./LoginDialog.tsx";
import { McpMenu } from "./McpMenu.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { PromptInput } from "./PromptInput.tsx";
import { Questionnaire } from "./Questionnaire.tsx";
import { Select } from "./Select.tsx";
import { Spinner } from "./Spinner.tsx";
import { StatusLine } from "./StatusLine.tsx";
import { AssistantText, ItemView, RunningTool, type Item, type NoticeLevel } from "./Transcript.tsx";
import { ExitWorktreeDialog, WorktreeMenu } from "./WorktreeMenu.tsx";

type Mode = PermissionMode;
const MODES: Mode[] = ["ask", "accept-edits", "yolo"];

type Dialog =
  | { type: "model"; query?: string }
  | { type: "login"; provider?: string; welcome?: boolean }
  | { type: "logout" }
  | { type: "config" }
  | { type: "effort" }
  | { type: "worktree" }
  | { type: "mcp" }
  | { type: "exit-worktree" };

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
  const [autocomplete, setAutocomplete] = useState(() => loadSettings().promptAutocomplete);
  const [completedTurn, setCompletedTurn] = useState(0);
  const suggestion = usePromptSuggestion(agent, { enabled: autocomplete, running, completedTurn, epoch, model });

  const controller = useRef<AbortController | null>(null);
  const denied = useRef(false);
  const sendNow = useRef(false); // interrupted with ctrl+s: run the queue instead of handing it back
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const alwaysAllow = useRef(new Set<string>());
  const verb = useRef(VERBS[0]!);

  const push = (...add: Item[]) => setItems((prev) => [...prev, ...add]);
  const notice = (text: string, level: NoticeLevel = "info") => push({ kind: "notice", text, level });
  const stream = useStreamedText((text, first) => push({ kind: "assistant", text, first }));

  const approve: Approve = (req) => {
    if (autoApproved(modeRef.current, req.tool) || alwaysAllow.current.has(req.tool)) return Promise.resolve(true);
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
    onText: stream.append,
    onStepEnd: stream.end,
    onToolStart: (call) => setActiveTool(call),
    onToolEnd(call, r) {
      setActiveTool(null);
      push({ kind: "tool", call, ...r });
    },
    onNotice: notice,
  };

  async function run(text: string) {
    const provider = providerOf(agent.model);
    if (needsLogin(agent.model)) {
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
      if (!ctrl.signal.aborted) setCompletedTurn((n) => n + 1);
    } catch (e) {
      stream.end();
      interrupted = ctrl.signal.aborted;
      if (denied.current) notice("Denied. Tell megacode what to do instead.", "warn");
      else if (interrupted && sendNow.current) notice("Interrupted to send queued messages.");
      else if (interrupted) notice("Interrupted. What should megacode do instead?", "warn");
      else if ([401, 403].includes((e as { status?: number }).status!))
        notice(`${providerInfo(provider).label} rejected the credentials. Run /login to update them.`, "error");
      else notice((e as Error).message, "error");
    } finally {
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

  function answerApproval(choice: ApprovalChoice) {
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
      case "/usage": {
        const provider = providerOf(model);
        notice(`Fetching ${providerInfo(provider).label} usage…`);
        void providerUsage(provider).then(
          (text) => push({ kind: "notice", text, level: "info", bright: true }),
          (error: unknown) => notice(`${providerInfo(provider).label}: ${error instanceof Error ? error.message : "Unable to fetch usage."}`, "error"),
        );
        return;
      }
      case "/clear":
        if (running) return notice("Can't clear while a turn is running (esc to interrupt).", "warn");
        agent.clear();
        process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
        setItems([{ kind: "banner" }]);
        setEpoch((e) => e + 1);
        return;
      case "/effort":
        if (!arg) return setDialog({ type: "effort" });
        if (!EFFORTS.includes(arg as Effort)) return notice(`Unknown effort "${arg}". Available: ${EFFORTS.join(", ")}`, "warn");
        return selectEffort(arg as Effort);
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

  function selectEffort(effort: Effort) {
    setDialog(null);
    updateSettings({ effort });
    notice(`Model effort set to ${effort}. Applies to the next turn; support depends on the model.`);
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
    if (patch.promptAutocomplete !== undefined) setAutocomplete(patch.promptAutocomplete);
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
      <Static key={epoch} items={items} style={{ width: "100%" }}>
        {(item, i) => <ItemView key={i} item={item} model={model} />}
      </Static>

      {stream.streaming.trim() && <AssistantText text={stream.streaming.trimEnd()} first={stream.first} />}

      {activeTool && !approval && !questionnaire && <RunningTool call={activeTool} />}

      {questionnaire && (
        <Questionnaire questions={questionnaire.questions} onSubmit={questionnaire.resolve} onCancel={interrupt} />
      )}

      {approval && <ApprovalDialog request={approval} onAnswer={answerApproval} />}

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

      {dialog?.type === "effort" && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
          <Text bold>Model effort · {loadSettings().effort ?? "default"}</Text>
          <Select
            options={EFFORTS.map((effort) => ({ label: effort, value: effort }))}
            initialIndex={Math.max(0, EFFORTS.indexOf(loadSettings().effort ?? "default"))}
            onSelect={selectEffort}
            onCancel={() => setDialog(null)}
          />
          <Text dimColor>Saved for future turns · model support varies · esc cancel</Text>
        </Box>
      )}
      {dialog?.type === "logout" && <LogoutDialog onSelect={logout} onCancel={() => setDialog(null)} />}

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
            autocomplete={autocomplete && !running}
            suggestion={suggestion}
            commands={COMMANDS}
            placeholder={running ? "queue another message..." : "tiny moon vibes"}
          />
          <StatusLine mode={mode} model={model} loggedIn={!needsLogin(model)} exitArmed={exitArmed} usage={agent.usage} worktree={worktree?.name} />
          {showHelp && <Help />}
        </Box>
      )}
    </Box>
  );
}
