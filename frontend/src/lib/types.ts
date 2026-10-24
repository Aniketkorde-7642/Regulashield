export interface User {
  username: string;
  display_name: string;
  role: string;
}

export type DemoCredentials = Record<string, string>;

export interface ManagedUser extends User {
  id: string;
  is_active: boolean;
  created_at: string;
}

export interface CreateUserPayload {
  username: string;
  display_name: string;
  role: "admin" | "officer" | "regulatory_officer" | "compliance_admin" | "institution";
  password: string;
}

export interface ApplicationSummary {
  id: string;
  application_number: string;
  institution_id: string;
  institution_name: string;
  category: string;
  academic_year: string;
  declared_faculty: number;
  declared_student_count: number;
  declared_land_area: number;
  status: string;
  document_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReviewQueueItem extends ApplicationSummary {
  priority_score: number;
  open_findings: number;
  high_findings: number;
  pending_fields: number;
  metadata_discrepancies: Array<{
    field_name: string;
    expected_value: string;
    extracted_value: string | null;
    match_percentage: number;
  }>;
  report: Array<{
    rule_id: string;
    severity: string;
    message: string;
    clause_reference: string | null;
    rule_version: number | null;
  }>;
}

export interface PreflightIssue {
  severity: "info" | "low" | "medium" | "high";
  message: string;
  field: string;
  action: string;
  clause_reference: string | null;
  source: string | null;
}

export interface ApplicationPreflight {
  academic_year: string;
  ready: boolean;
  issues: PreflightIssue[];
  rule_count: number;
  disclaimer: string;
}

export interface ComplianceRule {
  id: string;
  rule_key: string;
  version: number;
  academic_year: string;
  field: string;
  operator: string;
  threshold: number;
  severity: "low" | "medium" | "high";
  message: string;
  clause_reference: string | null;
  source_title: string;
  source_url: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

export interface ComplianceRulePayload {
  rule_key: string;
  academic_year: string;
  field: "declared_faculty" | "declared_student_count" | "declared_land_area";
  operator: ">=" | "<=" | "==" | ">" | "<";
  threshold: number;
  severity: "low" | "medium" | "high";
  message: string;
  clause_reference: string | null;
  source_title: string;
  source_url: string | null;
}

export interface RuleChange {
  id: string;
  payload: ComplianceRulePayload;
  status: "draft" | "pending" | "approved" | "rejected";
  source_verified: boolean;
  source_verified_by: string | null;
  source_verified_at: string | null;
  simulated_at: string | null;
  simulation_result: {
    passed: boolean;
    sample: RuleSimulation["sample"];
    findings: RuleSimulation["findings"];
  } | null;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  published_rule_id: string | null;
}

export interface RuleSimulation {
  rule_key: string;
  sample: {
    declared_faculty: number;
    declared_student_count: number;
    declared_land_area: number;
  };
  passed: boolean;
  findings: Array<{
    severity: string;
    message: string;
    expected: string;
    actual: string;
  }>;
  persisted: false;
  disclaimer: string;
}

export interface SecurityOverview {
  active_users: number;
  disabled_users: number;
  audit_integrity_ok: boolean;
  audit_events: number;
  recent_actions: Array<{
    actor: string;
    action: string;
    entity_type: string;
    created_at: string;
  }>;
}

export interface DocumentRecord {
  id: string;
  application_id: string;
  filename: string;
  document_type: string;
  file_hash: string;
  page_count: number;
  status: string;
  processing_error: string | null;
  created_at: string;
}

export interface FieldExtraction {
  id: string;
  document_id: string;
  field_name: string;
  extracted_value: string | null;
  normalized_value: string | null;
  confidence: number;
  label_match_score: number;
  expected_value: string | null;
  metadata_match_score: number | null;
  raw_ocr_text: string | null;
  requires_review: boolean;
  reviewed_value: string | null;
  review_action: "confirm" | "correct" | "flag" | null;
  source_page: number | null;
}

export interface Finding {
  id: string;
  document_id: string | null;
  rule_id: string;
  category: string;
  severity: "low" | "medium" | "high";
  message: string;
  expected: string | null;
  actual: string | null;
  status: "open" | "resolved" | "dismissed";
  details: Record<string, unknown>;
  created_at: string;
}

export interface ComplianceSummary {
  score: number;
  status: "needs_review" | "scored";
  recommendation: "needs_review" | "approve" | "reject";
  threshold: number;
  weights: Record<string, number>;
  categories: Record<string, number>;
  field_scores: Array<{
    field_name: string;
    expected_value: string | null;
    extracted_values: Array<string | null>;
    score: number;
    sources: Array<{ document_id: string | null; page: number | null }>;
  }>;
  missing_fields: string[];
  missing_documents: Array<{ document_type: string; label: string }>;
  failed_mandatory_rules: Array<{ rule_id: string; message: string; severity: string }>;
  warnings: string[];
}

export interface ApplicationReview {
  application: ApplicationSummary & {
    owner_username: string | null;
    decision_note?: string | null;
    decided_by?: string | null;
    decided_at?: string | null;
    documents: DocumentRecord[];
    findings: Finding[];
  };
  extractions: FieldExtraction[];
  findings: Finding[];
  match_summary: {
    score: number;
    matched_fields: number;
    total_fields: number;
    threshold: number;
    recommendation: "approve" | "reject";
  };
  compliance_summary: ComplianceSummary;
}

export interface ApplicationDecisionReport {
  application_number: string;
  institution_id: string;
  institution_name: string;
  category: string;
  academic_year: string;
  status: "approved" | "rejected";
  decision_note: string | null;
  decided_by: string;
  decided_at: string;
  match_summary: Record<string, number | string>;
  compliance_summary: ComplianceSummary;
  documents: DocumentRecord[];
  findings: Finding[];
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  previous_hash: string;
  entry_hash: string;
  created_at: string;
}

export interface AuditResponse {
  integrity_ok: boolean | null;
  entries: AuditEntry[];
}

export interface DashboardStats {
  applications: number;
  in_review: number;
  documents: number;
  open_findings: number;
  users: number;
}
