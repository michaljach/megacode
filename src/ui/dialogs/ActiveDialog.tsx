import type { Worktree } from "../../adapters/git/worktree.ts";
import { loadSettings } from "../../adapters/settings.ts";
import type { Effort } from "../../core/provider.ts";
import type { PermissionMode, Settings } from "../../core/settings.ts";
import type { Dialog } from "../commands.ts";
import { ConfigMenu } from "./ConfigMenu.tsx";
import { EffortPicker } from "./EffortPicker.tsx";
import { LoginDialog } from "./login/LoginDialog.tsx";
import { LogoutDialog } from "./login/LogoutDialog.tsx";
import { McpMenu } from "./mcp/McpMenu.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { ExitWorktreeDialog } from "./worktree/ExitWorktreeDialog.tsx";
import { WorktreeMenu } from "./worktree/WorktreeMenu.tsx";

/** What the dialogs can do to the session. App implements it. */
export type DialogActions = {
  open(dialog: Dialog): void;
  close(): void;
  selectModel(spec: string): void;
  selectEffort(effort: Effort): void;
  changeSettings(patch: Partial<Settings>): void;
  loggedIn(provider: string, modelCount: number): void;
  logout(provider: string): void;
  enterWorktree(name?: string): void;
  leaveWorktree(remove: boolean): void;
  exitWorktree(remove: boolean): void;
};

/** The dialog a command opened (see `Dialog` in commands.ts). */
export function ActiveDialog({
  dialog,
  model,
  mode,
  worktree,
  actions,
}: {
  dialog: Dialog;
  model: string;
  mode: PermissionMode;
  worktree: Worktree | null;
  actions: DialogActions;
}) {
  switch (dialog.type) {
    case "model":
      return (
        <ModelPicker
          current={model}
          initialQuery={dialog.query}
          onSelect={actions.selectModel}
          onLogin={(provider) => actions.open({ type: "login", provider })}
          onCancel={actions.close}
        />
      );
    case "login":
      return <LoginDialog initialProvider={dialog.provider} welcome={dialog.welcome} onDone={actions.loggedIn} onCancel={actions.close} />;
    case "logout":
      return <LogoutDialog onSelect={actions.logout} onCancel={actions.close} />;
    case "effort":
      return <EffortPicker current={loadSettings().effort} onSelect={actions.selectEffort} onCancel={actions.close} />;
    case "config":
      return (
        <ConfigMenu model={model} mode={mode} onChange={actions.changeSettings} onModel={() => actions.open({ type: "model" })} onClose={actions.close} />
      );
    case "worktree":
      return (
        <WorktreeMenu
          current={worktree}
          onCreate={actions.enterWorktree}
          onOpen={(wt) => actions.enterWorktree(wt.name)}
          onLeave={actions.leaveWorktree}
          onCancel={actions.close}
        />
      );
    case "mcp":
      return <McpMenu onClose={actions.close} />;
    case "exit-worktree":
      return worktree && <ExitWorktreeDialog worktree={worktree} onSelect={actions.exitWorktree} onCancel={actions.close} />;
  }
}
