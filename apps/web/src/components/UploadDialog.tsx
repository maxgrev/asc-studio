import type { AppSummary } from "@asc-studio/contracts";
import { Info, X } from "lucide-react";

export const UploadDialog = ({ app, onClose }: { app: AppSummary | null; onClose: () => void }) => {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="dialog upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-dialog-title">
        <header className="dialog-header">
          <div><h2 id="upload-dialog-title">Upload a TestFlight build</h2><p>Direct build upload is the next provider capability.</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        </header>
        <div className="dialog-content">
          <div className="command-block"><Info size={18} /><span>ASC Studio does not fall back to a third-party CLI.</span></div>
          <p className="upload-copy">For now, upload this app with Xcode Organizer or Transporter, then refresh TestFlight here. ASC Studio will add Apple's public Build Uploads workflow with a local file picker and progress before enabling this button as a write action.</p>
          {app ? <p className="upload-copy">Target: <strong>{app.name}</strong> · {app.bundleId}</p> : null}
        </div>
        <footer className="dialog-footer">
          <button className="button primary" type="button" onClick={onClose}>Got it</button>
        </footer>
      </section>
    </div>
  );
};
