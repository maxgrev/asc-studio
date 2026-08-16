import type { AuditEvent } from "@asc-studio/contracts";
import { ChevronDown, ChevronUp } from "lucide-react";

interface ActivityDockProps {
  events: AuditEvent[];
  expanded: boolean;
  onToggle: () => void;
}

export const ActivityDock = ({ events, expanded, onToggle }: ActivityDockProps) => {
  const latest = events[0];
  return (
    <section className={expanded ? "activity-dock expanded" : "activity-dock"} aria-label="Activity log">
      <button className="activity-summary" type="button" onClick={onToggle} aria-expanded={expanded}>
        <span className={`activity-dot ${latest?.status ?? "success"}`} />
        <strong>{latest?.summary ?? "Sync complete"}</strong>
        <time>{latest ? new Date(latest.timestamp).toLocaleTimeString([], { hour12: false }) : "12:04:18"}</time>
        <span className="activity-spacer" />
        <span className="view-log">{expanded ? "Hide log" : "View log"}</span>
        {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {expanded ? (
        <div className="activity-list">
          {events.length ? events.map((event) => (
            <div className="activity-entry" key={event.id}>
              <time>{new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}</time>
              <code>{event.operation}</code>
              <span>{event.summary}</span>
              <strong className={`event-${event.status}`}>{event.phase}</strong>
            </div>
          )) : <p>No actions recorded in this workspace yet.</p>}
        </div>
      ) : null}
    </section>
  );
};
