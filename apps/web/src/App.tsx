import type { AgentStatus, AppStoreConnectAccount, AppSummary } from "@asc-studio/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { AppleAccountDialog } from "./components/AppleAccountDialog.js";
import { AppleAdsWorkspace } from "./components/AppleAdsWorkspace.js";
import { ConnectionSetup } from "./components/ConnectionSetup.js";
import { ReleaseWorkspace } from "./components/ReleaseWorkspace.js";
import { Sidebar, type WorkspaceSection } from "./components/Sidebar.js";
import { TestFlightWorkspace } from "./components/TestFlightWorkspace.js";

const initialAppLimit = 25;

export const App = () => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [accounts, setAccounts] = useState<AppStoreConnectAccount[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [section, setSection] = useState<WorkspaceSection>("releases");
  const [testFlightInspectorOpen, setTestFlightInspectorOpen] = useState(false);
  const [metadataKeywordSuggestion, setMetadataKeywordSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const loadGeneration = useRef(0);

  const loadShell = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      const [nextStatus, accountsResponse] = await Promise.all([api.status(), api.appleAccounts()]);
      if (generation !== loadGeneration.current) return;
      setStatus(nextStatus);
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
      setFatalError(error instanceof Error ? error.message : "ASC Studio could not load the workspace.");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

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
      />
      {status?.mode === "live" && !status.connected ? (
        <ConnectionSetup status={status} onConnected={(connectedStatus) => {
          setStatus(connectedStatus);
          void refreshAfterAccountChange();
        }} />
      ) : fatalError || !app ? (
        <main className="workspace shell-error-workspace">
          <div className="shell-error" role="alert">
            <h1>{loading ? "Loading ASC Studio" : "Could not open ASC Studio"}</h1>
            <p>{loading ? "Reading the local agent and App Store Connect." : fatalError ?? "No app is available."}</p>
            {!loading ? <button className="button primary" type="button" onClick={() => void loadShell()}>Try again</button> : null}
          </div>
        </main>
      ) : section === "testflight" ? (
        <TestFlightWorkspace app={app} status={status} onInspectorChange={setTestFlightInspectorOpen} key={`testflight-${status?.connectionId ?? "none"}-${app.id}`} />
      ) : section === "apple-ads" ? (
        <AppleAdsWorkspace app={app} status={status} onUseInMetadata={(keyword) => {
          setMetadataKeywordSuggestion(keyword);
          setSection("releases");
        }} key={`apple-ads-${status?.connectionId ?? "none"}-${app.id}`} />
      ) : (
        <ReleaseWorkspace app={app} status={status} suggestedKeyword={metadataKeywordSuggestion} onSuggestedKeywordUsed={() => setMetadataKeywordSuggestion(null)} key={`releases-${status?.connectionId ?? "none"}-${app.id}`} />
      )}
      {accountDialogOpen ? <AppleAccountDialog onClose={() => setAccountDialogOpen(false)} onConnected={(connectedStatus) => {
        setStatus(connectedStatus);
        setAccountDialogOpen(false);
        void refreshAfterAccountChange();
      }} /> : null}
    </div>
  );
};
