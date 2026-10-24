"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import type { ApplicationPreflight } from "@/lib/types";

export function NewApplicationForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<ApplicationPreflight | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (event.key === "Escape" && !busyRef.current) onClose();
      if (event.key === "Tab" && focusable?.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      application_number: String(data.get("application_number")).trim(),
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
        const result = await api.validateApplication(payload);
        setPreflight(result);
        return;
      }
      await api.createApplication(payload);
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create the application.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="new-application-title">
        <div className="modal-heading"><div><p className="eyebrow">NEW INTAKE</p><h2 id="new-application-title">Create an application</h2><p>Enter the applicant’s declared details to start an evidence review.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <form onSubmit={submit} onInput={() => setPreflight(null)}>
          <div className="form-grid">
            <label>Application number<input name="application_number" placeholder="APP-2026-001" required maxLength={64} /></label>
            <label>Institution ID<input name="institution_id" placeholder="INST-001" required maxLength={64} /></label>
            <label className="span-two">Institution name<input name="institution_name" placeholder="Example Technical Institute" required maxLength={256} /></label>
            <label>Category<select name="category"><option>EOA</option><option>Extension</option><option>New program</option></select></label>
            <label>Academic year<input name="academic_year" defaultValue="2026-27" pattern="\d{4}-\d{2}" placeholder="2026-27" required /></label>
            <label>Declared faculty<input name="declared_faculty" type="number" min="0" max="100000" defaultValue="0" required /></label>
            <label>Declared students<input name="declared_student_count" type="number" min="0" max="10000000" defaultValue="0" required /></label>
            <label className="span-two">Declared land area<input name="declared_land_area" type="number" min="0" step="0.01" defaultValue="0" required /><small>Use the unit configured for your local review process.</small></label>
          </div>
          {preflight && <section className="preflight-results" aria-live="polite">
            <div className={`preflight-status ${preflight.ready ? "preflight-ready" : "preflight-review"}`}>
              <strong>{preflight.ready ? "Metadata pre-check complete" : "Review these items before submission"}</strong>
              <span>{preflight.rule_count} active rule(s) checked for academic year {preflight.academic_year}.</span>
            </div>
            <ul>
              {preflight.issues.map((issue, index) => <li key={`${issue.field}-${index}`}>
                <strong>{issue.message}</strong>
                <span>{issue.action}</span>
                {issue.clause_reference && <small>Reference: {issue.clause_reference}</small>}
              </li>)}
            </ul>
            <small>{preflight.disclaimer}</small>
          </section>}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? (preflight ? "Creating…" : "Checking…") : preflight ? "Create draft and continue" : "Run pre-submission checks"}</button></div>
        </form>
      </section>
    </div>
  );
}
