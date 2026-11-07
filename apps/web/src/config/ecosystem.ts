export type EcosystemStatus =
  | "published-integration"
  | "official-community-plugin"
  | "partner-hosted-pilot"
  | "upstream-merged-integration"
  | "judging-integration"
  | "ecosystem-pilot"
  | "credential-gated-pilot"
  | "hosted-pilot"
  | "experimental-pilot"
  | "prospective-collaboration"
  | "proposed-integration";

export type EcosystemStatusTone = "shipped" | "pilot" | "experimental" | "prospective";

export interface EcosystemLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface EcosystemPartner {
  id: string;
  name: string;
  featured: boolean;
  status: EcosystemStatus;
  statusLabel: string;
  statusTone: EcosystemStatusTone;
  meta: string;
  description: string;
  logo?: string;
  mark?: string;
  primaryLink: EcosystemLink;
  secondaryLink?: EcosystemLink;
}

export const ECOSYSTEM_PARTNERS: readonly EcosystemPartner[] = [
  {
    id: "pollar",
    name: "Pollar",
    featured: true,
    status: "published-integration",
    statusLabel: "Published SDK Integration",
    statusTone: "shipped",
    meta: "Official docs · Testnet",
    description:
      "A Sub Rosa-maintained adapter connects classic Pollar wallets to ReceiptOnly rounds, with transaction and standalone Soroban authorization-entry signing verified on Stellar testnet.",
    logo: "/pilots/pollar/pollar-logo.png",
    primaryLink: {
      label: "View official listing",
      href: "https://docs.pollar.xyz/docs/guides/community-integrations#sub-rosa-adapter",
      external: true,
    },
    secondaryLink: {
      label: "View npm adapter",
      href: "https://www.npmjs.com/package/@sub-rosa/pollar-adapter/v/0.1.0",
      external: true,
    },
  },
  {
    id: "cosmos-pay",
    name: "Cosmos Pay",
    featured: true,
    status: "official-community-plugin",
    statusLabel: "Official Community Plugin",
    statusTone: "shipped",
    meta: "Private RFQs · ReceiptOnly",
    description:
      "The support-reviewed, signed plugin in Cosmos Pay's official server binds private RFQs to client-verified Sub Rosa outcomes and the selected provider's Stellar payment intent.",
    logo: "/pilots/cosmos-pay/cosmos-pay-logo.png",
    primaryLink: {
      label: "View official plugin",
      href: "https://github.com/CosmosPay/CosmosPay-Community-Server/tree/main/plugins/sub-rosa",
      external: true,
    },
    secondaryLink: {
      label: "View independent source",
      href: "https://github.com/karagozemin/cosmospay-sub-rosa-plugin",
      external: true,
    },
  },
  {
    id: "offer-hub",
    name: "OFFER HUB",
    featured: true,
    status: "partner-hosted-pilot",
    statusLabel: "Partner-Hosted Testnet Pilot",
    statusTone: "pilot",
    meta: "Merged to dev · ReceiptOnly",
    description:
      "Optional sealed freelancer proposals are merged into OFFER HUB's development branch and available in a partner-hosted testnet deployment; this is not a production marketplace launch.",
    logo: "/pilots/offer-hub/offer-hub.jpg",
    primaryLink: {
      label: "Try testnet pilot",
      href: "https://offer-hub-subrosa-plum.vercel.app/app/client/offers/new",
      external: true,
    },
    secondaryLink: {
      label: "View merged PR",
      href: "https://github.com/OFFER-HUB/OFFER-HUB-Frontend/pull/479",
      external: true,
    },
  },
  {
    id: "proofwork",
    name: "Proofwork",
    featured: true,
    status: "upstream-merged-integration",
    statusLabel: "Upstream-Merged Integration",
    statusTone: "shipped",
    meta: "SDK 0.3.2 · Testnet",
    description:
      "Independent, sealed dual-review assessments with synchronized reveal and administrator-controlled final decisions. The optional workflow is merged upstream, but not verified production-live.",
    logo: "/pilots/proofwork/proofwork-logo.png",
    primaryLink: {
      label: "View merged integration",
      href: "https://github.com/CemAyyildiz/Proofwork/pull/1",
      external: true,
    },
    secondaryLink: {
      label: "View implementation",
      href: "https://github.com/CemAyyildiz/Proofwork/commit/50400b108808b8863cec9665152fb98f96199569",
      external: true,
    },
  },
  {
    id: "stelhacks",
    name: "StelHacks",
    featured: true,
    status: "judging-integration",
    statusLabel: "Judging Integration",
    statusTone: "shipped",
    meta: "Hackathon judging · Tlock",
    description:
      "Partner-owned code seals judging payloads to the deadline-derived Drand round so the collection service cannot force an earlier reveal.",
    logo: "/pilots/stelhacks/stelhacks-logo.png",
    primaryLink: {
      label: "View source code",
      href: "https://github.com/emirykl/StelHacks/blob/930efa97a2a1cf15eabbd375f6ee0ea437766e27/frontend/lib/sealed-input.ts#L1-L49",
      external: true,
    },
  },
  {
    id: "trustless-work",
    name: "Trustless Work",
    featured: false,
    status: "ecosystem-pilot",
    statusLabel: "Ecosystem Pilot",
    statusTone: "pilot",
    meta: "ReceiptOnly · Escrow handoff",
    description:
      "Sub Rosa supplies sealed proposal coordination and a verifiable outcome; Trustless Work remains responsible for escrow creation, funding, milestones, and payment execution.",
    logo: "/pilots/trustless-work/trustless-work-logo.webp",
    primaryLink: {
      label: "View ecosystem listing",
      href: "https://www.trustlesswork.com/ecosystem",
      external: true,
    },
    secondaryLink: {
      label: "Open testnet pilot",
      href: "#/pilot/trustless-work",
    },
  },
  {
    id: "acta",
    name: "ACTA",
    featured: false,
    status: "credential-gated-pilot",
    statusLabel: "Credential-Gated Pilot",
    statusTone: "pilot",
    meta: "ACTA Testnet · ReceiptOnly",
    description:
      "The hosted workflow verifies credential status, type, issuer, and holder before an application-level submission gate, then can issue an outcome credential after selection.",
    logo: "/pilots/acta/ACTA.jpg",
    primaryLink: {
      label: "Open credential pilot",
      href: "#/pilot/acta",
    },
    secondaryLink: {
      label: "View ACTA docs",
      href: "https://docs.acta.build/introduction",
      external: true,
    },
  },
  {
    id: "the-signal",
    name: "The Signal",
    featured: false,
    status: "hosted-pilot",
    statusLabel: "Hosted Deal-Flow Pilot",
    statusTone: "pilot",
    meta: "OTC + loans · ReceiptOnly",
    description:
      "A Sub Rosa-hosted standalone workspace demonstrates sealed OTC and loan offers with organizer selection; no production partner integration is claimed.",
    logo: "/pilots/the-signal/the-signal-logo.png",
    primaryLink: {
      label: "Open hosted pilot",
      href: "#/pilot/the-signal",
    },
  },
  {
    id: "openx402",
    name: "OpenX402",
    featured: false,
    status: "experimental-pilot",
    statusLabel: "Experimental Agent Pilot",
    statusTone: "experimental",
    meta: "Fixture discovery · ReceiptOnly",
    description:
      "The workspace proves sealed, resource-bound agent competition with optional real Sub Rosa execution, then stops at a typed payment handoff—no x402 payment is executed.",
    logo: "/pilots/openx402/openx402-logo.jpg",
    primaryLink: {
      label: "Open experimental pilot",
      href: "#/pilot/openx402",
    },
    secondaryLink: {
      label: "View OpenX402",
      href: "https://github.com/openx402",
      external: true,
    },
  },
  {
    id: "kutana",
    name: "Kutana",
    featured: false,
    status: "prospective-collaboration",
    statusLabel: "Prospective Collaboration",
    statusTone: "prospective",
    meta: "Exploratory · No integration",
    description:
      "An exploratory conversation only. A future public-investment workflow may be a better privacy fit than Kutana's existing Trade Secure flow; no pilot or commitment is claimed.",
    mark: "K",
    primaryLink: {
      label: "View Kutana",
      href: "https://kutanapay.com/",
      external: true,
    },
  },
  {
    id: "octarine",
    name: "Octarine",
    featured: false,
    status: "proposed-integration",
    statusLabel: "Proposed Integration",
    statusTone: "prospective",
    meta: "RWA liquidity · Design only",
    description:
      "A proposed sealed liquidity-provider RFQ design. The workflow has been discussed, but no technical integration or operational RFQ exists.",
    logo: "/pilots/octarine/octarine-logo.svg",
    primaryLink: {
      label: "View proposed context",
      href: "https://octarine.finance/",
      external: true,
    },
  },
] as const;

export const FEATURED_ECOSYSTEM_PARTNERS = ECOSYSTEM_PARTNERS.filter(
  (partner) => partner.featured,
);

export const ADDITIONAL_ECOSYSTEM_PARTNERS = ECOSYSTEM_PARTNERS.filter(
  (partner) => !partner.featured,
);
