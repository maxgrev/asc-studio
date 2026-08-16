import type { ScreenshotAsset } from "@asc-studio/contracts";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef } from "react";

interface ScreenshotLightboxProps {
  assets: ScreenshotAsset[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

export const ScreenshotLightbox = ({ assets, activeIndex, onSelect, onClose }: ScreenshotLightboxProps) => {
  const asset = assets[activeIndex];
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const canPage = assets.length > 1;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && canPage) onSelect((activeIndex - 1 + assets.length) % assets.length);
      if (event.key === "ArrowRight" && canPage) onSelect((activeIndex + 1) % assets.length);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, assets.length, canPage, onClose, onSelect]);

  if (!asset) return null;

  const previousIndex = (activeIndex - 1 + assets.length) % assets.length;
  const nextIndex = (activeIndex + 1) % assets.length;
  const fullImageUrl = asset.fullImageUrl ?? asset.imageUrl;

  return (
    <div className="screenshot-lightbox" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="screenshot-lightbox-dialog" role="dialog" aria-modal="true" aria-labelledby="screenshot-lightbox-title">
        <header className="screenshot-lightbox-header">
          <div>
            <h2 id="screenshot-lightbox-title">{asset.fileName}</h2>
            <p>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "Dimensions unavailable"} · {activeIndex + 1} of {assets.length}</p>
          </div>
          <button ref={closeButtonRef} className="screenshot-lightbox-control" type="button" aria-label="Close screenshot preview" onClick={onClose}><X size={21} /></button>
        </header>

        <div className="screenshot-lightbox-stage">
          {canPage ? <button className="screenshot-lightbox-control previous" type="button" aria-label="Previous screenshot" onClick={() => onSelect(previousIndex)}><ChevronLeft size={27} /></button> : null}
          {fullImageUrl ? (
            <img
              key={asset.id}
              src={fullImageUrl}
              alt={`Full preview of ${asset.fileName}`}
              onError={(event) => {
                if (asset.imageUrl && event.currentTarget.src !== asset.imageUrl) event.currentTarget.src = asset.imageUrl;
              }}
            />
          ) : (
            <div className="screenshot-lightbox-unavailable">Preview unavailable</div>
          )}
          {canPage ? <button className="screenshot-lightbox-control next" type="button" aria-label="Next screenshot" onClick={() => onSelect(nextIndex)}><ChevronRight size={27} /></button> : null}
        </div>

        {canPage ? (
          <div className="screenshot-lightbox-rail" aria-label="Choose a screenshot">
            {assets.map((candidate, index) => (
              <button className={index === activeIndex ? "active" : ""} type="button" aria-label={`View ${candidate.fileName}`} aria-current={index === activeIndex ? "true" : undefined} onClick={() => onSelect(index)} key={candidate.id}>
                {candidate.imageUrl ? <img src={candidate.imageUrl} alt="" /> : <span>{index + 1}</span>}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
};
