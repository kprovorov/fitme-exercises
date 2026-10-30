import { loadContent } from "./content";
import type { Media, Problem } from "./types";

/**
 * The `library.json` format version. The bundle is the contract with the
 * monorepo's `apps/library`, whose build validates it against its own
 * schema (`apps/library/src/bundle.ts`): change both together.
 */
export const BUNDLE_VERSION = 1;

export type BundleResult =
  | { ok: true; json: string }
  | { ok: false; problems: Problem[] };

/**
 * No URLs, sizes or paths: both sides derive `<slug>/<oid>.<ext>` (and
 * `covers/<id>/<oid>.<ext>` for a Cover).
 */
const bundleMedia = ({ oid, extension }: Media) => ({ extension, oid });

/**
 * Loads the Library under `root` (its Exercises from `exercises/`, its Covers
 * from `covers/`) and returns it as `library.json` (version 1), or the
 * loaders' problems. Reads only Git LFS pointers: a media file whose content
 * is checked out is a problem, so bundling never reads LFS content.
 */
export const bundleLibrary = async (root: string): Promise<BundleResult> => {
  const result = await loadContent(root, { requireLfsPointers: true });
  if (!result.ok) {
    return result;
  }
  const bundle = {
    covers: result.covers.map((cover) => ({
      id: cover.id,
      image: bundleMedia(cover.image),
      muscle_groups: cover.muscle_groups,
    })),
    exercises: result.exercises.map((exercise) => ({
      locales: exercise.locales,
      muscle_groups: exercise.muscle_groups,
      slug: exercise.slug,
      thumbnail: bundleMedia(exercise.thumbnail),
      video: bundleMedia(exercise.video),
    })),
    version: BUNDLE_VERSION,
  };
  return { json: `${JSON.stringify(bundle, null, 2)}\n`, ok: true };
};
