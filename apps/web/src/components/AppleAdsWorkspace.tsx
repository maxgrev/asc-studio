import type {
  AgentStatus,
  AppleAdsAdGroup,
  AppleAdsCampaign,
  AppleAdsCampaignMetrics,
  AppleAdsKeyword,
  AppleAdsKeywordResearchItem,
  AppleAdsKeywordResearchResult,
  AppleAdsMoney,
  AppleAdsStatus,
  AppSummary,
  CreateAppleAdsAdGroupInput,
  CreateAppleAdsCampaignInput,
  CreateAppleAdsKeywordInput,
  MutationPlan,
  UpdateAppleAdsCampaignInput,
  UpdateAppleAdsKeywordInput,
} from "@asc-studio/contracts";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Columns3,
  Edit3,
  KeyRound,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

interface AppleAdsWorkspaceProps {
  app: AppSummary;
  status: AgentStatus | null;
  onManageConnection: () => void;
  onUseInMetadata: (keyword: string) => void;
}

type AdsPlan = Extract<MutationPlan, { operation: `apple_ads.${string}` }>;
type CampaignDialogState = { mode: "create" } | { mode: "edit"; campaign: AppleAdsCampaign };
type KeywordDialogState = { research: AppleAdsKeywordResearchItem } | { keyword: AppleAdsKeyword };

const money = (value: AppleAdsMoney | null | undefined) => value
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: value.currency }).format(Number(value.amount))
  : "—";

const compactNumber = (value: number | undefined) => value === undefined
  ? "—"
  : new Intl.NumberFormat("en-US", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);

const percent = (value: number | undefined) => value === undefined
  ? "—"
  : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

const lastFourCompleteWeeks = () => {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 1) % 7));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  return { start: dateOnly(start), end: dateOnly(end) };
};

const recentReportRange = () => {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: dateOnly(start), end: dateOnly(end) };
};

const statusLabel = (value: string) => value.toLocaleLowerCase("en-US").replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
const sourceLabel = (value: AppleAdsKeywordResearchItem["source"]) => value === "both" ? "Suggestion + popularity" : statusLabel(value);

const asAdsPlan = (plan: MutationPlan): plan is AdsPlan => plan.operation.startsWith("apple_ads.");

const planRows = (plan: AdsPlan): Array<{ label: string; before: string; after: string }> => {
  switch (plan.operation) {
    case "apple_ads.campaign.create":
      return [
        { label: "Campaign", before: "Not created", after: plan.after.name },
        { label: "Status", before: "—", after: statusLabel(plan.after.status) },
        { label: "Daily budget", before: "—", after: money(plan.after.dailyBudget) },
        { label: "Countries", before: "—", after: plan.after.countriesOrRegions.join(", ") },
      ];
    case "apple_ads.campaign.update":
      return [
        ...(plan.before.name === plan.after.name ? [] : [{ label: "Name", before: plan.before.name, after: plan.after.name }]),
        ...(plan.before.status === plan.after.status ? [] : [{ label: "Status", before: statusLabel(plan.before.status), after: statusLabel(plan.after.status) }]),
        ...(JSON.stringify(plan.before.dailyBudget) === JSON.stringify(plan.after.dailyBudget) ? [] : [{ label: "Daily budget", before: money(plan.before.dailyBudget), after: money(plan.after.dailyBudget) }]),
        ...(JSON.stringify(plan.before.countriesOrRegions) === JSON.stringify(plan.after.countriesOrRegions) ? [] : [{ label: "Countries", before: plan.before.countriesOrRegions.join(", "), after: plan.after.countriesOrRegions.join(", ") }]),
        ...(plan.before.endTime === plan.after.endTime ? [] : [{ label: "End date", before: plan.before.endTime ?? "No end date", after: plan.after.endTime ?? "No end date" }]),
      ];
    case "apple_ads.ad_group.create":
      return [
        { label: "Ad group", before: "Not created", after: plan.after.name },
        { label: "Campaign", before: plan.target.campaignName, after: plan.target.campaignName },
        { label: "Status", before: "—", after: statusLabel(plan.after.status) },
        { label: "Default bid", before: "—", after: money(plan.after.bid) },
        { label: "Search Match", before: "—", after: plan.after.automatedKeywordsOptIn ? "On" : "Off" },
      ];
    case "apple_ads.keyword.create":
      return [
        { label: "Keyword", before: "Not created", after: plan.after.text },
        { label: "Ad group", before: plan.target.adGroupName, after: plan.target.adGroupName },
        { label: "Match type", before: "—", after: statusLabel(plan.after.matchType) },
        { label: "Bid", before: "—", after: plan.after.bid ? money(plan.after.bid) : "Use ad-group bid" },
        { label: "Status", before: "—", after: statusLabel(plan.after.status) },
      ];
    case "apple_ads.keyword.update":
      return [
        ...(JSON.stringify(plan.before.bid) === JSON.stringify(plan.after.bid) ? [] : [{ label: "Bid", before: money(plan.before.bid), after: money(plan.after.bid) }]),
        ...(plan.before.status === plan.after.status ? [] : [{ label: "Status", before: statusLabel(plan.before.status), after: statusLabel(plan.after.status) }]),
      ];
  }
};

