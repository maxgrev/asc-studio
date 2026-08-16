import type { AppSummary } from "@asc-studio/contracts";
import { Check, Copy, TerminalSquare, X } from "lucide-react";
import { useState } from "react";

export const UploadDialog = ({ app, onClose }: { app: AppSummary | null; onClose: () => void }) => {
  const [copied, setCopied] = useState(false);
  const command = `asc publish testflight --app ${app?.id ?? "APP_ID"} --ipa /path/to/App.ipa --wait --confirm`;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="dialog upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-dialog-title">
        <header className="dialog-header">
          <div><h2 id="upload-dialog-title">Upload a TestFlight build</h2><p>Use the local CLI until the desktop file picker ships.</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        </header>
        <div className="dialog-content">
          <div className="command-block"><TerminalSquare size={18} /><code>{command}</code></div>
          <p className="upload-copy">The command uses your existing <code>asc</code> profile, uploads the IPA, waits for processing, and keeps credentials out of this browser.</p>
        </div>
        <footer className="dialog-footer">
          <button className="button secondary" type="button" onClick={onClose}>Close</button>
          <button className="button primary" type="button" onClick={() => {
            void navigator.clipboard.writeText(command).then(() => setCopied(true), () => setCopied(false));
          }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy command"}</button>
        </footer>
      </section>
    </div>
  );
};
