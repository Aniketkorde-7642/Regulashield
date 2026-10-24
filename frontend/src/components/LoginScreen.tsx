"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import type { DemoCredentials } from "@/lib/types";

const LOGIN_ROLES = [
  { username: "institution", label: "Institution Applicant" },
  { username: "officer", label: "AICTE Scrutiny Officer" },
  { username: "regulatory", label: "Regulatory / Verification Officer" },
  { username: "compliance", label: "Regulatory / Compliance Administrator" },
  { username: "admin", label: "System Administrator" },
];

export function LoginScreen() {
  const { login, registerInstitution } = useAuth();
  const [username, setUsername] = useState("officer");
  const [selectedRole, setSelectedRole] = useState("officer");
  const [displayName, setDisplayName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [demoPasswords, setDemoPasswords] = useState<DemoCredentials>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registeringRef = useRef(false);
  const selectedRoleRef = useRef("officer");
  const credentialsLoadedRef = useRef(false);
  const pendingDemoLoginRef = useRef<string | null>(null);

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

  useEffect(() => {
    let mounted = true;
    api.demoCredentials()
      .then((credentials) => {
        if (!mounted) return;
        credentialsLoadedRef.current = true;
        setDemoPasswords(credentials);
        const pendingUsername = pendingDemoLoginRef.current;
        pendingDemoLoginRef.current = null;
        const selectedPassword = credentials[pendingUsername ?? selectedRoleRef.current];
        if (!registeringRef.current) {
          setPassword((current) => current || credentials[selectedRoleRef.current] || "");
        }
        if (pendingUsername && selectedPassword) {
          void signIn(pendingUsername, selectedPassword);
        }
      })
      .catch((reason) => {
        if (mounted) {
          credentialsLoadedRef.current = true;
          setError(reason instanceof Error ? reason.message : "Demo sign-in settings could not be loaded.");
        }
      });
    return () => {
      mounted = false;
    };
  }, [signIn]);

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

  return (
    <main className="login-page">
      <div className="login-decoration decoration-one" />
      <div className="login-decoration decoration-two" />
      <section className="login-card">
        <div className="login-brand"><span className="brand-icon"><ShieldCheck size={24} /></span><span>Regula<span className="brand-light">Shield</span></span></div>
        <div className="login-copy">
          <p className="eyebrow">EVIDENCE REVIEW WORKSPACE</p>
          <h1>Welcome back</h1>
          <p>Sign in to open your role-specific application and compliance workspace.</p>
        </div>
        {!registering && <div className="login-roles" aria-label="Choose a role to sign in">
          {LOGIN_ROLES.map((role) => (
            <button
              key={role.username}
              type="button"
              className={`login-role ${selectedRole === role.username ? "selected" : ""}`}
              aria-pressed={selectedRole === role.username}
              disabled={busy}
              onClick={() => {
                selectedRoleRef.current = role.username;
                setUsername(role.username);
                setSelectedRole(role.username);
                const selectedPassword = demoPasswords[role.username];
                setPassword(selectedPassword ?? "");
                setError(null);
                if (selectedPassword) {
                  void signIn(role.username, selectedPassword);
                } else if (!credentialsLoadedRef.current) {
                  pendingDemoLoginRef.current = role.username;
                }
              }}
            >
              {role.label}
            </button>
          ))}
        </div>}
        <form onSubmit={submit} className="login-form">
          {registering && <>
            <label htmlFor="display-name">Institution / applicant name</label>
            <input id="display-name" name="display_name" autoComplete="organization" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={160} required />
          </>}
          <label htmlFor="username">Username</label>
          <input id="username" name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={registering ? 3 : undefined} maxLength={80} required />
          <div className="password-label"><label htmlFor="password">Password</label></div>
          <div className="password-input">
            <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={registering ? 12 : undefined} maxLength={256} required />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
          {registering && <small>Use at least 12 characters. New accounts are created with the Institution Applicant role.</small>}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={busy}>{busy ? (registering ? "Creating account…" : "Signing in…") : registering ? "Create Institution Applicant account" : <>Sign in <ArrowRight size={17} /></>}</button>
        </form>
        <div className="login-help"><span className="status-dot" />{registering ? "Create an institution account to submit applications for System Administrator review." : "Use your assigned credentials or create an Institution Applicant account."}</div>
        <button className="text-button login-mode-toggle" type="button" disabled={busy} onClick={() => { setRegistering((current) => { registeringRef.current = !current; return !current; }); setError(null); setPassword(""); }}>
          {registering ? "Already have an account? Sign in" : "New Institution Applicant? Create an account"}
        </button>
      </section>
    </main>
  );
}