const AppleAdsPlanDialog = ({ plan, busy, error, onConfirm, onClose }: {
  plan: AdsPlan;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) => {
  const rows = planRows(plan);
  const account = plan.context.appleAdsAdAccountId ?? "Unknown";
  const target = "campaignId" in plan.target ? plan.target.campaignId
    : "keywordId" in plan.target ? plan.target.keywordId
      : plan.target.promotedObjectId;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="dialog ads-review-dialog" role="dialog" aria-modal="true" aria-label="Review Apple Ads changes">
        <header className="dialog-header ads-review-header">
          <div><p className="ads-dialog-kicker">Apple Ads · {plan.context.appleAdsMode === "live" ? "Live account" : "Demo account"}</p><h2>Review {plan.operation === "apple_ads.campaign.create" ? "new campaign" : "Apple Ads changes"}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={19} /></button>
        </header>
        <div className="dialog-content">
          <div className="ads-spend-warning"><AlertTriangle size={17} /><span>{plan.context.appleAdsMode === "live" ? "This will update a live account and may affect spend." : "This changes isolated sample data only."}</span></div>
          <div className="ads-plan-grid" role="table" aria-label="Before and after values">
            <div className="ads-plan-heading" role="row"><span /> <strong>Current</strong><strong>Update</strong></div>
            {rows.map((row) => <div className="ads-plan-row" role="row" key={row.label}><strong>{row.label}</strong><span>{row.before}</span><span>{row.after}</span></div>)}
            <div className="ads-plan-meta"><span>Account · <code>{account}</code></span><span>Target · <code>{target}</code></span></div>
          </div>
          <div className="ads-recheck-note"><ShieldCheck size={18} /><span>ASC Studio will re-check the target before applying this plan.</span></div>
        </div>
        {error ? <div className="dialog-error" role="alert">{error}</div> : null}
        <footer className="dialog-footer"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Applying…" : "Confirm changes"}</button></footer>
      </section>
    </div>
  );
};

