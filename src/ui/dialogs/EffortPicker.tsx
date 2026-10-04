import { EFFORTS, type Effort } from "../../core/provider.ts";
import { Dialog } from "../components/Dialog.tsx";
import { Select } from "../components/Select.tsx";

/** /effort without an argument: pick the reasoning effort for future turns. */
export function EffortPicker({ current = "default", onSelect, onCancel }: { current?: Effort; onSelect: (effort: Effort) => void; onCancel: () => void }) {
  return (
    <Dialog title="Model effort" subtitle={current} footer="Saved for future turns · model support varies · esc cancel">
      <Select
        options={EFFORTS.map((effort) => ({ label: effort, value: effort }))}
        initialIndex={Math.max(0, EFFORTS.indexOf(current))}
        onSelect={onSelect}
        onCancel={onCancel}
      />
    </Dialog>
  );
}
