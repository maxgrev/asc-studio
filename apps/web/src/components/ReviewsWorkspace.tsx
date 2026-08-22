import type {
  AgentStatus,
  AppSummary,
  CustomerReview,
  CustomerReviewSort,
  OpenAiConnection,
  UpsertCustomerReviewResponseMutationPlan,
} from "@asc-studio/contracts";
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  Inbox,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ApiError, api } from "../api.js";
import { ReviewResponseDialog } from "./ReviewResponseDialog.js";

interface ReviewsWorkspaceProps {
  app: AppSummary;
  status: AgentStatus;
  openAiConnection: OpenAiConnection | null;
  openAiConnectionLoading: boolean;
  openAiConnectionError: string | null;
  openAiSetupOpen: boolean;
  onReloadOpenAiConnection: () => Promise<void>;
  onManageOpenAi: () => void;
}

type ResponseFilter = "all" | "published" | "no-published";

const pageSize = 50;

const formatReviewDate = (value: string, compact = false) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, compact
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" }).format(date);
};

const responseStatus = (review: CustomerReview) => {
  if (!review.response) return { label: "Needs response", tone: "needs" } as const;
  if (review.response.state === "PENDING_PUBLISH") return { label: "Pending", tone: "pending" } as const;
  return { label: "Published", tone: "published" } as const;
};

const dedupeReviews = (reviews: CustomerReview[]) => Array.from(
  new Map(reviews.map((review) => [review.id, review])).values(),
);

const reviewSearchText = (review: CustomerReview) => [
  review.title,
  review.body,
  review.reviewerNickname,
  review.territory,
].join(" ").toLocaleLowerCase();

