import { humanize } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${status}`}><span />{humanize(status)}</span>;
}
