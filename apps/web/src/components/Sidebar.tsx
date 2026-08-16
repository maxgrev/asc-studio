import type { AgentStatus, AppSummary } from "@asc-studio/contracts";
import {
  Activity,
  AppWindow,
  BadgeDollarSign,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Gauge,
  Globe2,
  Orbit,
  Send,
  Star,
} from "lucide-react";
import { useState } from "react";

export type WorkspaceSection = "testflight" | "releases";

const navigation = [
  { label: "Overview", icon: Gauge },
  { label: "TestFlight", icon: Send, section: "testflight" as const },
  { label: "Releases", icon: ClipboardList, section: "releases" as const },
  { label: "Store Listing", icon: FileText },
  { label: "Monetization", icon: CircleDollarSign },
  { label: "Distribution", icon: Globe2 },
  { label: "Reviews", icon: Star },
  { label: "Activity", icon: Activity },
];

interface SidebarProps {
  app: AppSummary | null;
  apps: AppSummary[];
  status: AgentStatus | null;
  activeSection: WorkspaceSection;
  onAppChange: (appId: string) => void;
  onNavigate: (section: WorkspaceSection) => void;
}

export const Sidebar = ({ app, apps, status, activeSection, onAppChange, onNavigate }: SidebarProps) => {
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand">
        <span className="brand-mark"><AppWindow size={19} strokeWidth={2.2} /></span>
        <span>ASC Studio</span>
      </div>

      <div className="app-switcher-wrap">
        <button
          className="app-switcher"
          type="button"
          aria-label="Choose active app"
          aria-expanded={switcherOpen}
          onClick={() => setSwitcherOpen((open) => !open)}
        >
          <span className="app-icon"><Orbit size={24} /></span>
          <span className="app-copy">
            <strong>{app?.name ?? "Loading apps"}</strong>
            <span>{app?.bundleId ?? "Checking local agent"}</span>
          </span>
          <ChevronDown className={switcherOpen ? "switcher-chevron open" : "switcher-chevron"} size={17} />
        </button>
        {switcherOpen ? (
          <div className="app-menu" role="menu" aria-label="Available apps">
            <div className="app-menu-label">Apps in {status?.profile ?? "this profile"}</div>
            {apps.map((candidate) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={candidate.id === app?.id}
                className={candidate.id === app?.id ? "app-menu-item selected" : "app-menu-item"}
                onClick={() => {
                  onAppChange(candidate.id);
                  setSwitcherOpen(false);
                }}
                key={candidate.id}
              >
                <span className="mini-app-icon"><Orbit size={17} /></span>
                <span><strong>{candidate.name}</strong><small>{candidate.bundleId}</small></span>
                {candidate.id === app?.id ? <Check size={16} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <nav className="nav-list">
        {navigation.map(({ label, icon: Icon, section }) => {
          const active = section === activeSection;
          if (section) {
            return (
              <button
                type="button"
                className={active ? "nav-item active" : "nav-item"}
                aria-current={active ? "page" : undefined}
                onClick={() => onNavigate(section)}
                key={label}
              >
                <Icon size={21} strokeWidth={1.8} />
                <span>{label}</span>
              </button>
            );
          }
          return (
            <div className="nav-item unavailable" title="Coming in a later release" key={label}>
              <Icon size={21} strokeWidth={1.8} />
              <span>{label}</span>
            </div>
          );
        })}
      </nav>

      <div className="connection-block">
        <div className="connection-icon"><BadgeDollarSign size={22} /></div>
        <div>
          <div className="connection-title">App Store Connect</div>
          <div className={`connection-state ${status?.connected ? "online" : "offline"}`}>
            <span className="state-dot" />
            {status?.mode === "demo" ? "Demo workspace" : status?.connected ? status.profile ?? "Connected" : "Disconnected"}
          </div>
        </div>
      </div>
    </aside>
  );
};
