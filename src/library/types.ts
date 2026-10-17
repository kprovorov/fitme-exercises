import type { MuscleGroup } from "./muscle-groups";

export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];

export interface Media {
  contentType: string;
  extension: string;
  /** The Git LFS object id: the sha256 of the file's content. */
  oid: string;
  /** Path relative to the Exercise Library root, e.g. `bench-press/video.mp4`. */
  path: string;
  /** Size in bytes. */
  size: number;
}

export interface ExerciseText {
  description: string;
  instructions: string;
  name: string;
}

export interface Exercise {
  locales: Record<Locale, ExerciseText>;
  muscle_groups: MuscleGroup[];
  slug: string;
  thumbnail: Media;
  video: Media;
}

export interface ExerciseLibrary {
  /** Sorted by Exercise slug. */
  exercises: Exercise[];
}

export interface Problem {
  /** The Exercise slug (the folder name) the problem belongs to. */
  exercise: string;
  /** Path relative to the Exercise Library root. */
  file: string;
  message: string;
}

export type LoadResult =
  | { ok: true; library: ExerciseLibrary }
  | { ok: false; problems: Problem[] };
