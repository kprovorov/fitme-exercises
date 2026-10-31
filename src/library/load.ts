import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { z } from "zod";
import { type MediaFormat, readMedia } from "./media";
import { ExerciseMetadata, LocaleMetadata } from "./schema";
import {
  type Exercise,
  type ExerciseText,
  type LoadResult,
  type Locale,
  type Media,
  type Problem,
  TRANSLATIONS,
} from "./types";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Cover images live under `covers/` in the bucket, so no Exercise may take it. */
const RESERVED_SLUGS = new Set(["covers"]);

const MB = 1000 * 1000;
const MEGAPIXEL = 1000 * 1000;

export interface MediaKind {
  contentTypes: Record<string, string>;
  format: MediaFormat;
  maxPixels?: number;
  maxSize: number;
  name: "thumbnail" | "video" | "original" | "image";
  required?: boolean;
}

export const THUMBNAIL: MediaKind = {
  contentTypes: { jpg: "image/jpeg", png: "image/png", webp: "image/webp" },
  format: "image",
  maxPixels: 50 * MEGAPIXEL,
  maxSize: 25 * MB,
  name: "thumbnail",
};

const VIDEO: MediaKind = {
  contentTypes: { mp4: "video/mp4" },
  format: "mp4",
  maxSize: 20 * MB,
  name: "video",
};

/** Optional archival source: validated and tracked in LFS, never published. */
const ORIGINAL_VIDEO: MediaKind = {
  ...VIDEO,
  maxSize: 100 * MB,
  name: "original",
  required: false,
};

export interface LoadOptions {
  /**
   * Require every media file to be a Git LFS pointer. Set it where LFS content
   * is never downloaded (CI): a file that isn't a pointer there was committed
   * without Git LFS.
   */
  requireLfsPointers?: boolean;
}

const EXERCISE_ENTRIES = new Set<string>([
  "metadata.json",
  "en",
  ...TRANSLATIONS,
]);
const LOCALE_ENTRIES = new Set([
  "metadata.json",
  "description.md",
  "instructions.md",
]);
const MEDIA_NAMES = new Set(["thumbnail", "video", "original"]);

const stripExtension = (name: string) =>
  name.slice(0, name.length - extname(name).length);

/** Whether `name` is a candidate media file for `kind` (any extension or case). */
export const isMediaName = (name: string, kind: Pick<MediaKind, "name">) =>
  stripExtension(name).toLowerCase() === kind.name;

/** One Exercise or Cover folder being read, and where its problems go. */
export interface Folder {
  dir: string;
  /** The folder's name: the Exercise slug or the Cover id. */
  name: string;
  options: LoadOptions;
  /** Reports a problem with `file` (relative to the folder; "" is the folder itself). */
  report: (file: string, message: string) => void;
}

/** One folder's result: what it loaded, or its problems. */
export interface FolderResult<T> {
  item?: T;
  problems: Problem[];
}

/**
 * Loads each folder in `entries` (dot entries ignored, by name) with `load`,
 * one at a time so media files are read sequentially to bound memory. An
 * entry that isn't a folder (including a symlink) is `notAFolder`'s problem.
 */
export const loadFolders = async <T>(
  entries: Dirent[],
  load: (name: string) => Promise<FolderResult<T>>,
  notAFolder: (name: string) => Problem
): Promise<{ ok: true; items: T[] } | { ok: false; problems: Problem[] }> => {
  const sorted = entries
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  const loaded: FolderResult<T>[] = [];
  for (const entry of sorted) {
    loaded.push(
      entry.isDirectory()
        ? // biome-ignore lint/performance/noAwaitInLoops: bounds memory, see above
          await load(entry.name)
        : { problems: [notAFolder(entry.name)] }
    );
  }
  const problems = loaded.flatMap((result) => result.problems);
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    items: loaded.flatMap((result) => (result.item ? [result.item] : [])),
    ok: true,
  };
};

/**
 * Reads every Exercise folder under `root` and returns either the validated
 * Exercise Library or every problem found, each naming the Exercise and file.
 */
export const loadLibrary = async (
  root: string,
  options: LoadOptions = {}
): Promise<LoadResult> => {
  const result = await loadFolders(
    await readdir(root, { withFileTypes: true }),
    (slug) => loadExercise(root, slug, options),
    (name) => ({
      exercise: name,
      file: name,
      message: "not an Exercise folder",
    })
  );
  return result.ok
    ? { library: { exercises: result.items }, ok: true }
    : result;
};

