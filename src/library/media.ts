import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { imageSize } from "image-size";

const POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";
const POINTER_PATTERN =
  /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n$/;
/** Git LFS pointer files are always smaller than this. */
const MAX_POINTER_SIZE = 1024;

export interface MediaFile {
  /** Pixel dimensions, known only when the file's content is present locally. */
  dimensions?: { width: number; height: number };
  /** The detected image format (e.g. `png`, `jpg`), only when content is present. */
  imageType?: string;
  oid: string;
  size: number;
}

export type ReadMediaResult =
  | { ok: true; media: MediaFile }
  | { ok: false; message: string };

/**
 * Reads a media file that is either a Git LFS pointer (LFS content not
 * downloaded, as in CI) or the content itself (LFS content downloaded).
 *
 * The oid always equals the Git LFS object id: from a pointer it is read
 * as-is; from content it is the content's sha256, which is how Git LFS
 * defines the oid.
 */
export const readMedia = async (
  path: string,
  { image }: { image: boolean }
): Promise<ReadMediaResult> => {
  const bytes = await readFile(path);

  if (isPointer(bytes)) {
    const match = POINTER_PATTERN.exec(bytes.toString("utf8"));
    if (!match) {
      return { message: "malformed Git LFS pointer", ok: false };
    }
    return { media: { oid: match[1], size: Number(match[2]) }, ok: true };
  }

  const media: MediaFile = {
    oid: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
  if (image) {
    try {
      const { width, height, type } = imageSize(bytes);
      media.dimensions = { height, width };
      media.imageType = type;
    } catch {
      return { message: "not a readable image", ok: false };
    }
  }
  return { media, ok: true };
};

const isPointer = (bytes: Buffer) =>
  bytes.length < MAX_POINTER_SIZE &&
  bytes.subarray(0, POINTER_PREFIX.length).toString("utf8") === POINTER_PREFIX;
