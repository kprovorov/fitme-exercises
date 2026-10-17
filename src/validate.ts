import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadLibrary } from "./library/load";

/**
 * Validates the Exercise Library: `pnpm validate [dir] [--require-lfs-pointers]`
 * (default dir `exercises`). CI passes `--require-lfs-pointers`, since it
 * never downloads LFS content.
 */
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { "require-lfs-pointers": { type: "boolean" } },
});
const root = resolve(
  positionals[0] ?? resolve(import.meta.dirname, "../exercises")
);
const result = await loadLibrary(root, {
  requireLfsPointers: values["require-lfs-pointers"],
});

if (result.ok) {
  const count = result.library.exercises.length;
  console.log(
    `valid: the Exercise Library has ${count} Exercise${count === 1 ? "" : "s"}`
  );
} else {
  const count = result.problems.length;
  console.error(`invalid: ${count} problem${count === 1 ? "" : "s"} found\n`);
  for (const problem of result.problems) {
    console.error(
      `  ${problem.exercise}  ${problem.file}\n    ${problem.message}`
    );
  }
  process.exitCode = 1;
}
