import { basename, extname } from "node:path";
import { stripVTControlCharacters } from "node:util";
import chalk from "chalk";
import { createHighlighter, type BundledLanguage } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Syntax highlighting in Claude Code's style: Monokai Extended colors, with token rules matched
// to how Claude Code renders TypeScript (checked cell by cell against its output).

export const CODE = "#f8f8f2"; // default code color
const KEYWORD = "#f92672";
const STORAGE = "#66d9ef";
const NAME = "#a6e22e";
const PARAM_PUNCTUATION = "#fd971f";
const CONSTANT = "#ffffff";
const NUMBER = "#be84ff";
const STRING = "#e6db74";
const COMMENT = "#75715e";

/** A run of text with one style. `background` marks changed words in diffs. */
export type Segment = { text: string; color?: string; background?: string };

const has = (scopes: string[], prefix: string) => scopes.some((s) => s === prefix || s.startsWith(prefix + "."));
const BUILTIN_OBJECTS = new Set(["console", "Math", "JSON", "Object", "Array", "Promise", "Number", "String", "Date", "process", "Reflect", "Symbol"]);

/** The color for a token, from its TextMate scopes (outermost first) and text. */
function colorFor(scopes: string[], text: string): string | undefined {
  if (has(scopes, "comment")) return COMMENT;
  // Inside `${…}` only numbers are colored; the rest reads as plain code.
  if (has(scopes, "meta.template.expression")) return has(scopes, "constant.numeric") ? NUMBER : undefined;
  if (has(scopes, "string") || has(scopes, "punctuation.definition.string")) return STRING;
  if (has(scopes, "constant.numeric") || has(scopes, "constant.language")) return NUMBER;
  if (has(scopes, "keyword.operator.type.annotation")) return has(scopes, "meta.return.type") ? undefined : PARAM_PUNCTUATION;
  if (has(scopes, "punctuation.separator.parameter")) return PARAM_PUNCTUATION;
  if (has(scopes, "keyword.operator.new") || has(scopes, "keyword.operator.expression")) return KEYWORD;
  if (has(scopes, "keyword.operator") || has(scopes, "punctuation")) return undefined;
  if (has(scopes, "storage")) return STORAGE;
  if (has(scopes, "keyword")) return KEYWORD;
  if (has(scopes, "entity.name.tag")) return KEYWORD;
  if (has(scopes, "entity.name") || has(scopes, "entity.other") || has(scopes, "support.type.primitive")) return NAME;
  if (has(scopes, "variable.parameter")) return NAME;
  if (has(scopes, "support.function")) return STORAGE;
  if (has(scopes, "support.type.property-name")) return KEYWORD;
  if (has(scopes, "support.type") || has(scopes, "support.class")) return STORAGE;
  if (has(scopes, "variable.language")) return PARAM_PUNCTUATION;
  // ALL_CAPS names and well-known globals stand out; ordinary `const` names don't.
  if (/^[A-Z][A-Z0-9_]+$/.test(text) && (has(scopes, "variable") || has(scopes, "constant"))) return CONSTANT;
  if (has(scopes, "variable.other.object") && BUILTIN_OBJECTS.has(text)) return CONSTANT;
  if (has(scopes, "constant.other")) return CONSTANT;
  return undefined;
}

const EXTENSIONS: Record<string, BundledLanguage> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  py: "python", rb: "ruby", rs: "rust", go: "go", java: "java", kt: "kotlin", swift: "swift",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript",
  json: "json", jsonc: "jsonc", yml: "yaml", yaml: "yaml", toml: "toml",
  css: "css", scss: "scss", html: "html", vue: "vue", svelte: "svelte", sql: "sql",
  lua: "lua", dart: "dart", ex: "elixir", exs: "elixir", zig: "zig", graphql: "graphql",
};

