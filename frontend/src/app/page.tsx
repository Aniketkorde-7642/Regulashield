"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowDownUp, ArrowRight, ClipboardList, FileCheck2, Plus, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { NewApplicationForm } from "@/components/NewApplicationForm";
import { StatusBadge } from "@/components/StatusBadge";
import { RoleDashboard } from "@/components/RoleDashboard";
import { useAuth } from "@/components/AuthProvider";
import type { ApplicationSummary, DashboardStats, ReviewQueueItem } from "@/lib/types";
import { formatDate, humanize } from "@/lib/utils";

const EMPTY_STATS: DashboardStats = { applications: 0, in_review: 0, documents: 0, open_findings: 0, users: 0 };

export default function HomePage() {
  const { user } = useAuth();
  const role = user?.role.trim().toLowerCase().replaceAll(" ", "_");
  if (user && role && [
    "admin",
    "administrator",
    "system_administrator",
    "officer",
    "aicte_scrutiny_officer",
    "scrutiny_officer",
    "regulatory_officer",
    "regulatory",
    "verification_officer",
    "compliance_admin",
    "compliance_administrator",
    "regulatory_compliance_administrator",
    "institution",
    "institution_login",
  ].includes(role)) {
    return <RoleDashboard role={user.role} />;
  }
  return <ApplicationsPage />;
}

function ApplicationsPage() {
  const { user } = useAuth();
  const normalizedRole = user?.role.trim().toLowerCase().replaceAll(" ", "_");
  const canCreateApplication = normalizedRole === "admin"
    || normalizedRole === "administrator"
    || normalizedRole === "system_administrator"
    || normalizedRole === "institution"
    || normalizedRole === "institution_login";
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [items, dashboard] = await Promise.all([api.listApplications(), api.dashboard()]);
      setApplications(items);
      setStats(dashboard);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load applications.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleApplications = applications.filter((application) => {
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [
      application.application_number,
      application.institution_name,
      application.institution_id,
    ].some((value) => value.toLowerCase().includes(term));
    return matchesSearch && (statusFilter === "all" || application.status === statusFilter);
  });

  return (
    <>
      <section className="welcome-row">
        <div><p className="eyebrow">OVERVIEW</p><h2>Applications</h2><p>Track intake, document processing, and officer decisions.</p></div>
        <div className="welcome-actions"><button className="button button-secondary" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} /> Refresh</button>{canCreateApplication && <button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={17} /> New application</button>}</div>
      </section>

      <PriorityReviewQueue />

      {error && <div className="alert alert-error"><AlertCircle size={18} /> <span>{error}</span><button onClick={() => void load(true)}>Retry</button></div>}

      <section className="stats-grid" aria-label="Application summary">
        <StatCard icon={<ClipboardList size={19} />} label="Total applications" value={stats.applications} tone="indigo" />
        <StatCard icon={<ArrowDownUp size={19} />} label="In review" value={stats.in_review} tone="amber" />
        <StatCard icon={<FileCheck2 size={19} />} label="Documents received" value={stats.documents} tone="teal" />
        <StatCard icon={<ShieldAlert size={19} />} label="Open findings" value={stats.open_findings} tone="rose" />
      </section>

      <section className="panel application-panel">
        <div className="panel-heading"><div><h3>Application register</h3><p>Search and open a case to review evidence and findings.</p></div><span className="record-count">{visibleApplications.length} records</span></div>
        <div className="toolbar">
          <label className="search-field"><Search size={16} /><input aria-label="Search applications" placeholder="Search number, institution or ID" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="filter-field"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="processing">Processing</option><option value="review_required">Review required</option><option value="pending_admin_review">Pending administrator review</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
        </div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Application</th><th>Institution</th><th>Category / year</th><th>Evidence</th><th>Status</th><th>Created</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7}><div className="table-state"><span className="spinner" /> Loading applications…</div></td></tr>}
            {!loading && visibleApplications.map((application) => <tr key={application.id}>
              <td><strong className="mono">{application.application_number}</strong><small>{application.institution_id}</small></td>
              <td><strong>{application.institution_name}</strong><small>{application.declared_faculty} declared faculty</small></td>
              <td>{humanize(application.category)}<small>{application.academic_year}</small></td>
              <td><span className="evidence-count"><FileCheck2 size={15} /> {application.document_count}</span></td>
              <td><StatusBadge status={application.status} /></td>
              <td>{formatDate(application.created_at)}</td>
              <td><Link className="table-link" href={`/applications/${application.id}`}>Open <ArrowRight size={14} /></Link></td>
            </tr>)}
            {!loading && visibleApplications.length === 0 && <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><ClipboardList size={22} /></div><h3>{applications.length ? "No matching applications" : "No applications yet"}</h3><p>{applications.length ? "Try another search or status filter." : canCreateApplication ? "Create an application to begin an evidence review." : "Applications will appear here when they are submitted."}</p>{applications.length === 0 && canCreateApplication && <button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Create application</button>}</div></td></tr>}
          </tbody>
        </table></div>
      </section>
      {showCreate && <NewApplicationForm onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(true); }} />}
    </>
  );
}

function PriorityReviewQueue() {
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setQueue(await api.reviewQueue());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the prioritized review queue.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="panel priority-queue">
      <div className="panel-heading">
        <div><h3>Prioritized scrutiny queue</h3><p>Open high-risk findings, discrepancies, and pending fields raise review priority.</p></div>
        <button className="button button-secondary compact" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh queue
        </button>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>}
      {loading && <div className="table-state"><span className="spinner" /> Preparing review reports…</div>}
      {!loading && !error && queue.length === 0 && <div className="section-empty"><ClipboardList size={20} /><strong>No applications require scrutiny</strong><span>New applications will appear here with their automated findings.</span></div>}
      {!loading && !error && queue.map((item) => (
        <article className="queue-item" key={item.id}>
          <div className="queue-item-heading">
            <div><strong>{item.application_number} · {item.institution_name}</strong><span>{humanize(item.status)} · {item.academic_year}</span></div>
            <span className="queue-priority">Priority {item.priority_score}</span>
          </div>
          <div className="queue-metrics">
            <span>{item.high_findings} high-risk finding(s)</span>
            <span>{item.open_findings} open finding(s)</span>
            <span>{item.pending_fields} field(s) awaiting confirmation</span>
          </div>
          {item.report.slice(0, 3).map((finding) => (
            <p className="queue-report-line" key={`${finding.rule_id}-${finding.message}`}>
              <span className={`severity-tag severity-${finding.severity}`}>{finding.severity}</span>
              <span>{finding.message}</span>
              {finding.clause_reference && <small>{finding.clause_reference}</small>}
            </p>
          ))}
          {item.metadata_discrepancies.slice(0, 3).map((discrepancy) => (
            <p className="queue-report-line" key={`${discrepancy.field_name}-${discrepancy.extracted_value}`}>
              <span className="severity-tag severity-medium">mismatch</span>
              <span>{humanize(discrepancy.field_name)}: extracted “{discrepancy.extracted_value ?? "no value"}”, expected “{discrepancy.expected_value}” ({discrepancy.match_percentage}% match)</span>
            </p>
          ))}
          <Link className="table-link" href={`/applications/${item.id}`}>Review application <ArrowRight size={14} /></Link>
        </article>
      ))}
      <p className="queue-disclaimer">Explainable rules and OCR indicators are decision support, not an autonomous AI determination.</p>
    </section>
  );
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return <article className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>;
}
