import { AlertCircle, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#09090b] text-[#f4f4f5] font-sans antialiased px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#111114] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0" strokeWidth={1.5} />
          <h1 className="text-[18px] font-medium tracking-[-0.01em] text-[#f4f4f5] tabular-nums">
            404 — Page not found
          </h1>
        </div>

        <p className="text-[14px] leading-[1.6] text-[#a1a1aa] [text-wrap:pretty]">
          The route you requested does not exist in RepoForge.
        </p>

        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#f4f4f5] text-[#09090b] text-[14px] font-medium hover:bg-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            Back to workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
