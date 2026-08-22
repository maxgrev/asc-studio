import type {
  AgentStatus,
  AppleAdsConnectionResponse,
  AppleAdsCredentialsInput,
  AppStoreConnectAccount,
  OpenAiConnectionResponse,
  OpenAiCredentialsInput,
} from "@asc-studio/contracts";
import {
  AlertCircle,
  AppWindow,
  BadgeDollarSign,
  Check,
  Clipboard,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api } from "../api.js";

interface ConnectionsDialogProps {
  status: AgentStatus;
  account: AppStoreConnectAccount | null;
  appleAds: AppleAdsConnectionResponse;
  openAi: OpenAiConnectionResponse | null;
  openAiLoading: boolean;
  openAiError: string | null;
  openAiErrorCode: string | null;
  initialTarget: "general" | "apple-ads" | "openai";
  onAppleAdsChange: (connection: AppleAdsConnectionResponse) => void;
  onOpenAiChange: (connection: OpenAiConnectionResponse) => void;
  onRetryOpenAi: () => Promise<void>;
  onManageAppStoreConnect: () => void;
  onClose: () => void;
}

type KeySource = "generated" | "existing";

const message = (cause: unknown, fallback: string) => (
  cause instanceof ApiError || cause instanceof Error ? cause.message : fallback
);
const requiresVaultReset = (code: string | null) => code === "credential_store_damaged"
  || code === "credential_store_conflict"
  || code === "keychain_rollback_failed";

