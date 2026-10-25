import { humanize } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const label = status === "pending_admin_review"
    ? "Pending scrutiny decision"
    : humanize(status);
  return <span className={`status-badge status-${status}`}><span />{label}</span>;
}
