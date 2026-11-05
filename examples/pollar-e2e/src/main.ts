import {
  PollarClient,
  WalletType,
  type AuthState,
  type PendingConfirmation,
  type WalletInfo,
} from "@pollar/core";
import {
  PollarAdapterError,
} from "@sub-rosa/pollar-adapter";
import {
  runPollarAuthEntryTestnet,
  runPollarReceiptOnlyTestnet,
  type PollarAuthEntryEvidence,
  type PollarTestnetEvidence,
} from "@sub-rosa/pollar-adapter/testnet";

import "./style.css";

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element #${id}`);
  return element as T;
};

const configStatus = byId<HTMLParagraphElement>("config-status");
const emailInput = byId<HTMLInputElement>("email");
const otpInput = byId<HTMLInputElement>("otp");
const emailLogin = byId<HTMLButtonElement>("email-login");
const verifyOtp = byId<HTMLButtonElement>("verify-otp");
const googleLogin = byId<HTMLButtonElement>("google-login");
const githubLogin = byId<HTMLButtonElement>("github-login");
const freighterLogin = byId<HTMLButtonElement>("freighter-login");
const albedoLogin = byId<HTMLButtonElement>("albedo-login");
const logoutButton = byId<HTMLButtonElement>("logout");
const refreshWalletButton = byId<HTMLButtonElement>("refresh-wallet");
const runButton = byId<HTMLButtonElement>("run-e2e");
const runAuthEntryButton = byId<HTMLButtonElement>("run-auth-entry");
const authStateElement = byId<HTMLElement>("auth-state");
const networkStateElement = byId<HTMLElement>("network-state");
const walletAddress = byId<HTMLElement>("wallet-address");
const walletCustody = byId<HTMLElement>("wallet-custody");
const walletProvisioning = byId<HTMLElement>("wallet-provisioning");
const xlmBalance = byId<HTMLElement>("xlm-balance");
const confirmationCard = byId<HTMLElement>("confirmation-card");
const confirmationsElement = byId<HTMLElement>("confirmations");
const progressStage = byId<HTMLElement>("progress-stage");
const progressMessage = byId<HTMLElement>("progress-message");
const errorPanel = byId<HTMLElement>("error-panel");
const evidenceCard = byId<HTMLElement>("evidence-card");
const evidenceElement = byId<HTMLElement>("evidence");
const downloadEvidence = byId<HTMLButtonElement>("download-evidence");
const authEntryStage = byId<HTMLElement>("auth-entry-stage");
const authEntryMessage = byId<HTMLElement>("auth-entry-message");
const authEntryEvidenceCard = byId<HTMLElement>("auth-entry-evidence-card");
const authEntryEvidenceElement = byId<HTMLElement>("auth-entry-evidence");
const downloadAuthEntryEvidence = byId<HTMLButtonElement>("download-auth-entry-evidence");

const apiKey = import.meta.env.VITE_POLLAR_PUBLISHABLE_KEY?.trim() ?? "";
const baseUrl = import.meta.env.VITE_POLLAR_BASE_URL?.trim() || undefined;
const rpcUrl = import.meta.env.VITE_STELLAR_RPC_URL?.trim() || "https://soroban-testnet.stellar.org";
const configured = Boolean(apiKey) && !apiKey.includes("replace_me") && !apiKey.startsWith("sec_");

let pollar: PollarClient | undefined;
let authState: AuthState = { step: "idle" };
let running = false;
let evidence: PollarTestnetEvidence | undefined;
let authEntryEvidence: PollarAuthEntryEvidence | undefined;

function setText(element: HTMLElement, value: string): void {
  element.textContent = value;
}

function isRunnableWallet(wallet: WalletInfo | null): boolean {
  return Boolean(
    wallet &&
      wallet.custody !== "smart" &&
      wallet.address.startsWith("G") &&
      wallet.existsOnStellar !== false &&
      (wallet.provisioning === undefined || wallet.provisioning === "READY"),
  );
}

