import type { AppSummary, BuildSummary } from "@asc-studio/contracts";
import { Check, ExternalLink, Users, X } from "lucide-react";

const formatDate = (value: string | null, includeTime = false) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, includeTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" });
};

interface BuildInspectorProps {
  app: AppSummary | null;
  build: BuildSummary;
  onClose: () => void;
  onAddGroup: () => void;
}

export const BuildInspector = ({ app, build, onClose, onAddGroup }: BuildInspectorProps) => {
  const assigned = build.groups;
  const stages = [
    { label: "Uploaded", state: "complete" },
    { label: "Processed", state: build.processingTone === "progress" ? "active" : "complete" },
    { label: "Compliance", state: build.processingTone === "warning" ? "active" : "complete" },
    { label: "Internal testing", state: "active" },
    { label: "External review", state: build.testingStatus === "External" ? "complete" : "pending" },
  ];

  return (
    <aside className="inspector" aria-label={`Build ${build.buildNumber} details`}>
      <header className="inspector-header">
        <h2>Build {build.buildNumber}</h2>
        <div className="inspector-actions">
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close build details"><X size={18} /></button>
        </div>
      </header>

      <ol className="stage-rail">
        {stages.map((stage) => (
          <li className={stage.state} key={stage.label}>
            <span className="stage-node">{stage.state === "complete" ? <Check size={12} strokeWidth={3} /> : null}</span>
            <span>{stage.label}</span>
          </li>
        ))}
      </ol>

      <dl className="build-details">
        <div><dt>Version</dt><dd className="mono">{build.version}</dd></div>
        <div><dt>SDK</dt><dd className="mono">{build.sdk ?? "—"}</dd></div>
        <div><dt>Uploaded</dt><dd className="mono">{formatDate(build.uploadedAt, true)}</dd></div>
        <div><dt>Expires</dt><dd className="mono">{formatDate(build.expiresAt)}</dd></div>
        <div><dt>Encryption</dt><dd className="mono">{build.encryption ?? "—"}</dd></div>
        <div><dt>Minimum OS</dt><dd className="mono">{build.minimumOs ?? "—"}</dd></div>
      </dl>

      <section className="tester-groups" aria-labelledby="tester-groups-heading">
        <h3 id="tester-groups-heading">Tester groups</h3>
        {assigned.length ? assigned.map((group) => (
          <div className="group-row" key={group.id}>
            <Users size={18} />
            <span>{group.name}</span>
            <span className="group-count">{group.testerCount === null ? "Count unavailable" : `${group.testerCount} testers`}</span>
          </div>
        )) : <p className="no-groups">No groups assigned yet.</p>}
      </section>

      <section className="inspector-buttons" aria-label="Build actions">
        <h3>Actions</h3>
        <button className="button primary full" type="button" onClick={onAddGroup}>Add to group</button>
        <a
          className="button secondary full"
          href={app ? `https://appstoreconnect.apple.com/apps/${app.id}/testflight` : "https://appstoreconnect.apple.com/"}
          target="_blank"
          rel="noreferrer"
        >
          Open in App Store Connect <ExternalLink size={14} />
        </a>
      </section>
    </aside>
  );
};
