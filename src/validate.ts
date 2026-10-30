import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadContent } from "./library/content";
import { reportProblems } from "./report";

/**
 * Validates the Library: `pnpm validate [root] [--require-lfs-pointers]`, its
 * Exercises in `<root>/exercises` and its Covers in `<root>/covers` (default
 * root: the repo). CI passes `--require-lfs-pointers`, since it never
 * downloads LFS content.
 */
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { "require-lfs-pointers": { type: "boolean" } },
});
const root = resolve(positionals[0] ?? resolve(import.meta.dirname, ".."));
if (!existsSync(join(root, "exercises"))) {
  console.error(
    `${root} has no exercises/ folder: pass the Library's root, which holds exercises/ and covers/`
  );
  process.exit(1);
}
const result = await loadContent(root, {
  requireLfsPointers: values["require-lfs-pointers"],
});

if (result.ok) {
  const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;
  console.log(
    `valid: the Library has ${plural(result.exercises.length, "Exercise")} and ${plural(result.covers.length, "Cover")}`
  );
} else {
  reportProblems(result.problems);
  process.exitCode = 1;
}
