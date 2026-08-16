import type { BuildSummary } from "@asc-studio/contracts";
import { ArrowDown } from "lucide-react";

const relativeDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const delta = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.round(delta / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const days = Math.round(minutes / 1_440);
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const expiresIn = (value: string | null) => {
  if (!value) return "—";
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  return days > 0 ? `${days} days` : "Expired";
};

interface BuildTableProps {
  builds: BuildSummary[];
  selectedId: string | null;
  onSelect: (build: BuildSummary) => void;
  loading: boolean;
}

export const BuildTable = ({ builds, selectedId, onSelect, loading }: BuildTableProps) => (
  <section className="build-region" aria-labelledby="recent-builds-heading">
    <h2 id="recent-builds-heading">Recent builds</h2>
    <div className="table-wrap">
      <table className="build-table">
        <thead>
          <tr>
            <th>Build</th>
            <th>Version</th>
            <th><span className="sortable">Uploaded <ArrowDown size={13} /></span></th>
            <th>Processing</th>
            <th>Testing</th>
            <th>Expires</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }, (_, index) => (
              <tr className="skeleton-row" key={index} aria-hidden="true">
                <td colSpan={6}><span /></td>
              </tr>
            ))
          ) : builds.length ? (
            builds.map((build) => (
              <tr
                key={build.id}
                className={selectedId === build.id ? "selected" : undefined}
                onClick={() => onSelect(build)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(build);
                }}
                tabIndex={0}
                aria-selected={selectedId === build.id}
              >
                <td className="build-number">{build.buildNumber}</td>
                <td className="mono">{build.version}</td>
                <td>{relativeDate(build.uploadedAt)}</td>
                <td><span className={`status status-${build.processingTone}`}><span />{build.processingStatus}</span></td>
                <td>{build.testingStatus}</td>
                <td>{expiresIn(build.expiresAt)}</td>
              </tr>
            ))
          ) : (
            <tr className="empty-row"><td colSpan={6}>No builds match these filters.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </section>
);
