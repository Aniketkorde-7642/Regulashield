"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import type { DemoCredentials } from "@/lib/types";

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
  const [registrationMessage, setRegistrationMessage] = useState<string | null>(null);
  const [demoPasswords, setDemoPasswords] = useState<DemoCredentials>({});
  const [demoCredentialsError, setDemoCredentialsError] = useState<string | null>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    api.demoCredentials()
      .then((credentials) => {
        if (!mounted) return;
        setDemoPasswords(credentials);
        setPassword((current) => current || credentials[selectedRole] || "");
      })
      .catch(() => {
        if (mounted) setDemoCredentialsError("Demo credentials are unavailable. Use your assigned account password.");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!registering && demoPasswords[selectedRole]) {
      setPassword((current) => current || demoPasswords[selectedRole]);
    }
  }, [demoPasswords, registering, selectedRole]);

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
    setPassword(demoPasswords[roleUsername] ?? "");
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submittedUsername = String(formData.get("username") ?? "").trim();
    const submittedPassword = passwordInputRef.current?.value
      ?? String(formData.get("password") ?? "");
    setPassword(submittedPassword);
    if (registering) {
      setBusy(true);
      setError(null);
      setRegistrationMessage(null);
      try {
        setRegistrationMessage(
          await registerInstitution(submittedUsername, displayName, submittedPassword),
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Institution account could not be created.");
      } finally {
        setBusy(false);
      }
      return;
    }
    await signIn(submittedUsername, submittedPassword);
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
        {registrationMessage && <div className="notice" role="status">{registrationMessage}</div>}
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
              <span className="login-role-demo-password">Password = Password@123</span>
              <span className="login-role-username">Account username: <strong>{role.username}</strong></span>
              {demoPasswords[role.username] && <span className="login-role-username">Demo password: <strong>{demoPasswords[role.username]}</strong></span>}
            </button>
          ))}
          </div>
        </div>}
        {!registrationMessage && <form onSubmit={submit} className="login-form">
          {registering && <>
            <label htmlFor="display-name">Institution / applicant name</label>
            <input id="display-name" name="display_name" autoComplete="organization" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={160} required />
          </>}
          <div className="login-username-heading">
            <label htmlFor="username">Username</label>
            {!registering && <button className="button button-secondary login-autofill" type="button" disabled={busy} onClick={() => {
              setUsername(selectedRoleDetails?.username ?? "");
              setPassword(demoPasswords[selectedRole] ?? "");
              setError(null);
              window.requestAnimationFrame(() => passwordInputRef.current?.focus());
            }}>
              <UserRound size={14} /> Auto-Fill
            </button>}
          </div>
          <input id="username" name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={registering ? 3 : undefined} maxLength={80} required />
          <div className="password-label"><label htmlFor="password">Password</label><span>{registering ? "At least 12 characters" : "Your private account password"}</span></div>
          <div className="password-input">
            <input key={registering ? "registration-password" : "login-password"} ref={passwordInputRef} id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.currentTarget.value)} onInput={(event) => setPassword(event.currentTarget.value)} onBlur={(event) => setPassword(event.currentTarget.value)} minLength={registering ? 12 : undefined} maxLength={256} required />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}<span>{showPassword ? "Hide" : "Show"}</span></button>
          </div>
          {registering && <small>Use at least 12 characters. Your request will be reviewed by a System Administrator before an account is created.</small>}
          {!registering && <small className="login-password-note">{Object.keys(demoPasswords).length > 0 ? "Demo credentials are shown only on the protected demo deployment." : "Passwords are private and are not shared on this sign-in page. Contact the System Administrator to create or reset a staff account."}</small>}
          {!registering && demoCredentialsError && <small className="login-password-note" role="status">{demoCredentialsError}</small>}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={busy}>{busy ? (registering ? "Submitting request…" : "Signing in…") : registering ? "Request Institution Applicant account" : <>Login <ArrowRight size={17} /></>}</button>
        </form>}
        {registering && !registrationMessage && <div className="login-help"><span className="status-dot" />An administrator must approve the request before you can sign in.</div>}
        <button className="text-button login-mode-toggle" type="button" disabled={busy} onClick={() => { setRegistering((current) => !current); setPassword(""); setError(null); setRegistrationMessage(null); }}>
          {registering ? "Already have an account? Sign in" : "New Institution Applicant? Request an account"}
        </button>
      </section>
    </main>
  );
}
