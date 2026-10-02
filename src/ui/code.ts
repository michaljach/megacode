import { extname, basename } from "node:path";
import { styleText, stripVTControlCharacters } from "node:util";
import { highlight, supportsLanguage } from "cli-highlight";
import { structuredPatch } from "diff";

const EXTENSIONS: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  py: "python", rb: "ruby", rs: "rust", sh: "bash", zsh: "bash",
  yml: "yaml", md: "markdown", h: "cpp", hpp: "cpp", cs: "csharp",
};

export function fileLanguage(file: string): string {
  if (basename(file).toLowerCase() === "dockerfile") return "dockerfile";
  const ext = extname(file).slice(1).toLowerCase();
  return EXTENSIONS[ext] ?? ext;
}

/** Unknown languages stay plain; never guess a language or let highlighting break output. */
export function highlightCode(code: string, language = ""): string {
  code = stripVTControlCharacters(code);
  language = language.toLowerCase();
  try {
    return language && supportsLanguage(language)
      ? highlight(code, { language, ignoreIllegals: true })
      : code;
  } catch {
    return code;
  }
}

/** Bounded, display-only diff. Keep this out of provider conversation history. */
export function renderFileChange(file: string, before: string, after: string): string {
  // Bound diff computation and highlighting for very large/generated files.
  if (before.length + after.length > 1_000_000) return "Diff preview omitted (file too large).";
  const patch = structuredPatch(file, file, before, after, undefined, undefined, { context: 3, timeout: 200 });
  if (!patch) return "Diff preview omitted (too many changes).";
  if (!patch.hunks.length) return "No content changes.";
  const language = fileLanguage(file);
  const out: string[] = [];
  const total = patch.hunks.reduce((n, h) => n + h.lines.length + 1, 0);
  let shown = 0;
  for (const hunk of patch.hunks) {
    if (shown >= 60) break;
    out.push(styleText("cyan", `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`));
    shown++;
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      if (shown >= 60) break;
      const sign = line[0]!;
      const oldNumber = sign === "+" || sign === "\\" ? "" : String(oldLine++);
      const newNumber = sign === "-" || sign === "\\" ? "" : String(newLine++);
      const gutter = `${oldNumber.padStart(4)} ${newNumber.padStart(4)} ${sign}`;
      const text = stripVTControlCharacters(line.slice(1)).replace(/\t/g, "  ");
      const source = text.slice(0, 240) + (text.length > 240 ? "…" : "");
      if (sign === "+" || sign === "-") {
        // Style the entire row, not just the marker. Avoid token colors overriding
        // the foreground and making code unreadable against the diff background.
        out.push(styleText([sign === "+" ? "bgGreen" : "bgRed", "white"], `${gutter} ${source}`));
      } else {
        out.push(`${styleText("dim", gutter)} ${highlightCode(source, language)}`);
      }
      shown++;
    }
  }
  if (shown < total) out.push(styleText("dim", `… ${total - shown} more diff lines (preview truncated)`));
  return out.join("\n");
}
