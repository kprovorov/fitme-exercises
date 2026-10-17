import { z } from "zod";
import { MuscleGroup, muscleGroups } from "./muscle-groups";

const KnownMuscleGroup = z.string().refine(
  (value) => MuscleGroup.safeParse(value).success,
  (value) => ({
    message: `unknown muscle group "${value}" (known: ${muscleGroups.join(", ")})`,
  })
);

/** `<slug>/metadata.json`: language-independent metadata. */
export const ExerciseMetadata = z
  .object({
    muscle_groups: z
      .array(KnownMuscleGroup)
      .nonempty()
      .refine((groups) => new Set(groups).size === groups.length, {
        message: "muscle groups must not repeat",
      }),
  })
  .strict();

/** `<slug>/<locale>/metadata.json`: text that is translated. */
export const LocaleMetadata = z
  .object({
    name: z.string().trim().min(1),
  })
  .strict();
