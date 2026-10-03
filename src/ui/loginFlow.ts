import type { LoginMethod, ProviderInfo } from "../adapters/providers/catalog.ts";

// Navigation rules for the /login dialog, kept apart from rendering so they can be tested.

export type LoginStep = "pick" | "method" | "url" | "key" | "browser" | "verifying";

/** A provider's first step: choose a method when there are several, else go straight to its only one. */
export function firstStep(info: ProviderInfo): LoginStep {
  if (info.methods.length > 1) return "method";
  return info.methods[0] === "url" ? "url" : "key";
}

/**
 * Where esc leads from `step`; "close" ends the dialog. A dialog opened for one provider
 * (e.g. `/login openai`) has no provider list to go back to.
 */
export function stepBack(step: LoginStep, info: ProviderInfo | undefined, openedForProvider: boolean): LoginStep | "close" {
  if (step === "pick" || !info) return "close";
  if (step === "key" && info.keyOptional) return "url";
  if (step === "browser" || (step === "key" && info.methods.length > 1)) return "method";
  return openedForProvider ? "close" : "pick";
}

/** After credentials fail, the step where the likely cause can be fixed. */
export function stepAfterFailure(info: ProviderInfo, method: LoginMethod | undefined, key: string): LoginStep {
  if (info.local || (info.keyOptional && !key)) return "url"; // the endpoint is the likely problem
  if (method && method !== "key") return "method"; // a browser sign-in: try again or pick another way
  return "key";
}

/** An error from verifying credentials, in words that say what to do. */
export function friendlyError(e: Error & { status?: number }, info?: ProviderInfo, baseURL?: string): string {
  if (e.status === 401 || e.status === 403 || /api key|unauthori[sz]ed|invalid.*key/i.test(e.message))
    return "Those credentials were rejected. Check them and try again.";
  if (/ECONNREFUSED|fetch failed|Connection error|Timed out/i.test(e.message)) {
    const hint = info?.local ? `Is ${info.label.replace(" (local)", "")} running at ${baseURL}?` : "Check the URL and your network.";
    return `Couldn't connect. ${hint}`;
  }
  return e.message.split("\n")[0]!;
}