function refreshActions(): void {
  const authenticated = authState.step === "authenticated" && authState.verified;
  const wallet = pollar?.getWallet() ?? null;
  runButton.disabled = !configured || !authenticated || !isRunnableWallet(wallet) || running;
  runAuthEntryButton.disabled = !configured || !authenticated || !isRunnableWallet(wallet) || running;
  logoutButton.disabled = !authenticated || running;
  refreshWalletButton.disabled = !authenticated || running;
  emailLogin.disabled = !configured || running;
  googleLogin.disabled = !configured || running;
  githubLogin.disabled = !configured || running;
  freighterLogin.disabled = !configured || running;
  albedoLogin.disabled = !configured || running;
  verifyOtp.disabled = !configured || running || !(
    authState.step === "entering_code" ||
    (authState.step === "error" && Boolean(authState.clientSessionId))
  );
}

async function refreshPublicBalance(wallet: WalletInfo | null): Promise<void> {
  if (!wallet?.address.startsWith("G")) {
    setText(xlmBalance, "—");
    return;
  }
  setText(xlmBalance, "checking…");
  try {
    const response = await fetch(`https://horizon-testnet.stellar.org/accounts/${wallet.address}`);
    if (response.status === 404) {
      setText(xlmBalance, "account not on ledger");
      return;
    }
    if (!response.ok) throw new Error(`Horizon HTTP ${response.status}`);
    const account = await response.json() as {
      balances?: Array<{ asset_type?: string; balance?: string }>;
    };
    const native = account.balances?.find((entry) => entry.asset_type === "native");
    setText(xlmBalance, native?.balance === undefined ? "unavailable" : `${native.balance} XLM`);
  } catch {
    setText(xlmBalance, "lookup unavailable");
  }
}

function renderWallet(): void {
  const wallet = pollar?.getWallet() ?? null;
  setText(walletAddress, wallet?.address ?? "—");
  setText(walletCustody, wallet?.custody ?? "—");
  setText(walletProvisioning, wallet?.provisioning ?? (wallet ? "not reported" : "—"));
  void refreshPublicBalance(wallet);
  refreshActions();
}

function renderAuth(state: AuthState): void {
  authState = state;
  const suffix = state.step === "authenticated" ? (state.verified ? " (verified)" : " (restoring)") : "";
  setText(authStateElement, `${state.step}${suffix}`);
  if (state.step === "error") showError(state, "authentication");
  renderWallet();
}

function renderConfirmations(pending: PendingConfirmation[]): void {
  confirmationCard.hidden = pending.length === 0;
  confirmationsElement.replaceChildren();
  for (const request of pending) {
    const panel = document.createElement("div");
    panel.className = "confirmation";
    const description = document.createElement("p");
    description.textContent = `${request.kind} · ${request.network} · requested ${new Date(request.createdAt).toLocaleTimeString()}`;
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Raw transaction XDR is intentionally hidden. The adapter validates its network, source, body and returned signature.";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.textContent = "Approve signature";
    approve.addEventListener("click", request.confirm, { once: true });
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "ghost";
    reject.textContent = "Reject";
    reject.addEventListener("click", request.reject, { once: true });
    const actions = document.createElement("div");
    actions.className = "button-row";
    actions.append(approve, reject);
    panel.append(description, note, actions);
    confirmationsElement.append(panel);
  }
}

function classifyError(error: unknown): { category: string; code: string; message: string } {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const message = error instanceof Error ? error.message : "Unknown error";
  const adapterCode = error instanceof PollarAdapterError ? error.code : undefined;
  const externalCode = typeof record?.code === "string" ? record.code : undefined;
  const pollarCode = error instanceof PollarAdapterError ? error.pollarCode : undefined;
  const code = pollarCode ?? adapterCode ?? externalCode ?? "UNKNOWN";
  const normalized = `${code} ${message}`.toUpperCase();
  const category =
    /NETWORK|TIMEOUT|RPC|HORIZON|FAILED TO FETCH|LOAD FAILED/.test(normalized) ? "network" :
    /WALLET|ACCOUNT|PROVISION|BALANCE|FUND/.test(normalized) ? "account" :
    /POLICY|ALLOW|FORBIDDEN|OPERATION_NOT_ALLOWED/.test(normalized) ? "policy" :
    /XDR|SIGNER|SIGNATURE|FEE_BUMP|PAYLOAD_MISMATCH/.test(normalized) ? "XDR/signature" :
    /API|AUTH|KEY|401|403/.test(normalized) ? "Pollar API/auth" :
    "lifecycle";
  return { category, code, message };
}

