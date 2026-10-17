import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateLibraryModule } from "./build/library-module";

/**
 * Generates src/generated/library.ts, the Exercise Library the API serves,
 * from exercises/ and the Supabase project at SUPABASE_URL. Runs before every
 * build and dev server; fails (exit code 1) on an invalid Exercise Library.
 */
const out = resolve(import.meta.dirname, "generated/library.ts");
const result = await generateLibraryModule({
  root: resolve(import.meta.dirname, "../exercises"),
  supabaseUrl: process.env.SUPABASE_URL,
});

if (result.ok) {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, result.source);
  console.log(`generated ${out}`);
} else {
  const count = result.problems.length;
  console.error(
    `can't generate the Exercise Library: ${count} problem${count === 1 ? "" : "s"}\n`
  );
  for (const problem of result.problems) {
    console.error(`  ${problem}`);
  }
  process.exitCode = 1;
}
