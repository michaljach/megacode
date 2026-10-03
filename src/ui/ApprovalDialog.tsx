import { Box, Text, useInput } from "ink";
import { basename } from "node:path";
import type { ApprovalRequest } from "../core/tools.ts";
import { Dialog } from "./Dialog.tsx";
import { buildDiff, DIFF_COLORS } from "./diff.ts";
import { DiffLines } from "./DiffLines.tsx";
import { Select } from "./Select.tsx";

export type PendingApproval = ApprovalRequest & { resolve: (ok: boolean) => void };
export type ApprovalChoice = "yes" | "always" | "no";

/** Claude Code's permission colors. */
const ACCENT = "#b1b9f9";
const RULE = "#505050";
const DASHED = { topLeft: "", top: "╌", topRight: "", left: "", right: "", bottomLeft: "", bottom: "╌", bottomRight: "" };

/** Asks before a tool call the permission mode doesn't allow on its own. */
export function ApprovalDialog({ request, onAnswer }: { request: PendingApproval; onAnswer: (choice: ApprovalChoice) => void }) {
  return request.change ? <FileChangeApproval request={request} onAnswer={onAnswer} /> : <CommandApproval request={request} onAnswer={onAnswer} />;
}

/** Edits and new files, laid out like Claude Code: title, path, the diff between dashed rules, the question. */
function FileChangeApproval({ request, onAnswer }: { request: PendingApproval; onAnswer: (choice: ApprovalChoice) => void }) {
  const change = request.change!;
  const model = buildDiff(change);
  const name = basename(change.file);
  // shift+tab picks "accept edits", as the option says.
  useInput((_, key) => key.shift && key.tab && onAnswer("always"));
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderStyle="single" borderColor={ACCENT} borderLeft={false} borderRight={false} borderBottom={false} />
      <Box flexDirection="column" paddingX={1}>
        <Text bold color={ACCENT}>
          {change.created ? "Create file" : "Edit file"}
        </Text>
        <Text color={DIFF_COLORS.muted}>{model?.file ?? change.file}</Text>
      </Box>
      {/* A new file's lines sit one column in; an edit's colored rows span the full width. */}
      <Box borderStyle={DASHED} borderColor={RULE} borderLeft={false} borderRight={false} flexDirection="column" paddingLeft={change.created ? 1 : 0}>
        {model ? <DiffLines model={model} /> : <Text color={DIFF_COLORS.muted}> Diff preview unavailable (file too large).</Text>}
      </Box>
      <Box flexDirection="column" paddingX={1}>
        <Text>
          {change.created ? "Do you want to create " : "Do you want to make this edit to "}
          <Text bold>{name}</Text>?
        </Text>
        <Select
          accent={ACCENT}
          numberColor={DIFF_COLORS.muted}
          options={[
            { label: "Yes", value: "yes" as const },
            {
              label: (
                <>
                  Yes, and switch to <Text bold>accept edits (auto-approve file edits)</Text> for this session <Text bold>(shift+tab)</Text>
                </>
              ),
              value: "always" as const,
            },
            { label: "No", value: "no" as const },
          ]}
          onSelect={onAnswer}
          onCancel={() => onAnswer("no")}
        />
        <Text color={DIFF_COLORS.muted}>Esc to cancel</Text>
      </Box>
    </Box>
  );
}

/** Shell commands and MCP tools. (File edits always carry a change, so they never come here.) */
function CommandApproval({ request, onAnswer }: { request: PendingApproval; onAnswer: (choice: ApprovalChoice) => void }) {
  return (
    <Dialog title={request.title} tone="warn">
      <Box paddingLeft={2}>
        <Text>{request.body ?? ""}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>Do you want to proceed?</Text>
        <Select
          options={[
            { label: "Yes", value: "yes" as const },
            { label: `Yes, and don't ask again for ${request.tool} this session`, value: "always" as const },
            { label: "No, and tell megacode what to do differently", value: "no" as const, hint: "(esc)" },
          ]}
          onSelect={onAnswer}
          onCancel={() => onAnswer("no")}
        />
      </Box>
    </Dialog>
  );
}
