import { z } from "zod";

/**
 * The muscle groups an Exercise can use (one or more). Mirrors `muscleGroups`
 * in the monorepo's `@fitme/core`, which is the source of truth: a new muscle
 * group goes there first, since the API rejects a bundle with a muscle group
 * it doesn't know. Then add it here.
 */
export const muscleGroups = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "abs",
  "obliques",
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "traps",
  "lats",
  "lower-back",
  "cardio",
  "full-body",
] as const;

export const MuscleGroup = z.enum(muscleGroups);
export type MuscleGroup = z.infer<typeof MuscleGroup>;
