"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import type { ApplicationDecisionReport } from "@/lib/types";
import { formatDate, humanize } from "@/lib/utils";

export default function ApplicationDecisionReportPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<ApplicationDecisionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.decisionReport(params.id)
      .then((result) => { if (active) setReport(result); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load the decision report.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params.id]);

  if (loading) return <div className="page-loading"><span className="spinner" /> Preparing decision report…</div>;
  if (error || !report) return <div className="load-error"><FileText size={20} /><div><strong>Decision report unavailable</strong><p>{error ?? "The report could not be loaded."}</p><Link className="table-link" href={`/applications/${params.id}`}><ArrowLeft size={14} /> Return to application</Link></div></div>;

  return (
    <>
      <div className="breadcrumb"><Link href={`/applications/${params.id}`}><ArrowLeft size={15} /> Application</Link><span>/</span><span>Decision report</span></div>
      <article className="application-decision-report">
        <header className="decision-report-header">
          <div><p className="eyebrow">INSTITUTION APPLICATION DECISION REPORT</p><h1>{report.institution_name}</h1><p>{report.application_number} · {report.institution_id} · {report.academic_year}</p></div>
          <StatusBadge status={report.status} />
        </header>
        <section className={`decision-report-outcome decision-${report.status}`}>
          <div><span>Final outcome</span><strong>{humanize(report.status)}</strong></div>
          <div><span>Decision recorded by</span><strong>{report.decided_by}</strong></div>
          <div><span>Decision date</span><strong>{formatDate(report.decided_at)}</strong></div>
          <div><span>Decision note</span><strong>{report.decision_note || "No note provided."}</strong></div>
        </section>
        <section className="decision-report-section">
          <h2>Application and score summary</h2>
          <div className="decision-report-grid">
            <div><span>Category</span><strong>{humanize(report.category)}</strong></div>
            {Object.entries(report.match_summary).map(([key, value]) => (
              <div key={key}><span>{humanize(key)}</span><strong>{typeof value === "number" && key === "score" ? `${value}%` : String(value)}</strong></div>
            ))}
          </div>
        </section>
        <section className="decision-report-section">
          <h2>Evidence reviewed ({report.documents.length})</h2>
          {report.documents.length ? <ul>{report.documents.map((document) => <li key={document.id}><strong>{document.filename}</strong><span>{humanize(document.document_type)} · {humanize(document.status)}</span></li>)}</ul> : <p>No supporting documents were recorded.</p>}
        </section>
        <section className="decision-report-section">
          <h2>Recorded findings ({report.findings.length})</h2>
          {report.findings.length ? <ul>{report.findings.map((finding) => <li key={finding.id}><strong>{finding.message}</strong><span>{humanize(finding.severity)} · {humanize(finding.status)}{finding.expected ? ` · Expected: ${finding.expected}` : ""}{finding.actual ? ` · Recorded: ${finding.actual}` : ""}</span></li>)}</ul> : <p>No findings were recorded.</p>}
        </section>
      </article>
      <div className="decision-report-actions">
        <Link className="button button-secondary" href={`/applications/${params.id}`}><ArrowLeft size={15} /> Back to application</Link>
        <button className="button button-primary" onClick={() => window.print()}><Download size={15} /> Print / Save as PDF</button>
      </div>
    </>
  );
}
