import type {
  AgentStatus,
  AppleAdsConnectionResponse,
  AppStoreLocale,
  AppStorePlatform,
  AppStoreConnectAccount,
  AppSummary,
  OpenAiConnectionResponse,
} from "@asc-studio/contracts";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api.js";
import { AnalyticsWorkspace } from "./components/AnalyticsWorkspace.js";
import { AppleAccountDialog } from "./components/AppleAccountDialog.js";
import { AppleAdsWorkspace } from "./components/AppleAdsWorkspace.js";
import { ConnectionsDialog } from "./components/ConnectionsDialog.js";
import { ConnectionSetup } from "./components/ConnectionSetup.js";
import { OverviewWorkspace } from "./components/OverviewWorkspace.js";
import { ReleaseWorkspace } from "./components/ReleaseWorkspace.js";
import { ReviewsWorkspace } from "./components/ReviewsWorkspace.js";
import { Sidebar, type WorkspaceSection } from "./components/Sidebar.js";
import {
  readStoreListingDraftSummary,
  StoreListingWorkspace,
  type StoreListingDraftSummary,
  type StoreListingScreenshotSummary,
  type StoreListingTarget,
} from "./components/StoreListingWorkspace.js";
import { TestFlightWorkspace } from "./components/TestFlightWorkspace.js";

const initialAppLimit = 25;
const workspaceSections: WorkspaceSection[] = ["overview", "analytics", "testflight", "releases", "store-listing", "apple-ads", "reviews"];
const initialWorkspaceSection = () => {
  const value = new URLSearchParams(window.location.search).get("section");
  return workspaceSections.includes(value as WorkspaceSection) ? value as WorkspaceSection : "releases";
};
const storeListingPlatforms = new Set<AppStorePlatform>(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]);
const storeListingFields = new Set<NonNullable<StoreListingTarget["field"]>>([
  "description",
  "promotionalText",
  "keywords",
  "marketingUrl",
  "supportUrl",
  "screenshots",
]);
const storeTargetFromLocation = (): StoreListingTarget | null => {
  const parameters = new URLSearchParams(window.location.search);
  const versionId = parameters.get("listingVersion") ?? undefined;
  const platformValue = parameters.get("listingPlatform") as AppStorePlatform | null;
  const locale = parameters.get("listingLocale") as AppStoreLocale | null;
  const fieldValue = parameters.get("listingField") as StoreListingTarget["field"] | null;
  const target: StoreListingTarget = {
    ...(versionId ? { versionId } : {}),
    ...(platformValue && storeListingPlatforms.has(platformValue) ? { platform: platformValue } : {}),
    ...(locale ? { locale } : {}),
    ...(fieldValue && storeListingFields.has(fieldValue) ? { field: fieldValue } : {}),
  };
  return Object.keys(target).length ? target : null;
};
const locationPath = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
type AppleCredentialScope = "app-store-connect" | "apple-ads";
interface ShellFailure {
  message: string;
  code: string | null;
  credentialScope: AppleCredentialScope | null;
}

const recoverableCredentialCodes = new Set([
  "credential_store_damaged",
  "credential_store_conflict",
  "keychain_rollback_failed",
]);

const unavailableAppleAdsConnection = (
  mode: AgentStatus["mode"],
  detail: string,
): AppleAdsConnectionResponse => ({
  status: {
    mode,
    configured: false,
    connected: false,
    provider: mode === "demo" ? "demo" : "apple-ads-platform-api",
    adAccountId: null,
    detail,
  },
  connection: {
    configured: false,
    profileName: null,
    appStoreConnectConnectionId: null,
    adAccountId: null,
    keyId: null,
    source: null,
  },
});