const CampaignFormDialog = ({ state, app, onPlan, onClose }: {
  state: CampaignDialogState;
  app: AppSummary;
  onPlan: (input: CreateAppleAdsCampaignInput | UpdateAppleAdsCampaignInput) => Promise<void>;
  onClose: () => void;
}) => {
  const campaign = state.mode === "edit" ? state.campaign : null;
  const [template, setTemplate] = useState("Category");
  const [name, setName] = useState(campaign?.name ?? `${app.name} · Category`);
  const [budget, setBudget] = useState(campaign?.dailyBudget.amount ?? "20.00");
  const [currency] = useState(campaign?.dailyBudget.currency ?? "USD");
  const [countries, setCountries] = useState((campaign?.countriesOrRegions ?? ["US"]).join(", "));
  const [endDate, setEndDate] = useState(campaign?.endTime?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validBudget = /^\d+(?:\.\d+)?$/.test(budget) && Number(budget) > 0;
  const countryValues = countries.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
  const validCountries = countryValues.length > 0 && countryValues.every((value) => /^[A-Z]{2}$/.test(value));

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      if (campaign) {
        await onPlan({
          campaignId: campaign.id,
          name,
          dailyBudget: { amount: budget, currency },
          countriesOrRegions: countryValues,
          endTime: endDate ? `${endDate}T23:59:59.000` : null,
        });
      } else {
        await onPlan({
          promotedObjectId: app.id,
          name,
          dailyBudget: { amount: budget, currency },
          countriesOrRegions: countryValues,
          startTime: null,
          endTime: endDate ? `${endDate}T23:59:59.000` : null,
          status: "PAUSED",
          bidStrategyType: "MANUAL_CPT",
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ASC Studio could not prepare the campaign plan.");
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation"><section className="dialog ads-form-dialog" role="dialog" aria-modal="true" aria-label={campaign ? "Edit campaign" : "New campaign"}>
      <header className="dialog-header"><div><h2>{campaign ? "Edit campaign" : "New Apple Ads campaign"}</h2><p>{campaign ? "Choose the fields to change, then review them." : "Start with a paused search-results campaign."}</p></div><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={19} /></button></header>
      <div className="dialog-content ads-form-grid">
        {!campaign ? <label className="ads-field full"><span>Campaign intent</span><div className="ads-template-picker">{["Brand", "Category", "Competitor", "Discovery"].map((value) => <button className={template === value ? "active" : ""} type="button" onClick={() => { setTemplate(value); setName(`${app.name} · ${value}`); }} key={value}>{value}</button>)}</div></label> : null}
        <label className="ads-field full"><span>Campaign name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></label>
        <label className="ads-field"><span>Daily budget</span><div className="ads-money-input"><span>$</span><input inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} /><code>{currency}</code></div></label>
        <label className="ads-field"><span>End date</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        <label className="ads-field full"><span>Countries / regions</span><input value={countries} onChange={(event) => setCountries(event.target.value)} placeholder="US, CA" /><small>Use comma-separated two-letter country codes.</small></label>
        {!campaign ? <div className="ads-safe-default full"><CirclePause size={17} /><span>The campaign will be created paused. Add an ad group and keywords before enabling it.</span></div> : null}
      </div>
      {error ? <div className="dialog-error" role="alert">{error}</div> : null}
      <footer className="dialog-footer"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="button" disabled={busy || !name.trim() || !validBudget || !validCountries} onClick={() => void review()}>{busy ? "Preparing…" : "Review campaign"}</button></footer>
    </section></div>
  );
};

const AdGroupFormDialog = ({ campaign, onPlan, onClose }: {
  campaign: AppleAdsCampaign;
  onPlan: (input: CreateAppleAdsAdGroupInput) => Promise<void>;
  onClose: () => void;
}) => {
  const [name, setName] = useState(`${campaign.name} · Exact`);
  const [bid, setBid] = useState("1.00");
  const [searchMatch, setSearchMatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await onPlan({ campaignId: campaign.id, name, bid: { amount: bid, currency: campaign.dailyBudget.currency }, automatedKeywordsOptIn: searchMatch, startTime: null, endTime: null, status: "PAUSED" });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "ASC Studio could not prepare the ad-group plan."); setBusy(false); }
  };
  return <div className="dialog-backdrop"><section className="dialog ads-form-dialog" role="dialog" aria-modal="true" aria-label="New ad group"><header className="dialog-header"><div><h2>New ad group</h2><p>{campaign.name}</p></div><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={19} /></button></header><div className="dialog-content ads-form-grid"><label className="ads-field full"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="ads-field"><span>Default max CPT bid</span><div className="ads-money-input"><span>$</span><input value={bid} inputMode="decimal" onChange={(event) => setBid(event.target.value)} /><code>{campaign.dailyBudget.currency}</code></div></label><label className="ads-check-field"><input type="checkbox" checked={searchMatch} onChange={(event) => setSearchMatch(event.target.checked)} /><span><strong>Search Match</strong><small>Let Apple match this ad group to relevant searches.</small></span></label><div className="ads-safe-default full"><CirclePause size={17} /><span>The ad group will be created paused.</span></div></div>{error ? <div className="dialog-error">{error}</div> : null}<footer className="dialog-footer"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="button" onClick={() => void submit()} disabled={busy || !name.trim() || !/^\d+(?:\.\d+)?$/.test(bid)}>Review ad group</button></footer></section></div>;
};

