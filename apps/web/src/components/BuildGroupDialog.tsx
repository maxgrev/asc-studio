import type { BuildGroupMutationPlan, BuildSummary, TesterGroup } from "@asc-studio/contracts";
import { AlertTriangle, ArrowRight, Check, X } from "lucide-react";
import { useEffect, useState } from "react";

interface BuildGroupDialogProps {
  build: BuildSummary;
  groups: TesterGroup[];
  plan: BuildGroupMutationPlan | null;
  busy: boolean;
  error: string | null;
  onReview: (groupId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export const BuildGroupDialog = ({ build, groups, plan, busy, error, onReview, onConfirm, onClose }: BuildGroupDialogProps) => {
  const available = groups.filter((group) => !build.groups.some((assigned) => assigned.id === group.id));
  const [groupId, setGroupId] = useState(available[0]?.id ?? "");
  const namesFor = (ids: string[]) => ids.map((id) => groups.find((group) => group.id === id)?.name ?? id);

  useEffect(() => {
    setGroupId(available[0]?.id ?? "");
  }, [build.id]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="group-dialog-title">
        <header className="dialog-header">
          <div>
            <h2 id="group-dialog-title">Add build to a tester group</h2>
            <p>Build {build.buildNumber} · Version {build.version}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={19} /></button>
        </header>

        {!plan ? (
          <div className="dialog-content">
            <fieldset className="group-options">
              <legend>Select a group</legend>
              {available.length ? available.map((group) => (
                <label className={group.id === groupId ? "group-option selected" : "group-option"} key={group.id}>
                  <input type="radio" name="group" value={group.id} checked={group.id === groupId} onChange={() => setGroupId(group.id)} />
                  <span className="radio-ui">{group.id === groupId ? <Check size={12} strokeWidth={3} /> : null}</span>
                  <span><strong>{group.name}</strong><small>{group.internal ? "Internal" : "External"} · {group.testerCount === null ? "Count unavailable" : `${group.testerCount} testers`}</small></span>
                </label>
              )) : <p className="empty-options">This build is already assigned to every available group.</p>}
            </fieldset>
            <div className="safety-note"><AlertTriangle size={17} /><span>ASC Studio will create an expiring plan and re-check the build before it changes App Store Connect.</span></div>
          </div>
        ) : (
          <div className="dialog-content">
            <div className="review-label">Review exact change</div>
            <div className="change-diff">
              <div><small>Before</small><strong>{plan.before.groupIds.length ? namesFor(plan.before.groupIds).join(", ") : "No assigned groups"}</strong></div>
              <ArrowRight size={20} />
              <div><small>After</small><strong>{namesFor(plan.after.groupIds).join(", ")}</strong></div>
            </div>
            <dl className="plan-details">
              <div><dt>Target</dt><dd>{plan.target.buildLabel}</dd></div>
              <div><dt>Action</dt><dd>Add to {plan.target.groupName}</dd></div>
              <div><dt>Plan expires</dt><dd>{new Date(plan.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</dd></div>
            </dl>
          </div>
        )}

        {error ? <div className="dialog-error" role="alert">{error}</div> : null}
        <footer className="dialog-footer">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          {!plan ? (
            <button className="button primary" type="button" disabled={!groupId || busy} onClick={() => onReview(groupId)}>
              {busy ? "Creating plan…" : "Review change"}
            </button>
          ) : (
            <button className="button primary" type="button" disabled={busy} onClick={onConfirm}>
              {busy ? "Applying…" : `Confirm add to ${plan.target.groupName}`}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
};
