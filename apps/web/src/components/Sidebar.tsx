import type { AgentStatus, AppleAdsStatus, AppStoreConnectAccount, AppSummary } from "@asc-studio/contracts";
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
  Plus,
  Send,
  Settings2,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState } from "react";

export type WorkspaceSection = "overview" | "testflight" | "releases" | "apple-ads";

const navigation = [
  { label: "Overview", icon: Gauge, section: "overview" as const },
  { label: "TestFlight", icon: Send, section: "testflight" as const },
  { label: "Releases", icon: ClipboardList, section: "releases" as const },
  { label: "Apple Ads", icon: BadgeDollarSign, section: "apple-ads" as const },
  { label: "Store Listing", icon: FileText },
  { label: "Monetization", icon: CircleDollarSign },
  { label: "Distribution", icon: Globe2 },
  { label: "Reviews", icon: Star },
  { label: "Activity", icon: Activity },
];

interface SidebarProps {
  app: AppSummary | null;
  apps: AppSummary[];
  accounts: AppStoreConnectAccount[];
  status: AgentStatus | null;
  activeSection: WorkspaceSection;
  onAppChange: (appId: string) => void;
  onNavigate: (section: WorkspaceSection) => void;
  onAccountChange: (connectionId: string) => Promise<void>;
  onAddAccount: () => void;
  onRemoveAccount: (connectionId: string) => Promise<void>;
  appleAdsStatus: AppleAdsStatus | null;
  onManageAppleServices: () => void;
}

export const Sidebar = ({
  app,
  apps,
  accounts,
  status,
  activeSection,
  onAppChange,
  onNavigate,
  onAccountChange,
  onAddAccount,
  onRemoveAccount,
  onManageAppleServices,
}: SidebarProps) => {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountBusy, setAccountBusy] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const serviceState = status?.mode === "demo"
    ? "Demo"
    : status?.connected
      ? "Connected"
      : "Disconnected";

  const switchAccount = async (connectionId: string) => {
    setAccountBusy(connectionId);
    setAccountError(null);
    try {
      await onAccountChange(connectionId);
      setAccountMenuOpen(false);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "ASC Studio could not switch accounts.");
    } finally {
      setAccountBusy(null);
    }
  };

  const removeAccount = async (account: AppStoreConnectAccount) => {
    if (!window.confirm(`Remove “${account.profileName}” from this Mac? The saved private key will be deleted.`)) return;
    setAccountBusy(account.id);
    setAccountError(null);
    try {
      await onRemoveAccount(account.id);
      setAccountMenuOpen(false);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "ASC Studio could not remove the account.");
    } finally {
      setAccountBusy(null);
    }
  };

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
            <div className="app-menu-label">Apps in {status?.profile ?? "this connection"}</div>
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
                aria-label={label}
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

      <div className="account-switcher-wrap">
        <button
          className="connection-block"
          type="button"
          disabled={!status}
          aria-label="Apple services"
          aria-expanded={accountMenuOpen}
          onClick={() => {
            if (status?.mode === "live" && accounts.length > 0) setAccountMenuOpen((open) => !open);
            else onManageAppleServices();
          }}
        >
          <div className="connection-icon"><BadgeDollarSign size={22} /></div>
          <div className="connection-copy">
            <div className="connection-title">Apple services</div>
            <div className={`connection-state ${status?.connected ? "online" : "offline"}`}>
              <span className="state-dot" />
              {serviceState}
            </div>
          </div>
          {status?.mode === "live" && accounts.length > 0
            ? <ChevronDown className={accountMenuOpen ? "switcher-chevron open" : "switcher-chevron"} size={16} />
            : null}
        </button>
        {accountMenuOpen && status?.mode === "live" ? (
          <div className="account-menu" role="menu" aria-label="Apple organizations">
            <div className="app-menu-label">Apple organizations</div>
            {accounts.map((account) => (
              <div className="account-menu-row" key={account.id}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={account.active}
                  className={account.active ? "account-menu-item selected" : "account-menu-item"}
                  disabled={accountBusy !== null}
                  onClick={() => void switchAccount(account.id)}
                >
                  <span className="account-avatar"><UserRound size={16} /></span>
                  <span><strong>{account.profileName}</strong><small>{account.source === "environment" ? "Environment variables" : `App Store Connect key ${account.keyId}`}</small></span>
                  {account.active ? <Check size={16} /> : null}
                </button>
                {account.source === "local" ? (
                  <button
                    className="account-remove"
                    type="button"
                    aria-label={`Remove ${account.profileName}`}
                    disabled={accountBusy !== null}
                    onClick={() => void removeAccount(account)}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
            ))}
            {accountError ? <p className="account-menu-error" role="alert">{accountError}</p> : null}
            <button className="account-add" type="button" role="menuitem" onClick={() => {
              setAccountMenuOpen(false);
              onManageAppleServices();
            }}>
              <Settings2 size={16} /> Manage Apple services
            </button>
            {accounts.every((account) => account.source === "local") ? (
              <button className="account-add" type="button" role="menuitem" onClick={() => {
                setAccountMenuOpen(false);
                onAddAccount();
              }}>
                <Plus size={16} /> Add App Store Connect account
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
};
