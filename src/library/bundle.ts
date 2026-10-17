import { loadLibrary } from "./load";
import type { Media, Problem } from "./types";

/**
 * The `library.json` format version. The bundle is the contract with the
 * monorepo's `apps/exercises`, whose build validates it against its own
 * schema (`apps/exercises/src/bundle.ts`): change both together.
 */
export const BUNDLE_VERSION = 1;

export type BundleResult =
  | { ok: true; json: string }
  | { ok: false; problems: Problem[] };

/** No URLs, sizes or paths: both sides derive `<slug>/<oid>.<ext>`. */
const bundleMedia = ({ oid, extension }: Media) => ({ extension, oid });

/**
 * Loads the Exercise Library under `root` and returns it as `library.json`
 * (version 1), or the loader's problems. Reads only Git LFS pointers: a media
 * file whose content is checked out is a problem, so bundling never reads LFS
 * content.
 */
export const bundleLibrary = async (root: string): Promise<BundleResult> => {
  const result = await loadLibrary(root, { requireLfsPointers: true });
  if (!result.ok) {
    return result;
  }
  const bundle = {
    exercises: result.library.exercises.map((exercise) => ({
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
