import React, { useState } from "react";
import { MotionConfig, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Github,
  Lock,
  Globe,
  ShieldCheck,
  Terminal,
} from "lucide-react";

interface LandingPageProps {
  onLaunchApp: () => void;
}

const EASE_OUT = [0.2, 0, 0, 1] as const;

const PREVIEW_PROJECTS = [
  {
    id: "portfolio-web",
    name: "portfolio-web",
    framework: "Next.js",
    language: "TypeScript",
    filesCount: 24,
    size: "1.4 MB",
    visibility: "public" as const,
    license: "MIT",
    topics: ["nextjs", "typescript", "react"],
    files: [
      { name: "next.config.ts", size: "412 B", type: "file" },
      { name: "package.json", size: "1.2 KB", type: "file" },
      { name: "src/app/page.tsx", size: "3.8 KB", type: "file" },
      { name: "README.md", size: "1.9 KB", type: "generated" },
    ],
  },
  {
    id: "billing-api",
    name: "billing-api",
    framework: "Node.js",
    language: "JavaScript",
    filesCount: 18,
    size: "820 KB",
    visibility: "private" as const,
    license: "Apache-2.0",
    topics: ["nodejs", "express", "api"],
    files: [
      { name: "package.json", size: "980 B", type: "file" },
      { name: "src/server.js", size: "2.4 KB", type: "file" },
      { name: "src/routes/webhooks.js", size: "4.1 KB", type: "file" },
      { name: ".gitignore", size: "310 B", type: "generated" },
    ],
  },
  {
    id: "data-pipeline",
    name: "data-pipeline",
    framework: "Python",
    language: "Python",
    filesCount: 11,
    size: "410 KB",
    visibility: "private" as const,
    license: "MIT",
    topics: ["python", "etl"],
    files: [
      { name: "requirements.txt", size: "245 B", type: "file" },
      { name: "pipeline/run.py", size: "3.1 KB", type: "file" },
      { name: "LICENSE", size: "1.1 KB", type: "generated" },
    ],
  },
];

