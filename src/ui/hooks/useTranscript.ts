import { useState } from "react";
import type { NoticeLevel } from "../../core/agent.ts";
import type { Item } from "../transcript/ItemView.tsx";

/**
 * The finished transcript, rendered once into <Static>, starting with `initial` after the banner; `epoch` changes when
 * it's cleared, to remount <Static>.
 */
export function useTranscript(initial: () => Item[]) {
  const [items, setItems] = useState<Item[]>(() => [{ kind: "banner" }, ...initial()]);
  const [epoch, setEpoch] = useState(0);
  const push = (...add: Item[]) => setItems((prev) => [...prev, ...add]);

  return {
    items,
    epoch,
    push,
    notice: (text: string, level: NoticeLevel = "info") => push({ kind: "notice", text, level }),
    /** Prominent, undimmed output, e.g. a report the user asked for. */
    print: (text: string) => push({ kind: "notice", text, level: "info", bright: true }),
    /** Clears the terminal and starts over from the banner. */
    reset() {
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
      setItems([{ kind: "banner" }]);
      setEpoch((e) => e + 1);
    },
  };
}
