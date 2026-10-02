import { Box, Text, useInput } from "ink";
import { useRef, useState } from "react";
import { countModels, saveChatGPTLogin, verifyAndSaveKey } from "../adapters/accounts.ts";
import { loginAnthropicCLI } from "../adapters/auth/anthropic.ts";
import { loginChatGPT } from "../adapters/auth/chatgpt.ts";
import { loginOpenRouter } from "../adapters/auth/openrouter.ts";
import { savedCredentials, savedProviders } from "../adapters/auth/store.ts";
import { envKeyName, PROVIDER_INFO, providerInfo, type LoginMethod } from "../adapters/providers/catalog.ts";
import { authStatus, isConfigured } from "../adapters/providers/credentials.ts";
import { Select } from "./Select.tsx";
import { Waiting } from "./Spinner.tsx";
import { TextField } from "./TextField.tsx";

type Step = "pick" | "method" | "url" | "key" | "browser" | "verifying";

const METHOD_LABELS: Record<LoginMethod, [label: string, hint: string]> = {
  chatgpt: ["Sign in with ChatGPT", "use your Plus / Pro / Business plan"],
  "openrouter-oauth": ["Sign in with OpenRouter", "in your browser; creates a key for megacode"],
  "ant-cli": ["Sign in with the Anthropic CLI", "runs `ant auth login` in your browser"],
  key: ["Paste an API key", ""],
  url: ["Connect to a server", ""],
};

