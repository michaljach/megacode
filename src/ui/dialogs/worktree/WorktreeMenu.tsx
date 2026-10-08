import { Text } from "ink";
import { useState } from "react";
import { baseRef, describeChanges, listWorktrees, WORKTREE_NAME, worktreeChanges, type Worktree } from "../../../adapters/git/worktree.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { Select, type Option } from "../../components/Select.tsx";
import { TextField } from "../../components/TextField.tsx";
import { Waiting } from "../../components/Waiting.tsx";
import { useLoaded } from "../../hooks/useLoaded.ts";

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
