import { Box, Static, Text, useApp, useInput } from "ink";
import { useEffect, useState } from "react";
import { logout as removeLogin } from "../adapters/accounts.ts";
import type { Worktree } from "../adapters/git/worktree.ts";
import { mcp } from "../adapters/mcp/manager.ts";
import { PROVIDER_INFO, providerInfo } from "../adapters/providers/catalog.ts";
import { isConfigured, needsLogin, providerOf } from "../adapters/providers/credentials.ts";
import { loadSettings, updateSettings } from "../adapters/settings.ts";
import type { Agent, NoticeLevel } from "../core/agent.ts";
import type { Effort } from "../core/provider.ts";
import { PERMISSION_MODES, type PermissionMode, type Settings } from "../core/settings.ts";
import { ApprovalDialog } from "./ApprovalDialog.tsx";
import { COMMANDS, isCommand, runCommand, type CommandContext, type Dialog } from "./commands.ts";
import { ConfigMenu } from "./ConfigMenu.tsx";
import { EffortPicker } from "./EffortPicker.tsx";
import { previewPrompt } from "./format.ts";
import { Help } from "./Help.tsx";
import { loadHistory, saveHistory } from "./history.ts";
import { useAgentSession } from "./hooks/useAgentSession.ts";
import { usePromptSuggestion } from "./hooks/usePromptSuggestion.ts";
import { useWorktree } from "./hooks/useWorktree.ts";
import { LoginDialog, LogoutDialog } from "./LoginDialog.tsx";
import { McpMenu } from "./McpMenu.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { PromptInput } from "./PromptInput.tsx";
import { Questionnaire } from "./Questionnaire.tsx";
import { Spinner } from "./Spinner.tsx";
import { StatusLine } from "./StatusLine.tsx";
import { AssistantText, ItemView, RunningTool, type Item } from "./Transcript.tsx";
import { ExitWorktreeDialog, WorktreeMenu } from "./WorktreeMenu.tsx";

const BUSY = "while a turn is running (esc to interrupt)";

