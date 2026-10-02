import { Box, Text } from "ink";
import { EDIT_TOOLS } from "../core/settings.ts";
import type { ApprovalRequest } from "../core/tools.ts";
import { approvalBody } from "./format.ts";
import { Select } from "./Select.tsx";

export type PendingApproval = ApprovalRequest & { resolve: (ok: boolean) => void };
export type ApprovalChoice = "yes" | "always" | "no";

/** "Do you want to proceed?" for a tool call the permission mode doesn't allow on its own. */
export function ApprovalDialog({ request, onAnswer }: { request: PendingApproval; onAnswer: (choice: ApprovalChoice) => void }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text bold color="yellow">
        {request.title}
      </Text>
      <Box paddingLeft={2} marginY={1}>
        <Text>{approvalBody(request)}</Text>
      </Box>
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
  );
}
