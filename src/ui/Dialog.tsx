import { Box, Text } from "ink";
import type { ReactNode } from "react";

/**
 * The frame every dialog uses, so spacing is the same everywhere: title line, a blank line,
 * the body, then dim key hints. `warn` marks dialogs that ask before something happens.
 */
export function Dialog({
  title,
  subtitle,
  footer,
  tone = "default",
  children,
}: {
  title: ReactNode;
  /** Dim context after the title, e.g. the current value or where changes are saved. */
  subtitle?: ReactNode;
  /** Key hints, e.g. "↑↓ navigate · enter select · esc close". */
  footer?: ReactNode;
  tone?: "default" | "warn";
  children?: ReactNode;
}) {
  const color = tone === "warn" ? "yellow" : "cyan";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginTop={1}>
      <Text wrap="truncate-end">
        <Text bold color={tone === "warn" ? color : undefined}>{title}</Text>
        {subtitle ? <Text dimColor> · {subtitle}</Text> : null}
      </Text>
      {children ? <Box flexDirection="column" marginTop={1}>{children}</Box> : null}
      {footer ? <Box marginTop={1}><Text dimColor>{footer}</Text></Box> : null}
    </Box>
  );
}
