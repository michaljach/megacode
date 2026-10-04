import { access } from "node:fs/promises";

/** Whether the path exists (following symlinks), without blocking the event loop like `existsSync`. */
export const pathExists = (file: string) => access(file).then(() => true, () => false);
