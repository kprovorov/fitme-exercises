import { resolve } from "node:path";
import { loadLibrary } from "./library/load";

/** Validates the Exercise Library: `pnpm validate [dir]` (default `exercises`). */
const root = resolve(
  process.argv[2] ?? resolve(import.meta.dirname, "../exercises")
);
const result = await loadLibrary(root);

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
