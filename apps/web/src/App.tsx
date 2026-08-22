import type {
  AgentStatus,
  AppleAdsConnectionResponse,
  AppStoreConnectAccount,
  AppSummary,
  OpenAiConnectionResponse,
} from "@asc-studio/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api.js";
import { AppleAccountDialog } from "./components/AppleAccountDialog.js";
import { AppleAdsWorkspace } from "./components/AppleAdsWorkspace.js";
import { ConnectionsDialog } from "./components/ConnectionsDialog.js";
import { ConnectionSetup } from "./components/ConnectionSetup.js";
import { OverviewWorkspace } from "./components/OverviewWorkspace.js";
import { ReleaseWorkspace } from "./components/ReleaseWorkspace.js";
import { ReviewsWorkspace } from "./components/ReviewsWorkspace.js";
import { Sidebar, type WorkspaceSection } from "./components/Sidebar.js";
import { TestFlightWorkspace } from "./components/TestFlightWorkspace.js";

const initialAppLimit = 25;
type AppleCredentialScope = "app-store-connect" | "apple-ads";
interface ShellFailure {
  message: string;
  code: string | null;
  credentialScope: AppleCredentialScope | null;
}

export const App = () => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [accounts, setAccounts] = useState<AppStoreConnectAccount[]>([]);
  const [appleAdsConnection, setAppleAdsConnection] = useState<AppleAdsConnectionResponse | null>(null);
  const [openAiConnection, setOpenAiConnection] = useState<OpenAiConnectionResponse | null>(null);
  const [openAiConnectionLoading, setOpenAiConnectionLoading] = useState(true);
  const [openAiConnectionError, setOpenAiConnectionError] = useState<string | null>(null);
  const [openAiConnectionErrorCode, setOpenAiConnectionErrorCode] = useState<string | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [section, setSection] = useState<WorkspaceSection>("releases");
  const [testFlightInspectorOpen, setTestFlightInspectorOpen] = useState(false);
  const [metadataKeywordSuggestion, setMetadataKeywordSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<ShellFailure | null>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [connectionsDialogTarget, setConnectionsDialogTarget] = useState<"general" | "apple-ads" | "openai" | null>(null);
  const loadGeneration = useRef(0);
  const openAiLoadGeneration = useRef(0);

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

  const loadShell = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    let credentialScope: AppleCredentialScope = "app-store-connect";
    try {
      const [nextStatus, accountsResponse] = await Promise.all([
        api.status(),
        api.appleAccounts(),
      ]);
      credentialScope = "apple-ads";
      const adsConnectionResponse = await api.appleAdsConnection();
      if (generation !== loadGeneration.current) return;
      setStatus(nextStatus);
      setAppleAdsConnection(adsConnectionResponse);
      const nextAccounts = nextStatus.mode === "live" ? accountsResponse.accounts : [];
      setAccounts(nextAccounts);
      if (nextStatus.mode === "live" && !nextStatus.connected) {
        setApps([]);
        setSelectedAppId(null);
        setFatalError(null);
        return;
      }
      credentialScope = "app-store-connect";
      const appResponse = await api.apps({ limit: initialAppLimit, paginate: false });
      if (generation !== loadGeneration.current) return;
      if (appResponse.apps.length === 0) throw new Error("The active App Store Connect connection does not contain any apps.");
      setApps(appResponse.apps);
      setSelectedAppId((current) => current && appResponse.apps.some((app) => app.id === current)
        ? current
        : appResponse.apps[0]!.id);
      setFatalError(null);
      void api.apps()
        .then((historyResponse) => {
          if (generation !== loadGeneration.current) return;
          setApps(historyResponse.apps);
          setSelectedAppId((current) => current && historyResponse.apps.some((app) => app.id === current)
            ? current
            : historyResponse.apps[0]?.id ?? null);
        })
        .catch(() => undefined);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      const code = error instanceof ApiError ? error.code : null;
      setFatalError({
        message: error instanceof Error ? error.message : "ASC Studio could not load the workspace.",
        code,
        credentialScope: code === "credential_store_damaged"
          || code === "credential_store_conflict"
          || code === "keychain_rollback_failed"
          ? credentialScope
          : null,
      });
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  useEffect(() => {
    void loadOpenAiConnection();
  }, [loadOpenAiConnection]);

  const app = apps.find((candidate) => candidate.id === selectedAppId) ?? null;

  const refreshAfterAccountChange = async () => {
    loadGeneration.current += 1;
    setApps([]);
    setSelectedAppId(null);
    setFatalError(null);
    await loadShell();
  };

  const switchAccount = async (connectionId: string) => {
    if (connectionId === status?.connectionId) return;
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
    const scope = fatalError?.credentialScope;
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
        onAppChange={setSelectedAppId}
        onNavigate={setSection}
        onAccountChange={switchAccount}
        onAddAccount={() => setAccountDialogOpen(true)}
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
      ) : section === "overview" ? (
        <OverviewWorkspace
          app={app}
          status={status}
          appleAdsConnection={appleAdsConnection}
          onNavigate={setSection}
          onManageAppleServices={() => openConnections("general")}
          key={`overview-${status.connectionId ?? "none"}-${appleAdsConnection.connection.adAccountId ?? "none"}-${app.id}`}
        />
      ) : section === "testflight" ? (
        <TestFlightWorkspace app={app} status={status} onInspectorChange={setTestFlightInspectorOpen} key={`testflight-${status?.connectionId ?? "none"}-${app.id}`} />
      ) : section === "apple-ads" ? (
        <AppleAdsWorkspace app={app} status={status} onManageConnection={() => openConnections("apple-ads")} onUseInMetadata={(keyword) => {
          setMetadataKeywordSuggestion(keyword);
          setSection("releases");
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
          suggestedKeyword={metadataKeywordSuggestion}
          onSuggestedKeywordUsed={() => setMetadataKeywordSuggestion(null)}
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
          setConnectionsDialogTarget(null);
          setAccountDialogOpen(true);
        }}
      /> : null}
    </div>
  );
};
