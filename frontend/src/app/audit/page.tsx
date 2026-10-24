"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, FileClock, RefreshCw, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { AuditResponse } from "@/lib/types";
import { formatDate, humanize } from "@/lib/utils";

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await api.audit());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the audit trail.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <>
    <section className="welcome-row">
      <div><p className="eyebrow">TRACEABILITY</p><h2>Audit trail</h2><p>Review recorded actions and verify the linked event hashes.</p></div>
      <button className="button button-secondary" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh</button>
    </section>
    {error && <div className="alert alert-error"><AlertCircle size={17} />{error}<button onClick={() => void load(true)}>Retry</button></div>}
    {data && <div className={`integrity-banner ${data.integrity_ok === null ? "integrity-unknown" : data.integrity_ok ? "integrity-ok" : "integrity-failed"}`}>
      {data.integrity_ok ? <CheckCircle2 size={19} /> : <ShieldAlert size={19} />}
      <div><strong>{data.integrity_ok === null ? "Audit chain not verified" : data.integrity_ok ? "Audit chain verified" : "Audit chain integrity check failed"}</strong><span>{data.integrity_ok === null ? "Integrity is not available for this filtered event set." : data.integrity_ok ? "All returned audit events link to the expected SHA-256 digest." : "The audit event sequence may be incomplete or modified."}</span></div>
      <code>{data.entries.length} events</code>
    </div>}
    <section className="panel audit-panel">
      <div className="panel-heading"><div><h3>Recorded events</h3><p>Most recent 200 events are shown, newest first.</p></div><span className="record-count">{data?.entries.length ?? 0} events</span></div>
      {loading ? <div className="table-state"><span className="spinner" /> Loading audit trail…</div> : <div className="audit-list">
        {data?.entries.slice().reverse().map((entry) => <article className="audit-event" key={entry.id}>
          <span className="audit-event-icon"><FileClock size={17} /></span>
          <div className="audit-event-main"><div className="audit-event-title"><strong>{humanize(entry.action.replaceAll(".", " "))}</strong><span>{formatDate(entry.created_at)}</span></div><p><b>{entry.actor}</b> <span>performed this action on {humanize(entry.entity_type)} <code>{entry.entity_id}</code></span></p>
            {Object.keys(entry.details).length > 0 && <details><summary>Event details</summary><pre>{JSON.stringify(entry.details, null, 2)}</pre></details>}
            <div className="hash-row"><span>Event hash</span><code title={entry.entry_hash}>{entry.entry_hash}</code><span>Previous</span><code title={entry.previous_hash}>{entry.previous_hash}</code></div>
          </div>
        </article>)}
        {!data?.entries.length && <div className="empty-state"><div className="empty-icon"><FileClock size={22} /></div><h3>No audit events yet</h3><p>Application, document, and review activity will appear here.</p></div>}
      </div>}
    </section>
    <div className="notice"><ShieldAlert size={17} /><span>This hash-linked audit view helps detect changes; it does not replace external immutable backups or compliance controls.</span></div>
  </>;
}
