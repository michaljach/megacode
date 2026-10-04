import type { ProviderInfo } from "../../../adapters/providers/catalog.ts";

// The rows of the /model picker, kept apart from rendering so they can be tested.

/** A provider's model list as fetched so far. */
export type ListState = { status: "loading" } | { status: "ok"; models: string[] } | { status: "error"; error: string };

export type Row = {
  provider: string;
  label: string;
  action: { type: "model"; spec: string } | { type: "login"; provider: string } | { type: "none" };
  dim?: boolean;
};

/**
 * Rows matching every word of `query`: each configured provider's models (or a loading / error row), a login row for
 * each unconfigured one, and first a row for a typed "provider:model" that no provider lists.
 */
export function modelRows({
  query,
  providers,
  lists,
  configured,
}: {
  query: string;
  providers: ProviderInfo[];
  lists: Record<string, ListState>;
  configured: (provider: string) => boolean;
}): Row[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (s: string) => terms.every((t) => s.toLowerCase().includes(t));
  const rows: Row[] = [];
  const note = (provider: string, label: string, action: Row["action"]) => rows.push({ provider, label, action, dim: true });
  const listed = new Set<string>();
  for (const p of providers) {
    const state = lists[p.name];
    const login = { type: "login", provider: p.name } as const;
    if (!configured(p.name)) {
      if (!p.local && !p.keyOptional && matches(`${p.name} ${p.label} login`)) note(p.name, "Log in to see models…", login);
      continue;
    }
    if (!state || state.status === "loading") {
      if (matches(p.name)) note(p.name, "loading…", { type: "none" });
    } else if (state.status === "error") {
      // Local servers that aren't running just don't show up.
      if (!p.local && matches(p.name)) note(p.name, `couldn't list models: ${state.error}`, login);
    } else {
      for (const m of state.models) {
        const spec = `${p.name}:${m}`;
        listed.add(spec);
        if (matches(spec)) rows.push({ provider: p.name, label: m, action: { type: "model", spec } });
      }
    }
  }
  // Anything typed as provider:model can be used even if the provider doesn't list it.
  const typed = query.trim();
  const colon = typed.indexOf(":");
  if (/^[a-z]+:\S+$/.test(typed) && !listed.has(typed))
    rows.unshift({ provider: typed.slice(0, colon), label: `use "${typed.slice(colon + 1)}"`, action: { type: "model", spec: typed } });
  return rows;
}
