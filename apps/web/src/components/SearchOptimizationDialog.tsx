import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, Check, Copy, RefreshCw, Search, Plus, Save, Trash2 } from "lucide-react";
import { SearchMetadataSchema, type AppStoreLocale, type AppStoreVersion, type AppSummary, type AppleAdsKeywordResearchResult, type SearchMetadata, type SearchMetadataValues, type UpdateSearchMetadataMutationPlan } from "@asc-studio/contracts";
import { api } from "../api.js";
import { localeNames, platformLabel } from "../releaseMetadata.js";
import { analyzeSearchMetadata, appendSearchKeyword, cleanSearchKeywords, keywordCoverage, researchDateRange, searchFieldLabels, searchFieldLimits, searchFields, type SearchField } from "../searchOptimization.js";
import { DialogFrame } from "./ReleaseDialogs.js";

interface Props {
  app: AppSummary;
  version: AppStoreVersion;
  locale: AppStoreLocale;
  initialKeywords: string | undefined;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onSaved: (values: SearchMetadataValues) => Promise<void>;
}
interface Variant { id: string; label: string; values: SearchMetadataValues }
const countries = { US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", NL: "Netherlands", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", PL: "Poland", PT: "Portugal", BR: "Brazil", MX: "Mexico", JP: "Japan", KR: "South Korea", CN: "China mainland", TW: "Taiwan", IN: "India", TR: "Türkiye", SA: "Saudi Arabia", AE: "United Arab Emirates", ID: "Indonesia", TH: "Thailand", VN: "Vietnam" };
const defaultCountry = (locale: string) => {
  const region = locale.split("-")[1];
  if (region && region in countries) return region;
  return ({ de: "DE", fr: "FR", es: "ES", it: "IT", ja: "JP", ko: "KR", nl: "NL", sv: "SE", no: "NO", da: "DK", fi: "FI", pl: "PL", tr: "TR", ar: "SA", id: "ID", th: "TH", vi: "VN", "zh-Hans": "CN", "zh-Hant": "TW" } as Record<string, string>)[locale] ?? "US";
};

const readStored = (key: string): { draft: SearchMetadataValues | null; variants: Variant[] } => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key) ?? "null");
    const draft = SearchMetadataSchema.shape.values.safeParse(raw?.draft);
    const variants: Variant[] = Array.isArray(raw?.variants) ? raw.variants.slice(0, 4).flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || !("id" in item) || !("label" in item) || !("values" in item)) return [];
      const values = SearchMetadataSchema.shape.values.safeParse(item.values);
      return typeof item.id === "string" && typeof item.label === "string" && values.success ? [{ id: item.id, label: item.label, values: values.data }] : [];
    }) : [];
    return { draft: draft.success ? draft.data : null, variants };
  } catch { return { draft: null, variants: [] }; }
};

