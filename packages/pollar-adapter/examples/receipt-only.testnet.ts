/**
 * Node entry point for hosts that already persist a real PollarClient session.
 * The interactive browser runner in examples/pollar-e2e is the recommended way
 * to establish that session. No secret-key or alternate-wallet fallback exists.
 */
import { pathToFileURL } from "node:url";

import { isPollarClient } from "@pollar/core";

import { runPollarReceiptOnlyTestnet } from "../src/testnet-lifecycle.js";

async function main() {
  if (!process.argv.includes("--run")) {
    throw new Error("Pass --run to execute real Pollar-signed Stellar TESTNET transactions");
  }
  const modulePath = process.env.POLLAR_SESSION_MODULE;
  if (!modulePath) {
    throw new Error(
      "POLLAR_SESSION_MODULE is required and must export an authenticated real PollarClient; no fallback signer is allowed",
    );
  }
  const sessionModule = (await import(pathToFileURL(modulePath).href)) as {
    default?: unknown;
    pollar?: unknown;
  };
  const pollar = sessionModule.pollar ?? sessionModule.default;
  if (!isPollarClient(pollar)) {
    throw new Error("POLLAR_SESSION_MODULE did not export a real PollarClient instance");
  }
  const evidence = await runPollarReceiptOnlyTestnet(pollar, {
    onProgress: ({ stage, message }) => console.log(`[${stage}] ${message}`),
  });
  console.log("POLLAR x SUB ROSA TESTNET RECEIPT-ONLY LIFECYCLE PASSED");
  console.log(JSON.stringify(evidence, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("POLLAR x SUB ROSA TESTNET RECEIPT-ONLY LIFECYCLE FAILED");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
