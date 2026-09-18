import { lazy, Suspense, useEffect, useState } from "react";
import { getUseCase } from "./config/useCases";
import type { UseCaseId } from "./config/useCases";
import { hashFor, routeFromHash, type RouteState } from "./config/routing";
import { LandingPage } from "./pages/LandingPage";
import { SiteFooter } from "./components/SiteFooter";
import { ToastProvider } from "./ui/Toast";

const ArchitecturePage = lazy(() => import("./pages/ArchitecturePage").then((module) => ({ default: module.ArchitecturePage })));
const ConfigBanner = lazy(() => import("./components/ConfigBanner").then((module) => ({ default: module.ConfigBanner })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const DemoPage = lazy(() => import("./pages/DemoPage").then((module) => ({ default: module.DemoPage })));
const DocsPage = lazy(() => import("./pages/DocsPage").then((module) => ({ default: module.DocsPage })));
const PilotCatalogPage = lazy(() => import("./pages/PilotCatalogPage").then((module) => ({ default: module.PilotCatalogPage })));
const PilotPage = lazy(() => import("./pages/PilotPage").then((module) => ({ default: module.PilotPage })));
const SignalPilotPage = lazy(() => import("./pages/SignalPilotPage").then((module) => ({ default: module.SignalPilotPage })));
const TrustlessWorkPilotPage = lazy(() => import("./pages/TrustlessWorkPilotPage").then((module) => ({ default: module.TrustlessWorkPilotPage })));
const OfferHubPilotPage = lazy(() => import("./pages/OfferHubPilotPage").then((module) => ({ default: module.OfferHubPilotPage })));
const ActaPilotPage = lazy(() => import("./pages/ActaPilotPage").then((module) => ({ default: module.ActaPilotPage })));
const OpenX402PilotPage = lazy(() => import("./pages/OpenX402PilotPage").then((module) => ({ default: module.OpenX402PilotPage })));
const PublishedReceiptPage = lazy(() => import("./pages/PublishedReceiptPage").then((module) => ({ default: module.PublishedReceiptPage })));

export default function App() {
  const [route, setRoute] = useState<RouteState>(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(page: RouteState["page"], useCase: UseCaseId = route.useCase) {
    window.location.hash = hashFor(page, useCase);
    setRoute({ page, useCase });
  }

  const active = getUseCase(route.useCase);

  return (
    <ToastProvider>
      <Suspense fallback={<main role="status" aria-live="polite" style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>Loading page…</main>}>
      {route.page === "landing" ? (
        <LandingPage
          onDemo={() => navigate("demo", "auction")}
          onCase={(id) => navigate("demo", id)}
        />
      ) : route.page === "dashboard" ? (
        <DashboardPage goHome={() => navigate("landing")} />
      ) : route.page === "pilotCatalog" ? (
        <PilotCatalogPage goHome={() => navigate("landing")} />
      ) : route.page === "basicPilot" ? (
        <PilotPage goHome={() => navigate("landing")} />
      ) : route.page === "signalPilot" ? (
        <SignalPilotPage goHome={() => navigate("landing")} />
      ) : route.page === "trustlessWorkPilot" ? (
        <TrustlessWorkPilotPage goHome={() => navigate("landing")} />
      ) : route.page === "offerHubPilot" ? (
        <OfferHubPilotPage goHome={() => navigate("landing")} />
      ) : route.page === "actaPilot" ? (
        <ActaPilotPage goHome={() => navigate("landing")} />
      ) : route.page === "openX402Pilot" ? (
        <OpenX402PilotPage goHome={() => navigate("landing")} />
      ) : route.page === "publishedReceipt" ? (
        <PublishedReceiptPage
          slug={route.receiptSlug ?? ""}
          goHome={() => navigate("landing")}
        />
      ) : route.page === "docs" ? (
        <DocsPage goHome={() => navigate("landing")} />
      ) : (
        <>
          <ConfigBanner />
          {route.page === "architecture" ? (
            <ArchitecturePage goHome={() => navigate("landing")} />
          ) : (
            <DemoPage
              active={active}
              setActive={(id) => navigate("demo", id)}
              goHome={() => navigate("landing")}
            />
          )}
        </>
      )}
      </Suspense>
      <SiteFooter />
    </ToastProvider>
  );
}
