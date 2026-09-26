import { Box, Text, useInput, usePaste } from "ink";
import { useEffect, useMemo, useState } from "react";
import { isConfigured, listModels, PROVIDER_INFO } from "../providers/index.ts";

type ListState = { status: "loading" } | { status: "ok"; models: string[] } | { status: "error"; error: string };

type Row = {
  provider: string;
  label: string;
  action: { type: "model"; spec: string } | { type: "login"; provider: string } | { type: "none" };
  dim?: boolean;
};

const WINDOW = 12;

/** Searchable list of every model from every configured provider, fetched live. */
export function ModelPicker({
  current,
  initialQuery = "",
  onSelect,
  onLogin,
  onCancel,
}: {
  current: string;
  initialQuery?: string;
  onSelect: (spec: string) => void;
  onLogin: (provider: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [lists, setLists] = useState<Record<string, ListState>>({});
  const [index, setIndex] = useState(0);
  const [touched, setTouched] = useState(false); // user moved the cursor; stop auto-selecting current

  useEffect(() => {
    for (const p of PROVIDER_INFO) {
      if (!isConfigured(p.name)) continue;
      setLists((l) => ({ ...l, [p.name]: { status: "loading" } }));
      listModels(p.name).then(
        (models) => setLists((l) => ({ ...l, [p.name]: { status: "ok", models } })),
        (e: Error) => setLists((l) => ({ ...l, [p.name]: { status: "error", error: e.message.split("\n")[0]! } })),
      );
    }
  }, []);

  const rows = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (s: string) => terms.every((t) => s.toLowerCase().includes(t));
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const p of PROVIDER_INFO) {
      const state = lists[p.name];
      if (!isConfigured(p.name)) {
        if (!p.local && p.name !== "compat" && matches(`${p.name} ${p.label} login`))
          out.push({ provider: p.name, label: "Log in to see models…", action: { type: "login", provider: p.name }, dim: true });
        continue;
      }
      if (!state || state.status === "loading") {
        if (matches(p.name)) out.push({ provider: p.name, label: "loading…", action: { type: "none" }, dim: true });
      } else if (state.status === "error") {
        // Local servers that aren't running just don't show up.
        if (!p.local && matches(p.name))
          out.push({
            provider: p.name,
            label: `couldn't list models: ${state.error}`,
            action: { type: "login", provider: p.name },
            dim: true,
          });
      } else {
        for (const m of state.models) {
          const spec = `${p.name}:${m}`;
          seen.add(spec);
          if (matches(spec)) out.push({ provider: p.name, label: m, action: { type: "model", spec } });
        }
      }
    }
    // Anything typed as provider:model can be used even if the provider doesn't list it.
    const typed = query.trim();
    if (/^[a-z]+:\S+$/.test(typed) && !seen.has(typed))
      out.unshift({ provider: typed.split(":")[0]!, label: `use "${typed.slice(typed.indexOf(":") + 1)}"`, action: { type: "model", spec: typed } });
    return out;
  }, [lists, query]);

  // Start on the current model until the user moves; clamp when the list shrinks.
  useEffect(() => {
    if (!touched) {
      const i = rows.findIndex((r) => r.action.type === "model" && r.action.spec === current);
      setIndex(Math.max(0, i));
    } else setIndex((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }, [rows]);

  const move = (d: number) => {
    setTouched(true);
    setIndex((i) => Math.max(0, Math.min(rows.length - 1, i + d)));
  };

  usePaste((text) => setQuery((q) => q + text.trim()));
  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.upArrow) return move(-1);
    if (key.downArrow) return move(1);
    if (key.pageUp) return move(-WINDOW);
    if (key.pageDown) return move(WINDOW);
    if (key.return) {
      const row = rows[index];
      if (row?.action.type === "model") onSelect(row.action.spec);
      else if (row?.action.type === "login") onLogin(row.action.provider);
      return;
    }
    if (key.backspace || key.delete) return setQuery((q) => q.slice(0, -1));
    if (key.ctrl && input === "u") return setQuery("");
    if (key.ctrl || key.meta || key.tab || key.leftArrow || key.rightArrow) return;
    if (input) {
      setTouched(true);
      setIndex(0);
      setQuery((q) => q + input);
    }
  });

  const start = Math.max(0, Math.min(index - Math.floor(WINDOW / 2), rows.length - WINDOW));
  const visible = rows.slice(start, start + WINDOW);
  const loading = Object.values(lists).some((l) => l.status === "loading");

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text>
        <Text bold>Select model</Text>
        <Text dimColor>
          {" "}
          · {rows.filter((r) => r.action.type === "model").length} models{loading ? " · loading…" : ""}
        </Text>
      </Text>
      <Text>
        <Text color="cyan">⌕ </Text>
        {query || <Text dimColor>type to filter, or provider:model for anything unlisted</Text>}
        {query ? <Text inverse> </Text> : null}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {start > 0 && <Text dimColor>{`  ↑ ${start} more`}</Text>}
        {visible.map((r, i) => {
          const selected = start + i === index;
          const isCurrent = r.action.type === "model" && r.action.spec === current;
          return (
            <Text key={`${r.provider}:${r.label}`} color={selected ? "cyan" : undefined} dimColor={!selected && r.dim}>
              {selected ? "❯ " : "  "}
              <Text dimColor={!selected}>{r.provider.padEnd(11)}</Text>
              {r.label}
              {isCurrent ? <Text color="green"> ✔</Text> : null}
            </Text>
          );
        })}
        {rows.length === 0 && <Text dimColor>  No matches.</Text>}
        {start + WINDOW < rows.length && <Text dimColor>{`  ↓ ${rows.length - start - WINDOW} more`}</Text>}
      </Box>
      <Text dimColor>↑↓ navigate · enter select · esc cancel · /login to add a provider</Text>
    </Box>
  );
}
