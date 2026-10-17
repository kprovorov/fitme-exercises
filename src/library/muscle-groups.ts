import { z } from "zod";

/** The source of truth for muscle groups. Every Exercise uses one or more. */
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
