import type { AgentStatus } from "@asc-studio/contracts";
import { CheckCircle2, KeyRound, LockKeyhole, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api.js";

interface ConnectionSetupProps {
  status: AgentStatus;
  onConnected: (status: AgentStatus) => void;
}

export const ConnectionSetup = ({ status, onConnected }: ConnectionSetupProps) => {
  const [profileName, setProfileName] = useState("Personal");
  const [issuerId, setIssuerId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!privateKey) {
      setError("Choose the AuthKey .p8 file downloaded from App Store Connect.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.connectAppStoreConnect({ profileName, issuerId, keyId, privateKey });
      onConnected(response.status);
    } catch (cause) {
      setError(cause instanceof ApiError || cause instanceof Error ? cause.message : "ASC Studio could not save the connection.");
    } finally {
      setBusy(false);
    }
  };

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

        <form className="connection-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Connection name</span>
            <input value={profileName} maxLength={80} required autoComplete="off" onChange={(event) => setProfileName(event.target.value)} placeholder="Personal" />
          </label>
          <label>
            <span>Issuer ID</span>
            <input value={issuerId} maxLength={128} required autoComplete="off" spellCheck={false} onChange={(event) => setIssuerId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          </label>
          <label>
            <span>Key ID</span>
            <input value={keyId} minLength={8} maxLength={32} required autoComplete="off" spellCheck={false} onChange={(event) => setKeyId(event.target.value.toUpperCase())} placeholder="ABC123DEFG" />
          </label>
          <label className="connection-key-picker">
            <span>Private key</span>
            <span className={fileName ? "key-file selected" : "key-file"}>
              <Upload size={17} />
              <strong>{fileName ?? "Choose AuthKey .p8"}</strong>
              <input
                type="file"
                accept=".p8,application/pkcs8,text/plain"
                required
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    setPrivateKey("");
                    setFileName(null);
                    return;
                  }
                  if (file.size > 16_384) {
                    setError("That file is too large to be an App Store Connect .p8 key.");
                    event.currentTarget.value = "";
                    return;
                  }
                  void file.text().then((value) => {
                    setPrivateKey(value);
                    setFileName(file.name);
                    setError(null);
                  });
                }}
              />
            </span>
          </label>
          {error ? <p className="connection-form-error" role="alert">{error}</p> : null}
          {!error && status.detail ? <p className="connection-form-status">{status.detail}</p> : null}
          <button className="button primary connection-submit" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : <LockKeyhole size={17} />}
            {busy ? "Checking with Apple…" : "Connect securely"}
          </button>
        </form>

        <footer>
          <LockKeyhole size={15} />
          <span>The private key stays on this Mac in an owner-only file under ASC Studio’s local data folder. The browser never receives it again.</span>
        </footer>
      </section>
    </main>
  );
};
