import { Box, Text } from "ink";
import { useState } from "react";
import { baseRef, describeChanges, listWorktrees, WORKTREE_NAME, worktreeChanges, type Worktree, type WorktreeChanges } from "../adapters/git/worktree.ts";
import { Dialog } from "./Dialog.tsx";
import { tildify } from "./format.ts";
import { useLoaded } from "./hooks/useLoaded.ts";
import { Select, type Option } from "./Select.tsx";
import { Waiting } from "./Spinner.tsx";
import { TextField } from "./TextField.tsx";

type Action = { type: "new" } | { type: "open"; wt: Worktree } | { type: "leave"; remove: boolean };
type MenuData = { worktrees: { wt: Worktree; changes: string }[]; base: string; currentChanges: string };

async function loadMenu(current: Worktree | null): Promise<MenuData> {
  const [worktrees, base, currentChanges] = await Promise.all([
    listWorktrees().then((list) => Promise.all(list.map(async (wt) => ({ wt, changes: describeChanges(await worktreeChanges(wt)) })))),
    baseRef(),
    current ? worktreeChanges(current).then(describeChanges) : "",
  ]);
  return { worktrees, base, currentChanges };
}

/** Create a worktree, switch to an existing one, or go back to the main checkout. */
export function WorktreeMenu({
  current,
  onCreate,
  onOpen,
  onLeave,
  onCancel,
}: {
  current: Worktree | null;
  onCreate: (name?: string) => void;
  onOpen: (wt: Worktree) => void;
  onLeave: (remove: boolean) => void;
  onCancel: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const data = useLoaded(() => loadMenu(current));
  if (!data) return <Frame current={current}><Waiting text="Reading worktrees…" /></Frame>;
  const { worktrees, base, currentChanges } = data;

  const options: Option<Action>[] = [
    { label: "New worktree", value: { type: "new" }, hint: `(branches from ${base})` },
    ...worktrees.map(({ wt, changes }) => ({
      label: wt.path === current?.path ? `${wt.name} (current)` : `Switch to ${wt.name}`,
      value: { type: "open", wt } as Action,
      hint: `${wt.branch} · ${changes}`,
    })),
  ];
  if (current)
    options.push(
      { label: "Return to main checkout, keep worktree", value: { type: "leave", remove: false } },
      {
        label: "Return to main checkout, remove worktree",
        value: { type: "leave", remove: true },
        hint: currentChanges === "no changes" ? "" : `(discards ${currentChanges})`,
      },
    );

  function select(a: Action) {
    if (a.type === "new") return setNaming(true);
    if (a.type === "leave") return onLeave(a.remove);
    if (a.wt.path === current?.path) return onCancel();
    onOpen(a.wt);
  }

  function submitName(v: string) {
    if (v && !WORKTREE_NAME.test(v)) return setError("Use letters, digits, - and _ (max 64), starting with a letter or digit.");
    onCreate(v || undefined);
  }

  return (
    <Frame current={current} help={naming ? "enter create · esc back" : "↑↓ navigate · enter select · esc cancel"}>
      {naming ? (
        <>
          <Text>Name for the new worktree (branch worktree-{name || "<name>"}):</Text>
          <TextField
            value={name}
            onChange={(v) => {
              setName(v);
              setError("");
            }}
            onSubmit={submitName}
            onCancel={() => setNaming(false)}
            placeholder="leave empty for a random name"
          />
          {error && <Text color="red">{error}</Text>}
        </>
      ) : (
        <Select options={options} onSelect={select} onCancel={onCancel} />
      )}
    </Frame>
  );
}

function Frame({ current, help, children }: { current: Worktree | null; help?: string; children: React.ReactNode }) {
  return (
    <Dialog title="Worktrees" subtitle={current ? `in ${current.name} (${current.branch})` : "in the main checkout"} footer={help}>
      {children}
    </Dialog>
  );
}

/** Shown when exiting while in a worktree: keep it for later, or remove it and its branch. */
export function ExitWorktreeDialog({
  worktree,
  onSelect,
  onCancel,
}: {
  worktree: Worktree;
  onSelect: (remove: boolean) => void;
  onCancel: () => void;
}) {
  // undefined while git runs; null if git couldn't tell.
  const changes = useLoaded<WorktreeChanges | null>(() => worktreeChanges(worktree));
  const summary = changes === undefined ? "" : describeChanges(changes);
  const clean = changes?.files === 0 && changes.commits === 0;
  return (
    <Dialog title={`Exiting worktree ${worktree.name}`} tone="warn" footer="esc to stay">
      <Text dimColor>
        {tildify(worktree.path)} · branch {worktree.branch}
        {summary && ` · ${summary}`}
      </Text>
      <Box marginTop={1}>
        {changes === undefined ? (
          <Waiting text="Checking for changes…" />
        ) : (
          <Select
            initialIndex={clean ? 1 : 0}
            options={[
              { label: "Keep worktree", value: false, hint: `(return with megacode -w ${worktree.name})` },
              { label: "Remove worktree and branch", value: true, hint: clean ? "" : `(discards ${summary})` },
            ]}
            onSelect={onSelect}
            onCancel={onCancel}
          />
        )}
      </Box>
    </Dialog>
  );
}
