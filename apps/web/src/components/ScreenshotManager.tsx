import type {
  AppStorePlatform,
  AppStoreVersion,
  ScreenshotAsset,
  ScreenshotDisplayType,
  ScreenshotUploadReceipt,
  UpdateScreenshotsMutationPlan,
  VersionLocalization,
} from "@asc-studio/contracts";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, Image as ImageIcon, ImagePlus, Maximize2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api.js";
import { localeNames } from "../releaseMetadata.js";
import { ScreenshotReviewDialog } from "./ReleaseDialogs.js";
import { ScreenshotLightbox } from "./ScreenshotLightbox.js";

interface ScreenshotManagerProps {
  appId: string;
  version: AppStoreVersion;
  localizations: VersionLocalization[];
  visible: boolean;
  locked?: boolean;
  onChanged: () => Promise<void>;
  onPendingChange: (pending: boolean, applying: boolean) => void;
}

interface DeviceOption {
  value: ScreenshotDisplayType;
  label: string;
  hint: string;
  family?: string;
}

const deviceOptions: Record<AppStorePlatform, DeviceOption[]> = {
  IOS: [
    { value: "APP_IPHONE_65", label: "iPhone 6.5-inch", hint: "1242 × 2688 or 1284 × 2778", family: "iPhone" },
    { value: "APP_IPHONE_69", label: "iPhone 6.9-inch", hint: "1260 × 2736, 1290 × 2796, or 1320 × 2868", family: "iPhone" },
    { value: "APP_IPHONE_67", label: "iPhone 6.7-inch", hint: "1260 × 2736, 1290 × 2796, or 1320 × 2868", family: "iPhone" },
    { value: "APP_IPHONE_55", label: "iPhone 5.5-inch", hint: "1242 × 2208", family: "iPhone" },
    { value: "APP_IPAD_PRO_3GEN_129", label: "iPad 13-inch", hint: "2048 × 2732 or 2064 × 2752", family: "iPad" },
    { value: "APP_IPAD_PRO_129", label: "iPad 12.9-inch", hint: "2048 × 2732 or 2064 × 2752", family: "iPad" },
    { value: "APP_WATCH_ULTRA", label: "Apple Watch Ultra", hint: "410 × 502 or 422 × 514", family: "Apple Watch" },
    { value: "APP_WATCH_SERIES_10", label: "Apple Watch Series 10", hint: "416 × 496", family: "Apple Watch" },
    { value: "APP_WATCH_SERIES_7", label: "Apple Watch Series 7", hint: "396 × 484", family: "Apple Watch" },
  ],
  MAC_OS: [{ value: "APP_DESKTOP", label: "Mac", hint: "16:10 · up to 2880 × 1800" }],
  TV_OS: [{ value: "APP_APPLE_TV", label: "Apple TV", hint: "1920 × 1080 or 3840 × 2160" }],
  VISION_OS: [{ value: "APP_APPLE_VISION_PRO", label: "Apple Vision Pro", hint: "3840 × 2160" }],
};

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes >= 1_000_000 ? 1 : 2)} MB`;

export const ScreenshotManager = ({
  appId,
  version,
  localizations,
  visible,
  locked = false,
  onChanged,
  onPendingChange,
}: ScreenshotManagerProps) => {
  const options = deviceOptions[version.platform];
  const initialDevice = options[0]!;
  const preferredLocalization = localizations.find((localization) => localization.locale === "en-US") ?? localizations[0] ?? null;
  const [selectedLocalizationId, setSelectedLocalizationId] = useState<string | null>(null);
  const [displayType, setDisplayType] = useState<ScreenshotDisplayType>(initialDevice.value);
  const [assets, setAssets] = useState<ScreenshotAsset[]>([]);
  const [staged, setStaged] = useState<ScreenshotUploadReceipt[]>([]);
  const [deleteIds, setDeleteIds] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<"append" | "replace">("append");
  const [plan, setPlan] = useState<UpdateScreenshotsMutationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const stagedUploadsRef = useRef(new Map<string, string>());
  const mountedRef = useRef(true);
  const applyingRef = useRef(false);
  const assetLoadGeneration = useRef(0);

  const selectedLocalization = localizations.find((localization) => localization.id === selectedLocalizationId)
    ?? preferredLocalization;
  const selectedOption = options.find((option) => option.value === displayType) ?? initialDevice;
  const optionFamilies = [...new Set(options.map((option) => option.family).filter((family): family is string => Boolean(family)))];
  const effectiveDeleteCount = strategy === "replace" ? assets.length : deleteIds.size;
  const resultCount = assets.length - effectiveDeleteCount + staged.length;
  const availableSlots = 10 - (strategy === "replace" ? 0 : assets.length - deleteIds.size) - staged.length;
  const hasPendingChanges = staged.length > 0 || deleteIds.size > 0 || plan !== null || (strategy === "replace" && assets.length > 0);
  const controlsLocked = locked || hasPendingChanges || loading || uploading || busy;
  const previewIndex = previewAssetId ? assets.findIndex((asset) => asset.id === previewAssetId) : -1;

  const loadAssets = async () => {
    const generation = ++assetLoadGeneration.current;
    if (!selectedLocalization) {
      setAssets([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.screenshots(appId, version.id, selectedLocalization.id, displayType);
      if (mountedRef.current && generation === assetLoadGeneration.current) setAssets(response.screenshots);
    } catch (nextError) {
      if (mountedRef.current && generation === assetLoadGeneration.current) {
        setError(nextError instanceof Error ? nextError.message : "ASC Studio could not load screenshots.");
      }
    } finally {
      if (mountedRef.current && generation === assetLoadGeneration.current) setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const generation = ++assetLoadGeneration.current;
    if (!selectedLocalization) {
      setAssets([]);
      return () => {
        cancelled = true;
        if (generation === assetLoadGeneration.current) assetLoadGeneration.current += 1;
      };
    }
    setLoading(true);
    setError(null);
    void api.screenshots(appId, version.id, selectedLocalization.id, displayType)
      .then((response) => {
        if (!cancelled && generation === assetLoadGeneration.current) setAssets(response.screenshots);
      })
      .catch((nextError: unknown) => {
        if (!cancelled && generation === assetLoadGeneration.current) setError(nextError instanceof Error ? nextError.message : "ASC Studio could not load screenshots.");
      })
      .finally(() => {
        if (!cancelled && generation === assetLoadGeneration.current) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (generation === assetLoadGeneration.current) assetLoadGeneration.current += 1;
    };
  }, [appId, displayType, selectedLocalization?.id, version.id]);

  useEffect(() => {
    onPendingChange(hasPendingChanges || uploading || busy, applying);
  }, [applying, busy, hasPendingChanges, onPendingChange, uploading]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      assetLoadGeneration.current += 1;
      if (applyingRef.current) return;
      for (const [uploadId, fileName] of stagedUploadsRef.current) {
        void api.discardScreenshotUpload({ uploadId, fileName }).catch(() => undefined);
      }
    };
  }, []);

  const stageFiles = async (files: File[]) => {
    if (!version.editable || !selectedLocalization || files.length === 0 || locked || uploading || plan) return;
    if (files.length > availableSlots) {
      setError(`This set has room for ${Math.max(availableSlots, 0)} more screenshot${availableSlots === 1 ? "" : "s"}.`);
      return;
    }
    const queuedNames = new Set(staged.map((upload) => upload.fileName.toLowerCase()));
    const incomingNames = files.map((file) => file.name.toLowerCase());
    const existingNames = new Set(assets.map((asset) => asset.fileName.toLowerCase()));
    if (
      new Set(incomingNames).size !== incomingNames.length
      || files.some((file) => queuedNames.has(file.name.toLowerCase()))
      || (strategy === "append" && files.some((file) => existingNames.has(file.name.toLowerCase())))
    ) {
      setError("Each queued screenshot needs a unique file name.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const results = await Promise.allSettled(files.map((file) => api.stageScreenshot(file, displayType)));
      const responses = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (!mountedRef.current) {
        await Promise.allSettled(responses.map((response) => api.discardScreenshotUpload(response.upload)));
        return;
      }
      for (const response of responses) {
        stagedUploadsRef.current.set(response.upload.uploadId, response.upload.fileName);
      }
      setStaged((current) => [...current, ...responses.map((response) => response.upload)]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    } catch (nextError) {
      if (mountedRef.current) setError(nextError instanceof Error ? nextError.message : "ASC Studio could not stage the screenshots.");
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  };

  const removeStaged = (upload: ScreenshotUploadReceipt) => {
    stagedUploadsRef.current.delete(upload.uploadId);
    setStaged((current) => current.filter((candidate) => candidate.uploadId !== upload.uploadId));
    void api.discardScreenshotUpload(upload).catch(() => undefined);
  };

  const moveStaged = (index: number, direction: -1 | 1) => {
    setStaged((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(destination, 0, moved);
      return next;
    });
  };

  const toggleDelete = (id: string) => {
    setDeleteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const review = async () => {
    if (locked || plan || !selectedLocalization || resultCount > 10 || (!staged.length && !deleteIds.size && strategy !== "replace")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.planScreenshots({
        appId,
        versionId: version.id,
        localizationId: selectedLocalization.id,
        locale: selectedLocalization.locale,
        displayType,
        strategy,
        uploads: staged,
        deleteIds: strategy === "replace" ? [] : [...deleteIds],
      });
      setPlan(response.plan);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "ASC Studio could not create the screenshot plan.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!plan) return;
    applyingRef.current = true;
    onPendingChange(true, true);
    setApplying(true);
    setBusy(true);
    setError(null);
    try {
      await api.confirmPlan(plan);
      stagedUploadsRef.current.clear();
      if (!mountedRef.current) return;
      setStaged([]);
      setDeleteIds(new Set());
      setStrategy("append");
      setPlan(null);
      await Promise.all([loadAssets(), onChanged()]);
    } catch (nextError) {
      if (!mountedRef.current) return;
      if (nextError instanceof ApiError && ["plan_expired", "stale_plan", "plan_not_confirmable"].includes(nextError.code)) {
        setPlan(null);
      }
      setError(nextError instanceof Error ? nextError.message : "The screenshot update failed.");
    } finally {
      applyingRef.current = false;
      if (!mountedRef.current) {
        const trackedUploads = [...stagedUploadsRef.current].map(([uploadId, fileName]) => ({ uploadId, fileName }));
        stagedUploadsRef.current.clear();
        await Promise.allSettled(trackedUploads.map((upload) => api.discardScreenshotUpload(upload)));
        return;
      }
      setApplying(false);
      setBusy(false);
    }
  };

  return (
    <>
      <section className="screenshots-region" hidden={!visible} inert={plan ? true : undefined} aria-label="App Store screenshots">
        <header className="screenshots-header">
          <div><h2>Screenshots</h2><p>Manage one locale and device set at a time.</p></div>
          <button className="button secondary" type="button" disabled={!selectedLocalization || controlsLocked || loading} onClick={() => { setPreviewAssetId(null); void loadAssets(); }}><RefreshCw size={15} />Refresh</button>
        </header>

        <div className="screenshot-toolbar">
          <label className="screenshot-field">
            <span className="screenshot-field-label">Locale</span>
            <span className="screenshot-select"><select value={selectedLocalization?.id ?? ""} disabled={controlsLocked || localizations.length === 0} onChange={(event) => { setPreviewAssetId(null); setSelectedLocalizationId(event.target.value); }}>{localizations.map((localization) => <option value={localization.id} key={localization.id}>{localeNames[localization.locale]} · {localization.locale}</option>)}</select><ChevronDown size={14} /></span>
          </label>
          <label className="screenshot-field">
            <span className="screenshot-field-label">Device set</span>
            <span className="screenshot-select"><select value={displayType} disabled={!selectedLocalization || controlsLocked} onChange={(event) => { setPreviewAssetId(null); setDisplayType(event.target.value as ScreenshotDisplayType); }}>{optionFamilies.length ? optionFamilies.map((family) => <optgroup label={family} key={family}>{options.filter((option) => option.family === family).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</optgroup>) : options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><ChevronDown size={14} /></span>
          </label>
          <div className="screenshot-dimension-hint"><strong>{selectedOption.label}</strong><span>{selectedOption.hint}</span></div>
          <div className="screenshot-strategy" aria-label="Upload mode">
            <button type="button" className={strategy === "append" ? "active" : ""} aria-pressed={strategy === "append"} disabled={!version.editable || !selectedLocalization || locked || busy || uploading || Boolean(plan)} onClick={() => setStrategy("append")}>Add</button>
            <button type="button" className={strategy === "replace" ? "active" : ""} aria-pressed={strategy === "replace"} disabled={!version.editable || !selectedLocalization || locked || busy || uploading || Boolean(plan)} onClick={() => { setStrategy("replace"); setDeleteIds(new Set()); }}>Replace set</button>
          </div>
        </div>

        {error ? <div className="inline-error screenshot-error" role="alert">{error}</div> : null}
        <div className="screenshot-scroll">
          <section className="screenshot-set">
            <header><div><h3>In App Store Connect</h3><p>{loading ? "Loading…" : `${assets.length} of 10 screenshots`}</p></div>{strategy === "replace" && assets.length ? <span className="replace-badge">Set will be replaced</span> : null}</header>
            {loading ? (
              <div className="screenshot-loading"><span className="spinner" />Loading this screenshot set…</div>
            ) : assets.length ? (
              <div className="screenshot-grid">
                {assets.map((asset, index) => {
                  const scheduled = strategy === "replace" || deleteIds.has(asset.id);
                  const orientation = asset.width && asset.height && asset.width > asset.height ? "landscape" : "portrait";
                  return (
                    <article className={`${scheduled ? "screenshot-card scheduled" : "screenshot-card"} ${orientation}`} key={asset.id}>
                      <button
                        className="screenshot-preview-button"
                        style={{ aspectRatio: asset.width && asset.height ? `${asset.width} / ${asset.height}` : undefined }}
                        type="button"
                        aria-label={`View ${asset.fileName} full size`}
                        onClick={() => setPreviewAssetId(asset.id)}
                      >
                        {asset.imageUrl ? <img src={asset.imageUrl} alt="" /> : <div className={`demo-shot tone-${index % 4}`}><ImageIcon size={28} /><span>{index + 1}</span></div>}
                        <span className="screenshot-position" aria-hidden="true">{index + 1}</span>
                        <span className="screenshot-expand-cue" aria-hidden="true"><Maximize2 size={14} /></span>
                        {scheduled ? <span className="screenshot-removal">Remove</span> : null}
                      </button>
                      <div className="screenshot-card-copy"><strong title={asset.fileName}>{asset.fileName}</strong><small>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "Dimensions unavailable"} · {asset.fileSize ? megabytes(asset.fileSize) : "Size unavailable"}</small></div>
                      <button className="icon-button" type="button" aria-label={deleteIds.has(asset.id) ? `Keep ${asset.fileName}` : `Remove ${asset.fileName}`} disabled={!version.editable || strategy === "replace" || locked || busy || Boolean(plan)} onClick={() => toggleDelete(asset.id)}><Trash2 size={16} /></button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="screenshot-empty"><ImageIcon size={24} /><strong>{selectedLocalization ? "No screenshots in this set" : "No storefront localization"}</strong><span>{selectedLocalization ? "Add at least one before submitting this platform version." : "Add a localization in App Store Connect before uploading screenshots."}</span></div>
            )}
          </section>

          <section className={staged.length ? "screenshot-set queued-set" : "screenshot-set queued-set empty"}>
            <header><div><h3>Ready to upload</h3><p>{staged.length ? `${staged.length} staged locally · review the order below` : "PNG or JPEG · no transparency · up to 10 per set"}</p></div><strong className={resultCount > 10 ? "count-invalid" : ""}>{resultCount}/10 after changes</strong></header>
            <label className={!version.editable || !selectedLocalization || locked || plan ? "screenshot-dropzone disabled" : availableSlots <= 0 ? "screenshot-dropzone full" : "screenshot-dropzone"} aria-disabled={!version.editable || !selectedLocalization || locked || Boolean(plan) || availableSlots <= 0} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (selectedLocalization && !locked && availableSlots > 0 && !plan) void stageFiles(Array.from(event.dataTransfer.files)); }}>
              <input type="file" accept="image/png,image/jpeg" multiple disabled={!version.editable || !selectedLocalization || locked || uploading || busy || Boolean(plan) || availableSlots <= 0} onChange={(event) => { void stageFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
              {!selectedLocalization ? <><ImageIcon size={25} /><strong>Add a storefront localization first</strong><span>Screenshots must belong to a locale in App Store Connect.</span></> : uploading ? <><span className="spinner" /><strong>Checking and staging files…</strong></> : availableSlots <= 0 ? <><CheckCircle2 size={25} /><strong>All 10 slots are filled</strong><span>Remove a screenshot or switch to Replace set to upload a new sequence.</span></> : <><ImagePlus size={25} /><strong>Drop screenshots here or choose files</strong><span>ASC Studio checks the actual image data, dimensions, and transparency.</span></>}
            </label>
            {staged.length ? (
              <ol className="staged-screenshot-list">
                {staged.map((upload, index) => (
                  <li key={upload.uploadId}>
                    <span className="staged-order">{index + 1}</span>
                    <div><strong>{upload.fileName}</strong><small>{upload.width} × {upload.height} · {megabytes(upload.fileSize)}</small></div>
                    <button className="icon-button" type="button" aria-label={`Move ${upload.fileName} up`} disabled={index === 0 || locked || busy || Boolean(plan)} onClick={() => moveStaged(index, -1)}><ArrowUp size={15} /></button>
                    <button className="icon-button" type="button" aria-label={`Move ${upload.fileName} down`} disabled={index === staged.length - 1 || locked || busy || Boolean(plan)} onClick={() => moveStaged(index, 1)}><ArrowDown size={15} /></button>
                    <button className="icon-button danger" type="button" aria-label={`Discard ${upload.fileName}`} disabled={locked || busy || Boolean(plan)} onClick={() => removeStaged(upload)}><Trash2 size={15} /></button>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        </div>

        <footer className="screenshot-footer">
          <div><strong>{!selectedLocalization ? "Localization required" : hasPendingChanges ? "Local screenshot changes" : "Screenshot set matches App Store Connect"}</strong><span>{!selectedLocalization ? "Create a storefront localization before managing screenshots." : hasPendingChanges ? "Review an exact plan before upload." : "Select another locale or device set to inspect it."}</span></div>
          <button className={hasPendingChanges ? "button primary" : "button secondary"} type="button" disabled={!version.editable || !selectedLocalization || locked || busy || uploading || Boolean(plan) || resultCount > 10 || (!staged.length && !deleteIds.size && strategy !== "replace")} onClick={() => void review()}><Upload size={16} />{busy ? "Preparing plan…" : "Review changes"}</button>
        </footer>
      </section>

      {plan ? <ScreenshotReviewDialog plan={plan} busy={busy} error={error} onConfirm={() => void confirm()} onClose={() => { if (!busy) setPlan(null); }} /> : null}
      {visible && previewIndex >= 0 ? <ScreenshotLightbox assets={assets} activeIndex={previewIndex} onSelect={(index) => setPreviewAssetId(assets[index]?.id ?? null)} onClose={() => setPreviewAssetId(null)} /> : null}
    </>
  );
};
