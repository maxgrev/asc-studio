import type {
  AgentStatus,
  AnalyticsBreakdownDimension,
  AnalyticsFacets,
  AnalyticsFilters,
  AnalyticsMetricId,
  AnalyticsOverviewResponseV2,
  AnalyticsPortfolioCatalogResponse,
  AnalyticsReportAccessType,
  AnalyticsPortfolioSource,
  AnalyticsPortfolioSourceCoverage,
  AnalyticsPortfolioStatusResponse,
  CreateAnalyticsPortfolioReportRequestMutationPlan,
} from "@asc-studio/contracts";
import {
  AlertTriangle,
  AppWindow,
  ArrowRight,
  CalendarDays,
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
  analyticsPortfolioMembershipKey,
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
  status: AgentStatus;
  accountsFingerprint: string;
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

const sourceLabel = (source: AnalyticsPortfolioSource) => source.accounts
  .map((account) => account.profileName)
  .join(" / ");

const coverageLabel = (coverage: AnalyticsPortfolioSourceCoverage) => {
  if (coverage.state === "NO_DATA") return "No analytics yet";
  if (coverage.state === "SYNCING") return "Syncing";
  if (coverage.state === "PARTIAL") return "Partial data";
  if (coverage.state === "ERROR") return "Couldn't load";
  return "Ready";
};

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
  plan: CreateAnalyticsPortfolioReportRequestMutationPlan;
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
            <div><dt>Apple account</dt><dd>{plan.context.profile ?? "Resolved Apple account"}</dd></div>
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
  snapshot: AnalyticsOverviewResponseV2;
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

export const AnalyticsWorkspace = ({ status: agentStatus, accountsFingerprint }: AnalyticsWorkspaceProps) => {
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
  const [catalog, setCatalog] = useState<AnalyticsPortfolioCatalogResponse | null>(null);
  const [analyticsStatus, setAnalyticsStatus] = useState<AnalyticsPortfolioStatusResponse | null>(null);
  const [portfolioSnapshot, setPortfolioSnapshot] = useState<AnalyticsOverviewResponseV2 | null>(null);
  const [snapshot, setSnapshot] = useState<AnalyticsOverviewResponseV2 | null>(null);
  const [resolvedQueryKey, setResolvedQueryKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("initial");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [setupAppId, setSetupAppId] = useState("");
  const [snapshotAppId, setSnapshotAppId] = useState("");
  const [plan, setPlan] = useState<CreateAnalyticsPortfolioReportRequestMutationPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const generation = useRef(0);
  const portfolioContextGeneration = useRef(0);
  const syncGeneration = useRef(0);
  const resolvedAccountsFingerprintRef = useRef<string | null>(null);
  const catalogRef = useRef<AnalyticsPortfolioCatalogResponse | null>(null);
  const analyticsStatusRef = useRef<AnalyticsPortfolioStatusResponse | null>(null);
  const snapshotRef = useRef<AnalyticsOverviewResponseV2 | null>(null);
  const portfolioRef = useRef<AnalyticsOverviewResponseV2 | null>(null);
  const resolvedQueryKeyRef = useRef<string | null>(null);
  const apps = catalog?.apps ?? [];
  const appIds = useMemo(() => apps.map((app) => app.id), [apps]);
  const appIdsKey = appIds.join("\u001f");
  const portfolioMembership = useMemo(() => analyticsPortfolioMembershipKey(appIds), [appIds]);
  const filtersKey = JSON.stringify(filters);
  const desiredQueryKey = `${analyticsQueryKey({
    portfolioMembership,
    scopeId,
    range,
    compare,
    filters,
  })}\u001f${catalog?.catalogRevision ?? "catalog-pending"}`;
  const desiredQueryKeyRef = useRef(desiredQueryKey);
  desiredQueryKeyRef.current = desiredQueryKey;

  const selectedScopeApp = scopeId === "all" ? null : apps.find((app) => app.id === scopeId) ?? null;

  useEffect(() => {
    if (scopeId === "all") return;
    if (!apps.some((app) => app.id === scopeId)) {
      if (!catalog) return;
      setScopeId("all");
      setBreakdown("APP");
    }
  }, [appIdsKey, catalog, scopeId]);

  useEffect(() => {
    const allowed = availableBreakdowns(scopeId);
    if (!allowed.includes(breakdown)) setBreakdown(scopeId === "all" ? "APP" : "TERRITORY");
  }, [breakdown, scopeId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("section", "analytics");
    parameters.set("analyticsApp", scopeId);
    parameters.delete("analyticsAccount");
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
  }, [appIdsKey]);

  const chooseScope = (nextScope: ScopeId) => {
    if (nextScope === scopeId) return;
    setScopeId(nextScope);
    setBreakdown(nextScope === "all" ? "APP" : "TERRITORY");
    if (typeof window !== "undefined") {
      const parameters = new URLSearchParams(window.location.search);
      parameters.set("section", "analytics");
      parameters.set("analyticsApp", nextScope);
      parameters.delete("analyticsAccount");
      parameters.set("breakdown", nextScope === "all" ? "APP" : "TERRITORY");
      window.history.pushState(window.history.state, "", `${window.location.pathname}?${parameters}${window.location.hash}`);
    }
  };

  const refreshPortfolioContext = useCallback(async () => {
    const currentGeneration = ++portfolioContextGeneration.current;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const nextCatalog = await api.analyticsPortfolio();
        const nextStatus = await api.analyticsPortfolioStatus();
        if (currentGeneration !== portfolioContextGeneration.current) return;
        if (nextCatalog.catalogRevision !== nextStatus.catalogRevision) continue;
        try {
          const pendingPlans = await api.analyticsPortfolioPlans();
          if (currentGeneration !== portfolioContextGeneration.current) return;
          setPlan((current) => pendingPlans.plans.find((candidate) => candidate.id === current?.id)
            ?? pendingPlans.plans[0]
            ?? null);
          setPlanError(null);
        } catch (pendingPlanError) {
          if (currentGeneration !== portfolioContextGeneration.current) return;
          setPlanError(pendingPlanError instanceof Error
            ? `Saved Analytics requests could not be restored: ${pendingPlanError.message}`
            : "Saved Analytics requests could not be restored.");
        }
        catalogRef.current = nextCatalog;
        analyticsStatusRef.current = nextStatus;
        resolvedAccountsFingerprintRef.current = accountsFingerprint;
        setCatalog(nextCatalog);
        setAnalyticsStatus(nextStatus);
        return;
      }
      throw new Error("Connected accounts changed while Analytics was loading. Refresh to use one consistent portfolio snapshot.");
    } catch (portfolioError) {
      if (currentGeneration !== portfolioContextGeneration.current) return;
      throw portfolioError;
    }
  }, [accountsFingerprint]);

  const reloadCachedAnalyticsStatus = useCallback(async () => {
    const currentGeneration = portfolioContextGeneration.current;
    const nextStatus = await api.analyticsPortfolioStatus();
    if (currentGeneration !== portfolioContextGeneration.current) return;
    const currentCatalog = catalogRef.current;
    if (!currentCatalog || nextStatus.catalogRevision !== currentCatalog.catalogRevision) {
      throw new Error("The connected-account portfolio changed while Analytics was updating. Check the accounts again.");
    }
    analyticsStatusRef.current = nextStatus;
    setAnalyticsStatus(nextStatus);
  }, []);

  const loadAnalytics = useCallback(async () => {
    const currentCatalog = catalogRef.current;
    const nextStatus = analyticsStatusRef.current;
    if (!currentCatalog || !nextStatus) return;
    if (!currentCatalog.apps.length) {
      setPhase("idle");
      return;
    }
    const requestedQueryKey = desiredQueryKey;
    const currentGeneration = ++generation.current;
    setPhase(resolvedQueryKeyRef.current === requestedQueryKey && snapshotRef.current ? "refreshing" : "initial");
    setError(null);
    try {
      if (currentGeneration !== generation.current || requestedQueryKey !== desiredQueryKeyRef.current) return;
      const endDate = nextStatus.freshness.dataThrough ?? todayIsoDate();
      const period = analyticsDateRange(range, endDate);
      const portfolioQuery = {
        schemaVersion: 2 as const,
        scope: "PORTFOLIO" as const,
        selection: { kind: "ALL_CONNECTED" as const },
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
          selection: { kind: "APP" as const, appId: scopeAppId },
          breakdowns: ["TERRITORY", "SOURCE", "PRODUCT_PAGE", "VERSION"] as AnalyticsBreakdownDimension[],
        }) : Promise.resolve(null),
      ]);
      if (currentGeneration !== generation.current || requestedQueryKey !== desiredQueryKeyRef.current) return;
      const revisionsMatch = nextPortfolio.catalogRevision === currentCatalog.catalogRevision
        && (!nextSelected || nextSelected.catalogRevision === currentCatalog.catalogRevision);
      const portfolioMembershipMatches = analyticsPortfolioMembershipKey(nextPortfolio.apps.map((app) => app.id))
        === analyticsPortfolioMembershipKey(currentCatalog.apps.map((app) => app.id));
      const selectedMembershipMatches = !nextSelected || scopeAppId === null
        || (nextSelected.apps.length === 1 && nextSelected.apps[0]?.id === scopeAppId);
      if (!revisionsMatch || !portfolioMembershipMatches || !selectedMembershipMatches) {
        await refreshPortfolioContext();
        return;
      }
      const nextSnapshot = nextSelected ?? nextPortfolio;
      portfolioRef.current = nextPortfolio;
      snapshotRef.current = nextSnapshot;
      resolvedQueryKeyRef.current = requestedQueryKey;
      setPortfolioSnapshot(nextPortfolio);
      setSnapshot(nextSnapshot);
      setResolvedQueryKey(requestedQueryKey);
      setPhase("idle");
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
  }, [compare, desiredQueryKey, filtersKey, range, refreshPortfolioContext, scopeId]);

  const checkPortfolio = useCallback(async () => {
    setPhase(snapshotRef.current ? "refreshing" : "initial");
    setError(null);
    try {
      await refreshPortfolioContext();
    } catch (portfolioError) {
      setError(portfolioError instanceof Error ? portfolioError.message : "The connected-account analytics portfolio could not be loaded.");
      setPhase("idle");
    }
  }, [refreshPortfolioContext]);

  useEffect(() => {
    if (resolvedAccountsFingerprintRef.current !== accountsFingerprint) {
      catalogRef.current = null;
      analyticsStatusRef.current = null;
      snapshotRef.current = null;
      portfolioRef.current = null;
      resolvedQueryKeyRef.current = null;
      setCatalog(null);
      setAnalyticsStatus(null);
      setPortfolioSnapshot(null);
      setSnapshot(null);
      setResolvedQueryKey(null);
    }
    setPhase(snapshotRef.current ? "refreshing" : "initial");
    setError(null);
    void refreshPortfolioContext().catch((portfolioError: unknown) => {
      setError(portfolioError instanceof Error ? portfolioError.message : "The connected-account analytics portfolio could not be loaded.");
      setPhase("idle");
    });
  }, [accountsFingerprint, refreshPortfolioContext]);

  useEffect(() => {
    if (!catalog || !analyticsStatus) return;
    void loadAnalytics();
    return () => {
      generation.current += 1;
    };
  }, [catalog, analyticsStatus, loadAnalytics]);

  useEffect(() => () => {
    generation.current += 1;
    portfolioContextGeneration.current += 1;
    syncGeneration.current += 1;
  }, []);

  const syncReports = async () => {
    if (analyticsStatus?.state === "SYNCING") return;
    const currentGeneration = ++syncGeneration.current;
    setSyncBusy(true);
    setError(null);
    setNotice(null);
    try {
      let result = await api.syncAnalyticsPortfolio({
        schemaVersion: 2,
        selection: { kind: "ALL_CONNECTED" },
        force: true,
      });
      for (let attempt = 0; attempt < 60 && (result.state === "QUEUED" || result.state === "RUNNING"); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        if (currentGeneration !== syncGeneration.current) return;
        result = await api.analyticsPortfolioSync(result.runId);
      }
      if (currentGeneration !== syncGeneration.current) return;
      const failedSourceNames = result.sources
        .filter((source) => source.state === "FAILED" || source.state === "PARTIAL")
        .map((source) => {
          const catalogSource = catalogRef.current?.sources.find((candidate) => candidate.id === source.sourceId);
          return catalogSource?.accounts.map((account) => account.profileName).join(" / ") ?? "One connected account";
        });
      if (result.state === "FAILED") {
        const failedAccounts = failedSourceNames.length ? ` Affected accounts: ${failedSourceNames.join(", ")}.` : "";
        throw new Error(`${result.error ?? "Apple analytics reports could not be synced."}${failedAccounts}`);
      }
      if (result.state === "QUEUED" || result.state === "RUNNING") {
        setNotice("The update is still running. ASC Studio will keep the current view intact while it finishes.");
        return;
      }
      setNotice(result.state === "PARTIAL"
        ? `Sync finished with partial account coverage${failedSourceNames.length ? `: ${failedSourceNames.join(", ")}` : ""}. Existing complete data remains usable.`
        : `Synced ${result.observationCount.toLocaleString()} analytics observations.`);
      await reloadCachedAnalyticsStatus();
    } catch (syncError) {
      if (currentGeneration === syncGeneration.current) setError(syncError instanceof Error ? syncError.message : "Analytics could not be synced.");
    } finally {
      if (currentGeneration === syncGeneration.current) setSyncBusy(false);
    }
  };

  const prepareReportRequest = async (accessType: AnalyticsReportAccessType, appId = accessType === "ONGOING" ? setupAppId : snapshotAppId) => {
    if (!appId) {
      setPlanError("Choose an app before preparing an analytics report request.");
      return;
    }
    if (analyticsStatus?.state === "SYNCING") {
      setPlanError("Wait for the current analytics sync to finish before changing report requests.");
      return;
    }
    setPlanBusy(true);
    setPlanError(null);
    try {
      const response = await api.planAnalyticsReportRequest({ schemaVersion: 2, appId, accessType });
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
      await api.confirmAnalyticsReportRequest(plan);
      setPlan(null);
      setNotice(agentStatus.mode === "demo"
        ? "Demo analytics reports enabled in isolated sample data."
        : "Analytics request created at Apple. Reports can take time to appear before the first sync.");
      await refreshPortfolioContext();
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
  const sourceById = new Map((catalog?.sources ?? []).map((source) => [source.id, source]));
  const rosterGroups = (catalog?.sources ?? []).map((source) => ({
    source,
    apps: rosterApps.filter(({ app }) => app.sourceId === source.id),
  }));
  const accountCount = (catalog?.sources ?? []).reduce((total, source) => total + source.accounts.length, 0);
  const selectedSource = selectedScopeApp ? sourceById.get(selectedScopeApp.sourceId) ?? null : null;
  const activeSourceCoverage = currentPortfolioSnapshot?.sourceCoverage ?? analyticsStatus?.sources ?? [];
  const coverageProblems = activeSourceCoverage.filter((source) => source.state !== "READY");
  const coverageProblemLabels = coverageProblems.map((coverage) => {
    const source = sourceById.get(coverage.sourceId);
    return `${source ? sourceLabel(source) : "Connected account"}: ${coverageLabel(coverage)}`;
  });
  for (const source of catalog?.sources.filter((candidate) => candidate.state !== "READY") ?? []) {
    if (!coverageProblemLabels.some((candidate) => candidate.startsWith(`${sourceLabel(source)}:`))) {
      coverageProblemLabels.push(`${sourceLabel(source)}: ${source.state === "ERROR" ? "Couldn't check" : "Partial app roster"}`);
    }
  }
  const uniqueCoverageProblemLabels = [...new Set(coverageProblemLabels)];
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
  const inspectionByAppId = new Map((analyticsStatus?.reportRequestInspections ?? [])
    .map((inspection) => [inspection.appId, inspection]));
  const missingApps = analyticsStatus ? apps.filter((app) => (
    inspectionByAppId.get(app.id)?.state === "INSPECTED" && !enabledAppIds.has(app.id)
  )) : [];
  const unknownSetupApps = analyticsStatus ? apps.filter((app) => (
    inspectionByAppId.get(app.id)?.state !== "INSPECTED"
  )) : [];
  const missingAppIds = new Set(missingApps.map((app) => app.id));
  const unknownSetupAppIds = new Set(unknownSetupApps.map((app) => app.id));
  const hasAnyValue = currentSnapshot?.kpis.some((kpi) => kpi.current.value !== null) ?? false;
  const hasAnyPortfolioValue = currentPortfolioSnapshot?.kpis.some((kpi) => kpi.current.value !== null) ?? false;
  const loading = phase !== "idle" && (
    !catalog || !analyticsStatus || apps.length > 0 && resolvedQueryKey !== desiredQueryKey
  );
  const scopeTitle = scopeId === "all" ? "All accounts" : selectedScopeApp?.name ?? "App unavailable";
  const activeFilterCount = analyticsFilterCount(filters);
  const analyticsSyncing = analyticsStatus?.state === "SYNCING" || syncBusy;
  const setupAttentionCount = missingApps.length + unknownSetupApps.length;
  const setupNeedsAttention = setupAttentionCount > 0;
  const initialLoading = loading && !currentPortfolioSnapshot;
  const recoveryMode = !initialLoading && activeFilterCount === 0 && !hasAnyPortfolioValue;
  const hasCoverageConcern = Boolean(
    error
    || catalog && !catalog.complete
    || uniqueCoverageProblemLabels.length
    || setupNeedsAttention
    || analyticsStatus?.state === "ERROR"
    || analyticsStatus?.state === "PARTIAL"
    || analyticsStatus?.state === "WAITING_FOR_DATA"
    || analyticsStatus?.state === "SYNCING"
    || currentSnapshot?.freshness.partial,
  );

  const recoverySources = rosterGroups.map(({ source, apps: sourceApps }) => {
    const missingCount = sourceApps.filter(({ app }) => missingAppIds.has(app.id)).length;
    const unknownCount = sourceApps.filter(({ app }) => unknownSetupAppIds.has(app.id)).length;
    const setupCheckDetails = [...new Set(sourceApps.flatMap(({ app }) => {
      const inspection = inspectionByAppId.get(app.id);
      return inspection?.state === "UNKNOWN" ? [inspection.detail] : [];
    }))];
    const sourceCoverage = activeSourceCoverage.find((candidate) => candidate.sourceId === source.id);
    const attentionParts = [
      missingCount ? `${missingCount} ${missingCount === 1 ? "app needs" : "apps need"} reports enabled` : "",
      unknownCount ? `${unknownCount} setup ${unknownCount === 1 ? "check" : "checks"} didn't finish` : "",
    ].filter(Boolean);
    if (attentionParts.length) {
      return {
        id: source.id,
        name: sourceLabel(source),
        appCount: sourceApps.length,
        tone: "attention",
        label: "Setup needs attention",
        detail: attentionParts.join(" · "),
        technicalDetail: setupCheckDetails.join(" ") || sourceCoverage?.detail || source.detail,
      };
    }
    if (sourceCoverage?.state === "SYNCING") {
      return {
        id: source.id,
        name: sourceLabel(source),
        appCount: sourceApps.length,
        tone: "working",
        label: "Checking for data",
        detail: "ASC Studio is checking Apple's reports now.",
        technicalDetail: sourceCoverage.detail,
      };
    }
    if (source.state === "ERROR" || sourceCoverage?.state === "ERROR") {
      return {
        id: source.id,
        name: sourceLabel(source),
        appCount: sourceApps.length,
        tone: "attention",
        label: "Couldn't reach Apple",
        detail: "The saved connection is still here. Try the check again.",
        technicalDetail: sourceCoverage?.detail ?? source.detail,
      };
    }
    if (sourceCoverage?.state === "NO_DATA" || analyticsStatus?.state === "WAITING_FOR_DATA") {
      return {
        id: source.id,
        name: sourceLabel(source),
        appCount: sourceApps.length,
        tone: "waiting",
        label: "Waiting for data",
        detail: "Setup is ready; Apple hasn't supplied a complete report yet.",
        technicalDetail: sourceCoverage?.detail ?? source.detail,
      };
    }
    return {
      id: source.id,
      name: sourceLabel(source),
      appCount: sourceApps.length,
      tone: "ready",
      label: sourceApps.length ? "Ready to update" : "No apps found",
      detail: sourceApps.length ? "No portfolio values are stored yet." : "Apple returned no apps for this account.",
      technicalDetail: sourceCoverage?.detail ?? source.detail,
    };
  });

  const recoveryTitle = unknownSetupApps.length
    ? "Check analytics setup"
    : missingApps.length
      ? "Finish analytics setup"
      : error || analyticsStatus?.state === "ERROR"
        ? "We couldn't update analytics"
        : analyticsStatus?.state === "WAITING_FOR_DATA"
          ? "Apple is preparing your analytics"
          : !apps.length
            ? "No apps are available yet"
            : "No analytics data yet";
  const recoveryCopy = setupNeedsAttention
    ? `Your Apple connections are saved. Analytics Reports are enabled separately for each app, so ${setupAttentionCount} ${setupAttentionCount === 1 ? "app needs" : "apps need"} a setup check before the portfolio can fill in.`
    : error || analyticsStatus?.state === "ERROR"
      ? "Your saved connections and any existing data are untouched. Try the check again."
      : analyticsStatus?.state === "WAITING_FOR_DATA"
        ? "Setup is complete. Apple's first report can take time to appear; ASC Studio will keep existing data intact while it waits."
        : !apps.length
          ? "ASC Studio couldn't find any apps across the connected Apple accounts. Check again without switching accounts."
          : "The portfolio is ready, but no reported values have arrived. Check Apple for the latest data.";
  const recoveryActionLabel = setupNeedsAttention
    ? unknownSetupApps.length ? "Check setup again" : "Review setup"
    : error || analyticsStatus?.state === "ERROR" || !apps.length
      ? "Try again"
      : "Update data";
  const recoveryActionBusy = setupNeedsAttention && unknownSetupApps.length
    ? phase !== "idle"
    : setupNeedsAttention && missingApps.length
      ? planBusy
      : analyticsSyncing || phase !== "idle";

  const reviewSetup = () => {
    if (unknownSetupApps.length) {
      void checkPortfolio();
      return;
    }
    if (missingApps.length && setupAppId) {
      void prepareReportRequest("ONGOING", setupAppId);
      return;
    }
    void checkPortfolio();
  };

  const runRecoveryAction = () => {
    if (setupNeedsAttention) {
      reviewSetup();
      return;
    }
    if (error || analyticsStatus?.state === "ERROR" || !apps.length) {
      void checkPortfolio();
      return;
    }
    void syncReports();
  };

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
          <p>Portfolio performance across all your Apple accounts.</p>
        </div>
        {!initialLoading && !recoveryMode ? <div className="topbar-actions analytics-topbar-actions">
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
          <button className="button secondary" type="button" onClick={() => void syncReports()} disabled={analyticsSyncing || phase !== "idle" || !apps.length} aria-label={analyticsSyncing ? "Updating analytics for all accounts" : "Update analytics for all connected accounts"} title={agentStatus.mode === "demo" ? "Refresh the deterministic sample reports" : "Check Apple for new reports and refresh this view"}>
            <RefreshCw size={17} /><span>{analyticsSyncing ? "Updating…" : "Update data"}</span>
          </button>
        </div> : null}
      </header>

      {agentStatus.mode === "demo" ? (
        <div className="demo-banner analytics-demo-banner">
          <strong>Sample data</strong>
          <span>Portfolio totals and app contributions are deterministic fixtures; no Apple analytics data is read.</span>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {syncBusy ? "Syncing analytics reports for every connected account."
          : phase === "refreshing" ? "Refreshing the analytics view."
            : error ? `Analytics error: ${error}`
              : phase === "idle" ? "Analytics view ready." : "Loading analytics."}
      </p>

      {initialLoading ? (
        <section className="analytics-recovery-shell" aria-label="Loading analytics">
          <div className="analytics-recovery-card loading"><AnalyticsSkeleton /></div>
        </section>
      ) : recoveryMode ? (
        <section className="analytics-recovery-shell" aria-labelledby="analytics-recovery-title">
          <div className="analytics-recovery-card">
            <div className="analytics-recovery-intro">
              <span className="analytics-recovery-icon" aria-hidden="true"><Database size={24} /></span>
              <div>
                <span className="analytics-eyebrow">Portfolio setup</span>
                <h2 id="analytics-recovery-title">{recoveryTitle}</h2>
                <p>{recoveryCopy}</p>
              </div>
            </div>

            {recoverySources.length ? <div className="analytics-recovery-sources" aria-label="Analytics status by Apple account">
              {recoverySources.map((source) => (
                <div className="analytics-recovery-source" key={source.id}>
                  <div><strong>{source.name}</strong><small>{source.appCount} {source.appCount === 1 ? "app" : "apps"}</small></div>
                  <div className={`analytics-recovery-source-state ${source.tone}`}><span><i aria-hidden="true" />{source.label}</span><small>{source.detail}</small></div>
                </div>
              ))}
            </div> : null}

            <div className="analytics-recovery-footer">
              <div>
                <strong>{unknownSetupApps.length ? "We'll check Apple again before changing anything." : missingApps.length ? "We'll review one app at a time." : setupNeedsAttention ? "We'll check setup across every account." : "This checks every connected account."}</strong>
                <span>{unknownSetupApps.length
                  ? `${unknownSetupApps.length} ${unknownSetupApps.length === 1 ? "app has" : "apps have"} a setup check that didn't finish. Apps that already need reports will remain ready for review afterward.`
                  : missingApps.length
                  ? `First up: ${missingApps.find((app) => app.id === setupAppId)?.name ?? missingApps[0]?.name ?? "the first app that needs setup"}. Every Apple change still requires confirmation.`
                  : setupNeedsAttention ? "This check does not create or change anything at Apple." : "No app or account switching is required."}</span>
              </div>
              <button className="button primary" type="button" onClick={runRecoveryAction} disabled={recoveryActionBusy || !unknownSetupApps.length && setupNeedsAttention && missingApps.length > 0 && !setupAppId}>
                {recoveryActionBusy ? unknownSetupApps.length ? "Checking…" : missingApps.length ? "Preparing…" : setupNeedsAttention ? "Checking…" : "Updating…" : recoveryActionLabel}<ArrowRight size={16} />
              </button>
            </div>

            {planError && !plan ? <p className="analytics-recovery-error" role="alert">{planError}</p> : null}

            <details className="analytics-recovery-details">
              <summary>What ASC Studio checked</summary>
              <p>{setupNeedsAttention
                ? "An Admin key can authorize Analytics access, but Apple keeps the Analytics Reports request separate for each app. ASC Studio checks both before it creates or reads a report."
                : "ASC Studio checks the saved Apple connections, each app's report request, and locally stored report data as separate steps."}</p>
              <dl>
                <div><dt>Apple accounts</dt><dd>{accountCount || "None found"}</dd></div>
                <div><dt>Apps</dt><dd>{apps.length || "None found"}</dd></div>
                <div><dt>Reports enabled</dt><dd>{enabledAppIds.size}</dd></div>
                <div><dt>Need setup</dt><dd>{setupAttentionCount}</dd></div>
              </dl>
              {recoverySources.length ? <ul>{recoverySources.map((source) => <li key={source.id}><strong>{source.name}</strong><span>{source.technicalDetail}</span></li>)}</ul> : null}
              {error ? <p><strong>Latest error:</strong> {error}</p> : null}
              {!error && analyticsStatus?.detail ? <p><strong>Latest check:</strong> {analyticsStatus.detail}</p> : null}
              {notice ? <p><strong>Latest update:</strong> {notice}</p> : null}
            </details>
          </div>
        </section>
      ) : <>
      {hasCoverageConcern || notice ? (
        <div className={`analytics-coverage-summary${error || analyticsStatus?.state === "ERROR" ? " error" : ""}`} role={error || analyticsStatus?.state === "ERROR" ? "alert" : "status"}>
          {error || analyticsStatus?.state === "ERROR" ? <AlertTriangle size={18} /> : analyticsStatus?.state === "SYNCING" ? <RefreshCw size={18} /> : <Info size={18} />}
          <div>
            <strong>{error || analyticsStatus?.state === "ERROR"
              ? "Analytics couldn't update"
              : analyticsStatus?.state === "SYNCING"
                ? "Updating analytics"
                : setupNeedsAttention
                  ? `${setupAttentionCount} ${setupAttentionCount === 1 ? "app needs" : "apps need"} attention`
                  : hasCoverageConcern
                    ? "Some portfolio data is still catching up"
                    : "Analytics updated"}</strong>
            <span>{error || analyticsStatus?.state === "ERROR"
              ? "Existing numbers are safe. Use Update data to try again."
              : analyticsStatus?.state === "SYNCING"
                ? "Checking every connected account for new Apple reports."
                : setupNeedsAttention
                  ? `${missingApps.length ? `${missingApps.length} ${missingApps.length === 1 ? "app needs" : "apps need"} reports enabled` : ""}${missingApps.length && unknownSetupApps.length ? " · " : ""}${unknownSetupApps.length ? `${unknownSetupApps.length} setup ${unknownSetupApps.length === 1 ? "check didn't" : "checks didn't"} finish` : ""}. Available values stay visible; missing data is not counted as zero.`
                  : hasCoverageConcern
                    ? "Available values stay visible; missing account or report data is never counted as zero."
                    : notice}</span>
          </div>
          {setupNeedsAttention ? <button className="button secondary compact" type="button" onClick={reviewSetup} disabled={recoveryActionBusy || !unknownSetupApps.length && missingApps.length > 0 && !setupAppId}>{unknownSetupApps.length ? "Check setup" : "Review setup"}</button> : null}
        </div>
      ) : null}

      <div className="analytics-scope-select-wrap">
        <label>
          <span>View</span>
          <select value={scopeId} onChange={(event) => chooseScope(event.target.value)}>
            <option value="all">All accounts · {accountCount} {accountCount === 1 ? "account" : "accounts"} · {apps.length} {apps.length === 1 ? "app" : "apps"}</option>
            {rosterGroups.map(({ source, apps: sourceApps }) => <optgroup label={sourceLabel(source)} key={source.id}>{sourceApps.map(({ app }) => <option value={app.id} key={app.id}>{app.name}</option>)}</optgroup>)}
          </select>
        </label>
      </div>

      <div className="analytics-content">
        <aside className="analytics-roster" aria-label="Apps across all connected accounts">
          <header>
            <div><span className="analytics-eyebrow">Portfolio pulse</span><h2>All accounts</h2><small>{accountCount} {accountCount === 1 ? "account" : "accounts"} · {apps.length} {apps.length === 1 ? "app" : "apps"}</small></div>
          </header>
          <div className="analytics-roster-list">
            <button className={scopeId === "all" ? "analytics-roster-item selected portfolio" : "analytics-roster-item portfolio"} type="button" onClick={() => chooseScope("all")} aria-pressed={scopeId === "all"} aria-label={`All connected accounts, ${accountCount} accounts and ${apps.length} apps, ${portfolioKpi ? formatAnalyticsValueWithAvailability(portfolioKpi.current, portfolioKpi.unit) : "No analytics yet"}`}>
              <span className="analytics-app-mark portfolio"><AppWindow size={20} /></span>
              <span className="analytics-roster-copy"><strong>All accounts</strong><small>{accountCount} {accountCount === 1 ? "account" : "accounts"} · {apps.length} {apps.length === 1 ? "app" : "apps"}</small></span>
              <span className="analytics-roster-value"><strong>{portfolioKpi ? formatAnalyticsValue(portfolioKpi.current, portfolioKpi.unit) : "—"}</strong><small className={portfolioKpi?.current.availability === "AVAILABLE" || portfolioKpi?.current.availability === "PARTIAL" ? analyticsChangeTone(portfolioKpi.change) : "neutral"}>{portfolioKpi ? metricSupportingText(portfolioKpi.current.availability, formatAnalyticsChange(portfolioKpi.change, portfolioKpi.unit)) : "No analytics yet"}</small></span>
            </button>
            {rosterGroups.map(({ source, apps: sourceApps }) => {
              const sourceCoverage = activeSourceCoverage.find((candidate) => candidate.sourceId === source.id);
              const sourceState = sourceCoverage ? coverageLabel(sourceCoverage) : source.state === "READY" ? "Ready" : source.state === "PARTIAL" ? "Partial app roster" : "Couldn't check";
              const failedAccountDetail = source.accounts
                .filter((account) => account.state === "ERROR")
                .map((account) => `${account.profileName}: ${account.detail}`)
                .join(" ");
              return <section className="analytics-roster-group" aria-labelledby={`analytics-source-${source.id}`} key={source.id}>
                <header>
                  <strong id={`analytics-source-${source.id}`} title={sourceLabel(source)}>{sourceLabel(source)}</strong>
                  <span className={sourceCoverage?.state === "ERROR" || source.state === "ERROR" ? "error" : sourceCoverage?.state === "READY" && source.state === "READY" ? "ready" : "partial"}>{sourceState}</span>
                </header>
                {failedAccountDetail ? <p>{failedAccountDetail}</p> : source.state !== "READY" ? <p>{source.detail}</p> : null}
                {sourceApps.length ? sourceApps.map(({ app, contribution }) => {
                  const previous = contribution?.previousValue ?? null;
                  const change = contribution?.absoluteChange === null || contribution?.absoluteChange === undefined ? null : {
                    absolute: contribution.absoluteChange,
                    relative: previous === 0 || previous === null ? null : contribution.absoluteChange / previous,
                  };
                  const unit = rankingMetric === "PROCEEDS" ? "CURRENCY_USD" : "COUNT";
                  return (
                    <button className={scopeId === app.id ? "analytics-roster-item selected" : "analytics-roster-item"} type="button" key={app.id} onClick={() => chooseScope(app.id)} aria-pressed={scopeId === app.id} aria-label={`${app.name}, ${sourceLabel(source)}, ${formatAnalyticsValueWithAvailability(contribution ? { value: contribution.currentValue, availability: contribution.currentAvailability } : null, unit)}`}>
                      <span className="analytics-app-mark">{appInitials(app.name)}</span>
                      <span className="analytics-roster-copy"><strong>{app.name}</strong><small>{app.bundleId}</small></span>
                      <span className="analytics-roster-value"><strong>{formatAnalyticsValue(contribution ? { value: contribution.currentValue, availability: contribution.currentAvailability } : null, unit)}</strong><small className={contribution?.currentAvailability === "AVAILABLE" || contribution?.currentAvailability === "PARTIAL" ? analyticsChangeTone(change) : "neutral"}>{contribution ? metricSupportingText(contribution.currentAvailability, formatAnalyticsChange(change, unit), "No comparison") : "No analytics yet"}</small></span>
                    </button>
                  );
                }) : source.state === "READY" ? <p>{source.detail}</p> : null}
              </section>;
            })}
          </div>
          <footer>Apps are ranked within each account source by {analyticsMetricLabels[rankingMetric]}. Rates are recomputed from all-account totals.</footer>
        </aside>

        <div className="analytics-evidence">
          <section className="analytics-panel analytics-summary" aria-labelledby="analytics-summary-title">
            <header className="analytics-summary-header">
              <div>
                <span className="analytics-eyebrow">{scopeId === "all" ? `${accountCount} ${accountCount === 1 ? "account" : "accounts"} · ${apps.length} ${apps.length === 1 ? "app" : "apps"}` : `${selectedSource ? sourceLabel(selectedSource) : "Connected account"} · ${selectedScopeApp?.bundleId ?? "App"}`}</span>
                <h2 id="analytics-summary-title">{scopeTitle}</h2>
                <p>{scopeId === "all" ? "Combined performance across every connected App Store Connect account." : "App performance with the same date, comparison, and metric context; the operational account is unchanged."}</p>
              </div>
              <span className="analytics-data-mode">{agentStatus.mode === "demo" ? "Sample data" : "Apple reports"}</span>
            </header>
            {!loading && catalog && !apps.length ? (
              <div className="analytics-empty-state analytics-portfolio-empty" role={catalog.complete ? "status" : "alert"}>
                <AlertTriangle size={24} />
                <div>
                  <h2>{catalog.complete ? "No apps across the connected accounts" : "No complete account roster is available"}</h2>
                  <p>{catalog.complete ? "The connected App Store Connect accounts do not currently expose any apps." : "ASC Studio will not present missing accounts as a zero-value portfolio. Retry the account roster when those connections are available."}</p>
                </div>
                <button className="button secondary" type="button" onClick={() => void checkPortfolio()}>Try again</button>
              </div>
            ) : loading ? <AnalyticsSkeleton /> : currentSnapshot ? (
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
            ) : (
              <div className="analytics-empty-state" role="alert">
                <AlertTriangle size={24} />
                <div>
                  <h2>Analytics is unavailable</h2>
                  <p>{error ?? "The connected-account portfolio could not be loaded."}</p>
                </div>
                <button className="button secondary" type="button" onClick={() => void checkPortfolio()}>Try again</button>
              </div>
            )}
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
                <button className="button secondary" type="button" onClick={() => void syncReports()} disabled={analyticsSyncing}>Update data</button>
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
                      const contributionApp = apps.find((app) => app.id === contribution.appId);
                      const contributionSource = contributionApp ? sourceById.get(contributionApp.sourceId) : null;
                      const driverValue = contributionsUseShare ? contribution.shareOfPortfolioChange : contribution.absoluteChange;
                      const driverWidth = driverValue === null || !maximumContributionDriver ? 0 : Math.min(50, Math.abs(driverValue) / maximumContributionDriver * 50);
                      const change = contribution.absoluteChange === null ? null : {
                        absolute: contribution.absoluteChange,
                        relative: contribution.previousValue === null || contribution.previousValue === 0 ? null : contribution.absoluteChange / contribution.previousValue,
                      };
                      return (
                        <tr key={contribution.appId}>
                          <th scope="row" data-label="App"><span className="analytics-rank">{index + 1}</span><button type="button" onClick={() => chooseScope(contribution.appId)}><span>{contribution.appName}{contributionSource ? <small>{sourceLabel(contributionSource)}</small> : null}</span><ArrowRight size={14} /></button></th>
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
                <p><AppWindow size={18} /><span><strong>{scopeId === "all" ? "Portfolio scope" : "App scope"}</strong><small>{scopeId === "all" ? `${accountCount} ${accountCount === 1 ? "account" : "accounts"} · ${apps.length} ${apps.length === 1 ? "app" : "apps"}` : `${selectedScopeApp?.name ?? "App unavailable"} · ${selectedSource ? sourceLabel(selectedSource) : "Connected account"}`}</small></span></p>
                <p><Clock3 size={18} /><span><strong>Data through</strong><small>{currentSnapshot.freshness.dataThrough ? shortDate(currentSnapshot.freshness.dataThrough) : "No complete date yet"}</small></span></p>
                <p><RefreshCw size={18} /><span><strong>Local cache</strong><small>{relativeDateTime(currentSnapshot.freshness.syncedAt)}</small></span></p>
                <p><ShieldCheck size={18} /><span><strong>Privacy</strong><small>{currentSnapshot.privacy.mayIncludePrivacyAdjustments ? "Apple privacy processing applies" : "No privacy adjustment flagged"}</small></span></p>
              </div>
              <details><summary>Accounts, sources, and limitations</summary><p>{currentSnapshot.freshness.detail} {currentSnapshot.privacy.detail} Estimated proceeds can differ from final payments.</p><ul className="analytics-source-coverage-list">{currentSnapshot.sourceCoverage.map((coverage) => {
                const source = sourceById.get(coverage.sourceId);
                return <li key={coverage.sourceId}><strong>{source ? sourceLabel(source) : "Connected account"}</strong><span>{coverageLabel(coverage)} · {coverage.detail}</span></li>;
              })}</ul>{currentSnapshot.provenance.reportNames.length ? <ul>{currentSnapshot.provenance.reportNames.map((name) => <li key={name}>{name}</li>)}</ul> : null}</details>
              <details className="analytics-snapshot-details">
                <summary>Advanced: request older history</summary>
                <div className="analytics-snapshot-action">
                  <div><strong>One-time historical snapshot</strong><small>Ask Apple for older history without changing ongoing daily reports.</small></div>
                  <label><span className="sr-only">App and account for historical snapshot</span><select value={snapshotAppId} onChange={(event) => setSnapshotAppId(event.target.value)} disabled={analyticsSyncing}>{rosterGroups.map(({ source, apps: sourceApps }) => <optgroup label={sourceLabel(source)} key={source.id}>{sourceApps.map(({ app }) => <option value={app.id} key={app.id}>{app.name}</option>)}</optgroup>)}</select></label>
                  <button className="button secondary compact" type="button" onClick={() => void prepareReportRequest("ONE_TIME_SNAPSHOT", snapshotAppId)} disabled={planBusy || analyticsSyncing || !snapshotAppId}>Review request</button>
                </div>
              </details>
            </section>
          ) : null}
        </div>
      </div>
      </>}

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
