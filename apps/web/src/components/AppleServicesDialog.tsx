import type {
  AgentStatus,
  AppleAdsConnectionResponse,
  AppleAdsCredentialsInput,
  AppStoreConnectAccount,
} from "@asc-studio/contracts";
import {
  AppWindow,
  BadgeDollarSign,
  Check,
  Clipboard,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api.js";

interface AppleServicesDialogProps {
  status: AgentStatus;
  account: AppStoreConnectAccount | null;
  appleAds: AppleAdsConnectionResponse;
  onAppleAdsChange: (connection: AppleAdsConnectionResponse) => void;
  onManageAppStoreConnect: () => void;
  onClose: () => void;
}

type KeySource = "generated" | "existing";

const message = (cause: unknown, fallback: string) => (
  cause instanceof ApiError || cause instanceof Error ? cause.message : fallback
);

export const AppleServicesDialog = ({
  status,
  account,
  appleAds,
  onAppleAdsChange,
  onManageAppStoreConnect,
  onClose,
}: AppleServicesDialogProps) => {
  const [showForm, setShowForm] = useState(!appleAds.connection.configured);
  const [keySource, setKeySource] = useState<KeySource>("generated");
  const [setupId, setSetupId] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [keyExpiresAt, setKeyExpiresAt] = useState<string | null>(null);
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyFileName, setPrivateKeyFileName] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const environmentManaged = appleAds.connection.source === "environment";
  const demo = status.mode === "demo";

  const generateKeyPair = async () => {
    setBusy(true);
    setError(null);
    try {
      const generated = await api.generateAppleAdsKeyPair();
      setSetupId(generated.setupId);
      setPublicKey(generated.publicKey);
      setKeyExpiresAt(generated.expiresAt);
      setCopied(false);
    } catch (cause) {
      setError(message(cause, "ASC Studio could not generate an Apple Ads key."));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (keySource === "generated" && !setupId) {
      setError("Generate a public key and upload it in Apple Ads first.");
      return;
    }
    if (keySource === "existing" && !privateKey) {
      setError("Choose the private-key.pem file paired with the public key in Apple Ads.");
      return;
    }
    const input: AppleAdsCredentialsInput = {
      clientId,
      teamId,
      keyId,
      adAccountId,
      ...(keySource === "generated" ? { setupId: setupId! } : { privateKey }),
    };
    setBusy(true);
    setError(null);
    try {
      const response = await api.connectAppleAds(input);
      onAppleAdsChange(response);
      setShowForm(false);
      setPrivateKey("");
      setPrivateKeyFileName(null);
    } catch (cause) {
      setError(message(cause, "ASC Studio could not connect Apple Ads."));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Apple Ads from this Apple organization? The saved private key will be deleted from this Mac.")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.removeAppleAdsConnection();
      onAppleAdsChange(response);
      setShowForm(true);
    } catch (cause) {
      setError(message(cause, "ASC Studio could not remove the Apple Ads connection."));
    } finally {
      setBusy(false);
    }
  };

  const selectKeySource = (source: KeySource) => {
    setKeySource(source);
    setError(null);
    if (source === "generated") {
      setPrivateKey("");
      setPrivateKeyFileName(null);
    } else {
      setSetupId(null);
      setPublicKey(null);
      setKeyExpiresAt(null);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="dialog apple-services-dialog" role="dialog" aria-modal="true" aria-labelledby="apple-services-title">
        <header className="dialog-header apple-services-header">
          <div>
            <h2 id="apple-services-title">Apple organization</h2>
            <p>{status.profile ?? "ASC Studio workspace"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        </header>

        <div className="apple-services-body">
          <div className="apple-services-note">
            <KeyRound size={16} />
            <span>Apple requires the same sign-in email to link both services. Each API still uses its own key and roles.</span>
          </div>

          <div className="apple-service-list" aria-label="Apple service connections">
            <div className="apple-service-row">
              <span className="apple-service-icon app-store"><AppWindow size={19} /></span>
              <div>
                <strong>App Store Connect <span className="service-state connected"><i />Connected</span></strong>
                <small>{account?.source === "environment" ? "Environment-managed team key" : `Team key · ${account?.keyId ?? "Connected"}`}</small>
              </div>
              <button className="button secondary compact" type="button" disabled={demo || account?.source === "environment"} onClick={onManageAppStoreConnect}>Manage</button>
            </div>
            <div className="apple-service-row">
              <span className="apple-service-icon apple-ads"><BadgeDollarSign size={19} /></span>
              <div>
                <strong>Apple Ads <span className={appleAds.connection.configured ? "service-state connected" : "service-state pending"}><i />{appleAds.connection.configured ? "Connected" : "Not connected"}</span></strong>
                <small>{appleAds.connection.configured ? `Ad account ${appleAds.connection.adAccountId} · Key ${appleAds.connection.keyId}` : "Separate OAuth credentials required"}</small>
              </div>
              <button className="button primary compact" type="button" disabled={environmentManaged} onClick={() => setShowForm(true)}>{demo ? "View setup" : appleAds.connection.configured ? "Replace" : "Connect"}</button>
            </div>
          </div>

          {demo ? <p className="apple-services-managed-note">Demo mode uses isolated sample connections and never sends credentials to Apple.</p> : null}
          {environmentManaged ? <p className="apple-services-managed-note">Apple Ads is managed by environment variables. Remove them before changing this service in the GUI.</p> : null}

          {showForm && !environmentManaged ? (
            <form className="apple-ads-connection-form" onSubmit={(event) => void submit(event)}>
              <header>
                <div><h3>Connect Apple Ads</h3><p>Upload the public key in Apple Ads, then enter the IDs Apple shows.</p></div>
                {appleAds.connection.configured && !demo ? <button className="text-button danger-text" type="button" disabled={busy} onClick={() => void disconnect()}><Trash2 size={14} />Disconnect</button> : null}
              </header>

              <div className="ads-key-source" role="tablist" aria-label="Apple Ads private key source">
                <button type="button" role="tab" aria-selected={keySource === "generated"} className={keySource === "generated" ? "active" : ""} onClick={() => selectKeySource("generated")}>Generate in ASC Studio</button>
                <button type="button" role="tab" aria-selected={keySource === "existing"} className={keySource === "existing" ? "active" : ""} onClick={() => selectKeySource("existing")}>Use existing key</button>
              </div>

              {keySource === "generated" ? (
                publicKey ? (
                  <div className="generated-key-panel">
                    <div><strong>Public key ready</strong><span>Paste this into Apple Ads → Account Settings → API.</span></div>
                    <textarea value={publicKey} readOnly aria-label="Generated Apple Ads public key" spellCheck={false} />
                    <div>
                      <button className="button secondary compact" type="button" onClick={() => void navigator.clipboard.writeText(publicKey).then(() => setCopied(true))}>{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? "Copied" : "Copy public key"}</button>
                      <a className="text-link" href="https://ads.apple.com/advanced" target="_blank" rel="noreferrer">Open Apple Ads <ExternalLink size={13} /></a>
                      {keyExpiresAt ? <small>Finish before {new Date(keyExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</small> : null}
                    </div>
                  </div>
                ) : (
                  <button className="generate-ads-key" type="button" disabled={busy || demo} onClick={() => void generateKeyPair()}>
                    <KeyRound size={20} /><span><strong>{demo ? "P-256 key pair generation" : "Generate a P-256 key pair"}</strong><small>{demo ? "Available in live mode. The private key never enters the browser." : "The private key stays in the local agent. Only the public key appears here."}</small></span>
                  </button>
                )
              ) : (
                <label className="existing-ads-key">
                  <span>Private key</span>
                  <span className={privateKeyFileName ? "key-file selected" : "key-file"}>
                    <Upload size={17} /><strong>{privateKeyFileName ?? "Choose private-key.pem"}</strong>
                    <input type="file" accept=".pem,.key,text/plain" required onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) {
                        setPrivateKey("");
                        setPrivateKeyFileName(null);
                        return;
                      }
                      if (file.size > 16_384) {
                        setError("That file is too large to be an Apple Ads private key.");
                        event.currentTarget.value = "";
                        return;
                      }
                      void file.text().then((value) => {
                        setPrivateKey(value);
                        setPrivateKeyFileName(file.name);
                        setError(null);
                      }).catch(() => setError("ASC Studio could not read that private key file."));
                    }} />
                  </span>
                </label>
              )}

              <div className="apple-ads-id-grid">
                <label><span>Client ID</span><input value={clientId} required autoComplete="off" spellCheck={false} placeholder="SEARCHADS.…" onChange={(event) => setClientId(event.target.value)} /></label>
                <label><span>Team ID</span><input value={teamId} required autoComplete="off" spellCheck={false} placeholder="SEARCHADS.…" onChange={(event) => setTeamId(event.target.value)} /></label>
                <label><span>Key ID</span><input value={keyId} required autoComplete="off" spellCheck={false} onChange={(event) => setKeyId(event.target.value)} /></label>
                <label><span>Ad account ID</span><input value={adAccountId} required inputMode="numeric" autoComplete="off" spellCheck={false} onChange={(event) => setAdAccountId(event.target.value.replace(/\D/g, ""))} /></label>
              </div>

              {error ? <p className="connection-form-error" role="alert">{error}</p> : null}
              <div className="apple-services-security"><LockKeyhole size={15} /><span>Private keys stay in owner-only files on this Mac. The browser does not receive generated private keys.</span></div>
              <div className="connection-form-actions">
                <button className="button" type="button" disabled={busy} onClick={() => appleAds.connection.configured ? setShowForm(false) : onClose()}>Cancel</button>
                <button className="button primary" type="submit" disabled={busy || demo}>{busy ? <span className="spinner" /> : <LockKeyhole size={16} />}{busy ? "Checking with Apple…" : demo ? "Live mode required" : "Connect Apple Ads"}</button>
              </div>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
};
