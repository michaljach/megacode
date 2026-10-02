import { open } from "node:fs/promises";
import type { ImageMediaType } from "../../core/conversation.ts";
import type { Tool } from "../../core/tools.ts";
import { resolvePath } from "./paths.ts";

const MAX_BYTES = 5 * 1024 * 1024;
const TOO_LARGE = "Image exceeds 5 MiB; resize it before viewing.";

const ascii = (data: Buffer, start: number, end: number) => data.toString("ascii", start, end);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Magic-byte signatures. The file extension is never trusted. */
const SIGNATURES: [ImageMediaType, (data: Buffer) => boolean][] = [
  ["image/png", (d) => d.subarray(0, PNG.length).equals(PNG)],
  ["image/jpeg", (d) => d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff],
  ["image/gif", (d) => ["GIF87a", "GIF89a"].includes(ascii(d, 0, 6))],
  ["image/webp", (d) => ascii(d, 0, 4) === "RIFF" && ascii(d, 8, 12) === "WEBP"],
];

export const detectImageType = (data: Buffer): ImageMediaType | undefined =>
  SIGNATURES.find(([, matches]) => matches(data))?.[0];

/**
 * Reads a regular file of at most `maxBytes`. The size is checked before reading and again while
 * reading, since the file can grow in between; it never reads more than `maxBytes + 1`.
 */
async function readBounded(file: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Image path must be a regular file.");
    if (info.size > maxBytes) throw new Error(TOO_LARGE);
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > maxBytes) throw new Error(TOO_LARGE);
    return buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
}

export const viewImage: Tool<{ path: string }> = {
  name: "view_image",
  description: "View a local PNG, JPEG, GIF, or WebP image (up to 5 MiB). Use for screenshots and other visual files; requires a vision-capable model.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Relative or absolute image path" } },
    required: ["path"],
  },
  async run({ path }) {
    const file = resolvePath(path);
    const data = await readBounded(file, MAX_BYTES);
    const mediaType = detectImageType(data);
    if (!mediaType) throw new Error("Unsupported image format. Use PNG, JPEG, GIF, or WebP.");
    return {
      output: `Image: ${file} (${mediaType}, ${data.length} bytes)`,
      isError: false,
      images: [{ mediaType, data: data.toString("base64") }],
    };
  },
};
