"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { StatusBadge } from "@/components/StatusBadge";
import type { ApplicationReview, FieldExtraction, Finding } from "@/lib/types";
import { displayMatchScore, formatDate, humanize } from "@/lib/utils";

export function ApplicationReviewPage() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const applicationId = params.id;
  const role = user?.role.trim().toLowerCase().replaceAll(" ", "_") ?? "";
  const isAdmin = ["admin", "administrator", "system_administrator"].includes(role);
  const isOfficer = ["officer", "aicte_scrutiny_officer", "scrutiny_officer"].includes(role);
  const canDecideRole = isAdmin || isOfficer;
  const canReview = ["admin", "administrator", "system_administrator", "officer", "aicte_scrutiny_officer", "scrutiny_officer", "regulatory_officer", "regulatory", "verification_officer", "compliance_admin", "compliance_administrator", "regulatory_compliance_administrator"].includes(role);
  const canUpload = canDecideRole || role === "institution" || role === "institution_login";
  const [review, setReview] = useState<ApplicationReview | null>(null);
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const applicationReview = await api.review(applicationId);
      const canDecideApplication = canDecideRole
        && (!applicationReview.application.owner_username
          || (isOfficer && applicationReview.application.status === "pending_admin_review"));
      const approvalCheck = canDecideApplication ? await api.blockers(applicationId) : null;
      setReview(applicationReview);
      setBlockers(approvalCheck?.blockers ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the application.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applicationId, canDecideRole, isOfficer]);

  useEffect(() => { void load(); }, [load]);

  const hasProcessingDocument = review?.application.documents.some(
    (document) => document.status === "processing" || document.status === "uploaded",
  );
  useEffect(() => {
    if (!hasProcessingDocument) return;
    const timer = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(timer);
  }, [hasProcessingDocument, load]);

  async function refresh() {
    setRefreshing(true);
    await load(true);
  }

  if (loading) return <div className="page-loading"><span className="spinner" /> Loading application…</div>;
  if (error && !review) return <div className="load-error"><AlertCircle size={20} /><div><strong>Could not open this application</strong><p>{error}</p><button className="button button-secondary" onClick={() => void load()}>Try again</button></div></div>;
  if (!review) return null;

  const application = review.application;
  const finalized = application.status === "approved" || application.status === "rejected";
  const canDecide = canDecideRole
    && (!application.owner_username
      || (isOfficer && application.status === "pending_admin_review"));
  const canRequestCorrections = isAdmin
    && Boolean(application.owner_username)
    && application.status === "pending_admin_review";
  const canEditEvidence = canUpload && !finalized
    && !(application.owner_username && application.status === "pending_admin_review");
  const openHighFindings = review.findings.filter((finding) => finding.severity === "high" && finding.status === "open").length;
  const pendingFields = review.extractions.filter(
    (field) => field.review_action === null || field.requires_review || field.review_action === "flag",
  ).length;
  const processedDocuments = application.documents.filter((document) => document.status === "processed").length;

  return (
    <>
      <div className="breadcrumb"><Link href="/"><ArrowLeft size={15} />{role === "institution" || role === "institution_login" ? "My applications" : "Applications"}</Link><span>/</span><span>{application.application_number}</span></div>
      <div className="detail-heading">
        <div><p className="eyebrow">APPLICATION REVIEW</p><div className="detail-title-row"><h2>{application.institution_name}</h2><StatusBadge status={application.status} /></div><p>{application.application_number} <span className="dot-separator">·</span> {application.institution_id} <span className="dot-separator">·</span> Academic year {application.academic_year}</p></div>
        <div className="welcome-actions">
          {finalized && application.owner_username === user?.username && <Link className="button button-primary" href={`/applications/${application.id}/report`}>Decision report <FileText size={15} /></Link>}
          <button className="button button-secondary" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh</button>
        </div>
      </div>
      {error && <div className="alert alert-error"><AlertCircle size={17} />{error}</div>}

      <div className="workflow-strip">
        <WorkflowStep icon={<FileText size={16} />} label="Intake" complete />
        <span className="workflow-line" />
        <WorkflowStep icon={hasProcessingDocument ? <LoaderCircle size={16} /> : <CheckCircle2 size={16} />} label={hasProcessingDocument ? "Processing" : "Evidence review"} complete={!hasProcessingDocument && application.documents.length > 0} active={hasProcessingDocument} />
        <span className="workflow-line" />
        <WorkflowStep icon={<ShieldCheck size={16} />} label={application.owner_username ? "AICTE Scrutiny Officer decision" : "Officer decision"} complete={finalized} active={!finalized && !hasProcessingDocument} />
      </div>

      <div className="review-summary">
        <SummaryItem label="Evidence received" value={`${application.documents.length} files`} note={`${processedDocuments} processed`} icon={<FileText size={17} />} />
        <SummaryItem label="Fields to review" value={String(pendingFields)} note={pendingFields ? "Confirmation needed" : "Review complete"} icon={<CheckCircle2 size={17} />} />
        <SummaryItem label="Open high findings" value={String(openHighFindings)} note={openHighFindings ? "Resolve before approval" : "No blocking flags"} icon={<AlertTriangle size={17} />} />
        <SummaryItem label="Submitted" value={formatDate(application.created_at)} note={humanize(application.category)} icon={<Clock3 size={17} />} />
      </div>

      <div className="review-layout">
        <div className="review-main-column">
          <DocumentSection
            review={review}
            canUpload={canEditEvidence}
            canReprocess={canDecide}
            onUploaded={() => void load(true)}
          />
          <FieldsSection
            fields={review.extractions}
            documents={application.documents}
            canReview={canReview}
            onChanged={() => void load(true)}
          />
        </div>
        <aside className="review-side-column">
          <ComplianceSummaryCard summary={review.compliance_summary} />
          {!canDecide && <section className="panel">
            <div className="panel-heading"><div><h3>Evidence match summary</h3><p>Advisory comparison of extracted values with your application details.</p></div></div>
            <MatchSummaryCard applicationId={application.id} matchSummary={review.match_summary} />
          </section>}
          <FindingsSection
            findings={review.findings}
            canResolve={canReview}
            onChanged={() => void load(true)}
          />
          {(canDecide || canRequestCorrections) && <DecisionSection
              review={review}
              blockers={blockers}
              canDecide={canDecide}
              canRequestCorrections={canRequestCorrections}
              onDecided={() => void load(true)}
            />}
          <ApplicationInfo application={application} />
        </aside>
      </div>
      {!finalized && application.owner_username && application.status === "pending_admin_review" && <div className="notice"><AlertTriangle size={17} /><span>Submitted and awaiting a final AICTE Scrutiny Officer decision.</span></div>}
    </>
  );
}

