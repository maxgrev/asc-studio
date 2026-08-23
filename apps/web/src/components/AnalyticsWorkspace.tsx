import type {
  AgentStatus,
  AnalyticsBreakdownDimension,
  AnalyticsFacets,
  AnalyticsFilters,
  AnalyticsMetricId,
  AnalyticsOverviewResponse,
  AnalyticsReportAccessType,
  AnalyticsStatusResponse,
  AppSummary,
  CreateAnalyticsReportRequestMutationPlan,
} from "@asc-studio/contracts";
import {
  AlertTriangle,
  AppWindow,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  Info,
  ListFilter,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { api } from "../api.js";
import {
  analyticsChangeTone,
  analyticsDateRange,
  analyticsFilterCount,
  analyticsFiltersFromSearchParams,
  analyticsMetricLabels,
  analyticsQueryKey,
  availabilityLabel,
  chartPoints,
  chartSegments,
  emptyAnalyticsFilters,
  formatAnalyticsChange,
  formatAnalyticsValue,
  formatAnalyticsValueWithAvailability,
  shortDate,
  todayIsoDate,
  writeAnalyticsFiltersToSearchParams,
  type AnalyticsRangePreset,
} from "../analyticsData.js";

interface AnalyticsWorkspaceProps {
  apps: AppSummary[];
  selectedApp: AppSummary;
  status: AgentStatus;
  onAppChange: (appId: string) => void;
}

type LoadPhase = "initial" | "refreshing" | "idle";
type ScopeId = "all" | string;

const metricOrder: AnalyticsMetricId[] = [
  "IMPRESSIONS",
  "DOWNLOADS",
  "FIRST_TIME_DOWNLOADS",
  "PRODUCT_PAGE_VIEWS",
  "DOWNLOAD_RATE",
  "SESSIONS",
  "PROCEEDS",
];

const breakdownLabels: Record<AnalyticsBreakdownDimension, string> = {
  APP: "App",
  TERRITORY: "Territory",
  SOURCE: "Source",
  PRODUCT_PAGE: "Page type",
  VERSION: "Version",
};

const availableBreakdowns = (scope: ScopeId): AnalyticsBreakdownDimension[] => scope === "all"
  ? ["APP", "TERRITORY", "SOURCE", "PRODUCT_PAGE", "VERSION"]
  : ["TERRITORY", "SOURCE", "PRODUCT_PAGE", "VERSION"];

const reportAccessLabel = (accessType: AnalyticsReportAccessType) => accessType === "ONGOING"
  ? "Ongoing daily reports"
  : "One-time historical snapshot";

const metricSupportingText = (
  availability: "AVAILABLE" | "PARTIAL" | "PRIVACY_WITHHELD" | "UNAVAILABLE",
  change: string | null,
  noComparisonLabel = "No comparison",
) => {
  if (availability === "PRIVACY_WITHHELD" || availability === "UNAVAILABLE") return availabilityLabel(availability);
  if (availability === "PARTIAL") return change ? `${change} · Partial` : "Partial";
  return change ?? noComparisonLabel;
};

const relativeDateTime = (value: string | null) => {
  if (!value) return "Not synced yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
};

const currentUrlValue = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  const value = new URLSearchParams(window.location.search).get(key);
  return values.includes(value as T) ? value as T : fallback;
};

const appInitials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toLocaleUpperCase())
  .join("") || "A";

const AnalyticsSkeleton = () => (
  <div className="analytics-skeleton" aria-hidden="true">
    <span /><span /><span /><span /><span /><span /><span />
  </div>
);

const filterGroups: Array<{ key: keyof AnalyticsFilters; label: string; allLabel: string }> = [
  { key: "territories", label: "Territory", allLabel: "All territories" },
  { key: "sources", label: "Source", allLabel: "All sources" },
  { key: "productPages", label: "Page type", allLabel: "All page types" },
  { key: "versions", label: "Version", allLabel: "All versions" },
];

interface AnalyticsFiltersDialogProps {
  applied: AnalyticsFilters;
  facets: AnalyticsFacets;
  onApply: (filters: AnalyticsFilters) => void;
  onClose: () => void;
}

const AnalyticsFiltersDialog = ({ applied, facets, onApply, onClose }: AnalyticsFiltersDialogProps) => {
  const [draft, setDraft] = useState<AnalyticsFilters>(() => ({
    territories: [...applied.territories],
    sources: [...applied.sources],
    productPages: [...applied.productPages],
    versions: [...applied.versions],
  }));
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
    ) ?? []).filter((element) => element.offsetParent !== null);
    if (!controls.length) return;
    const first = controls[0]!;
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop analytics-filter-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className="dialog analytics-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="analytics-filter-title" onKeyDown={trapFocus}>
        <header className="dialog-header">
          <div><h2 id="analytics-filter-title">Filter analytics</h2><p>Choose one exact value per dimension. Facets come from the unfiltered report set.</p></div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Close analytics filters"><X size={19} /></button>
        </header>
        <div className="dialog-content analytics-filter-fields">
          {filterGroups.map(({ key, label, allLabel }) => {
            const selected = draft[key][0] ?? "";
            const facetOptions = Array.from(new Set(facets[key]));
            const options = selected && !facetOptions.includes(selected) ? [selected, ...facetOptions] : facetOptions;
            return (
              <label key={key}><span>{label}</span><select value={selected} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value ? [event.target.value] : [] }))}><option value="">{allLabel}</option>{options.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
            );
          })}
        </div>
        <footer className="dialog-footer analytics-filter-footer">
          <button className="button secondary" type="button" onClick={() => setDraft(emptyAnalyticsFilters())} disabled={analyticsFilterCount(draft) === 0}>Clear filters</button>
          <span>{analyticsFilterCount(draft)} active</span>
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" type="button" onClick={() => onApply(draft)}>Apply filters</button>
        </footer>
      </section>
    </div>
  );
};