const loadExercise = async (
  root: string,
  slug: string,
  options: LoadOptions
): Promise<FolderResult<Exercise>> => {
  const problems: Problem[] = [];
  const folder: Folder = {
    dir: join(root, slug),
    name: slug,
    options,
    report: (file, message) =>
      problems.push({
        exercise: slug,
        file: file ? `${slug}/${file}` : slug,
        message,
      }),
  };

  if (!SLUG_PATTERN.test(slug)) {
    folder.report(
      "",
      `invalid Exercise slug: must match ${SLUG_PATTERN.source} (lowercase letters and digits, words joined by single hyphens)`
    );
  }
  if (RESERVED_SLUGS.has(slug)) {
    folder.report(
      "",
      `the Exercise slug "${slug}" is reserved: Cover images use its folder in the media bucket`
    );
  }

  const files = (await readdir(folder.dir)).filter(
    (name) => !name.startsWith(".")
  );
  reportUnexpected(
    folder,
    "",
    files.filter(
      (name) =>
        !(
          EXERCISE_ENTRIES.has(name) ||
          MEDIA_NAMES.has(stripExtension(name).toLowerCase())
        )
    ),
    `an Exercise folder holds only metadata.json, en/, optional translations (${TRANSLATIONS.map((locale) => `${locale}/`).join(", ")}), a thumbnail, a video and an optional original.mp4`
  );
  const metadata = await readJson(folder, "metadata.json", ExerciseMetadata);
  const en = await readLocale(folder, "en");
  const translations: Partial<Record<Locale, ExerciseText>> = {};
  for (const locale of TRANSLATIONS) {
    if (files.includes(locale)) {
      // biome-ignore lint/performance/noAwaitInLoops: keeps problems in order
      const text = await readLocale(folder, locale);
      if (text) {
        translations[locale] = text;
      }
    }
  }
  const thumbnail = await readMediaKind(folder, files, THUMBNAIL);
  const video = await readMediaKind(folder, files, VIDEO);
  await readMediaKind(folder, files, ORIGINAL_VIDEO);

  if (problems.length > 0 || !(metadata && en && thumbnail && video)) {
    return { problems };
  }
  const exercise: Exercise = {
    locales: { en, ...translations },
    muscle_groups: metadata.muscle_groups,
    slug,
    thumbnail,
    video,
  };
  return { item: exercise, problems };
};

/** Reads a file, reporting it as missing (or as a folder) instead of throwing. */
const readFolderFile = async (
  folder: Folder,
  file: string
): Promise<Buffer | undefined> => {
  try {
    if ((await lstat(join(folder.dir, file))).isSymbolicLink()) {
      folder.report(file, "symlinks aren't allowed: commit the file itself");
      return;
    }
    return await readFile(join(folder.dir, file));
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ENOENT") {
      folder.report(file, "missing file");
      return;
    }
    if (code === "ENOTDIR") {
      folder.report(file, "missing file: a folder on its path is a file");
      return;
    }
    if (code === "EISDIR") {
      folder.report(file, "expected a file, found a folder");
      return;
    }
    throw error;
  }
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

const readText = async (folder: Folder, file: string) => {
  const bytes = await readFolderFile(folder, file);
  if (!bytes) {
    return;
  }
  try {
    return utf8.decode(bytes);
  } catch {
    folder.report(file, "not valid UTF-8");
  }
};

export const readJson = async <T extends z.ZodType>(
  folder: Folder,
  file: string,
  schema: T
): Promise<z.infer<T> | undefined> => {
  const text = await readText(folder, file);
  if (text === undefined) {
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    folder.report(file, "invalid JSON");
    return;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const at = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      folder.report(file, `${at}${issue.message}`);
    }
    return;
  }
  return parsed.data;
};

const readLocale = async (
  folder: Folder,
  locale: Locale
): Promise<ExerciseText | undefined> => {
  const stats = await lstat(join(folder.dir, locale)).catch(() => undefined);
  if (stats?.isSymbolicLink()) {
    folder.report(locale, "symlinks aren't allowed: commit the folder itself");
    return;
  }
  if (stats && !stats.isDirectory()) {
    folder.report(locale, "expected a locale folder, found a file");
    return;
  }
  if (stats) {
    reportUnexpected(
      folder,
      locale,
      (await readdir(join(folder.dir, locale))).filter(
        (name) => !(name.startsWith(".") || LOCALE_ENTRIES.has(name))
      ),
      "a locale folder holds only metadata.json, description.md and instructions.md"
    );
  }
  const metadata = await readJson(
    folder,
    `${locale}/metadata.json`,
    LocaleMetadata
  );
  const description = await readMarkdown(folder, `${locale}/description.md`);
  const instructions = await readMarkdown(folder, `${locale}/instructions.md`);
  if (!(metadata && description && instructions)) {
    return;
  }
  return { description, instructions, name: metadata.name };
};