function showError(error: unknown, context: string): void {
  const diagnostic = classifyError(error);
  errorPanel.hidden = false;
  errorPanel.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = `${context}: ${diagnostic.category}`;
  const code = document.createElement("code");
  code.textContent = diagnostic.code;
  const message = document.createElement("p");
  message.textContent = diagnostic.message;
  errorPanel.append(title, code, message);
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  if (record?.rpcResult && typeof record.rpcResult === "object") {
    const raw = document.createElement("pre");
    raw.textContent = JSON.stringify(record.rpcResult, null, 2);
    errorPanel.append(raw);
  }
}

function renderEvidence(result: PollarTestnetEvidence): void {
  evidenceCard.hidden = false;
  evidenceElement.replaceChildren();
  const summary = document.createElement("dl");
  summary.className = "status-grid";
  for (const [label, value] of [
    ["Wallet", result.wallet],
    ["Contract", result.contractId],
    ["Round", result.roundId],
    ["Receipt SHA-256", result.receiptHash],
    ["Receipt verified", String(result.receiptVerified)],
  ]) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    row.append(term, description);
    summary.append(row);
  }
  const list = document.createElement("ol");
  list.className = "transactions";
  for (const transaction of result.transactions) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = transaction.explorerUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${transaction.operation}: ${transaction.hash}`;
    const status = document.createElement("span");
    status.textContent = transaction.status;
    item.append(link, status);
    list.append(item);
  }
  evidenceElement.append(summary, list);
}

function renderAuthEntryEvidence(result: PollarAuthEntryEvidence): void {
  authEntryEvidenceCard.hidden = false;
  authEntryEvidenceElement.replaceChildren();
  const summary = document.createElement("dl");
  summary.className = "status-grid";
  for (const [label, value] of [
    ["Wallet authorizer", result.wallet],
    ["Fee sponsor", result.sponsor],
    ["Contract", result.contractId],
    ["Function", result.function],
    ["Round", result.roundId],
    ["Latest ledger at signing", String(result.latestLedgerAtSigning)],
    ["Valid until ledger", String(result.validUntilLedger)],
    ["Auth nonce", result.authNonce],
    ["Signer verified", String(result.signerVerified)],
    ["Invocation verified", String(result.invocationVerified)],
    ["Envelope signer verified", String(result.envelopeSignerVerified)],
    ["Enforce simulation verified", String(result.enforcedSimulationVerified)],
    ["Transaction sequence", result.transaction.sequence],
    ["Transaction fee", result.transaction.fee],
    ["Submitted at ledger", String(result.transaction.submittedAtLedger)],
  ]) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    row.append(term, description);
    summary.append(row);
  }
  const transaction = document.createElement("p");
  const link = document.createElement("a");
  link.href = result.transaction.explorerUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${result.transaction.hash} · ledger ${result.transaction.ledger}`;
  transaction.append("SUCCESS · ", link);
  authEntryEvidenceElement.append(summary, transaction);
}

function startLogin(provider: "google" | "github"): void {
  errorPanel.hidden = true;
  pollar?.login({ provider });
}

