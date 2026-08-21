import type {
  AgentStatus,
  AppleAdsCampaign,
  AppleAdsConnectionResponse,
  AppStoreVersion,
  AppSummary,
  AuditEvent,
  BuildSummary,
  MutationPlan,
  VersionLocalization,
} from "@asc-studio/contracts";
import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  CircleAlert,
  Clock3,
  FileText,
  RefreshCw,
  Send,
  Settings2,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import {
  localeNames,
  metadataIssues,
  platformLabel,
  versionStateLabel,
} from "../releaseMetadata.js";
import {
  activePlans,
  budgetSummary,
  campaignCounts,
  matchingBuild,
  pendingPlanCountLabel,
  relativeTime,
  selectPrimaryRelease,
  sortBuilds,
  sortVersions,
} from "../overviewData.js";
import type { WorkspaceSection } from "./Sidebar.js";

interface OverviewWorkspaceProps {
  app: AppSummary;
  status: AgentStatus;
  appleAdsConnection: AppleAdsConnectionResponse;
  onNavigate: (section: WorkspaceSection) => void;
  onManageAppleServices: () => void;
}

interface OverviewSnapshot {
  builds: BuildSummary[] | null;
  versions: AppStoreVersion[] | null;
  localizations: VersionLocalization[] | null;
  localizationVersionId: string | null;
  campaigns: AppleAdsCampaign[] | null;
  events: AuditEvent[] | null;
  plans: MutationPlan[] | null;
}

type OverviewSection = "releases" | "localizations" | "testflight" | "appleAds" | "activity" | "plans";
type OverviewErrors = Partial<Record<OverviewSection, string>>;

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

const formatMoney = (amount: string, currency: string) => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`;
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric)} ${currency}`;
};

const eventArea = (operation: string) => {
  if (operation.startsWith("apple_ads.")) return "Apple Ads";
  if (operation.startsWith("build.") || operation.startsWith("builds.")) return "TestFlight";
  if (operation.startsWith("version.")) return "Releases";
  return "Workspace";
};

const toneForCampaign = (campaign: AppleAdsCampaign) => campaign.status.toUpperCase() === "ENABLED" ? "success" : "warning";

const OverviewSkeleton = () => (
  <div className="overview-skeleton" aria-hidden="true">
    <span /><span /><span /><span />
  </div>
);

const InlineError = ({ message, label, onRetry }: { message: string; label: string; onRetry: () => void }) => (
  <div className="overview-inline-error" role="alert">
    <CircleAlert size={15} />
    <span>{message}</span>
    <button type="button" aria-label={`Retry loading ${label}`} onClick={onRetry}>Retry</button>
  </div>
);

const EmptyState = ({ children }: { children: string }) => (
  <p className="overview-empty">{children}</p>
);

