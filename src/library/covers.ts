import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type Folder,
  type FolderResult,
  isMediaName,
  type LoadOptions,
  loadFolders,
  type MediaKind,
  readJson,
  readMediaKind,
  reportUnexpected,
  THUMBNAIL,
} from "./load";
import { CoverMetadata } from "./schema";
import type { Cover, LoadCoversResult, Problem } from "./types";

/**
 * The permanent Cover id: a lowercase uuid. The same rule as `COVER_ID` in
 * the monorepo's `apps/library/src/bundle.ts`.
 */
const COVER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A Cover's photo: an image with an Exercise thumbnail's limits. */
const IMAGE: MediaKind = { ...THUMBNAIL, name: "image" };

const COVER_ENTRIES = new Set(["metadata.json"]);

/**
 * Reads every Cover folder under `root` (`covers/`) and returns either the
 * Covers, sorted by id, or every problem found, each naming the Cover and
 * file. A missing `root` has no Covers. The folder name is the Cover id, so
 * an id can't repeat.
 */
export const loadCovers = async (
  root: string,
  options: LoadOptions = {}
): Promise<LoadCoversResult> => {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ENOENT") {
      return { covers: [], ok: true };
    }
    if (code === "ENOTDIR") {
      return {
        ok: false,
        problems: [
          {
            cover: "",
            file: "",
            message: "covers is a file: Covers go in a covers/ folder",
          },
        ],
      };
    }
    throw error;
  }
  const result = await loadFolders(
    entries,
    (id) => loadCover(root, id, options),
    (name) => ({ cover: name, file: name, message: "not a Cover folder" })
  );
  return result.ok ? { covers: result.items, ok: true } : result;
};

const loadCover = async (
  root: string,
  id: string,
  options: LoadOptions
): Promise<FolderResult<Cover>> => {
  const problems: Problem[] = [];
  const folder: Folder = {
    dir: join(root, id),
    name: id,
    options,
    report: (file, message) =>
      problems.push({
        cover: id,
        file: file ? `${id}/${file}` : id,
        message,
      }),
  };

  if (!COVER_ID.test(id)) {
    folder.report(
      "",
      "invalid Cover id: must be a lowercase uuid, e.g. 3f2b8a4e-6c1d-4e5f-9a7b-1c2d3e4f5a6b"
    );
  }

  const files = (await readdir(folder.dir)).filter(
    (name) => !name.startsWith(".")
  );
  reportUnexpected(
    folder,
    "",
    files.filter(
      (name) => !(COVER_ENTRIES.has(name) || isMediaName(name, IMAGE))
    ),
    "a Cover folder holds only metadata.json and an image"
  );
  const metadata = await readJson(folder, "metadata.json", CoverMetadata);
  const image = await readMediaKind(folder, files, IMAGE);

  if (problems.length > 0 || !(metadata && image)) {
    return { problems };
  }
  return {
    item: { id, image, muscle_groups: metadata.muscle_groups },
    problems,
  };
};
