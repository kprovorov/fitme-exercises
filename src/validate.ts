import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadLibrary } from "./library/load";
import { reportProblems } from "./report";

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
  reportProblems(result.problems);
  process.exitCode = 1;
}