const readMarkdown = async (folder: Folder, file: string) => {
  const text = await readText(folder, file);
  if (text !== undefined && text.trim() === "") {
    folder.report(file, "file is empty");
    return;
  }
  return text;
};

/** Finds the one media file of `kind` in the folder, with an allowed, lowercase name. */
const findMediaFile = (
  folder: Folder,
  files: string[],
  kind: MediaKind
): { file: string; extension: string; contentType: string } | undefined => {
  const allowed = Object.keys(kind.contentTypes);
  const candidates = files.filter((name) => isMediaName(name, kind));

  if (candidates.length === 0) {
    if (kind.required !== false) {
      folder.report(
        `${kind.name}.${allowed.length > 1 ? `{${allowed.join(",")}}` : allowed[0]}`,
        `missing ${kind.name}`
      );
    }
    return;
  }
  if (candidates.length > 1) {
    for (const candidate of candidates) {
      folder.report(candidate, `more than one ${kind.name}`);
    }
    return;
  }

  const [file] = candidates;
  const extension = extname(file).slice(1).toLowerCase();
  const contentType = kind.contentTypes[extension];
  if (!contentType) {
    folder.report(
      file,
      `unsupported media type ".${extension}" for ${kind.name} (allowed: ${allowed.join(", ")})`
    );
    return;
  }
  const expectedName = `${kind.name}.${extension}`;
  if (file !== expectedName) {
    folder.report(
      file,
      `media file names are lowercase: rename to ${expectedName}`
    );
    return;
  }
  return { contentType, extension, file };
};

export const readMediaKind = async (
  folder: Folder,
  files: string[],
  kind: MediaKind
): Promise<Media | undefined> => {
  const found = findMediaFile(folder, files, kind);
  if (!found) {
    return;
  }
  const { file, extension, contentType } = found;

  // Check the size before reading: an oversized file is never a pointer, so
  // it's downloaded content that needn't be loaded into memory.
  const stats = await lstat(join(folder.dir, file));
  if (stats.isFile() && stats.size > kind.maxSize) {
    reportOversized(folder, file, kind, stats.size);
    return;
  }

  const bytes = await readFolderFile(folder, file);
  if (!bytes) {
    return;
  }
  const read = await readMedia(bytes, kind.format, kind.maxPixels);
  if (!read.ok) {
    folder.report(file, read.message);
    return;
  }
  if (folder.options.requireLfsPointers && !read.pointer) {
    folder.report(
      file,
      "not a Git LFS pointer: either it was committed without Git LFS (run `git lfs install`, then remove and re-add the file) or its LFS content is checked out (check out with GIT_LFS_SKIP_SMUDGE=1)"
    );
    return;
  }
  const { oid, size, dimensions, imageType } = read.media;

  let valid = true;
  if (size > kind.maxSize) {
    reportOversized(folder, file, kind, size);
    valid = false;
  }
  if (imageType && imageType !== extension) {
    folder.report(
      file,
      `content is ${imageType} but the extension is .${extension}`
    );
    valid = false;
  }
  if (dimensions && kind.maxPixels !== undefined) {
    const pixels = dimensions.width * dimensions.height;
    if (pixels > kind.maxPixels) {
      folder.report(
        file,
        `${kind.name} is ${dimensions.width}×${dimensions.height} (${formatCount(pixels)} pixels), over the ${kind.maxPixels / MEGAPIXEL} megapixel (${formatCount(kind.maxPixels)} pixels) limit`
      );
      valid = false;
    }
  }
  if (!valid) {
    return;
  }

  return {
    contentType,
    extension,
    oid,
    path: `${folder.name}/${file}`,
    size,
  };
};

export const reportUnexpected = (
  folder: Folder,
  dir: string,
  names: string[],
  rule: string
) => {
  for (const name of names) {
    folder.report(dir ? `${dir}/${name}` : name, `unexpected file: ${rule}`);
  }
};

const reportOversized = (
  folder: Folder,
  file: string,
  kind: MediaKind,
  size: number
) =>
  folder.report(
    file,
    `${kind.name} is ${formatCount(size)} bytes, over the ${kind.maxSize / MB} MB (${formatCount(kind.maxSize)} bytes) limit`
  );

const formatCount = (count: number) => count.toLocaleString("en-US");
