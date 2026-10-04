import { savedProviders } from "../../../adapters/auth/store.ts";
import { providerInfo } from "../../../adapters/providers/catalog.ts";
import { authStatus } from "../../../adapters/providers/credentials.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { Select } from "../../components/Select.tsx";

/** /logout: pick which saved credentials to remove. */
export function LogoutDialog({ onSelect, onCancel }: { onSelect: (provider: string) => void; onCancel: () => void }) {
  return (
    <Dialog title="Remove saved credentials" footer="enter remove · esc cancel">
      <Select
        options={savedProviders().map((n) => ({ label: providerInfo(n).label, value: n, hint: authStatus(n) }))}
        onSelect={onSelect}
        onCancel={onCancel}
      />
    </Dialog>
  );
}
