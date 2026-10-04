import { Box, Static, useApp, useInput } from "ink";
import { useEffect, useState } from "react";
import type { Worktree } from "../adapters/git/worktree.ts";
import { mcp } from "../adapters/mcp/manager.ts";
import { PROVIDER_INFO, providerInfo } from "../adapters/providers/catalog.ts";
import { isConfigured, needsLogin, providerOf } from "../adapters/providers/credentials.ts";
import { autoUpdate } from "../adapters/update.ts";
import type { Agent } from "../core/agent.ts";
import { PERMISSION_MODES, type PermissionMode } from "../core/settings.ts";
import { cycle } from "../lib/cycle.ts";
import { busyMessage, COMMANDS, isCommand, runCommand, type CommandContext, type Dialog } from "./commands.ts";
import { Spinner } from "./components/Spinner.tsx";
import { ActiveDialog, type DialogActions } from "./dialogs/ActiveDialog.tsx";
import { ApprovalDialog } from "./dialogs/ApprovalDialog.tsx";
import { Questionnaire } from "./dialogs/Questionnaire.tsx";
import { useAgentSession } from "./hooks/useAgentSession.ts";
import { useLoaded } from "./hooks/useLoaded.ts";
import { usePromptSuggestion } from "./hooks/usePromptSuggestion.ts";
import { useSettingsActions } from "./hooks/useSettingsActions.ts";
import { useTranscript } from "./hooks/useTranscript.ts";
import { useWorktree } from "./hooks/useWorktree.ts";
import { usePromptHistory } from "./prompt/history.ts";
import { PromptArea } from "./prompt/PromptArea.tsx";
import { QueuedMessages } from "./prompt/QueuedMessages.tsx";
import { globalShortcut } from "./shortcuts.ts";
import { AssistantText } from "./transcript/AssistantText.tsx";
import { ItemView } from "./transcript/ItemView.tsx";
import { RunningTool } from "./transcript/RunningTool.tsx";

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
  const transcript = useTranscript();
  const { push, notice } = transcript;
  // First run with nothing configured: open the login flow right away.
  const [dialog, setDialog] = useState<Dialog | null>(() =>
    PROVIDER_INFO.some((p) => !p.local && isConfigured(p.name)) ? null : { type: "login", welcome: true },
  );
  const [showHelp, setShowHelp] = useState(false);
  const [mode, setMode] = useState(initialMode);
  const [value, setValue] = useState("");
  const [exitArmed, setExitArmed] = useState(false);
  const { history, remember } = usePromptHistory();
  const updateVersion = useLoaded(autoUpdate);

  const closeDialog = () => setDialog(null);
  /** Puts text back in the input, ahead of anything typed since. */
  const restoreInput = (text: string) => setValue((current) => (current.trim() ? `${text}\n${current}` : text));

  const session = useAgentSession(agent, {
    mode: () => mode,
    push,
    notice,
    canSend(text) {
      if (!needsLogin(agent.model)) return true;
      const provider = providerOf(agent.model);
      restoreInput(text);
      notice(`Not logged in to ${providerInfo(provider).label}.`, "warn");
      setDialog({ type: "login", provider });
      return false;
    },
    onAllowEdits: () => setMode("accept-edits"),
    restoreInput,
  });
  const settings = useSettingsActions(agent, { notice, setDialog, setMode });
  const { model, autocomplete, selectModel, selectEffort, logout } = settings;
  const { worktree, enter, leave } = useWorktree(initialWorktree, home);
  const suggestion = usePromptSuggestion(agent, {
    enabled: autocomplete,
    running: session.running,
    completedTurn: session.completedTurns,
    epoch: transcript.epoch,
    model,
  });

  // Connect MCP servers in the background; their tools join the next turn once ready.
  useEffect(() => {
    mcp.start().then((failures) => {
      for (const failure of failures) notice(`${failure} (/mcp to manage)`, "warn");
    });
  }, []);

  /** Runs `action` unless a turn is running, reporting its message or error. */
  const whenIdle = (what: string, action: () => Promise<string>) => {
    setDialog(null);
    if (session.running) return notice(busyMessage(what), "warn");
    action().then(notice, (e: Error) => notice(e.message, "error"));
  };
  const switchWorktree = (name?: string) => whenIdle("switch worktrees", () => enter(name));

  function clear() {
    agent.clear();
    transcript.reset();
  }

  // Leaving a worktree asks whether to keep it, like Claude Code.
  function quit() {
    if (worktree) return setDialog({ type: "exit-worktree" });
    exit();
  }

  async function exitWorktree(remove: boolean) {
    session.abort();
    onExitMessage?.(await leave(remove).catch((e: Error) => e.message));
    exit();
  }

  const commands: CommandContext = {
    model,
    running: session.running,
    notice,
    print: transcript.print,
    open: setDialog,
    showHelp: () => setShowHelp(true),
    clear,
    quit,
    selectModel,
    selectEffort,
    enterWorktree: switchWorktree,
    logout,
  };

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setValue("");
    setShowHelp(false);
    remember(trimmed);
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

  const dialogActions: DialogActions = {
    open: setDialog,
    close: closeDialog,
    selectModel,
    selectEffort,
    changeSettings: settings.changeSettings,
    loggedIn: settings.loggedIn,
    logout,
    enterWorktree: switchWorktree,
    leaveWorktree: (remove) => whenIdle("leave the worktree", () => leave(remove)),
    exitWorktree,
  };

  useInput((input, key) => {
    const shortcut = globalShortcut(input, key, { running: session.running, dialogOpen, blocking, hasInput: !!value, exitArmed });
    switch (shortcut?.type) {
      case "interrupt":
        return session.interrupt();
      case "close-dialog":
        return closeDialog();
      case "clear-input":
        setShowHelp(false);
        return setValue("");
      case "arm-exit":
        setExitArmed(true);
        return setTimeout(() => setExitArmed(false), 1500);
      case "quit":
        return quit();
      case "send-queue":
        return sendQueuedNow();
      case "send-queued":
        return session.sendQueued(shortcut.index);
      case "cycle-mode":
        return setMode((m) => PERMISSION_MODES[cycle(PERMISSION_MODES.indexOf(m), 1, PERMISSION_MODES.length)]!);
    }
  });

  return (
    <Box flexDirection="column">
      <Static key={transcript.epoch} items={transcript.items} style={{ width: "100%" }}>
        {(item, i) => <ItemView key={i} item={item} model={model} />}
      </Static>

      {session.streaming.text.trim() && <AssistantText text={session.streaming.text.trimEnd()} first={session.streaming.first} />}

      {session.activeTool && !session.questionnaire && <RunningTool call={session.activeTool} waiting={!!session.approval} />}

      {session.questionnaire && (
        <Questionnaire questions={session.questionnaire.questions} onSubmit={session.questionnaire.resolve} onCancel={session.interrupt} />
      )}

      {session.approval && <ApprovalDialog request={session.approval} onAnswer={session.answerApproval} />}

      {dialog && <ActiveDialog dialog={dialog} model={model} mode={mode} worktree={worktree} actions={dialogActions} />}

      {session.running && !blocking && <Spinner verb={session.verb} />}

      <QueuedMessages queued={session.queued} />

      {!dialogOpen && !blocking && (
        <PromptArea
          value={value}
          onChange={(v) => {
            setValue(v);
            setShowHelp(false);
          }}
          onSubmit={submit}
          onToggleHelp={() => setShowHelp((s) => !s)}
          showHelp={showHelp}
          history={history}
          commands={COMMANDS}
          suggestion={suggestion}
          autocomplete={autocomplete}
          running={session.running}
          status={{ mode, model, loggedIn: !needsLogin(model), exitArmed, usage: agent.usage, worktree: worktree?.name }}
          updateVersion={updateVersion}
        />
      )}
    </Box>
  );
}
