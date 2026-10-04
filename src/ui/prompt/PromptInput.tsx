import { Box, Text, useInput, usePaste } from "ink";
import { useEffect, useRef, useState } from "react";
import { cycle } from "../../lib/cycle.ts";
import type { Command } from "../commands.ts";
import { KeyList } from "../components/KeyList.tsx";
import { promptCompletion } from "./autocomplete.ts";
import { lineBounds, verticalMove, wordEnd, wordStart } from "./editing.ts";
import { PromptText } from "./PromptText.tsx";

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

  const { start: lineStart, end: lineEnd } = lineBounds(value, cursor);

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
        if (menu.length) return setMenuIndex((i) => cycle(i, -1, menu.length));
        return lineStart === 0 ? browseHistory(-1) : setCursor(verticalMove(value, cursor, -1));
      }
      if (key.downArrow) {
        if (menu.length) return setMenuIndex((i) => cycle(i, 1, menu.length));
        return lineEnd === value.length ? browseHistory(1) : setCursor(verticalMove(value, cursor, 1));
      }
      // Some terminals send Option+arrows as readline's Escape+b / Escape+f.
      if (key.meta && (key.leftArrow || input === "b")) return setCursor(wordStart(value, cursor));
      if (key.meta && (key.rightArrow || input === "f")) return setCursor(wordEnd(value, cursor));
      if (key.leftArrow || (key.ctrl && input === "b")) return setCursor(Math.max(0, cursor - 1));
      if (key.rightArrow || (key.ctrl && input === "f")) return setCursor(Math.min(value.length, cursor + 1));
      if (key.home || (key.ctrl && input === "a")) return setCursor(lineStart);
      if (key.end || (key.ctrl && input === "e")) return setCursor(lineEnd);
      if (key.ctrl && input === "u") return set(value.slice(0, lineStart) + value.slice(cursor), lineStart);
      if (key.ctrl && input === "k") return set(value.slice(0, cursor) + value.slice(lineEnd), cursor);
      if ((key.ctrl && input === "w") || (key.meta && key.backspace)) {
        const start = wordStart(value, cursor);
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

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <PromptText value={value} completion={completion} cursor={cursor} isActive={isActive} placeholder={placeholder} />
      </Box>
      {completion && <Text dimColor>  tab to accept suggestion</Text>}
      {menu.length > 0 && (
        <Box paddingX={2}>
          <KeyList rows={menu.map((c) => [c.name, c.description])} selected={menuIndex} />
        </Box>
      )}
    </Box>
  );
}
