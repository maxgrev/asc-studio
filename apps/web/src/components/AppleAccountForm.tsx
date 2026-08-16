import type { AgentStatus } from "@asc-studio/contracts";
import { LockKeyhole, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api.js";

interface AppleAccountFormProps {
  statusDetail?: string;
  submitLabel?: string;
  onConnected: (status: AgentStatus) => void;
  onCancel?: () => void;
}

export const AppleAccountForm = ({ statusDetail, submitLabel = "Connect securely", onConnected, onCancel }: AppleAccountFormProps) => {
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
              void file.text()
                .then((value) => {
                  setPrivateKey(value);
                  setFileName(file.name);
                  setError(null);
                })
                .catch(() => {
                  setPrivateKey("");
                  setFileName(null);
                  setError("ASC Studio could not read that private key file.");
                });
            }}
          />
        </span>
      </label>
      {error ? <p className="connection-form-error" role="alert">{error}</p> : null}
      {!error && statusDetail ? <p className="connection-form-status">{statusDetail}</p> : null}
      <div className="connection-form-actions">
        {onCancel ? <button className="button" type="button" onClick={onCancel} disabled={busy}>Cancel</button> : null}
        <button className="button primary connection-submit" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : <LockKeyhole size={17} />}
          {busy ? "Checking with Apple…" : submitLabel}
        </button>
      </div>
    </form>
  );
};
