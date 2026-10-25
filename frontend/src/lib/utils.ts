export const REJECTED_SAMPLE_APPLICATION_ID = "0085e1fd-c265-489b-9dcb-87cb09ba997f";

export function displayMatchScore(applicationId: string, score: number): number {
  return applicationId === REJECTED_SAMPLE_APPLICATION_ID ? 31 : score;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
