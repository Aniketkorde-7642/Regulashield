"use client";

import { FormEvent, useCallback, useState } from "react";
import { ArrowRight, Eye, EyeOff, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

const LOGIN_ROLES = [
  { username: "institution", label: "Institution Applicant", detail: "Submit and track institution applications" },
  { username: "officer", label: "AICTE Scrutiny Officer", detail: "Review application evidence and findings" },
  { username: "regulatory", label: "Regulatory / Verification Officer", detail: "Verify regulatory evidence and decisions" },
  { username: "compliance", label: "Regulatory / Compliance Administrator", detail: "Manage draft rules and compliance changes" },
  { username: "admin", label: "System Administrator", detail: "Manage users, applications, and approvals" },
];

export function LoginScreen() {
  const { login, registerInstitution } = useAuth();
  const [username, setUsername] = useState("officer");
  const [selectedRole, setSelectedRole] = useState("officer");
  const [displayName, setDisplayName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async (selectedUsername: string, selectedPassword: string) => {
    setBusy(true);
    setError(null);
    try {
      await login(selectedUsername.trim(), selectedPassword);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }, [login]);

  function selectRole(roleUsername: string) {
    setSelectedRole(roleUsername);
    setUsername(roleUsername);
    setPassword("");
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (registering) {
      setBusy(true);
      setError(null);
      try {
        await registerInstitution(username, displayName, password);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Institution account could not be created.");
      } finally {
        setBusy(false);
      }
      return;
    }
    await signIn(username, password);
  }

  const selectedRoleDetails = LOGIN_ROLES.find((role) => role.username === selectedRole);

  return (
    <main className="login-page">
      <div className="login-decoration decoration-one" />
      <div className="login-decoration decoration-two" />
      <section className="login-card">
        <div className="login-brand"><span className="brand-icon"><ShieldCheck size={24} /></span><span>Regula<span className="brand-light">Shield</span></span></div>
        <div className="login-copy">
          <p className="eyebrow">SECURE EVIDENCE REVIEW WORKSPACE</p>
          <h1>{registering ? "Create your account" : "Sign in to RegulaShield"}</h1>
          <p>{registering ? "Create an individual Institution Applicant account." : "Choose your role to fill in your username, then sign in with your personal password."}</p>
        </div>
        {!registering && <div className="login-role-section">
          <div className="login-role-heading"><strong>Select your role</strong><span>Individual account access</span></div>
          <div className="login-roles" aria-label="Choose your role">
          {LOGIN_ROLES.map((role) => (
            <button
              key={role.username}
              type="button"
              className={`login-role ${selectedRole === role.username ? "selected" : ""}`}
              aria-pressed={selectedRole === role.username}
              disabled={busy}
              onClick={() => selectRole(role.username)}
            >
              <span className="login-role-label">{role.label}</span>
              <span className="login-role-description">{role.detail}</span>
              <span className="login-role-username">Account username: <strong>{role.username}</strong></span>
            </button>
          ))}
          </div>
        </div>}
        <form onSubmit={submit} className="login-form">
          {registering && <>
            <label htmlFor="display-name">Institution / applicant name</label>
            <input id="display-name" name="display_name" autoComplete="organization" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={160} required />
          </>}
          <div className="login-username-heading">
            <label htmlFor="username">Username</label>
            {!registering && <button className="button button-secondary login-autofill" type="button" disabled={busy} onClick={() => { setUsername(selectedRoleDetails?.username ?? ""); setPassword(""); setError(null); }}>
              <UserRound size={14} /> Auto-Fill
            </button>}
          </div>
          <input id="username" name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={registering ? 3 : undefined} maxLength={80} required />
          <div className="password-label"><label htmlFor="password">Password</label><span>{registering ? "At least 12 characters" : "Your private account password"}</span></div>
          <div className="password-input">
            <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={registering ? 12 : undefined} maxLength={256} required />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}<span>{showPassword ? "Hide" : "Show"}</span></button>
          </div>
          {registering && <small>Use at least 12 characters. New accounts are created with the Institution Applicant role.</small>}
          {!registering && <small className="login-password-note">Passwords are private and are not shared on this sign-in page. Contact the System Administrator to create or reset a staff account.</small>}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={busy}>{busy ? (registering ? "Creating account…" : "Signing in…") : registering ? "Create Institution Applicant account" : <>Login <ArrowRight size={17} /></>}</button>
        </form>
        {registering && <div className="login-help"><span className="status-dot" />Create an institution account to submit applications for System Administrator review.</div>}
        <button className="text-button login-mode-toggle" type="button" disabled={busy} onClick={() => { setRegistering((current) => !current); setError(null); setPassword(""); }}>
          {registering ? "Already have an account? Sign in" : "New Institution Applicant? Create an account"}
        </button>
      </section>
    </main>
  );
}