const KeywordFormDialog = ({ state, campaign, adGroups, onCreatePlan, onUpdatePlan, onClose }: {
  state: KeywordDialogState;
  campaign: AppleAdsCampaign;
  adGroups: AppleAdsAdGroup[];
  onCreatePlan: (input: CreateAppleAdsKeywordInput) => Promise<void>;
  onUpdatePlan: (input: UpdateAppleAdsKeywordInput) => Promise<void>;
  onClose: () => void;
}) => {
  const existing = "keyword" in state ? state.keyword : null;
  const [adGroupId, setAdGroupId] = useState(existing?.adGroupId ?? adGroups[0]?.id ?? "");
  const [text] = useState(existing?.text ?? ("research" in state ? state.research.text : ""));
  const [matchType, setMatchType] = useState<"EXACT" | "BROAD">((existing?.matchType === "BROAD" ? "BROAD" : "EXACT"));
  const [bid, setBid] = useState(existing?.bid?.amount ?? "1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (existing) await onUpdatePlan({ keywordId: existing.id, bid: { amount: bid, currency: existing.bid?.currency ?? campaign.dailyBudget.currency } });
      else await onCreatePlan({ campaignId: campaign.id, adGroupId, text, matchType, bid: { amount: bid, currency: campaign.dailyBudget.currency }, status: "PAUSED" });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "ASC Studio could not prepare the keyword plan."); setBusy(false); }
  };
  return <div className="dialog-backdrop"><section className="dialog ads-form-dialog" role="dialog" aria-modal="true" aria-label={existing ? "Edit keyword" : "Add keyword"}><header className="dialog-header"><div><h2>{existing ? "Edit keyword bid" : "Add keyword to campaign"}</h2><p>{campaign.name}</p></div><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={19} /></button></header><div className="dialog-content ads-form-grid"><label className="ads-field full"><span>Keyword</span><input value={text} disabled /></label>{!existing ? <><label className="ads-field"><span>Ad group</span><select value={adGroupId} onChange={(event) => setAdGroupId(event.target.value)}>{adGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label><label className="ads-field"><span>Match type</span><select value={matchType} onChange={(event) => setMatchType(event.target.value as "EXACT" | "BROAD")}><option value="EXACT">Exact</option><option value="BROAD">Broad</option></select></label></> : null}<label className="ads-field"><span>Max CPT bid</span><div className="ads-money-input"><span>$</span><input value={bid} inputMode="decimal" onChange={(event) => setBid(event.target.value)} /><code>{existing?.bid?.currency ?? campaign.dailyBudget.currency}</code></div></label>{!existing ? <div className="ads-safe-default full"><CirclePause size={17} /><span>The keyword will be created paused.</span></div> : null}</div>{error ? <div className="dialog-error">{error}</div> : null}<footer className="dialog-footer"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="button" onClick={() => void submit()} disabled={busy || !adGroupId || !/^\d+(?:\.\d+)?$/.test(bid)}>Review keyword</button></footer></section></div>;
};

