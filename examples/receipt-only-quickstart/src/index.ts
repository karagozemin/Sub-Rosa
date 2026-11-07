import { runReceiptOnlyQuickstart } from "./quickstart.js";

runReceiptOnlyQuickstart().catch((error: unknown) => {
  console.error("RECEIPT_ONLY_QUICKSTART_FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
