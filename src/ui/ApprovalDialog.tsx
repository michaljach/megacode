import { Box, Text } from "ink";
import { EDIT_TOOLS } from "../core/settings.ts";
import type { ApprovalRequest } from "../core/tools.ts";
import { Dialog } from "./Dialog.tsx";
import { approvalBody } from "./format.ts";
import { Select } from "./Select.tsx";

export type PendingApproval = ApprovalRequest & { resolve: (ok: boolean) => void };
export type ApprovalChoice = "yes" | "always" | "no";

/** "Do you want to proceed?" for a tool call the permission mode doesn't allow on its own. */
export function ApprovalDialog({ request, onAnswer }: { request: PendingApproval; onAnswer: (choice: ApprovalChoice) => void }) {
  return (
    <Dialog title={request.title} tone="warn">
      <Box paddingLeft={2}>
        <Text>{approvalBody(request)}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>Do you want to proceed?</Text>
        <Select
          options={[
            { label: "Yes", value: "yes" as const },
            {
              label: EDIT_TOOLS.has(request.tool)
                ? "Yes, allow all edits this session"
                : `Yes, and don't ask again for ${request.tool} this session`,
              value: "always" as const,
            },
            { label: "No, and tell megacode what to do differently", value: "no" as const, hint: "(esc)" },
          ]}
          onSelect={onAnswer}
          onCancel={() => onAnswer("no")}
        />
      </Box>
    </Dialog>
  );
}
