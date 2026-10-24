const state = { token: localStorage.getItem("regula-token"), user: null, currentApplication: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function notify(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3400);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { ...options, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status === 401 && path !== "/auth/login") {
    signOut();
    throw new Error("Your session expired. Please sign in again.");
  }
  if (!response.ok) {
    const detail = body?.detail;
    throw new Error(Array.isArray(detail) ? detail.map((item) => item.msg).join("; ") : detail || "Request failed.");
  }
  return body;
}

function signOut() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("regula-token");
  $("#app-shell").hidden = true;
  $("#login-screen").hidden = false;
}

function setView(view) {
  $("#applications-view").hidden = view !== "applications";
  $("#audit-view").hidden = view !== "audit";
  $("#detail-view").hidden = view !== "detail";
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.nav === view));
  $("#page-title").textContent = view === "audit" ? "Audit trail" : view === "detail" ? "Application review" : "Applications";
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function statusClass(value) {
  return `status-${String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
}

async function showWorkspace(user) {
  state.user = user;
  $("#user-label").textContent = `${user.display_name} · ${user.role}`;
  $("#user-avatar").textContent = (user.display_name || user.username).slice(0, 1).toUpperCase();
  $("#login-screen").hidden = true;
  $("#app-shell").hidden = false;
  await loadApplications();
}

async function loadDashboard() {
  const stats = await api("/dashboard");
  $("#stat-applications").textContent = stats.applications;
  $("#stat-review").textContent = stats.in_review;
  $("#stat-documents").textContent = stats.documents;
  $("#stat-findings").textContent = stats.open_findings;
}

async function loadApplications() {
  const [applications, stats] = await Promise.all([api("/applications"), api("/dashboard")]);
  $("#stat-applications").textContent = stats.applications;
  $("#stat-review").textContent = stats.in_review;
  $("#stat-documents").textContent = stats.documents;
  $("#stat-findings").textContent = stats.open_findings;
  $("#empty-applications").hidden = applications.length !== 0;
  $("#application-rows").innerHTML = applications.map((application) => `
    <tr>
      <td><strong>${escapeHtml(application.application_number)}</strong><span class="secondary-text">${escapeHtml(application.institution_id)}</span></td>
      <td>${escapeHtml(application.institution_name)}</td>
      <td>${escapeHtml(application.academic_year)}</td>
      <td>${escapeHtml(application.document_count)}</td>
      <td><span class="status-pill ${statusClass(application.status)}">${escapeHtml(application.status.replaceAll("_", " "))}</span></td>
      <td><button class="button ghost small row-link" data-action="open-application" data-id="${escapeHtml(application.id)}">Review →</button></td>
    </tr>`).join("");
  setView("applications");
}

function renderFacts(application) {
  return `
    <div class="application-facts">
      ${fact("Institution", application.institution_name)}
      ${fact("Application number", application.application_number)}
      ${fact("Institution ID", application.institution_id)}
      ${fact("Category", application.category)}
      ${fact("Academic year", application.academic_year)}
      ${fact("Declared faculty", application.declared_faculty)}
      ${fact("Declared students", application.declared_student_count)}
      ${fact("Land area", `${application.declared_land_area} acres`)}
      ${fact("Created", formatDate(application.created_at))}
    </div>`;
}

function fact(label, value) {
  return `<div><p class="fact-label">${escapeHtml(label)}</p><div class="fact-value">${escapeHtml(value)}</div></div>`;
}

function renderDocuments(documents) {
  if (!documents.length) return '<p class="muted">No evidence uploaded yet.</p>';
  return documents.map((document) => `
    <div class="document-row">
      <div class="file-icon">PDF</div>
      <div class="document-meta"><strong>${escapeHtml(document.filename)}</strong><small>${escapeHtml(document.document_type.replaceAll("_", " "))} · ${document.page_count} page(s)</small></div>
      <span class="status-pill ${statusClass(document.status)}">${escapeHtml(document.status)}</span>
      <button class="button ghost small" data-action="download-document" data-id="${escapeHtml(document.id)}" title="Download PDF">↓</button>
    </div>
    ${document.processing_error ? `<p class="error-text">${escapeHtml(document.processing_error)}</p>` : ""}`).join("");
}

function renderExtractions(extractions) {
  if (!extractions.length) return '<p class="muted">Fields appear when processing completes.</p>';
  return extractions.map((field) => {
    const shown = field.reviewed_value ?? field.extracted_value ?? "";
    const pending = field.requires_review;
    return `
      <div class="field-row">
        <div class="field-title"><span>${escapeHtml(field.field_name.replaceAll("_", " "))}</span><span class="confidence">${Math.round(field.confidence * 100)}% confidence${pending ? " · review needed" : ""}</span></div>
        <div class="field-value"><input id="correct-${escapeHtml(field.id)}" value="${escapeHtml(shown)}" placeholder="No value extracted" aria-label="Reviewed ${escapeHtml(field.field_name)}"></div>
        <div class="field-actions">
          <button class="button secondary" data-action="field-confirm" data-id="${escapeHtml(field.id)}">${field.extracted_value == null ? "Confirm absent" : "Confirm"}</button>
          <button class="button secondary" data-action="field-correct" data-id="${escapeHtml(field.id)}">Save correction</button>
          <button class="button ghost" data-action="field-flag" data-id="${escapeHtml(field.id)}">Flag</button>
        </div>
        ${field.raw_ocr_text ? `<p class="tiny-note">Source text: ${escapeHtml(field.raw_ocr_text)}</p>` : ""}
      </div>`;
  }).join("");
}

function renderFindings(findings) {
  if (!findings.length) return '<p class="muted">No findings have been generated.</p>';
  return findings.map((finding) => `
    <article class="finding ${escapeHtml(finding.severity)}">
      <div class="finding-top"><span class="severity severity-${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span><span class="confidence">${escapeHtml(finding.status)}</span></div>
      <p>${escapeHtml(finding.message)}</p>
      ${finding.actual ? `<small>Observed: ${escapeHtml(finding.actual)}</small>` : ""}
      ${finding.status === "open" ? `<div class="finding-actions"><button class="button secondary" data-action="finding-resolve" data-id="${escapeHtml(finding.id)}">Resolve</button><button class="button ghost" data-action="finding-dismiss" data-id="${escapeHtml(finding.id)}">Dismiss</button></div>` : ""}
    </article>`).join("");
}

function renderDetail(payload) {
  const application = payload.application;
  state.currentApplication = application.id;
  $("#detail-status").className = `status-pill ${statusClass(application.status)}`;
  $("#detail-status").textContent = application.status.replaceAll("_", " ");
  const finalized = ["approved", "rejected"].includes(application.status);
  $("#application-detail").innerHTML = `
    <div class="detail-grid">
      <div class="detail-stack">
        <section class="detail-card"><div class="detail-card-head"><div><h2>Application overview</h2><p>Declared application information</p></div></div><div class="detail-card-body">${renderFacts(application)}</div></section>
        <section class="detail-card"><div class="detail-card-head"><div><h2>Evidence documents</h2><p>PDFs are processed in the background and retained locally.</p></div></div>
          <div class="detail-card-body"><form id="upload-form" class="upload-box">
            <label>Document type<select name="document_type" required><option value="affiliation_letter">Affiliation letter</option><option value="faculty_certificate">Faculty certificate</option><option value="land_record">Land record</option><option value="fire_safety">Fire safety</option><option value="other">Other</option></select></label>
            <label>PDF file<input name="file" type="file" accept="application/pdf,.pdf" required></label>
            <button class="button secondary" type="submit" ${finalized ? "disabled" : ""}>↑ Upload and process</button>
          </form><div style="margin-top:16px">${renderDocuments(application.documents)}</div></div>
        </section>
        <section class="detail-card"><div class="detail-card-head"><div><h2>Extracted fields</h2><p>Confirm, correct, or flag each candidate value.</p></div></div><div class="detail-card-body">${renderExtractions(payload.extractions)}</div></section>
      </div>
      <div class="detail-stack">
        <section class="detail-card"><div class="detail-card-head"><div><h2>Validation findings</h2><p>Rule checks are synthetic, explainable signals.</p></div></div><div class="detail-card-body">${renderFindings(payload.findings)}</div></section>
        <section class="detail-card"><div class="detail-card-head"><div><h2>Officer decision</h2><p>Approval requires completed processing and resolved high findings.</p></div></div><div class="detail-card-body">
          ${finalized ? `<p class="muted">Decision recorded: <strong>${escapeHtml(application.status)}</strong>${application.decided_by ? ` by ${escapeHtml(application.decided_by)}` : ""}</p><p class="muted">${escapeHtml(application.decision_note || "No decision note.")}</p>` : `<form id="decision-form" class="decision-box"><textarea name="note" maxlength="2000" placeholder="Decision note (optional)"></textarea><div class="decision-actions"><button class="button primary" name="decision" value="approve">Approve</button><button class="button reject" name="decision" value="reject">Reject</button></div></form>`}
        </div></section>
      </div>
    </div>`;
  setView("detail");
  $("#upload-form")?.addEventListener("submit", uploadDocument);
  $("#decision-form")?.addEventListener("submit", makeDecision);
}

async function openApplication(id) {
  const payload = await api(`/applications/${encodeURIComponent(id)}/review`);
  renderDetail(payload);
}

async function uploadDocument(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api(`/applications/${encodeURIComponent(state.currentApplication)}/documents`, { method: "POST", body: data });
    notify("PDF uploaded. Processing is underway.");
    await openApplication(state.currentApplication);
    setTimeout(() => openApplication(state.currentApplication).catch(() => {}), 1200);
  } catch (error) { notify(error.message, true); }
}

async function makeDecision(event) {
  event.preventDefault();
  const submitter = event.submitter;
  const decision = submitter?.value;
  if (!decision || !confirm(`${decision === "approve" ? "Approve" : "Reject"} this application?`)) return;
  const note = new FormData(event.currentTarget).get("note");
  try {
    await api(`/applications/${encodeURIComponent(state.currentApplication)}/decision`, {
      method: "POST", body: JSON.stringify({ decision, note: note || null }),
    });
    notify(`Application ${decision === "approve" ? "approved" : "rejected"}.`);
    await openApplication(state.currentApplication);
  } catch (error) { notify(error.message, true); }
}

async function loadAudit() {
  const result = await api("/audit?limit=200");
  const integrity = $("#audit-integrity");
  integrity.className = `integrity ${result.integrity_ok ? "ok" : "bad"}`;
  integrity.textContent = result.integrity_ok ? "✓ Hash chain verified" : "⚠ Hash chain integrity check failed";
  $("#audit-entries").innerHTML = result.entries.length ? result.entries.slice().reverse().map((entry) => `
    <div class="timeline-entry"><strong>${escapeHtml(entry.action.replaceAll(".", " "))}</strong><p>${escapeHtml(entry.actor)} · ${escapeHtml(entry.entity_type)} · ${escapeHtml(entry.entity_id)}</p><small>${escapeHtml(new Date(entry.created_at).toLocaleString())} · ${escapeHtml(entry.entry_hash.slice(0, 16))}…</small></div>`).join("") : '<p class="muted">No audit events recorded.</p>';
  setView("audit");
}

async function handleClick(event) {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    try {
      if (nav.dataset.nav === "audit") await loadAudit();
      else await loadApplications();
    } catch (error) { notify(error.message, true); }
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === "new-application") $("#application-dialog").showModal();
    if (action === "open-application") await openApplication(id);
    if (action === "refresh-application") await openApplication(state.currentApplication);
    if (action === "field-confirm" || action === "field-correct" || action === "field-flag") {
      const actionName = action.split("-")[1];
      const corrected = $(`#correct-${CSS.escape(id)}`).value;
      await api(`/extractions/${encodeURIComponent(id)}/review`, {
        method: "POST",
        body: JSON.stringify({ action: actionName, corrected_value: actionName === "correct" || actionName === "flag" ? corrected : null }),
      });
      notify("Field review saved.");
      await openApplication(state.currentApplication);
    }
    if (action === "finding-resolve" || action === "finding-dismiss") {
      const nextStatus = action.endsWith("resolve") ? "resolved" : "dismissed";
      await api(`/findings/${encodeURIComponent(id)}/review`, { method: "POST", body: JSON.stringify({ status: nextStatus }) });
      notify("Finding status updated.");
      await openApplication(state.currentApplication);
    }
    if (action === "download-document") {
      const response = await fetch(`/api/applications/documents/${encodeURIComponent(id)}/file`, { headers: { Authorization: `Bearer ${state.token}` } });
      if (!response.ok) throw new Error("Unable to download this PDF.");
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "evidence.pdf";
      link.click();
      URL.revokeObjectURL(blobUrl);
    }
  } catch (error) { notify(error.message, true); }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").hidden = true;
  const form = new FormData(event.currentTarget);
  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    state.token = result.access_token;
    localStorage.setItem("regula-token", state.token);
    await showWorkspace(result.user);
  } catch (error) {
    $("#login-error").textContent = error.message;
    $("#login-error").hidden = false;
  }
});

$("#application-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  values.declared_faculty = Number(values.declared_faculty);
  values.declared_student_count = Number(values.declared_student_count);
  values.declared_land_area = Number(values.declared_land_area);
  try {
    const application = await api("/applications", { method: "POST", body: JSON.stringify(values) });
    $("#application-dialog").close();
    event.currentTarget.reset();
    notify("Application created.");
    await openApplication(application.id);
  } catch (error) { notify(error.message, true); }
});

$("#new-application-button").addEventListener("click", () => $("#application-dialog").showModal());
$("#back-button").addEventListener("click", () => loadApplications().catch((error) => notify(error.message, true)));
$("#logout-button").addEventListener("click", signOut);
$("#refresh-audit").addEventListener("click", () => loadAudit().catch((error) => notify(error.message, true)));
$$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $("#application-dialog").close()));
document.addEventListener("click", handleClick);

if (state.token) {
  api("/auth/me").then(showWorkspace).catch(() => signOut());
}
