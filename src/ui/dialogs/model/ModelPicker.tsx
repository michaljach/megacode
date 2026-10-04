import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useState } from "react";
import { PROVIDER_INFO } from "../../../adapters/providers/catalog.ts";
import { isConfigured } from "../../../adapters/providers/credentials.ts";
import { listModels } from "../../../adapters/providers/registry.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { TextField } from "../../components/TextField.tsx";
import { modelRows, type ListState } from "./modelRows.ts";

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

  const rows = useMemo(() => modelRows({ query, providers: PROVIDER_INFO, lists, configured: isConfigured }), [lists, query]);

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

  // Typing goes to the TextField; this handles moving through the list.
  useInput((_, key) => {
    if (key.upArrow) return move(-1);
    if (key.downArrow) return move(1);
    if (key.pageUp) return move(-WINDOW);
    if (key.pageDown) return move(WINDOW);
  });

  function filter(next: string) {
    setTouched(true);
    setIndex(0);
    setQuery(next);
  }

  function choose() {
    const row = rows[index];
    if (row?.action.type === "model") onSelect(row.action.spec);
    else if (row?.action.type === "login") onLogin(row.action.provider);
  }

  const start = Math.max(0, Math.min(index - Math.floor(WINDOW / 2), rows.length - WINDOW));
  const visible = rows.slice(start, start + WINDOW);
  const loading = Object.values(lists).some((l) => l.status === "loading");

  return (
    <Dialog
      title="Select model"
      subtitle={`${rows.filter((r) => r.action.type === "model").length} models${loading ? " · loading…" : ""}`}
      footer="↑↓ navigate · enter select · esc cancel · /login to add a provider"
    >
      <TextField
        value={query}
        onChange={filter}
        onSubmit={choose}
        onCancel={onCancel}
        placeholder="type to filter, or provider:model for anything unlisted"
      />
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
    </Dialog>
  );
}