export const SearchOptimizationDialog = ({ app, version, locale, initialKeywords, onClose, onBusyChange, onSaved }: Props) => {
  const id = useId();
  const storageKey = `asc-studio.search-optimizer.${app.id}.${version.id}.${locale}`;
  const [stored] = useState(() => readStored(storageKey));
  const [metadata, setMetadata] = useState<SearchMetadata | null>(null);
  const [draft, setDraft] = useState<SearchMetadataValues | null>(stored.draft);
  const [variants, setVariants] = useState<Variant[]>(stored.variants);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [plan, setPlan] = useState<UpdateSearchMetadataMutationPlan | null>(null);
  const [adsConnected, setAdsConnected] = useState<boolean | null>(null);
  const [research, setResearch] = useState<AppleAdsKeywordResearchResult | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [country, setCountry] = useState(() => defaultCountry(locale));
  const [genre, setGenre] = useState("PRODUCTIVITY_UTILITIES");
  const [seeds, setSeeds] = useState("");
  const [filter, setFilter] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const alive = useRef(true);
  const analysis = useMemo(() => draft ? analyzeSearchMetadata(draft, locale) : null, [draft, locale]);
  const cleaned = draft ? cleanSearchKeywords(draft, locale) : "";
  const editable = Boolean(metadata?.versionEditable && metadata.appInfoEditable);
  const changed = metadata && draft && searchFields.some((field) => metadata.values[field] !== draft[field]);

  useEffect(() => {
    alive.current = true;
    void api.searchMetadata(app.id, version.id, locale).then(({ metadata: current }) => {
      if (!alive.current) return;
      setMetadata(current);
      setDraft((previous) => previous ?? { ...current.values, keywords: initialKeywords ?? current.values.keywords });
      setSeeds(current.values.keywords.split(",").slice(0, 5).join(","));
    }).catch((failure: unknown) => {
      if (alive.current) setError(failure instanceof Error ? failure.message : "Search metadata could not be loaded.");
    }).finally(() => { if (alive.current) setLoading(false); });
    void api.appleAdsStatus().then((status) => { if (alive.current) setAdsConnected(status.connected); })
      .catch(() => { if (alive.current) setResearchError("Apple Ads connection status is unavailable. You can retry keyword research below."); });
    return () => { alive.current = false; };
  }, [app.id, version.id, locale]);

  useEffect(() => {
    if (!draft) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ draft, variants })); } catch { /* In-memory drafts remain usable if storage is unavailable. */ }
  }, [draft, variants, storageKey]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const response = await api.searchMetadata(app.id, version.id, locale);
      if (!alive.current) return;
      setMetadata(response.metadata);
      setDraft((previous) => previous ?? response.metadata.values);
      setNeedsRefresh(false);
      setNotice("Current values refreshed. Your working draft is unchanged.");
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : "Current values could not be refreshed.");
    } finally { if (alive.current) setLoading(false); }
  };
  const change = (field: SearchField, value: string) => {
    setDraft((previous) => previous ? { ...previous, [field]: value } : null);
    setNotice(null);
    setPlan(null);
  };
  const review = async () => {
    if (!metadata || !draft) return;
    setBusy(true); onBusyChange(true); setError(null); setNotice(null);
    try {
      const response = await api.planSearchMetadata({ appId: app.id, versionId: version.id, locale, expected: metadata, values: draft });
      setPlan(response.plan);
    } catch (failure) {
      setNeedsRefresh(true);
      setError(failure instanceof Error ? failure.message : "The changes could not be reviewed.");
    } finally { setBusy(false); onBusyChange(false); }
  };
  const confirm = async () => {
    if (!plan) return;
    setBusy(true); onBusyChange(true); setError(null);
    try {
      await api.confirmPlan(plan);
    } catch (failure) {
      setPlan(null); setNeedsRefresh(true);
      setError(failure instanceof Error ? failure.message : "The save could not be confirmed. Refresh current values before trying again.");
      setBusy(false); onBusyChange(false);
      return;
    }
    const values = plan.after;
    setPlan(null); setMetadata((current) => current ? { ...current, values } : null);
    setNotice("Search metadata saved to App Store Connect.");
    try { await onSaved(values); }
    catch { setError("Search metadata was saved, but the Releases view could not refresh. Sync Releases after closing this dialog."); }
    finally { setBusy(false); onBusyChange(false); }
  };
  const researchKeywords = async () => {
    setResearchBusy(true); setResearchError(null);
    try {
      const seedTerms = seeds.split(",").map((term) => term.trim()).filter(Boolean);
      if (seedTerms.length > 20 || seedTerms.some((term) => term.length > 100)) throw new Error("Use up to 20 seed terms, each within 100 characters.");
      const response = await api.researchAppleAdsKeywords({ appId: app.id, countryOrRegion: country, genre, ...researchDateRange(), granularity: "WEEKLY_SUN_SAT", seedTerms, limit: 50 });
      if (alive.current) { setResearch(response.research); setAdsConnected(true); }
    } catch (failure) { if (alive.current) setResearchError(failure instanceof Error ? failure.message : "Keyword research is unavailable."); }
    finally { if (alive.current) setResearchBusy(false); }
  };
  const saveVariant = () => {
    if (!draft || variants.length >= 4) return;
    setVariants((previous) => {
      let number = 1;
      while (previous.some((variant) => variant.label === `Variant ${number}`)) number++;
      return [...previous, { id: crypto.randomUUID(), label: `Variant ${number}`, values: { ...draft } }];
    });
    setNotice("Variant saved for comparison in this session.");
  };
  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(searchFields.map((field) => `${searchFieldLabels[field]}: ${draft[field]}`).join("\n"));
      setNotice("Draft copied.");
    } catch { setError("Clipboard access is unavailable. Select and copy the field text directly."); }
  };
  const rows = (research?.keywords ?? []).filter((item) => item.text.toLocaleLowerCase(locale).includes(filter.toLocaleLowerCase(locale))
    && (!onlyMissing || !draft || !keywordCoverage(item.text, draft, locale).covered));

  return <DialogFrame title={plan ? "Review search metadata" : "Optimize search"} subtitle={`${app.name} · ${platformLabel(version.platform)} ${version.versionString} · ${localeNames[locale]}`} wide busy={busy} onClose={onClose}>
    <div className="search-optimizer">
      <div className="search-optimizer-context"><span><strong>{locale}</strong> Name and subtitle are shared across platforms. Keywords belong to this release.</span><button className="button tertiary" type="button" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? "spin" : ""} />Refresh current</button></div>
      {error ? <div className="search-optimizer-error" role="alert">{error}</div> : null}
      {notice ? <div className="search-optimizer-notice" role="status">{notice}</div> : null}
      {loading && !metadata ? <div className="search-optimizer-loading"><RefreshCw className="spin" size={22} /><p>Loading shared app information and release keywords…</p></div> : null}
      {metadata && draft && analysis ? <>
        {!editable ? <p className="search-optimizer-hint">You can explore drafts here. Applying changes requires an editable version and editable shared app information.</p> : null}
        {plan ? <div className="search-review">
          <p>Confirm these exact changes for {localeNames[locale]}. Name and subtitle changes affect the app across platforms.</p>
          <div className="search-comparison"><table><thead><tr><th>Field</th><th>Current in App Store Connect</th><th>After applying</th></tr></thead><tbody>{searchFields.filter((field) => plan.before.values[field] !== plan.after[field]).map((field) => <tr key={field}><th>{searchFieldLabels[field]}<small>{field === "keywords" ? `${platformLabel(version.platform)} ${version.versionString}` : "Shared across platforms"}</small></th><td>{plan.before.values[field] || <em>Empty</em>}</td><td>{plan.after[field] || <em>Empty</em>}</td></tr>)}</tbody></table></div>
          <p className="search-optimizer-hint">Saving updates metadata in App Store Connect. Release and review status determine when customers see it.</p>
        </div> : <>
          <div className="search-optimizer-columns">
            <section className="search-draft-editor" aria-label="Search metadata draft">
              <header><div><h3>Your working draft</h3><p>Choose clear copy, then make room for additional search terms.</p></div><button className="icon-button" type="button" aria-label="Copy metadata draft" onClick={() => void copyDraft()}><Copy size={16} /></button></header>
              {searchFields.map((field) => <label className={`store-field search-draft-field${draft[field].length > searchFieldLimits[field] ? " invalid" : ""}`} key={field} htmlFor={`${id}-${field}`}>
                <span><strong>{searchFieldLabels[field]}{field !== "keywords" ? <small className="search-shared-label">Shared</small> : null}</strong><small>{draft[field].length} / {searchFieldLimits[field]}</small></span>
                {field === "keywords" ? <textarea id={`${id}-${field}`} value={draft[field]} rows={3} dir="auto" disabled={busy} aria-invalid={draft[field].length > searchFieldLimits[field]} onChange={(event) => change(field, event.target.value)} spellCheck={false} />
                  : <input id={`${id}-${field}`} value={draft[field]} dir="auto" disabled={busy} aria-invalid={draft[field].length > searchFieldLimits[field]} onChange={(event) => change(field, event.target.value)} />}
              </label>)}
              {analysis.issues.length ? <ul className="search-issues" role="status">{analysis.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
              <div className="search-coverage" aria-label="Word coverage"><header><strong>{analysis.entries.length} distinct words</strong><span>{analysis.duplicates.length ? `${analysis.duplicates.length} across multiple fields` : "No overlap across fields"}</span></header>
                <div className="search-word-list">{analysis.entries.map(({ word, fields }) => <span className={fields.length > 1 ? "search-word repeated" : "search-word"} title={fields.map((field) => searchFieldLabels[field]).join(" + ")} key={word}>{word}<small>{fields.map((field) => ({ name: "N", subtitle: "S", keywords: "K" })[field]).join("·")}</small></span>)}</div>
                <small>N = Name · S = Subtitle · K = Keywords</small>
                {cleaned !== draft.keywords ? <button className="button secondary" type="button" disabled={busy} onClick={() => change("keywords", cleaned)}><Trash2 size={14} />Clean keyword list<span>{draft.keywords.length - cleaned.length} characters freed</span></button> : null}
                <p>Repeated single words in Keywords can use space already covered by your name or subtitle. Cleanup keeps multiword phrases intact.</p>
              </div>
              <section className="search-preview" aria-label="App Store text preview"><header><strong>Search preview</strong><small>Approximate text layout</small></header><div className="search-preview-result"><span className="search-preview-icon" aria-hidden="true">{app.name.slice(0, 1)}</span><div><strong title={draft.name} dir="auto">{draft.name || "App name"}</strong><span title={draft.subtitle} dir="auto">{draft.subtitle || "Subtitle"}</span></div><span className="search-preview-get" aria-hidden="true">GET</span></div></section>
            </section>
            <section className="search-research" aria-label="Keyword research"><header><h3>Find the next useful word</h3><p>Research by storefront, then compare each term with your draft.</p></header>
              <div className="search-research-controls"><label><span>Storefront</span><select value={country} disabled={researchBusy} onChange={(event) => { setCountry(event.target.value); setResearch(null); }}>{Object.entries(countries).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label><label><span>Category</span><select value={genre} disabled={researchBusy} onChange={(event) => { setGenre(event.target.value); setResearch(null); }}><option value="PRODUCTIVITY_UTILITIES">Productivity &amp; Utilities</option><option value="BUSINESS">Business</option><option value="LIFESTYLE">Lifestyle</option></select></label><label className="search-seeds"><span>Seed terms, separated by commas</span><input value={seeds} disabled={researchBusy} onChange={(event) => setSeeds(event.target.value)} placeholder="voice,dictation,transcription" /></label><button className="button secondary" type="button" disabled={researchBusy || adsConnected === false} onClick={() => void researchKeywords()}><Search size={15} />{researchBusy ? "Researching…" : "Research keywords"}</button></div>
              {adsConnected === false ? <p className="search-research-empty">Connect Apple Ads in Connections to load keyword suggestions and popularity. Drafting, preview, and overlap checks work without it.</p> : null}
              {researchError ? <p className="search-optimizer-error" role="alert">{researchError}</p> : null}
              {research ? <><div className="search-research-filters"><input aria-label="Filter research keywords" placeholder="Filter keywords…" value={filter} onChange={(event) => setFilter(event.target.value)} /><label><input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} />Missing words only</label></div><p className="search-research-period">{research.countryOrRegion} · {research.start} – {research.end} · Apple Ads</p><div className="search-research-table"><table><thead><tr><th>Keyword</th><th>Popularity</th><th>In your draft</th><th>Add to</th></tr></thead><tbody>{rows.map((item) => {
                const coverage = keywordCoverage(item.text, draft, locale);
                return <tr key={item.text}><td><strong>{item.text}</strong><small>{item.source === "suggestion" ? "App suggestion" : item.source === "both" ? "Suggestion + popularity" : "Category search term"}</small></td><td>{item.searchPopularity === null ? "—" : `${item.searchPopularity}/100`}</td><td><span className={coverage.covered ? "search-covered" : "search-missing"}>{coverage.covered ? coverage.fields.length ? coverage.fields.map((field) => searchFieldLabels[field]).join(", ") : "Across fields" : `${coverage.missing.length} new word${coverage.missing.length === 1 ? "" : "s"}`}</span></td><td><div className="search-add-actions">{searchFields.map((field) => {
                  const next = field === "keywords" ? appendSearchKeyword(item.text, draft, locale) : [draft[field].trim(), item.text].filter(Boolean).join(" ");
                  const disabled = busy || coverage.fields.includes(field) || next.length > searchFieldLimits[field] || (field === "keywords" && coverage.covered);
                  return <button type="button" key={field} disabled={disabled} title={next.length > searchFieldLimits[field] ? `${searchFieldLabels[field]} has insufficient space` : `Add ${item.text} to ${searchFieldLabels[field]}`} aria-label={`Add ${item.text} to ${searchFieldLabels[field]}`} onClick={() => change(field, next)}>{({ name: "N", subtitle: "S", keywords: "K" })[field]}<Plus size={10} /></button>;
                })}</div></td></tr>;
              })}</tbody></table>{!rows.length ? <p className="search-research-empty">No keywords match these filters.</p> : null}</div><p className="search-optimizer-hint">Popularity is a relative Apple Ads signal, not monthly searches. “In your draft” checks words present; it does not predict rankings or confirm phrase indexing.</p></> : adsConnected !== false && !researchBusy ? <div className="search-research-empty"><Search size={24} /><p>Start with a few relevant terms. Research uses the last four complete weeks.</p><small>Organic rank and keyword difficulty are not available from this connection.</small></div> : null}
            </section>
          </div>
          <section className="search-variants" aria-label="Draft comparisons"><header><h3>Compare before applying</h3><div><button className="button tertiary" type="button" disabled={busy} onClick={() => { setDraft({ ...metadata.values }); setNotice("Working draft restored to current App Store Connect values."); }}>Restore current</button><button className="button secondary" type="button" disabled={busy || variants.length >= 4} onClick={saveVariant}><Save size={14} />Save variant</button></div></header>
            {variants.length ? <div className="search-variant-list">{variants.map((variant) => <div key={variant.id}><button type="button" disabled={busy} onClick={() => { setDraft({ ...variant.values }); setNotice(`${variant.label} loaded into the working draft.`); }}><ArrowDown size={13} />{variant.label}</button><button type="button" disabled={busy} aria-label={`Delete ${variant.label}`} onClick={() => setVariants((previous) => previous.filter((item) => item.id !== variant.id))}><Trash2 size={13} /></button></div>)}</div> : null}
            <div className="search-comparison"><table><thead><tr><th>Field</th><th>Current in App Store Connect</th><th>Working draft</th></tr></thead><tbody>{searchFields.map((field) => <tr className={draft[field] !== metadata.values[field] ? "changed" : ""} key={field}><th>{searchFieldLabels[field]}</th><td>{metadata.values[field] || <em>Empty</em>}</td><td>{draft[field] || <em>Empty</em>}</td></tr>)}</tbody></table></div>
          </section>
        </>}
      </> : null}
    </div>
    <footer className="dialog-footer search-optimizer-footer"><span>Drafts and variants stay local until you confirm.</span><button className="button secondary" type="button" disabled={busy} onClick={plan ? () => setPlan(null) : onClose}>{plan ? "Back to draft" : "Close"}</button>{plan ? <button className="button primary" type="button" disabled={busy} onClick={() => void confirm()}><Check size={15} />{busy ? "Applying…" : "Apply changes"}</button> : <button className="button primary" type="button" disabled={busy || loading || !editable || !changed || Boolean(analysis?.issues.length) || needsRefresh} onClick={() => void review()}>{busy ? "Preparing review…" : "Review changes"}</button>}</footer>
  </DialogFrame>;
};
