import type { MuscleGroup } from "./muscle-groups";

/** Every Exercise has `en`; the other locales are optional translations. */
export const TRANSLATIONS = ["uk"] as const;

export type Locale = "en" | (typeof TRANSLATIONS)[number];

export interface Media {
  contentType: string;
  extension: string;
  /** The Git LFS object id: the sha256 of the file's content. */
  oid: string;
  /**
   * Path relative to the folder it was loaded from: the Exercises folder
   * (`bench-press/video.mp4`) or the Covers folder (`<id>/image.jpg`).
   */
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
  locales: { en: ExerciseText } & Partial<Record<Locale, ExerciseText>>;
  muscle_groups: MuscleGroup[];
  slug: string;
  thumbnail: Media;
  video: Media;
}

export interface ExerciseLibrary {
  /** Sorted by Exercise slug. */
  exercises: Exercise[];
}

/** A Library photo a Workout's card shows, tagged with the muscle groups it suits. */
export interface Cover {
  /** The permanent Cover id (the folder name): a lowercase uuid. */
  id: string;
  image: Media;
  muscle_groups: MuscleGroup[];
}

/**
 * A problem with an Exercise (named by its Exercise slug) or a Cover (named
 * by its id): the folder name the problem belongs to.
 */
export type Problem = ({ exercise: string } | { cover: string }) & {
  /** Path relative to the Exercises or Covers folder. */
  file: string;
  message: string;
};

export type LoadResult =
  | { ok: true; library: ExerciseLibrary }
  | { ok: false; problems: Problem[] };

export type LoadCoversResult =
  | { ok: true; covers: Cover[] }
  | { ok: false; problems: Problem[] };