interface AnalyticsPlanDialogProps {
  plan: CreateAnalyticsReportRequestMutationPlan;
  demo: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

const AnalyticsPlanDialog = ({ plan, demo, busy, error, onClose, onConfirm }: AnalyticsPlanDialogProps) => {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
    ) ?? []).filter((element) => element.offsetParent !== null);
    if (!controls.length) return;
    const first = controls[0]!;
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section
        ref={dialogRef}
        className="dialog analytics-plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analytics-plan-title"
        onKeyDown={trapFocus}
      >
        <header className="dialog-header">
          <div>
            <h2 id="analytics-plan-title">Review analytics request</h2>
            <p>{plan.target.appName}</p>
          </div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close analytics request review">
            <X size={19} />
          </button>
        </header>
        <div className="dialog-content analytics-plan-content">
          <div className="review-label">Review exact Apple request</div>
          <dl className="plan-details analytics-plan-details">
            <div><dt>App</dt><dd>{plan.target.appName}</dd></div>
            <div><dt>Report access</dt><dd>{reportAccessLabel(plan.target.accessType)}</dd></div>
            <div><dt>Existing matches</dt><dd>{plan.before.matchingReportRequestIds.length}</dd></div>
            <div><dt>Apple account</dt><dd>{plan.context.profile ?? "Active connection"}</dd></div>
          </dl>
          <div className="analytics-plan-warning">
            <AlertTriangle size={18} />
            <span>{demo
              ? "Demo mode creates this request only in isolated sample data."
              : plan.target.accessType === "ONGOING"
                ? "This creates a real ongoing Analytics Reports request at Apple. Initial reports can take time to appear."
                : "This creates a real one-time snapshot request at Apple. Apple limits how often snapshots can be requested."}</span>
          </div>
        </div>
        {error ? <div className="dialog-error" role="alert">{error}</div> : null}
        <footer className="dialog-footer">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "Confirming…" : "Confirm request"}
          </button>
        </footer>
      </section>
    </div>
  );
};

interface AnalyticsChartProps {
  snapshot: AnalyticsOverviewResponse;
  metric: AnalyticsMetricId;
  onMetricChange: (metric: AnalyticsMetricId) => void;
}

