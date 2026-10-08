import { Box, Text } from "ink";
import { describeChanges, worktreeChanges, type Worktree, type WorktreeChanges } from "../../../adapters/git/worktree.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { Select } from "../../components/Select.tsx";
import { Waiting } from "../../components/Waiting.tsx";
import { useLoaded } from "../../hooks/useLoaded.ts";
import { tildify } from "../../text/format.ts";

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
    <Dialog title={`Exiting worktree ${worktree.name}`} tone="warn" footer="esc to stay · ctrl+c keep it and exit">
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