function WorkflowStep({ icon, label, complete, active }: { icon: React.ReactNode; label: string; complete?: boolean; active?: boolean }) {
  return <div className={`workflow-step ${complete ? "complete" : ""} ${active ? "active" : ""}`}><span className="workflow-icon">{icon}</span><span>{label}</span></div>;
}

function SummaryItem({ label, value, note, icon }: { label: string; value: string; note: string; icon: React.ReactNode }) {
  return <div className="summary-item"><span className="summary-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></div>;
}

function DocumentSection({
  review,
  canUpload,
  canReprocess,
  onUploaded,
}: {
  review: ApplicationReview;
  canUpload: boolean;
  canReprocess: boolean;
  onUploaded: () => void;
}) {
  const [type, setType] = useState("affiliation_letter");
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const application = review.application;
  const finalized = application.status === "approved" || application.status === "rejected";

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || !file.size) {
      setError("Choose a PDF before uploading.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.uploadDocument(application.id, type, file);
      form.reset();
      onUploaded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function download(documentId: string, filename: string) {
    try {
      const blob = await api.downloadDocument(documentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Download failed.");
    }
  }

  async function retry(documentId: string) {
    const document = application.documents.find((item) => item.id === documentId);
    if (
      document?.status === "processed"
      && !window.confirm(
        "Reprocess this PDF? Existing extracted values and field review decisions will be replaced.",
      )
    ) {
      return;
    }
    setRetryingId(documentId);
    setError(null);
    try {
      await api.retryDocument(application.id, documentId);
      onUploaded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Document retry failed.");
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading"><div><h3>Supporting documents</h3><p>PDF evidence submitted for this application.</p></div><span className="record-count">{application.documents.length} files</span></div>
      {canUpload && !finalized && <form className="upload-form" onSubmit={upload}>
        <label className="upload-type"><span>Document type</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="affiliation_letter">Affiliation letter</option><option value="faculty_certificate">Faculty certificate</option><option value="land_record">Land record</option><option value="fire_safety">Fire safety certificate</option><option value="other">Other</option></select></label>
        <label className="upload-file"><Upload size={16} /><span>Choose PDF</span><input type="file" name="file" accept="application/pdf,.pdf" aria-label="Choose PDF evidence" required /></label>
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin" /> Uploading…</> : <><Upload size={16} /> Upload evidence</>}</button>
      </form>}
      {error && <div className="inline-error"><AlertCircle size={15} />{error}</div>}
      <div className="document-list">
        {application.documents.map((document) => <article className="document-item" key={document.id}>
          <span className="file-tile"><FileText size={19} /></span>
          <div className="document-info"><strong>{document.filename}</strong><span>{humanize(document.document_type)} · {document.page_count} page{document.page_count === 1 ? "" : "s"} · <span className="mono">{document.file_hash.slice(0, 12)}…</span></span>{document.processing_error && <small className="document-error">{document.processing_error}</small>}</div>
          <StatusBadge status={document.status} />
          {canReprocess && !finalized && (document.status === "failed" || document.status === "processed") && <button className="button button-secondary compact" disabled={retryingId === document.id} onClick={() => void retry(document.id)}>{retryingId === document.id ? "Processing…" : document.status === "failed" ? "Retry processing" : "Reprocess fields"}</button>}
          <button className="icon-button" onClick={() => void download(document.id, document.filename)} aria-label={`Download ${document.filename}`} title="Download PDF"><Download size={16} /></button>
        </article>)}
        {application.documents.length === 0 && <div className="section-empty"><FileText size={21} /><strong>No evidence uploaded</strong><span>Upload the required PDF records to begin review.</span></div>}
      </div>
    </section>
  );
}

function FieldsSection({
  fields,
  documents,
  canReview,
  onChanged,
}: {
  fields: FieldExtraction[];
  documents: ApplicationReview["application"]["documents"];
  canReview: boolean;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(field: FieldExtraction, action: "confirm" | "correct" | "absent" | "flag", value?: string) {
    setBusyId(field.id);
    setError(null);
    try {
      await api.reviewField(field.id, action, value);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Field review failed.");
    } finally {
      setBusyId(null);
    }
  }

  const unprocessedDocuments = documents.filter((document) => document.status !== "processed");
  return <section className="panel">
    <div className="panel-heading"><div><h3>Extracted fields</h3><p>{canReview ? "Check the source text, then confirm it, correct it, mark it absent, or flag it for follow-up." : "Review the fields extracted from your supporting documents."}</p></div><span className="record-count">{fields.filter((field) => field.requires_review).length} need review</span></div>
    {error && <div className="inline-error"><AlertCircle size={15} />{error}</div>}
    <div className="field-list">
      {fields.map((field) => <FieldRow key={field.id} field={field} canReview={canReview} busy={busyId === field.id} onReview={review} />)}
      {fields.length === 0 && <div className="section-empty"><FileCheck2Icon /><strong>No extracted fields yet</strong><span>{unprocessedDocuments.length > 0 ? "Check document processing status above. Failed or unreadable PDFs must be retried before extracted text can be reviewed." : documents.length === 0 ? "Upload a supporting PDF to begin text extraction and review." : "No extraction results were saved. Ask an administrator or scrutiny officer to reprocess the supporting PDF."}</span></div>}
    </div>
  </section>;
}

function FieldRow({ field, canReview, busy, onReview }: { field: FieldExtraction; canReview: boolean; busy: boolean; onReview: (field: FieldExtraction, action: "confirm" | "correct" | "absent" | "flag", value?: string) => void }) {
  const [value, setValue] = useState(field.reviewed_value ?? field.extracted_value ?? "");
  const completed = !field.requires_review && field.review_action !== null && field.review_action !== "flag";
  const percent = Math.round(field.confidence * 100);
  const labelMatchPercent = Math.round(field.label_match_score * 100);
  const metadataMatchPercent = field.metadata_match_score === null
    ? null
    : Math.round(field.metadata_match_score * 100);
  return <article className={`field-item ${completed ? "field-done" : "field-pending"}`}>
    <div className="field-head"><div><strong>{humanize(field.field_name)}</strong><span className={`confidence confidence-${percent >= 80 ? "high" : percent >= 55 ? "medium" : "low"}`}>{percent}% confidence{percent < 55 ? " · low" : ""}</span></div><span className={`review-state ${completed ? "reviewed" : "needs-review"}`}>{completed ? <><Check size={13} /> Reviewed</> : <><AlertCircle size={13} /> Review needed</>}</span></div>
    {field.raw_ocr_text && <p className="source-text"><strong>Source text:</strong> “{field.raw_ocr_text}”</p>}
    {field.source_page !== null && <p className="finding-rule">Source page: {field.source_page}</p>}
    <div className="field-match-details">
      <span>Label match (TF-IDF): {labelMatchPercent}%</span>
      {field.expected_value !== null && metadataMatchPercent !== null && <span>
        Application metadata: {metadataMatchPercent}% match
        <small>Expected: {field.expected_value}</small>
      </span>}
    </div>
    <div className="final-value"><span>{field.review_action ? `Reviewer action: ${humanize(field.review_action)}` : "Extracted value"}</span><strong>{field.review_action === "absent" ? "Marked absent" : field.reviewed_value ?? field.extracted_value ?? "No value extracted"}</strong>{!completed && !canReview && <small>Awaiting reviewer confirmation</small>}</div>
    {canReview && <>
      <div className="field-input-row"><input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Edit the extracted text if it is incorrect" aria-label={`Correct ${humanize(field.field_name)}`} /><button className="button button-primary" disabled={busy || !value.trim()} onClick={() => onReview(field, "correct", value)}>{busy ? "Saving…" : "Save correction"}</button></div>
      <div className="field-review-actions">
        <button className="button button-secondary compact" disabled={busy || !field.extracted_value} onClick={() => onReview(field, "confirm")}>{busy ? "Saving…" : "Confirm extracted text"}</button>
        <button className="button button-secondary compact" disabled={busy} onClick={() => onReview(field, "absent")}>{busy ? "Saving…" : "Mark absent"}</button>
        <button className="text-button" disabled={busy} onClick={() => onReview(field, "flag", value)}>{busy ? "Saving…" : "Flag for follow-up"}</button>
      </div>
    </>}
  </article>;
}

function FindingsSection({
  findings,
  canResolve,
  onChanged,
}: {
  findings: Finding[];
  canResolve: boolean;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function setStatus(id: string, status: "resolved" | "dismissed") {
    let reason: string | undefined;
    if (status === "dismissed") {
      const enteredReason = window.prompt("Why are you dismissing this finding?");
      if (enteredReason === null) return;
      reason = enteredReason.trim();
      if (!reason) {
        setError("Enter a reason to dismiss this finding.");
        return;
      }
    }
    setBusyId(id);
    setError(null);
    try {
      await api.reviewFinding(id, status, reason);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Finding update failed.");
    } finally {
      setBusyId(null);
    }
  }
  const ordered = [...findings].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.severity] - rank[b.severity] || a.status.localeCompare(b.status);
  });
  return <section className="panel">
    <div className="panel-heading"><div><h3>Validation findings</h3><p>Explainable checks generated from synthetic rules.</p></div><span className="record-count">{findings.filter((finding) => finding.status === "open").length} open</span></div>
    {error && <div className="inline-error"><AlertCircle size={15} />{error}</div>}
    <div className="finding-list">
      {ordered.map((finding) => <article className={`finding-card finding-${finding.severity}`} key={finding.id}>
        <div className="finding-title"><span className={`severity-tag severity-${finding.severity}`}>{finding.severity}</span><span className="finding-category">{humanize(finding.category)}</span><span className={`finding-status status-text-${finding.status}`}>{humanize(finding.status)}</span></div>
        <strong>{finding.message}</strong>
        <span className="finding-rule">{finding.rule_id}</span>
        {(finding.expected || finding.actual) && <div className="finding-evidence">{finding.expected && <p><span>Expected</span>{finding.expected}</p>}{finding.actual && <p><span>Observed</span>{finding.actual}</p>}</div>}
        {typeof finding.details.clause_reference === "string" && <p className="finding-rule">Regulatory reference: {finding.details.clause_reference}{typeof finding.details.rule_version === "number" ? ` · Rule version ${finding.details.rule_version}` : ""}</p>}
        {typeof finding.details.source === "string" && <p className="finding-rule">Source: {finding.details.source}</p>}
        {canResolve && finding.status === "open" && <div className="finding-actions"><button className="button button-secondary compact" disabled={busyId === finding.id} onClick={() => void setStatus(finding.id, "resolved")}><Check size={14} /> Resolve</button><button className="text-button" disabled={busyId === finding.id} onClick={() => void setStatus(finding.id, "dismissed")}>Dismiss with reason</button></div>}
      </article>)}
      {findings.length === 0 && <div className="section-empty"><CheckCircle2 size={21} /><strong>No findings generated</strong><span>No rule flags are available for this application yet.</span></div>}
    </div>
  </section>;
}

function DecisionSection({ review, blockers, canDecide, canRequestCorrections, onDecided }: { review: ApplicationReview; blockers: string[] | null; canDecide: boolean; canRequestCorrections: boolean; onDecided: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const application = review.application;
  const finalized = application.status === "approved" || application.status === "rejected";
  const reasons = blockers ?? [];
  const matchSummary = review.match_summary;
  const canOverrideBlockers = canDecide
    && blockers !== null
    && !blockers.some((reason) => reason.includes("still processing."));

  async function decide(decision: "approve" | "reject") {
    if (decision === "reject" && !note.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    const overrideBlockers = decision === "approve" && reasons.length > 0;
    const confirmation = decision === "approve" && overrideBlockers
      ? `Overall match score: ${matchSummary.score}% (recommendation threshold: above ${matchSummary.threshold}%).\n\nOverride ${reasons.length} approval blocker(s) and approve anyway? This override will be recorded in the audit trail.\n\n${reasons.join("\n")}`
      : `${decision === "approve" ? "Approve" : "Reject"} this application?`;
    if (!window.confirm(confirmation)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.decide(
        application.id,
        decision,
        note.trim(),
        overrideBlockers,
      );
      onDecided();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decision could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function requestCorrections() {
    if (note.trim().length < 8) {
      setError("Enter at least 8 characters describing the corrections required.");
      return;
    }
    if (!window.confirm("Return this application to the institution for corrections?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.requestCorrections(application.id, note.trim());
      onDecided();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Correction request could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel decision-panel">
    <div className="panel-heading"><div><h3>{canDecide ? "Officer decision" : "Request institution corrections"}</h3><p>{canDecide ? "Final decision is recorded in the audit trail." : "Return the submitted application to the institution with a clear correction request."}</p></div></div>
    <div className="decision-body">
      {canDecide && <MatchSummaryCard applicationId={application.id} matchSummary={matchSummary} />}
      {finalized ? <div className={`decision-record decision-${application.status}`}><span>{application.status === "approved" ? <CheckCircle2 size={19} /> : <XCircle size={19} />}</span><div><strong>Application {application.status}</strong><p>This case has a final decision and is read-only.</p></div></div> : <>
        <label className="decision-note">{canDecide ? "Decision note / correction reason" : "Correction request reason"} <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder="Required for rejection or correction requests" /></label>
        {canDecide && reasons.length > 0 && <div className="decision-checklist"><strong>Approval checklist</strong>{reasons.map((reason) => <p key={reason}><AlertCircle size={14} />{reason}</p>)}</div>}
        {error && <div className="inline-error"><AlertCircle size={15} />{error}</div>}
        <div className="decision-buttons">{canRequestCorrections && <button className="button button-secondary" disabled={busy || note.trim().length < 8} onClick={() => void requestCorrections()}>Request corrections</button>}{canDecide && <><button className="button button-reject" disabled={busy || !note.trim()} onClick={() => void decide("reject")}><XCircle size={15} /> Reject</button><button className="button button-primary" disabled={busy || !canOverrideBlockers} onClick={() => void decide("approve")}><CheckCircle2 size={15} /> {busy ? "Saving…" : "Approve"}</button></>}</div>
        {canDecide && <p className="decision-footnote">{reasons.length ? "Approval is available once active document processing finishes. Other blockers can be overridden after explicit confirmation; the override is recorded in the audit trail." : "Approval checks are clear. The final decision will be recorded in the audit trail."}</p>}
      </>}
    </div>
  </section>;
}

function ComplianceSummaryCard({ summary }: { summary: ApplicationReview["compliance_summary"] }) {
  return <section className="panel">
    <div className="panel-heading"><div><h3>Compliance score</h3><p>Explainable advisory score; a reviewer makes the final decision.</p></div></div>
    <div className="decision-body">
      <div className="compliance-score"><strong>{summary.score}%</strong><span>{humanize(summary.recommendation)} · approval threshold {summary.threshold}%</span></div>
      <div className="compliance-categories">{Object.entries(summary.categories).map(([name, score]) => <div key={name}><span>{humanize(name)}</span><strong>{score}%</strong></div>)}</div>
      {summary.missing_fields.length > 0 && <div className="decision-checklist"><strong>Fields not found</strong>{summary.missing_fields.map((field) => <p key={field}><AlertCircle size={14} />{humanize(field)}</p>)}</div>}
      {summary.missing_documents.length > 0 && <div className="decision-checklist"><strong>Required evidence not complete</strong>{summary.missing_documents.map((document) => <p key={document.document_type}><AlertCircle size={14} />{document.label}</p>)}</div>}
      {summary.failed_mandatory_rules.length > 0 && <div className="decision-checklist"><strong>Mandatory rule failures</strong>{summary.failed_mandatory_rules.map((failure) => <p key={failure.rule_id}><AlertCircle size={14} />{failure.message}</p>)}</div>}
      <div className="compliance-field-list"><strong>Metadata field comparisons</strong>{summary.field_scores.map((field) => <div key={field.field_name}><span>{humanize(field.field_name)} · {field.score}%</span><small>Expected: {field.expected_value ?? "Not specified"} · Extracted: {field.extracted_values.filter(Boolean).join(", ") || "Not found"}{field.sources.some((source) => source.page !== null) ? ` · page(s) ${field.sources.map((source) => source.page).filter((page): page is number => page !== null).join(", ")}` : ""}</small></div>)}</div>
      {summary.warnings.map((warning) => <p className="decision-footnote" key={warning}>{warning}</p>)}
    </div>
  </section>;
}

function MatchSummaryCard({
  applicationId,
  matchSummary,
}: {
  applicationId: string;
  matchSummary: ApplicationReview["match_summary"];
}) {
  const score = displayMatchScore(applicationId, matchSummary.score);
  return <div className={`match-score match-score-${matchSummary.recommendation}`}>
    <div className="match-score-heading">
      <div><span>Overall metadata match (TF-IDF)</span><strong>{score}%</strong></div>
      <span className="match-recommendation">Suggest {matchSummary.recommendation}</span>
    </div>
    <div className="match-score-track" role="progressbar" aria-label="Overall metadata match score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
      <span style={{ width: `${score}%` }} />
    </div>
    <p>{matchSummary.matched_fields} of {matchSummary.total_fields} metadata fields match. Institution-name similarity uses TF-IDF; identifiers and numeric values must match exactly. Score above {matchSummary.threshold}% suggests approval; otherwise review/rejection is suggested.</p>
    <small>Advisory only; an authorized reviewer makes the final decision.</small>
  </div>;
}

function ApplicationInfo({ application }: { application: ApplicationReview["application"] }) {
  return <section className="panel">
    <div className="panel-heading"><div><h3>Application details</h3><p>Applicant-declared information.</p></div></div>
    <dl className="info-list"><InfoRow label="Institution ID" value={application.institution_id} /><InfoRow label="Category" value={humanize(application.category)} /><InfoRow label="Academic year" value={application.academic_year} /><InfoRow label="Declared faculty" value={application.declared_faculty.toLocaleString()} /><InfoRow label="Declared students" value={application.declared_student_count.toLocaleString()} /><InfoRow label="Declared land area" value={`${application.declared_land_area.toLocaleString()} (reported units)`} /><InfoRow label="Received" value={formatDate(application.created_at)} /></dl>
  </section>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="info-row"><dt>{label}</dt><dd>{value}</dd></div>;
}

function FileCheck2Icon() {
  return <FileText size={21} />;
}