/**
 * /login: provider → sign-in method → browser OAuth, API key or endpoint → verify by listing models → save.
 */
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
  const [provider, setProvider] = useState(initialProvider);
  const [step, setStep] = useState<Step>(initialProvider ? stepFor(initialProvider) : "pick");
  const [method, setMethod] = useState<LoginMethod>();
  const [baseURL, setBaseURL] = useState(initialProvider ? defaultURL(initialProvider) : "");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [browserUrl, setBrowserUrl] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);

  const info = provider ? providerInfo(provider) : undefined;

  function pick(name: string) {
    setProvider(name);
    setBaseURL(defaultURL(name));
    setApiKey("");
    setError("");
    setStep(stepFor(name));
  }

  function back() {
    setError("");
    if (step === "browser") abort.current?.abort();
    const multi = info!.methods.length > 1;
    if (step === "pick") return onCancel();
    if (step === "key" && info!.keyOptional) return setStep("url");
    if (step === "browser" || (step === "key" && multi)) return setStep("method");
    if (initialProvider) return onCancel();
    setStep("pick");
  }

  function chooseMethod(m: LoginMethod) {
    setMethod(m);
    setError("");
    if (m === "key") return setStep("key");
    if (m === "url") return setStep("url");
    browserLogin(m);
  }

  async function browserLogin(m: LoginMethod) {
    const name = provider!;
    const ctrl = (abort.current = new AbortController());
    setBrowserUrl("");
    setOutput([]);
    setStep("browser");
    try {
      if (m === "chatgpt") {
        saveChatGPTLogin(await loginChatGPT(setBrowserUrl, ctrl.signal));
        return await finish(name);
      }
      if (m === "openrouter-oauth") return await verify(await loginOpenRouter(setBrowserUrl, ctrl.signal));
      if (m === "ant-cli") {
        await loginAnthropicCLI((line) => setOutput((o) => [...o.slice(-4), line]), ctrl.signal);
        return await finish(name);
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError((e as Error).message);
      setStep("method");
    }
  }

  /** Save an API key / endpoint after checking it works. */
  async function verify(key: string) {
    const name = provider!;
    const p = providerInfo(name);
    setStep("verifying");
    setError("");
    try {
      await verifyAndSaveKey(name, { apiKey: key, baseURL });
    } catch (e) {
      setError(friendlyError(e as Error, p.local ? `Is ${p.label.replace(" (local)", "")} running at ${baseURL}?` : undefined));
      return setStep(p.local || (p.keyOptional && !key) ? "url" : method && method !== "key" ? "method" : "key");
    }
    await finish(name);
  }

  /** Credentials are in place: count the models and hand back to the app. */
  async function finish(name: string) {
    setStep("verifying");
    try {
      onDone(name, await countModels(name));
    } catch (e) {
      setError(friendlyError(e as Error));
      setStep(providerInfo(name).methods.length > 1 ? "method" : "key");
    }
  }

  useInput((_, key) => key.escape && back(), { isActive: step === "browser" });

  const envKey = info && envKeyName(info);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      {welcome && step === "pick" && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Welcome to megacode!</Text>
          <Text dimColor>Connect a model provider to get started. You can add more later with /login.</Text>
        </Box>
      )}

      {step === "pick" && (
        <>
          <Text bold>Log in to a provider</Text>
          <Box marginTop={1}>
            <Select
              options={PROVIDER_INFO.map((p) => ({
                label: p.label,
                value: p.name,
                hint: p.local ? defaultURL(p.name) : isConfigured(p.name) ? `✔ ${authStatus(p.name)}` : undefined,
              }))}
              onSelect={pick}
              onCancel={onCancel}
            />
          </Box>
          <Text dimColor>Credentials are saved to ~/.megacode/auth.json (readable only by you).</Text>
        </>
      )}

      {info && step === "method" && (
        <>
          <Text bold>{info.label}: how do you want to sign in?</Text>
          {error && <Text color="red">{error}</Text>}
          <Box marginTop={1}>
            <Select
              options={info.methods.map((m) => ({ label: METHOD_LABELS[m][0], value: m, hint: METHOD_LABELS[m][1] || undefined }))}
              onSelect={chooseMethod}
              onCancel={back}
            />
          </Box>
          {envKey && <Text color="yellow">Note: ${envKey} is set and takes precedence over anything saved here.</Text>}
        </>
      )}

      {info && step === "browser" && (
        <>
          <Text bold>{method ? METHOD_LABELS[method][0] : "Sign in"}</Text>
          {method === "ant-cli" ? (
            <Text dimColor>Running `ant auth login`. Finish signing in in your browser.</Text>
          ) : (
            <Text dimColor>Finish signing in in your browser. If it didn't open, visit:</Text>
          )}
          {browserUrl && <Text color="cyan">{browserUrl}</Text>}
          {output.map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
          <Box marginTop={1}>
            <Waiting text="Waiting for sign-in… (esc to cancel)" />
          </Box>
        </>
      )}

      {info && step === "url" && (
        <>
          <Text bold>{info.label}: endpoint URL</Text>
          <Text dimColor>
            {info.local ? `Make sure the server is running. Default: ${info.baseURL}` : "Base URL of the OpenAI-compatible API, e.g. https://host/v1"}
          </Text>
          {error && <Text color="red">{error}</Text>}
          <Box marginTop={1}>
            <TextField
              value={baseURL}
              onChange={setBaseURL}
              placeholder={info.baseURL ?? "https://…/v1"}
              onSubmit={(v) => {
                const url = v || info.baseURL || "";
                if (!url) return setError("An endpoint URL is required.");
                setBaseURL(url);
                if (info.local) verify("");
                else setStep("key");
              }}
              onCancel={back}
            />
          </Box>
        </>
      )}

      {info && step === "key" && (
        <>
          <Text bold>{info.label}: API key</Text>
          {info.keyUrl && <Text dimColor>Create one at {info.keyUrl}</Text>}
          {info.keyOptional && <Text dimColor>Leave empty if the endpoint doesn't need a key.</Text>}
          {envKey && <Text color="yellow">Note: ${envKey} is set and takes precedence over a saved key.</Text>}
          {error && <Text color="red">{error}</Text>}
          <Box marginTop={1}>
            <TextField
              value={apiKey}
              onChange={setApiKey}
              mask
              placeholder="paste your key and press enter"
              onSubmit={(v) => (v || info.keyOptional ? verify(v) : setError("Paste a key, or esc to go back."))}
              onCancel={back}
            />
          </Box>
        </>
      )}

      {info && step === "verifying" && <Waiting text={`Connecting to ${info.label}…`} />}

      {(step === "url" || step === "key") && <Text dimColor>enter to continue · esc to go back</Text>}
    </Box>
  );
}

/** /logout: pick which saved credentials to remove. */
export function LogoutDialog({ onSelect, onCancel }: { onSelect: (provider: string) => void; onCancel: () => void }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text bold>Remove saved credentials</Text>
      <Box marginTop={1}>
        <Select
          options={savedProviders().map((n) => ({ label: providerInfo(n).label, value: n, hint: authStatus(n) }))}
          onSelect={onSelect}
          onCancel={onCancel}
        />
      </Box>
    </Box>
  );
}

const stepFor = (name: string): Step => {
  const methods = providerInfo(name).methods;
  return methods.length > 1 ? "method" : methods[0] === "url" ? "url" : "key";
};

const defaultURL = (name: string) => savedCredentials(name)?.baseURL ?? providerInfo(name).baseURL ?? "";

function friendlyError(e: Error & { status?: number }, localHint?: string): string {
  if (e.status === 401 || e.status === 403 || /api key|unauthori[sz]ed|invalid.*key/i.test(e.message))
    return "Those credentials were rejected. Check them and try again.";
  if (/ECONNREFUSED|fetch failed|Connection error|Timed out/i.test(e.message))
    return `Couldn't connect. ${localHint ?? "Check the URL and your network."}`;
  return e.message.split("\n")[0]!;
}
