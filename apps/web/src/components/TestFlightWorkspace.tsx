import type {
  AgentStatus,
  AppSummary,
  AuditEvent,
  BuildGroupMutationPlan,
  BuildSummary,
  TesterGroup,
} from "@asc-studio/contracts";
import { ArrowDown, ChevronDown, RefreshCw, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api.js";
import { ActivityDock } from "./ActivityDock.js";
import { BuildGroupDialog } from "./BuildGroupDialog.js";
import { BuildInspector } from "./BuildInspector.js";
import { BuildTable } from "./BuildTable.js";
import { UploadDialog } from "./UploadDialog.js";

interface TestFlightWorkspaceProps {
  app: AppSummary;
  status: AgentStatus | null;
  onInspectorChange: (open: boolean) => void;
}

export const TestFlightWorkspace = ({ app, status, onInspectorChange }: TestFlightWorkspaceProps) => {
  const [builds, setBuilds] = useState<BuildSummary[]>([]);
  const [groups, setGroups] = useState<TesterGroup[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("All");
  const [statusFilter, setStatusFilter] = useState("Any status");
  const [newestFirst, setNewestFirst] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [plan, setPlan] = useState<BuildGroupMutationPlan | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = selectedId ? builds.find((build) => build.id === selectedId) ?? null : null;

  useEffect(() => {
    onInspectorChange(Boolean(selected));
  }, [onInspectorChange, selected]);

  useEffect(() => () => onInspectorChange(false), [onInspectorChange]);

  const refreshEvents = useCallback(async () => {
    const response = await api.activity();
    setEvents(response.events);
  }, []);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const [buildResponse, groupResponse] = await Promise.all([api.builds(app.id), api.groups(app.id)]);
      setBuilds(buildResponse.builds);
      setGroups(groupResponse.groups);
      const compactViewport = window.matchMedia("(max-width: 620px)").matches;
      setSelectedId(compactViewport ? null : buildResponse.builds[0]?.id ?? null);
      await refreshEvents();
      setFatalError(null);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "ASC Studio could not load TestFlight.");
    } finally {
      setLoading(false);
    }
  }, [app.id, refreshEvents]);

  useEffect(() => {
    setGroupDialogOpen(false);
    setUploadOpen(false);
    setPlan(null);
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setGroupDialogOpen(false);
        setUploadOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const visibleBuilds = useMemo(() => builds
    .filter((build) => {
      const matchesQuery = !query || `${build.buildNumber} ${build.version}`.toLowerCase().includes(query.toLowerCase());
      const matchesPlatform = platform === "All" || build.platform === (platform === "iOS" ? "IOS" : "MAC_OS");
      const matchesStatus = statusFilter === "Any status" || build.processingStatus === statusFilter;
      return matchesQuery && matchesPlatform && matchesStatus;
    })
    .sort((left, right) => {
      const order = new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime();
      return newestFirst ? order : -order;
    }), [builds, newestFirst, platform, query, statusFilter]);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const response = await api.sync(app.id);
      setBuilds(response.builds);
      await refreshEvents();
      setFatalError(null);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const reviewGroupChange = async (groupId: string) => {
    if (!selected) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      const response = await api.planBuildGroup({ appId: app.id, buildId: selected.id, groupId });
      setPlan(response.plan);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "ASC Studio could not create the change plan.");
    } finally {
      setMutationBusy(false);
    }
  };

  const confirmGroupChange = async () => {
    if (!plan) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await api.confirmPlan(plan);
      const response = await api.builds(app.id);
      setBuilds(response.builds);
      await refreshEvents();
      setGroupDialogOpen(false);
      setPlan(null);
    } catch (error) {
      if (error instanceof ApiError && ["plan_expired", "stale_plan", "plan_not_confirmable"].includes(error.code)) {
        setPlan(null);
      }
      setMutationError(error instanceof Error ? error.message : "The tester-group change failed.");
    } finally {
      setMutationBusy(false);
    }
  };

  return (
    <>
      <main className="workspace">
        <header className="topbar">
          <div><h1>TestFlight</h1><p>Builds, tester access, and review status.</p></div>
          <div className="topbar-actions">
            <button className="button secondary" type="button" onClick={() => void sync()} disabled={syncing} aria-label={syncing ? "Syncing TestFlight builds" : "Sync TestFlight builds"}>
              <RefreshCw size={17} className={syncing ? "spin" : undefined} /><span>{syncing ? "Syncing" : "Sync"}</span>
            </button>
            <button className="button primary" type="button" onClick={() => setUploadOpen(true)} aria-label="Upload build"><Upload size={17} /><span>Upload build</span></button>
          </div>
        </header>

        {status?.mode === "demo" ? <div className="demo-banner"><strong>Demo mode</strong><span>Actions only change isolated sample data.</span></div> : null}
        {fatalError ? <div className="error-banner" role="alert"><span>{fatalError}</span><button type="button" onClick={() => void loadWorkspace()}>Retry</button></div> : null}

        <div className="content-area">
          <div className="toolbar">
            <label className="search-field"><Search size={18} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search builds" /><kbd>⌘K</kbd></label>
            <div className="segmented" aria-label="Platform filter">
              {["All", "iOS", "macOS"].map((item) => <button type="button" className={platform === item ? "active" : ""} onClick={() => setPlatform(item)} key={item}>{item}</button>)}
            </div>
            <label className="select-control"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Any status</option><option>Ready</option><option>Missing compliance</option><option>Expired</option></select><ChevronDown size={16} /></label>
            <button className="sort-control" type="button" onClick={() => setNewestFirst((value) => !value)}>
              {newestFirst ? "Newest first" : "Oldest first"}<ArrowDown className={newestFirst ? undefined : "sort-up"} size={16} />
            </button>
          </div>
          <BuildTable builds={visibleBuilds} selectedId={selected?.id ?? null} onSelect={(build) => setSelectedId(build.id)} loading={loading} />
          <ActivityDock events={events} expanded={activityOpen} onToggle={() => setActivityOpen((value) => !value)} />
        </div>
      </main>

      {selected ? <BuildInspector app={app} build={selected} onClose={() => setSelectedId(null)} onAddGroup={() => {
        setPlan(null);
        setMutationError(null);
        setGroupDialogOpen(true);
      }} /> : null}

      {groupDialogOpen && selected ? <BuildGroupDialog build={selected} groups={groups} plan={plan} busy={mutationBusy} error={mutationError} onReview={(groupId) => void reviewGroupChange(groupId)} onConfirm={() => void confirmGroupChange()} onClose={() => {
        if (mutationBusy) return;
        setGroupDialogOpen(false);
        setPlan(null);
        setMutationError(null);
      }} /> : null}
      {uploadOpen ? <UploadDialog app={app} onClose={() => setUploadOpen(false)} /> : null}
    </>
  );
};
