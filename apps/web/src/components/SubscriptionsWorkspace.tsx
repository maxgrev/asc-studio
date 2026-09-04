import type {
  AgentStatus,
  AppSummary,
  SubscriptionParityRecommendation,
  SubscriptionPrice,
  SubscriptionSummary,
  UpdateSubscriptionPricesMutationPlan,
} from "@asc-studio/contracts";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Database,
  LoaderCircle,
  Minus,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";

interface SubscriptionsWorkspaceProps {
  app: AppSummary;
  status: AgentStatus;
}

type ReviewFilter = "all" | "changes" | "protected";

const dateFromToday = (offset: number) => {
  const today = new Date();
  const date = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + offset));
  return date.toISOString().slice(0, 10);
};

const formatMoney = (amount: string, currency: string) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
};

const periodLabels: Record<SubscriptionSummary["period"], string> = {
  ONE_WEEK: "Weekly",
  ONE_MONTH: "Monthly",
  TWO_MONTHS: "Every two months",
  THREE_MONTHS: "Quarterly",
  SIX_MONTHS: "Every six months",
  ONE_YEAR: "Yearly",
};

const currentPriceState = (prices: SubscriptionPrice[]) => {
  const today = dateFromToday(0);
  const byTerritory = new Map<string, SubscriptionPrice[]>();
  for (const price of prices) {
    const values = byTerritory.get(price.territory) ?? [];
    values.push(price);
    byTerritory.set(price.territory, values);
  }
  return [...byTerritory.entries()].flatMap(([territory, values]) => {
    const current = values
      .filter((price) => price.startDate === null || price.startDate <= today)
      .sort((left, right) => (left.startDate ?? "0000-00-00").localeCompare(right.startDate ?? "0000-00-00"))
      .at(-1);
    if (!current) return [];
    return [{
      territory,
      current,
      scheduled: values.filter((price) => price.startDate !== null && price.startDate > today)
        .sort((left, right) => left.startDate!.localeCompare(right.startDate!)),
    }];
  }).sort((left, right) => left.territory.localeCompare(right.territory));
};

const reasonLabel = (recommendation: SubscriptionParityRecommendation) => {
  switch (recommendation.reason) {
    case "base": return "Base storefront";
    case "floor": return "Revenue floor";
    case "no_data": return "Held · no data";
    case "scheduled": return "Held · already scheduled";
    case "ppp": return "Softened parity";
  }
};

const ChangeMark = ({ recommendation }: { recommendation: SubscriptionParityRecommendation }) => {
  if (recommendation.change === "decrease") return <span className="subscription-change decrease"><ArrowDown size={14} /> Lower</span>;
  if (recommendation.change === "increase") return <span className="subscription-change increase"><ArrowUp size={14} /> Raise · preserve</span>;
  if (recommendation.change === "protected") return <span className="subscription-change protected"><Clock3 size={14} /> Protected</span>;
  return <span className="subscription-change unchanged"><Minus size={14} /> No change</span>;
};

