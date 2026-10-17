import { createHash } from "node:crypto";
import { imageSize } from "image-size";
import sharp from "sharp";
import { checkMp4 } from "./mp4";

const POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";
const POINTER_PATTERN =
  /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n$/;
/** Git LFS pointer files are always smaller than this. */
const MAX_POINTER_SIZE = 1024;

export type MediaFormat = "image" | "mp4";

export interface MediaFile {
  /** Pixel dimensions, known only when an image's content is present locally. */
  dimensions?: { width: number; height: number };
  /** The detected image type (`png`, `jpg`, `webp`, …), only when content is present. */
  imageType?: string;
  oid: string;
  size: number;
}

export type ReadMediaResult =
  | { ok: true; media: MediaFile; pointer: boolean }
  | { ok: false; message: string };

/**
 * Reads a media file that is either a Git LFS pointer (LFS content not
 * downloaded, as in CI) or the content itself (LFS content downloaded).
 *
 * The oid always equals the Git LFS object id: from a pointer it is read
 * as-is; from content it is the content's sha256, which is how Git LFS
 * defines the oid. Content is also checked: an MP4 must be a structurally
 * valid MP4 video; an image must decode, unless its header already puts it
 * over `maxPixels` (then it isn't decoded and the caller reports the size).
 */
export const readMedia = async (
  bytes: Buffer,
  format: MediaFormat,
  maxPixels = Number.POSITIVE_INFINITY
): Promise<ReadMediaResult> => {
  if (isPointer(bytes)) {
    const match = POINTER_PATTERN.exec(bytes.toString("utf8"));
    if (!match) {
      return { message: "malformed Git LFS pointer", ok: false };
    }
    return {
      media: { oid: match[1], size: Number(match[2]) },
      ok: true,
      pointer: true,
    };
  }

  const media: MediaFile = {
    oid: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
  if (format === "mp4") {
    const problem = checkMp4(bytes);
    return problem
      ? { message: problem, ok: false }
      : { media, ok: true, pointer: false };
  }

  try {
    const { width, height, type } = imageSize(bytes);
    media.dimensions = { height, width };
    media.imageType = type;
  } catch {
    return { message: "not a readable image or a Git LFS pointer", ok: false };
  }
  const { width, height } = media.dimensions;
  if (width * height <= maxPixels) {
    try {
      await sharp(bytes, { failOn: "truncated", limitInputPixels: false })
        .raw()
        .toBuffer();
    } catch {
      return {
        message: "image can't be decoded (corrupt or truncated)",
        ok: false,
      };
    }
  }
  return { media, ok: true, pointer: false };
};

const isPointer = (bytes: Buffer) =>
  bytes.length < MAX_POINTER_SIZE &&
  bytes.subarray(0, POINTER_PREFIX.length).toString("utf8") === POINTER_PREFIX;
