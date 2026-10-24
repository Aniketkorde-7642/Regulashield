import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="load-error">
      <FileQuestion size={20} />
      <div>
        <strong>Page not found</strong>
        <p>This page may have moved or the address may be incorrect.</p>
        <Link className="button button-secondary" href="/"><ArrowLeft size={15} /> Return to applications</Link>
      </div>
    </main>
  );
}
