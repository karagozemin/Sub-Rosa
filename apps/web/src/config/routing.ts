import type { UseCaseId } from "./useCases";
import { USE_CASES } from "./useCases";

export type Page =
  | "landing"
  | "demo"
  | "architecture"
  | "dashboard"
  | "pilotCatalog"
  | "basicPilot"
  | "signalPilot"
  | "trustlessWorkPilot"
  | "offerHubPilot"
  | "actaPilot"
  | "openX402Pilot"
  | "publishedReceipt"
  | "docs";

export interface RouteState {
  page: Page;
  useCase: UseCaseId;
  receiptSlug?: string;
}

export function routeFromHash(source = window.location.hash): RouteState {
  const hash = source.replace(/^#\/?/, "");
  if (!hash || hash === "landing") {
    return { page: "landing", useCase: "auction" };
  }

  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "receipt" && /^[a-z0-9-]+$/.test(parts[1] ?? "")) {
    return { page: "publishedReceipt", useCase: "auction", receiptSlug: parts[1] };
  }
  if (parts[0] === "architecture") {
    return { page: "architecture", useCase: "auction" };
  }
  if (parts[0] === "dashboard") {
    return { page: "dashboard", useCase: "auction" };
  }
  if (parts[0] === "pilot") {
    if (parts[1] === "the-signal") {
      return { page: "signalPilot", useCase: "auction" };
    }
    if (parts[1] === "trustless-work") {
      return { page: "trustlessWorkPilot", useCase: "auction" };
    }
    if (parts[1] === "offer-hub") {
      return { page: "offerHubPilot", useCase: "auction" };
    }
    if (parts[1] === "acta") {
      return { page: "actaPilot", useCase: "auction" };
    }
    if (parts[1] === "openx402") {
      return { page: "openX402Pilot", useCase: "auction" };
    }
    if (parts[1] === "basic" || /^\d+$/.test(parts[1] ?? "")) {
      return { page: "basicPilot", useCase: "auction" };
    }
    return { page: "pilotCatalog", useCase: "auction" };
  }
  if (parts[0] === "docs") {
    return { page: "docs", useCase: "auction" };
  }
  if (parts[0] === "demo" || parts[0] === "app") {
    const maybeCase = parts[1];
    const useCase = USE_CASES.some((item) => item.id === maybeCase)
      ? (maybeCase as UseCaseId)
      : "auction";
    return { page: "demo", useCase };
  }

  return { page: "landing", useCase: "auction" };
}

export function pilotRoundIdFromHash(source = window.location.hash): string {
  const parts = source.replace(/^#\/?/, "").split("/").filter(Boolean);
  return parts[0] === "pilot" && /^\d+$/.test(parts[1] ?? "") ? parts[1] : "";
}

export function hashFor(page: Page, useCase: UseCaseId = "auction"): string {
  if (page === "landing") return "#/landing";
  if (page === "architecture") return "#/architecture";
  if (page === "dashboard") return "#/dashboard";
  if (page === "pilotCatalog") return "#/pilot";
  if (page === "basicPilot") return "#/pilot/basic";
  if (page === "signalPilot") return "#/pilot/the-signal";
  if (page === "trustlessWorkPilot") return "#/pilot/trustless-work";
  if (page === "offerHubPilot") return "#/pilot/offer-hub";
  if (page === "actaPilot") return "#/pilot/acta";
  if (page === "openX402Pilot") return "#/pilot/openx402";
  if (page === "publishedReceipt") return "#/receipt";
  if (page === "docs") return "#/docs";
  return `#/demo/${useCase}`;
}

export function publishedReceiptSlugFromHash(source = window.location.hash): string {
  const parts = source.replace(/^#\/?/, "").split("/").filter(Boolean);
  return parts[0] === "receipt" && /^[a-z0-9-]+$/.test(parts[1] ?? "")
    ? parts[1]!
    : "";
}

export function trustlessWorkPilotRoundIdFromHash(source = window.location.hash): string {
  const parts = source.replace(/^#\/?/, "").split("/").filter(Boolean);
  return parts[0] === "pilot" && parts[1] === "trustless-work" && /^\d+$/.test(parts[2] ?? "")
    ? parts[2]
    : "";
}

export function offerHubPilotRoundIdFromHash(source = window.location.hash): string {
  const parts = source.replace(/^#\/?/, "").split("/").filter(Boolean);
  return parts[0] === "pilot" && parts[1] === "offer-hub" && /^\d+$/.test(parts[2] ?? "")
    ? parts[2]
    : "";
}

export function actaPilotRoundIdFromHash(source = window.location.hash): string {
  const parts = source.replace(/^#\/?/, "").split("/").filter(Boolean);
  return parts[0] === "pilot" && parts[1] === "acta" && /^\d+$/.test(parts[2] ?? "")
    ? parts[2]
    : "";
}

export function openX402PilotRoundIdFromHash(source = window.location.hash): string {
  const parts = source.replace(/^#\/?/, "").split("/").filter(Boolean);
  return parts[0] === "pilot" && parts[1] === "openx402" && /^\d+$/.test(parts[2] ?? "")
    ? parts[2]
    : "";
}
