import { useState } from "react";
import { logout as removeLogin } from "../../adapters/accounts.ts";
import { providerInfo } from "../../adapters/providers/catalog.ts";
import { isConfigured, providerOf } from "../../adapters/providers/credentials.ts";
import { loadSettings, updateSettings } from "../../adapters/settings.ts";
import type { Agent, NoticeLevel } from "../../core/agent.ts";
import type { Effort } from "../../core/provider.ts";
import type { PermissionMode, Settings } from "../../core/settings.ts";
import { plural } from "../../lib/plural.ts";
import type { Dialog } from "../commands.ts";

/**
 * Model, effort, settings and credential changes made from commands and dialogs. Owns the current model and the
 * prompt-autocomplete toggle; reports through `notice` and opens the dialog that comes next (e.g. login after picking
 * a model whose provider isn't set up).
 */
export function useSettingsActions(
  agent: Pick<Agent, "model" | "setModel">,
  { notice, setDialog, setMode }: {
    notice: (text: string, level?: NoticeLevel) => void;
    setDialog: (dialog: Dialog | null) => void;
    setMode: (mode: PermissionMode) => void;
  },
) {
  const [model, setModel] = useState(agent.model);
  const [autocomplete, setAutocomplete] = useState(() => loadSettings().promptAutocomplete);

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
  }

  function loggedIn(provider: string, count: number) {
    notice(`✔ Logged in to ${providerInfo(provider).label} · ${plural(count, "model")} available`);
    // Show that provider's models so picking one is the next step.
    setDialog({ type: "model", query: `${provider}:` });
  }

  function logout(provider: string) {
    setDialog(null);
    const { ok, message } = removeLogin(provider);
    notice(message, ok ? "info" : "warn");
  }

  return { model, autocomplete, selectModel, selectEffort, changeSettings, loggedIn, logout };
}
