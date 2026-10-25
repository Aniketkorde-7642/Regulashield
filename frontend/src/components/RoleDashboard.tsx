"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardList,
  FileText,
  FileCheck2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Users,
  Upload,
  FlaskConical,
} from "lucide-react";
import { api } from "@/lib/api";
import { NewApplicationForm } from "@/components/NewApplicationForm";
import { StatusBadge } from "@/components/StatusBadge";
import type {
  ApplicationReview,
  ApplicationSummary,
  ComplianceRule,
  CreateUserPayload,
  DashboardStats,
  Finding,
  InstitutionAccountRequest,
  ManagedUser,
  ApplicationPreflight,
  SecurityOverview,
  ComplianceRulePayload,
  RuleChange,
  RuleSimulation,
} from "@/lib/types";
import { formatDate, humanize } from "@/lib/utils";

const EMPTY_STATS: DashboardStats = {
  applications: 0,
  in_review: 0,
  documents: 0,
  open_findings: 0,
  users: 0,
};

export function RoleDashboard({ role }: { role: string }) {
  if (["admin", "administrator", "system_administrator"].includes(role)) return <AdminDashboard />;
  if (["officer", "aicte_scrutiny_officer", "scrutiny_officer"].includes(role)) return <ScrutinyOfficerDashboard />;
  if (["compliance_admin", "compliance_administrator", "regulatory_compliance_administrator"].includes(role)) return <ComplianceAdminDashboard />;
  if (role === "regulatory_officer" || role === "regulatory" || role === "verification_officer") {
    return <RegulatoryDashboard />;
  }
  if (role === "institution" || role === "institution_login") return <InstitutionDashboard />;
  return <AccessNotice role={role} />;
}

function ScrutinyOfficerDashboard() {
  const { stats, applications, loading, busy, error, refresh } = useDashboardData();
  const reviewableApplications = applications.filter(
    (application) => !["approved", "rejected"].includes(application.status),
  );
  const sampleDecisions = applications.filter(
    (application) => application.application_number.startsWith("DEMO-SAMPLE-")
      && ["approved", "rejected"].includes(application.status),
  );

  return (
    <>
      <DashboardHeader
        eyebrow="AICTE SCRUTINY"
        title="Application review queue"
        description="Review submitted institution applications, verify evidence, resolve findings, and record the final AICTE scrutiny decision."
        actions={<button className="button button-secondary" onClick={refresh} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} /> Refresh</button>}
      />
      <DashboardError error={error} />
      <MetricCards stats={stats} />
      <section className="panel">
        <div className="panel-heading"><div><h3>Applications awaiting review</h3><p>Submitted institution applications are ready for an AICTE Scrutiny Officer's final decision.</p></div><span className="record-count">{reviewableApplications.length} open</span></div>
        {loading && <div className="table-state"><span className="spinner" /> Loading applications…</div>}
        {!loading && reviewableApplications.length === 0 && <div className="section-empty"><Check size={20} /><strong>No applications awaiting review</strong><span>New submissions will appear here.</span></div>}
        <div className="finding-list">{reviewableApplications.map((application) => (
          <article className="institution-application" key={application.id}>
            <div className="institution-application-head"><div><strong>{application.institution_name}</strong><span className="mono">{application.application_number} · {application.academic_year}</span></div><StatusBadge status={application.status} /></div>
            <div className="institution-application-meta"><span>{application.document_count} supporting file(s)</span><span>Updated {formatDate(application.updated_at)}</span></div>
            <Link className="table-link" href={`/applications/${application.id}`}>Review extracted fields and evidence <ArrowRight size={14} /></Link>
          </article>
        ))}</div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h3>Sample decision outcomes</h3><p>Synthetic examples for demonstration only; these are not actual or official AICTE decisions.</p></div><span className="record-count">{sampleDecisions.length} samples</span></div>
        {!loading && sampleDecisions.length === 0 && <div className="section-empty"><FileText size={20} /><strong>No sample decisions are configured</strong></div>}
        <div className="finding-list">{sampleDecisions.map((application) => (
          <article className="institution-application" key={application.id}>
            <div className="institution-application-head"><div><strong>{application.institution_name}</strong><span className="mono">{application.application_number} · {application.academic_year}</span></div><StatusBadge status={application.status} /></div>
            <div className="institution-application-meta"><span>Synthetic demonstration record</span><span>No supporting evidence attached</span></div>
            <Link className="table-link" href={`/applications/${application.id}`}>View sample decision <ArrowRight size={14} /></Link>
          </article>
        ))}</div>
      </section>
    </>
  );
}

function DashboardHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <section className="welcome-row">
      <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>
      {actions && <div className="welcome-actions">{actions}</div>}
    </section>
  );
}

