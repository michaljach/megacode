import type { ToolSpec } from "../../core/tools.ts";

type PropertySchema = { type?: string; minimum?: number };

/** Check whether a value is a non-null object (not array). */
const isObject = (v: unknown) => v != null && typeof v === "object" && !Array.isArray(v);

const TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  boolean: (v) => typeof v === "boolean",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => Number.isSafeInteger(v),
  array: Array.isArray,
  object: isObject,
};

/**
 * Checks model-supplied arguments against a tool's top-level schema: required keys, each property's
 * `type` and `minimum`. Nested structure is left to the tool. Throws a message the model can act on.
 */
export function validateArguments(input: unknown, schema: ToolSpec["parameters"]): Record<string, unknown> {
  if (!TYPE_CHECKS.object!(input)) throw new Error("Tool arguments must be a JSON object.");
  const args = input as Record<string, unknown>;
  if ("_invalid_json" in args) throw new Error("Tool arguments were not valid JSON.");

  const missing = (schema.required ?? []).filter((key) => args[key] === undefined);
  if (missing.length) throw new Error(`Missing required arguments: ${missing.join(", ")}`);

  for (const [key, property] of Object.entries(schema.properties) as [string, PropertySchema][]) {
    const value = args[key];
    if (value === undefined || !property.type) continue;
    const check = TYPE_CHECKS[property.type];
    if (check && !check(value)) throw new Error(`${key} must be ${article(property.type)} ${property.type}.`);
    if (property.minimum !== undefined && (value as number) < property.minimum)
      throw new Error(`${key} must be at least ${property.minimum}.`);
  }
  return args;
}

const article = (word: string) => (/^[aeiou]/.test(word) ? "an" : "a");
