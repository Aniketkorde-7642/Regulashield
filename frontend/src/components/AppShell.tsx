"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  ClipboardList,
  FileClock,
  FileText,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { HelpDesk } from "@/components/HelpDesk";
import { LoginScreen } from "@/components/LoginScreen";

interface WorkspaceLink {
  href: string;
  label: string;
  icon: React.ReactNode;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const [activeHash, setActiveHash] = useState("");

  useEffect(() => {
    const updateHash = () => setActiveHash(window.location.hash);
    updateHash();
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, []);

  if (loading) {
    return <div className="boot-screen"><span className="spinner" /> Loading your workspace…</div>;
  }
  if (!user) return <><LoginScreen /><HelpDesk displayName="there" role="" /></>;

  const role = user.role.trim().toLowerCase().replaceAll(" ", "_");
  const isAdmin = role === "admin" || role === "administrator" || role === "system_administrator";
  const isInstitution = role === "institution" || role === "institution_login";
  const isOfficer = ["officer", "aicte_scrutiny_officer", "scrutiny_officer"].includes(role);
  const isRegulatory = ["regulatory_officer", "regulatory", "verification_officer"].includes(role);
  const isComplianceAdmin = ["compliance_admin", "compliance_administrator", "regulatory_compliance_administrator"].includes(role);
  const workspaceLinks: WorkspaceLink[] = [
    { href: "/", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
    ...(isInstitution
      ? [
          { href: "/#institution-analytics", label: "Analytics", icon: <LayoutDashboard size={18} /> },
          { href: "/#institution-applications", label: "My applications", icon: <ClipboardList size={18} /> },
          { href: "/#institution-reports", label: "Decision reports", icon: <FileText size={18} /> },
          { href: "/#institution-validation", label: "Validation & corrections", icon: <ShieldCheck size={18} /> },
        ]
      : isAdmin
        ? [
            { href: "/#admin-analytics", label: "Analytics", icon: <LayoutDashboard size={18} /> },
            { href: "/#admin-submissions", label: "Institution submissions", icon: <ClipboardList size={18} /> },
            { href: "/#admin-requests", label: "Account requests", icon: <Users size={18} /> },
            { href: "/#admin-rule-approvals", label: "Rule approvals", icon: <ShieldCheck size={18} /> },
            { href: "/#admin-users", label: "User accounts", icon: <Users size={18} /> },
          ]
        : isOfficer
          ? [
              { href: "/#scrutiny-analytics", label: "Analytics", icon: <LayoutDashboard size={18} /> },
              { href: "/#scrutiny-queue", label: "Review queue", icon: <ClipboardList size={18} /> },
              { href: "/#scrutiny-samples", label: "Sample decisions", icon: <FileText size={18} /> },
            ]
          : isComplianceAdmin
            ? [
                { href: "/#compliance-registry", label: "Rule management", icon: <ShieldCheck size={18} /> },
                { href: "/#compliance-proposals", label: "Drafts and proposals", icon: <FileText size={18} /> },
                { href: "/#compliance-approval-queue", label: "Approval queue", icon: <ClipboardList size={18} /> },
              ]
            : isRegulatory
              ? [
                  { href: "/#regulatory-findings", label: "Compliance review", icon: <ShieldCheck size={18} /> },
                  { href: "/#regulatory-rules", label: "Rule configuration", icon: <FileText size={18} /> },
                ]
              : []),
    ...((isAdmin || isComplianceAdmin || isRegulatory || isOfficer)
      ? [{ href: "/audit", label: "Audit trail", icon: <FileClock size={18} /> }]
      : []),
  ];
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
          {workspaceLinks.map((item) => {
            const active = item.href === "/"
              ? pathname === "/" && !activeHash
              : item.href === "/audit"
                ? pathname.startsWith("/audit")
                : item.href.startsWith("/#") && pathname === "/" && activeHash === item.href.slice(1);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`side-link ${active ? "active" : ""}`}
                onClick={() => setActiveHash(item.href.startsWith("/#") ? item.href.slice(1) : "")}
              >
                {item.icon}{item.label}<ArrowRight className="side-link-arrow" size={13} />
              </Link>
            );
          })}
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
      <HelpDesk displayName={user.display_name} role={user.role} />
    </div>
  );
}
