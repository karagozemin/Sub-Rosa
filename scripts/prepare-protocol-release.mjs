#!/usr/bin/env node
// Local preparation only. Never uploads, deploys, signs, or changes deployment pins.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
for (const command of ["packages:build", "bindings:check"]) {
  execFileSync("pnpm", [command], { stdio: "inherit" });
}
const wasm = readFileSync("artifacts/sub_rosa_round.wasm");
const sha256 = createHash("sha256").update(wasm).digest("hex");
const directory = "artifacts/reveal-policy-v3";
mkdirSync(directory, { recursive: true });
const artifact = `${directory}/${sha256}.wasm`;
copyFileSync("artifacts/sub_rosa_round.wasm", artifact);
const manifest = {
  protocolVersion: 3,
  lifecycleApiVersion: 2,
  wasm: artifact,
  sha256,
  bytes: wasm.length,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
  preparedAt: new Date().toISOString(),
  bindingsChecked: true,
  deployed: { testnet: false, mainnet: false },
};
writeFileSync(`${directory}/release.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
console.log("Prepared locally; zero transactions sent. Follow docs/REVEAL_POLICY.md before deploying.");