export const SubscriptionsWorkspace = ({ app, status }: SubscriptionsWorkspaceProps) => {
  const [subscriptions, setSubscriptions] = useState<SubscriptionSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [prices, setPrices] = useState<SubscriptionPrice[]>([]);
  const [baseTerritory, setBaseTerritory] = useState("USA");
  const [strengthPercent, setStrengthPercent] = useState(50);
  const [floorPercent, setFloorPercent] = useState(70);
  const [startDate, setStartDate] = useState(() => dateFromToday(7));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [loading, setLoading] = useState(true);
  const [priceLoading, setPriceLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<UpdateSubscriptionPricesMutationPlan | null>(null);
  const [reviewAccepted, setReviewAccepted] = useState(false);
  const generation = useRef(0);
  const planningGeneration = useRef(0);
  const policyRevision = useRef(0);
  const pricesSectionRef = useRef<HTMLElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);

  const selected = subscriptions.find((subscription) => subscription.id === selectedId) ?? null;
  const currentRows = useMemo(() => currentPriceState(prices), [prices]);

  const clearReview = useCallback(() => {
    setPlan(null);
    setReviewAccepted(false);
  }, []);

  const invalidateReview = useCallback(() => {
    planningGeneration.current += 1;
    policyRevision.current += 1;
    clearReview();
    setNotice(null);
  }, [clearReview]);

  const loadSubscriptions = useCallback(async (manual = false) => {
    const requestGeneration = ++generation.current;
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await api.subscriptions(app.id);
      if (requestGeneration !== generation.current) return;
      setSubscriptions(response.subscriptions);
      setSelectedId((current) => response.subscriptions.some((subscription) => subscription.id === current)
        ? current
        : response.subscriptions[0]?.id ?? "");
      clearReview();
    } catch (caught) {
      if (requestGeneration !== generation.current) return;
      setError(caught instanceof Error ? caught.message : "ASC Studio could not load subscriptions.");
    } finally {
      if (requestGeneration === generation.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [app.id, clearReview]);

  const loadPrices = useCallback(async (subscriptionId: string) => {
    if (!subscriptionId) {
      setPrices([]);
      return;
    }
    const requestGeneration = ++generation.current;
    setPriceLoading(true);
    setError(null);
    try {
      const response = await api.subscriptionPrices(app.id, subscriptionId, "UPFRONT");
      if (requestGeneration !== generation.current) return;
      setPrices(response.prices);
      const rows = currentPriceState(response.prices);
      setBaseTerritory((current) => rows.some((row) => row.territory === current)
        ? current
        : rows.some((row) => row.territory === "USA") ? "USA" : rows[0]?.territory ?? "USA");
    } catch (caught) {
      if (requestGeneration !== generation.current) return;
      setPrices([]);
      setError(caught instanceof Error ? caught.message : "ASC Studio could not load subscription prices.");
    } finally {
      if (requestGeneration === generation.current) setPriceLoading(false);
    }
  }, [app.id]);

  useEffect(() => { void loadSubscriptions(); }, [loadSubscriptions]);
  useEffect(() => {
    invalidateReview();
    void loadPrices(selectedId);
  }, [invalidateReview, loadPrices, selectedId]);

  const refresh = async () => {
    invalidateReview();
    await loadSubscriptions(true);
    if (selectedId) await loadPrices(selectedId);
  };

  const buildReview = async () => {
    if (!selected) return;
    const requestGeneration = ++planningGeneration.current;
    const requestRevision = policyRevision.current;
    setPlanning(true);
    setError(null);
    setNotice(null);
    clearReview();
    try {
      const response = await api.planSubscriptionPrices({
        appId: app.id,
        subscriptionId: selected.id,
        planType: "UPFRONT",
        baseTerritory,
        floorPercent,
        strengthPercent,
        startDate,
      });
      if (
        requestGeneration !== planningGeneration.current
        || requestRevision !== policyRevision.current
      ) return;
      setPlan(response.plan);
      window.requestAnimationFrame(() => {
        if (requestGeneration !== planningGeneration.current) return;
        reviewHeadingRef.current?.focus({ preventScroll: true });
        pricesSectionRef.current?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
      });
    } catch (caught) {
      if (requestGeneration !== planningGeneration.current) return;
      setError(caught instanceof Error ? caught.message : "ASC Studio could not build the parity pricing review.");
    } finally {
      setPlanning(false);
    }
  };

  const applyPlan = async () => {
    if (!plan || !reviewAccepted) return;
    setApplying(true);
    setError(null);
    try {
      await api.confirmPlan(plan);
      const scheduledCount = plan.after.summary.changes;
      clearReview();
      setNotice(`${scheduledCount} price change${scheduledCount === 1 ? " was" : "s were"} scheduled for ${startDate}.`);
      await loadPrices(selectedId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ASC Studio could not schedule the reviewed prices.");
    } finally {
      setApplying(false);
    }
  };

  const recommendations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (plan?.after.recommendations ?? []).filter((recommendation) => {
      if (filter === "changes" && !["increase", "decrease"].includes(recommendation.change)) return false;
      if (filter === "protected" && recommendation.change !== "protected" && recommendation.reason !== "floor") return false;
      return !normalized || [recommendation.territory, recommendation.territoryName, recommendation.currency]
        .join(" ").toLocaleLowerCase().includes(normalized);
    });
  }, [filter, plan, query]);

  const visibleCurrentRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return currentRows.filter((row) => !normalized || [row.territory, row.current.currency]
      .join(" ").toLocaleLowerCase().includes(normalized));
  }, [currentRows, query]);

  const updatePolicy = (update: () => void) => {
    invalidateReview();
    update();
  };

  const policyLocked = planning || applying;

  return (
    <main className="workspace subscriptions-workspace">
      <header className="topbar subscriptions-topbar">
        <div>
          <h1>Subscriptions</h1>
          <p>Set local prices with purchasing-power evidence and a hard revenue floor.</p>
        </div>
        <div className="topbar-actions">
          <button className="button secondary" type="button" disabled={refreshing || loading || policyLocked} onClick={() => void refresh()}>
            <RefreshCw size={17} className={refreshing ? "spin" : ""} /> <span>{refreshing ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
      </header>

      {status.mode === "demo" ? <div className="demo-banner"><CircleDollarSign size={17} /><span><strong>Demo data.</strong> Pricing plans are isolated and never reach App Store Connect.</span></div> : null}
      {notice ? <div className="subscriptions-notice" role="status"><Check size={17} /><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>Dismiss</button></div> : null}
      {error ? <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}

      {loading ? (
        <div className="subscriptions-loading"><LoaderCircle className="spin" size={22} /><span>Loading subscriptions…</span></div>
      ) : subscriptions.length === 0 ? (
        <div className="subscriptions-empty">
          <CircleDollarSign size={30} />
          <h2>No subscriptions found</h2>
          <p>Create an auto-renewable subscription in App Store Connect, then refresh this workspace.</p>
          <button className="button secondary" type="button" onClick={() => void refresh()}>Refresh subscriptions</button>
        </div>
      ) : (
        <div className="subscriptions-content">
          <section className="subscriptions-policy" aria-labelledby="pricing-policy-title">
            <div className="subscriptions-policy-heading">
              <div>
                <h2 id="pricing-policy-title">Pricing policy</h2>
                <p>Balanced parity closes half the local purchasing-power gap, then refuses to go below your floor.</p>
              </div>
              <div className="subscription-safety-mark"><ShieldCheck size={18} /><span>Rounds up to Apple’s next price point</span></div>
            </div>

            <div className="subscriptions-policy-grid">
              <label className="subscription-field subscription-product-field">
                <span>Subscription</span>
                <div className="subscription-select">
                  <select value={selectedId} disabled={policyLocked || refreshing} onChange={(event) => {
                    invalidateReview();
                    setSelectedId(event.target.value);
                  }}>
                    {subscriptions.map((subscription) => <option value={subscription.id} key={subscription.id}>{subscription.groupName} · {subscription.name}</option>)}
                  </select>
                  <ChevronDown size={15} />
                </div>
                {selected ? <small>{periodLabels[selected.period]} · {selected.productId}</small> : null}
              </label>

              <label className="subscription-field">
                <span>Base storefront</span>
                <div className="subscription-select">
                  <select value={baseTerritory} disabled={policyLocked || priceLoading || currentRows.length === 0} onChange={(event) => updatePolicy(() => setBaseTerritory(event.target.value))}>
                    {currentRows.map((row) => <option value={row.territory} key={row.territory}>{row.territory} · {formatMoney(row.current.customerPrice, row.current.currency)}</option>)}
                  </select>
                  <ChevronDown size={15} />
                </div>
                <small>The reference price Apple equalizes worldwide.</small>
              </label>

              <fieldset className="subscription-field subscription-strength-field" disabled={policyLocked}>
                <legend>Parity strength</legend>
                <div className="subscription-strength" role="group" aria-label="Parity strength">
                  {[{ label: "Careful", value: 25 }, { label: "Balanced", value: 50 }, { label: "Stronger", value: 75 }].map((choice) => (
                    <button className={strengthPercent === choice.value ? "active" : ""} type="button" aria-pressed={strengthPercent === choice.value} onClick={() => updatePolicy(() => setStrengthPercent(choice.value))} key={choice.value}>{choice.label}</button>
                  ))}
                </div>
                <small>{strengthPercent}% of the purchasing-power gap is localized.</small>
              </fieldset>

              <label className="subscription-field">
                <span>Revenue floor</span>
                <div className="subscription-select">
                  <select value={floorPercent} disabled={policyLocked} onChange={(event) => updatePolicy(() => setFloorPercent(Number(event.target.value)))}>
                    {[60, 65, 70, 75, 80, 85, 90].map((value) => <option value={value} key={value}>{value}% of comparable</option>)}
                  </select>
                  <ChevronDown size={15} />
                </div>
                <small>No recommendation can undercut this band.</small>
              </label>

              <label className="subscription-field">
                <span>Effective date</span>
                <input type="date" value={startDate} min={dateFromToday(2)} max={dateFromToday(180)} disabled={policyLocked} onChange={(event) => updatePolicy(() => setStartDate(event.target.value))} />
                <small>Future schedules are reviewed before Apple is called.</small>
              </label>

              <div className="subscription-build-action">
                <button className="button primary" type="button" disabled={policyLocked || priceLoading || !selected || currentRows.length === 0} onClick={() => void buildReview()}>
                  {planning ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}
                  {planning ? "Building review…" : "Build price review"}
                </button>
                <span>{currentRows.length} storefront{currentRows.length === 1 ? "" : "s"} available</span>
              </div>
            </div>

            <div className="subscriptions-method">
              <span><Database size={15} /> World Bank PPP and market exchange rates</span>
              <span><ShieldCheck size={15} /> Missing data stays unchanged</span>
              <span><Clock3 size={15} /> Existing schedules stay untouched</span>
            </div>
          </section>

          <section className="subscriptions-prices" aria-labelledby="storefront-prices-title" ref={pricesSectionRef}>
            <div className="subscriptions-prices-heading">
              <div>
                <h2 id="storefront-prices-title" tabIndex={-1} ref={reviewHeadingRef}>{plan ? "Exact price review" : "Current storefront prices"}</h2>
                <p>{plan ? `Scheduled for ${new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(`${plan.after.startDate}T12:00:00`))}.` : "Build a review to compare Apple’s equalized prices with guarded parity."}</p>
              </div>
              <div className="subscriptions-table-tools">
                <label className="subscriptions-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find storefront" aria-label="Find storefront" /></label>
                {plan ? <div className="subscriptions-filter" role="group" aria-label="Filter review">
                  {(["all", "changes", "protected"] as const).map((value) => <button className={filter === value ? "active" : ""} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} key={value}>{value === "all" ? "All" : value === "changes" ? "Changes" : "Guarded"}</button>)}
                </div> : null}
              </div>
            </div>

            {plan ? (
              <div className="subscriptions-summary" aria-label="Pricing review summary">
                <span><strong>{plan.after.summary.changes}</strong> changes</span>
                <span><strong>{plan.after.summary.decreases}</strong> lower prices</span>
                <span><strong>{plan.after.summary.increases}</strong> raises preserved</span>
                <span><strong>{plan.after.summary.floorProtected}</strong> floor-protected</span>
                <span><strong>{plan.after.summary.scheduledProtected + plan.after.summary.noData}</strong> held back</span>
              </div>
            ) : null}

            <div className="subscriptions-table-wrap" aria-busy={priceLoading}>
              {priceLoading ? <div className="subscriptions-table-loading"><LoaderCircle className="spin" size={20} /> Loading Apple price schedules…</div> : (
                <table className="subscriptions-table">
                  <thead><tr><th scope="col">Storefront</th><th scope="col">Current</th><th scope="col">Apple comparable</th><th scope="col">Policy band</th><th scope="col">Recommendation</th><th scope="col">Result</th></tr></thead>
                  <tbody>
                    {plan ? recommendations.map((recommendation) => (
                      <tr className={`subscription-row-${recommendation.change}`} key={recommendation.territory}>
                        <td data-label="Storefront"><strong>{recommendation.territoryName}</strong><span>{recommendation.territory} · {recommendation.currency}</span></td>
                        <td data-label="Current"><strong>{formatMoney(recommendation.current.customerPrice, recommendation.currency)}</strong></td>
                        <td data-label="Apple comparable"><strong>{recommendation.equalized ? formatMoney(recommendation.equalized.customerPrice, recommendation.currency) : "Unavailable"}</strong></td>
                        <td data-label="Policy band"><strong>{recommendation.factorPercent}%</strong><span>{reasonLabel(recommendation)}{recommendation.dataYear ? ` · ${recommendation.dataYear}` : ""}</span></td>
                        <td data-label="Recommendation"><strong>{formatMoney(recommendation.recommended.customerPrice, recommendation.currency)}</strong>{recommendation.reason === "floor" ? <span className="subscription-floor-note"><ShieldCheck size={12} /> Floor applied</span> : null}</td>
                        <td data-label="Result"><ChangeMark recommendation={recommendation} /></td>
                      </tr>
                    )) : visibleCurrentRows.map((row) => (
                      <tr key={row.territory}>
                        <td data-label="Storefront"><strong>{row.territory}</strong><span>{row.current.currency}</span></td>
                        <td data-label="Current"><strong>{formatMoney(row.current.customerPrice, row.current.currency)}</strong></td>
                        <td data-label="Apple comparable"><span>Build review</span></td>
                        <td data-label="Policy band"><span>Not calculated</span></td>
                        <td data-label="Recommendation"><span>—</span></td>
                        <td data-label="Result">{row.scheduled[0] ? <span className="subscription-change protected"><Clock3 size={14} /> {row.scheduled[0].startDate}</span> : <span className="subscription-change unchanged"><Minus size={14} /> Current</span>}</td>
                      </tr>
                    ))}
                    {(plan ? recommendations : visibleCurrentRows).length === 0 ? <tr><td className="subscriptions-no-rows" colSpan={6}>No storefronts match this view.</td></tr> : null}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}

      {plan ? <footer className="subscriptions-apply-dock">
        <div>
          <strong>{plan.after.summary.changes} exact price change{plan.after.summary.changes === 1 ? "" : "s"}</strong>
          <span>ASC Studio will re-check every current and scheduled price before writing.</span>
        </div>
        <label className="subscriptions-review-check"><input type="checkbox" checked={reviewAccepted} onChange={(event) => setReviewAccepted(event.target.checked)} /><span>I reviewed the storefront changes</span></label>
        <button className="button primary" type="button" disabled={!reviewAccepted || applying} onClick={() => void applyPlan()}>{applying ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{applying ? "Scheduling…" : `Schedule ${plan.after.summary.changes} prices`}</button>
      </footer> : null}
    </main>
  );
};
