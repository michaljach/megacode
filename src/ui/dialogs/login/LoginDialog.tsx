import { Box, Text, useInput } from "ink";
import { PROVIDER_INFO, envKeyName, type LoginMethod } from "../../../adapters/providers/catalog.ts";
import { authStatus, isConfigured } from "../../../adapters/providers/credentials.ts";
import { configDir } from "../../../adapters/storage.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { Select } from "../../components/Select.tsx";
import { TextField } from "../../components/TextField.tsx";
import { Waiting } from "../../components/Waiting.tsx";
import { tildify } from "../../text/format.ts";
import { defaultURL, useLogin } from "./useLogin.ts";

const METHOD_LABELS: Record<LoginMethod, [label: string, hint: string]> = {
  chatgpt: ["Sign in with ChatGPT", "use your Plus / Pro / Business plan"],
  "openrouter-oauth": ["Sign in with OpenRouter", "in your browser; creates a key for megacode"],
  "ant-cli": ["Sign in with the Anthropic CLI", "runs `ant auth login` in your browser"],
  key: ["Paste an API key", ""],
  url: ["Connect to a server", ""],
};

/** /login, one screen per step; the flow itself lives in useLogin. */
export function LoginDialog({
  initialProvider,
  welcome,
  onDone,
  onCancel,
}: {
  initialProvider?: string;
  welcome?: boolean;
  onDone: (provider: string, modelCount: number) => void;
  onCancel: () => void;
}) {
  const login = useLogin({ initialProvider, onDone, onCancel });
  const { step, info, method, error, back } = login;

  useInput((_, key) => key.escape && back(), { isActive: step === "browser" });

  const envKey = info && envKeyName(info);
  const envNote = envKey && <Text color="yellow">${envKey} is set and takes precedence over anything saved here.</Text>;
  const errorLine = error && <Text color="red">{error}</Text>;
  const keys = "enter continue · esc back";

  if (step === "pick" || !info)
    return (
      <Dialog
        title={welcome ? "Welcome to megacode" : "Log in to a provider"}
        footer={`Saved to ${tildify(configDir())}/auth.json, readable only by you · esc close`}
      >
        {welcome && (
          <Box marginBottom={1}>
            <Text>Connect a model provider to get started. You can add more later with /login.</Text>
          </Box>
        )}
        <Select
          options={PROVIDER_INFO.map((p) => ({
            label: p.label,
            value: p.name,
            hint: p.local ? defaultURL(p.name) : isConfigured(p.name) ? `✔ ${authStatus(p.name)}` : undefined,
          }))}
          onSelect={login.pick}
          onCancel={onCancel}
        />
      </Dialog>
    );

  if (step === "method")
    return (
      <Dialog title={`Log in to ${info.label}`} subtitle="how do you want to sign in?" footer="enter select · esc back">
        {errorLine}
        {envNote}
        <Box marginTop={error || envNote ? 1 : 0}>
          <Select
            options={info.methods.map((m) => ({ label: METHOD_LABELS[m][0], value: m, hint: METHOD_LABELS[m][1] || undefined }))}
            onSelect={login.chooseMethod}
            onCancel={back}
          />
        </Box>
      </Dialog>
    );

  if (step === "browser")
    return (
      <Dialog title={method ? METHOD_LABELS[method][0] : "Sign in"} footer="esc cancel">
        <Text dimColor>
          {method === "ant-cli" ? "Running `ant auth login`. Finish signing in in your browser." : "Finish signing in in your browser. If it didn't open, visit:"}
        </Text>
        {login.browserUrl && <Text color="cyan">{login.browserUrl}</Text>}
        {login.output.map((line, i) => <Text key={i} dimColor>{line}</Text>)}
        <Box marginTop={1}>
          <Waiting text="Waiting for sign-in…" />
        </Box>
      </Dialog>
    );

  if (step === "url")
    return (
      <Dialog title={`Log in to ${info.label}`} subtitle="endpoint URL" footer={keys}>
        <Text dimColor>
          {info.local ? `Make sure the server is running. Default: ${info.baseURL}` : "Base URL of the OpenAI-compatible API, e.g. https://host/v1"}
        </Text>
        {errorLine}
        <Box marginTop={1}>
          <TextField
            value={login.baseURL}
            onChange={login.setBaseURL}
            placeholder={info.baseURL ?? "https://…/v1"}
            onSubmit={login.submitURL}
            onCancel={back}
          />
        </Box>
      </Dialog>
    );

  if (step === "key")
    return (
      <Dialog title={`Log in to ${info.label}`} subtitle="API key" footer={keys}>
        {info.keyUrl && <Text dimColor>Create one at {info.keyUrl}</Text>}
        {info.keyOptional && <Text dimColor>Leave empty if the endpoint doesn't need a key.</Text>}
        {envNote}
        {errorLine}
        <Box marginTop={info.keyUrl || info.keyOptional || envNote || error ? 1 : 0}>
          <TextField
            value={login.apiKey}
            onChange={login.setApiKey}
            mask
            placeholder="paste your key and press enter"
            onSubmit={login.submitKey}
            onCancel={back}
          />
        </Box>
      </Dialog>
    );

  return (
    <Dialog title={`Log in to ${info.label}`}>
      <Waiting text={`Connecting to ${info.label}…`} />
    </Dialog>
  );
}
