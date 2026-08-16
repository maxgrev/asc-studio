import type { AgentStatus, AppSummary } from "@asc-studio/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { ConnectionSetup } from "./components/ConnectionSetup.js";
import { ReleaseWorkspace } from "./components/ReleaseWorkspace.js";
import { Sidebar, type WorkspaceSection } from "./components/Sidebar.js";
import { TestFlightWorkspace } from "./components/TestFlightWorkspace.js";

const initialAppLimit = 25;

export const App = () => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [section, setSection] = useState<WorkspaceSection>("releases");
  const [testFlightInspectorOpen, setTestFlightInspectorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const loadShell = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await api.status();
      setStatus(nextStatus);
      if (nextStatus.mode === "live" && !nextStatus.connected) {
        setApps([]);
        setSelectedAppId(null);
        setFatalError(null);
        return;
      }
      const appResponse = await api.apps({ limit: initialAppLimit, paginate: false });
      if (appResponse.apps.length === 0) throw new Error("The active App Store Connect connection does not contain any apps.");
      setApps(appResponse.apps);
      setSelectedAppId((current) => current && appResponse.apps.some((app) => app.id === current)
        ? current
        : appResponse.apps[0]!.id);
      setFatalError(null);
      void api.apps()
        .then((historyResponse) => {
          setApps(historyResponse.apps);
          setSelectedAppId((current) => current && historyResponse.apps.some((app) => app.id === current)
            ? current
            : historyResponse.apps[0]?.id ?? null);
        })
        .catch(() => undefined);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "ASC Studio could not load the workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  const app = apps.find((candidate) => candidate.id === selectedAppId) ?? null;

  return (
    <div className={section === "testflight" && testFlightInspectorOpen ? "app-frame with-inspector" : "app-frame"}>
      <Sidebar
        app={app}
        apps={apps}
        status={status}
        activeSection={section}
        onAppChange={setSelectedAppId}
        onNavigate={setSection}
      />
      {status?.mode === "live" && !status.connected ? (
        <ConnectionSetup status={status} onConnected={(connectedStatus) => {
          setStatus(connectedStatus);
          void loadShell();
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
        <TestFlightWorkspace app={app} status={status} onInspectorChange={setTestFlightInspectorOpen} key={`testflight-${app.id}`} />
      ) : (
        <ReleaseWorkspace app={app} status={status} key={`releases-${app.id}`} />
      )}
    </div>
  );
};
