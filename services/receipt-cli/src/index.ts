#!/usr/bin/env node
// receipt-cli — export a round receipt from RPC or verify a local file.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SubRosaClient, parseReceipt, serializeReceipt, verifyReceipt, redactReceipt, parseReceiptV2, serializeReceiptV2, verifyReceiptV2, type RoundReceipt, type CoreV2Receipt } from "@sub-rosa/sdk";
import { buildJsonOutput } from "./json-output.js";

function usage(): never {
  console.error(`
Usage:
  receipt-cli export <roundId>             Fetch receipt from RPC (uses env config)
  receipt-cli verify <receipt.json>        Verify a local receipt file
  receipt-cli redact <receipt.json> [out]  Redact sensitive fields for public demo

Environment for "export":
  RPC_URL                  Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
  NETWORK_PASSPHRASE       Network passphrase (default: Test SDF Network ; September 2015)
  CONTRACT_ID              Round contract ID (C…)
  RECEIPT_PROTOCOL_VERSION  2 for structured v2/v3 records (default), 1 for legacy
`);
  process.exit(1);
}

async function cmdExport(roundIdStr: string) {
  const roundId = BigInt(roundIdStr);
  const rpcUrl = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const contractId = process.env.CONTRACT_ID;
  if (!contractId) {
    console.error("CONTRACT_ID env var is required for export");
    process.exit(1);
  }

  const client = new SubRosaClient({ rpcUrl, networkPassphrase, contractId });
  const protocol = process.env.RECEIPT_PROTOCOL_VERSION ?? "2";
  if (protocol !== "1" && protocol !== "2") throw new Error("RECEIPT_PROTOCOL_VERSION must be 1 or 2");
  const json = protocol === "1"
    ? serializeReceipt(await client.exportReceipt(roundId))
    : serializeReceiptV2(await client.exportReceiptV2(roundId));
  const filename = `round-${roundId}-receipt.json`;
  writeFileSync(filename, json, "utf-8");
  console.log(`Wrote ${filename}`);
}

async function cmdVerify(path: string, jsonMode: boolean, artifactPath?: string) {
  let rawJson: string;
  try {
    rawJson = readFileSync(path, "utf-8");
  } catch (e) {
    if (jsonMode) {
      console.log(JSON.stringify(buildJsonOutput(null, null, `Cannot read file: ${e}`), null, 2));
    } else {
      console.error(`Cannot read ${path}: ${e}`);
    }
    process.exit(1);
  }

  let receipt: RoundReceipt | CoreV2Receipt;
  try {
    const version = JSON.parse(rawJson)?.version;
    receipt = version === 2 || version === 3 ? parseReceiptV2(rawJson) : parseReceipt(rawJson);
  } catch (e) {
    if (jsonMode) {
      console.log(JSON.stringify(buildJsonOutput(null, null, `Invalid JSON: ${e}`), null, 2));
    } else {
      console.error(`Invalid JSON: ${e}`);
    }
    process.exit(1);
  }

  const result = receipt.version === 2 || receipt.version === 3
    ? verifyReceiptV2(receipt as CoreV2Receipt) : verifyReceipt(receipt as RoundReceipt);
  const artifactChecksum = "artifactChecksum" in receipt ? receipt.artifactChecksum : undefined;

  if (artifactPath) {
    let computedChecksum = "";
    try {
      const data = readFileSync(artifactPath);
      computedChecksum = createHash("sha256").update(data).digest("hex");
    } catch (e: any) {
      const message = `Cannot read artifact file: ${e.message}`;
      result.valid = false;
      result.issues.push({
        severity: "error",
        code: "missing_artifact_file",
        message,
        path: artifactPath,
      });
      if (jsonMode) {
        console.log(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }

    if (!artifactChecksum) {
      const message = "Missing checksum metadata in receipt";
      result.valid = false;
      result.issues.push({
        severity: "error",
        code: "missing_checksum_metadata",
        message,
      });
      if (jsonMode) {
        console.log(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }

    if (artifactChecksum !== computedChecksum) {
      const message = `Checksum mismatch. Expected: ${artifactChecksum}, computed: ${computedChecksum}`;
      result.valid = false;
      result.issues.push({
        severity: "error",
        code: "checksum_mismatch",
        message,
      });
      if (jsonMode) {
        console.log(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  const status = result.valid ? "PASS" : "FAIL";
  console.log(`Verification: ${status}`);
  if (artifactPath && result.valid) {
    console.log("Artifact verification: PASS");
  }
  console.log(`Computed winner: ${result.computedWinner.address ?? "(none)"} = ${result.computedWinner.value ?? "(none)"}`);

  for (const issue of result.issues) {
    const icon = issue.severity === "error" ? "✖" : "⚠";
    const pathStr = issue.path ? ` [${issue.path}]` : "";
    console.log(`  ${icon} [${issue.code}]${pathStr} ${issue.message}`);
  }

  process.exit(result.valid ? 0 : 1);
}

async function cmdRedact(inputPath: string, outputPath?: string) {
  let json: string;
  try {
    json = readFileSync(inputPath, "utf-8");
  } catch (e) {
    console.error(`Cannot read ${inputPath}: ${e}`);
    process.exit(1);
  }

  let receipt;
  try {
    if ([2, 3].includes(JSON.parse(json)?.version)) throw new Error("Structured receipts cannot be redacted without invalidating envelope evidence");
    receipt = parseReceipt(json);
  } catch (e) {
    console.error(`Invalid JSON: ${e}`);
    process.exit(1);
  }

  const redacted = redactReceipt(receipt);
  const out = serializeReceipt(redacted);
  const outPath = outputPath ?? inputPath.replace(/\.json$/, ".redacted.json");
  writeFileSync(outPath, out, "utf-8");
  console.log(`Wrote redacted receipt to ${outPath}`);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) usage();

  switch (cmd) {
    case "export": {
      const arg = process.argv[3];
      if (!arg) usage();
      await cmdExport(arg);
      break;
    }
    case "verify": {
      const args = process.argv.slice(3);
      const jsonMode = args.includes("--json");
      const verifyChecksumIdx = args.indexOf("--verify-artifact-checksum");
      let artifactPath: string | undefined = undefined;
      let filteredArgs = [...args];
      if (verifyChecksumIdx !== -1) {
        const nextArg = args[verifyChecksumIdx + 1];
        if (nextArg && !nextArg.startsWith("--")) {
          artifactPath = nextArg;
          filteredArgs.splice(verifyChecksumIdx, 2);
        } else {
          usage();
        }
      }
      const path = filteredArgs.find((a) => !a.startsWith("--"));
      if (!path) usage();
      await cmdVerify(path, jsonMode, artifactPath);
      break;
    }
    case "redact": {
      const arg = process.argv[3];
      if (!arg) usage();
      await cmdRedact(arg, process.argv[4]);
      break;
    }
    default:
      usage();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
