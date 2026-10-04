import { Box, Text } from "ink";
import type { NoticeLevel } from "../../core/agent.ts";
import type { ToolCall } from "../../core/conversation.ts";
import type { DiffModel } from "../text/diff.ts";
import { modelDisplay, previewPrompt, tildify } from "../text/format.ts";
import { AssistantText } from "./AssistantText.tsx";
import { ToolResult } from "./ToolResult.tsx";
import { TranscriptRow } from "./TranscriptRow.tsx";

const NOTICE_COLORS: Record<NoticeLevel, string | undefined> = { info: undefined, warn: "yellow", error: "red" };

/** One finished entry of the transcript, rendered once into <Static>. */
export type Item =
  | { kind: "banner" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; first: boolean }
  | { kind: "tool"; call: ToolCall; output: string; isError: boolean; diff?: DiffModel }
  | { kind: "notice"; text: string; level: NoticeLevel; bright?: boolean };

export function ItemView({ item, model }: { item: Item; model: string }) {
  switch (item.kind) {
    case "banner":
      return (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" alignSelf="flex-start">
          <Text>
            <Text color="cyan">✻</Text> Welcome to <Text bold>megacode</Text>
          </Text>
          <Text dimColor>/help for commands · ? for shortcuts</Text>
          <Text dimColor>
            model: {modelDisplay(model)}
            {"\n"}cwd: {tildify(process.cwd())}
          </Text>
        </Box>
      );
    case "user":
      return (
        <Box marginTop={1}>
          <TranscriptRow prefix={<Text dimColor>{"> "}</Text>} width={2}>
            <Text wrap="wrap">{previewPrompt(item.text)}</Text>
          </TranscriptRow>
        </Box>
      );
    case "assistant":
      return <AssistantText text={item.text} first={item.first} />;
    case "tool":
      return <ToolResult call={item.call} output={item.output} isError={item.isError} diff={item.diff} />;
    case "notice":
      return (
        <Box marginTop={1}>
          <TranscriptRow prefix={<Text dimColor>{"  ⎿  "}</Text>} width={5}>
            <Text color={NOTICE_COLORS[item.level]} dimColor={item.level === "info" && !item.bright}>
              {item.text}
            </Text>
          </TranscriptRow>
        </Box>
      );
  }
}
