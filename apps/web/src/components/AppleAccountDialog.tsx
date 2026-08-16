import type { AgentStatus } from "@asc-studio/contracts";
import { KeyRound, LockKeyhole, X } from "lucide-react";
import { AppleAccountForm } from "./AppleAccountForm.js";

interface AppleAccountDialogProps {
  onConnected: (status: AgentStatus) => void;
  onClose: () => void;
}

export const AppleAccountDialog = ({ onConnected, onClose }: AppleAccountDialogProps) => (
  <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="dialog account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
      <header className="dialog-header">
        <div className="account-dialog-title">
          <span className="connection-setup-icon"><KeyRound size={22} /></span>
          <div>
            <h2 id="account-dialog-title">Add Apple account</h2>
            <p>Save another App Store Connect team API key.</p>
          </div>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
      </header>
      <AppleAccountForm submitLabel="Add and switch" onConnected={onConnected} onCancel={onClose} />
      <div className="account-security-note">
        <LockKeyhole size={15} />
        <span>The private key stays in an owner-only file on this Mac.</span>
      </div>
    </section>
  </div>
);