export const OverviewWorkspace = ({
  app,
  status,
  appleAdsConnection,
  onNavigate,
  onManageAppleServices,
}: OverviewWorkspaceProps) => {
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [errors, setErrors] = useState<OverviewErrors>({});
  const [phase, setPhase] = useState<"initial" | "refreshing" | "idle">("initial");
  const generation = useRef(0);
  const snapshotRef = useRef<OverviewSnapshot | null>(null);
  const loadedOnce = useRef(false);
  const adsConnected = appleAdsConnection.status.connected;

  const loadOverview = useCallback(async () => {
    const currentGeneration = ++generation.current;
    setPhase(loadedOnce.current ? "refreshing" : "initial");

    const [versionsResult, buildsResult, campaignsResult, activityResult, plansResult] = await Promise.allSettled([
      api.versionsAllPlatforms(app.id),
      api.builds(app.id),
      adsConnected ? api.appleAdsCampaigns(app.id) : Promise.resolve({ campaigns: [] }),
      api.activity(),
      api.pendingPlans(),
    ]);
    if (currentGeneration !== generation.current) return;

    const previous = snapshotRef.current;
    const nextErrors: OverviewErrors = {};
    const versions = versionsResult.status === "fulfilled" ? versionsResult.value.versions : previous?.versions ?? null;
    const builds = buildsResult.status === "fulfilled" ? buildsResult.value.builds : previous?.builds ?? null;
    const campaigns = campaignsResult.status === "fulfilled" ? campaignsResult.value.campaigns : previous?.campaigns ?? null;
    const events = activityResult.status === "fulfilled" ? activityResult.value.events : previous?.events ?? null;
    const plans = plansResult.status === "fulfilled" ? plansResult.value.plans : previous?.plans ?? null;

    if (versionsResult.status === "rejected") nextErrors.releases = errorMessage(versionsResult.reason, "Releases could not be loaded.");
    if (buildsResult.status === "rejected") nextErrors.testflight = errorMessage(buildsResult.reason, "TestFlight builds could not be loaded.");
    if (campaignsResult.status === "rejected") nextErrors.appleAds = errorMessage(campaignsResult.reason, "Apple Ads campaigns could not be loaded.");
    if (activityResult.status === "rejected") nextErrors.activity = errorMessage(activityResult.reason, "Workspace activity could not be loaded.");
    if (plansResult.status === "rejected") nextErrors.plans = errorMessage(plansResult.reason, "Pending plans could not be loaded.");

    const primaryRelease = selectPrimaryRelease(versions ?? [], builds ?? []);
    let localizationVersionId = previous?.localizationVersionId ?? null;
    let localizations = localizationVersionId === primaryRelease?.id ? previous?.localizations ?? null : null;
    if (primaryRelease) {
      try {
        const response = await api.localizations(app.id, primaryRelease.id);
        if (currentGeneration !== generation.current) return;
        localizations = response.localizations;
        localizationVersionId = primaryRelease.id;
      } catch (error) {
        nextErrors.localizations = errorMessage(error, "Release-copy checks could not be loaded.");
      }
    } else if (versionsResult.status === "fulfilled") {
      localizations = [];
      localizationVersionId = null;
    }

    if (currentGeneration !== generation.current) return;
    const nextSnapshot: OverviewSnapshot = { builds, versions, localizations, localizationVersionId, campaigns, events, plans };
    snapshotRef.current = nextSnapshot;
    loadedOnce.current = true;
    setSnapshot(nextSnapshot);
    setErrors(nextErrors);
    setPhase("idle");
  }, [adsConnected, app.id]);

  useEffect(() => {
    void loadOverview();
    return () => {
      generation.current += 1;
    };
  }, [loadOverview]);

  const builds = useMemo(() => sortBuilds(snapshot?.builds ?? []), [snapshot?.builds]);
  const versions = useMemo(() => sortVersions(snapshot?.versions ?? []), [snapshot?.versions]);
  const primaryRelease = useMemo(() => selectPrimaryRelease(versions, builds), [versions, builds]);
  const releaseBuild = useMemo(() => matchingBuild(primaryRelease, builds), [primaryRelease, builds]);
  const localizations = snapshot?.localizations ?? [];
  const campaigns = snapshot?.campaigns ?? [];
  const adsCounts = useMemo(() => campaignCounts(campaigns), [campaigns]);
  const currentCampaigns = useMemo(() => campaigns.filter((campaign) => !campaign.deleted), [campaigns]);
  const plans = useMemo(() => activePlans(snapshot?.plans ?? []), [snapshot?.plans]);
  const planCount = pendingPlanCountLabel(snapshot?.plans ?? [], plans.length);
  const plansCapped = (snapshot?.plans?.length ?? 0) >= 50;
  const loading = phase === "initial" && snapshot === null;
  const errorCount = Object.keys(errors).length;

  return (
    <main className="workspace overview-workspace" aria-busy={phase !== "idle"}>
      <header className="topbar overview-topbar">
        <div>
          <h1>Overview</h1>
          <p>Release, TestFlight, and Apple Ads status for {app.name}.</p>
        </div>
        <button
          className={phase === "refreshing" ? "button secondary overview-refresh refreshing" : "button secondary overview-refresh"}
          type="button"
          disabled={phase !== "idle"}
          aria-label={phase === "idle" ? "Refresh overview" : "Refreshing overview"}
          onClick={() => void loadOverview()}
        >
          <RefreshCw size={17} />
          <span>{phase === "refreshing" ? "Refreshing" : "Refresh"}</span>
        </button>
      </header>

      {status.mode === "demo" ? (
        <div className="demo-banner">
          <strong>Demo mode</strong>
          <span>Actions only change isolated sample data.</span>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {phase === "refreshing"
          ? "Refreshing overview data."
          : phase === "idle" && errorCount
            ? `Overview refreshed with ${errorCount} unavailable section${errorCount === 1 ? "" : "s"}.`
            : phase === "idle"
              ? "Overview data is current."
              : "Loading overview data."}
      </p>

      <div className="overview-content">
        <div className="overview-matrix">
          <section className="overview-panel overview-release-panel" aria-labelledby="overview-release-title">
            <header className="overview-panel-header">
              <div>
                <span className="overview-panel-icon"><FileText size={17} /></span>
                <h2 id="overview-release-title">Release</h2>
              </div>
              <button className="overview-panel-action" type="button" onClick={() => onNavigate("releases")}>
                Open releases <ArrowRight size={15} />
              </button>
            </header>

            {loading ? <OverviewSkeleton /> : errors.releases && !snapshot?.versions ? (
              <InlineError message={errors.releases} label="releases" onRetry={() => void loadOverview()} />
            ) : primaryRelease ? (
              <>
                {errors.releases ? <InlineError message={errors.releases} label="releases" onRetry={() => void loadOverview()} /> : null}
                <div className="overview-release-heading">
                  <div>
                    <strong>Release {primaryRelease.versionString}</strong>
                    <span>{versionStateLabel(primaryRelease.state)}</span>
                  </div>
                  {!primaryRelease.editable ? <span className="overview-neutral-badge">Read only</span> : null}
                </div>
                <dl className="overview-release-summary">
                  <div><dt>Platform</dt><dd>{platformLabel(primaryRelease.platform)}</dd></div>
                  <div><dt>Version</dt><dd>{primaryRelease.versionString}</dd></div>
                  <div><dt>Status</dt><dd>{versionStateLabel(primaryRelease.state)}</dd></div>
                  <div><dt>Latest build</dt><dd>{releaseBuild?.buildNumber ?? "None"}</dd></div>
                  <div><dt>Locales</dt><dd>{snapshot?.localizations === null ? "—" : localizations.length}</dd></div>
                </dl>

                {errors.localizations ? <InlineError message={errors.localizations} label="release-copy checks" onRetry={() => void loadOverview()} /> : null}
                {snapshot?.localizations === null ? null : localizations.length ? (
                  <div className="overview-table-wrap overview-localization-table-wrap">
                    <table className="overview-table overview-localization-table">
                      <caption className="sr-only">Release-copy checks for release {primaryRelease.versionString}</caption>
                      <thead><tr><th>Locale</th><th>What’s New</th><th>Promo text</th><th>Keywords</th><th>Copy checks</th></tr></thead>
                      <tbody>
                        {localizations.slice(0, 6).map((localization) => {
                          const issues = metadataIssues(localization);
                          return (
                            <tr key={localization.id}>
                              <td><strong>{localeNames[localization.locale]}</strong><small>{localization.locale}</small></td>
                              <td className={localization.whatsNew.trim() ? "" : "overview-warning-text"}>{localization.whatsNew.trim() ? "Present" : "Missing"}</td>
                              <td>{localization.promotionalText.trim() ? "Present" : "Empty"}</td>
                              <td className="mono">{localization.keywords.length}/100</td>
                              <td><span className={`status ${issues.length ? "status-warning" : "status-success"}`}><span />{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : "No copy issues"}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {localizations.length > 6 ? <p className="overview-table-note">{localizations.length - 6} more locales in Releases</p> : null}
                  </div>
                ) : <EmptyState>No localizations are available for this release.</EmptyState>}
              </>
            ) : (
              <>
                {errors.releases ? <InlineError message={errors.releases} label="releases" onRetry={() => void loadOverview()} /> : null}
                <EmptyState>No App Store releases are available for this app.</EmptyState>
              </>
            )}
          </section>

          <section className="overview-panel overview-testflight-panel" aria-labelledby="overview-testflight-title">
            <header className="overview-panel-header">
              <div>
                <span className="overview-panel-icon"><Send size={17} /></span>
                <h2 id="overview-testflight-title">TestFlight</h2>
              </div>
              <button className="overview-panel-action" type="button" onClick={() => onNavigate("testflight")}>
                View TestFlight <ArrowRight size={15} />
              </button>
            </header>

            {loading ? <OverviewSkeleton /> : errors.testflight && !snapshot?.builds ? (
              <InlineError message={errors.testflight} label="TestFlight" onRetry={() => void loadOverview()} />
            ) : builds.length ? (
              <>
                {errors.testflight ? <InlineError message={errors.testflight} label="TestFlight" onRetry={() => void loadOverview()} /> : null}
                <div className="overview-testflight-hero">
                  <div><span>Latest build</span><strong>{builds[0]!.buildNumber}</strong></div>
                  <div><span>Status</span><strong className={`status status-${builds[0]!.processingTone}`}><span />{builds[0]!.processingStatus}</strong></div>
                  <div><span>Audience</span><strong>{builds[0]!.testingStatus}</strong></div>
                </div>
                <dl className="overview-detail-list">
                  <div><dt><UsersRound size={16} /> Tester groups</dt><dd>{builds[0]!.groups.length || "None"}</dd></div>
                  <div><dt><Clock3 size={16} /> Uploaded</dt><dd><time dateTime={builds[0]!.uploadedAt}>{relativeTime(builds[0]!.uploadedAt)}</time></dd></div>
                  <div><dt><Send size={16} /> Platform</dt><dd>{platformLabel(builds[0]!.platform)}</dd></div>
                  <div><dt><Clock3 size={16} /> Expires</dt><dd>{builds[0]!.expiresAt ? relativeTime(builds[0]!.expiresAt) : "Unavailable"}</dd></div>
                </dl>
                <div className="overview-compact-rows" aria-label="Recent TestFlight builds">
                  {builds.slice(1, 4).map((build) => (
                    <div key={build.id}>
                      <span><strong>Build {build.buildNumber}</strong><small>{build.version} · {platformLabel(build.platform)}</small></span>
                      <span className={`status status-${build.processingTone}`}><span />{build.processingStatus}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                {errors.testflight ? <InlineError message={errors.testflight} label="TestFlight" onRetry={() => void loadOverview()} /> : null}
                <EmptyState>No TestFlight builds are available for this app.</EmptyState>
              </>
            )}
          </section>

          <section className="overview-panel overview-ads-panel" aria-labelledby="overview-ads-title">
            <header className="overview-panel-header">
              <div>
                <span className="overview-panel-icon"><BadgeDollarSign size={17} /></span>
                <h2 id="overview-ads-title">Apple Ads</h2>
              </div>
              <button className="overview-panel-action" type="button" onClick={adsConnected ? () => onNavigate("apple-ads") : onManageAppleServices}>
                {adsConnected ? "Open Apple Ads" : "Manage services"} {adsConnected ? <ArrowRight size={15} /> : <Settings2 size={15} />}
              </button>
            </header>

            {!adsConnected ? (
              <div className="overview-service-empty">
                <span className="status"><span />Not connected</span>
                <p>{appleAdsConnection.status.detail}</p>
              </div>
            ) : loading ? <OverviewSkeleton /> : errors.appleAds && !snapshot?.campaigns ? (
              <InlineError message={errors.appleAds} label="Apple Ads" onRetry={() => void loadOverview()} />
            ) : (
              <>
                {errors.appleAds ? <InlineError message={errors.appleAds} label="Apple Ads" onRetry={() => void loadOverview()} /> : null}
                <dl className="overview-ads-summary">
                  <div><dt>Status</dt><dd><span className="status status-success"><span />Connected</span></dd></div>
                  <div><dt>Campaigns</dt><dd>{adsCounts.total} total</dd></div>
                  <div><dt>Enabled</dt><dd>{adsCounts.enabled}</dd></div>
                  <div><dt>Paused</dt><dd>{adsCounts.paused}</dd></div>
                  <div><dt>Daily budget</dt><dd>{budgetSummary(campaigns)}</dd></div>
                </dl>
                {currentCampaigns.length ? (
                  <div className="overview-table-wrap">
                    <table className="overview-table overview-campaign-table">
                      <caption className="sr-only">Apple Ads campaigns for {app.name}</caption>
                      <thead><tr><th>Campaign</th><th>Status</th><th>Daily budget</th><th>Countries / Regions</th></tr></thead>
                      <tbody>
                        {currentCampaigns.slice(0, 4).map((campaign) => (
                          <tr key={campaign.id}>
                            <td><strong>{campaign.name}</strong></td>
                            <td><span className={`status status-${toneForCampaign(campaign)}`}><span />{campaign.status.toLowerCase()}</span></td>
                            <td>{formatMoney(campaign.dailyBudget.amount, campaign.dailyBudget.currency)}</td>
                            <td>{campaign.countriesOrRegions.join(", ") || "None"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {currentCampaigns.length > 4 ? <p className="overview-table-note">{currentCampaigns.length - 4} more campaigns in Apple Ads</p> : null}
                  </div>
                ) : <EmptyState>No Apple Ads campaigns target this app.</EmptyState>}
              </>
            )}
          </section>

          <section className="overview-panel overview-activity-panel" aria-labelledby="overview-activity-title">
            <header className="overview-panel-header">
              <div>
                <span className="overview-panel-icon"><Activity size={17} /></span>
                <h2 id="overview-activity-title">Recent activity</h2>
              </div>
              <span className="overview-scope-label">Workspace-wide</span>
            </header>

            {loading ? <OverviewSkeleton /> : errors.activity && !snapshot?.events ? (
              <InlineError message={errors.activity} label="recent activity" onRetry={() => void loadOverview()} />
            ) : snapshot?.events?.length ? (
              <>
                {errors.activity ? <InlineError message={errors.activity} label="recent activity" onRetry={() => void loadOverview()} /> : null}
                <ol className="overview-activity-list">
                  {snapshot.events.slice(0, 4).map((event) => (
                    <li key={event.id}>
                      <span className={`overview-activity-icon ${event.status}`}><Activity size={15} /></span>
                      <span><strong>{event.summary}</strong><small>{eventArea(event.operation)} · {event.phase}</small></span>
                      <time dateTime={event.timestamp}>{relativeTime(event.timestamp)}</time>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <>
                {errors.activity ? <InlineError message={errors.activity} label="recent activity" onRetry={() => void loadOverview()} /> : null}
                <EmptyState>No activity has been recorded in this workspace yet.</EmptyState>
              </>
            )}
          </section>
        </div>

        <section className={plans.length || plansCapped ? "overview-workspace-status has-pending" : "overview-workspace-status"} aria-label="Workspace plan status">
          {errors.plans ? (
            <>
              <CircleAlert size={17} />
              <strong>Workspace plan status unavailable</strong>
              <button type="button" aria-label="Retry loading workspace plan status" onClick={() => void loadOverview()}>Retry</button>
            </>
          ) : loading ? (
            <><span className="overview-status-dot" /><strong>Reading workspace plans</strong></>
          ) : plans.length ? (
            <>
              <span className="overview-status-dot" />
              <strong>{planCount} workspace plan{planCount === "1" ? "" : "s"} awaiting review</strong>
              <span>Plans expire automatically and must be confirmed in their workspace.</span>
            </>
          ) : plansCapped ? (
            <>
              <span className="overview-status-dot" />
              <strong>Workspace plan count is incomplete</strong>
              <span>Fifty records were returned, but none remain actionable; additional plans may exist.</span>
            </>
          ) : (
            <>
              <span className="overview-status-dot" />
              <strong>No workspace plans awaiting review</strong>
              <span>External writes still require an exact review and confirmation.</span>
            </>
          )}
          <span className="overview-status-spacer" />
          <span className="overview-profile">{status.mode === "demo" ? "Demo workspace" : status.profile ?? "Live workspace"}</span>
        </section>
      </div>
    </main>
  );
};
