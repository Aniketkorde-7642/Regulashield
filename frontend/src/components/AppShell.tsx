"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, FileClock, LogOut, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { LoginScreen } from "@/components/LoginScreen";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return <div className="boot-screen"><span className="spinner" /> Loading your workspace…</div>;
  }
  if (!user) return <LoginScreen />;

  const role = user.role.trim().toLowerCase().replaceAll(" ", "_");
  const isAdmin = role === "admin" || role === "administrator" || role === "system_administrator";
  const isInstitution = role === "institution" || role === "institution_login";
  const isRegulatory = ["regulatory_officer", "regulatory", "verification_officer"].includes(role);
  const isComplianceAdmin = ["compliance_admin", "compliance_administrator", "regulatory_compliance_administrator"].includes(role);
  const roleLabel = isAdmin
    ? "System administration"
    : isInstitution
      ? "Institution portal"
      : isRegulatory
        ? "Regulatory verification"
        : isComplianceAdmin
          ? "Compliance administration"
        : "AICTE scrutiny";

  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link href="/" className="brand"><span className="brand-icon"><ShieldCheck size={21} /></span><span>Regula<span className="brand-light">Shield</span></span></Link>
        <div className="side-section-label">WORKSPACE</div>
        <nav className="side-nav">
          <Link href="/" className={`side-link ${pathname === "/" ? "active" : ""}`}>
            {isAdmin ? <Users size={18} /> : <ClipboardList size={18} />}
            {isAdmin ? "User administration" : isInstitution ? "My applications" : isRegulatory ? "Compliance review" : isComplianceAdmin ? "Rule management" : "Applications"}
          </Link>
          {(isAdmin || isComplianceAdmin || isRegulatory || role === "officer") && <Link href="/audit" className={`side-link ${pathname.startsWith("/audit") ? "active" : ""}`}><FileClock size={18} /> Audit trail</Link>}
        </nav>
        <div className="sidebar-bottom"><span className="status-dot" /><span>Local review environment</span></div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-title"><p className="eyebrow">{roleLabel.toUpperCase()}</p><h1>Regula Shield workspace</h1></div>
          <div className="user-menu"><div className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</div><div className="user-details"><strong>{user.display_name}</strong><span>{user.role}</span></div><button className="icon-button" title="Sign out" aria-label="Sign out" onClick={logout}><LogOut size={17} /></button></div>
        </header>
        <main className="page-content">{children}</main>
        <footer className="page-footer"><span>REGULA SHIELD · REVIEW WORKSPACE</span></footer>
      </div>
    </div>
  );
}