export const ConnectionsDialog = ({
  status,
  account,
  appleAds,
  openAi,
  openAiLoading,
  openAiError,
  openAiErrorCode,
  initialTarget,
  onAppleAdsChange,
  onOpenAiChange,
  onRetryOpenAi,
  onManageAppStoreConnect,
  onClose,
}: ConnectionsDialogProps) => {
  const [showForm, setShowForm] = useState(
    initialTarget === "apple-ads" || initialTarget === "general" && !appleAds.connection.configured,
  );
  const [showOpenAiForm, setShowOpenAiForm] = useState(initialTarget === "openai");
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
  const [openAiKey, setOpenAiKey] = useState("");
  const [openAiModel, setOpenAiModel] = useState("");
  const [openAiBusy, setOpenAiBusy] = useState(false);
  const [openAiFormError, setOpenAiFormError] = useState<string | null>(null);
  const [openAiFormErrorCode, setOpenAiFormErrorCode] = useState<string | null>(null);
  const [openAiNotice, setOpenAiNotice] = useState<string | null>(null);
  const [confirmOpenAiRemoval, setConfirmOpenAiRemoval] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openAiKeyRef = useRef<HTMLInputElement>(null);
  const openAiManageRef = useRef<HTMLButtonElement>(null);
  const openAiRemoveCancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const environmentManaged = appleAds.connection.source === "environment";
  const demo = status.mode === "demo";
  const appStoreConnected = status.connected;
  const openAiConnection = openAi?.connection ?? null;
  const openAiEnvironmentManaged = openAiConnection?.source === "environment";
  const openAiConfigured = Boolean(openAiConnection?.configured);
  const openAiVaultNeedsReset = requiresVaultReset(openAiErrorCode)
    || requiresVaultReset(openAiFormErrorCode);
  const anyBusy = busy || openAiBusy;
  const openAiState = demo
    ? { label: "Demo", tone: "connected" }
    : openAiLoading
      ? { label: "Checking", tone: "pending" }
      : openAiError
        ? { label: "Needs attention", tone: "attention" }
        : openAiEnvironmentManaged && !openAiConfigured
          ? { label: "Needs attention", tone: "attention" }
        : openAiConfigured
          ? { label: "Ready", tone: "connected" }
          : { label: "Not configured", tone: "pending" };
  const openAiDetail = demo
    ? "Deterministic sample translations and replies · No OpenAI calls"
    : openAiError
      ? openAiError
      : openAiEnvironmentManaged
        ? openAiConfigured
          ? `Model ${openAiConnection?.model ?? "unavailable"} · Managed by OPENAI_API_KEY`
          : "OPENAI_API_KEY is empty or invalid · Managed externally"
        : openAiConfigured
          ? `Model ${openAiConnection?.model ?? "default"} · ${openAiConnection?.modelSource === "environment" ? "Model overridden by ASC_STUDIO_OPENAI_MODEL · " : ""}API key in macOS Keychain`
          : "One API key powers release translation and review reply drafts";

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      if (initialTarget === "openai" && openAiKeyRef.current) openAiKeyRef.current.focus();
      else closeButtonRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [initialTarget]);

  useEffect(() => {
    if (!showOpenAiForm || openAiLoading || openAiEnvironmentManaged || demo) return;
    const frame = window.requestAnimationFrame(() => openAiKeyRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [demo, openAiEnvironmentManaged, openAiLoading, showOpenAiForm]);

  useEffect(() => {
    if (!confirmOpenAiRemoval) return;
    const frame = window.requestAnimationFrame(() => openAiRemoveCancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [confirmOpenAiRemoval]);

  useEffect(() => {
    if (openAiKey || openAiConnection?.modelSource !== "local") return;
    setOpenAiModel(openAiConnection.model ?? "");
  }, [openAiConnection?.model, openAiConnection?.modelSource, openAiKey]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (anyBusy) return;
        event.preventDefault();
        if (confirmOpenAiRemoval) setConfirmOpenAiRemoval(false);
        else onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [anyBusy, confirmOpenAiRemoval, onClose]);

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
    if (!window.confirm("Disconnect Apple Ads? ASC Studio will remove this organization’s private key from its macOS Keychain bundle and delete matching legacy plaintext credential files in this data directory. If this is the last saved Apple Ads connection, it also leaves a vault-wide reset tombstone so stale copied directories cannot re-import it. This does not remove or revoke the public key in Apple Ads, or erase other backups.")) return;
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

  const manageOpenAi = () => {
    setShowForm(false);
    setPrivateKey("");
    setPrivateKeyFileName(null);
    setShowOpenAiForm(true);
    setConfirmOpenAiRemoval(false);
    setOpenAiFormError(null);
    setOpenAiFormErrorCode(null);
    setOpenAiNotice(null);
    setOpenAiKey("");
    setOpenAiModel(openAiConnection?.modelSource === "local" ? openAiConnection.model ?? "" : "");
  };

  const closeOpenAiForm = (restoreFocus = true) => {
    setShowOpenAiForm(false);
    setConfirmOpenAiRemoval(false);
    setOpenAiFormError(null);
    setOpenAiFormErrorCode(null);
    setOpenAiKey("");
    setOpenAiModel("");
    if (restoreFocus) window.requestAnimationFrame(() => openAiManageRef.current?.focus());
  };

  const connectOpenAi = async (event: FormEvent) => {
    event.preventDefault();
    const input: OpenAiCredentialsInput = {
      apiKey: openAiKey,
      ...(openAiModel.trim() ? { model: openAiModel.trim() } : {}),
    };
    setOpenAiBusy(true);
    setOpenAiFormError(null);
    setOpenAiFormErrorCode(null);
    setOpenAiNotice(null);
    try {
      const response = await api.connectOpenAi(input);
      onOpenAiChange(response);
      setOpenAiNotice(openAiConfigured ? "OpenAI connection replaced." : "OpenAI is ready for writing assistance.");
      closeOpenAiForm();
    } catch (cause) {
      const errorCode = cause instanceof ApiError ? cause.code : null;
      setOpenAiFormError(message(cause, "ASC Studio could not connect OpenAI."));
      setOpenAiFormErrorCode(errorCode);
      setOpenAiKey("");
      if (requiresVaultReset(errorCode)) void onRetryOpenAi();
      else window.requestAnimationFrame(() => openAiKeyRef.current?.focus());
    } finally {
      setOpenAiBusy(false);
    }
  };

  const removeOpenAi = async () => {
    setOpenAiBusy(true);
    setOpenAiFormError(null);
    setOpenAiFormErrorCode(null);
    try {
      const response = await api.removeOpenAiConnection();
      onOpenAiChange(response);
      setOpenAiNotice("OpenAI API key removed from macOS Keychain.");
      closeOpenAiForm();
    } catch (cause) {
      setOpenAiFormError(message(cause, "ASC Studio could not remove the OpenAI connection."));
      setOpenAiFormErrorCode(cause instanceof ApiError ? cause.code : null);
    } finally {
      setOpenAiBusy(false);
    }
  };

  const resetOpenAiVault = async () => {
    if (!window.confirm("Reset the OpenAI credential vault? This permanently deletes ASC Studio’s OpenAI Keychain item and any legacy plaintext OpenAI credential files in this data directory, then replaces its recovery state with a vault-wide reset tombstone. The tombstone prevents stale copied directories from re-importing that key until you explicitly reconnect. This cannot be undone here, does not revoke the key at OpenAI, and cannot erase other backups.")) return;
    setOpenAiBusy(true);
    setOpenAiFormError(null);
    setOpenAiFormErrorCode(null);
    try {
      const response = await api.resetOpenAiVault();
      onOpenAiChange(response);
      setOpenAiNotice("OpenAI Keychain item reset. You can connect another API key.");
      closeOpenAiForm(false);
    } catch (cause) {
      setShowOpenAiForm(true);
      setOpenAiFormError(message(cause, "ASC Studio could not reset the OpenAI credential vault."));
      setOpenAiFormErrorCode(cause instanceof ApiError ? cause.code : null);
    } finally {
      setOpenAiBusy(false);
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
      if (event.target === event.currentTarget && !anyBusy && !confirmOpenAiRemoval) onClose();
    }}>
      <section ref={dialogRef} className="dialog apple-services-dialog" role="dialog" aria-modal="true" aria-labelledby="connections-title">
        <header className="dialog-header apple-services-header">
          <div>
            <h2 id="connections-title">Connections</h2>
            <p>Local API credentials for {status.profile ?? "this ASC Studio workspace"}.</p>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" disabled={anyBusy} onClick={onClose} aria-label="Close connections"><X size={19} /></button>
        </header>

        <div className="apple-services-body">
          <section className="connections-group" aria-labelledby="apple-connections-title">
            <header className="connections-group-heading">
              <h3 id="apple-connections-title">Apple services</h3>
              <p>These connections read from and write to your Apple organization.</p>
            </header>
          <div className="apple-services-note">
            <KeyRound size={16} />
            <span>GUI-managed secrets are encrypted in macOS Keychain. <strong>Allow Once</strong> permits one read; <strong>Always Allow</strong> trusts ASC Studio’s native helper, which other processes in this macOS account can also invoke.</span>
          </div>

          <div className="apple-service-list" aria-label="Apple service connections">
            <div className="apple-service-row">
              <span className="apple-service-icon app-store"><AppWindow size={19} /></span>
              <div>
                <strong>App Store Connect <span className={appStoreConnected ? "service-state connected" : "service-state pending"}><i />{appStoreConnected ? "Connected" : "Not connected"}</span></strong>
                <small>{!appStoreConnected
                  ? "Team API key required"
                  : account?.source === "environment"
                    ? "Environment-managed team key"
                    : `Team key · ${account?.keyId ?? "Connected"}`}</small>
              </div>
              <button className={appStoreConnected ? "button secondary compact" : "button primary compact"} type="button" disabled={demo || account?.source === "environment"} onClick={onManageAppStoreConnect}>{appStoreConnected ? "Manage" : "Connect"}</button>
            </div>
            <div className="apple-service-row">
              <span className="apple-service-icon apple-ads"><BadgeDollarSign size={19} /></span>
              <div>
                <strong>Apple Ads <span className={appleAds.connection.configured ? "service-state connected" : "service-state pending"}><i />{appleAds.connection.configured ? "Connected" : "Not connected"}</span></strong>
                <small>{!appStoreConnected
                  ? "Connect App Store Connect first"
                  : appleAds.connection.configured
                    ? `Ad account ${appleAds.connection.adAccountId} · Key ${appleAds.connection.keyId}`
                    : "Separate OAuth credentials required"}</small>
              </div>
              <button className="button primary compact" type="button" disabled={environmentManaged || !appStoreConnected} onClick={() => {
                closeOpenAiForm(false);
                setShowForm(true);
              }}>{demo ? "View setup" : appleAds.connection.configured ? "Replace" : "Connect"}</button>
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

              <div className="ads-key-source" aria-label="Apple Ads private key source">
                <button type="button" aria-pressed={keySource === "generated"} className={keySource === "generated" ? "active" : ""} onClick={() => selectKeySource("generated")}>Generate in ASC Studio</button>
                <button type="button" aria-pressed={keySource === "existing"} className={keySource === "existing" ? "active" : ""} onClick={() => selectKeySource("existing")}>Use existing key</button>
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
                    <KeyRound size={20} /><span><strong>{demo ? "P-256 key pair generation" : "Generate a P-256 key pair"}</strong><small>{demo ? "Available in live mode. The private key never enters the browser." : "The private key stays in local-agent memory during setup, then moves to macOS Keychain. Only the public key appears here."}</small></span>
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
              <div className="apple-services-security"><LockKeyhole size={15} /><span>After Apple verifies the connection, the private key is encrypted in macOS Keychain. Imported keys pass through this form once; generated keys never enter the browser. <strong>Allow Once</strong> permits one helper read without creating an ongoing grant.</span></div>
              <div className="connection-form-actions">
                <button className="button" type="button" disabled={busy} onClick={() => appleAds.connection.configured ? setShowForm(false) : onClose()}>Cancel</button>
                <button className="button primary" type="submit" disabled={busy || demo}>{busy ? <span className="spinner" /> : <LockKeyhole size={16} />}{busy ? "Checking with Apple…" : demo ? "Live mode required" : "Connect Apple Ads"}</button>
              </div>
            </form>
          ) : null}
          </section>

          <section className="connections-group writing-connections" aria-labelledby="writing-connections-title">
            <header className="connections-group-heading">
              <h3 id="writing-connections-title">Writing assistance</h3>
              <p>Optional and separate from Apple. The same OpenAI connection powers Releases and Reviews.</p>
            </header>

            <div className="apple-service-list writing-service-list" aria-label="Writing assistance connections">
              <div className="apple-service-row">
                <span className="apple-service-icon openai"><Sparkles size={19} /></span>
                <div>
                  <strong>OpenAI <span className={`service-state ${openAiState.tone}`}><i />{openAiState.label}</span></strong>
                  <small>{openAiDetail}</small>
                </div>
                {openAiLoading ? <LoaderCircle className="spin connection-row-spinner" size={18} aria-label="Checking OpenAI connection" /> : openAiError ? (
                  openAiVaultNeedsReset
                    ? <button className="button danger compact" type="button" disabled={openAiBusy} onClick={() => void resetOpenAiVault()}>{openAiBusy ? "Resetting…" : "Reset vault"}</button>
                    : <button className="button secondary compact" type="button" onClick={() => void onRetryOpenAi()}>Retry</button>
                ) : openAiEnvironmentManaged ? (
                  <span className="connection-managed-label">Managed externally</span>
                ) : !demo ? (
                  <button ref={openAiManageRef} className={openAiConfigured ? "button secondary compact" : "button primary compact"} type="button" onClick={manageOpenAi}>{openAiConfigured ? "Manage" : "Connect"}</button>
                ) : null}
              </div>
            </div>

            {openAiNotice ? <div className="openai-connection-notice" role="status"><Check size={16} /><span>{openAiNotice}</span></div> : null}
            {openAiEnvironmentManaged ? (
              <p className="apple-services-managed-note">OpenAI is managed by environment variables. Change <code>OPENAI_API_KEY</code> or <code>ASC_STUDIO_OPENAI_MODEL</code>, then restart ASC Studio.</p>
            ) : null}

            {showOpenAiForm && !openAiLoading && !openAiEnvironmentManaged && !demo ? (
              <form className="openai-connection-form" onSubmit={(event) => void connectOpenAi(event)}>
                <header>
                  <div>
                    <h3>{openAiConfigured ? "Replace OpenAI connection" : "Connect OpenAI"}</h3>
                    <p>{openAiConfigured
                      ? "ASC Studio verifies the replacement before writing. Normal Keychain failures restore and recheck the current item; an unverifiable rollback fails closed and offers an OpenAI-only vault reset."
                      : "Paste an API key and choose the model ASC Studio should use."}</p>
                  </div>
                  {openAiConfigured ? <button className="text-button danger-text" type="button" disabled={openAiBusy} onClick={() => {
                    setOpenAiFormError(null);
                    setConfirmOpenAiRemoval(true);
                  }}><Trash2 size={14} />Remove key</button> : null}
                </header>

                {openAiFormError ? (
                  <>
                    <p className="connection-form-error" role="alert">{openAiFormError}</p>
                    {requiresVaultReset(openAiFormErrorCode) ? (
                      <button className="button danger compact" type="button" disabled={openAiBusy} onClick={() => void resetOpenAiVault()}>
                        {openAiBusy ? "Resetting…" : "Reset OpenAI vault"}
                      </button>
                    ) : null}
                  </>
                ) : null}
                {confirmOpenAiRemoval ? (
                  <div className="openai-remove-confirmation" role="group" aria-labelledby="openai-remove-title" aria-describedby="openai-remove-detail">
                    <AlertCircle size={19} />
                    <div>
                      <strong id="openai-remove-title">Remove OpenAI connection?</strong>
                      <p id="openai-remove-detail">ASC Studio will delete the API key from macOS Keychain and matching legacy plaintext credential files in this data directory, then leave a vault-wide reset tombstone so stale copied directories cannot re-import it. Existing local drafts are unchanged, but writing assistance will be unavailable until another key is added.</p>
                      <small>This does not revoke the key in OpenAI or erase other copies and backups.</small>
                      <div>
                        <button ref={openAiRemoveCancelRef} className="button secondary compact" type="button" disabled={openAiBusy} onClick={() => setConfirmOpenAiRemoval(false)}>Cancel</button>
                        <button className="button danger compact" type="button" disabled={openAiBusy} onClick={() => void removeOpenAi()}>{openAiBusy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}{openAiBusy ? "Removing…" : "Remove key"}</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="openai-secret-field">
                      <span>OpenAI API key</span>
                      <input
                        ref={openAiKeyRef}
                        type="password"
                        value={openAiKey}
                        disabled={openAiBusy || requiresVaultReset(openAiFormErrorCode)}
                        required
                        minLength={1}
                        maxLength={8_192}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="Paste API key"
                        onChange={(event) => {
                          setOpenAiKey(event.target.value);
                          setOpenAiFormError(null);
                          setOpenAiFormErrorCode(null);
                        }}
                      />
                      <small>Sent once to the local agent and never returned to the browser after this form is submitted.</small>
                    </label>
                    <label>
                      <span>Model</span>
                      <input
                        value={openAiModel}
                        maxLength={200}
                        disabled={openAiBusy || requiresVaultReset(openAiFormErrorCode) || openAiConnection?.modelSource === "environment"}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder={openAiConnection?.modelSource === "environment" ? openAiConnection.model ?? "Environment-managed model" : "Leave blank for ASC Studio's default"}
                        onChange={(event) => {
                          setOpenAiModel(event.target.value);
                          setOpenAiFormError(null);
                          setOpenAiFormErrorCode(null);
                        }}
                      />
                      <small>{openAiConnection?.modelSource === "environment"
                        ? "ASC_STUDIO_OPENAI_MODEL controls the model for this process."
                        : "Leave blank to use ASC Studio’s default model."}</small>
                    </label>
                    <div className="openai-validation-note"><LockKeyhole size={16} /><span>After OpenAI verifies the key and model, ASC Studio stores the key encrypted in macOS Keychain. Verification makes one small Responses request and may use API capacity and billing. <strong>Allow Once</strong> permits one read; <strong>Always Allow</strong> trusts ASC Studio’s native helper, which other processes in this macOS account can also invoke.</span></div>
                    <a className="text-link openai-key-link" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Create or manage API keys <ExternalLink size={14} /></a>
                    <div className="connection-form-actions">
                      <button className="button" type="button" disabled={openAiBusy} onClick={() => closeOpenAiForm()}>Cancel</button>
                      <button className="button primary" type="submit" disabled={openAiBusy || requiresVaultReset(openAiFormErrorCode) || !openAiKey.trim()}>
                        {openAiBusy ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}
                        {openAiBusy ? "Checking with OpenAI…" : openAiConfigured ? "Verify and replace" : "Verify and connect"}
                      </button>
                    </div>
                  </>
                )}
              </form>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
};