export function App({
  agent,
  initialMode,
  initialWorktree = null,
  home = process.cwd(),
  onExitMessage,
}: {
  agent: Agent;
  initialMode: PermissionMode;
  /** Worktree the session started in (-w). */
  initialWorktree?: Worktree | null;
  /** Directory to return to when leaving a worktree. */
  home?: string;
  /** Receives a message to print after the UI closes. */
  onExitMessage?: (message: string) => void;
}) {
  const { exit } = useApp();
  const [items, setItems] = useState<Item[]>([{ kind: "banner" }]);
  const [epoch, setEpoch] = useState(0); // bump to remount <Static> after /clear
  // First run with nothing configured: open the login flow right away.
  const [dialog, setDialog] = useState<Dialog | null>(() =>
    PROVIDER_INFO.some((p) => !p.local && isConfigured(p.name)) ? null : { type: "login", welcome: true },
  );
  const [showHelp, setShowHelp] = useState(false);
  const [mode, setMode] = useState(initialMode);
  const [value, setValue] = useState("");
  const [exitArmed, setExitArmed] = useState(false);
  const [model, setModel] = useState(agent.model);
  const [history, setHistory] = useState(loadHistory);
  const [autocomplete, setAutocomplete] = useState(() => loadSettings().promptAutocomplete);

  const push = (...add: Item[]) => setItems((prev) => [...prev, ...add]);
  const notice = (text: string, level: NoticeLevel = "info") => push({ kind: "notice", text, level });
  const closeDialog = () => setDialog(null);

  const session = useAgentSession({
    agent,
    mode,
    push,
    notice,
    canSend(text) {
      if (!needsLogin(agent.model)) return true;
      const provider = providerOf(agent.model);
      setValue(text);
      notice(`Not logged in to ${providerInfo(provider).label}.`, "warn");
      setDialog({ type: "login", provider });
      return false;
    },
    onAllowEdits: () => setMode("accept-edits"),
    restoreInput: setValue,
  });
  const { worktree, enter, leave } = useWorktree(agent, initialWorktree, home);
  const suggestion = usePromptSuggestion(agent, {
    enabled: autocomplete,
    running: session.running,
    completedTurn: session.completedTurns,
    epoch,
    model,
  });

  // Connect MCP servers in the background; their tools join the next turn once ready.
  useEffect(() => {
    mcp.start().then(() => {
      for (const s of mcp.servers())
        if (s.status.state === "failed") notice(`MCP server ${s.name} failed to connect: ${s.status.error} (/mcp to manage)`, "warn");
    });
  }, []);

  /** Runs `action` unless a turn is running, reporting its message or error. */
  const whenIdle = (what: string, action: () => string) => {
    setDialog(null);
    if (session.running) return notice(`Can't ${what} ${BUSY}.`, "warn");
    try {
      notice(action());
    } catch (e) {
      notice((e as Error).message, "error");
    }
  };

  function selectModel(spec: string) {
    setDialog(null);
    try {
      agent.setModel(spec);
    } catch (e) {
      return notice((e as Error).message, "error");
    }
    setModel(spec);
    updateSettings({ model: spec });
    const provider = providerOf(spec);
    if (isConfigured(provider)) return notice(`Model set to ${spec}`);
    notice(`Model set to ${spec}. Log in to ${providerInfo(provider).label} to use it.`, "warn");
    setDialog({ type: "login", provider });
  }

  function selectEffort(effort: Effort) {
    setDialog(null);
    updateSettings({ effort });
    notice(`Model effort set to ${effort}. Applies to the next turn; support depends on the model.`);
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
    const { ok, message } = removeLogin(provider);
    notice(message, ok ? "info" : "warn");
  }

  function clear() {
    agent.clear();
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    setItems([{ kind: "banner" }]);
    setEpoch((e) => e + 1);
  }

  // Leaving a worktree asks whether to keep it, like Claude Code.
  function quit() {
    if (worktree) return setDialog({ type: "exit-worktree" });
    exit();
  }

  function exitWorktree(remove: boolean) {
    session.abort();
    try {
      onExitMessage?.(leave(remove));
    } catch (e) {
      onExitMessage?.((e as Error).message);
    }
    exit();
  }

  const commands: CommandContext = {
    model,
    running: session.running,
    notice,
    print: (text) => push({ kind: "notice", text, level: "info", bright: true }),
    open: setDialog,
    showHelp: () => setShowHelp(true),
    clear,
    quit,
    selectModel,
    selectEffort,
    enterWorktree: (name) => whenIdle("switch worktrees", () => enter(name)),
    logout,
  };

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setValue("");
    setShowHelp(false);
    const nextHistory = [...history.filter((h) => h !== trimmed), trimmed];
    setHistory(nextHistory);
    saveHistory(nextHistory);
    if (isCommand(trimmed)) runCommand(trimmed, commands);
    else session.submit(trimmed);
  }

  /** ctrl+s: queue whatever is in the input, then stop the running turn so the queue is sent right away. */
  function sendQueuedNow() {
    const text = value.trim();
    if (!session.running) return text ? submit(text) : undefined;
    const queueInput = text && !isCommand(text);
    if (queueInput) setValue("");
    session.flushQueue(queueInput ? text : undefined);
  }

  const blocking = !!(session.approval || session.questionnaire);
  const dialogOpen = dialog !== null;

  // Global shortcuts.
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (session.running) return session.interrupt();
      if (dialogOpen) return setDialog(null);
      if (value) return setValue("");
      if (exitArmed) return quit();
      setExitArmed(true);
      setTimeout(() => setExitArmed(false), 1500);
      return;
    }
    if (key.ctrl && input === "d" && !value && !session.running) return quit();
    if (blocking || dialogOpen) return; // those dialogs handle their own keys
    if (key.ctrl && input === "s") return sendQueuedNow();
    if (key.escape) {
      if (session.running) return session.interrupt();
      setShowHelp(false);
      return setValue("");
    }
    if (key.shift && key.tab) setMode((m) => PERMISSION_MODES[(PERMISSION_MODES.indexOf(m) + 1) % PERMISSION_MODES.length]!);
  });

  return (
    <Box flexDirection="column">
      <Static key={epoch} items={items} style={{ width: "100%" }}>
        {(item, i) => <ItemView key={i} item={item} model={model} />}
      </Static>

      {session.streaming.text.trim() && <AssistantText text={session.streaming.text.trimEnd()} first={session.streaming.first} />}

      {session.activeTool && !blocking && <RunningTool call={session.activeTool} />}

      {session.questionnaire && (
        <Questionnaire questions={session.questionnaire.questions} onSubmit={session.questionnaire.resolve} onCancel={session.interrupt} />
      )}

      {session.approval && <ApprovalDialog request={session.approval} onAnswer={session.answerApproval} />}

      {dialog?.type === "model" && (
        <ModelPicker
          current={model}
          initialQuery={dialog.query}
          onSelect={selectModel}
          onLogin={(provider) => setDialog({ type: "login", provider })}
          onCancel={closeDialog}
        />
      )}
      {dialog?.type === "login" && (
        <LoginDialog initialProvider={dialog.provider} welcome={dialog.welcome} onDone={loggedIn} onCancel={closeDialog} />
      )}
      {dialog?.type === "logout" && <LogoutDialog onSelect={logout} onCancel={closeDialog} />}
      {dialog?.type === "effort" && <EffortPicker current={loadSettings().effort} onSelect={selectEffort} onCancel={closeDialog} />}
      {dialog?.type === "config" && (
        <ConfigMenu model={model} mode={mode} onChange={changeSettings} onModel={() => setDialog({ type: "model" })} onClose={closeDialog} />
      )}
      {dialog?.type === "worktree" && (
        <WorktreeMenu
          current={worktree}
          onCreate={(name) => whenIdle("switch worktrees", () => enter(name))}
          onOpen={(wt) => whenIdle("switch worktrees", () => enter(wt.name))}
          onLeave={(remove) => whenIdle("leave the worktree", () => leave(remove))}
          onCancel={closeDialog}
        />
      )}
      {dialog?.type === "mcp" && <McpMenu onClose={closeDialog} />}
      {dialog?.type === "exit-worktree" && worktree && (
        <ExitWorktreeDialog worktree={worktree} onSelect={exitWorktree} onCancel={closeDialog} />
      )}

      {session.running && !blocking && <Spinner verb={session.verb} />}

      {session.queued.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          {session.queued.map((q, i) => (
            <Text key={i} dimColor wrap="wrap">
              {"⏳ "}
              {previewPrompt(q)}
              {" (ctrl+s to send now)"}
            </Text>
          ))}
        </Box>
      )}

      {!dialogOpen && !blocking && (
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
            autocomplete={autocomplete && !session.running}
            suggestion={suggestion}
            commands={COMMANDS}
            placeholder={session.running ? "queue another message..." : "tiny moon vibes"}
          />
          <StatusLine
            mode={mode}
            model={model}
            loggedIn={!needsLogin(model)}
            exitArmed={exitArmed}
            usage={agent.usage}
            worktree={worktree?.name}
          />
          {showHelp && <Help />}
        </Box>
      )}
    </Box>
  );
}