function MetricCards({ stats, admin = false }: { stats: DashboardStats; admin?: boolean }) {
  return (
    <section className="stats-grid" aria-label="Role dashboard summary">
      <Metric label="Applications" value={stats.applications} icon={<ClipboardList size={19} />} />
      <Metric label="In review" value={stats.in_review} icon={<ShieldAlert size={19} />} />
      <Metric label="Documents" value={stats.documents} icon={<FileCheck2 size={19} />} />
      <Metric label={admin ? "Managed users" : "Open findings"} value={admin ? stats.users : stats.open_findings} icon={admin ? <Users size={19} /> : <AlertCircle size={19} />} />
    </section>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <article className="stat-card"><span className="stat-icon indigo">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>;
}

function useDashboardData() {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    setBusy(background);
    setLoading(!background);
    setError(null);
    try {
      const [nextStats, nextApplications] = await Promise.all([
        api.dashboard(),
        api.listApplications(),
      ]);
      setStats(nextStats);
      setApplications(nextApplications);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load this dashboard.");
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { stats, applications, loading, busy, error, refresh: () => void load(true), reload: () => void load() };
}

function DashboardError({ error }: { error: string | null }) {
  return error ? <div className="alert alert-error" role="alert"><AlertCircle size={17} />{error}</div> : null;
}

function AdminDashboard() {
  const { stats, applications, loading, busy, error, refresh } = useDashboardData();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [institutionRequests, setInstitutionRequests] = useState<InstitutionAccountRequest[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [security, setSecurity] = useState<SecurityOverview | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [roleEdits, setRoleEdits] = useState<Record<string, CreateUserPayload["role"]>>({});

  const loadUsers = useCallback(async () => {
    setUsersError(null);
    try {
      setUsers(await api.listUsers());
    } catch (reason) {
      setUsersError(reason instanceof Error ? reason.message : "Unable to load users.");
    }
  }, []);
  const loadInstitutionRequests = useCallback(async () => {
    setUsersError(null);
    try {
      setInstitutionRequests(await api.institutionAccountRequests());
    } catch (reason) {
      setUsersError(reason instanceof Error ? reason.message : "Unable to load institution account requests.");
    }
  }, []);
  const loadSecurity = useCallback(async () => {
    try {
      setSecurity(await api.securityOverview());
    } catch (reason) {
      setUsersError(reason instanceof Error ? reason.message : "Unable to load security monitoring.");
    }
  }, []);
  useEffect(() => {
    void loadUsers();
    void loadInstitutionRequests();
    void loadSecurity();
  }, [loadUsers, loadInstitutionRequests, loadSecurity]);

  async function decideInstitutionRequest(
    accountRequest: InstitutionAccountRequest,
    decision: "approve" | "reject",
  ) {
    let note: string | undefined;
    if (decision === "reject") {
      const enteredNote = window.prompt("Why are you rejecting this account request?");
      if (enteredNote === null) return;
      note = enteredNote.trim();
      if (!note) {
        setUsersError("Enter a reason to reject this account request.");
        return;
      }
    }
    setSavingId(accountRequest.id);
    setUsersError(null);
    try {
      await api.decideInstitutionAccountRequest(accountRequest.id, decision, note);
      await Promise.all([loadUsers(), loadInstitutionRequests()]);
      if (decision === "approve") {
        refresh();
      }
    } catch (reason) {
      setUsersError(reason instanceof Error ? reason.message : "Unable to review the account request.");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleUser(user: ManagedUser) {
    setSavingId(user.id);
    setUsersError(null);
    try {
      await api.updateUser(user.id, { is_active: !user.is_active });
      await loadUsers();
      refresh();
    } catch (reason) {
      setUsersError(reason instanceof Error ? reason.message : "Unable to update the user.");
    } finally {
      setSavingId(null);
    }
  }

  async function updateRole(user: ManagedUser) {
    const role = roleEdits[user.id] ?? user.role as CreateUserPayload["role"];
    if (role === user.role) return;
    setSavingId(user.id);
    setUsersError(null);
    try {
      await api.updateUser(user.id, { role });
      await loadUsers();
      setRoleEdits((current) => ({ ...current, [user.id]: role }));
    } catch (reason) {
      setUsersError(reason instanceof Error ? reason.message : "Unable to update the user's role.");
    } finally {
      setSavingId(null);
    }
  }

  async function resetPassword(user: ManagedUser, password: string) {
    setSavingId(user.id);
    try {
      await api.updateUser(user.id, { password });
      setResetTarget(null);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <DashboardHeader
        eyebrow="SYSTEM ADMINISTRATION"
        title="User and system dashboard"
        description="Manage role-based accounts and monitor the review environment."
        actions={<button className="button button-secondary" onClick={() => { refresh(); void loadInstitutionRequests(); }} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} /> Refresh</button>}
      />
      <DashboardError error={error} />
      <MetricCards stats={stats} admin />
      <RuleApprovalQueue canReview />
      <section className="panel">
        <div className="panel-heading"><div><h3>Institution submissions</h3><p>Applications submitted for final review by an AICTE Scrutiny Officer.</p></div><span className="record-count">{applications.filter((application) => application.status === "pending_admin_review").length} pending</span></div>
        {loading && <div className="table-state"><span className="spinner" /> Loading applications…</div>}
        {!loading && applications.filter((application) => application.status === "pending_admin_review").length === 0 && <div className="section-empty"><Check size={20} /><strong>No institution submissions awaiting scrutiny</strong></div>}
        <div className="finding-list">{applications.filter((application) => application.status === "pending_admin_review").map((application) => (
          <article className="institution-application" key={application.id}>
            <div className="institution-application-head"><div><strong>{application.institution_name}</strong><span className="mono">{application.application_number} · {application.academic_year}</span></div><StatusBadge status={application.status} /></div>
            <div className="institution-application-meta"><span>{application.document_count} supporting file(s)</span><span>Submitted {formatDate(application.updated_at)}</span></div>
            <Link className="table-link" href={`/applications/${application.id}`}>View submission <ArrowRight size={14} /></Link>
          </article>
        ))}</div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h3>Institution account requests</h3><p>New institution accounts cannot sign in until approved here.</p></div><span className="record-count">{institutionRequests.length} pending</span></div>
        <DashboardError error={usersError} />
        {institutionRequests.length === 0
          ? <div className="section-empty"><Check size={20} /><strong>No institution account requests awaiting approval</strong></div>
          : <div className="table-scroll"><table className="data-table">
            <thead><tr><th>Institution / applicant</th><th>Requested username</th><th>Requested</th><th>Review</th></tr></thead>
            <tbody>{institutionRequests.map((accountRequest) => <tr key={accountRequest.id}>
              <td><strong>{accountRequest.display_name}</strong></td>
              <td className="mono">{accountRequest.username}</td>
              <td>{formatDate(accountRequest.created_at)}</td>
              <td className="user-actions">
                <button className="button button-primary compact" disabled={savingId === accountRequest.id} onClick={() => void decideInstitutionRequest(accountRequest, "approve")}>{savingId === accountRequest.id ? "Saving…" : "Approve account"}</button>
                <button className="button button-secondary compact" disabled={savingId === accountRequest.id} onClick={() => void decideInstitutionRequest(accountRequest, "reject")}>Reject</button>
              </td>
            </tr>)}</tbody>
          </table></div>}
      </section>
      {security && <section className="panel security-overview">
        <div className="panel-heading"><div><h3>Security and audit monitoring</h3><p>Account status and integrity of the hash-linked audit history.</p></div><Link className="table-link" href="/audit">Open audit trail <ArrowRight size={14} /></Link></div>
        <div className="security-status-grid">
          <div><span>Audit integrity</span><strong className={security.audit_integrity_ok ? "security-good" : "security-bad"}>{security.audit_integrity_ok ? "Verified" : "Integrity check failed"}</strong></div>
          <div><span>Active accounts</span><strong>{security.active_users}</strong></div>
          <div><span>Disabled accounts</span><strong>{security.disabled_users}</strong></div>
          <div><span>Recorded audit events</span><strong>{security.audit_events}</strong></div>
        </div>
      </section>}
      <section className="panel">
        <div className="panel-heading">
          <div><h3>User accounts</h3><p>Create an individual account for each person, assign the least-privilege role, and reset passwords when needed.</p></div>
          <button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Create user</button>
        </div>
        <DashboardError error={usersError} />
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>User</th><th>Login</th><th>Role</th><th>Status</th><th>Created</th><th>Access actions</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}>Loading accounts…</td></tr>}
            {!loading && users.map((user) => <tr key={user.id}>
              <td><strong>{user.display_name}</strong></td>
              <td className="mono">{user.username}</td>
              <td><select aria-label={`Role for ${user.username}`} value={roleEdits[user.id] ?? user.role} onChange={(event) => setRoleEdits((current) => ({ ...current, [user.id]: event.target.value as CreateUserPayload["role"] }))}>
                <option value="institution">Institution Applicant</option>
                <option value="officer">AICTE Scrutiny Officer</option>
                <option value="regulatory_officer">Regulatory / Verification Officer</option>
                <option value="compliance_admin">Regulatory / Compliance Administrator</option>
                <option value="admin">System Administrator</option>
              </select></td>
              <td><span className={`user-state ${user.is_active ? "user-active" : "user-disabled"}`}>{user.is_active ? "Active" : "Disabled"}</span></td>
              <td>{formatDate(user.created_at)}</td>
              <td className="user-actions">
                <button className="button button-secondary compact" disabled={savingId === user.id || (roleEdits[user.id] ?? user.role) === user.role} onClick={() => void updateRole(user)}>Update role</button>
                <button className="button button-secondary compact" disabled={savingId === user.id || !user.is_active} onClick={() => setResetTarget(user)}>Reset password</button>
                <button className="button button-secondary compact" disabled={savingId === user.id} onClick={() => void toggleUser(user)}>{user.is_active ? "Disable" : "Enable"}</button>
              </td>
            </tr>)}
            {!loading && users.length === 0 && <tr><td colSpan={6}>No accounts have been created.</td></tr>}
          </tbody>
        </table></div>
      </section>
      {showCreate && <CreateUserForm onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void loadUsers(); refresh(); }} />}
      {resetTarget && <ResetPasswordForm user={resetTarget} busy={savingId === resetTarget.id} onClose={() => setResetTarget(null)} onReset={(password) => resetPassword(resetTarget, password)} />}
    </>
  );
}

function ResetPasswordForm({
  user,
  busy,
  onClose,
  onReset,
}: {
  user: ManagedUser;
  busy: boolean;
  onClose: () => void;
  onReset: (password: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password"));
    if (password !== String(values.get("confirm-password"))) {
      setError("The passwords do not match.");
      return;
    }
    setError(null);
    try {
      await onReset(password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reset the user's password.");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
        <div className="modal-heading"><div><p className="eyebrow">SYSTEM ADMINISTRATION</p><h2 id="reset-password-title">Reset account password</h2><p>Set a new private password for {user.display_name} ({user.username}).</p></div></div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="span-two">New password<input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
            <label className="span-two">Confirm new password<input name="confirm-password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
            <small className="span-two">Use at least 12 characters. Share the new password with the account holder privately.</small>
          </div>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="modal-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Resetting…" : "Reset password"}</button></div>
        </form>
      </section>
    </div>
  );
}

function CreateUserForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.createUser({
        username: String(values.get("username")).trim(),
        display_name: String(values.get("display_name")).trim(),
        role: String(values.get("role")) as CreateUserPayload["role"],
        password: String(values.get("password")),
      });
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
        <div className="modal-heading"><div><p className="eyebrow">SYSTEM ADMINISTRATION</p><h2 id="create-user-title">Create user account</h2><p>Use a unique username and a strong temporary password.</p></div></div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>Display name<input name="display_name" required minLength={2} maxLength={160} /></label>
            <label>Username<input name="username" required minLength={3} pattern="[A-Za-z0-9_.-]+" /></label>
            <label className="span-two">Role<select name="role" defaultValue="officer"><option value="institution">Institution Applicant</option><option value="officer">AICTE Scrutiny Officer</option><option value="regulatory_officer">Regulatory / Verification Officer</option><option value="compliance_admin">Regulatory / Compliance Administrator</option><option value="admin">System Administrator</option></select></label>
            <label className="span-two">Initial password<input name="password" type="password" required minLength={12} autoComplete="new-password" /><small>At least 12 characters.</small></label>
          </div>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="modal-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button></div>
        </form>
      </section>
    </div>
  );
}

function ComplianceAdminDashboard() {
  const { stats, loading, busy, error, refresh } = useDashboardData();
  const [rules, setRules] = useState<ComplianceRule[]>([]);
  const [changes, setChanges] = useState<RuleChange[]>([]);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [includeHistory, setIncludeHistory] = useState(true);
  const [ruleSearch, setRuleSearch] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<RuleSimulation | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [sample, setSample] = useState({
    declared_faculty: 10,
    declared_student_count: 100,
    declared_land_area: 1,
  });

  const loadRules = useCallback(async () => {
    setRulesError(null);
    try {
      const [nextRules, nextChanges] = await Promise.all([
        api.listRules(undefined, includeHistory),
        api.listRuleChanges(),
      ]);
      setRules(nextRules);
      setChanges(nextChanges);
    } catch (reason) {
      setRulesError(reason instanceof Error ? reason.message : "Unable to load rule governance data.");
    }
  }, [includeHistory]);
  useEffect(() => { void loadRules(); }, [loadRules]);

  const selectedDraft = changes.find(
    (change) => change.id === selectedDraftId && change.status === "draft",
  ) ?? null;
  const visibleRules = rules.filter((rule) => {
    const term = ruleSearch.trim().toLowerCase();
    return !term || [
      rule.rule_key,
      rule.academic_year,
      rule.clause_reference ?? "",
      rule.source_title,
      rule.message,
    ].some((value) => value.toLowerCase().includes(term));
  });

  function readRulePayload(data: FormData): ComplianceRulePayload {
    return {
      rule_key: String(data.get("rule_key")).trim(),
      academic_year: String(data.get("academic_year")).trim() || "all",
      field: String(data.get("field")) as ComplianceRulePayload["field"],
      operator: String(data.get("operator")) as ComplianceRulePayload["operator"],
      threshold: Number(data.get("threshold")),
      severity: String(data.get("severity")) as ComplianceRulePayload["severity"],
      message: String(data.get("message")).trim(),
      clause_reference: String(data.get("clause_reference")).trim() || null,
      source_title: String(data.get("source_title")).trim(),
      source_url: String(data.get("source_url")).trim() || null,
    };
  }

  async function saveRuleDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setRulesError(null);
    try {
      const payload = readRulePayload(new FormData(form));
      const change = selectedDraft
        ? await api.updateRuleDraft(selectedDraft.id, payload)
        : await api.createRuleDraft(payload);
      setSelectedDraftId(change.id);
      setSimulation(null);
      await loadRules();
    } catch (reason) {
      setRulesError(reason instanceof Error ? reason.message : "Unable to save the rule draft.");
    } finally {
      setSaving(false);
    }
  }

  async function verifySource() {
    if (!selectedDraft || !window.confirm("Confirm you opened the official source and verified this exact clause against the published text.")) return;
    setRulesError(null);
    try {
      await api.verifyRuleSource(selectedDraft.id);
      await loadRules();
    } catch (reason) {
      setRulesError(reason instanceof Error ? reason.message : "Unable to verify the source.");
    }
  }

  async function runSimulation() {
    if (!selectedDraft) return;
    setSimulating(true);
    setRulesError(null);
    try {
      setSimulation(await api.simulateRuleDraft(selectedDraft.id, sample));
      await loadRules();
    } catch (reason) {
      setRulesError(reason instanceof Error ? reason.message : "Unable to simulate this rule.");
    } finally {
      setSimulating(false);
    }
  }

  async function submitDraft() {
    if (!selectedDraft) return;
    setSaving(true);
    setRulesError(null);
    try {
      await api.submitRuleDraft(selectedDraft.id);
      setSelectedDraftId(null);
      setSimulation(null);
      await loadRules();
    } catch (reason) {
      setRulesError(reason instanceof Error ? reason.message : "Unable to submit this rule change.");
    } finally {
      setSaving(false);
    }
  }

  function changeComparison(rule: ComplianceRule): string {
    if (rule.version <= 1) return "Initial version";
    const previous = rules.find(
      (candidate) =>
        candidate.rule_key === rule.rule_key
        && candidate.academic_year === rule.academic_year
        && candidate.version === rule.version - 1,
    );
    if (!previous) return "Prior version unavailable";
    const fields: Array<keyof ComplianceRule> = [
      "field", "operator", "threshold", "severity", "message",
      "clause_reference", "source_title", "source_url",
    ];
    const changed = fields.filter((field) => rule[field] !== previous[field]);
    return changed.length ? `Changed: ${changed.join(", ")}` : "No rule content changes";
  }

  return (
    <>
      <DashboardHeader
        eyebrow="REGULATORY / COMPLIANCE ADMINISTRATION"
        title="Compliance rule governance"
        description="Draft and verify rules, test changes, then submit them for independent System Administrator approval."
        actions={<button className="button button-secondary" onClick={() => { refresh(); void loadRules(); }} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} /> Refresh</button>}
      />
      <DashboardError error={error} />
      <MetricCards stats={stats} />
      <div className="compliance-governance-grid">
        <section className="panel">
          <div className="panel-heading"><div><h3>Rule Registry</h3><p>Active rules apply to future evaluations only.</p></div></div>
          <p className="governance-link-row"><Link href="/audit">Audit Trail: inspect rule lifecycle events <ArrowRight size={14} /></Link></p>
          <label className="history-toggle"><input type="checkbox" checked={includeHistory} onChange={(event) => setIncludeHistory(event.target.checked)} /> Include superseded versions</label>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><h3>Approval Queue</h3><p>Submitted proposals are read-only until the independent approver reviews them.</p></div></div>
          <p>{changes.filter((change) => change.status === "pending").length} proposal(s) awaiting approval.</p>
          <span className="queue-disclaimer">System Administrators approve or reject proposals; authors cannot approve their own changes.</span>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading"><div><h3>{selectedDraft ? "Edit rule draft" : "Create rule draft"}</h3><p>Changes stay inactive until separately approved. Editing resets source verification and simulation.</p></div>
          {selectedDraft && <button type="button" className="button button-secondary compact" onClick={() => { setSelectedDraftId(null); setSimulation(null); }}>New draft</button>}
        </div>
        <DashboardError error={rulesError} />
        <form key={selectedDraft?.id ?? "new-rule-draft"} className="compliance-rule-form" onSubmit={(event) => void saveRuleDraft(event)}>
          <label>Rule key<input name="rule_key" required minLength={3} pattern="[A-Za-z0-9_.-]+" placeholder="faculty.minimum" defaultValue={selectedDraft?.payload.rule_key} /></label>
          <label>Academic year<select name="academic_year" defaultValue={selectedDraft?.payload.academic_year ?? "all"}><option value="all">All years</option><option>2025-26</option><option>2026-27</option><option>2027-28</option><option>2028-29</option></select></label>
          <label>Application field<select name="field" defaultValue={selectedDraft?.payload.field ?? "declared_faculty"}><option value="declared_faculty">Declared faculty</option><option value="declared_student_count">Declared students</option><option value="declared_land_area">Declared land area</option></select></label>
          <label>Condition<select name="operator" defaultValue={selectedDraft?.payload.operator ?? ">="}><option value=">=">At least (&gt;=)</option><option value=">">Greater than (&gt;)</option><option value="<=">At most (&lt;=)</option><option value="<">Less than (&lt;)</option><option value="==">Exactly equal to</option></select></label>
          <label>Threshold<input name="threshold" type="number" min="0" step="any" required defaultValue={selectedDraft?.payload.threshold ?? 1} /></label>
          <label>Severity<select name="severity" defaultValue={selectedDraft?.payload.severity ?? "high"}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
          <label className="span-two">Correction / compliance instruction<textarea name="message" required minLength={8} maxLength={2000} placeholder="Describe the compliance requirement and how the applicant should address a gap." defaultValue={selectedDraft?.payload.message} /></label>
          <label>Clause reference<input name="clause_reference" maxLength={160} placeholder="Official clause / section" defaultValue={selectedDraft?.payload.clause_reference ?? ""} /></label>
          <label>Official source title<input name="source_title" required minLength={3} maxLength={256} placeholder="Official approval process handbook" defaultValue={selectedDraft?.payload.source_title} /></label>
          <label className="span-two">Official source URL<input name="source_url" type="url" maxLength={1000} placeholder="https://..." defaultValue={selectedDraft?.payload.source_url ?? ""} /></label>
          <div className="span-two compliance-submit"><span>Published versions remain traceable; every change requires separate administrator approval.</span><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : selectedDraft ? "Save draft" : "Create draft"}</button></div>
        </form>
      </section>
      {selectedDraft && <section className="panel">
        <div className="panel-heading"><div><h3>Source Verification and Rule Simulator</h3><p>Open the official source, check the exact clause, and test a sample before submission.</p></div></div>
        <div className="governance-source-check">
          {selectedDraft.payload.source_url && <a href={selectedDraft.payload.source_url} target="_blank" rel="noreferrer">Open official source in a new tab <ArrowRight size={14} /></a>}
          <p>Verification records your attestation; the system checks HTTPS and clause metadata but does not claim to independently authenticate the source.</p>
          {selectedDraft.source_verified
            ? <span className="security-good">Source attested by {selectedDraft.source_verified_by} on {formatDate(selectedDraft.source_verified_at ?? "")}</span>
            : <button className="button button-secondary" onClick={() => void verifySource()}>Confirm source and clause checked</button>}
        </div>
        <div className="rule-simulator">
          <h4><FlaskConical size={17} /> Sample application data</h4>
          <div className="form-grid">
            <label>Declared faculty<input type="number" min="0" value={sample.declared_faculty} onChange={(event) => setSample((value) => ({ ...value, declared_faculty: Number(event.target.value) }))} /></label>
            <label>Declared students<input type="number" min="0" value={sample.declared_student_count} onChange={(event) => setSample((value) => ({ ...value, declared_student_count: Number(event.target.value) }))} /></label>
            <label>Declared land area<input type="number" min="0" step="any" value={sample.declared_land_area} onChange={(event) => setSample((value) => ({ ...value, declared_land_area: Number(event.target.value) }))} /></label>
          </div>
          <button className="button button-secondary" disabled={simulating || saving} onClick={() => void runSimulation()}>{simulating ? "Simulating…" : "Run simulation"}</button>
          {simulation && <div className="simulation-result" role="status">
            <strong><CheckCircle2 size={16} /> {simulation.passed ? "Sample passes this rule" : "Sample triggers this rule"}</strong>
            {simulation.findings.map((finding, index) => <p key={`${finding.expected}-${index}`}>{finding.message} Expected {finding.expected}; received {finding.actual}.</p>)}
            <small>{simulation.disclaimer}</small>
          </div>}
          {selectedDraft.simulated_at && <p className="queue-disclaimer">Simulation recorded at {formatDate(selectedDraft.simulated_at)}. Rerun after changing this draft.</p>}
          <button className="button button-primary" disabled={saving || !selectedDraft.source_verified || !selectedDraft.simulated_at} onClick={() => void submitDraft()}>{saving ? "Submitting…" : "Submit for System Administrator approval"}</button>
        </div>
      </section>}
      <section className="panel">
        <div className="panel-heading"><div><h3>Rule draft and approval queue</h3><p>Compliance Administrators may edit their drafts. Submitted proposals await independent review.</p></div></div>
        {changes.length === 0 ? <div className="section-empty"><ClipboardList size={20} /><strong>No rule proposals yet</strong><span>Create a draft to begin the governed rule lifecycle.</span></div> : <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Rule</th><th>Status</th><th>Source</th><th>Simulation</th><th>Owner / reviewer</th><th /></tr></thead>
          <tbody>{changes.map((change) => <tr key={change.id}>
            <td><strong>{change.payload.rule_key}</strong><small>{change.payload.academic_year} · {change.payload.severity}</small></td>
            <td>{humanize(change.status)}</td>
            <td>{change.source_verified ? "Attested" : "Not verified"}<small>{change.payload.clause_reference || "Clause needed"}</small></td>
            <td>{change.simulation_result ? (change.simulation_result.passed ? "Sample passes" : "Sample triggers") : "Not run"}<small>{change.simulation_result ? `${change.simulation_result.findings.length} finding(s)` : "Not run"}</small></td>
            <td>{change.created_by}<small>{change.reviewed_by ? `Reviewed by ${change.reviewed_by}` : ""}</small></td>
            <td>{change.status === "draft" && <button className="button button-secondary compact" onClick={() => { setSelectedDraftId(change.id); setSimulation(null); }}>Edit draft</button>}{change.review_note && <small>{change.review_note}</small>}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div><h3>Version History and Change Comparison</h3><p>Published rules are immutable snapshots; new versions apply to future evaluations only.</p></div>
          <label className="search-field"><span className="sr-only">Search rules</span><input type="search" placeholder="Search key, clause, source…" value={ruleSearch} onChange={(event) => setRuleSearch(event.target.value)} /></label>
        </div>
        <DashboardError error={rulesError} />
        {loading && <div className="table-state"><span className="spinner" /> Loading rules…</div>}
        {!loading && <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Rule / version</th><th>Effective from</th><th>Criterion</th><th>Clause and source</th><th>Changes vs previous</th><th>Status</th></tr></thead>
          <tbody>
            {visibleRules.map((rule) => <tr key={rule.id}>
              <td><strong>{rule.rule_key}</strong><small>Version {rule.version}</small></td>
              <td>{rule.academic_year}<small>{formatDate(rule.created_at)}</small></td>
              <td>{humanize(rule.field)} {rule.operator} {rule.threshold} <small>{rule.severity}</small></td>
              <td>{rule.clause_reference || "—"}<small>{rule.source_url ? <a href={rule.source_url} target="_blank" rel="noreferrer">{rule.source_title}</a> : rule.source_title}</small></td>
              <td>{changeComparison(rule)}<small>{rule.message}</small></td>
              <td>{rule.is_active ? "Active" : "Superseded / inactive"}</td>
            </tr>)}
            {!visibleRules.length && <tr><td colSpan={6}>{rules.length ? "No matching rules." : "No matching compliance rules."}</td></tr>}
          </tbody>
        </table></div>}
      </section>
      <RuleApprovalQueue canReview={false} />
      <div className="notice"><ShieldAlert size={17} /><span><strong>Evaluation integrity:</strong> changing or publishing a rule does not rewrite findings already recorded for earlier evaluations. The audit trail records draft, source attestation, simulation, submission, decision, and publication actions.</span></div>
    </>
  );
}

function RuleApprovalQueue({ canReview }: { canReview: boolean }) {
  const [changes, setChanges] = useState<RuleChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setChanges(await api.listRuleChanges("pending"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load pending rule changes.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function review(change: RuleChange, decision: "approve" | "reject") {
    const note = window.prompt(`${decision === "approve" ? "Approve" : "Reject"} ${change.payload.rule_key}? Enter a review note (optional):`);
    if (note === null) return;
    setBusyId(change.id);
    setError(null);
    try {
      await api.reviewRuleChange(change.id, decision, note.trim() || undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to review this rule change.");
    } finally {
      setBusyId(null);
    }
  }

  return <section className="panel">
    <div className="panel-heading"><div><h3>Approval Queue</h3><p>{canReview ? "Review submitted changes as an independent System Administrator." : "Pending proposals require a separate System Administrator; authors cannot self-approve."}</p></div></div>
    <DashboardError error={error} />
    {changes.length === 0 ? <div className="section-empty"><CheckCircle2 size={20} /><strong>No pending rule changes</strong><span>Submitted proposals will appear here.</span></div> : <div className="table-scroll"><table className="data-table">
      <thead><tr><th>Rule / year</th><th>Requested change</th><th>Simulation</th><th>Source attestation</th><th>Submitted</th><th>Author</th><th>Decision</th></tr></thead>
      <tbody>{changes.map((change) => <tr key={change.id}>
        <td><strong>{change.payload.rule_key}</strong><small>{change.payload.academic_year} · {change.payload.severity}</small></td>
        <td>{humanize(change.payload.field)} {change.payload.operator} {change.payload.threshold}<small>{change.payload.message}</small></td>
        <td>{change.simulation_result ? (change.simulation_result.passed ? "Sample passes" : "Sample triggers") : "Not simulated"}<small>{change.simulation_result ? `${change.simulation_result.findings.length} finding(s) · ${Object.entries(change.simulation_result.sample).map(([key, value]) => `${humanize(key)} ${value}`).join(", ")}` : ""}</small></td>
        <td>{change.source_verified_by}<small>{change.payload.clause_reference} · {change.payload.source_url ? <a href={change.payload.source_url} target="_blank" rel="noreferrer">{change.payload.source_title}</a> : change.payload.source_title}</small></td>
        <td>{formatDate(change.submitted_at ?? change.created_at)}</td>
        <td>{change.created_by}</td>
        <td>{canReview
          ? <div className="user-actions"><button className="button button-primary compact" disabled={busyId === change.id} onClick={() => void review(change, "approve")}>Approve</button><button className="button button-secondary compact" disabled={busyId === change.id} onClick={() => void review(change, "reject")}>Reject</button></div>
          : "Awaiting independent approval"}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

function RegulatoryDashboard() {
  const { stats, applications, loading, busy, error, refresh } = useDashboardData();
  const [findings, setFindings] = useState<Array<Finding & { application_number: string; institution_name: string }>>([]);
  const [findingError, setFindingError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadFindings = useCallback(async () => {
    setFindingError(null);
    try {
      const reviews = await Promise.all(
        applications.map((application) => api.review(application.id)),
      );
      setFindings(reviews.flatMap((review: ApplicationReview) =>
        review.findings.map((finding) => ({
          ...finding,
          application_number: review.application.application_number,
          institution_name: review.application.institution_name,
        })),
      ).filter((finding) => finding.status === "open"));
    } catch (reason) {
      setFindingError(reason instanceof Error ? reason.message : "Unable to load verification findings.");
    }
  }, [applications]);
  useEffect(() => { if (!loading) void loadFindings(); }, [loading, loadFindings]);

  async function resolveFinding(finding: Finding) {
    setSavingId(finding.id);
    try {
      await api.reviewFinding(finding.id, "resolved");
      await loadFindings();
      refresh();
    } catch (reason) {
      setFindingError(reason instanceof Error ? reason.message : "Unable to update the finding.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <DashboardHeader eyebrow="REGULATORY VERIFICATION" title="Compliance and issuer dashboard" description="Inspect open validation findings and record verification outcomes." actions={<button className="button button-secondary" onClick={refresh} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} /> Refresh</button>} />
      <DashboardError error={error} />
      <MetricCards stats={stats} />
      <section className="panel">
        <div className="panel-heading"><div><h3>Open verification findings</h3><p>Review the evidence and mark findings resolved when verified.</p></div><span className="record-count">{findings.length} open</span></div>
        <DashboardError error={findingError} />
        {loading && <div className="table-state"><span className="spinner" /> Loading applications…</div>}
        {!loading && !findingError && findings.length === 0 && <div className="section-empty"><Check size={21} /><strong>No open verification findings</strong><span>New regulatory checks will appear here as applications are processed.</span></div>}
        <div className="finding-list">
          {findings.map((finding) => <article className={`finding-card finding-${finding.severity}`} key={finding.id}>
            <div className="finding-title"><span className={`severity-tag severity-${finding.severity}`}>{finding.severity}</span><span className="finding-category">{humanize(finding.category)}</span><span className="finding-status">{finding.application_number}</span></div>
            <strong>{finding.message}</strong>
            <p className="regulatory-institution">{finding.institution_name}</p>
            {finding.actual && <div className="finding-evidence"><p><span>Observed</span>{finding.actual}</p>{finding.expected && <p><span>Expected</span>{finding.expected}</p>}</div>}
            <div className="finding-actions"><Link className="table-link" href={`/applications/${applications.find((app) => app.application_number === finding.application_number)?.id ?? ""}`}>Inspect application <ArrowRight size={14} /></Link><button className="button button-secondary compact" disabled={savingId === finding.id} onClick={() => void resolveFinding(finding)}><Check size={14} /> Mark verified</button></div>
          </article>)}
        </div>
      </section>
      <section className="panel"><div className="panel-heading"><div><h3>Rule configuration</h3><p>Current checks are demonstration rules; production rules need an authorized, versioned policy source.</p></div></div><div className="notice"><ShieldAlert size={17} /><span>Regulatory findings are advisory examples. Rule editing is not enabled in this demonstration workspace.</span></div></section>
    </>
  );
}

function InstitutionDashboard() {
  const { stats, applications, loading, busy, error, refresh, reload } = useDashboardData();
  const [showCreate, setShowCreate] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [resubmittingId, setResubmittingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [uploadTypes, setUploadTypes] = useState<Record<string, string>>({});
  const [editingApplication, setEditingApplication] = useState<ApplicationSummary | null>(null);
  const [reports, setReports] = useState<Array<{
    finding: Finding;
    application_id: string;
    application_number: string;
    institution_name: string;
  }>>([]);
  const [discrepancies, setDiscrepancies] = useState<Array<{
    id: string;
    application_id: string;
    application_number: string;
    field_name: string;
    expected_value: string;
    extracted_value: string | null;
    match_percentage: number;
  }>>([]);
  const [missingDocuments, setMissingDocuments] = useState<Array<{
    application_id: string;
    application_number: string;
    document_type: string;
    label: string;
  }>>([]);
  const [reportsError, setReportsError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setReportsError(null);
    try {
      const results = await Promise.all(
        applications.map((application) => api.review(application.id)),
      );
      setReports(results.flatMap((report) => report.findings
        .filter((finding) => finding.status === "open")
        .map((finding) => ({
          finding,
          application_id: report.application.id,
          application_number: report.application.application_number,
          institution_name: report.application.institution_name,
        }))));
      setDiscrepancies(results.flatMap((report) => report.extractions
        .filter((field) => field.expected_value !== null
          && field.metadata_match_score !== null
          && field.metadata_match_score < 0.99)
        .map((field) => ({
          id: field.id,
          application_id: report.application.id,
          application_number: report.application.application_number,
          field_name: field.field_name,
          expected_value: field.expected_value ?? "",
          extracted_value: field.extracted_value,
          match_percentage: Math.round((field.metadata_match_score ?? 0) * 100),
        }))));
      const checklist = [
        ["affiliation_letter", "Affiliation / approval letter"],
        ["faculty_certificate", "Faculty details or faculty certificate"],
        ["land_record", "Land ownership or lease evidence"],
        ["fire_safety", "Fire safety certificate"],
      ];
      setMissingDocuments(results.flatMap((report) => {
        if (["approved", "rejected"].includes(report.application.status)) return [];
        const uploadedTypes = new Set(report.application.documents.map((document) => document.document_type));
        return checklist
          .filter(([documentType]) => !uploadedTypes.has(documentType))
          .map(([documentType, label]) => ({
            application_id: report.application.id,
            application_number: report.application.application_number,
            document_type: documentType,
            label,
          }));
      }));
    } catch (reason) {
      setReportsError(reason instanceof Error ? reason.message : "Unable to load application validation reports.");
    }
  }, [applications]);
  useEffect(() => { if (!loading) void loadReports(); }, [loading, loadReports]);

  async function upload(applicationId: string, file: File | undefined) {
    if (!file) return;
    setUploadingId(applicationId);
    setUploadError(null);
    try {
      await api.uploadDocument(applicationId, uploadTypes[applicationId] ?? "affiliation_letter", file);
      reload();
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "Unable to upload this document.");
    } finally {
      setUploadingId(null);
    }
  }

  async function resubmit(application: ApplicationSummary) {
    setResubmittingId(application.id);
    setUploadError(null);
    try {
      await api.resubmitApplication(application.id);
      reload();
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "Unable to create a resubmission.");
    } finally {
      setResubmittingId(null);
    }
  }

  async function submitForReview(application: ApplicationSummary) {
    setSubmittingId(application.id);
    setUploadError(null);
    try {
      await api.submitApplication(application.id);
      reload();
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "Unable to submit this application for review.");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <>
      <DashboardHeader eyebrow="INSTITUTION PORTAL" title="My applications" description="Submit application details, upload supporting PDFs, and follow review status." actions={<><button className="button button-secondary" onClick={refresh} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} /> Refresh</button><button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Submit application</button></>} />
      <DashboardError error={error} />
      <DashboardError error={uploadError} />
      <DashboardError error={reportsError} />
      <MetricCards stats={stats} />
      <section className="panel">
        <div className="panel-heading">
          <div><h3>Decision reports</h3><p>Official outcome records for applications decided by the System Administrator. Open a report to review or print it.</p></div>
          <span className="record-count">{applications.filter((application) => ["approved", "rejected"].includes(application.status)).length} reports</span>
        </div>
        <div className="institution-applications">
          {loading && <div className="table-state"><span className="spinner" /> Loading decision reports…</div>}
          {!loading && applications.filter((application) => ["approved", "rejected"].includes(application.status)).map((application) => (
            <article className="institution-application" key={application.id}>
              <div className="institution-application-head">
                <div><strong>{application.institution_name}</strong><span className="mono">{application.application_number} · {application.academic_year}</span></div>
                <StatusBadge status={application.status} />
              </div>
              <div className="institution-application-meta"><span>{application.document_count} supporting file(s)</span><span>Decision recorded · open report for details</span></div>
              <div className="institution-application-actions">
                <Link className="button button-primary compact" href={`/applications/${application.id}/report`}><FileText size={14} /> View / print decision report</Link>
              </div>
            </article>
          ))}
          {!loading && applications.every((application) => !["approved", "rejected"].includes(application.status)) && (
            <div className="section-empty"><FileText size={21} /><strong>No decision reports yet</strong><span>A report will appear here after the System Administrator approves or rejects one of your applications.</span></div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h3>Validation results and correction actions</h3><p>Open compliance gaps, missing evidence, and extracted-field mismatches include suggested next steps.</p></div><span className="record-count">{reports.length + discrepancies.length + missingDocuments.length} open item(s)</span></div>
        {loading && <div className="table-state"><span className="spinner" /> Loading validation reports…</div>}
        {!loading && reports.length === 0 && discrepancies.length === 0 && missingDocuments.length === 0 && !reportsError && <div className="section-empty"><Check size={20} /><strong>No open validation gaps</strong><span>Upload supporting documents to run evidence checks.</span></div>}
        <div className="finding-list">
          {missingDocuments.map((item) => (
            <article className="finding-card finding-low" key={`${item.application_id}-${item.document_type}`}>
              <div className="finding-title"><span className="severity-tag severity-low">evidence</span><span className="finding-category">Suggested evidence missing</span><span className="finding-status">{item.application_number}</span></div>
              <strong>{item.label}</strong>
              <p className="institution-correction"><strong>Next step:</strong> Select this document type in the application list and upload the corresponding PDF. Checklist items are advisory; confirm applicability against the current rules.</p>
              <Link className="table-link" href={`/applications/${item.application_id}`}>Review application <ArrowRight size={14} /></Link>
            </article>
          ))}
          {discrepancies.map((discrepancy) => (
            <article className="finding-card finding-medium" key={discrepancy.id}>
              <div className="finding-title"><span className="severity-tag severity-medium">mismatch</span><span className="finding-category">{humanize(discrepancy.field_name)}</span><span className="finding-status">{discrepancy.application_number}</span></div>
              <strong>The uploaded document does not fully match your application details.</strong>
              <p className="institution-correction"><strong>Application says:</strong> {discrepancy.expected_value}</p>
              <p className="institution-correction"><strong>Document says:</strong> {discrepancy.extracted_value ?? "No value was extracted"} ({discrepancy.match_percentage}% match)</p>
              <p className="institution-correction"><strong>Next step:</strong> Check that your application details and evidence agree. If the uploaded evidence is wrong or incomplete, upload corrected supporting evidence for {discrepancy.application_number}.</p>
              <Link className="table-link" href={`/applications/${discrepancy.application_id}`}>Review evidence <ArrowRight size={14} /></Link>
            </article>
          ))}
          {reports.map(({ finding, application_id, application_number, institution_name }) => (
            <article className={`finding-card finding-${finding.severity}`} key={finding.id}>
              <div className="finding-title"><span className={`severity-tag severity-${finding.severity}`}>{finding.severity}</span><span className="finding-category">{humanize(finding.category)}</span><span className="finding-status">{application_number}</span></div>
              <strong>{finding.message}</strong>
              <p className="regulatory-institution">{institution_name}</p>
              {finding.expected && <p className="institution-correction"><strong>Expected:</strong> {finding.expected}</p>}
              {finding.actual && <p className="institution-correction"><strong>Detected:</strong> {finding.actual}</p>}
              <p className="institution-correction"><strong>Next step:</strong> Review the instruction and upload corrected or missing evidence for this application.</p>
              {typeof finding.details.clause_reference === "string" && <small>Reference: {finding.details.clause_reference}</small>}
              <Link className="table-link" href={`/applications/${application_id}`}>Review status and evidence <ArrowRight size={14} /></Link>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h3>Application status</h3><p>Only applications submitted by this institution account are shown.</p></div><span className="record-count">{applications.length} applications</span></div>
        <div className="institution-applications">
          {loading && <div className="table-state"><span className="spinner" /> Loading applications…</div>}
          {!loading && applications.map((application) => <article className="institution-application" key={application.id}>
            <div className="institution-application-head"><div><strong>{application.institution_name}</strong><span className="mono">{application.application_number} · {application.academic_year}</span></div><StatusBadge status={application.status} /></div>
            <div className="institution-application-meta"><span>{application.document_count} supporting file(s)</span><span>{application.application_number.startsWith("DEMO-SAMPLE-") ? "Synthetic demonstration record" : `Submitted ${formatDate(application.created_at)}`}</span></div>
            <div className="institution-application-actions">
              <Link className="table-link" href={`/applications/${application.id}`}>View status <ArrowRight size={14} /></Link>
              {["approved", "rejected"].includes(application.status) && <Link className="table-link" href={`/applications/${application.id}/report`}>Decision report <ArrowRight size={14} /></Link>}
              {application.status === "rejected" && !application.application_number.startsWith("DEMO-SAMPLE-") && <button className="button button-secondary compact" disabled={resubmittingId === application.id} onClick={() => void resubmit(application)}>{resubmittingId === application.id ? "Creating…" : "Start resubmission"}</button>}
              {["draft", "processing", "review_required", "corrections_requested"].includes(application.status) && application.document_count > 0 && <button className="button button-primary compact" disabled={submittingId === application.id} onClick={() => void submitForReview(application)}>{submittingId === application.id ? "Submitting…" : application.status === "corrections_requested" ? "Resubmit corrected application" : "Submit to AICTE Scrutiny Officer"}</button>}
              {!["approved", "rejected", "pending_admin_review"].includes(application.status) && <>
                <button className="button button-secondary compact" onClick={() => setEditingApplication(application)}>Correct details</button>
                <select aria-label={`Document type for ${application.application_number}`} value={uploadTypes[application.id] ?? "affiliation_letter"} onChange={(event) => setUploadTypes((current) => ({ ...current, [application.id]: event.target.value }))}>
                  <option value="affiliation_letter">Affiliation letter</option>
                  <option value="faculty_certificate">Faculty certificate</option>
                  <option value="land_record">Land record</option>
                  <option value="fire_safety">Fire safety certificate</option>
                  <option value="other">Other evidence</option>
                </select>
                <label className="button button-secondary compact institution-upload"><Upload size={14} />{uploadingId === application.id ? "Uploading…" : "Upload PDF"}<input aria-label={`Upload document for ${application.application_number}`} type="file" accept="application/pdf,.pdf" disabled={uploadingId === application.id} onChange={(event) => { void upload(application.id, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
              </>}
            </div>
          </article>)}
          {!loading && applications.length === 0 && <div className="section-empty"><ClipboardList size={21} /><strong>No applications submitted</strong><span>Submit an application to start the review process.</span><button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Submit application</button></div>}
        </div>
      </section>
      {showCreate && <NewApplicationForm onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); reload(); }} />}
      {editingApplication && <EditInstitutionApplicationForm
        application={editingApplication}
        onClose={() => setEditingApplication(null)}
        onUpdated={() => { setEditingApplication(null); reload(); }}
      />}
    </>
  );
}

function EditInstitutionApplicationForm({
  application,
  onClose,
  onUpdated,
}: {
  application: ApplicationSummary;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [preflight, setPreflight] = useState(false);
  const [preflightResult, setPreflightResult] = useState<ApplicationPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = {
      application_number: application.application_number,
      institution_id: String(data.get("institution_id")).trim(),
      institution_name: String(data.get("institution_name")).trim(),
      category: String(data.get("category")),
      academic_year: String(data.get("academic_year")).trim(),
      declared_faculty: Number(data.get("declared_faculty")),
      declared_student_count: Number(data.get("declared_student_count")),
      declared_land_area: Number(data.get("declared_land_area")),
    };
    setBusy(true);
    setError(null);
    try {
      if (!preflight) {
        const result = await api.validateApplication(values);
        setPreflightResult(result);
        setPreflight(true);
        setError(result.ready
          ? "Pre-check complete. Review the evidence checklist below, then save your corrected details."
          : "Pre-check found potential gaps. Review the instructions below, then save or continue editing.");
        return;
      }
      await api.updateApplication(application.id, {
        institution_id: values.institution_id,
        institution_name: values.institution_name,
        category: values.category,
        academic_year: values.academic_year,
        declared_faculty: values.declared_faculty,
        declared_student_count: values.declared_student_count,
        declared_land_area: values.declared_land_area,
      });
      onUpdated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save corrected application details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-institution-application-title">
        <div className="modal-heading"><div><p className="eyebrow">CORRECT APPLICATION</p><h2 id="edit-institution-application-title">{application.application_number}</h2><p>Update your declared details, run the checks again, then save. Your changes are recorded in the audit trail.</p></div></div>
        <form onSubmit={(event) => void submit(event)} onInput={() => { setPreflight(false); setPreflightResult(null); setError(null); }}>
          <div className="form-grid">
            <label>Institution ID<input name="institution_id" required maxLength={64} defaultValue={application.institution_id} /></label>
            <label className="span-two">Institution name<input name="institution_name" required minLength={2} maxLength={256} defaultValue={application.institution_name} /></label>
            <label>Category<select name="category" defaultValue={application.category}><option>EOA</option><option>Extension</option><option>New program</option></select></label>
            <label>Academic year<input name="academic_year" required pattern="\d{4}-\d{2}" defaultValue={application.academic_year} /></label>
            <label>Declared faculty<input name="declared_faculty" type="number" min="0" defaultValue={application.declared_faculty} required /></label>
            <label>Declared students<input name="declared_student_count" type="number" min="0" defaultValue={application.declared_student_count} required /></label>
            <label className="span-two">Declared land area<input name="declared_land_area" type="number" min="0" step="0.01" defaultValue={application.declared_land_area} required /></label>
          </div>
          {error && <div className={preflight ? "notice" : "alert alert-error"} role="status">{error}</div>}
          {preflightResult && <div className="preflight-results">
            <h3>{preflightResult.issues.length ? "Pre-check guidance" : "No rule warnings found"}</h3>
            {preflightResult.issues.map((issue, index) => <article className={`preflight-issue severity-${issue.severity}`} key={`${issue.field}-${index}`}>
              <strong>{issue.message}</strong><p>{issue.action}</p>
              {issue.clause_reference && <small>Reference: {issue.clause_reference}</small>}
            </article>)}
            <p className="queue-disclaimer">{preflightResult.disclaimer} Confirm that checklist evidence applies to your application before submission.</p>
          </div>}
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Checking…" : preflight ? "Save corrected details" : "Check corrections"}</button></div>
        </form>
      </section>
    </div>
  );
}

function AccessNotice({ role }: { role: string }) {
  return <section className="panel"><div className="section-empty"><ShieldAlert size={23} /><strong>No dashboard assigned</strong><span>Your account role ({role}) is not configured. Ask a system administrator to update it.</span></div></section>;
}