const AnalyticsChart = ({ snapshot, metric, onMetricChange }: AnalyticsChartProps) => {
  const series = snapshot.series.find((candidate) => candidate.metric === metric) ?? null;
  const coverage = snapshot.metricCoverage.find((candidate) => candidate.metric === metric) ?? null;
  const points = useMemo(() => chartPoints(series?.points ?? []), [series?.points]);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, points.length - 1));
  const width = 1_000;
  const height = 260;
  const currentChart = useMemo(() => chartSegments(points, "current", width, height, 20), [points]);
  const previousChart = useMemo(() => chartSegments(points, "previous", width, height, 20), [points]);
  const activePoint = points[Math.min(activeIndex, Math.max(0, points.length - 1))] ?? null;

  useEffect(() => {
    setActiveIndex(Math.max(0, points.length - 1));
  }, [series?.evidenceId, points.length]);

  const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex((current) => {
        if (event.key === "Home") return 0;
        if (event.key === "End") return points.length - 1;
        return Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
      });
    }
  };

  const pointFromPointer = (event: MouseEvent<HTMLDivElement>) => {
    if (!points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setActiveIndex(Math.round(ratio * (points.length - 1)));
  };

  const unit = series?.unit ?? "COUNT";
  const yLabels = [currentChart.maximum, (currentChart.maximum + currentChart.minimum) / 2, currentChart.minimum];

  return (
    <section className="analytics-panel analytics-chart-panel" aria-labelledby="analytics-chart-title">
      <header className="analytics-panel-header">
        <div>
          <span className="analytics-eyebrow">Performance over time</span>
          <h2 id="analytics-chart-title">{analyticsMetricLabels[metric]}</h2>
        </div>
        <div className="analytics-chart-controls">
          <label>
            <span>Metric</span>
            <select value={metric} onChange={(event) => onMetricChange(event.target.value as AnalyticsMetricId)}>
              {metricOrder.map((option) => <option value={option} key={option}>{analyticsMetricLabels[option]}</option>)}
            </select>
          </label>
          <div className="analytics-legend" aria-label="Chart legend">
            <span><i className="current" />Current</span>
            {snapshot.comparisonPeriod ? <span><i className="previous" />Previous</span> : null}
          </div>
        </div>
      </header>
      {coverage ? (
        <div className="analytics-metric-evidence" title={coverage.detail}>
          <span>Apple Analytics Reports</span>
          <span>{availabilityLabel(coverage.availability)}</span>
          <span>{coverage.completeThrough ? `Complete through ${shortDate(coverage.completeThrough)}` : "No complete date"}</span>
          {coverage.formula ? <span>{coverage.formula}</span> : null}
        </div>
      ) : series?.formula ? <p className="analytics-formula">{series.formula}</p> : null}
      {!series || points.length === 0 ? (
        <div className="analytics-empty-chart">No reported values are available for this range.</div>
      ) : (
        <figure className="analytics-chart-figure">
          <div
            className="analytics-chart-canvas"
            tabIndex={0}
            role="group"
            aria-label={`${analyticsMetricLabels[metric]} chart. Use Left and Right arrow keys to inspect dates.`}
            onKeyDown={moveSelection}
            onMouseMove={pointFromPointer}
          >
            <div className="analytics-chart-y-axis" aria-hidden="true">
              {yLabels.map((value, index) => <span key={index}>{formatAnalyticsValue({ value, availability: "AVAILABLE" }, unit)}</span>)}
            </div>
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="analytics-chart-title analytics-chart-description" preserveAspectRatio="none">
              <desc id="analytics-chart-description">A straight-line comparison chart. Gaps indicate unavailable or privacy-withheld values, never zero.</desc>
              {[20, 130, 240].map((y) => <line className="analytics-grid-line" x1="20" x2="980" y1={y} y2={y} key={y} />)}
              {previousChart.segments.map((segment, index) => <path className="analytics-line previous" d={segment.path} key={`previous-${index}`} />)}
              {currentChart.segments.map((segment, index) => <path className="analytics-line current" d={segment.path} key={`current-${index}`} />)}
              {activePoint ? (
                <>
                  <line className="analytics-active-line" x1={currentChart.x(activePoint.index)} x2={currentChart.x(activePoint.index)} y1="20" y2="240" />
                  {activePoint.current !== null ? <circle className="analytics-active-point" cx={currentChart.x(activePoint.index)} cy={currentChart.y(activePoint.current)} r="5" /> : null}
                </>
              ) : null}
            </svg>
            {activePoint ? (
              <div className={`analytics-chart-tooltip${activePoint.index <= 1 ? " edge-start" : activePoint.index >= points.length - 2 ? " edge-end" : ""}`} style={{ left: `${activePoint.index / Math.max(points.length - 1, 1) * 100}%` }}>
                <strong>{shortDate(activePoint.date)}</strong>
                <span>Current <b>{formatAnalyticsValueWithAvailability({ value: activePoint.current, availability: activePoint.currentAvailability }, unit)}</b></span>
                {snapshot.comparisonPeriod ? <span>Previous <b>{formatAnalyticsValueWithAvailability(activePoint.previousAvailability ? { value: activePoint.previous, availability: activePoint.previousAvailability } : null, unit)}</b></span> : null}
              </div>
            ) : null}
          </div>
          <figcaption>
            <span>{shortDate(snapshot.period.startDate)}</span>
            <span>{shortDate(snapshot.period.endDate)}</span>
          </figcaption>
          <p className="sr-only" aria-live="polite">{activePoint
            ? `${shortDate(activePoint.date)}. Current ${formatAnalyticsValueWithAvailability({ value: activePoint.current, availability: activePoint.currentAvailability }, unit)}.${snapshot.comparisonPeriod ? ` Previous ${formatAnalyticsValueWithAvailability(activePoint.previousAvailability ? { value: activePoint.previous, availability: activePoint.previousAvailability } : null, unit)}.` : ""}`
            : "No chart point selected."}</p>
          <details className="analytics-data-table-disclosure">
            <summary>View data table</summary>
            <div className="analytics-table-scroll">
              <table>
                <caption>{analyticsMetricLabels[metric]} by date</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">Current</th>{snapshot.comparisonPeriod ? <th scope="col">Previous period</th> : null}</tr></thead>
                <tbody>{points.map((point) => (
                  <tr key={point.date}>
                    <th scope="row">{shortDate(point.date)}</th>
                    <td>{formatAnalyticsValueWithAvailability({ value: point.current, availability: point.currentAvailability }, unit)}</td>
                    {snapshot.comparisonPeriod ? <td>{formatAnalyticsValueWithAvailability(point.previousAvailability ? { value: point.previous, availability: point.previousAvailability } : null, unit)}</td> : null}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </figure>
      )}
    </section>
  );
};

export const AnalyticsWorkspace = ({ apps, selectedApp, status: agentStatus, onAppChange }: AnalyticsWorkspaceProps) => {
  const initialScope = typeof window === "undefined" ? "all" : new URLSearchParams(window.location.search).get("analyticsApp") ?? "all";
  const initialFilters = typeof window === "undefined" ? emptyAnalyticsFilters() : analyticsFiltersFromSearchParams(new URLSearchParams(window.location.search));
  const [scopeId, setScopeId] = useState<ScopeId>(initialScope);
  const [range, setRange] = useState<AnalyticsRangePreset>(() => currentUrlValue("range", ["7d", "30d", "90d"] as const, "30d"));
  const [compare, setCompare] = useState<"NONE" | "PREVIOUS_PERIOD">(() => currentUrlValue("compare", ["NONE", "PREVIOUS_PERIOD"] as const, "PREVIOUS_PERIOD"));
  const [metric, setMetric] = useState<AnalyticsMetricId>(() => currentUrlValue("metric", metricOrder, "DOWNLOADS"));
  const [breakdown, setBreakdown] = useState<AnalyticsBreakdownDimension>(() => currentUrlValue(
    "breakdown",
    ["APP", "TERRITORY", "SOURCE", "PRODUCT_PAGE", "VERSION"] as const,
    initialScope === "all" ? "APP" : "TERRITORY",
  ));
  const [filters, setFilters] = useState<AnalyticsFilters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [analyticsStatus, setAnalyticsStatus] = useState<AnalyticsStatusResponse | null>(null);
  const [portfolioSnapshot, setPortfolioSnapshot] = useState<AnalyticsOverviewResponse | null>(null);
  const [snapshot, setSnapshot] = useState<AnalyticsOverviewResponse | null>(null);
  const [resolvedQueryKey, setResolvedQueryKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("initial");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [setupAppId, setSetupAppId] = useState(selectedApp.id);
  const [snapshotAppId, setSnapshotAppId] = useState(selectedApp.id);
  const [plan, setPlan] = useState<CreateAnalyticsReportRequestMutationPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const generation = useRef(0);
  const syncGeneration = useRef(0);
  const analyticsStatusRef = useRef<AnalyticsStatusResponse | null>(null);
  const snapshotRef = useRef<AnalyticsOverviewResponse | null>(null);
  const portfolioRef = useRef<AnalyticsOverviewResponse | null>(null);
  const resolvedQueryKeyRef = useRef<string | null>(null);
  const shellScopeRef = useRef<string | null>(null);
  const appIds = useMemo(() => apps.map((app) => app.id), [apps]);
  const appIdsKey = appIds.join("\u001f");
  const filtersKey = JSON.stringify(filters);
  const desiredQueryKey = analyticsQueryKey({ appIds, scopeId, range, compare, filters });
  const desiredQueryKeyRef = useRef(desiredQueryKey);
  desiredQueryKeyRef.current = desiredQueryKey;

  const selectedScopeApp = scopeId === "all" ? null : apps.find((app) => app.id === scopeId) ?? null;

  useEffect(() => {
    if (scopeId === "all") return;
    if (!apps.some((app) => app.id === scopeId)) {
      setScopeId("all");
      setBreakdown("APP");
      return;
    }
    if (shellScopeRef.current !== scopeId) {
      shellScopeRef.current = scopeId;
      onAppChange(scopeId);
    }
  }, [apps, onAppChange, scopeId]);

  useEffect(() => {
    const allowed = availableBreakdowns(scopeId);
    if (!allowed.includes(breakdown)) setBreakdown(scopeId === "all" ? "APP" : "TERRITORY");
  }, [breakdown, scopeId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("section", "analytics");
    parameters.set("analyticsApp", scopeId);
    parameters.set("range", range);
    parameters.set("compare", compare);
    parameters.set("metric", metric);
    parameters.set("breakdown", breakdown);
    writeAnalyticsFiltersToSearchParams(parameters, filters);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${parameters}${window.location.hash}`);
  }, [breakdown, compare, filtersKey, metric, range, scopeId]);

  useEffect(() => {
    const restoreLocation = () => {
      const parameters = new URLSearchParams(window.location.search);
      const restoredScope = parameters.get("analyticsApp") ?? "all";
      const validRestoredScope = restoredScope === "all" || apps.some((app) => app.id === restoredScope);
      setScopeId(validRestoredScope ? restoredScope : "all");
      const restoredRange = parameters.get("range");
      if (restoredRange === "7d" || restoredRange === "30d" || restoredRange === "90d") setRange(restoredRange);
      const restoredCompare = parameters.get("compare");
      if (restoredCompare === "NONE" || restoredCompare === "PREVIOUS_PERIOD") setCompare(restoredCompare);
      const restoredMetric = parameters.get("metric");
      if (metricOrder.includes(restoredMetric as AnalyticsMetricId)) setMetric(restoredMetric as AnalyticsMetricId);
      const restoredBreakdown = parameters.get("breakdown");
      if (!validRestoredScope) {
        setBreakdown("APP");
      } else if (["APP", "TERRITORY", "SOURCE", "PRODUCT_PAGE", "VERSION"].includes(restoredBreakdown ?? "")) {
        setBreakdown(restoredBreakdown as AnalyticsBreakdownDimension);
      }
      setFilters(analyticsFiltersFromSearchParams(parameters));
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [apps]);

  const chooseScope = (nextScope: ScopeId) => {
    if (nextScope === scopeId) return;
    setScopeId(nextScope);
    setBreakdown(nextScope === "all" ? "APP" : "TERRITORY");
    if (nextScope !== "all") {
      shellScopeRef.current = nextScope;
      onAppChange(nextScope);
    }
    if (typeof window !== "undefined") {
      const parameters = new URLSearchParams(window.location.search);
      parameters.set("section", "analytics");
      parameters.set("analyticsApp", nextScope);
      parameters.set("breakdown", nextScope === "all" ? "APP" : "TERRITORY");
      window.history.pushState(window.history.state, "", `${window.location.pathname}?${parameters}${window.location.hash}`);
    }
  };

  const refreshAnalyticsStatus = useCallback(async () => {
    const nextStatus = await api.analyticsStatus();
    analyticsStatusRef.current = nextStatus;
    setAnalyticsStatus(nextStatus);
    return nextStatus;
  }, []);

  const loadAnalytics = useCallback(async (refresh = false) => {
    const nextStatus = analyticsStatusRef.current;
    if (!appIds.length || !nextStatus) return;
    const requestedQueryKey = desiredQueryKey;
    const currentGeneration = ++generation.current;
    setPhase(resolvedQueryKeyRef.current === requestedQueryKey && snapshotRef.current ? "refreshing" : "initial");
    setError(null);
    try {
      if (currentGeneration !== generation.current || requestedQueryKey !== desiredQueryKeyRef.current) return;
      const endDate = nextStatus.freshness.dataThrough ?? todayIsoDate();
      const period = analyticsDateRange(range, endDate);
      const portfolioQuery = {
        schemaVersion: 1 as const,
        scope: "PORTFOLIO" as const,
        appIds,
        ...period,
        compare,
        granularity: "DAY" as const,
        breakdowns: ["APP", "TERRITORY", "SOURCE", "PRODUCT_PAGE", "VERSION"] as AnalyticsBreakdownDimension[],
        filters,
      };
      const scopeAppId = scopeId === "all" ? null : scopeId;
      const [nextPortfolio, nextSelected] = await Promise.all([
        api.analyticsOverview(portfolioQuery),
        scopeAppId ? api.analyticsOverview({
          ...portfolioQuery,
          scope: "APP" as const,
          appIds: [scopeAppId],
          breakdowns: ["TERRITORY", "SOURCE", "PRODUCT_PAGE", "VERSION"] as AnalyticsBreakdownDimension[],
        }) : Promise.resolve(null),
      ]);
      if (currentGeneration !== generation.current || requestedQueryKey !== desiredQueryKeyRef.current) return;
      const nextSnapshot = nextSelected ?? nextPortfolio;
      portfolioRef.current = nextPortfolio;
      snapshotRef.current = nextSnapshot;
      resolvedQueryKeyRef.current = requestedQueryKey;
      setPortfolioSnapshot(nextPortfolio);
      setSnapshot(nextSnapshot);
      setResolvedQueryKey(requestedQueryKey);
      setPhase("idle");
      if (refresh) setNotice("Analytics view refreshed from the local report cache.");
    } catch (loadError) {
      if (currentGeneration !== generation.current || requestedQueryKey !== desiredQueryKeyRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Analytics could not be loaded.");
      if (resolvedQueryKeyRef.current !== requestedQueryKey) {
        setPortfolioSnapshot(null);
        setSnapshot(null);
        setResolvedQueryKey(null);
      }
      setPhase("idle");
    }
  }, [appIdsKey, compare, desiredQueryKey, filtersKey, range, scopeId]);

  const loadAnalyticsRef = useRef(loadAnalytics);
  loadAnalyticsRef.current = loadAnalytics;

  const retryAnalytics = useCallback(async () => {
    if (analyticsStatusRef.current) {
      await loadAnalytics(true);
      return;
    }
    setPhase("initial");
    setError(null);
    try {
      await refreshAnalyticsStatus();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Analytics status could not be loaded.");
      setPhase("idle");
    }
  }, [loadAnalytics, refreshAnalyticsStatus]);

  useEffect(() => {
    void refreshAnalyticsStatus().catch((statusError: unknown) => {
      setError(statusError instanceof Error ? statusError.message : "Analytics status could not be loaded.");
      setPhase("idle");
    });
  }, [refreshAnalyticsStatus]);

  useEffect(() => {
    if (!analyticsStatus) return;
    void loadAnalytics();
    return () => {
      generation.current += 1;
    };
  }, [analyticsStatus !== null, loadAnalytics]);

  useEffect(() => () => {
    generation.current += 1;
    syncGeneration.current += 1;
  }, []);

  const syncReports = async () => {
    if (analyticsStatus?.state === "SYNCING") return;
    const currentGeneration = ++syncGeneration.current;
    setSyncBusy(true);
    setError(null);
    setNotice(null);
    try {
      let result = await api.syncAnalytics({ schemaVersion: 1, appIds, force: true });
      for (let attempt = 0; attempt < 60 && (result.state === "QUEUED" || result.state === "RUNNING"); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        if (currentGeneration !== syncGeneration.current) return;
        result = await api.analyticsSync(result.runId);
      }
      if (currentGeneration !== syncGeneration.current) return;
      if (result.state === "FAILED") throw new Error(result.error ?? "Apple analytics reports could not be synced.");
      if (result.state === "QUEUED" || result.state === "RUNNING") {
        setNotice("Sync continues in the background. Refresh the view in a few minutes to check for newly available reports.");
        return;
      }
      setNotice(result.state === "PARTIAL"
        ? "Sync finished with some report families unavailable. Existing complete data remains usable."
        : `Synced ${result.observationCount.toLocaleString()} analytics observations.`);
      await refreshAnalyticsStatus();
      await loadAnalyticsRef.current();
    } catch (syncError) {
      if (currentGeneration === syncGeneration.current) setError(syncError instanceof Error ? syncError.message : "Analytics could not be synced.");
    } finally {
      if (currentGeneration === syncGeneration.current) setSyncBusy(false);
    }
  };

  const prepareReportRequest = async (accessType: AnalyticsReportAccessType, appId = accessType === "ONGOING" ? setupAppId : snapshotAppId) => {
    if (analyticsStatus?.state === "SYNCING") {
      setPlanError("Wait for the current analytics sync to finish before changing report requests.");
      return;
    }
    setPlanBusy(true);
    setPlanError(null);
    try {
      const response = await api.planAnalyticsReportRequest({ appId, accessType });
      setPlan(response.plan);
    } catch (prepareError) {
      setPlanError(prepareError instanceof Error ? prepareError.message : "The analytics request could not be prepared.");
    } finally {
      setPlanBusy(false);
    }
  };

  const confirmReportRequest = async () => {
    if (!plan) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      await api.confirmPlan(plan);
      setPlan(null);
      setNotice(agentStatus.mode === "demo"
        ? "Demo analytics reports enabled in isolated sample data."
        : "Analytics request created at Apple. Reports can take time to appear before the first sync.");
      await refreshAnalyticsStatus();
      await loadAnalyticsRef.current();
    } catch (confirmError) {
      setPlanError(confirmError instanceof Error ? confirmError.message : "The analytics request could not be confirmed.");
    } finally {
      setPlanBusy(false);
    }
  };

  const currentSnapshot = resolvedQueryKey === desiredQueryKey ? snapshot : null;
  const currentPortfolioSnapshot = resolvedQueryKey === desiredQueryKey ? portfolioSnapshot : null;
  const portfolioKpi = currentPortfolioSnapshot?.kpis.find((kpi) => kpi.metric === metric) ?? null;
  const rankingMetric = metric === "DOWNLOAD_RATE" ? "DOWNLOADS" : metric;
  const contributions = (currentPortfolioSnapshot?.appContributions ?? []).filter((item) => item.metric === rankingMetric);
  const contributionByApp = new Map(contributions.map((item) => [item.appId, item]));
  const rosterApps = apps
    .map((app, index) => ({ app, index, contribution: contributionByApp.get(app.id) }))
    .sort((left, right) => {
      const leftValue = left.contribution?.currentValue;
      const rightValue = right.contribution?.currentValue;
      if (leftValue === null || leftValue === undefined) return rightValue === null || rightValue === undefined ? left.index - right.index : 1;
      if (rightValue === null || rightValue === undefined) return -1;
      return rightValue - leftValue || left.index - right.index;
    });
  const activeBreakdown = currentSnapshot?.breakdowns.find((candidate) => candidate.dimension === breakdown && candidate.metric === metric)
    ?? null;
  const compatibleBreakdowns = Array.from(new Set((currentSnapshot?.breakdowns ?? [])
    .filter((candidate) => candidate.metric === metric && (scopeId === "all" || candidate.dimension !== "APP"))
    .map((candidate) => candidate.dimension)));
  const compatibleBreakdownsKey = compatibleBreakdowns.join("\u001f");
  const activeBreakdownKpi = currentSnapshot?.kpis.find((kpi) => kpi.metric === activeBreakdown?.metric) ?? null;
  const rankedContributions = contributions
    .map((contribution, index) => ({ contribution, index }))
    .sort((left, right) => {
      if (compare === "PREVIOUS_PERIOD") {
        const leftRawDriver = left.contribution.shareOfPortfolioChange ?? left.contribution.absoluteChange;
        const rightRawDriver = right.contribution.shareOfPortfolioChange ?? right.contribution.absoluteChange;
        const leftDriver = leftRawDriver === null ? Number.NEGATIVE_INFINITY : Math.abs(leftRawDriver);
        const rightDriver = rightRawDriver === null ? Number.NEGATIVE_INFINITY : Math.abs(rightRawDriver);
        return rightDriver - leftDriver || left.index - right.index;
      }
      const leftValue = left.contribution.currentValue ?? Number.NEGATIVE_INFINITY;
      const rightValue = right.contribution.currentValue ?? Number.NEGATIVE_INFINITY;
      return rightValue - leftValue || left.index - right.index;
    })
    .map(({ contribution }) => contribution);
  const contributionsUseShare = rankedContributions.some((contribution) => contribution.shareOfPortfolioChange !== null);
  const maximumContributionDriver = Math.max(...rankedContributions.map((contribution) => Math.abs(
    contributionsUseShare ? contribution.shareOfPortfolioChange ?? 0 : contribution.absoluteChange ?? 0,
  )), 0);
  const showContributionTable = scopeId === "all" && breakdown === "APP" && rankedContributions.length > 0;
  const reportRequests = analyticsStatus?.reportRequests ?? [];
  const enabledAppIds = new Set(reportRequests
    .filter((request) => request.accessType === "ONGOING" && !request.stoppedDueToInactivity)
    .map((request) => request.appId));
  const missingApps = apps.filter((app) => !enabledAppIds.has(app.id));
  const hasAnyValue = currentSnapshot?.kpis.some((kpi) => kpi.current.value !== null) ?? false;
  const loading = resolvedQueryKey !== desiredQueryKey || (phase === "initial" && !currentSnapshot);
  const scopeTitle = scopeId === "all" ? "Portfolio overview" : selectedScopeApp?.name ?? selectedApp.name;
  const activeFilterCount = analyticsFilterCount(filters);
  const analyticsSyncing = analyticsStatus?.state === "SYNCING" || syncBusy;

  useEffect(() => {
    if (!missingApps.length) return;
    if (!missingApps.some((app) => app.id === setupAppId)) setSetupAppId(missingApps[0]!.id);
  }, [missingApps.map((app) => app.id).join("\u001f"), setupAppId]);

  useEffect(() => {
    if (!apps.some((app) => app.id === snapshotAppId) && apps[0]) setSnapshotAppId(apps[0].id);
  }, [appIdsKey, snapshotAppId]);

  useEffect(() => {
    if (!currentSnapshot || !compatibleBreakdowns.length || compatibleBreakdowns.includes(breakdown)) return;
    setBreakdown(compatibleBreakdowns[0]!);
  }, [breakdown, compatibleBreakdownsKey, currentSnapshot?.snapshotId]);

  return (
    <main className="workspace analytics-workspace" aria-busy={phase !== "idle" || syncBusy}>
      <header className="topbar analytics-topbar">
        <div>
          <h1>Analytics</h1>
          <p>Portfolio performance and the app-level drivers behind it.</p>
        </div>
        <div className="topbar-actions analytics-topbar-actions">
          <label className="analytics-topbar-select">
            <CalendarDays size={17} />
            <span className="sr-only">Date range</span>
            <select value={range} onChange={(event) => setRange(event.target.value as AnalyticsRangePreset)}>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </label>
          <label className="analytics-topbar-select compare">
            <span className="sr-only">Comparison</span>
            <select value={compare} onChange={(event) => setCompare(event.target.value as "NONE" | "PREVIOUS_PERIOD")}>
              <option value="PREVIOUS_PERIOD">Previous period</option>
              <option value="NONE">No comparison</option>
            </select>
          </label>
          <button className={activeFilterCount ? "button secondary analytics-filter-trigger active" : "button secondary analytics-filter-trigger"} type="button" onClick={() => setFiltersOpen(true)} aria-label={activeFilterCount ? `Filters, ${activeFilterCount} active` : "Filters"} aria-haspopup="dialog" aria-expanded={filtersOpen}>
            <ListFilter size={17} /><span>Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}</span>{activeFilterCount ? <b>{activeFilterCount}</b> : null}
          </button>
          <button className="button secondary" type="button" onClick={() => void syncReports()} disabled={analyticsSyncing || !appIds.length} aria-label={syncBusy ? "Syncing analytics reports" : agentStatus.mode === "demo" ? "Sync sample analytics reports" : "Sync analytics reports from Apple"} title={agentStatus.mode === "demo" ? "Refresh deterministic analytics sample reports" : "Download and ingest available reports from Apple"}>
            <Database size={17} /><span>{syncBusy ? "Syncing…" : agentStatus.mode === "demo" ? "Sync sample reports" : "Sync from Apple"}</span>
          </button>
          <button className="button secondary" type="button" onClick={() => void retryAnalytics()} disabled={phase !== "idle"} aria-label={phase === "refreshing" ? "Refreshing analytics view" : "Refresh analytics view from local cache"} title="Refresh this view from the local analytics cache">
            <RefreshCw size={17} /><span>{phase === "refreshing" ? "Refreshing…" : "Refresh view"}</span>
          </button>
        </div>
      </header>

      {agentStatus.mode === "demo" ? (
        <div className="demo-banner analytics-demo-banner">
          <strong>Sample data</strong>
          <span>Portfolio totals and app contributions are deterministic fixtures; no Apple analytics data is read.</span>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {syncBusy ? "Syncing analytics reports from Apple."
          : phase === "refreshing" ? "Refreshing the analytics view."
            : error ? `Analytics error: ${error}`
              : phase === "idle" ? "Analytics view ready." : "Loading analytics."}
      </p>

      {error ? <div className="analytics-alert error" role="alert"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={retryAnalytics}>Retry</button></div> : null}
      {notice ? <div className="analytics-alert notice" role="status"><CheckCircle2 size={17} /><span>{notice}</span><button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={15} /></button></div> : null}
      {analyticsStatus?.state === "WAITING_FOR_DATA" ? <div className="analytics-alert waiting"><Clock3 size={17} /><span>{analyticsStatus.detail}</span></div> : null}
      {analyticsStatus?.state === "SYNCING" ? <div className="analytics-alert waiting" role="status"><RefreshCw size={17} /><span>{analyticsStatus.detail}</span></div> : null}
      {analyticsStatus?.state === "ERROR" ? <div className="analytics-alert error" role="alert"><AlertTriangle size={17} /><span>{analyticsStatus.detail}</span></div> : null}
      {analyticsStatus?.state === "PARTIAL" || currentSnapshot?.freshness.partial ? <div className="analytics-alert partial"><Info size={17} /><span>Some report families or dates are still processing. Partial values are labeled and missing values remain blank.</span></div> : null}

      {missingApps.length ? (
        <section className="analytics-setup-strip" aria-labelledby="analytics-setup-title">
          <div>
            <span className="analytics-setup-icon"><Database size={18} /></span>
            <div><h2 id="analytics-setup-title">Enable reports for {missingApps.length} {missingApps.length === 1 ? "app" : "apps"}</h2><p>Apple requires a separate Analytics Reports request for each app. Confirm them one at a time; existing apps remain usable.</p></div>
          </div>
          <div className="analytics-setup-actions">
            <label><span className="sr-only">App to enable</span><select value={setupAppId} onChange={(event) => setSetupAppId(event.target.value)} disabled={analyticsSyncing}>{missingApps.map((app) => <option value={app.id} key={app.id}>{app.name}</option>)}</select></label>
            <button className="button primary compact" type="button" onClick={() => void prepareReportRequest("ONGOING")} disabled={planBusy || analyticsSyncing}>Enable ongoing</button>
            <button className="button secondary compact" type="button" onClick={() => void prepareReportRequest("ONE_TIME_SNAPSHOT", setupAppId)} disabled={planBusy || analyticsSyncing}>Historical snapshot</button>
          </div>
          {planError && !plan ? <p className="analytics-setup-error" role="alert">{planError}</p> : null}
        </section>
      ) : null}

      <div className="analytics-scope-select-wrap">
        <label>
          <span>View</span>
          <select value={scopeId} onChange={(event) => chooseScope(event.target.value)}>
            <option value="all">All apps · Portfolio</option>
            {apps.map((app) => <option value={app.id} key={app.id}>{app.name}</option>)}
          </select>
        </label>
      </div>

      <div className="analytics-content">
        <aside className="analytics-roster" aria-label="Portfolio apps">
          <header>
            <div><span className="analytics-eyebrow">Portfolio pulse</span><h2>Apps</h2></div>
            <span>{apps.length}</span>
          </header>
          <div className="analytics-roster-list">
            <button className={scopeId === "all" ? "analytics-roster-item selected portfolio" : "analytics-roster-item portfolio"} type="button" onClick={() => chooseScope("all")} aria-pressed={scopeId === "all"} aria-label={`All apps, ${portfolioKpi ? formatAnalyticsValueWithAvailability(portfolioKpi.current, portfolioKpi.unit) : "Unavailable"}`}>
              <span className="analytics-app-mark portfolio"><AppWindow size={20} /></span>
              <span className="analytics-roster-copy"><strong>All apps</strong><small>Portfolio total</small></span>
              <span className="analytics-roster-value"><strong>{portfolioKpi ? formatAnalyticsValue(portfolioKpi.current, portfolioKpi.unit) : "—"}</strong><small className={portfolioKpi?.current.availability === "AVAILABLE" || portfolioKpi?.current.availability === "PARTIAL" ? analyticsChangeTone(portfolioKpi.change) : "neutral"}>{portfolioKpi ? metricSupportingText(portfolioKpi.current.availability, formatAnalyticsChange(portfolioKpi.change, portfolioKpi.unit)) : "Unavailable"}</small></span>
            </button>
            {rosterApps.map(({ app, contribution }) => {
              const previous = contribution?.previousValue ?? null;
              const change = contribution?.absoluteChange === null || contribution?.absoluteChange === undefined ? null : {
                absolute: contribution.absoluteChange,
                relative: previous === 0 || previous === null ? null : contribution.absoluteChange / previous,
              };
              const unit = rankingMetric === "PROCEEDS" ? "CURRENCY_USD" : "COUNT";
              return (
                <button className={scopeId === app.id ? "analytics-roster-item selected" : "analytics-roster-item"} type="button" key={app.id} onClick={() => chooseScope(app.id)} aria-pressed={scopeId === app.id} aria-label={`${app.name}, ${formatAnalyticsValueWithAvailability(contribution ? { value: contribution.currentValue, availability: contribution.currentAvailability } : null, unit)}`}>
                  <span className="analytics-app-mark">{appInitials(app.name)}</span>
                  <span className="analytics-roster-copy"><strong>{app.name}</strong><small>{app.bundleId}</small></span>
                  <span className="analytics-roster-value"><strong>{formatAnalyticsValue(contribution ? { value: contribution.currentValue, availability: contribution.currentAvailability } : null, unit)}</strong><small className={contribution?.currentAvailability === "AVAILABLE" || contribution?.currentAvailability === "PARTIAL" ? analyticsChangeTone(change) : "neutral"}>{contribution ? metricSupportingText(contribution.currentAvailability, formatAnalyticsChange(change, unit), "No comparison") : "Unavailable"}</small></span>
                </button>
              );
            })}
          </div>
          <footer>Ranked by {analyticsMetricLabels[rankingMetric]}. Rates are recomputed from portfolio totals.</footer>
        </aside>

        <div className="analytics-evidence">
          <section className="analytics-panel analytics-summary" aria-labelledby="analytics-summary-title">
            <header className="analytics-summary-header">
              <div>
                <span className="analytics-eyebrow">{scopeId === "all" ? `${apps.length} apps` : selectedScopeApp?.bundleId}</span>
                <h2 id="analytics-summary-title">{scopeTitle}</h2>
                <p>{scopeId === "all" ? "Combined performance across the active App Store Connect portfolio." : "App performance with the same date, comparison, and metric context."}</p>
              </div>
              <span className="analytics-data-mode">{agentStatus.mode === "demo" ? "Sample data" : "Apple reports"}</span>
            </header>
            {loading ? <AnalyticsSkeleton /> : currentSnapshot ? (
              <div className="analytics-metric-rail">
                {metricOrder.map((metricId) => {
                  const kpi = currentSnapshot.kpis.find((candidate) => candidate.metric === metricId);
                  const coverage = currentSnapshot.metricCoverage.find((candidate) => candidate.metric === metricId);
                  return (
                    <button type="button" className={metric === metricId ? "selected" : ""} aria-pressed={metric === metricId} aria-label={`${analyticsMetricLabels[metricId]}, ${kpi ? formatAnalyticsValueWithAvailability(kpi.current, kpi.unit) : "Unavailable"}`} key={metricId} onClick={() => setMetric(metricId)}>
                      <span>{analyticsMetricLabels[metricId]}</span>
                      <strong>{kpi ? formatAnalyticsValue(kpi.current, kpi.unit) : "—"}</strong>
                      <small className={kpi?.current.availability === "AVAILABLE" || kpi?.current.availability === "PARTIAL" ? analyticsChangeTone(kpi.change) : "neutral"}>{kpi ? metricSupportingText(kpi.current.availability, formatAnalyticsChange(kpi.change, kpi.unit)) : "Unavailable"}</small>
                      {coverage ? <div className="analytics-kpi-coverage" title={`${coverage.detail}${coverage.formula ? ` Formula: ${coverage.formula}` : ""}`}><span>Apple reports · {availabilityLabel(coverage.availability)} · {coverage.completeThrough ? `through ${shortDate(coverage.completeThrough)}` : "no complete date"}</span>{coverage.formula ? <small>{coverage.formula}</small> : null}</div> : null}
                    </button>
                  );
                })}
              </div>
            ) : <AnalyticsSkeleton />}
          </section>

          {!loading && currentSnapshot && !hasAnyValue ? (
            <section className="analytics-empty-state">
              <Database size={24} />
              <div>
                <h2>{activeFilterCount ? "No reported values for these filters" : "No reported values for this range"}</h2>
                <p>This is not treated as zero. {activeFilterCount ? "Clear the filters or choose a different date range." : "Enable reports if needed, sync available instances, or choose a different date range."}</p>
              </div>
              {activeFilterCount ? (
                <button className="button secondary" type="button" onClick={() => setFilters(emptyAnalyticsFilters())}>Clear filters</button>
              ) : (
                <button className="button secondary" type="button" onClick={() => void syncReports()} disabled={analyticsSyncing}>Sync reports</button>
              )}
            </section>
          ) : null}

          {currentSnapshot ? <AnalyticsChart snapshot={currentSnapshot} metric={metric} onMetricChange={setMetric} /> : loading ? <AnalyticsSkeleton /> : null}

          {currentSnapshot ? (
            <section className="analytics-panel analytics-breakdown-panel" aria-labelledby="analytics-breakdown-title">
              <header className="analytics-panel-header">
                <div><span className="analytics-eyebrow">Ranked evidence</span><h2 id="analytics-breakdown-title">{showContributionTable ? `${analyticsMetricLabels[rankingMetric]} by app` : `${analyticsMetricLabels[metric]} by ${breakdownLabels[breakdown].toLocaleLowerCase()}`}</h2></div>
                <label className="analytics-breakdown-select"><span>Inspect by</span><select value={compatibleBreakdowns.includes(breakdown) ? breakdown : ""} onChange={(event) => setBreakdown(event.target.value as AnalyticsBreakdownDimension)} disabled={!compatibleBreakdowns.length}>{compatibleBreakdowns.length ? compatibleBreakdowns.map((dimension) => <option value={dimension} key={dimension}>{breakdownLabels[dimension]}</option>) : <option value="">No compatible breakdown</option>}</select></label>
              </header>
              {showContributionTable ? (
                <div className="analytics-table-scroll">
                  <table className="analytics-breakdown-table">
                    <caption className="sr-only">App contributions to portfolio {analyticsMetricLabels[rankingMetric].toLocaleLowerCase()}</caption>
                    <thead><tr><th scope="col">App</th><th scope="col">Current</th><th scope="col">Previous</th><th scope="col">Change</th><th scope="col">{contributionsUseShare ? "Share of change" : "Change driver"}</th></tr></thead>
                    <tbody>{rankedContributions.slice(0, 20).map((contribution, index) => {
                      const unit = rankingMetric === "PROCEEDS" ? "CURRENCY_USD" : "COUNT";
                      const driverValue = contributionsUseShare ? contribution.shareOfPortfolioChange : contribution.absoluteChange;
                      const driverWidth = driverValue === null || !maximumContributionDriver ? 0 : Math.min(50, Math.abs(driverValue) / maximumContributionDriver * 50);
                      const change = contribution.absoluteChange === null ? null : {
                        absolute: contribution.absoluteChange,
                        relative: contribution.previousValue === null || contribution.previousValue === 0 ? null : contribution.absoluteChange / contribution.previousValue,
                      };
                      return (
                        <tr key={contribution.appId}>
                          <th scope="row" data-label="App"><span className="analytics-rank">{index + 1}</span><button type="button" onClick={() => chooseScope(contribution.appId)}>{contribution.appName}<ArrowRight size={14} /></button></th>
                          <td data-label="Current">{formatAnalyticsValueWithAvailability({ value: contribution.currentValue, availability: contribution.currentAvailability }, unit)}</td>
                          <td data-label="Previous">{formatAnalyticsValueWithAvailability(contribution.previousAvailability ? { value: contribution.previousValue, availability: contribution.previousAvailability } : null, unit)}</td>
                          <td data-label="Change"><span className={contribution.currentAvailability === "AVAILABLE" || contribution.currentAvailability === "PARTIAL" ? analyticsChangeTone(change) : "neutral"}>{metricSupportingText(contribution.currentAvailability, formatAnalyticsChange(change, unit), "—")}</span></td>
                          <td data-label={contributionsUseShare ? "Share of change" : "Change driver"}>{driverValue === null ? "—" : <div className="analytics-contribution-share"><span className="analytics-contribution-track" aria-hidden="true"><i className={contribution.direction === "DOWN" ? "negative" : contribution.direction === "UP" ? "positive" : "neutral"} style={{ width: `${driverWidth}%`, left: contribution.direction === "DOWN" ? `${50 - driverWidth}%` : "50%" }} /></span><small className={contribution.direction === "DOWN" ? "negative" : contribution.direction === "UP" ? "positive" : "neutral"}>{contributionsUseShare ? new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(driverValue) : formatAnalyticsValue({ value: driverValue, availability: contribution.currentAvailability }, unit)}</small></div>}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                  {metric === "DOWNLOAD_RATE" ? <p className="analytics-table-note">App contributions use Total downloads because Download rate is recomputed from aggregate downloads and product page views.</p> : null}
                </div>
              ) : activeBreakdown?.rows.length ? (
                <div className="analytics-table-scroll">
                  <table className="analytics-breakdown-table">
                    <caption className="sr-only">{analyticsMetricLabels[metric]} by {breakdownLabels[activeBreakdown.dimension].toLocaleLowerCase()}</caption>
                    <thead><tr><th scope="col">{breakdownLabels[activeBreakdown.dimension]}</th><th scope="col">Current</th><th scope="col">Previous</th><th scope="col">Change</th><th scope="col">Share</th></tr></thead>
                    <tbody>{activeBreakdown.rows.slice(0, 20).map((row, index) => (
                      <tr key={row.id}>
                        <th scope="row" data-label={breakdownLabels[activeBreakdown.dimension]}><span className="analytics-rank">{index + 1}</span>{row.appId ? <button type="button" onClick={() => chooseScope(row.appId!)}>{row.label}<ArrowRight size={14} /></button> : row.label}</th>
                        <td data-label="Current">{formatAnalyticsValueWithAvailability(row.current, activeBreakdownKpi?.unit ?? "COUNT")}</td>
                        <td data-label="Previous">{formatAnalyticsValueWithAvailability(row.previous, activeBreakdownKpi?.unit ?? "COUNT")}</td>
                        <td data-label="Change"><span className={row.current.availability === "AVAILABLE" || row.current.availability === "PARTIAL" ? analyticsChangeTone(row.change) : "neutral"}>{metricSupportingText(row.current.availability, formatAnalyticsChange(row.change, activeBreakdownKpi?.unit ?? "COUNT"), "—")}</span></td>
                        <td data-label="Share"><div className="analytics-share"><span style={{ width: `${Math.max(0, Math.min(100, (row.share ?? 0) * 100))}%` }} /><small>{row.current.availability === "PRIVACY_WITHHELD" ? "Privacy-held" : row.current.availability === "UNAVAILABLE" ? "Unavailable" : row.share === null ? "—" : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(row.share)}</small></div></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="analytics-panel-empty">No compatible breakdown rows were reported for this range. Privacy-held rows stay missing.</p>}
            </section>
          ) : null}

          {currentSnapshot ? (
            <section className="analytics-freshness" aria-labelledby="analytics-freshness-title">
              <header><h2 id="analytics-freshness-title">Freshness &amp; coverage</h2><span>{currentSnapshot.provenance.reportNames.length} report {currentSnapshot.provenance.reportNames.length === 1 ? "family" : "families"}</span></header>
              <div className="analytics-coverage-grid">
                <p><Clock3 size={18} /><span><strong>Data through</strong><small>{currentSnapshot.freshness.dataThrough ? shortDate(currentSnapshot.freshness.dataThrough) : "No complete date yet"}</small></span></p>
                <p><RefreshCw size={18} /><span><strong>Local cache</strong><small>{relativeDateTime(currentSnapshot.freshness.syncedAt)}</small></span></p>
                <p><ShieldCheck size={18} /><span><strong>Privacy</strong><small>{currentSnapshot.privacy.mayIncludePrivacyAdjustments ? "Apple privacy processing applies" : "No privacy adjustment flagged"}</small></span></p>
              </div>
              <details><summary>Source and limitations</summary><p>{currentSnapshot.freshness.detail} {currentSnapshot.privacy.detail} Estimated proceeds can differ from final payments.</p>{currentSnapshot.provenance.reportNames.length ? <ul>{currentSnapshot.provenance.reportNames.map((name) => <li key={name}>{name}</li>)}</ul> : null}</details>
              <div className="analytics-snapshot-action">
                <div><strong>Need older history?</strong><small>Request a one-time historical snapshot without changing ongoing daily reports.</small></div>
                <label><span className="sr-only">App for historical snapshot</span><select value={snapshotAppId} onChange={(event) => setSnapshotAppId(event.target.value)} disabled={analyticsSyncing}>{apps.map((app) => <option value={app.id} key={app.id}>{app.name}</option>)}</select></label>
                <button className="button secondary compact" type="button" onClick={() => void prepareReportRequest("ONE_TIME_SNAPSHOT", snapshotAppId)} disabled={planBusy || analyticsSyncing}>Request snapshot</button>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {plan ? <AnalyticsPlanDialog
        plan={plan}
        demo={agentStatus.mode === "demo"}
        busy={planBusy || analyticsSyncing}
        error={planError}
        onClose={() => { if (!planBusy) { setPlan(null); setPlanError(null); } }}
        onConfirm={() => void confirmReportRequest()}
      /> : null}
      {filtersOpen ? <AnalyticsFiltersDialog
        applied={filters}
        facets={currentSnapshot?.facets ?? currentPortfolioSnapshot?.facets ?? { territories: [], sources: [], productPages: [], versions: [] }}
        onApply={(nextFilters) => { setFilters(nextFilters); setFiltersOpen(false); }}
        onClose={() => setFiltersOpen(false)}
      /> : null}
    </main>
  );
};
