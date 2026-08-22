import type { AgentStatus } from "@asc-studio/contracts";
import { CheckCircle2, KeyRound, LockKeyhole, Sparkles } from "lucide-react";
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
            <h1 id="connection-setup-title">Connect your Apple organization</h1>
            <p>Start with App Store Connect. You can add Apple Ads next with its separate API credentials.</p>
          </div>
        </header>

        <div className="connection-setup-steps" aria-label="Connection requirements">
          <div><CheckCircle2 size={17} /><span>In App Store Connect, open <strong>Users and Access → Integrations</strong>.</span></div>
          <div><CheckCircle2 size={17} /><span>Create a team API key with the access ASC Studio should have.</span></div>
          <div><CheckCircle2 size={17} /><span>Copy the issuer and key IDs, then choose the downloaded <strong>AuthKey_…p8</strong> file.</span></div>
        </div>

        <AppleAccountForm statusDetail={status.detail} onConnected={onConnected} />

        <div className="connection-setup-optional">
          <Sparkles size={16} />
          <span>OpenAI writing assistance is optional. Add it later from <strong>Connections</strong> for release translation and review reply drafts.</span>
        </div>

        <footer>
          <LockKeyhole size={15} />
          <span>After Apple verifies the connection, ASC Studio stores the private key encrypted in macOS Keychain and never returns it to the browser. <strong>Allow Once</strong> permits one read; <strong>Always Allow</strong> trusts ASC Studio’s native helper, which other processes in this macOS account can also invoke.</span>
        </footer>
      </section>
    </main>
  );
};