async function initialize(): Promise<void> {
  if (!configured) {
    configStatus.textContent = apiKey.startsWith("sec_")
      ? "Refusing VITE_POLLAR_PUBLISHABLE_KEY: a secret key must never enter the browser."
      : "Missing VITE_POLLAR_PUBLISHABLE_KEY. Copy .env.example to .env.local and add a testnet publishable key.";
    configStatus.classList.add("bad");
    refreshActions();
    return;
  }

  configStatus.textContent = "Publishable key loaded locally. Network is locked to Stellar testnet.";
  configStatus.classList.add("good");
  pollar = new PollarClient({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    stellarNetwork: "testnet",
    confirmation: "prompt",
    deviceLabel: "Sub Rosa local Pollar E2E",
    logLevel: "error",
  });
  pollar.onAuthStateChange(renderAuth);
  pollar.onWalletStateChange(() => renderWallet());
  pollar.onNetworkStateChange((state) => setText(networkStateElement, state.step === "connected" ? state.network : state.step));
  pollar.onConfirmationRequest(renderConfirmations);
  pollar.onTransactionStateChange((state) => {
    if (state) progressMessage.textContent = `${progressMessage.textContent ?? ""} · Pollar tx: ${state.step}`;
  });
  pollar.onStorageDegrade((reason) => {
    showError(new Error(`Persistent browser storage degraded to memory (${reason}); do not reload during the run.`), "storage");
  });
  await pollar.ready();
  renderAuth(pollar.getAuthState());
}

emailLogin.addEventListener("click", () => {
  const email = emailInput.value.trim();
  if (!email) return showError(new Error("Enter your email before requesting an OTP."), "authentication");
  errorPanel.hidden = true;
  pollar?.login({ provider: "email", email });
});
verifyOtp.addEventListener("click", () => {
  const code = otpInput.value.trim();
  if (!code) return showError(new Error("Enter the OTP sent by Pollar."), "authentication");
  errorPanel.hidden = true;
  pollar?.verifyEmailCode(code);
});
googleLogin.addEventListener("click", () => startLogin("google"));
githubLogin.addEventListener("click", () => startLogin("github"));
freighterLogin.addEventListener("click", () => pollar?.login({ provider: WalletType.FREIGHTER }));
albedoLogin.addEventListener("click", () => pollar?.login({ provider: WalletType.ALBEDO }));
logoutButton.addEventListener("click", async () => {
  await pollar?.logout();
  evidence = undefined;
  authEntryEvidence = undefined;
  evidenceCard.hidden = true;
  authEntryEvidenceCard.hidden = true;
});
refreshWalletButton.addEventListener("click", async () => {
  await pollar?.refreshWalletState();
  renderWallet();
});
runButton.addEventListener("click", async () => {
  if (!pollar || running) return;
  running = true;
  evidence = undefined;
  evidenceCard.hidden = true;
  errorPanel.hidden = true;
  refreshActions();
  try {
    evidence = await runPollarReceiptOnlyTestnet(pollar, {
      rpcUrl,
      onProgress: ({ stage, message }) => {
        setText(progressStage, stage);
        setText(progressMessage, message);
      },
    });
    renderEvidence(evidence);
  } catch (error) {
    showError(error, progressStage.textContent || "E2E");
  } finally {
    running = false;
    refreshActions();
  }
});
runAuthEntryButton.addEventListener("click", async () => {
  if (!pollar || running) return;
  running = true;
  authEntryEvidence = undefined;
  authEntryEvidenceCard.hidden = true;
  errorPanel.hidden = true;
  refreshActions();
  try {
    authEntryEvidence = await runPollarAuthEntryTestnet(pollar, {
      rpcUrl,
      onProgress: ({ stage, message }) => {
        setText(authEntryStage, stage);
        setText(authEntryMessage, message);
      },
    });
    renderAuthEntryEvidence(authEntryEvidence);
  } catch (error) {
    showError(error, authEntryStage.textContent || "signAuthEntry");
  } finally {
    running = false;
    refreshActions();
  }
});
downloadEvidence.addEventListener("click", () => {
  if (!evidence) return;
  const blob = new Blob([`${JSON.stringify(evidence, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pollar-sub-rosa-testnet-round-${evidence.roundId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});
downloadAuthEntryEvidence.addEventListener("click", () => {
  if (!authEntryEvidence) return;
  const blob = new Blob([`${JSON.stringify(authEntryEvidence, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pollar-sub-rosa-auth-entry-round-${authEntryEvidence.roundId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

void initialize().catch((error) => showError(error, "initialization"));
