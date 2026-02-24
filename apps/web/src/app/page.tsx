"use client";

import { useEffect, useState } from "react";
import { parseJsonResponse } from "@/lib/api";

export default function HomePage() {
  const [status, setStatus] = useState<"loading" | "ok" | "api unreachable">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("api unreachable");
          return;
        }
        const health = await parseJsonResponse<{ ok: boolean }>(res);
        if (!cancelled) setStatus(health?.ok === true ? "ok" : "api unreachable");
      } catch {
        if (!cancelled) setStatus("api unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <p className="text-lg font-medium">{status === "loading" ? "…" : status}</p>
      <a href="/notebooks" className="text-slate-600 hover:text-slate-900 underline">
        Notebooks
      </a>
    </main>
  );
}
