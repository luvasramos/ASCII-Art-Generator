import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const docs = path.join(root, "docs");

const copyDirectory = async (source, target) => {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      if (entry.isDirectory()) {
        await copyDirectory(sourcePath, targetPath);
        return;
      }
      if (entry.isFile()) {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await copyFile(sourcePath, targetPath);
      }
    })
  );
};

try {
  const distIndex = path.join(dist, "index.html");
  const indexStat = await stat(distIndex);
  if (!indexStat.isFile()) {
    throw new Error("dist/index.html is not a file.");
  }

  await rm(docs, { recursive: true, force: true });
  await copyDirectory(dist, docs);
  console.log("Copied dist to docs for GitHub Pages.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Could not copy dist to docs: ${message}`);
  process.exitCode = 1;
}
