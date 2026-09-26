import { Text, useInput, usePaste } from "ink";

/** Single-line input for dialogs. `mask` hides the value (API keys), showing only the last 4 chars. */
export function TextField({
  value,
  onChange,
  onSubmit,
  onCancel,
  mask,
  placeholder = "",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onCancel?: () => void;
  mask?: boolean;
  placeholder?: string;
}) {
  usePaste((text) => onChange(value + text.replace(/[\r\n]/g, "").trim()));
  useInput((input, key) => {
    if (key.return) return onSubmit(value.trim());
    if (key.escape) return onCancel?.();
    if (key.backspace || key.delete) return onChange(value.slice(0, -1));
    if (key.ctrl && input === "u") return onChange("");
    if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.tab) return;
    if (input) onChange(value + input.replace(/[\r\n]/g, ""));
  });

  const shown = mask && value.length > 4 ? "•".repeat(Math.min(value.length - 4, 40)) + value.slice(-4) : value;
  return (
    <Text>
      {"> "}
      {shown || <Text dimColor>{placeholder}</Text>}
      <Text inverse> </Text>
    </Text>
  );
}
