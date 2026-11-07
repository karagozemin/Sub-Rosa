export interface PilotWorkspaceLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface PilotWorkspace {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  hosting: string;
  network: string;
  mode: string;
  logo: string;
  href: string;
  className: string;
  statusLabel: string;
  evidenceLink?: PilotWorkspaceLink;
}

export const PILOT_WORKSPACES: readonly PilotWorkspace[] = [
  {
    id: "basic",
    eyebrow: "Core protocol",
    title: "Basic pilot",
    description:
      "Create a compact sealed round, submit and reveal encrypted entries, then inspect and verify the canonical receipt.",
    hosting: "Sub Rosa hosted",
    network: "Stellar Testnet",
    mode: "Auction + ReceiptOnly",
    logo: "/sub-rosa-logo.png",
    href: "#/pilot/basic",
    className: "basic",
    statusLabel: "Testnet workspace",
    evidenceLink: {
      label: "View contract",
      href: "https://stellar.expert/explorer/testnet/contract/CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV",
      external: true,
    },
  },
  {
    id: "the-signal",
    eyebrow: "Confidential deal flow",
    title: "The Signal",
    description:
      "Run a hosted OTC or loan deal room where offers stay sealed until reveal and the organizer makes the application-level selection.",
    hosting: "Sub Rosa hosted pilot",
    network: "Testnet + sample",
    mode: "ReceiptOnly",
    logo: "/pilots/the-signal/the-signal-logo.png",
    href: "#/pilot/the-signal",
    className: "signal",
    statusLabel: "Hosted pilot",
  },
  {
    id: "trustless-work",
    eyebrow: "Escrow handoff",
    title: "Trustless Work",
    description:
      "Select a revealed proposal, then prepare a Trustless Work multi-release escrow while keeping escrow and payment execution in Trustless Work.",
    hosting: "Sub Rosa ecosystem pilot",
    network: "Stellar Testnet",
    mode: "ReceiptOnly",
    logo: "/pilots/trustless-work/trustless-work-logo.webp",
    href: "#/pilot/trustless-work",
    className: "trustless",
    statusLabel: "Testnet pilot",
    evidenceLink: {
      label: "View ecosystem listing",
      href: "https://www.trustlesswork.com/ecosystem",
      external: true,
    },
  },
  {
    id: "offer-hub",
    eyebrow: "Sealed proposals",
    title: "OFFER HUB",
    description:
      "Collect freelancer proposals privately, reveal them together at the deadline, and let the client select a provider outside the protocol.",
    hosting: "Sub Rosa hosted pilot",
    network: "Testnet + sample",
    mode: "ReceiptOnly",
    logo: "/pilots/offer-hub/offer-hub.jpg",
    href: "#/pilot/offer-hub",
    className: "offer-hub",
    statusLabel: "Hosted pilot",
    evidenceLink: {
      label: "Open partner deployment",
      href: "https://offer-hub-subrosa-plum.vercel.app/app/client/offers/new",
      external: true,
    },
  },
  {
    id: "acta",
    eyebrow: "Credential layer",
    title: "ACTA",
    description:
      "Verify holder-bound credential eligibility before a sealed submission, then issue a portable outcome credential after organizer selection.",
    hosting: "Sub Rosa hosted pilot",
    network: "ACTA + Stellar Testnet",
    mode: "ReceiptOnly",
    logo: "/pilots/acta/ACTA.jpg",
    href: "#/pilot/acta",
    className: "acta",
    statusLabel: "Credential pilot",
    evidenceLink: {
      label: "View ACTA docs",
      href: "https://docs.acta.build/introduction",
      external: true,
    },
  },
  {
    id: "openx402",
    eyebrow: "Agent bidding",
    title: "OpenX402",
    description:
      "Compare resource-bound sealed offers after fixture-backed discovery and inspect the typed handoff boundary without executing an x402 payment.",
    hosting: "Sub Rosa experimental pilot",
    network: "Testnet + fixtures",
    mode: "ReceiptOnly",
    logo: "/pilots/openx402/openx402-logo.jpg",
    href: "#/pilot/openx402",
    className: "openx402",
    statusLabel: "Experimental pilot",
    evidenceLink: {
      label: "View OpenX402",
      href: "https://github.com/openx402",
      external: true,
    },
  },
] as const;