export const ReviewsWorkspace = ({
  app,
  status,
  openAiConnection,
  openAiConnectionLoading,
  openAiConnectionError,
  openAiSetupOpen,
  onReloadOpenAiConnection,
  onManageOpenAi,
}: ReviewsWorkspaceProps) => {
  const [reviews, setReviews] = useState<CustomerReview[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>("all");
  const [rating, setRating] = useState("all");
  const [territory, setTerritory] = useState("all");
  const [territoryChoices, setTerritoryChoices] = useState<string[]>([]);
  const [sort, setSort] = useState<CustomerReviewSort>("-createdDate");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submittedBodies, setSubmittedBodies] = useState<Record<string, string>>({});
  const [replyBusyById, setReplyBusyById] = useState<Record<string, boolean>>({});
  const [replyErrors, setReplyErrors] = useState<Record<string, string>>({});
  const [replyNotices, setReplyNotices] = useState<Record<string, string>>({});
  const [replySuggestions, setReplySuggestions] = useState<Record<string, string>>({});
  const [previousDrafts, setPreviousDrafts] = useState<Record<string, string>>({});
  const [compactInspector, setCompactInspector] = useState(false);
  const [plan, setPlan] = useState<UpsertCustomerReviewResponseMutationPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inboxRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const selectedTriggerRef = useRef<HTMLButtonElement>(null);
  const responseTextareaRef = useRef<HTMLTextAreaElement>(null);
  const draftReplyButtonRef = useRef<HTMLButtonElement>(null);
  const loadGeneration = useRef(0);
  const replyRequestRevisions = useRef<Record<string, number>>({});
  const replyWorkspaceRevision = useRef(0);
  const currentAppIdRef = useRef(app.id);
  const draftsRef = useRef<Record<string, string>>({});
  const openAiSetupWasOpen = useRef(false);
  currentAppIdRef.current = app.id;

  const selected = useMemo(
    () => selectedId ? reviews.find((review) => review.id === selectedId) ?? null : null,
    [reviews, selectedId],
  );
  const draft = selected
    ? drafts[selected.id] ?? selected.response?.responseBody ?? ""
    : "";

  const publishedResponse = responseFilter === "all"
    ? undefined
    : responseFilter === "published";

  const setReviewDraft = useCallback((reviewId: string, responseBody: string) => {
    setDrafts((current) => {
      const next = { ...current, [reviewId]: responseBody };
      draftsRef.current = next;
      return next;
    });
  }, []);

  const invalidateReplyRequest = useCallback((reviewId: string) => {
    replyRequestRevisions.current[reviewId] = (replyRequestRevisions.current[reviewId] ?? 0) + 1;
    setReplyBusyById((current) => {
      const next = { ...current };
      delete next[reviewId];
      return next;
    });
  }, []);

  const clearReplyArtifacts = useCallback((reviewId: string) => {
    const withoutReview = (current: Record<string, string>) => {
      const next = { ...current };
      delete next[reviewId];
      return next;
    };
    setReplyErrors(withoutReview);
    setReplyNotices(withoutReview);
    setReplySuggestions(withoutReview);
    setPreviousDrafts(withoutReview);
  }, []);

  const loadReviews = useCallback(async ({ append = false, manual = false }: { append?: boolean; manual?: boolean } = {}) => {
    const cursor = append ? nextCursor : undefined;
    if (append && !cursor) return;
    const generation = append ? loadGeneration.current : ++loadGeneration.current;
    if (append) setLoadingMore(true);
    else if (manual) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await api.customerReviews(app.id, {
        limit: pageSize,
        ...(cursor ? { cursor } : {}),
        ...(rating === "all" ? {} : { ratings: [Number(rating)] }),
        ...(territory === "all" ? {} : { territories: [territory] }),
        sort,
        ...(publishedResponse === undefined ? {} : { publishedResponse }),
      });
      if (generation !== loadGeneration.current) return;
      setReviews((current) => append ? dedupeReviews([...current, ...response.reviews]) : response.reviews);
      setTotal(response.total);
      setNextCursor(response.nextCursor);
      setTerritoryChoices((current) => Array.from(new Set([
        ...current,
        ...(territory === "all" ? [] : [territory]),
        ...response.reviews.map((review) => review.territory),
      ])).sort());
      if (!append) {
        const compact = window.matchMedia("(max-width: 1095px)").matches;
        setSelectedId((current) => {
          if (current && response.reviews.some((review) => review.id === current)) return current;
          return compact ? null : response.reviews[0]?.id ?? null;
        });
      }
    } catch (nextError) {
      if (generation !== loadGeneration.current) return;
      setError(nextError instanceof Error ? nextError.message : "ASC Studio could not load customer reviews.");
    } finally {
      if (generation === loadGeneration.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [app.id, nextCursor, publishedResponse, rating, sort, territory]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1095px)");
    const update = () => setCompactInspector(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    replyWorkspaceRevision.current += 1;
    replyRequestRevisions.current = {};
    setReplyBusyById({});
    setReplyErrors({});
    setReplyNotices({});
    setReplySuggestions({});
    setPreviousDrafts({});
  }, [app.id]);

  useEffect(() => {
    if (openAiSetupWasOpen.current && !openAiSetupOpen && openAiConnection?.configured) {
      window.requestAnimationFrame(() => draftReplyButtonRef.current?.focus());
    }
    openAiSetupWasOpen.current = openAiSetupOpen;
  }, [openAiConnection?.configured, openAiSetupOpen]);

  useEffect(() => {
    setReviews([]);
    setTotal(null);
    setNextCursor(null);
    setSelectedId(null);
    setNotice(null);
    void loadReviews();
  }, [app.id, publishedResponse, rating, sort, territory]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) {
      setPlan(null);
      setPlanError(null);
      return;
    }
    setPlan(null);
    setPlanError(null);
  }, [selected?.id, selected?.response?.id, selected?.response?.responseBody]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeInspector = useCallback(() => {
    setSelectedId(null);
    window.requestAnimationFrame(() => selectedTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    const inbox = inboxRef.current;
    if (!compactInspector || !selected) {
      inbox?.removeAttribute("inert");
      return;
    }
    inbox?.setAttribute("inert", "");
    window.requestAnimationFrame(() => {
      Array.from(inspectorRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])
        .find((button) => button.offsetParent !== null)
        ?.focus();
    });
    return () => inbox?.removeAttribute("inert");
  }, [compactInspector, selected?.id]);

  const keepInspectorFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!compactInspector) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!planBusy) closeInspector();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(inspectorRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
    ) ?? []).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (plan) return;
        if (compactInspector && selected) {
          setSelectedId(null);
          window.requestAnimationFrame(() => searchRef.current?.focus());
        } else {
          searchRef.current?.focus();
        }
      }
      if (event.key === "Escape") {
        if (plan && !planBusy) {
          setPlan(null);
          setPlanError(null);
        } else if (!planBusy) {
          closeInspector();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeInspector, compactInspector, plan, planBusy, selected]);

  const visibleReviews = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return reviews;
    return reviews.filter((review) => reviewSearchText(review).includes(normalizedQuery));
  }, [query, reviews]);

  const reviewResponse = async () => {
    if (!selected || replyBusyById[selected.id] || !draft.trim() || draft === (selected.response?.responseBody ?? "")) return;
    invalidateReplyRequest(selected.id);
    setPlanBusy(true);
    setPlanError(null);
    setNotice(null);
    try {
      const response = await api.planCustomerReviewResponse({
        appId: app.id,
        reviewId: selected.id,
        responseBody: draft,
      });
      setPlan(response.plan);
    } catch (nextError) {
      setPlanError(nextError instanceof Error ? nextError.message : "ASC Studio could not prepare the response review.");
    } finally {
      setPlanBusy(false);
    }
  };

  const draftCustomerReviewReply = async () => {
    if (
      !selected
      || planBusy
      || plan
      || !(selected.title.trim() || selected.body.trim())
      || !openAiConnection?.configured
    ) return;
    const review = selected;
    const appId = app.id;
    const workspaceRevision = replyWorkspaceRevision.current;
    const requestRevision = (replyRequestRevisions.current[review.id] ?? 0) + 1;
    replyRequestRevisions.current[review.id] = requestRevision;
    const responseBodyAtStart = draftsRef.current[review.id] ?? review.response?.responseBody ?? "";
    setReplyBusyById((current) => ({ ...current, [review.id]: true }));
    window.requestAnimationFrame(() => responseTextareaRef.current?.focus());
    setReplyErrors((current) => {
      const next = { ...current };
      delete next[review.id];
      return next;
    });
    try {
      const generated = await api.generateCustomerReviewReply({ appId, reviewId: review.id });
      if (
        currentAppIdRef.current !== appId
        || replyWorkspaceRevision.current !== workspaceRevision
        || replyRequestRevisions.current[review.id] !== requestRevision
      ) return;
      const latestResponseBody = draftsRef.current[review.id] ?? review.response?.responseBody ?? "";
      setReplySuggestions((current) => {
        const next = { ...current };
        delete next[review.id];
        return next;
      });
      if (latestResponseBody !== responseBodyAtStart) {
        setReplySuggestions((current) => ({ ...current, [review.id]: generated.responseBody }));
        setReplyNotices((current) => ({
          ...current,
          [review.id]: "Your edits were kept. The new draft is available below.",
        }));
      } else if (generated.responseBody === latestResponseBody) {
        setPreviousDrafts((current) => {
          const next = { ...current };
          delete next[review.id];
          return next;
        });
        setReplyNotices((current) => ({
          ...current,
          [review.id]: "The drafted reply matches the current response.",
        }));
      } else {
        setPreviousDrafts((current) => ({ ...current, [review.id]: latestResponseBody }));
        setReviewDraft(review.id, generated.responseBody);
        setReplyNotices((current) => ({
          ...current,
          [review.id]: "Draft added locally. Review and edit it before continuing.",
        }));
      }
    } catch (nextError) {
      if (
        currentAppIdRef.current !== appId
        || replyWorkspaceRevision.current !== workspaceRevision
        || replyRequestRevisions.current[review.id] !== requestRevision
      ) return;
      setReplyErrors((current) => ({
        ...current,
        [review.id]: nextError instanceof Error ? nextError.message : "ASC Studio could not draft this reply.",
      }));
    } finally {
      if (
        currentAppIdRef.current === appId
        && replyWorkspaceRevision.current === workspaceRevision
        && replyRequestRevisions.current[review.id] === requestRevision
      ) {
        setReplyBusyById((current) => {
          const next = { ...current };
          delete next[review.id];
          return next;
        });
      }
    }
  };

  const confirmResponse = async () => {
    if (!plan) return;
    invalidateReplyRequest(plan.target.reviewId);
    setPlanBusy(true);
    setPlanError(null);
    try {
      await api.confirmPlan(plan);
      setSubmittedBodies((current) => ({ ...current, [plan.target.reviewId]: plan.after.responseBody }));
      setReviewDraft(plan.target.reviewId, plan.after.responseBody);
      clearReplyArtifacts(plan.target.reviewId);
      setPlan(null);
      setNotice(status.mode === "demo"
        ? "Demo response saved in isolated sample data."
        : "Response submitted to Apple. Publication can take up to 24 hours.");
      await loadReviews({ manual: true });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Apple did not accept the response.";
      if (nextError instanceof ApiError && ["plan_expired", "stale_plan", "plan_not_confirmable"].includes(nextError.code)) {
        setPlan(null);
        setPlanError(`${message} Review the latest customer review and prepare a new plan.`);
      } else {
        setPlanError(message);
      }
    } finally {
      setPlanBusy(false);
    }
  };

  const currentBody = selected?.response?.responseBody ?? "";
  const reviewedBody = selected ? submittedBodies[selected.id] ?? currentBody : "";
  const responseChanged = Boolean(selected && draft.trim() && draft !== reviewedBody);
  const hasWrittenFeedback = Boolean(selected && (selected.title.trim() || selected.body.trim()));
  const replyBusy = Boolean(selected && replyBusyById[selected.id]);
  const replyError = selected ? replyErrors[selected.id] : undefined;
  const replyNotice = selected ? replyNotices[selected.id] : undefined;
  const replySuggestion = selected ? replySuggestions[selected.id] : undefined;
  const previousDraft = selected ? previousDrafts[selected.id] : undefined;
  const loadedCount = reviews.length;
  const countCopy = total === null
    ? `${loadedCount} written review${loadedCount === 1 ? "" : "s"} loaded`
    : `${total} matching written review${total === 1 ? "" : "s"}`;

  return (
    <main className="workspace reviews-workspace">
      <header className="topbar reviews-topbar">
        <div><h1>Reviews</h1><p>Written App Store reviews and public response status for {app.name}.</p></div>
        <div className="topbar-actions">
          <button className="button secondary" type="button" disabled={refreshing || loading} onClick={() => void loadReviews({ manual: true })} aria-label="Refresh customer reviews">
            <RefreshCw size={17} className={refreshing ? "spin" : undefined} /><span>{refreshing ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
      </header>

      {status.mode === "demo" ? <div className="demo-banner"><strong>Demo mode</strong><span>Responses only change isolated sample data.</span></div> : null}
      {notice ? <div className="reviews-notice" role="status"><span className="reviews-state-dot published" />{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss response notice"><X size={15} /></button></div> : null}

      <div className={selected ? "reviews-content has-selection" : "reviews-content"}>
        <section ref={inboxRef} className="reviews-inbox" aria-labelledby="reviews-inbox-title">
          <header className="reviews-inbox-header">
            <div>
              <h2 id="reviews-inbox-title">Review inbox</h2>
              <p>{countCopy}{nextCursor ? ` · ${loadedCount} loaded` : ""}</p>
            </div>
          </header>

          <div className="reviews-toolbar" aria-label="Review filters">
            <label className="reviews-search"><Search size={17} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search loaded reviews" aria-label="Search loaded reviews" /><kbd>⌘K</kbd></label>
            <label className="reviews-select">
              <span className="sr-only">Response status</span>
              <select value={responseFilter} onChange={(event) => setResponseFilter(event.target.value as ResponseFilter)} aria-label="Response status">
                <option value="all">All responses</option>
                <option value="published">Published response</option>
                <option value="no-published">No published response</option>
              </select>
              <ChevronDown size={15} />
            </label>
            <label className="reviews-select">
              <span className="sr-only">Rating</span>
              <select value={rating} onChange={(event) => setRating(event.target.value)} aria-label="Rating">
                <option value="all">All ratings</option>
                {[5, 4, 3, 2, 1].map((value) => <option value={value} key={value}>{value} stars</option>)}
              </select>
              <ChevronDown size={15} />
            </label>
            <label className="reviews-select">
              <span className="sr-only">Territory</span>
              <select value={territory} onChange={(event) => setTerritory(event.target.value)} aria-label="Territory from loaded reviews">
                <option value="all">All territories</option>
                {territoryChoices.map((code) => <option value={code} key={code}>{code}</option>)}
              </select>
              <ChevronDown size={15} />
            </label>
            <label className="reviews-select reviews-sort">
              <span className="sr-only">Sort reviews</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as CustomerReviewSort)} aria-label="Sort reviews">
                <option value="-createdDate">Newest first</option>
                <option value="createdDate">Oldest first</option>
                <option value="-rating">Highest rating</option>
                <option value="rating">Lowest rating</option>
              </select>
              <ChevronDown size={15} />
            </label>
          </div>

          <div className="reviews-list-wrap">
            {error && reviews.length === 0 ? (
              <div className="reviews-state" role="alert"><AlertCircle size={22} /><strong>Customer reviews could not be loaded</strong><p>{error}</p><button className="button secondary" type="button" onClick={() => void loadReviews()}>Try again</button></div>
            ) : loading && reviews.length === 0 ? (
              <div className="reviews-loading" aria-label="Loading customer reviews">
                {Array.from({ length: 6 }, (_, index) => <span key={index}><i /><b /><small /></span>)}
              </div>
            ) : reviews.length === 0 ? (
              <div className="reviews-state"><Inbox size={24} /><strong>No written reviews found</strong><p>There are no customer reviews matching these App Store filters.</p></div>
            ) : visibleReviews.length === 0 ? (
              <div className="reviews-state"><Search size={23} /><strong>No loaded reviews match</strong><p>Clear or change the local search. Server filters remain unchanged.</p><button className="button secondary" type="button" onClick={() => setQuery("")}>Clear search</button></div>
            ) : (
              <ol className="reviews-list">
                {visibleReviews.map((review) => {
                  const state = responseStatus(review);
                  return (
                    <li key={review.id}>
                      <button className={review.id === selectedId ? "review-row selected" : "review-row"} type="button" onClick={(event) => {
                        selectedTriggerRef.current = event.currentTarget;
                        setSelectedId(review.id);
                      }} aria-pressed={review.id === selectedId}>
                        <span className="review-rating" aria-label={`${review.rating} out of 5 stars`}><Star size={16} fill="currentColor" /><strong>{review.rating}</strong></span>
                        <span className="review-row-copy">
                          <strong>{review.title || "Untitled review"}</strong>
                          <span>{review.body || "The reviewer did not include written feedback."}</span>
                          <small>{review.reviewerNickname || "Anonymous reviewer"}</small>
                        </span>
                        <code>{review.territory}</code>
                        <time dateTime={review.createdAt}>{formatReviewDate(review.createdAt, true)}</time>
                        <span className={`review-response-status ${state.tone}`}><i />{state.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <footer className="reviews-list-footer">
            <span>{loadedCount} loaded{total !== null ? ` of ${total}` : ""}</span>
            {error && reviews.length ? <span className="reviews-inline-error" role="alert">{error}</span> : null}
            {nextCursor ? <button className="button secondary" type="button" disabled={loadingMore} onClick={() => void loadReviews({ append: true })}>{loadingMore ? <LoaderCircle className="spin" size={15} /> : null}{loadingMore ? "Loading…" : "Load more"}</button> : <span>End of loaded results</span>}
          </footer>
        </section>

        {selected ? (
          <aside
            ref={inspectorRef}
            className="review-inspector"
            role={compactInspector ? "dialog" : undefined}
            aria-modal={compactInspector ? "true" : undefined}
            aria-labelledby="review-inspector-title"
            onKeyDown={keepInspectorFocus}
          >
            <header className="review-inspector-header">
              <button className="review-inspector-back" type="button" onClick={closeInspector}><ChevronLeft size={17} />Back to inbox</button>
              <div><h2 id="review-inspector-title">Customer review</h2><p>{formatReviewDate(selected.createdAt)} · <code>{selected.territory}</code></p></div>
              <button className="icon-button" type="button" onClick={closeInspector} aria-label="Close customer review"><X size={18} /></button>
            </header>

            <div className="review-inspector-scroll">
              <section className="review-detail">
                <div className="review-detail-rating" aria-label={`${selected.rating} out of 5 stars`}>
                  {Array.from({ length: 5 }, (_, index) => <Star size={16} fill={index < selected.rating ? "currentColor" : "none"} key={index} />)}
                  <strong>{selected.rating}.0</strong>
                </div>
                <h3>{selected.title || "Untitled review"}</h3>
                <p>{selected.body || "The reviewer did not include written feedback."}</p>
                <footer><span>{selected.reviewerNickname || "Anonymous reviewer"}</span><code>{selected.id}</code></footer>
              </section>

              <section className="review-composer" aria-labelledby="review-composer-title">
                <header>
                  <div><h3 id="review-composer-title">Response to this review</h3><p>{selected.response ? "Edit the response Apple has for this review." : "No public response has been submitted."}</p></div>
                  <span className={`review-response-status ${responseStatus(selected).tone}`}><i />{responseStatus(selected).label}</span>
                </header>
                {selected.response ? (
                  <div className="review-response-meta">
                    <span>{selected.response.state === "PENDING_PUBLISH" ? "Awaiting publication" : "Visible on the App Store"}</span>
                    {selected.response.lastModifiedAt ? <time dateTime={selected.response.lastModifiedAt}>Updated {formatReviewDate(selected.response.lastModifiedAt)}</time> : null}
                  </div>
                ) : null}
                <div className="review-response-field">
                  <div className="review-response-field-heading">
                    <label htmlFor="review-public-response">Public response</label>
                    <button
                      ref={draftReplyButtonRef}
                      className="button secondary review-draft-button"
                      type="button"
                      aria-busy={replyBusy}
                      disabled={openAiConnectionLoading || !openAiConnection?.configured || !hasWrittenFeedback || replyBusy || planBusy || Boolean(plan)}
                      onClick={() => void draftCustomerReviewReply()}
                      title={status.mode === "demo"
                        ? "Create a deterministic sample draft without calling OpenAI."
                        : "Send this review's written feedback to OpenAI and create a local draft."}
                    >
                      {replyBusy || openAiConnectionLoading ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
                      {replyBusy
                        ? "Drafting…"
                        : openAiConnectionLoading
                          ? "Checking…"
                          : status.mode === "demo"
                            ? draft.trim() ? "Draft sample alternative" : "Draft sample"
                            : draft.trim() ? "Draft alternative" : "Draft with OpenAI"}
                    </button>
                  </div>
                  {!hasWrittenFeedback ? (
                    <div className="review-draft-availability"><AlertCircle size={16} /><span>This review has no written feedback, so there is not enough detail to draft a useful reply.</span></div>
                  ) : openAiConnectionError ? (
                    <div className="review-draft-availability error" role="alert">
                      <AlertCircle size={16} />
                      <span><strong>Reply drafting status could not be checked.</strong>{openAiConnectionError}</span>
                      <button type="button" onClick={() => {
                        responseTextareaRef.current?.focus();
                        void onReloadOpenAiConnection();
                      }}>Retry</button>
                    </div>
                  ) : !openAiConnectionLoading && openAiConnection && !openAiConnection.configured ? (
                    <div className="review-draft-availability unconfigured">
                      <AlertCircle size={16} />
                      <span><strong>{openAiConnection.source === "environment" ? "Environment-managed OpenAI needs attention" : "OpenAI is not set up"}</strong>{openAiConnection.source === "environment"
                        ? "Update OPENAI_API_KEY, then restart ASC Studio."
                        : "Add an API key in Connections to draft replies."}</span>
                      {openAiConnection.source !== "environment" ? <button type="button" onClick={onManageOpenAi}>Set up OpenAI</button> : null}
                    </div>
                  ) : null}
                  <textarea
                    ref={responseTextareaRef}
                    id="review-public-response"
                    value={draft}
                    onChange={(event) => {
                      setReviewDraft(selected.id, event.target.value);
                      setPreviousDrafts((current) => {
                        const next = { ...current };
                        delete next[selected.id];
                        return next;
                      });
                      setReplyErrors((current) => {
                        const next = { ...current };
                        delete next[selected.id];
                        return next;
                      });
                      if (!replySuggestion) {
                        setReplyNotices((current) => {
                          const next = { ...current };
                          delete next[selected.id];
                          return next;
                        });
                      }
                    }}
                    rows={9}
                    placeholder="Write a clear, specific response to this customer…"
                  />
                  <small>{draft.length.toLocaleString()} character{draft.length === 1 ? "" : "s"}</small>
                </div>
                {replyNotice ? (
                  <div className="review-draft-status" role="status">
                    <Sparkles size={16} />
                    <span>{replyNotice}</span>
                    {previousDraft !== undefined && !replySuggestion ? (
                      <button type="button" onClick={() => {
                        responseTextareaRef.current?.focus();
                        setReviewDraft(selected.id, previousDraft);
                        setPreviousDrafts((current) => {
                          const next = { ...current };
                          delete next[selected.id];
                          return next;
                        });
                        setReplyNotices((current) => {
                          const next = { ...current };
                          delete next[selected.id];
                          return next;
                        });
                      }}><RotateCcw size={14} />Restore previous draft</button>
                    ) : null}
                  </div>
                ) : null}
                {replySuggestion ? (
                  <div className="review-draft-suggestion">
                    <strong>Generated draft</strong>
                    <p>{replySuggestion}</p>
                    <div>
                      <button className="button secondary" type="button" onClick={() => {
                        responseTextareaRef.current?.focus();
                        setReplySuggestions((current) => {
                          const next = { ...current };
                          delete next[selected.id];
                          return next;
                        });
                        setReplyNotices((current) => {
                          const next = { ...current };
                          delete next[selected.id];
                          return next;
                        });
                      }}>Dismiss</button>
                      <button className="button secondary" type="button" onClick={() => {
                        responseTextareaRef.current?.focus();
                        setPreviousDrafts((current) => ({ ...current, [selected.id]: draft }));
                        setReviewDraft(selected.id, replySuggestion);
                        setReplySuggestions((current) => {
                          const next = { ...current };
                          delete next[selected.id];
                          return next;
                        });
                        setReplyNotices((current) => ({
                          ...current,
                          [selected.id]: "Generated draft added locally. Review and edit it before continuing.",
                        }));
                      }}>Use generated draft</button>
                    </div>
                  </div>
                ) : null}
                {replyError ? (
                  <div className="review-composer-error review-draft-error" role="alert">
                    <span>{replyError}</span>
                    <button type="button" onClick={() => {
                      responseTextareaRef.current?.focus();
                      void draftCustomerReviewReply();
                    }}>Try again</button>
                  </div>
                ) : null}
                <div className="review-publication-note"><AlertCircle size={16} /><span>Apple may take up to 24 hours to publish a new or replaced response.</span></div>
                {planError && !plan ? <div className="review-composer-error" role="alert">{planError}</div> : null}
              </section>
            </div>

            <footer className="review-inspector-footer">
              <span>{replyBusy ? "Wait for the reply draft to finish." : !draft.trim() ? "Enter a response to continue." : !responseChanged ? "No response changes to review." : "Draft kept locally until this workspace closes."}</span>
              <button className="button primary" type="button" disabled={!responseChanged || planBusy || replyBusy} onClick={() => void reviewResponse()}>
                <Send size={16} />{planBusy && !plan ? "Preparing…" : "Review response"}
              </button>
            </footer>
          </aside>
        ) : null}
      </div>

      {plan ? <ReviewResponseDialog plan={plan} busy={planBusy} demo={status.mode === "demo"} error={planError} onConfirm={() => void confirmResponse()} onClose={() => {
        if (planBusy) return;
        setPlan(null);
        setPlanError(null);
      }} /> : null}
    </main>
  );
};
