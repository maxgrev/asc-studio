import type { UpsertCustomerReviewResponseMutationPlan } from "@asc-studio/contracts";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

interface ReviewResponseDialogProps {
  plan: UpsertCustomerReviewResponseMutationPlan;
  busy: boolean;
  demo: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

const planTime = (value: string) => new Date(value).toLocaleTimeString([], {
  hour: "numeric",
  minute: "2-digit",
});

export const ReviewResponseDialog = ({ plan, busy, demo, error, onConfirm, onClose }: ReviewResponseDialogProps) => {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const existingResponse = plan.before.response?.responseBody ?? "";
  const replacing = Boolean(plan.before.response);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const keepFocusInside = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
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

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section ref={dialog} className="dialog review-response-dialog" role="dialog" aria-modal="true" aria-labelledby="review-response-dialog-title" onKeyDown={keepFocusInside}>
        <header className="dialog-header">
          <div>
            <h2 id="review-response-dialog-title">Review public response</h2>
            <p>{plan.before.rating} stars · {plan.before.reviewerNickname || "Anonymous reviewer"} · {plan.before.territory}</p>
          </div>
          <button ref={closeButton} className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close response review"><X size={19} /></button>
        </header>

        <div className="dialog-content review-response-plan">
          <div className="review-plan-source">
            <strong>{plan.before.title || "Untitled review"}</strong>
            <p>{plan.before.body || "The reviewer did not include written feedback."}</p>
          </div>

          <div className="review-label">Review exact Apple response</div>
          <div className="review-response-diff">
            <div>
              <small>Current response</small>
              <p>{existingResponse || "No public response"}</p>
            </div>
            <ArrowRight size={19} aria-hidden="true" />
            <div>
              <small>Proposed response</small>
              <p>{plan.after.responseBody}</p>
            </div>
          </div>

          <dl className="plan-details review-plan-details">
            <div><dt>Action</dt><dd>{replacing ? "Replace public response" : "Create public response"}</dd></div>
            <div><dt>Target</dt><dd>{plan.target.reviewTitle || plan.target.reviewId}</dd></div>
            <div><dt>Apple account</dt><dd>{plan.context.profile ?? "Active connection"}</dd></div>
            <div><dt>Plan expires</dt><dd>{planTime(plan.expiresAt)}</dd></div>
          </dl>

          <div className="review-public-warning">
            <AlertTriangle size={17} />
            <span>{demo
              ? "Demo mode keeps this response inside isolated sample data. ASC Studio will still re-read the review before confirming."
              : "This confirms a real public App Store response. ASC Studio will re-read the review and current response before writing."}</span>
          </div>
        </div>

        {error ? <div className="dialog-error" role="alert">{error}</div> : null}
        <footer className="dialog-footer">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "Confirming…" : replacing ? "Confirm replacement" : "Confirm response"}
          </button>
        </footer>
      </section>
    </div>
  );
};