/** Fence names that differ from Shiki's language ids. */
const ALIASES: Record<string, BundledLanguage> = {
  ts: "typescript", js: "javascript", py: "python", rb: "ruby", rs: "rust", sh: "shellscript",
  bash: "shellscript", zsh: "shellscript", shell: "shellscript", yml: "yaml", "c++": "cpp", "c#": "csharp",
};

/** The language for a file name; undefined means plain text (Markdown, too, as in Claude Code). */
export function fileLanguage(file: string): BundledLanguage | undefined {
  if (basename(file).toLowerCase() === "dockerfile") return "docker";
  return EXTENSIONS[extname(file).slice(1).toLowerCase()];
}

/** Loaded at startup in the background, so highlighting never blocks rendering. */
const PRELOAD: BundledLanguage[] = ["typescript", "tsx", "javascript", "jsx", "json", "python", "shellscript", "go", "rust", "css", "html", "yaml"];

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;
let highlighter: Highlighter | undefined;
let starting: Promise<Highlighter> | undefined;
const loading = new Map<string, Promise<void>>();

// Colors come from colorFor(), not a theme: one flat theme just makes Shiki tokenize and report scopes.
const SCOPES_ONLY = { name: "scopes-only", type: "dark" as const, settings: [{ settings: { foreground: CODE } }] };

function start() {
  starting ??= createHighlighter({ themes: [SCOPES_ONLY], langs: PRELOAD, engine: createJavaScriptRegexEngine() }).then((h) => {
    highlighter = h;
    return h;
  });
  return starting;
}

/** Makes `language` available for highlighting. Safe to call repeatedly; never rejects. */
export async function loadLanguage(language: string | undefined): Promise<void> {
  const lang = language && (ALIASES[language] ?? language);
  try {
    const h = await start();
    if (!lang || h.getLoadedLanguages().includes(lang)) return;
    if (!loading.has(lang)) loading.set(lang, h.loadLanguage(lang as BundledLanguage).catch(() => {}));
    await loading.get(lang);
  } catch {
    // Unknown language or a grammar that fails to load: code stays plain.
  }
}

/** Starts loading the highlighter and common grammars. */
export const preloadHighlighter = () => void loadLanguage(undefined);

const MAX_HIGHLIGHT = 200_000; // characters; bigger inputs render plain

/**
 * Colored segments per line, or null when the language isn't loaded (yet) or the code is too large.
 * Lines are tokenized together, so multi-line strings and comments color correctly.
 */
export function highlightLines(code: string, language: string | undefined): Segment[][] | null {
  const lang = language && (ALIASES[language] ?? language);
  if (!highlighter || !lang || !highlighter.getLoadedLanguages().includes(lang) || code.length > MAX_HIGHLIGHT) return null;
  try {
    const lines = highlighter.codeToTokensBase(code, { lang: lang as BundledLanguage, theme: SCOPES_ONLY, includeExplanation: "scopeName" });
    return lines.map((tokens) =>
      tokens.flatMap((token) =>
        (token.explanation ?? [{ content: token.content, scopes: [] }]).map((part) => ({
          text: part.content,
          color: colorFor(part.scopes.map((s) => s.scopeName), part.content.trim()),
        })),
      ),
    );
  } catch {
    return null;
  }
}

/** Kicks off a language load if needed; true when highlighting is ready now. */
export function languageReady(language: string | undefined): boolean {
  if (!language) return false;
  const lang = ALIASES[language] ?? language;
  if (highlighter?.getLoadedLanguages().includes(lang)) return true;
  void loadLanguage(language);
  return false;
}

/**
 * Code as ANSI text, e.g. for fenced blocks in replies. Control characters in the code are removed so
 * model output can't restyle the terminal. Plain until the language's grammar has loaded.
 */
export function highlightCode(code: string, language = ""): string {
  code = stripVTControlCharacters(code);
  const lines = languageReady(language.toLowerCase()) ? highlightLines(code, language.toLowerCase()) : null;
  if (!lines) return code;
  return lines.map((line) => line.map((s) => chalk.hex(s.color ?? CODE)(s.text)).join("")).join("\n");
}