function InteractiveHeroPreview({ onLaunchApp }: { onLaunchApp: () => void }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([
    "portfolio-web",
    "billing-api",
  ]);
  const [activeId, setActiveId] = useState<string>("portfolio-web");
  const [visibilities, setVisibilities] = useState<Record<string, "public" | "private">>({
    "portfolio-web": "public",
    "billing-api": "private",
    "data-pipeline": "private",
  });

  const activeProject =
    PREVIEW_PROJECTS.find((p) => p.id === activeId) ?? PREVIEW_PROJECTS[0];

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleVisibility = (id: string) => {
    setVisibilities((prev) => ({
      ...prev,
      [id]: prev[id] === "public" ? "private" : "public",
    }));
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#111114] overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#141418]">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="w-4 h-4 text-[#a1a1aa] shrink-0" strokeWidth={1.5} />
          <span className="font-mono text-[13px] text-[#f4f4f5] truncate">
            client-handover-2026.zip
          </span>
          <span className="font-mono text-[12px] text-[#71717a] tabular-nums shrink-0">
            53 files · 2.6 MB
          </span>
        </div>
        <span className="font-mono text-[12px] text-[#a1a1aa] tabular-nums shrink-0">
          {selectedIds.length} selected
        </span>
      </div>

      {/* Split inspector body */}
      <div className="grid grid-cols-1 sm:grid-cols-12 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]">
        {/* Left: Project folder list */}
        <div className="sm:col-span-5 p-3 space-y-1">
          <div className="px-2 py-1.5 text-[12px] text-[#71717a] font-medium">
            Detected projects
          </div>
          {PREVIEW_PROJECTS.map((proj) => {
            const isSelected = selectedIds.includes(proj.id);
            const isActive = activeId === proj.id;
            const vis = visibilities[proj.id];

            return (
              <div
                key={proj.id}
                onClick={() => setActiveId(proj.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveId(proj.id);
                  }
                }}
                className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-[background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] ${
                  isActive
                    ? "bg-white/[0.06] text-[#f4f4f5]"
                    : "text-[#a1a1aa] hover:bg-white/[0.03] hover:text-[#f4f4f5]"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    aria-label={`Select ${proj.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(proj.id);
                    }}
                    className={`w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0 transition-[background-color,border-color] duration-150 ${
                      isSelected
                        ? "bg-[#8b5cf6] border-[#8b5cf6] text-white"
                        : "border-white/20 bg-transparent hover:border-white/40"
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3" strokeWidth={2.5} />}
                  </button>
                  <Folder className="w-4 h-4 text-[#71717a] shrink-0" strokeWidth={1.5} />
                  <span className="font-mono text-[13px] truncate">{proj.name}</span>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleVisibility(proj.id);
                  }}
                  title="Toggle visibility"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/[0.08] bg-white/[0.03] text-[11px] font-mono text-[#a1a1aa] hover:text-[#f4f4f5] hover:border-white/20 transition-[color,border-color] duration-150 shrink-0"
                >
                  {vis === "private" ? (
                    <Lock className="w-3 h-3" strokeWidth={1.5} />
                  ) : (
                    <Globe className="w-3 h-3" strokeWidth={1.5} />
                  )}
                  {vis}
                </button>
              </div>
            );
          })}
        </div>

        {/* Right: Active project details & file preview */}
        <div className="sm:col-span-7 p-4 flex flex-col justify-between bg-[#0d0d10]">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[14px] text-[#f4f4f5] font-medium">
                  {activeProject.name}
                </div>
                <div className="text-[12px] text-[#71717a] mt-0.5 font-mono tabular-nums">
                  {activeProject.framework} · {activeProject.filesCount} files · {activeProject.size}
                </div>
              </div>
              <span className="font-mono text-[11px] px-2 py-0.5 rounded-md border border-white/[0.08] bg-white/[0.03] text-[#a1a1aa]">
                {activeProject.license}
              </span>
            </div>

            {/* File list */}
            <div className="rounded-lg border border-white/[0.06] bg-[#111114] divide-y divide-white/[0.04]">
              {activeProject.files.map((file) => (
                <div
                  key={file.name}
                  className="flex items-center justify-between px-3 py-2 text-[12px] font-mono"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {file.type === "generated" ? (
                      <FileText className="w-3.5 h-3.5 text-[#8b5cf6] shrink-0" strokeWidth={1.5} />
                    ) : (
                      <FileCode2 className="w-3.5 h-3.5 text-[#71717a] shrink-0" strokeWidth={1.5} />
                    )}
                    <span className="text-[#d4d4d8] truncate">{file.name}</span>
                    {file.type === "generated" && (
                      <span className="text-[11px] text-[#8b5cf6] shrink-0">auto</span>
                    )}
                  </div>
                  <span className="text-[#71717a] tabular-nums shrink-0">{file.size}</span>
                </div>
              ))}
            </div>

            {/* Auto topics */}
            <div className="flex flex-wrap gap-1.5">
              {activeProject.topics.map((topic) => (
                <span
                  key={topic}
                  className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[#a1a1aa]"
                >
                  {topic}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-5 pt-3 border-t border-white/[0.06] flex items-center justify-between">
            <span className="text-[12px] text-[#71717a] font-mono">
              Ready via GitHub REST API
            </span>
            <button
              type="button"
              onClick={onLaunchApp}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f4f4f5] text-[#09090b] text-[13px] font-medium hover:bg-white enabled:active:scale-[0.96] transition-[background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
            >
              Forge {selectedIds.length} {selectedIds.length === 1 ? "repo" : "repos"}
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage({ onLaunchApp }: LandingPageProps) {
  const [copiedCmd, setCopiedCmd] = useState(false);

  const handleCopyCmd = () => {
    navigator.clipboard.writeText("git clone https://github.com/icefvg/Repo-Creator-Tool");
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] font-sans antialiased overflow-x-clip selection:bg-[#8b5cf6]/30 selection:text-white">
        {/* Quiet top navigation */}
        <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#09090b]/85 backdrop-blur-md">
          <div className="max-w-[1200px] mx-auto px-6 sm:px-8 h-16 flex items-center justify-between">
            <button
              type="button"
              onClick={onLaunchApp}
              className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] rounded-md"
            >
              <span className="w-7 h-7 rounded-lg bg-[#18181b] border border-white/[0.1] flex items-center justify-center text-[#f4f4f5]">
                <GitBranch className="w-4 h-4" strokeWidth={1.75} />
              </span>
              <span className="text-[15px] font-medium tracking-[-0.01em] text-[#f4f4f5]">
                RepoForge
              </span>
            </button>

            <nav className="hidden md:flex items-center gap-7 text-[14px] text-[#a1a1aa]">
              <a
                href="#workflow"
                className="hover:text-[#f4f4f5] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] rounded-sm"
              >
                Workflow
              </a>
              <a
                href="#capabilities"
                className="hover:text-[#f4f4f5] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] rounded-sm"
              >
                Capabilities
              </a>
              <a
                href="#faq"
                className="hover:text-[#f4f4f5] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] rounded-sm"
              >
                FAQ
              </a>
            </nav>

            <div className="flex items-center gap-4">
              <a
                href="https://github.com/icefvg/Repo-Creator-Tool"
                target="_blank"
                rel="noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 text-[14px] text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] rounded-sm"
              >
                <Github className="w-4 h-4" strokeWidth={1.5} />
                GitHub
              </a>
              <button
                type="button"
                onClick={onLaunchApp}
                className="h-9 px-4 rounded-lg bg-[#f4f4f5] text-[#09090b] text-[14px] font-medium hover:bg-white enabled:active:scale-[0.96] transition-[background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
              >
                Open workspace
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-[1200px] mx-auto px-6 sm:px-8">
          {/* HERO SECTION */}
          <section className="pt-16 pb-20 lg:pt-24 lg:pb-28 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-center">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
              className="lg:col-span-5 space-y-6"
            >
              <h1 className="text-[40px] sm:text-[48px] lg:text-[54px] font-medium tracking-[-0.025em] leading-[1.08] text-[#f4f4f5] [text-wrap:balance]">
                Turn local archives into GitHub repositories
              </h1>

              <p className="text-[16px] leading-[1.6] text-[#a1a1aa] max-w-[46ch] [text-wrap:pretty]">
                Drop a ZIP or TAR.GZ archive, inspect its folder tree, detect each project’s stack, and publish public or private repositories via the GitHub API without touching Git CLI.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={onLaunchApp}
                  className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-[14px] font-medium enabled:active:scale-[0.96] transition-[background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
                >
                  Open workspace
                  <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                </button>
                <a
                  href="#workflow"
                  className="inline-flex items-center h-11 px-4 rounded-lg border border-white/[0.1] bg-[#111114] text-[#f4f4f5] text-[14px] font-medium hover:bg-white/[0.06] hover:border-white/[0.18] transition-[background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
                >
                  How it works
                </a>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] font-mono text-[#71717a]">
                <span>ZIP &amp; TAR.GZ</span>
                <span>No Git CLI required</span>
                <span>Public or Private</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.1, ease: EASE_OUT }}
              className="lg:col-span-7"
            >
              <InteractiveHeroPreview onLaunchApp={onLaunchApp} />
            </motion.div>
          </section>

          {/* SPECS STRIP */}
          <section className="py-8 border-y border-white/[0.06] grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <div className="text-[13px] text-[#71717a]">Archive formats</div>
              <div className="text-[18px] font-medium text-[#f4f4f5] mt-1 font-mono tabular-nums">
                ZIP, TAR.GZ
              </div>
            </div>
            <div>
              <div className="text-[13px] text-[#71717a]">Framework detection</div>
              <div className="text-[18px] font-medium text-[#f4f4f5] mt-1 font-mono tabular-nums">
                Next, Vite, Node, Py, Flutter
              </div>
            </div>
            <div>
              <div className="text-[13px] text-[#71717a]">License templates</div>
              <div className="text-[18px] font-medium text-[#f4f4f5] mt-1 font-mono tabular-nums">
                MIT, Apache 2.0, GPL, BSD
              </div>
            </div>
            <div>
              <div className="text-[13px] text-[#71717a]">Publishing method</div>
              <div className="text-[18px] font-medium text-[#f4f4f5] mt-1 font-mono tabular-nums">
                Direct GitHub REST API
              </div>
            </div>
          </section>

          {/* WORKFLOW (3 STEPS) */}
          <section id="workflow" className="py-20 lg:py-24">
            <div className="max-w-[56ch] mb-12">
              <h2 className="text-[28px] sm:text-[32px] font-medium tracking-[-0.02em] leading-[1.2] text-[#f4f4f5] [text-wrap:balance]">
                From compressed folder to live repository in three steps
              </h2>
              <p className="text-[15px] leading-[1.6] text-[#a1a1aa] mt-3 [text-wrap:pretty]">
                Built for developers archiving client handovers, hackathon projects, or monorepo splits without repeating git init and remote setup by hand.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  step: "01",
                  title: "Drop one or more archives",
                  body: "Upload ZIP or TAR.GZ files in the browser. RepoForge extracts the directory tree in memory and counts files and byte sizes before touching GitHub.",
                },
                {
                  step: "02",
                  title: "Review stack, visibility, and docs",
                  body: "Select which folders become repositories, rename targets, set Public or Private per repo, and auto-generate README.md, LICENSE, and .gitignore.",
                },
                {
                  step: "03",
                  title: "Stream commits and copy URLs",
                  body: "Watch each repository transition from queued to uploading to done in real time, then copy individual URLs or open all created repos at once.",
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="rounded-xl border border-white/[0.08] bg-[#111114] p-6 flex flex-col justify-between"
                >
                  <div>
                    <div className="font-mono text-[12px] text-[#71717a] tabular-nums mb-4">
                      Step {item.step}
                    </div>
                    <h3 className="text-[17px] font-medium text-[#f4f4f5] leading-[1.3]">
                      {item.title}
                    </h3>
                    <p className="text-[14px] leading-[1.6] text-[#a1a1aa] mt-2.5 [text-wrap:pretty]">
                      {item.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* CAPABILITIES (ASYMMETRIC GRID) */}
          <section id="capabilities" className="py-16 lg:py-20 border-t border-white/[0.06]">
            <div className="max-w-[56ch] mb-12">
              <h2 className="text-[28px] sm:text-[32px] font-medium tracking-[-0.02em] leading-[1.2] text-[#f4f4f5] [text-wrap:balance]">
                What happens before the first commit
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Wide card: Smart stack detection */}
              <div className="md:col-span-7 rounded-xl border border-white/[0.08] bg-[#111114] p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-[17px] font-medium text-[#f4f4f5]">
                    Automatic stack and topic detection
                  </h3>
                  <p className="text-[14px] leading-[1.6] text-[#a1a1aa] mt-2 max-w-[54ch] [text-wrap:pretty]">
                    RepoForge inspects config files and manifests inside each folder to pre-fill repository topics, language badges, and the matching .gitignore template.
                  </p>
                </div>

                <div className="mt-6 rounded-lg border border-white/[0.06] bg-[#0d0d10] divide-y divide-white/[0.04] font-mono text-[12px]">
                  {[
                    { file: "next.config.*", stack: "Next.js", ignore: "node" },
                    { file: "vite.config.*", stack: "React + Vite", ignore: "node" },
                    { file: "requirements.txt", stack: "Python", ignore: "python" },
                    { file: "pubspec.yaml", stack: "Flutter", ignore: "flutter" },
                  ].map((row) => (
                    <div
                      key={row.file}
                      className="grid grid-cols-3 px-3.5 py-2 text-[#a1a1aa]"
                    >
                      <span className="text-[#f4f4f5]">{row.file}</span>
                      <span>{row.stack}</span>
                      <span className="text-right text-[#71717a]">.gitignore: {row.ignore}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Narrow card: Archive preview */}
              <div className="md:col-span-5 rounded-xl border border-white/[0.08] bg-[#111114] p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-[17px] font-medium text-[#f4f4f5]">
                    Archive preview before upload
                  </h3>
                  <p className="text-[14px] leading-[1.6] text-[#a1a1aa] mt-2 [text-wrap:pretty]">
                    Browse folder trees, verify file counts and total size, and read text files such as package.json or README.md before creating anything on GitHub.
                  </p>
                </div>

                <div className="mt-6 rounded-lg border border-white/[0.06] bg-[#0d0d10] p-3.5 font-mono text-[12px] text-[#a1a1aa] space-y-1.5">
                  <div className="flex items-center gap-2 text-[#f4f4f5]">
                    <ChevronRight className="w-3.5 h-3.5 text-[#71717a] rotate-90" strokeWidth={1.5} />
                    <span>shop-api/</span>
                    <span className="text-[#71717a] ml-auto tabular-nums">18 files</span>
                  </div>
                  <div className="pl-5 flex items-center justify-between">
                    <span>src/index.ts</span>
                    <span className="text-[#71717a] tabular-nums">2.4 KB</span>
                  </div>
                  <div className="pl-5 flex items-center justify-between">
                    <span>package.json</span>
                    <span className="text-[#71717a] tabular-nums">980 B</span>
                  </div>
                </div>
              </div>

              {/* Card 3: README & License */}
              <div className="md:col-span-6 rounded-xl border border-white/[0.08] bg-[#111114] p-6">
                <h3 className="text-[17px] font-medium text-[#f4f4f5]">
                  README and license generation
                </h3>
                <p className="text-[14px] leading-[1.6] text-[#a1a1aa] mt-2 [text-wrap:pretty]">
                  If a folder ships without documentation, RepoForge writes a clean README with project title, description, installation steps, and tech stack, paired with MIT, Apache 2.0, GPL-3.0, or BSD.
                </p>
              </div>

              {/* Card 4: Live progress & URL export */}
              <div className="md:col-span-6 rounded-xl border border-white/[0.08] bg-[#111114] p-6">
                <h3 className="text-[17px] font-medium text-[#f4f4f5]">
                  Live timeline and bulk URL export
                </h3>
                <p className="text-[14px] leading-[1.6] text-[#a1a1aa] mt-2 [text-wrap:pretty]">
                  Track each repository status in real time as files stream to GitHub. When the batch completes, copy individual links, copy every URL at once, or open all repositories in new tabs.
                </p>
              </div>
            </div>
          </section>

          {/* SELF-HOST & CLI / FAQ */}
          <section id="faq" className="py-16 lg:py-20 border-t border-white/[0.06] grid grid-cols-1 lg:grid-cols-12 gap-12">
            <div className="lg:col-span-5 space-y-5">
              <h2 className="text-[28px] font-medium tracking-[-0.02em] leading-[1.2] text-[#f4f4f5]">
                Free to run locally or in your browser
              </h2>
              <p className="text-[15px] leading-[1.6] text-[#a1a1aa] [text-wrap:pretty]">
                RepoForge is open source and connects directly to your GitHub account using your configured token. Clone the repository to run it on your own machine.
              </p>

              <div className="rounded-lg border border-white/[0.08] bg-[#111114] px-3.5 py-2.5 flex items-center justify-between gap-3 font-mono text-[12px]">
                <div className="flex items-center gap-2 min-w-0">
                  <Terminal className="w-3.5 h-3.5 text-[#71717a] shrink-0" strokeWidth={1.5} />
                  <span className="text-[#d4d4d8] truncate">
                    git clone https://github.com/icefvg/Repo-Creator-Tool
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCmd}
                  aria-label="Copy clone command"
                  className="text-[#a1a1aa] hover:text-[#f4f4f5] p-1 rounded transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] shrink-0"
                >
                  {copiedCmd ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={1.75} />
                  ) : (
                    <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </div>

            <div className="lg:col-span-7 divide-y divide-white/[0.06] border-y border-white/[0.06]">
              {[
                {
                  q: "Do I need Git installed on my computer?",
                  a: "No. RepoForge communicates directly with the GitHub REST API, so you do not need Git CLI installed or configured locally.",
                },
                {
                  q: "Can I create private repositories?",
                  a: "Yes. Set a global Public or Private default for the batch, then override visibility individually for any project folder.",
                },
                {
                  q: "What happens if an archive has multiple folders?",
                  a: "Each top-level project folder appears with a checkbox so you can publish all of them as separate repositories or pick only the ones you want.",
                },
              ].map((item) => (
                <div key={item.q} className="py-5">
                  <h3 className="text-[15px] font-medium text-[#f4f4f5]">{item.q}</h3>
                  <p className="text-[14px] leading-[1.6] text-[#a1a1aa] mt-1.5 [text-wrap:pretty]">
                    {item.a}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </main>

        {/* QUIET FOOTER */}
        <footer className="border-t border-white/[0.06] py-10 mt-8">
          <div className="max-w-[1200px] mx-auto px-6 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[13px] text-[#71717a]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#71717a]" strokeWidth={1.5} />
              <span>RepoForge — Archive to GitHub repository creator</span>
            </div>
            <div className="flex items-center gap-6">
              <a
                href="#workflow"
                className="hover:text-[#f4f4f5] transition-colors duration-150"
              >
                Workflow
              </a>
              <a
                href="#capabilities"
                className="hover:text-[#f4f4f5] transition-colors duration-150"
              >
                Capabilities
              </a>
              <a
                href="https://github.com/icefvg/Repo-Creator-Tool"
                target="_blank"
                rel="noreferrer"
                className="hover:text-[#f4f4f5] transition-colors duration-150"
              >
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