export const App = () => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [portfolioAppsReady, setPortfolioAppsReady] = useState(false);
  const [portfolioAppsError, setPortfolioAppsError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AppStoreConnectAccount[]>([]);
  const [appleAdsConnection, setAppleAdsConnection] = useState<AppleAdsConnectionResponse | null>(null);
  const [appleAdsFailure, setAppleAdsFailure] = useState<ShellFailure | null>(null);
  const [openAiConnection, setOpenAiConnection] = useState<OpenAiConnectionResponse | null>(null);
  const [openAiConnectionLoading, setOpenAiConnectionLoading] = useState(true);
  const [openAiConnectionError, setOpenAiConnectionError] = useState<string | null>(null);
  const [openAiConnectionErrorCode, setOpenAiConnectionErrorCode] = useState<string | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [section, setSection] = useState<WorkspaceSection>(initialWorkspaceSection);
  const [testFlightInspectorOpen, setTestFlightInspectorOpen] = useState(false);
  const [metadataKeywordSuggestion, setMetadataKeywordSuggestion] = useState<string | null>(null);
  const [storeNavigationTarget, setStoreNavigationTarget] = useState<StoreListingTarget | null>(storeTargetFromLocation);
  const [storeListingDraftSummary, setStoreListingDraftSummary] = useState<StoreListingDraftSummary>({});
  const [storeListingScreenshotSummary, setStoreListingScreenshotSummary] = useState<StoreListingScreenshotSummary>({});
  const [storeListingScreenshotApplyingSummary, setStoreListingScreenshotApplyingSummary] = useState<StoreListingScreenshotSummary>({});
  const [storeListingSession, setStoreListingSession] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<ShellFailure | null>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [connectionsDialogTarget, setConnectionsDialogTarget] = useState<"general" | "apple-ads" | "openai" | null>(null);
  const loadGeneration = useRef(0);
  const openAiLoadGeneration = useRef(0);
  const acceptedLocation = useRef(locationPath());
  const hasPendingStoreListingScreenshots = Object.values(storeListingScreenshotSummary).some(Boolean);
  const isApplyingStoreListingScreenshots = Object.values(storeListingScreenshotApplyingSummary).some(Boolean);

  const loadOpenAiConnection = useCallback(async () => {
    const generation = ++openAiLoadGeneration.current;
    setOpenAiConnectionLoading(true);
    setOpenAiConnectionError(null);
    setOpenAiConnectionErrorCode(null);
    try {
      const connection = await api.openAiConnection();
      if (generation !== openAiLoadGeneration.current) return;
      setOpenAiConnection(connection);
    } catch (error) {
      if (generation !== openAiLoadGeneration.current) return;
      setOpenAiConnection(null);
      setOpenAiConnectionError(error instanceof Error ? error.message : "ASC Studio could not read the OpenAI connection.");
      setOpenAiConnectionErrorCode(error instanceof ApiError ? error.code : null);
    } finally {
      if (generation === openAiLoadGeneration.current) setOpenAiConnectionLoading(false);
    }
  }, []);

  const openConnections = useCallback((target: "general" | "apple-ads" | "openai" = "general") => {
    setConnectionsDialogTarget(target);
    void loadOpenAiConnection();
  }, [loadOpenAiConnection]);

  const confirmScreenshotDeparture = useCallback((message = "Discard the staged screenshot changes and leave Store Listing? Uploaded staging files will be removed.") => {
    if (section !== "store-listing") return true;
    if (isApplyingStoreListingScreenshots) {
      window.alert("Screenshot changes are being applied. Stay in Store Listing until App Store Connect confirms the update.");
      return false;
    }
    if (!hasPendingStoreListingScreenshots) return true;
    return window.confirm(message);
  }, [hasPendingStoreListingScreenshots, isApplyingStoreListingScreenshots, section]);

  const discardScreenshotSession = useCallback(() => {
    setStoreListingScreenshotSummary({});
    setStoreListingScreenshotApplyingSummary({});
    setStoreListingSession((current) => current + 1);
  }, []);

  const openAccountSetup = useCallback(() => {
    if (!confirmScreenshotDeparture("Account setup can reload Store Listing and discard staged screenshot changes. Continue to account setup?")) return false;
    setAccountDialogOpen(true);
    return true;
  }, [confirmScreenshotDeparture]);

  const navigate = useCallback((nextSection: WorkspaceSection) => {
    if (nextSection !== "store-listing" && !confirmScreenshotDeparture()) return;
    if (nextSection !== "store-listing" && hasPendingStoreListingScreenshots) discardScreenshotSession();
    setSection(nextSection);
    if (nextSection === "store-listing") setStoreNavigationTarget(null);
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("section", nextSection);
    for (const key of ["listingVersion", "listingPlatform", "listingLocale", "listingField"]) parameters.delete(key);
    const nextLocation = `${window.location.pathname}?${parameters}${window.location.hash}`;
    window.history.pushState(window.history.state, "", nextLocation);
    acceptedLocation.current = nextLocation;
  }, [confirmScreenshotDeparture, discardScreenshotSession, hasPendingStoreListingScreenshots]);

  const navigateStoreWorkflow = useCallback((nextSection: "store-listing" | "releases", target: StoreListingTarget) => {
    if (nextSection === "releases" && !confirmScreenshotDeparture()) return;
    if (nextSection === "releases" && hasPendingStoreListingScreenshots) discardScreenshotSession();
    setStoreNavigationTarget(target);
    setSection(nextSection);
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("section", nextSection);
    for (const key of ["listingVersion", "listingPlatform", "listingLocale", "listingField"]) parameters.delete(key);
    if (target.versionId) parameters.set("listingVersion", target.versionId);
    if (target.platform) parameters.set("listingPlatform", target.platform);
    if (target.locale) parameters.set("listingLocale", target.locale);
    if (target.field) parameters.set("listingField", target.field);
    const nextLocation = `${window.location.pathname}?${parameters}${window.location.hash}`;
    window.history.pushState(window.history.state, "", nextLocation);
    acceptedLocation.current = nextLocation;
  }, [confirmScreenshotDeparture, discardScreenshotSession, hasPendingStoreListingScreenshots]);

  const openAnalyticsForApp = useCallback((appId: string) => {
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("section", "analytics");
    parameters.set("analyticsApp", appId);
    parameters.set("range", "30d");
    parameters.set("compare", "PREVIOUS_PERIOD");
    parameters.set("metric", "DOWNLOADS");
    parameters.set("breakdown", "TERRITORY");
    ["analyticsTerritory", "analyticsSource", "analyticsProductPage", "analyticsVersion"]
      .forEach((parameter) => parameters.delete(parameter));
    window.history.pushState(window.history.state, "", `${window.location.pathname}?${parameters}${window.location.hash}`);
    acceptedLocation.current = locationPath();
    setSelectedAppId(appId);
    setSection("analytics");
  }, []);

  useEffect(() => {
    const restoreLocation = () => {
      if (!confirmScreenshotDeparture()) {
        window.history.pushState(window.history.state, "", acceptedLocation.current);
        return;
      }
      if (hasPendingStoreListingScreenshots) discardScreenshotSession();
      setSection(initialWorkspaceSection());
      setStoreNavigationTarget(storeTargetFromLocation());
      acceptedLocation.current = locationPath();
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [confirmScreenshotDeparture, discardScreenshotSession, hasPendingStoreListingScreenshots]);

  const loadShell = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setPortfolioAppsReady(false);
    setPortfolioAppsError(null);
    try {
      const [nextStatus, accountsResponse] = await Promise.all([
        api.status(),
        api.appleAccounts(),
      ]);
      let adsConnectionResponse: AppleAdsConnectionResponse;
      let nextAppleAdsFailure: ShellFailure | null = null;
      try {
        adsConnectionResponse = await api.appleAdsConnection();
      } catch (adsError) {
        const code = adsError instanceof ApiError ? adsError.code : null;
        const message = adsError instanceof Error ? adsError.message : "Apple Ads connection status is unavailable.";
        adsConnectionResponse = unavailableAppleAdsConnection(nextStatus.mode, message);
        nextAppleAdsFailure = {
          message,
          code,
          credentialScope: code && recoverableCredentialCodes.has(code) ? "apple-ads" : null,
        };
      }
      if (generation !== loadGeneration.current) return;
      setStatus(nextStatus);
      setAppleAdsConnection(adsConnectionResponse);
      setAppleAdsFailure(nextAppleAdsFailure);
      const nextAccounts = nextStatus.mode === "live" ? accountsResponse.accounts : [];
      setAccounts(nextAccounts);
      if (nextStatus.mode === "live" && !nextStatus.connected) {
        setApps([]);
        setSelectedAppId(null);
        setFatalError(null);
        return;
      }
      const appResponse = await api.apps({ limit: initialAppLimit, paginate: false });
      if (generation !== loadGeneration.current) return;
      if (appResponse.apps.length === 0) throw new Error("The active App Store Connect connection does not contain any apps.");
      setApps(appResponse.apps);
      setSelectedAppId((current) => current && appResponse.apps.some((app) => app.id === current)
        ? current
        : appResponse.apps[0]!.id);
      setFatalError(null);
      void api.apps({ paginate: true })
        .then((historyResponse) => {
          if (generation !== loadGeneration.current) return;
          setApps(historyResponse.apps);
          setSelectedAppId((current) => current && historyResponse.apps.some((app) => app.id === current)
            ? current
            : historyResponse.apps[0]?.id ?? null);
          setPortfolioAppsReady(true);
        })
        .catch((portfolioError) => {
          if (generation !== loadGeneration.current) return;
          setPortfolioAppsReady(false);
          setPortfolioAppsError(portfolioError instanceof Error
            ? portfolioError.message
            : "The complete app portfolio could not be loaded.");
        });
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      const code = error instanceof ApiError ? error.code : null;
      setFatalError({
        message: error instanceof Error ? error.message : "ASC Studio could not load the workspace.",
        code,
        credentialScope: code && recoverableCredentialCodes.has(code)
          ? "app-store-connect"
          : null,
      });
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  const retryPortfolioApps = useCallback(async () => {
    const generation = loadGeneration.current;
    setPortfolioAppsError(null);
    try {
      const response = await api.apps({ paginate: true });
      if (generation !== loadGeneration.current) return;
      setApps(response.apps);
      setSelectedAppId((current) => current && response.apps.some((candidate) => candidate.id === current)
        ? current
        : response.apps[0]?.id ?? null);
      setPortfolioAppsReady(true);
    } catch (portfolioError) {
      if (generation !== loadGeneration.current) return;
      setPortfolioAppsError(portfolioError instanceof Error
        ? portfolioError.message
        : "The complete app portfolio could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  useEffect(() => {
    void loadOpenAiConnection();
  }, [loadOpenAiConnection]);

  const app = apps.find((candidate) => candidate.id === selectedAppId) ?? null;

  useEffect(() => {
    setStoreListingDraftSummary(app ? readStoreListingDraftSummary(app.id) : {});
    setStoreListingScreenshotSummary({});
    setStoreListingScreenshotApplyingSummary({});
  }, [app?.id]);

  const changeApp = useCallback((appId: string) => {
    if (!confirmScreenshotDeparture()) return;
    if (hasPendingStoreListingScreenshots) discardScreenshotSession();
    setSelectedAppId(appId);
  }, [confirmScreenshotDeparture, discardScreenshotSession, hasPendingStoreListingScreenshots]);

  const updateScreenshotSummary = useCallback((versionId: string, pending: boolean, applying: boolean) => {
    setStoreListingScreenshotSummary((current) => {
      if (pending && current[versionId]) return current;
      if (!pending && !current[versionId]) return current;
      const next = { ...current };
      if (pending) next[versionId] = true;
      else delete next[versionId];
      return next;
    });
    setStoreListingScreenshotApplyingSummary((current) => {
      if (applying && current[versionId]) return current;
      if (!applying && !current[versionId]) return current;
      const next = { ...current };
      if (applying) next[versionId] = true;
      else delete next[versionId];
      return next;
    });
  }, []);

  const refreshAfterAccountChange = async () => {
    loadGeneration.current += 1;
    discardScreenshotSession();
    setApps([]);
    setSelectedAppId(null);
    setFatalError(null);
    await loadShell();
  };

  const switchAccount = async (connectionId: string) => {
    if (connectionId === status?.connectionId) return;
    if (!confirmScreenshotDeparture()) return;
    loadGeneration.current += 1;
    try {
      await api.activateAppleAccount(connectionId);
      await refreshAfterAccountChange();
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  const removeAccount = async (connectionId: string) => {
    if (!confirmScreenshotDeparture()) return;
    loadGeneration.current += 1;
    try {
      await api.removeAppleAccount(connectionId);
      await refreshAfterAccountChange();
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  const resetDamagedAppleVault = async () => {
    const scope = fatalError?.credentialScope ?? appleAdsFailure?.credentialScope;
    if (!scope) return;
    const resetsAppStoreConnect = scope === "app-store-connect";
    const approved = window.confirm(resetsAppStoreConnect
      ? "Reset every saved App Store Connect and Apple Ads connection? This permanently deletes those Keychain bundles and any matching legacy plaintext credential files in this data directory, then replaces their recovery state with vault-wide reset tombstones. The tombstones prevent stale copied directories from re-importing them until you explicitly reconnect. This cannot be undone here and does not revoke the keys at Apple or erase other backups."
      : "Reset every saved Apple Ads connection? This permanently deletes the Apple Ads Keychain bundle and any matching legacy plaintext credential files in this data directory, then replaces its recovery state with a vault-wide reset tombstone. The tombstone prevents stale copied directories from re-importing it until you explicitly reconnect. App Store Connect accounts are unchanged; this cannot be undone here and does not revoke Apple keys or erase other backups.");
    if (!approved) return;
    loadGeneration.current += 1;
    setLoading(true);
    try {
      if (resetsAppStoreConnect) await api.resetAppleConnectionsVault();
      else await api.resetAppleAdsVault();
      setFatalError(null);
      setAppleAdsFailure(null);
      await loadShell();
    } catch (error) {
      setFatalError({
        message: error instanceof Error ? error.message : "ASC Studio could not reset the credential vault.",
        code: error instanceof ApiError ? error.code : null,
        credentialScope: scope,
      });
      setLoading(false);
    }
  };

  return (
    <div className={section === "apple-ads" || section === "testflight" && testFlightInspectorOpen ? "app-frame with-inspector" : "app-frame"}>
      <Sidebar
        app={app}
        apps={apps}
        accounts={accounts}
        status={status}
        activeSection={section}
        onAppChange={changeApp}
        onNavigate={navigate}
        onAccountChange={switchAccount}
        onAddAccount={() => { openAccountSetup(); }}
        onRemoveAccount={removeAccount}
        appleAdsStatus={appleAdsConnection?.status ?? null}
        onManageConnections={() => openConnections("general")}
      />
      {status?.mode === "live" && !status.connected ? (
        <ConnectionSetup status={status} onConnected={(connectedStatus) => {
          setStatus(connectedStatus);
          void refreshAfterAccountChange();
        }} />
      ) : fatalError || !app || !status || !appleAdsConnection ? (
        <main className="workspace shell-error-workspace">
          <div className="shell-error" role="alert">
            <h1>{loading ? "Loading ASC Studio" : "Could not open ASC Studio"}</h1>
            <p>{loading ? "Reading the local agent and App Store Connect." : fatalError?.message ?? "No app is available."}</p>
            {!loading ? <div className="shell-error-actions">
              <button className="button primary" type="button" onClick={() => void loadShell()}>Try again</button>
              {fatalError?.credentialScope ? <button className="button danger" type="button" onClick={() => void resetDamagedAppleVault()}>
                {fatalError.credentialScope === "app-store-connect" ? "Reset Apple connections" : "Reset Apple Ads connections"}
              </button> : null}
            </div> : null}
          </div>
        </main>
      ) : section === "apple-ads" && appleAdsFailure ? (
        <main className="workspace shell-error-workspace">
          <div className="shell-error" role="alert">
            <h1>Apple Ads is unavailable</h1>
            <p>{appleAdsFailure.message} Other ASC Studio workspaces, including Analytics, remain available.</p>
            <div className="shell-error-actions">
              <button className="button primary" type="button" onClick={() => void loadShell()}>Try again</button>
              {appleAdsFailure.credentialScope ? <button className="button danger" type="button" onClick={() => void resetDamagedAppleVault()}>Reset Apple Ads connections</button> : null}
            </div>
          </div>
        </main>
      ) : section === "overview" ? (
        <OverviewWorkspace
          app={app}
          status={status}
          appleAdsConnection={appleAdsConnection}
          analyticsPortfolioReady={portfolioAppsReady}
          analyticsPortfolioError={portfolioAppsError}
          onNavigate={navigate}
          onOpenAnalytics={() => openAnalyticsForApp(app.id)}
          onRetryAnalyticsPortfolio={retryPortfolioApps}
          onManageAppleServices={() => openConnections("general")}
          key={`overview-${status.connectionId ?? "none"}-${appleAdsConnection.connection.adAccountId ?? "none"}-${app.id}`}
        />
      ) : section === "analytics" && !portfolioAppsReady ? (
        <main className="workspace analytics-workspace analytics-portfolio-gate">
          <header className="topbar analytics-topbar">
            <div><h1>Analytics</h1><p>Portfolio performance and the app-level drivers behind it.</p></div>
          </header>
          <section role={portfolioAppsError ? "alert" : "status"}>
            {portfolioAppsError ? <AlertTriangle size={25} /> : <RefreshCw className="refreshing" size={25} />}
            <div>
              <h2>{portfolioAppsError ? "The complete portfolio is unavailable" : "Loading every app in this portfolio"}</h2>
              <p>{portfolioAppsError
                ? `${portfolioAppsError} Analytics will not present a partial app list as the whole portfolio.`
                : "ASC Studio is following App Store Connect pagination before calculating any all-app totals."}</p>
            </div>
            {portfolioAppsError ? <button className="button secondary" type="button" onClick={() => void retryPortfolioApps()}>Try again</button> : null}
          </section>
        </main>
      ) : section === "analytics" ? (
        <AnalyticsWorkspace
          apps={apps}
          selectedApp={app}
          status={status}
          onAppChange={setSelectedAppId}
          key={`analytics-${status.connectionId ?? "none"}`}
        />
      ) : section === "testflight" ? (
        <TestFlightWorkspace app={app} status={status} onInspectorChange={setTestFlightInspectorOpen} key={`testflight-${status?.connectionId ?? "none"}-${app.id}`} />
      ) : section === "store-listing" ? (
        <StoreListingWorkspace
          app={app}
          status={status}
          target={storeNavigationTarget}
          suggestedKeyword={metadataKeywordSuggestion}
          onSuggestedKeywordUsed={() => setMetadataKeywordSuggestion(null)}
          onOpenRelease={(target) => navigateStoreWorkflow("releases", target)}
          onDraftSummaryChange={setStoreListingDraftSummary}
          onScreenshotPendingChange={updateScreenshotSummary}
          key={`store-listing-${status?.connectionId ?? "none"}-${app.id}-${storeListingSession}`}
        />
      ) : section === "apple-ads" ? (
        <AppleAdsWorkspace app={app} status={status} onManageConnection={() => openConnections("apple-ads")} onUseInMetadata={(keyword) => {
          setMetadataKeywordSuggestion(keyword);
          navigateStoreWorkflow("store-listing", { field: "keywords" });
        }} key={`apple-ads-${status?.connectionId ?? "none"}-${appleAdsConnection?.connection.adAccountId ?? "none"}-${app.id}`} />
      ) : section === "reviews" ? (
        <ReviewsWorkspace
          app={app}
          status={status}
          openAiConnection={openAiConnection?.connection ?? null}
          openAiConnectionLoading={openAiConnectionLoading}
          openAiConnectionError={openAiConnectionError}
          openAiSetupOpen={connectionsDialogTarget === "openai"}
          onReloadOpenAiConnection={loadOpenAiConnection}
          onManageOpenAi={() => openConnections("openai")}
          key={`reviews-${status.connectionId ?? "none"}-${app.id}`}
        />
      ) : (
        <ReleaseWorkspace
          app={app}
          status={status}
          openAiConnection={openAiConnection?.connection ?? null}
          openAiConnectionLoading={openAiConnectionLoading}
          openAiConnectionError={openAiConnectionError}
          openAiSetupOpen={connectionsDialogTarget === "openai"}
          onReloadOpenAiConnection={loadOpenAiConnection}
          onManageOpenAi={() => openConnections("openai")}
          target={storeNavigationTarget}
          storeListingDraftSummary={storeListingDraftSummary}
          storeListingScreenshotSummary={storeListingScreenshotSummary}
          onOpenStoreListing={(target) => navigateStoreWorkflow("store-listing", target)}
          key={`releases-${status?.connectionId ?? "none"}-${app.id}`}
        />
      )}
      {accountDialogOpen ? <AppleAccountDialog onClose={() => setAccountDialogOpen(false)} onConnected={(connectedStatus) => {
        setStatus(connectedStatus);
        setAccountDialogOpen(false);
        void refreshAfterAccountChange();
      }} /> : null}
      {connectionsDialogTarget && status && appleAdsConnection ? <ConnectionsDialog
        status={status}
        account={accounts.find((account) => account.active) ?? null}
        appleAds={appleAdsConnection}
        openAi={openAiConnection}
        openAiLoading={openAiConnectionLoading}
        openAiError={openAiConnectionError}
        openAiErrorCode={openAiConnectionErrorCode}
        initialTarget={connectionsDialogTarget}
        onRetryOpenAi={loadOpenAiConnection}
        onOpenAiChange={(connection) => {
          openAiLoadGeneration.current += 1;
          setOpenAiConnection(connection);
          setOpenAiConnectionError(null);
          setOpenAiConnectionErrorCode(null);
          setOpenAiConnectionLoading(false);
        }}
        onClose={() => setConnectionsDialogTarget(null)}
        onAppleAdsChange={(connection) => setAppleAdsConnection(connection)}
        onManageAppStoreConnect={() => {
          if (openAccountSetup()) setConnectionsDialogTarget(null);
        }}
      /> : null}
    </div>
  );
};
