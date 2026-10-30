import { join } from "node:path";
import { loadCovers } from "./covers";
import { type LoadOptions, loadLibrary } from "./load";
import type { Cover, Exercise, Problem } from "./types";

export type LoadContentResult =
  | { ok: true; covers: Cover[]; exercises: Exercise[] }
  | { ok: false; problems: Problem[] };

/**
 * Loads all the Library's content under `root`: its Exercises from
 * `exercises/` and its Covers from `covers/`, or every problem in either.
 */
export const loadContent = async (
  root: string,
  options: LoadOptions = {}
): Promise<LoadContentResult> => {
  const exercises = await loadLibrary(join(root, "exercises"), options);
  const covers = await loadCovers(join(root, "covers"), options);
  if (exercises.ok && covers.ok) {
    return {
      covers: covers.covers,
      exercises: exercises.library.exercises,
      ok: true,
    };
  }
  return {
    ok: false,
    problems: [
      ...(exercises.ok ? [] : exercises.problems),
      ...(covers.ok ? [] : covers.problems),
    ],
  };
};