export const AppleAdsWorkspace = ({ app, status, onManageConnection, onUseInMetadata }: AppleAdsWorkspaceProps) => {
  const [adsStatus, setAdsStatus] = useState<AppleAdsStatus | null>(null);
  const [campaigns, setCampaigns] = useState<AppleAdsCampaign[]>([]);
  const [adGroups, setAdGroups] = useState<AppleAdsAdGroup[]>([]);
  const [keywords, setKeywords] = useState<AppleAdsKeyword[]>([]);
  const [metrics, setMetrics] = useState<Map<string, AppleAdsCampaignMetrics>>(new Map());
  const [pendingPlans, setPendingPlans] = useState<AdsPlan[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [tab, setTab] = useState<"campaigns" | "research">("campaigns");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaignDialog, setCampaignDialog] = useState<CampaignDialogState | null>(null);
  const [adGroupDialog, setAdGroupDialog] = useState(false);
  const [keywordDialog, setKeywordDialog] = useState<KeywordDialogState | null>(null);
  const [reviewPlan, setReviewPlan] = useState<AdsPlan | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [seedTerms, setSeedTerms] = useState("notes, writing, tasks");
  const [country, setCountry] = useState("US");
  const [genre, setGenre] = useState("PRODUCTIVITY_UTILITIES");
  const [research, setResearch] = useState<AppleAdsKeywordResearchResult | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [selectedResearchText, setSelectedResearchText] = useState<string | null>(null);
  const reportRange = useMemo(recentReportRange, []);
  const researchRange = useMemo(lastFourCompleteWeeks, []);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? campaigns[0] ?? null;
  const selectedResearch = research?.keywords.find((keyword) => keyword.text === selectedResearchText) ?? research?.keywords[0] ?? null;

  const loadPendingPlans = useCallback(async () => {
    const response = await api.pendingPlans();
    setPendingPlans(response.plans.filter(asAdsPlan));
  }, []);

  const loadCampaignDetails = useCallback(async (campaignId: string) => {
    const [groupResponse, keywordResponse] = await Promise.all([
      api.appleAdsAdGroups(campaignId),
      api.appleAdsKeywords({ campaignId }),
    ]);
    setAdGroups(groupResponse.adGroups);
    setKeywords(keywordResponse.keywords);
  }, []);

  const loadWorkspace = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const nextStatus = await api.appleAdsStatus();
      setAdsStatus(nextStatus);
      if (!nextStatus.connected) {
        setCampaigns([]);
        setAdGroups([]);
        setKeywords([]);
        setMetrics(new Map());
        setSelectedCampaignId(null);
        await loadPendingPlans();
        return;
      }
      const campaignResponse = await api.appleAdsCampaigns(app.id);
      setCampaigns(campaignResponse.campaigns);
      const nextSelected = campaignResponse.campaigns.find((campaign) => campaign.id === selectedCampaignId)?.id ?? campaignResponse.campaigns[0]?.id ?? null;
      setSelectedCampaignId(nextSelected);
      const reportEntries = await Promise.all(campaignResponse.campaigns.slice(0, 20).map(async (campaign) => {
        try {
          const response = await api.appleAdsCampaignReport({ campaignId: campaign.id, ...reportRange, timeZone: "ORTZ" });
          return [campaign.id, response.report] as const;
        } catch {
          return null;
        }
      }));
      setMetrics(new Map(reportEntries.filter((entry): entry is NonNullable<typeof entry> => entry !== null)));
      if (nextSelected) await loadCampaignDetails(nextSelected);
      else { setAdGroups([]); setKeywords([]); }
      await loadPendingPlans();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ASC Studio could not load Apple Ads.");
    } finally {
      setLoading(false); setSyncing(false);
    }
  }, [app.id, loadCampaignDetails, loadPendingPlans, reportRange, selectedCampaignId]);

  useEffect(() => { void loadWorkspace(); }, [app.id]);
  useEffect(() => { if (selectedCampaignId) void loadCampaignDetails(selectedCampaignId).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load campaign details.")); }, [selectedCampaignId]);

  const visibleCampaigns = campaigns.filter((campaign) => (
    campaign.name.toLocaleLowerCase("en-US").includes(campaignSearch.toLocaleLowerCase("en-US"))
    && (statusFilter === "ALL" || campaign.status === statusFilter)
  ));
  const totals = [...metrics.values()].reduce((summary, value) => ({
    spend: summary.spend + Number(value.localSpend?.amount ?? 0),
    installs: summary.installs + value.totalInstalls,
  }), { spend: 0, installs: 0 });
  const currency = [...metrics.values()].find((value) => value.localSpend)?.localSpend?.currency ?? selectedCampaign?.dailyBudget.currency ?? "USD";

  const preparePlan = async (action: () => Promise<{ plan: MutationPlan }>) => {
    const response = await action();
    if (!asAdsPlan(response.plan)) throw new Error("ASC Studio returned the wrong plan type.");
    setCampaignDialog(null); setAdGroupDialog(false); setKeywordDialog(null); setReviewError(null); setReviewPlan(response.plan);
    await loadPendingPlans();
  };

  const confirmPlan = async () => {
    if (!reviewPlan) return;
    setReviewBusy(true); setReviewError(null);
    try {
      await api.confirmPlan(reviewPlan);
      setReviewPlan(null);
      await loadWorkspace(true);
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : "ASC Studio could not apply the plan.");
    } finally { setReviewBusy(false); }
  };

  const planCampaignStatus = async (campaign: AppleAdsCampaign) => {
    await preparePlan(() => api.planAppleAdsCampaignUpdate({ campaignId: campaign.id, status: campaign.status === "ENABLED" ? "PAUSED" : "ENABLED" }));
  };

  const researchKeywords = async () => {
    setResearchBusy(true); setError(null);
    try {
      const response = await api.researchAppleAdsKeywords({ appId: app.id, countryOrRegion: country, genre, ...researchRange, granularity: "WEEKLY_SUN_SAT", seedTerms: seedTerms.split(",").map((value) => value.trim()).filter(Boolean), limit: 50 });
      setResearch(response.research);
      setSelectedResearchText(response.research.keywords[0]?.text ?? null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "ASC Studio could not research keywords."); }
    finally { setResearchBusy(false); }
  };

  return <>
    <main className="workspace ads-workspace">
      <header className="topbar ads-topbar"><div><h1>Apple Ads</h1><p>Research demand, inspect performance, and manage search campaigns.</p></div><div className="topbar-actions"><button className="button secondary" type="button" onClick={onManageConnection}><Settings2 size={17} /><span>Apple services</span></button><button className="button secondary" type="button" disabled={syncing || !adsStatus?.connected} onClick={() => { setSyncing(true); void loadWorkspace(true); }}><RefreshCw className={syncing ? "spin" : ""} size={17} /><span>Sync</span></button><button className="button primary" type="button" disabled={!adsStatus?.connected} onClick={() => setCampaignDialog({ mode: "create" })}><Plus size={17} /><span>New campaign</span></button></div></header>
      {status?.mode === "demo" ? <div className="demo-banner"><strong>Demo mode</strong><span>Actions only change isolated sample data.</span></div> : null}
      {error ? <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
      {!loading && adsStatus && !adsStatus.connected ? <div className="ads-connection-empty"><span><BadgeDollarSign size={26} /></span><h2>Connect Apple Ads</h2><p>Keep this app’s store and campaign work under one Apple organization while using separate API credentials for each service.</p><button className="button primary" type="button" onClick={onManageConnection}><KeyRound size={17} />Connect Apple Ads</button></div> : <div className="ads-content">
        <section className="ads-summary" aria-label="Apple Ads account summary"><div><small>Ad account</small><strong>{adsStatus?.adAccountId ?? "Not configured"}</strong></div><div><small>Currency</small><strong>{currency}</strong></div><div><small>Date range</small><strong>{reportRange.start} – {reportRange.end}</strong></div><div><small>Spend</small><strong>{money({ amount: totals.spend.toFixed(2), currency })}</strong></div><div><small>Installs</small><strong>{compactNumber(totals.installs)}</strong></div><div><small>Avg. CPA</small><strong>{totals.installs ? money({ amount: (totals.spend / totals.installs).toFixed(2), currency }) : "—"}</strong></div></section>
        <div className="ads-tabs" role="tablist"><button className={tab === "campaigns" ? "active" : ""} type="button" role="tab" aria-selected={tab === "campaigns"} onClick={() => setTab("campaigns")}>Campaigns</button><button className={tab === "research" ? "active" : ""} type="button" role="tab" aria-selected={tab === "research"} onClick={() => setTab("research")}>Keyword research</button></div>
        {tab === "campaigns" ? <section className="ads-panel">
          <div className="ads-toolbar"><label className="ads-search"><Search size={17} /><input value={campaignSearch} onChange={(event) => setCampaignSearch(event.target.value)} placeholder="Search campaigns" /></label><label className="ads-filter"><ListFilter size={16} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option><option value="ENABLED">Enabled</option><option value="PAUSED">Paused</option></select><ChevronDown size={15} /></label><button className="button secondary ads-columns" type="button"><Columns3 size={16} />Columns</button></div>
          <div className="ads-table-wrap"><table className="ads-table"><thead><tr><th>Campaign</th><th>Status</th><th>Daily budget</th><th>Spend</th><th>Installs</th><th>Avg. CPA</th><th /></tr></thead><tbody>{loading ? [0, 1, 2, 3].map((row) => <tr className="skeleton-row" key={row}>{[0, 1, 2, 3, 4, 5, 6].map((cell) => <td key={cell}><span /></td>)}</tr>) : visibleCampaigns.map((campaign) => { const report = metrics.get(campaign.id); return <tr className={campaign.id === selectedCampaign?.id ? "selected" : ""} tabIndex={0} onClick={() => setSelectedCampaignId(campaign.id)} key={campaign.id}><td><strong>{campaign.name}</strong><small>{campaign.id}</small></td><td><span className={`ads-status ${campaign.status === "ENABLED" ? "enabled" : "paused"}`}><i />{statusLabel(campaign.status)}</span></td><td>{money(campaign.dailyBudget)}</td><td>{money(report?.localSpend)}</td><td>{compactNumber(report?.totalInstalls)}</td><td>{money(report?.averageCostPerAcquisition)}</td><td><ChevronRight size={16} /></td></tr>; })}{!loading && visibleCampaigns.length === 0 ? <tr><td className="ads-empty-row" colSpan={7}>No campaigns match this view.</td></tr> : null}</tbody></table></div>
        </section> : <section className="ads-panel research-panel">
          <div className="research-toolbar"><label><span>Country</span><select value={country} onChange={(event) => setCountry(event.target.value)}><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option><option value="AU">Australia</option></select><ChevronDown size={15} /></label><label><span>Genre</span><select value={genre} onChange={(event) => setGenre(event.target.value)}><option value="PRODUCTIVITY_UTILITIES">Productivity &amp; Utilities</option><option value="BUSINESS">Business</option><option value="LIFESTYLE">Lifestyle</option></select><ChevronDown size={15} /></label><label><span>Period</span><strong>Last 4 complete weeks</strong><CalendarDays size={15} /></label><label className="research-seeds"><span>Seed terms</span><input value={seedTerms} onChange={(event) => setSeedTerms(event.target.value)} /></label><button className="button primary" type="button" disabled={researchBusy} onClick={() => void researchKeywords()}><Sparkles size={16} />{researchBusy ? "Researching…" : "Research keywords"}</button></div>
          <div className="research-note"><BarChart3 size={16} /><span>Apple popularity is relative. Apple Ads does not provide keyword difficulty, so ASC Studio does not invent one.</span></div>
          <div className="ads-table-wrap"><table className="ads-table research-table"><thead><tr><th>Keyword</th><th>Source</th><th>Apple popularity</th><th>Genre rank</th><th>Tier</th><th>Opportunity</th></tr></thead><tbody>{research?.keywords.map((keyword) => <tr className={keyword.text === selectedResearch?.text ? "selected" : ""} tabIndex={0} onClick={() => setSelectedResearchText(keyword.text)} key={keyword.text}><td><strong>{keyword.text}</strong></td><td><span className="source-badge">{sourceLabel(keyword.source)}</span></td><td><span className="popularity-cell"><i><b style={{ width: `${keyword.searchPopularity ?? keyword.suggestionPopularity ?? 0}%` }} /></i><strong>{keyword.searchPopularity ?? keyword.suggestionPopularity ?? "—"}</strong></span></td><td>{keyword.rankInGenre ? `#${keyword.rankInGenre}` : "—"}</td><td>{keyword.searchPopularityTier ? `${keyword.searchPopularityTier} / 5` : "—"}</td><td><strong className="opportunity-score">{keyword.opportunityScore}</strong></td></tr>)}{!research ? <tr><td className="ads-empty-row" colSpan={6}><Target size={23} /><strong>Run first-party keyword research</strong><span>Combine app suggestions with Apple’s search-term popularity signal.</span></td></tr> : null}</tbody></table></div>
        </section>}
        <footer className="ads-dock"><div><span className={pendingPlans.length ? "activity-dot warning" : "activity-dot success"} /><strong>{pendingPlans.length ? `${pendingPlans.length} change${pendingPlans.length === 1 ? "" : "s"} await review` : "No pending changes"}</strong><span>{adsStatus?.connected ? "Apple Ads connected" : "Apple Ads unavailable"}</span></div>{pendingPlans[0] ? <button className="button secondary" type="button" onClick={() => setReviewPlan(pendingPlans[0]!)}>Review pending</button> : null}<button className="button primary" type="button" onClick={() => setTab(tab === "research" ? "campaigns" : "research")}><Target size={16} />{tab === "research" ? "View campaigns" : "Research keywords"}</button></footer>
      </div>}
    </main>
    <aside className="inspector ads-inspector" aria-label={tab === "campaigns" ? "Campaign details" : "Keyword details"}>
      {!loading && adsStatus && !adsStatus.connected ? <div className="ads-inspector-placeholder"><KeyRound size={25} /><strong>Separate service key</strong><span>Apple Ads uses its own OAuth credentials and roles.</span></div> : tab === "campaigns" && selectedCampaign ? <><header className="inspector-header"><div><h2>{selectedCampaign.name}</h2><code>{selectedCampaign.id}</code></div></header><dl className="ads-inspector-details"><div><dt>Status</dt><dd><span className={`ads-status ${selectedCampaign.status === "ENABLED" ? "enabled" : "paused"}`}><i />{statusLabel(selectedCampaign.status)}</span></dd></div><div><dt>Daily budget</dt><dd>{money(selectedCampaign.dailyBudget)}</dd></div><div><dt>Bid strategy</dt><dd>{statusLabel(selectedCampaign.bidStrategyType)}</dd></div><div><dt>Placements</dt><dd>{selectedCampaign.supplyPlacements.map(statusLabel).join(", ")}</dd></div><div><dt>Countries / Regions</dt><dd>{selectedCampaign.countriesOrRegions.join(", ")}</dd></div><div><dt>Tap-through rate</dt><dd>{percent(metrics.get(selectedCampaign.id)?.tapThroughRate)}</dd></div></dl><section className="ads-inspector-section"><header><div><h3>Ad groups</h3><span>{adGroups.length}</span></div><button className="icon-button" type="button" onClick={() => setAdGroupDialog(true)} aria-label="New ad group"><Plus size={17} /></button></header>{adGroups.map((group) => <div className="ads-entity-row" key={group.id}><div><strong>{group.name}</strong><small>{group.automatedKeywordsOptIn ? "Search Match · " : ""}{money(group.bid)} bid</small></div><span className={`ads-status ${group.status === "ENABLED" ? "enabled" : "paused"}`}><i />{statusLabel(group.status)}</span></div>)}{!adGroups.length ? <p className="ads-inspector-empty">No ad groups yet.</p> : null}</section><section className="ads-inspector-section keyword-section"><header><div><h3>Keywords</h3><span>{keywords.length}</span></div></header>{keywords.slice(0, 8).map((keyword) => <div className="ads-entity-row keyword-row" key={keyword.id}><button type="button" onClick={() => setKeywordDialog({ keyword })}><span><strong>{keyword.text}</strong><small>{statusLabel(keyword.matchType)} · {money(keyword.bid)}</small></span><Edit3 size={14} /></button><button className={keyword.status === "ENABLED" ? "pause" : "enable"} type="button" aria-label={`${keyword.status === "ENABLED" ? "Pause" : "Enable"} ${keyword.text}`} onClick={() => void preparePlan(() => api.planAppleAdsKeywordUpdate({ keywordId: keyword.id, status: keyword.status === "ENABLED" ? "PAUSED" : "ENABLED" }))}>{keyword.status === "ENABLED" ? <CirclePause size={15} /> : <CirclePlay size={15} />}</button></div>)}</section><div className="inspector-buttons"><button className="button secondary full" type="button" onClick={() => setCampaignDialog({ mode: "edit", campaign: selectedCampaign })}><Edit3 size={16} />Edit campaign</button><button className={selectedCampaign.status === "ENABLED" ? "button danger-outline full" : "button secondary full"} type="button" onClick={() => void planCampaignStatus(selectedCampaign)}>{selectedCampaign.status === "ENABLED" ? <CirclePause size={16} /> : <CirclePlay size={16} />}{selectedCampaign.status === "ENABLED" ? "Pause campaign" : "Enable campaign"}</button></div></> : selectedResearch ? <><header className="inspector-header"><div><h2>{selectedResearch.text}</h2><code>Keyword signal</code></div></header><div className="keyword-score-card"><small>Opportunity</small><strong>{selectedResearch.opportunityScore}</strong><span>First-party relative signal</span></div><dl className="ads-inspector-details"><div><dt>Source</dt><dd>{sourceLabel(selectedResearch.source)}</dd></div><div><dt>Apple popularity</dt><dd>{selectedResearch.searchPopularity ?? "—"} / 100</dd></div><div><dt>Genre popularity</dt><dd>{selectedResearch.searchPopularityInGenre ?? "—"} / 100</dd></div><div><dt>Genre rank</dt><dd>{selectedResearch.rankInGenre ? `#${selectedResearch.rankInGenre}` : "—"}</dd></div><div><dt>Popularity tier</dt><dd>{selectedResearch.searchPopularityTier ? `${selectedResearch.searchPopularityTier} / 5` : "—"}</dd></div><div><dt>Difficulty</dt><dd>Not available</dd></div></dl><div className="keyword-explainer"><KeyRound size={17} /><p><strong>How to use this signal</strong><span>Test high-popularity terms in a focused ad group. Keep relevance and conversion quality ahead of raw popularity.</span></p></div><div className="inspector-buttons"><button className="button primary full" type="button" disabled={!selectedCampaign || !adGroups.length} onClick={() => setKeywordDialog({ research: selectedResearch })}><Plus size={16} />Add to campaign</button><button className="button secondary full" type="button" onClick={() => onUseInMetadata(selectedResearch.text)}><Check size={16} />Use in metadata draft</button></div></> : <div className="ads-inspector-placeholder"><Target size={25} /><strong>Select a row</strong><span>Campaign or keyword details appear here.</span></div>}
    </aside>
    {campaignDialog ? <CampaignFormDialog state={campaignDialog} app={app} onClose={() => setCampaignDialog(null)} onPlan={(input) => "campaignId" in input ? preparePlan(() => api.planAppleAdsCampaignUpdate(input)) : preparePlan(() => api.planAppleAdsCampaignCreate(input))} /> : null}
    {adGroupDialog && selectedCampaign ? <AdGroupFormDialog campaign={selectedCampaign} onClose={() => setAdGroupDialog(false)} onPlan={(input) => preparePlan(() => api.planAppleAdsAdGroupCreate(input))} /> : null}
    {keywordDialog && selectedCampaign ? <KeywordFormDialog state={keywordDialog} campaign={selectedCampaign} adGroups={adGroups} onClose={() => setKeywordDialog(null)} onCreatePlan={(input) => preparePlan(() => api.planAppleAdsKeywordCreate(input))} onUpdatePlan={(input) => preparePlan(() => api.planAppleAdsKeywordUpdate(input))} /> : null}
    {reviewPlan ? <AppleAdsPlanDialog plan={reviewPlan} busy={reviewBusy} error={reviewError} onClose={() => { if (!reviewBusy) { setReviewPlan(null); setReviewError(null); } }} onConfirm={() => void confirmPlan()} /> : null}
  </>;
};
