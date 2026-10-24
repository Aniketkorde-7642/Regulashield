"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="load-error" role="alert">
      <AlertCircle size={20} />
      <div>
        <strong>Something went wrong</strong>
        <p>The page could not be displayed. Your saved work has not been changed.</p>
        <button className="button button-secondary" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
