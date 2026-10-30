import { z } from "zod";
import { muscleGroups } from "./muscle-groups";

const KnownMuscleGroup = z.enum(muscleGroups, {
  error: (issue) =>
    `unknown muscle group ${JSON.stringify(issue.input)} (known: ${muscleGroups.join(", ")})`,
});

/** At least one known muscle group, none repeated. */
const MuscleGroups = z
  .array(KnownMuscleGroup)
  .nonempty()
  .refine((groups) => new Set(groups).size === groups.length, {
    error: "muscle groups must not repeat",
  });

/** `<slug>/metadata.json`: language-independent metadata. */
export const ExerciseMetadata = z.strictObject({
  muscle_groups: MuscleGroups,
});

/** `covers/<id>/metadata.json`: the muscle groups a Cover suits. */
export const CoverMetadata = z.strictObject({
  muscle_groups: MuscleGroups,
});

/** `<slug>/<locale>/metadata.json`: text that is translated. */
export const LocaleMetadata = z.strictObject({
  name: z.string().trim().min(1),
});
