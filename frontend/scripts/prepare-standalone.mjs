import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = resolve(frontendRoot, ".next", "standalone");
const standaloneServer = resolve(standaloneRoot, "server.js");

if (!existsSync(standaloneServer)) {
  throw new Error("Standalone server is missing. Run `npm run build` before preparing production assets.");
}

const assets = [
  [resolve(frontendRoot, ".next", "static"), resolve(standaloneRoot, ".next", "static")],
  [resolve(frontendRoot, "public"), resolve(standaloneRoot, "public")],
];

for (const [source, destination] of assets) {
  if (!existsSync(source)) continue;
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

console.log("Standalone server assets are ready.");
