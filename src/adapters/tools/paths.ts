import path from "node:path";

/** Tool paths are relative to the session's working directory. */
export const resolvePath = (p: string) => path.resolve(process.cwd(), p);

/** Short form for titles and messages. */
export const displayPath = (abs: string) => path.relative(process.cwd(), abs);
