import { parseArgs } from "node:util";

type CliOptions = {
  model?: string;
  ask: boolean;
  help: boolean;
  host?: string;
  port?: number;
  prompt: string;
};

/** `parseArgs` has no number type, so `-p` arrives as a string. Port 0 means "pick one". */
function parsePort(raw?: string): number | undefined {
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`-p expects a port between 0 and 65535 (0 picks one); ${raw} is not one.`);
  return port;
}

/** Parses command-line arguments. */
export function parseCliArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string", short: "m" },
      ask: { type: "boolean", short: "a" },
      host: { type: "string", short: "H" },
      port: { type: "string", short: "p" },
      help: { type: "boolean", short: "h" },
    },
  });
  return {
    model: values.model,
    ask: !!values.ask,
    help: !!values.help,
    host: values.host,
    port: parsePort(values.port),
    prompt: positionals.join(" "),
  };
}
