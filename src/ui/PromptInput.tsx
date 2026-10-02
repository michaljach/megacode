import { Box, Text, useInput, usePaste } from "ink";
import { useEffect, useRef, useState } from "react";
import { promptCompletion } from "./autocomplete.ts";
import type { Command } from "./commands.ts";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onHelp: () => void;
  isActive: boolean;
  history: string[];
  autocomplete: boolean;
  suggestion: string;
  commands: Command[];
  placeholder: string;
};

/**
 * Multi-line prompt editor with readline-style shortcuts, history and a slash-command menu.
 * Newline: "\" + enter, or option/alt + enter.
 */
export function PromptInput({ value, onChange, onSubmit, onHelp, isActive, history, autocomplete, suggestion, commands, placeholder }: Props) {
  const [cursor, setCursor] = useState(value.length);
  const [menuIndex, setMenuIndex] = useState(0);
  const historyPos = useRef(-1); // -1 = editing a fresh draft
  const draft = useRef("");

  // Keep the cursor valid when the value is changed from outside (clear, history, etc.).
  useEffect(() => setCursor((c) => Math.min(c, value.length)), [value]);

  const completion = promptCompletion(value, cursor, suggestion, autocomplete && isActive);
  const menu = /^\/\S*$/.test(value) ? commands.filter((c) => c.name.startsWith(value)) : [];
  useEffect(() => setMenuIndex(0), [value]);

  const set = (v: string, c = v.length) => {
    onChange(v);
    setCursor(c);
  };
  const insert = (text: string) => set(value.slice(0, cursor) + text + value.slice(cursor), cursor + text.length);

  // Line/column helpers for multi-line navigation.
  const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
  const lineEndIdx = value.indexOf("\n", cursor);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const onFirstLine = lineStart === 0;
  const onLastLine = lineEndIdx === -1;

  const browseHistory = (dir: -1 | 1) => {
    if (!history.length) return;
    if (historyPos.current === -1) {
      if (dir === 1) return;
      draft.current = value;
      historyPos.current = history.length;
    }
    const next = historyPos.current + dir;
    if (next < 0) return;
    if (next >= history.length) {
      historyPos.current = -1;
      return set(draft.current);
    }
    historyPos.current = next;
    set(history[next]!);
  };

  const moveVertical = (dir: -1 | 1) => {
    const col = cursor - lineStart;
    if (dir === -1) {
      const prevStart = value.lastIndexOf("\n", lineStart - 2) + 1;
      setCursor(Math.min(prevStart + col, lineStart - 1));
    } else {
      const nextEndIdx = value.indexOf("\n", lineEnd + 1);
      const nextEnd = nextEndIdx === -1 ? value.length : nextEndIdx;
      setCursor(Math.min(lineEnd + 1 + col, nextEnd));
    }
  };

  const wordStart = () => {
    let i = cursor;
    while (i > 0 && /\s/.test(value[i - 1]!)) i--;
    while (i > 0 && !/\s/.test(value[i - 1]!)) i--;
    return i;
  };

  const wordEnd = () => {
    let i = cursor;
    while (i < value.length && /\s/.test(value[i]!)) i++;
    while (i < value.length && !/\s/.test(value[i]!)) i++;
    return i;
  };

  const submit = (text: string) => {
    historyPos.current = -1;
    onSubmit(text);
  };

  usePaste((text) => insert(text.replace(/\r\n?/g, "\n")), { isActive });

  useInput(
    (input, key) => {
      // Handled by the app: interrupt, exit, permission mode.
      if ((key.ctrl && (input === "c" || input === "d")) || key.escape || (key.shift && key.tab)) return;

      if (key.return) {
        if (key.meta) return insert("\n");
        if (value[cursor - 1] === "\\") return set(value.slice(0, cursor - 1) + "\n" + value.slice(cursor), cursor);
        if (menu.length && value !== menu[menuIndex]!.name) return submit(menu[menuIndex]!.name);
        return submit(value);
      }
      if (key.tab) {
        if (menu.length) set(menu[menuIndex]!.name + " ");
        else if (completion) set(value + completion);
        return;
      }
      if (key.upArrow) {
        if (menu.length) return setMenuIndex((i) => (i - 1 + menu.length) % menu.length);
        return onFirstLine ? browseHistory(-1) : moveVertical(-1);
      }
      if (key.downArrow) {
        if (menu.length) return setMenuIndex((i) => (i + 1) % menu.length);
        return onLastLine ? browseHistory(1) : moveVertical(1);
      }
      // Some terminals send Option+arrows as readline's Escape+b / Escape+f.
      if (key.meta && (key.leftArrow || input === "b")) return setCursor(wordStart());
      if (key.meta && (key.rightArrow || input === "f")) return setCursor(wordEnd());
      if (key.leftArrow || (key.ctrl && input === "b")) return setCursor(Math.max(0, cursor - 1));
      if (key.rightArrow || (key.ctrl && input === "f")) return setCursor(Math.min(value.length, cursor + 1));
      if (key.home || (key.ctrl && input === "a")) return setCursor(lineStart);
      if (key.end || (key.ctrl && input === "e")) return setCursor(lineEnd);
      if (key.ctrl && input === "u") return set(value.slice(0, lineStart) + value.slice(cursor), lineStart);
      if (key.ctrl && input === "k") return set(value.slice(0, cursor) + value.slice(lineEnd), cursor);
      if ((key.ctrl && input === "w") || (key.meta && key.backspace)) {
        const start = wordStart();
        return set(value.slice(0, start) + value.slice(cursor), start);
      }
      if (key.backspace) {
        if (cursor > 0) set(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
        return;
      }
      if (key.delete) return set(value.slice(0, cursor) + value.slice(cursor + 1), cursor);
      if (key.ctrl || key.meta || !input) return;

      if (input === "?" && value === "") return onHelp();
      // Typed-ahead text can arrive in one chunk together with the enter key.
      if (input.length > 1 && input.endsWith("\r") && !input.slice(0, -1).includes("\r"))
        return submit(value.slice(0, cursor) + input.slice(0, -1) + value.slice(cursor));
      insert(input.replace(/\r\n?/g, "\n"));
    },
    { isActive },
  );

  // Render with a block cursor.
  const lines = (value + completion).split("\n");
  let offset = 0;
  const rendered = lines.map((line, i) => {
    const start = offset;
    offset += line.length + 1;
    const col = cursor - start;
    const showCursor = isActive && col >= 0 && col <= line.length;
    return (
      <Box key={i}>
        <Box flexShrink={0}><Text>{i === 0 ? "> " : "  "}</Text></Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="wrap">
            {showCursor ? (
              <>
                {line.slice(0, col)}
                <Text inverse dimColor={Boolean(completion)}>{line[col] ?? " "}</Text>
                <Text dimColor={Boolean(completion)}>{line.slice(col + 1)}</Text>
              </>
            ) : <Text dimColor={start > value.length}>{line || " "}</Text>}
          </Text>
        </Box>
      </Box>
    );
  });

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        {value === "" && !completion ? (
          <Box>
            <Box flexShrink={0}><Text>{"> "}</Text></Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text wrap="wrap">
                {isActive ? <Text inverse>{placeholder[0]}</Text> : null}
                <Text dimColor>{isActive ? placeholder.slice(1) : placeholder}</Text>
              </Text>
            </Box>
          </Box>
        ) : (
          rendered
        )}
      </Box>
      {completion && <Text dimColor>  tab to accept suggestion</Text>}
      {menu.length > 0 && (
        <Box flexDirection="column" paddingX={2}>
          {menu.map((c, i) => (
            <Text key={c.name} color={i === menuIndex ? "cyan" : undefined}>
              {c.name.padEnd(12)}
              <Text dimColor={i !== menuIndex}>{c.description}</Text>
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
