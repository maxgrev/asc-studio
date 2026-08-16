import type { AgentStatus } from "@asc-studio/contracts";
import { CheckCircle2, KeyRound, LockKeyhole } from "lucide-react";
import { AppleAccountForm } from "./AppleAccountForm.js";

interface ConnectionSetupProps {
  status: AgentStatus;
  onConnected: (status: AgentStatus) => void;
}

export const ConnectionSetup = ({ status, onConnected }: ConnectionSetupProps) => {
  return (
    <main className="connection-setup-workspace">
      <section className="connection-setup-card" aria-labelledby="connection-setup-title">
        <header>
          <span className="connection-setup-icon"><KeyRound size={24} /></span>
          <div>
            <p className="connection-setup-kicker">Direct Apple API connection</p>
            <h1 id="connection-setup-title">Connect App Store Connect</h1>
            <p>ASC Studio signs Apple API requests itself. No third-party CLI is installed or called.</p>
          </div>
        </header>

        <div className="connection-setup-steps" aria-label="Connection requirements">
          <div><CheckCircle2 size={17} /><span>In App Store Connect, open <strong>Users and Access → Integrations</strong>.</span></div>
          <div><CheckCircle2 size={17} /><span>Create a team API key with the access ASC Studio should have.</span></div>
          <div><CheckCircle2 size={17} /><span>Copy the issuer and key IDs, then choose the downloaded <strong>AuthKey_…p8</strong> file.</span></div>
        </div>

        <AppleAccountForm statusDetail={status.detail} onConnected={onConnected} />

        <footer>
          <LockKeyhole size={15} />
          <span>The private key stays on this Mac in an owner-only file under ASC Studio’s local data folder. The browser never receives it again.</span>
        </footer>
      </section>
    </main>
  );
};
