import { uploadPresigned } from "@vercel/blob/client";
import type {
  ApplicationReview,
  ApplicationDecisionReport,
  ApplicationSummary,
  AuditResponse,
  ApplicationPreflight,
  ComplianceRule,
  ComplianceRulePayload,
  DashboardStats,
  CreateUserPayload,
  DemoCredentials,
  DocumentRecord,
  FieldExtraction,
  Finding,
  ManagedUser,
  ReviewQueueItem,
  RuleChange,
  RuleSimulation,
  SecurityOverview,
  User,
} from "@/lib/types";

const API_BASE = process.env.NODE_ENV === "development" ? "/api/backend" : "/api";
const TOKEN_KEY = "regula-token";

function getToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const result: unknown = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail =
      typeof result === "object" && result !== null && "detail" in result
        ? (result as { detail: unknown }).detail
        : result;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item) => (typeof item === "object" && item && "msg" in item ? item.msg : item)).join("; ")
          : typeof detail === "object" && detail !== null && "message" in detail && typeof detail.message === "string"
            ? detail.message
          : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return result as T;
}

export const api = {
  demoCredentials: () => request<DemoCredentials>("/auth/demo-credentials"),
  login: (username: string, password: string) =>
    request<{ access_token: string; token_type: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  registerInstitution: (username: string, displayName: string, password: string) =>
    request<{ access_token: string; token_type: string; user: User }>("/auth/register/institution", {
      method: "POST",
      body: JSON.stringify({ username, display_name: displayName, password }),
    }),
  me: () => request<User>("/auth/me"),
  dashboard: () => request<DashboardStats>("/dashboard"),
  securityOverview: () => request<SecurityOverview>("/security/overview"),
  reviewQueue: () => request<ReviewQueueItem[]>("/review/queue"),
  validateApplication: (payload: {
    application_number: string;
    institution_id: string;
    institution_name: string;
    category: string;
    academic_year: string;
    declared_faculty: number;
    declared_student_count: number;
    declared_land_area: number;
  }) =>
    request<ApplicationPreflight>("/applications/validate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listRules: (academicYear?: string, includeHistory = false) => {
    const params = new URLSearchParams({ include_history: String(includeHistory) });
    if (academicYear) params.set("academic_year", academicYear);
    return request<ComplianceRule[]>(`/compliance/rules?${params.toString()}`);
  },
  listRuleChanges: (status?: RuleChange["status"]) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    return request<RuleChange[]>(`/compliance/rules/changes?${params.toString()}`);
  },
  createRuleDraft: (payload: ComplianceRulePayload) =>
    request<RuleChange>("/compliance/rules", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateRuleDraft: (changeId: string, payload: ComplianceRulePayload) =>
    request<RuleChange>(`/compliance/rules/changes/${encodeURIComponent(changeId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  verifyRuleSource: (changeId: string) =>
    request<RuleChange>(`/compliance/rules/changes/${encodeURIComponent(changeId)}/verify-source`, {
      method: "POST",
      body: JSON.stringify({ confirmed: true }),
    }),
  simulateRuleDraft: (changeId: string, sample: RuleSimulation["sample"]) =>
    request<RuleSimulation>(`/compliance/rules/changes/${encodeURIComponent(changeId)}/simulate`, {
      method: "POST",
      body: JSON.stringify(sample),
    }),
  submitRuleDraft: (changeId: string) =>
    request<RuleChange>(`/compliance/rules/changes/${encodeURIComponent(changeId)}/submit`, {
      method: "POST",
    }),
  reviewRuleChange: (changeId: string, decision: "approve" | "reject", note?: string) =>
    request<RuleChange>(`/compliance/rules/changes/${encodeURIComponent(changeId)}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }),
  deactivateRule: (ruleKey: string, academicYear: string) =>
    request<ComplianceRule>(
      `/compliance/rules/${encodeURIComponent(ruleKey)}/deactivate?academic_year=${encodeURIComponent(academicYear)}`,
      { method: "POST" },
    ),
  listUsers: () => request<ManagedUser[]>("/users"),
  createUser: (payload: CreateUserPayload) =>
    request<ManagedUser>("/users", { method: "POST", body: JSON.stringify(payload) }),
  updateUser: (
    userId: string,
    changes: Partial<Pick<ManagedUser, "display_name" | "role" | "is_active">> & { password?: string },
  ) =>
    request<ManagedUser>(`/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  listApplications: () => request<ApplicationSummary[]>("/applications"),
  updateApplication: (
    applicationId: string,
    changes: Partial<Pick<
      ApplicationSummary,
      | "institution_id"
      | "institution_name"
      | "category"
      | "academic_year"
      | "declared_faculty"
      | "declared_student_count"
      | "declared_land_area"
    >>,
  ) =>
    request<ApplicationSummary>(`/applications/${encodeURIComponent(applicationId)}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  resubmitApplication: (applicationId: string) =>
    request<ApplicationSummary>(`/applications/${encodeURIComponent(applicationId)}/resubmissions`, {
      method: "POST",
    }),
  submitApplication: (applicationId: string) =>
    request<ApplicationSummary>(`/applications/${encodeURIComponent(applicationId)}/submit`, {
      method: "POST",
    }),
  decisionReport: (applicationId: string) =>
    request<ApplicationDecisionReport>(`/applications/${encodeURIComponent(applicationId)}/decision-report`),
  createApplication: (payload: {
    application_number: string;
    institution_id: string;
    institution_name: string;
    category: string;
    academic_year: string;
    declared_faculty: number;
    declared_student_count: number;
    declared_land_area: number;
  }) =>
    request<ApplicationSummary>("/applications", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  review: (applicationId: string) =>
    request<ApplicationReview>(`/applications/${encodeURIComponent(applicationId)}/review`),
  blockers: (applicationId: string) =>
    request<{ blockers: string[] }>(`/applications/${encodeURIComponent(applicationId)}/blockers`),
  uploadDocument: async (applicationId: string, documentType: string, file: File) => {
    if (process.env.NEXT_PUBLIC_BLOB_UPLOADS === "true") {
      const token = getToken();
      if (!token) throw new Error("Sign in before uploading evidence.");
      const pathname = `evidence/${applicationId}/${crypto.randomUUID()}.pdf`;
      const clientPayload = JSON.stringify({ applicationId, documentType });
      const uploadEvent = {
        type: "blob.generate-presigned-url",
        payload: { pathname, clientPayload, multipart: false },
      };
      let blob: Awaited<ReturnType<typeof uploadPresigned>>;
      try {
        blob = await uploadPresigned(pathname, file, {
          access: "private",
          contentType: "application/pdf",
          handleUploadUrl: "/blob-upload",
          headers: { Authorization: `Bearer ${token}` },
          clientPayload,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Failed to retrieve the presigned URL")) {
          const response = await fetch("/blob-upload", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(uploadEvent),
            cache: "no-store",
          });
          let result: unknown;
          try {
            result = await response.json();
          } catch {
            result = null;
          }
          if (!response.ok) {
            const message =
              typeof result === "object"
              && result !== null
              && "error" in result
              && typeof result.error === "string"
                ? result.error
                : `Unable to authorize evidence upload (HTTP ${response.status}).`;
            throw new Error(message);
          }
        }
        throw error;
      }
      return api.registerBlobDocument(applicationId, blob.pathname, documentType, file.name);
    }
    const form = new FormData();
    form.append("file", file);
    form.append("document_type", documentType);
    return request<DocumentRecord>(`/applications/${encodeURIComponent(applicationId)}/documents`, {
      method: "POST",
      body: form,
    });
  },
  registerBlobDocument: (
    applicationId: string,
    storageKey: string,
    documentType: string,
    filename: string,
  ) =>
    request<DocumentRecord>(`/applications/${encodeURIComponent(applicationId)}/documents/from-blob`, {
      method: "POST",
      body: JSON.stringify({ storage_key: storageKey, document_type: documentType, filename }),
    }),
  retryDocument: (applicationId: string, documentId: string) =>
    request<DocumentRecord>(
      `/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(documentId)}/retry`,
      { method: "POST" },
    ),
  reviewField: (extractionId: string, action: "confirm" | "correct" | "flag", correctedValue?: string) =>
    request<FieldExtraction>(`/extractions/${encodeURIComponent(extractionId)}/review`, {
      method: "POST",
      body: JSON.stringify({ action, corrected_value: correctedValue ?? null }),
    }),
  reviewFinding: (findingId: string, status: "resolved" | "dismissed" | "open", reason?: string) =>
    request<Finding>(`/findings/${encodeURIComponent(findingId)}/review`, {
      method: "POST",
      body: JSON.stringify({ status, reason: reason ?? null }),
    }),
  decide: (
    applicationId: string,
    decision: "approve" | "reject",
    note?: string,
    overrideBlockers = false,
  ) =>
    request<ApplicationReview["application"]>(`/applications/${encodeURIComponent(applicationId)}/decision`, {
      method: "POST",
      body: JSON.stringify({
        decision,
        note: note ?? null,
        override_blockers: overrideBlockers,
      }),
    }),
  audit: (limit = 200) => request<AuditResponse>(`/audit?limit=${limit}`),
  downloadDocument: async (documentId: string) => {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(
      `${API_BASE}/applications/documents/${encodeURIComponent(documentId)}/file`,
      { headers },
    );
    if (!response.ok) throw new Error(`Unable to download PDF (${response.status}).`);
    return response.blob();
  },
};

export { TOKEN_KEY };
