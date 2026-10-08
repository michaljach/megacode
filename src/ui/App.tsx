import { Box, Static, useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { mcp } from "../adapters/mcp/manager.ts";
import { PROVIDER_INFO, providerInfo } from "../adapters/providers/catalog.ts";
import { isConfigured, needsLogin, providerOf } from "../adapters/providers/credentials.ts";
import { autoUpdate } from "../adapters/update.ts";
import type { Agent, NoticeLevel } from "../core/agent.ts";
import { PERMISSION_MODES, type PermissionMode } from "../core/settings.ts";
import { cycle } from "../lib/cycle.ts";
import { busyMessage, COMMANDS, isCommand, runCommand, type CommandContext, type Dialog } from "./commands.ts";
import { Spinner } from "./components/Spinner.tsx";
import { ActiveDialog, type DialogActions } from "./dialogs/ActiveDialog.tsx";
import { ApprovalDialog } from "./dialogs/ApprovalDialog.tsx";
import { Questionnaire } from "./dialogs/Questionnaire.tsx";
import { useAgentSession } from "./hooks/useAgentSession.ts";
import type { AgentSession } from "./session.ts";
import { useLoaded } from "./hooks/useLoaded.ts";
import { usePromptSuggestion } from "./hooks/usePromptSuggestion.ts";
import { useSettingsActions } from "./hooks/useSettingsActions.ts";
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
}: {
  agent: Agent;
  initialMode: PermissionMode;
}) {
  const { exit } = useApp();
  // The transcript and the in-flight reply now live on the session, so the session's
  // notice/print/reset drive them. `canSend` runs only after mount (during a send),
  // so it can safely read the session back through this ref.
  const sessionRef = useRef<AgentSession | null>(null);
  // First run with nothing configured: open the login flow right away.
  const [dialog, setDialog] = useState<Dialog | null>(() =>
    isConfigured(providerOf(agent.model)) || PROVIDER_INFO.some((p) => !p.local && isConfigured(p.name))
      ? null
      : { type: "login", welcome: true },
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

  const { session, state, items, epoch, streaming } = useAgentSession(agent, {
    canSend(text) {
      if (!needsLogin(agent.model)) return true;
      const provider = providerOf(agent.model);
      restoreInput(text);
      sessionRef.current?.notice(`Not logged in to ${providerInfo(provider).label}.`, "warn");
      setDialog({ type: "login", provider });
      return false;
    },
    mode: () => mode,
    setMode: (nextMode) => setMode(nextMode),
    onAllowEdits: () => setMode("accept-edits"),
    restoreInput,
  });
  const notice = (text: string, level?: NoticeLevel) => session.notice(text, level);
  const print = (text: string) => session.print(text);
  const reset = () => session.reset();
  const settings = useSettingsActions(agent, { notice, setDialog, setMode });
  const { model, autocomplete, statusDetails, selectModel, selectEffort, logout } = settings;
  const suggestion = usePromptSuggestion(agent, {
    enabled: autocomplete,
    running: state.running,
    completedTurn: state.completedTurns,
    epoch,
    model,
  });

  useEffect(() => { sessionRef.current = session; }, [session]);

  // Connect MCP servers in the background; their tools join the next turn once ready.
  useEffect(() => {
    mcp.start().then((failures) => {
      for (const failure of failures) notice(`${failure} (/mcp to manage)`, "warn");
    });
  }, []);

  /** Runs `action` unless a turn is running, reporting its message or error. */
  const whenIdle = (what: string, action: () => Promise<string>) => {
    setDialog(null);
    if (state.running) return notice(busyMessage(what), "warn");
    action().then(notice, (e: Error) => notice(e.message, "error"));
  };

  function clear() {
    agent.clear();
    reset();
  }

  function quit() {
    exit();
  }

  const commands: CommandContext = {
    model,
    running: state.running,
    notice,
    print,
    open: setDialog,
    showHelp: () => setShowHelp(true),
    clear,
    quit,
    selectModel,
    selectEffort,
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
    if (!state.running) return text ? submit(text) : undefined;
    const queueInput = text && !isCommand(text);
    if (queueInput) setValue("");
    session.flushQueue(queueInput ? text : undefined);
  }

  const blocking = !!(state.approval || state.questionnaire);
  const dialogOpen = dialog !== null;

  const dialogActions: DialogActions = {
    open: setDialog,
    close: closeDialog,
    selectModel,
    selectEffort,
    changeSettings: settings.changeSettings,
    loggedIn: settings.loggedIn,
    logout,
  };

  useInput((input, key) => {
    const shortcut = globalShortcut(input, key, { running: state.running, dialogOpen, blocking, hasInput: !!value, exitArmed });
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
      <Static key={epoch} items={items} style={{ width: "100%" }}>
        {(item, i) => <ItemView key={i} item={item} model={model} />}
      </Static>

      {streaming.text.trim() && <AssistantText text={streaming.text.trimEnd()} first={streaming.first} />}

      {state.activeTool && !state.questionnaire && <RunningTool call={state.activeTool} waiting={!!state.approval} />}

      {state.questionnaire && (
        <Questionnaire questions={state.questionnaire.questions} onSubmit={state.questionnaire.resolve} onCancel={session.interrupt} />
      )}

      {state.approval && <ApprovalDialog request={state.approval} onAnswer={session.answerApproval} />}

      {dialog && <ActiveDialog dialog={dialog} model={model} mode={mode} actions={dialogActions} />}

      {state.running && !blocking && <Spinner verb={state.verb} />}

      <QueuedMessages queued={state.queued} />

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
          running={state.running}
          status={{
            mode, model, loggedIn: !needsLogin(model), exitArmed, usage: agent.usage,
            context: statusDetails.showContext ? agent.context : undefined,
            speed: statusDetails.showSpeed ? agent.speed : undefined,
          }}
          updateVersion={updateVersion}
        />
      )}
    </Box>
  );
}
