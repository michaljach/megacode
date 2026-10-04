import { useRef, useState } from "react";
import { countModels, saveChatGPTLogin, verifyAndSaveKey } from "../../../adapters/accounts.ts";
import { loginAnthropicCLI } from "../../../adapters/auth/anthropic.ts";
import { loginChatGPT } from "../../../adapters/auth/chatgpt.ts";
import { loginOpenRouter } from "../../../adapters/auth/openrouter.ts";
import { savedCredentials } from "../../../adapters/auth/store.ts";
import { providerInfo, type LoginMethod } from "../../../adapters/providers/catalog.ts";
import { firstStep, friendlyError, stepAfterFailure, stepBack, type LoginStep } from "./loginFlow.ts";

/** The endpoint to prefill: the saved one, else the provider's default. */
export const defaultURL = (name: string) => savedCredentials(name)?.baseURL ?? providerInfo(name).baseURL ?? "";

/**
 * State and actions behind /login: provider → sign-in method → browser OAuth, API key or endpoint → verify by
 * listing models → save. `onDone` gets the provider and how many models it offers.
 */
export function useLogin({
  initialProvider,
  onDone,
  onCancel,
}: {
  initialProvider?: string;
  onDone: (provider: string, modelCount: number) => void;
  onCancel: () => void;
}) {
  const [provider, setProvider] = useState(initialProvider);
  const [step, setStep] = useState<LoginStep>(initialProvider ? firstStep(providerInfo(initialProvider)) : "pick");
  const [method, setMethod] = useState<LoginMethod>();
  const [baseURL, setBaseURL] = useState(initialProvider ? defaultURL(initialProvider) : "");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [browserUrl, setBrowserUrl] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);

  function pick(name: string) {
    setProvider(name);
    setBaseURL(defaultURL(name));
    setApiKey("");
    setError("");
    setStep(firstStep(providerInfo(name)));
  }

  function back() {
    setError("");
    if (step === "browser") abort.current?.abort();
    const previous = stepBack(step, provider ? providerInfo(provider) : undefined, !!initialProvider);
    if (previous === "close") onCancel();
    else setStep(previous);
  }

  function chooseMethod(m: LoginMethod) {
    setMethod(m);
    setError("");
    if (m === "key" || m === "url") return setStep(m);
    browserLogin(m);
  }

  function submitURL(value: string) {
    const info = providerInfo(provider!);
    const url = value || info.baseURL || "";
    if (!url) return setError("An endpoint URL is required.");
    setBaseURL(url);
    if (info.local) verify("", method, url);
    else setStep("key");
  }

  function submitKey(value: string) {
    if (!value && !providerInfo(provider!).keyOptional) return setError("Paste a key, or esc to go back.");
    verify(value);
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
        return await finish(name, "", m);
      }
      if (m === "openrouter-oauth") return await verify(await loginOpenRouter(setBrowserUrl, ctrl.signal), m);
      if (m === "ant-cli") {
        await loginAnthropicCLI((line) => setOutput((o) => [...o.slice(-4), line]), ctrl.signal);
        return await finish(name, "", m);
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError((e as Error).message);
      setStep("method");
    }
  }

  // `via` and `url` are passed along rather than read from state: they're often set in the same
  // handler that calls these, and the state wouldn't show them yet.

  /** Save an API key / endpoint after checking it works. */
  async function verify(key: string, via = method, url = baseURL) {
    const name = provider!;
    setStep("verifying");
    setError("");
    try {
      await verifyAndSaveKey(name, { apiKey: key, baseURL: url });
    } catch (e) {
      return fail(e as Error, key, via, url);
    }
    await finish(name, key, via);
  }

  /** Credentials are in place: count the models and hand back to the app. */
  async function finish(name: string, key: string, via: LoginMethod | undefined) {
    setStep("verifying");
    try {
      onDone(name, await countModels(name));
    } catch (e) {
      fail(e as Error, key, via);
    }
  }

  function fail(e: Error, key: string, via: LoginMethod | undefined, url = baseURL) {
    const p = providerInfo(provider!);
    setError(friendlyError(e, p, url));
    setStep(stepAfterFailure(p, via, key));
  }

  return {
    step,
    info: provider ? providerInfo(provider) : undefined,
    method,
    baseURL,
    setBaseURL,
    apiKey,
    setApiKey,
    error,
    browserUrl,
    output,
    pick,
    back,
    chooseMethod,
    submitURL,
    submitKey,
  };
}
