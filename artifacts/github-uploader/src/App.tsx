import React, { useState, useRef, useCallback, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { MotionConfig, motion, AnimatePresence } from "framer-motion";
import {
  UploadCloud, CheckCircle2, FileArchive, Lock, Globe, Github,
  AlertCircle, Loader2, ExternalLink, FolderOpen, ArrowRight,
  RotateCcw, PackageOpen, X, ChevronRight, Pencil, WifiOff,
  Copy, Check, Code2, Tag, Shield, FileText, ChevronDown, Eye,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch as SwitchUI } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import LandingPage from "@/components/LandingPage";

import {
  useGetGithubUser, getGetGithubUserQueryKey,
  useListRecentRepos, getListRecentReposQueryKey,
  usePreviewArchive, useUploadSelectedFolders, useGetFilePreview,
  getJob, setAuthTokenGetter,
  FolderInfo, TechDetection, LicenseType, FolderRepoConfig,
} from "@workspace/api-client-react";

const TOKEN_STORAGE_KEY = "repoforge_gh_token";
setAuthTokenGetter(() => {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
});

const queryClient = new QueryClient();
const ACCEPTED_FORMATS = ".zip,.tar,.tar.gz,.tgz,.tar.bz2,.tbz2,.tar.xz,.txz";
const JOB_STORAGE_KEY = "repoforge_active_job";
const EASE_OUT = [0.2, 0, 0, 1] as const;

type Step = "drop" | "preview" | "detect" | "configure" | "forge";

interface RepoResult {
  folderName: string;
  repoName: string;
  repoUrl: string;
  filesUploaded: number;
  success: boolean;
  error?: string;
  status?: "queued" | "uploading" | "done" | "failed";
  detectedTech?: TechDetection;
}

const STEPS: { id: Step; label: string }[] = [
  { id: "drop", label: "Upload" },
  { id: "preview", label: "Preview" },
  { id: "detect", label: "Detect" },
  { id: "configure", label: "Configure" },
  { id: "forge", label: "Forge" },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function GithubUploaderApp() {
  const { toast } = useToast();
  const qClient = useQueryClient();
  const { data: user, isLoading: isUserLoading, error: userError } =
    useGetGithubUser({ query: { queryKey: getGetGithubUserQueryKey() } });
  const { data: repos, isLoading: isReposLoading } = useListRecentRepos({
    query: { queryKey: getListRecentReposQueryKey(), enabled: !!user },
  });

  const previewMutation = usePreviewArchive();
  const uploadMutation = useUploadSelectedFolders();
  const filePreviewMutation = useGetFilePreview();

  const [showLanding, setShowLanding] = useState(true);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [hasCustomToken, setHasCustomToken] = useState(() => {
    try {
      return Boolean(sessionStorage.getItem(TOKEN_STORAGE_KEY));
    } catch {
      return false;
    }
  });

  const [step, setStep] = useState<Step>("drop");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [archiveName, setArchiveName] = useState("");
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());

  // Per-folder Repo Config
  const [repoConfigs, setRepoConfigs] = useState<Map<string, FolderRepoConfig>>(new Map());

  // Global defaults
  const [globalPrivate, setGlobalPrivate] = useState(false);
  const [globalDescription, setGlobalDescription] = useState("");
  const [globalLicense, setGlobalLicense] = useState<LicenseType>("MIT");

  // File Preview Modal
  const [previewFileState, setPreviewFileState] = useState<{
    folderName: string;
    filePath: string;
    isOpen: boolean;
  }>({ folderName: "", filePath: "", isOpen: false });

  // Expanded folders in tree view
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Clipboard copies
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // Active Job & Results
  const [results, setResults] = useState<RepoResult[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Job Polling ──────────────────────────────────────────────────────────────
  const { data: jobData } = useQuery({
    queryKey: ["job", activeJobId],
    queryFn: () => getJob(activeJobId!),
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "done" || status === "failed") return false;
      return 1200;
    },
    refetchIntervalInBackground: true,
  });

  // Transition job completion
  useEffect(() => {
    if (!jobData) return;
    if (jobData.status === "done" || jobData.status === "failed") {
      setResults(jobData.results as RepoResult[]);
      localStorage.removeItem(JOB_STORAGE_KEY);
      qClient.invalidateQueries({ queryKey: getListRecentReposQueryKey() });
    }
  }, [jobData?.status]);

  // Restore in-progress job on load
  useEffect(() => {
    const saved = localStorage.getItem(JOB_STORAGE_KEY);
    if (saved) {
      try {
        const { jobId } = JSON.parse(saved) as { jobId: string };
        if (jobId) {
          setActiveJobId(jobId);
          setStep("forge");
        }
      } catch {
        localStorage.removeItem(JOB_STORAGE_KEY);
      }
    }
  }, []);

  // ── File Selection ───────────────────────────────────────────────────────────
  const handleFileSelect = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setSelectedFiles(fileArray);
    setResults([]);
    setSelectedFolders(new Set());
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      handleFileSelect(e.dataTransfer.files);
    }
  }, [handleFileSelect]);

  // ── Step 1 -> Step 2: Scan & Preview Archive ─────────────────────────────────
  const handlePreview = useCallback(() => {
    if (selectedFiles.length === 0) return;
    const bodyData = selectedFiles.length === 1 ? { file: selectedFiles[0] } : { files: selectedFiles };
    previewMutation.mutate(
      { data: bodyData },
      {
        onSuccess: (data) => {
          setSessionId(data.sessionId);
          setArchiveName(data.archiveName);
          setFolders(data.folders);
          setSelectedFolders(new Set(data.folders.map((f) => f.name)));

          const initialConfigs = new Map<string, FolderRepoConfig>();
          data.folders.forEach((f) => {
            initialConfigs.set(f.name, {
              repoName: f.name,
              private: globalPrivate,
              description: "",
              topics: f.detectedTech?.topics ?? [],
              license: "MIT",
              generateReadme: true,
              generateGitignore: true,
            });
          });
          setRepoConfigs(initialConfigs);
          setStep("preview");
        },
      }
    );
  }, [selectedFiles, globalPrivate, previewMutation]);

  // ── Step 4 -> Step 5: Forge Repositories ─────────────────────────────────────
  const handleUpload = useCallback(() => {
    if (!sessionId || selectedFolders.size === 0) return;

    const repoConfigsObj: Record<string, FolderRepoConfig> = {};
    for (const folder of selectedFolders) {
      const cfg = repoConfigs.get(folder);
      if (cfg) {
        repoConfigsObj[folder] = cfg;
      }
    }

    uploadMutation.mutate(
      {
        data: {
          sessionId,
          selectedFolders: [...selectedFolders],
          repoConfigs: repoConfigsObj,
          private: globalPrivate,
          description: globalDescription,
        },
      },
      {
        onSuccess: (data) => {
          const jobId = data.jobId;
          localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify({ jobId }));
          setActiveJobId(jobId);
          setStep("forge");
        },
      }
    );
  }, [sessionId, selectedFolders, repoConfigs, globalPrivate, globalDescription, uploadMutation]);

  const handleReset = useCallback(() => {
    setStep("drop");
    setSelectedFiles([]);
    setSessionId("");
    setFolders([]);
    setSelectedFolders(new Set());
    setRepoConfigs(new Map());
    setGlobalDescription("");
    setResults([]);
    setActiveJobId(null);
    localStorage.removeItem(JOB_STORAGE_KEY);
    previewMutation.reset();
    uploadMutation.reset();
  }, [previewMutation, uploadMutation]);

  const toggleFolderSelection = (name: string) => {
    setSelectedFolders((prev) => {
      const s = new Set(prev);
      s.has(name) ? s.delete(name) : s.add(name);
      return s;
    });
  };

  const toggleFolderTreeExpand = (name: string) => {
    setExpandedFolders((prev) => {
      const s = new Set(prev);
      s.has(name) ? s.delete(name) : s.add(name);
      return s;
    });
  };

  const handleUpdateConfig = (folderName: string, updates: Partial<FolderRepoConfig>) => {
    setRepoConfigs((prev) => {
      const m = new Map(prev);
      const existing = m.get(folderName) ?? { repoName: folderName };
      m.set(folderName, { ...existing, ...updates });
      return m;
    });
  };

  const handleAddTopic = (folderName: string, topic: string) => {
    const clean = topic.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!clean) return;
    const cfg = repoConfigs.get(folderName);
    const existing = cfg?.topics ?? [];
    if (!existing.includes(clean)) {
      handleUpdateConfig(folderName, { topics: [...existing, clean] });
    }
  };

  const handleRemoveTopic = (folderName: string, topicToRemove: string) => {
    const cfg = repoConfigs.get(folderName);
    const existing = cfg?.topics ?? [];
    handleUpdateConfig(
      folderName,
      { topics: existing.filter((t) => t !== topicToRemove) }
    );
  };

  const handleApplyGlobalPrivate = (isPriv: boolean) => {
    setGlobalPrivate(isPriv);
    setRepoConfigs((prev) => {
      const m = new Map(prev);
      m.forEach((cfg, k) => {
        m.set(k, { ...cfg, private: isPriv });
      });
      return m;
    });
  };

  const handleApplyGlobalLicense = (license: LicenseType) => {
    setGlobalLicense(license);
    setRepoConfigs((prev) => {
      const m = new Map(prev);
      m.forEach((cfg, k) => {
        m.set(k, { ...cfg, license });
      });
      return m;
    });
  };

  const handleOpenFilePreview = (folderName: string, filePath: string) => {
    setPreviewFileState({ folderName, filePath, isOpen: true });
    filePreviewMutation.reset();
    filePreviewMutation.mutate({ data: { sessionId, folderName, filePath } });
  };

  const handleCopyUrl = (url: string, index: number) => {
    navigator.clipboard.writeText(url);
    setCopiedIndex(index);
    toast({ title: "Copied", description: "Repository URL copied to clipboard." });
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleCopyAllUrls = () => {
    const activeResults = jobData?.results ?? results;
    const urls = activeResults.filter((r) => r.success && r.repoUrl).map((r) => r.repoUrl).join("\n");
    if (urls) {
      navigator.clipboard.writeText(urls);
      setCopiedAll(true);
      toast({ title: "Copied all URLs", description: "All repository URLs copied to clipboard." });
      setTimeout(() => setCopiedAll(false), 2000);
    }
  };

  const handleOpenAllInGithub = () => {
    const activeResults = jobData?.results ?? results;
    activeResults.forEach((r) => {
      if (r.success && r.repoUrl) {
        window.open(r.repoUrl, "_blank");
      }
    });
  };

  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    sessionStorage.setItem(TOKEN_STORAGE_KEY, trimmed);
    setHasCustomToken(true);
    setTokenInput("");
    setIsTokenModalOpen(false);
    qClient.invalidateQueries({ queryKey: getGetGithubUserQueryKey() });
    qClient.invalidateQueries({ queryKey: getListRecentReposQueryKey() });
    toast({ title: "Token saved", description: "Verifying GitHub account…" });
  };

  const handleDisconnectToken = () => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setHasCustomToken(false);
    qClient.invalidateQueries({ queryKey: getGetGithubUserQueryKey() });
    qClient.invalidateQueries({ queryKey: getListRecentReposQueryKey() });
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  if (isUserLoading && !showLanding) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#8b5cf6] animate-spin" strokeWidth={1.5} />
      </div>
    );
  }

  // Derived progress values
  const currentJob = jobData ?? {
    status: activeJobId ? "running" : "done",
    progress: {
      total: selectedFolders.size,
      completed: 0,
      currentRepo: undefined as string | undefined,
      currentAction: undefined as string | undefined,
    },
    results: results,
  };
  const progressTotal = currentJob.progress.total || selectedFolders.size || 1;
  const progressDone = currentJob.progress.completed || 0;
  const progressPct = Math.min(100, Math.round((progressDone / progressTotal) * 100));
  const currentRepoName = currentJob.progress.currentRepo;
  const currentActionText = currentJob.progress.currentAction;
  const displayResults = (currentJob.results ?? results) as RepoResult[];

  if (showLanding) {
    return <LandingPage onLaunchApp={() => setShowLanding(false)} />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] font-sans antialiased overflow-x-clip selection:bg-[#8b5cf6]/30 selection:text-white">
        {/* Top Workspace Header */}
        <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#09090b]/85 backdrop-blur-md">
          <div className="max-w-[1024px] mx-auto px-6 h-16 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowLanding(true)}
              className="flex items-center gap-2.5 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
            >
              <span className="w-7 h-7 rounded-lg bg-[#18181b] border border-white/[0.1] flex items-center justify-center text-[#f4f4f5]">
                <GitBranch className="w-4 h-4" strokeWidth={1.75} />
              </span>
              <span className="text-[15px] font-medium tracking-[-0.01em] text-[#f4f4f5]">
                RepoForge
              </span>
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowLanding(true)}
                className="h-8 px-3 rounded-lg border border-white/[0.08] bg-[#111114] text-[13px] font-medium text-[#a1a1aa] hover:text-[#f4f4f5] hover:border-white/[0.16] transition-[color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
              >
                Overview
              </button>
              {user ? (
                <div className="flex items-center gap-2 bg-[#111114] border border-white/[0.08] py-1 pl-1.5 pr-2.5 rounded-full">
                  <img
                    src={user.avatarUrl}
                    alt={user.login}
                    className="w-6 h-6 rounded-full outline-1 -outline-offset-1 outline-white/10"
                  />
                  <span className="text-[13px] font-medium text-[#f4f4f5]">{user.login}</span>
                  <span className="text-[12px] font-mono text-[#71717a] tabular-nums">
                    {user.publicRepos}
                  </span>
                  <button
                    type="button"
                    onClick={() => (hasCustomToken ? handleDisconnectToken() : setIsTokenModalOpen(true))}
                    title={hasCustomToken ? "Disconnect token" : "Switch GitHub token"}
                    className="ml-1 text-[11px] font-mono text-[#a1a1aa] hover:text-[#f4f4f5] border-l border-white/[0.08] pl-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] rounded-sm"
                  >
                    {hasCustomToken ? "Disconnect" : "Switch"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsTokenModalOpen(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-[13px] font-medium enabled:active:scale-[0.96] transition-[background-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
                >
                  <Github className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Connect GitHub
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="max-w-[1024px] mx-auto px-6 py-10">
          {/* 5-Step Progress Stepper */}
          <nav aria-label="Workflow steps" className="flex items-center justify-between gap-2 mb-10 max-w-2xl mx-auto bg-[#111114] border border-white/[0.08] px-4 py-2.5 rounded-xl">
            {STEPS.map((s, i) => {
              const isCurrent = step === s.id;
              const isCompleted = i < stepIndex;
              return (
                <React.Fragment key={s.id}>
                  <div
                    className={`flex items-center gap-2 text-[13px] font-medium transition-colors duration-150 ${
                      isCurrent
                        ? "text-[#f4f4f5]"
                        : isCompleted
                        ? "text-[#a1a1aa]"
                        : "text-[#71717a]"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono tabular-nums transition-[background-color,color] duration-150 ${
                        isCurrent
                          ? "bg-[#8b5cf6] text-white"
                          : isCompleted
                          ? "bg-[#8b5cf6]/20 text-[#c4b5fd]"
                          : "bg-white/[0.06] text-[#71717a]"
                      }`}
                    >
                      {isCompleted ? <Check className="w-3 h-3" strokeWidth={2} /> : i + 1}
                    </span>
                    <span className="hidden sm:inline">{s.label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <ChevronRight className="w-3.5 h-3.5 text-white/[0.15] shrink-0" strokeWidth={1.5} />
                  )}
                </React.Fragment>
              );
            })}
          </nav>

          {/* Main Step Content */}
          <main className="max-w-2xl mx-auto">
            <AnimatePresence mode="wait" initial={false}>
              {/* ── STEP 1: Upload (drop) ── */}
              {step === "drop" && (
                <motion.div
                  key="drop"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="space-y-6"
                >
                  <div className="space-y-2">
                    <h1 className="text-[28px] sm:text-[32px] font-medium tracking-[-0.02em] leading-[1.15] text-[#f4f4f5] [text-wrap:balance]">
                      Upload project archives
                    </h1>
                    <p className="text-[15px] leading-[1.6] text-[#a1a1aa] [text-wrap:pretty]">
                      Drop one or more ZIP or TAR archives to inspect folders, detect tech stacks, and create GitHub repositories.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz"].map((fmt) => (
                      <span
                        key={fmt}
                        className="text-[11px] font-mono bg-[#111114] text-[#71717a] border border-white/[0.06] px-2 py-0.5 rounded-md"
                      >
                        {fmt}
                      </span>
                    ))}
                  </div>

                  <div
                    data-testid="dropzone"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    className={`relative border border-dashed rounded-2xl p-10 text-center cursor-pointer transition-[border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] ${
                      isDragging
                        ? "border-[#8b5cf6] bg-[#8b5cf6]/[0.05]"
                        : selectedFiles.length > 0
                        ? "border-[#8b5cf6]/50 bg-[#111114]"
                        : "border-white/[0.12] bg-[#111114] hover:border-white/[0.22]"
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept={ACCEPTED_FORMATS}
                      multiple
                      data-testid="file-input"
                      onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
                    />

                    {selectedFiles.length > 0 ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/25 text-[#c4b5fd] flex items-center justify-center">
                          <FileArchive className="w-5 h-5" strokeWidth={1.5} />
                        </div>
                        <div className="space-y-2">
                          <p className="font-medium text-[15px] text-[#f4f4f5] tabular-nums">
                            {selectedFiles.length} archive{selectedFiles.length !== 1 ? "s" : ""} selected
                          </p>
                          <div className="flex flex-wrap justify-center gap-2">
                            {selectedFiles.map((f, idx) => (
                              <span
                                key={idx}
                                className="text-[12px] bg-[#0d0d10] text-[#d4d4d8] px-2.5 py-1 rounded-md border border-white/[0.08] font-mono tabular-nums"
                              >
                                {f.name} ({formatBytes(f.size)})
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedFiles([]); }}
                          data-testid="remove-file"
                          className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-[#a1a1aa] hover:text-red-400 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6] rounded-md px-2 py-1"
                        >
                          <X className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Remove files
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 py-4">
                        <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[#a1a1aa] flex items-center justify-center">
                          <UploadCloud className="w-5 h-5" strokeWidth={1.5} />
                        </div>
                        <div>
                          <p className="font-medium text-[15px] text-[#f4f4f5]">
                            Click or drag archive files here
                          </p>
                          <p className="text-[13px] text-[#71717a] mt-1">
                            Supports multiple ZIP or TAR.GZ files up to 100 MB
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {previewMutation.isError && (
                    <div className="flex items-start gap-2.5 text-[13px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.5} />
                      <span>{(previewMutation.error as any)?.message ?? "Failed to extract archive"}</span>
                    </div>
                  )}

                  {selectedFiles.length > 0 && (
                    <Button
                      onClick={handlePreview}
                      disabled={previewMutation.isPending}
                      className="w-full h-11 text-[14px] font-medium rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] text-white enabled:active:scale-[0.96] transition-[background-color,transform] duration-150 ease-out"
                      data-testid="preview-btn"
                    >
                      {previewMutation.isPending ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                          Scanning archives…
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <PackageOpen className="w-4 h-4" strokeWidth={1.5} />
                          Scan archives and preview structure
                          <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                        </span>
                      )}
                    </Button>
                  )}
                </motion.div>
              )}

              {/* ── STEP 2: Preview (Folder Tree & File Explorer) ── */}
              {step === "preview" && (
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="space-y-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-[24px] font-medium tracking-[-0.02em] text-[#f4f4f5]">
                        Archive preview
                      </h2>
                      <p className="text-[#a1a1aa] text-[14px] mt-1 tabular-nums">
                        Found <span className="text-[#f4f4f5] font-medium">{folders.length}</span> project folder{folders.length !== 1 ? "s" : ""} in{" "}
                        <span className="font-mono text-[#f4f4f5]">{archiveName}</span>
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg border-white/[0.1] bg-[#111114] text-[#f4f4f5] hover:bg-white/[0.06] enabled:active:scale-[0.96] transition-[background-color,transform] duration-150"
                      onClick={() => {
                        if (selectedFolders.size === folders.length) setSelectedFolders(new Set());
                        else setSelectedFolders(new Set(folders.map((f) => f.name)));
                      }}
                    >
                      {selectedFolders.size === folders.length ? "Deselect all" : "Select all"}
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {folders.map((folder) => {
                      const checked = selectedFolders.has(folder.name);
                      const isExpanded = expandedFolders.has(folder.name);
                      const tech = folder.detectedTech;

                      return (
                        <div
                          key={folder.name}
                          className={`rounded-xl border transition-[border-color,opacity,background-color] duration-150 ${
                            checked
                              ? "bg-[#111114] border-white/[0.14]"
                              : "bg-[#111114]/50 border-white/[0.06] opacity-60"
                          }`}
                        >
                          <div
                            className="flex items-center justify-between p-4 cursor-pointer select-none"
                            onClick={() => toggleFolderSelection(folder.name)}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleFolderSelection(folder.name)}
                                className="pointer-events-none shrink-0"
                              />
                              <FolderOpen
                                className={`w-4 h-4 shrink-0 ${checked ? "text-[#8b5cf6]" : "text-[#71717a]"}`}
                                strokeWidth={1.5}
                              />
                              <div className="min-w-0">
                                <span className="font-mono text-[14px] font-medium text-[#f4f4f5] truncate block">
                                  {folder.name}
                                </span>
                                <div className="flex items-center gap-2 text-[12px] font-mono text-[#71717a] mt-0.5 tabular-nums">
                                  <span>{folder.fileCount} files</span>
                                  <span>/</span>
                                  <span>{formatBytes(folder.totalSizeBytes)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {tech && (
                                <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[#a1a1aa]">
                                  {tech.framework} ({tech.language})
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleFolderTreeExpand(folder.name); }}
                                className="p-1.5 hover:bg-white/[0.06] rounded-md text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
                                title="Toggle file tree view"
                              >
                                <ChevronDown
                                  className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`}
                                  strokeWidth={1.5}
                                />
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-white/[0.06] px-4 py-3 bg-[#0d0d10] rounded-b-xl">
                              <p className="text-[12px] text-[#71717a] mb-2">
                                File structure — click a file to preview
                              </p>
                              <div className="max-h-60 overflow-y-auto overscroll-contain space-y-0.5 pr-1 font-mono text-[12px]">
                                {folder.files.map((file) => (
                                  <button
                                    key={file.path}
                                    type="button"
                                    onClick={() => handleOpenFilePreview(folder.name, file.path)}
                                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-white/[0.05] text-left transition-colors duration-150 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Code2 className="w-3.5 h-3.5 text-[#71717a] group-hover:text-[#c4b5fd] shrink-0" strokeWidth={1.5} />
                                      <span className="truncate text-[#d4d4d8]">{file.path}</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 ml-2">
                                      <span className="text-[11px] text-[#71717a] tabular-nums">{formatBytes(file.size)}</span>
                                      <Eye className="w-3.5 h-3.5 text-[#71717a] opacity-0 group-hover:opacity-100 transition-opacity duration-150" strokeWidth={1.5} />
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      variant="outline"
                      onClick={handleReset}
                      className="rounded-lg border-white/[0.1] bg-[#111114] text-[#f4f4f5] hover:bg-white/[0.06] enabled:active:scale-[0.96] transition-[background-color,transform] duration-150"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                      Start over
                    </Button>
                    <Button
                      onClick={() => setStep("detect")}
                      disabled={selectedFolders.size === 0}
                      className="flex-1 h-10 text-[14px] font-medium rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] text-white enabled:active:scale-[0.96] transition-[background-color,transform] duration-150 tabular-nums"
                    >
                      Next: Tech detection ({selectedFolders.size} selected)
                      <ArrowRight className="w-4 h-4 ml-2" strokeWidth={1.5} />
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* ── STEP 3: Smart Tech Detection ── */}
              {step === "detect" && (
                <motion.div
                  key="detect"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="space-y-6"
                >
                  <div>
                    <h2 className="text-[24px] font-medium tracking-[-0.02em] text-[#f4f4f5]">
                      Detected stack and topics
                    </h2>
                    <p className="text-[#a1a1aa] text-[14px] mt-1 [text-wrap:pretty]">
                      Review framework, language, repository topics, and .gitignore template for each selected project.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {[...selectedFolders].map((folderName) => {
                      const folderObj = folders.find((f) => f.name === folderName);
                      const tech = folderObj?.detectedTech ?? {
                        framework: "General",
                        language: "JavaScript",
                        topics: [],
                        badges: [],
                        recommendedGitignore: "node",
                      };
                      const cfg = repoConfigs.get(folderName) ?? { repoName: folderName, topics: tech.topics };
                      const currentTopics = cfg.topics ?? tech.topics;

                      return (
                        <div
                          key={folderName}
                          className="bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-4"
                        >
                          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <FolderOpen className="w-4 h-4 text-[#8b5cf6] shrink-0" strokeWidth={1.5} />
                              <span className="font-mono font-medium text-[14px] text-[#f4f4f5] truncate">{folderName}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-[#8b5cf6]/10 border border-[#8b5cf6]/25 text-[#c4b5fd]">
                                {tech.framework}
                              </span>
                              <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[#a1a1aa]">
                                {tech.language}
                              </span>
                            </div>
                          </div>

                          <div>
                            <label className="text-[12px] text-[#a1a1aa] mb-2 flex items-center gap-1.5">
                              <Tag className="w-3.5 h-3.5 text-[#71717a]" strokeWidth={1.5} />
                              GitHub topics
                            </label>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {currentTopics.map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex items-center gap-1 text-[12px] bg-[#0d0d10] border border-white/[0.08] text-[#d4d4d8] px-2.5 py-1 rounded-md font-mono"
                                >
                                  #{t}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveTopic(folderName, t)}
                                    aria-label={`Remove topic ${t}`}
                                    className="text-[#71717a] hover:text-red-400 transition-colors duration-150 ml-0.5"
                                  >
                                    <X className="w-3 h-3" strokeWidth={1.5} />
                                  </button>
                                </span>
                              ))}
                              <Input
                                placeholder="+ Add topic"
                                className="h-7 w-28 text-base sm:text-[12px] bg-[#0d0d10] border-white/[0.08] font-mono"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleAddTopic(folderName, e.currentTarget.value);
                                    e.currentTarget.value = "";
                                  }
                                }}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[12px] bg-[#0d0d10] border border-white/[0.06] px-3 py-2 rounded-lg">
                            <span className="text-[#a1a1aa]">Recommended .gitignore template</span>
                            <span className="font-mono text-[#f4f4f5] bg-[#111114] px-2 py-0.5 rounded border border-white/[0.08]">
                              {tech.recommendedGitignore}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => setStep("preview")}
                      className="rounded-lg border-white/[0.1] bg-[#111114] text-[#f4f4f5] hover:bg-white/[0.06] enabled:active:scale-[0.96] transition-[background-color,transform] duration-150"
                    >
                      <ArrowRight className="w-4 h-4 mr-2 rotate-180" strokeWidth={1.5} />
                      Back to preview
                    </Button>
                    <Button
                      onClick={() => setStep("configure")}
                      className="flex-1 h-10 text-[14px] font-medium rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] text-white enabled:active:scale-[0.96] transition-[background-color,transform] duration-150"
                    >
                      Next: Repository settings
                      <ArrowRight className="w-4 h-4 ml-2" strokeWidth={1.5} />
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* ── STEP 4: Configure ── */}
              {step === "configure" && (
                <motion.div
                  key="configure"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="space-y-6"
                >
                  <div>
                    <h2 className="text-[24px] font-medium tracking-[-0.02em] text-[#f4f4f5]">
                      Repository and documentation settings
                    </h2>
                    <p className="text-[#a1a1aa] text-[14px] mt-1 [text-wrap:pretty]">
                      Configure global visibility and license defaults, or override names and documentation per repository.
                    </p>
                  </div>

                  {/* Global Defaults Card */}
                  <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-4">
                    <h3 className="text-[14px] font-medium text-[#f4f4f5]">
                      Global defaults
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="flex items-center justify-between bg-[#0d0d10] p-3 rounded-lg border border-white/[0.06]">
                        <div>
                          <span className="text-[13px] font-medium text-[#f4f4f5] block">
                            {globalPrivate ? "Private repositories" : "Public repositories"}
                          </span>
                          <span className="text-[12px] text-[#71717a]">
                            {globalPrivate ? "Only you can view" : "Visible to everyone"}
                          </span>
                        </div>
                        <SwitchUI checked={globalPrivate} onCheckedChange={handleApplyGlobalPrivate} data-testid="toggle-private" />
                      </div>

                      <div className="flex items-center justify-between bg-[#0d0d10] p-3 rounded-lg border border-white/[0.06]">
                        <div>
                          <span className="text-[13px] font-medium text-[#f4f4f5] block">Default license</span>
                          <span className="text-[12px] text-[#71717a]">Auto-generate LICENSE</span>
                        </div>
                        <select
                          value={globalLicense}
                          onChange={(e) => handleApplyGlobalLicense(e.target.value as LicenseType)}
                          className="bg-[#111114] border border-white/[0.1] text-[#f4f4f5] text-[12px] rounded-md px-2.5 py-1.5 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
                        >
                          <option value="MIT">MIT</option>
                          <option value="Apache-2.0">Apache 2.0</option>
                          <option value="GPL-3.0">GPL 3.0</option>
                          <option value="BSD-3-Clause">BSD 3-Clause</option>
                          <option value="None">None</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[12px] text-[#a1a1aa] block">
                        Global repository description (optional)
                      </label>
                      <Textarea
                        placeholder="Enter description for all repositories…"
                        value={globalDescription}
                        onChange={(e) => setGlobalDescription(e.target.value)}
                        className="resize-none bg-[#0d0d10] border-white/[0.08] text-base sm:text-[13px]"
                        rows={2}
                      />
                    </div>
                  </div>

                  {/* Individual Repository Overrides */}
                  <div className="space-y-3">
                    <h3 className="text-[14px] font-medium text-[#a1a1aa]">
                      Per-repository overrides
                    </h3>
                    {[...selectedFolders].map((folderName) => {
                      const cfg = repoConfigs.get(folderName) ?? {
                        repoName: folderName,
                        private: globalPrivate,
                        license: globalLicense,
                        generateReadme: true,
                        generateGitignore: true,
                      };
                      const currentName = cfg.repoName ?? folderName;

                      return (
                        <div
                          key={folderName}
                          className="bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-4"
                        >
                          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                            <span className="font-mono text-[12px] text-[#71717a]">
                              Source: <span className="text-[#f4f4f5] font-medium">{folderName}</span>
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] font-mono text-[#a1a1aa]">
                                {cfg.private ? "Private" : "Public"}
                              </span>
                              <SwitchUI
                                checked={cfg.private ?? globalPrivate}
                                onCheckedChange={(val) => handleUpdateConfig(folderName, { private: val })}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-[12px] text-[#a1a1aa] flex items-center gap-1.5">
                                <Pencil className="w-3 h-3 text-[#71717a]" strokeWidth={1.5} />
                                Repository name
                              </label>
                              <Input
                                value={currentName}
                                onChange={(e) => handleUpdateConfig(folderName, { repoName: e.target.value })}
                                className="font-mono text-base sm:text-[13px] bg-[#0d0d10] border-white/[0.08]"
                                placeholder={folderName}
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[12px] text-[#a1a1aa] flex items-center gap-1.5">
                                <Shield className="w-3 h-3 text-[#71717a]" strokeWidth={1.5} />
                                License
                              </label>
                              <select
                                value={cfg.license ?? "MIT"}
                                onChange={(e) => handleUpdateConfig(folderName, { license: e.target.value as LicenseType })}
                                className="w-full h-9 bg-[#0d0d10] border border-white/[0.08] text-[#f4f4f5] text-[13px] rounded-md px-3 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
                              >
                                <option value="MIT">MIT License</option>
                                <option value="Apache-2.0">Apache 2.0</option>
                                <option value="GPL-3.0">GPL 3.0</option>
                                <option value="BSD-3-Clause">BSD 3-Clause</option>
                                <option value="None">None (No License)</option>
                              </select>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-5 pt-2 border-t border-white/[0.06] text-[13px]">
                            <label className="flex items-center gap-2 cursor-pointer text-[#d4d4d8]">
                              <Checkbox
                                checked={cfg.generateReadme ?? true}
                                onCheckedChange={(val) => handleUpdateConfig(folderName, { generateReadme: !!val })}
                              />
                              <FileText className="w-3.5 h-3.5 text-[#71717a]" strokeWidth={1.5} />
                              <span>Auto-generate README.md</span>
                            </label>

                            <label className="flex items-center gap-2 cursor-pointer text-[#d4d4d8]">
                              <Checkbox
                                checked={cfg.generateGitignore ?? true}
                                onCheckedChange={(val) => handleUpdateConfig(folderName, { generateGitignore: !!val })}
                              />
                              <Code2 className="w-3.5 h-3.5 text-[#71717a]" strokeWidth={1.5} />
                              <span>Auto-generate .gitignore</span>
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {uploadMutation.isError && (
                    <div className="flex items-start gap-2.5 text-[13px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.5} />
                      <span>{(uploadMutation.error as any)?.message ?? "Forge failed to start"}</span>
                    </div>
                  )}

                  {!user && (
                    <div className="flex items-center justify-between gap-4 bg-[#111114] border border-[#8b5cf6]/30 rounded-xl p-4">
                      <div>
                        <p className="text-[13px] font-medium text-[#f4f4f5]">
                          Connect a GitHub account to forge repositories
                        </p>
                        <p className="text-[12px] text-[#a1a1aa] mt-0.5">
                          Your token stays in your browser session and is never stored on the server.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setIsTokenModalOpen(true)}
                        className="shrink-0 rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] text-white"
                      >
                        Connect GitHub
                      </Button>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => setStep("detect")}
                      className="rounded-lg border-white/[0.1] bg-[#111114] text-[#f4f4f5] hover:bg-white/[0.06] enabled:active:scale-[0.96] transition-[background-color,transform] duration-150"
                    >
                      <ArrowRight className="w-4 h-4 mr-2 rotate-180" strokeWidth={1.5} />
                      Back to detect
                    </Button>
                    <Button
                      onClick={() => (user ? handleUpload() : setIsTokenModalOpen(true))}
                      disabled={uploadMutation.isPending}
                      className="flex-1 h-10 text-[14px] font-medium rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] text-white enabled:active:scale-[0.96] transition-[background-color,transform] duration-150 tabular-nums"
                      data-testid="upload-btn"
                    >
                      {uploadMutation.isPending ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                          Starting job…
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Github className="w-4 h-4" strokeWidth={1.5} />
                          Forge {selectedFolders.size} {selectedFolders.size === 1 ? "repository" : "repositories"}
                          <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                        </span>
                      )}
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* ── STEP 5: Forge (Live Progress Timeline & Completion Actions) ── */}
              {step === "forge" && (
                <motion.div
                  key="forge"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="space-y-6"
                >
                  {/* Status Header */}
                  <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 flex items-center justify-between gap-6">
                    <div className="space-y-1">
                      <h2 className="text-[22px] font-medium tracking-[-0.02em] text-[#f4f4f5]">
                        {progressPct === 100 ? "Forge complete" : "Forging repositories…"}
                      </h2>
                      <p className="text-[#a1a1aa] text-[13px] tabular-nums">
                        {progressDone} of {progressTotal} repositories processed
                        {currentRepoName && progressPct < 100 && (
                          <span>
                            {" — "}
                            <span className="font-mono text-[#f4f4f5]">{currentRepoName}</span>
                          </span>
                        )}
                      </p>
                      {currentActionText && progressPct < 100 && (
                        <div className="inline-flex items-center gap-2 text-[12px] text-[#c4b5fd] pt-1 font-mono">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                          {currentActionText}
                        </div>
                      )}
                    </div>

                    <div className="relative w-16 h-16 shrink-0">
                      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
                        <motion.circle
                          cx="40"
                          cy="40"
                          r="34"
                          fill="none"
                          stroke="#8b5cf6"
                          strokeWidth="6"
                          strokeLinecap="round"
                          animate={{ strokeDashoffset: 213.6 - (213.6 * progressPct) / 100 }}
                          initial={{ strokeDashoffset: 213.6 }}
                          transition={{ duration: 0.4, ease: EASE_OUT }}
                          style={{ strokeDasharray: 213.6 }}
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[13px] font-mono font-medium text-[#f4f4f5] tabular-nums">
                          {progressPct}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {progressPct < 100 && (
                    <div className="flex items-start gap-3 bg-[#111114] border border-white/[0.08] rounded-xl p-4">
                      <WifiOff className="w-4 h-4 text-[#71717a] mt-0.5 shrink-0" strokeWidth={1.5} />
                      <div>
                        <p className="text-[13px] font-medium text-[#f4f4f5]">Safe to close this tab</p>
                        <p className="text-[12px] text-[#a1a1aa] mt-0.5">
                          The server continues creating repositories and uploading files to GitHub in the background.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Live Progress Timeline List */}
                  <div className="space-y-2.5">
                    <h3 className="text-[13px] font-medium text-[#a1a1aa]">
                      Repository timeline
                    </h3>
                    {displayResults.map((r, idx) => {
                      const isDone = r.success && r.status === "done";
                      const isUploading =
                        r.status === "uploading" || (currentRepoName === r.folderName && progressPct < 100);

                      return (
                        <div
                          key={r.folderName || idx}
                          className={`flex items-center justify-between p-4 rounded-xl border transition-[border-color,background-color] duration-150 ${
                            isDone
                              ? "bg-[#111114] border-emerald-500/30"
                              : isUploading
                              ? "bg-[#111114] border-[#8b5cf6]/40"
                              : r.error
                              ? "bg-[#111114] border-red-500/30"
                              : "bg-[#111114]/60 border-white/[0.06]"
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {isDone ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" strokeWidth={1.75} />
                            ) : isUploading ? (
                              <Loader2 className="w-4 h-4 text-[#8b5cf6] animate-spin shrink-0" strokeWidth={1.75} />
                            ) : r.error ? (
                              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" strokeWidth={1.75} />
                            ) : (
                              <div className="w-4 h-4 rounded-full border border-white/20 shrink-0" />
                            )}

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-medium text-[14px] text-[#f4f4f5] truncate">
                                  {r.repoName || r.folderName}
                                </span>
                                {r.detectedTech && (
                                  <span className="text-[11px] font-mono bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded text-[#a1a1aa]">
                                    {r.detectedTech.framework}
                                  </span>
                                )}
                              </div>

                              {isDone ? (
                                <span className="text-[12px] text-emerald-400 block mt-0.5 tabular-nums">
                                  Created ({r.filesUploaded} files uploaded)
                                </span>
                              ) : isUploading ? (
                                <span className="text-[12px] text-[#c4b5fd] block mt-0.5">
                                  Uploading files and documentation…
                                </span>
                              ) : r.error ? (
                                <span className="text-[12px] text-red-400 block mt-0.5">{r.error}</span>
                              ) : (
                                <span className="text-[12px] text-[#71717a] block mt-0.5">Queued</span>
                              )}
                            </div>
                          </div>

                          {isDone && (
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleCopyUrl(r.repoUrl, idx)}
                                className="h-8 px-2.5 text-[#a1a1aa] hover:text-[#f4f4f5]"
                              >
                                {copiedIndex === idx ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={1.75} />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                                )}
                              </Button>
                              <a
                                href={r.repoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-[12px] text-[#f4f4f5] font-medium bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 rounded-md border border-white/[0.08] transition-colors duration-150"
                              >
                                View
                                <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Completion Batch Actions */}
                  {progressPct === 100 && (
                    <div className="bg-[#111114] border border-white/[0.08] p-5 rounded-xl space-y-3">
                      <h3 className="text-[14px] font-medium text-[#f4f4f5]">
                        Batch actions
                      </h3>
                      <div className="flex flex-wrap gap-3">
                        <Button
                          onClick={handleCopyAllUrls}
                          variant="outline"
                          className="flex-1 rounded-lg border-white/[0.1] bg-[#0d0d10] text-[#f4f4f5] hover:bg-white/[0.06] enabled:active:scale-[0.96] transition-[background-color,transform] duration-150"
                        >
                          {copiedAll ? (
                            <Check className="w-4 h-4 mr-2 text-emerald-400" strokeWidth={1.75} />
                          ) : (
                            <Copy className="w-4 h-4 mr-2" strokeWidth={1.5} />
                          )}
                          {copiedAll ? "Copied all URLs" : "Copy all repo URLs"}
                        </Button>
                        <Button
                          onClick={handleOpenAllInGithub}
                          className="flex-1 rounded-lg bg-[#f4f4f5] text-[#09090b] hover:bg-white enabled:active:scale-[0.96] transition-[background-color,transform] duration-150"
                        >
                          <ExternalLink className="w-4 h-4 mr-2" strokeWidth={1.5} />
                          Open all in GitHub
                        </Button>
                      </div>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    onClick={handleReset}
                    className="w-full h-10 rounded-lg border-white/[0.1] bg-[#111114] text-[#f4f4f5] hover:bg-white/[0.06] enabled:active:scale-[0.96] transition-[background-color,transform] duration-150 text-[14px]"
                    data-testid="upload-another-btn"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                    Forge more repositories
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          {/* File Preview Content Modal */}
          <AnimatePresence>
            {previewFileState.isOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15, ease: EASE_OUT }}
                  className="bg-[#111114] border border-white/[0.1] rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden shadow-2xl"
                >
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Code2 className="w-4 h-4 text-[#8b5cf6] shrink-0" strokeWidth={1.5} />
                      <span className="font-mono text-[13px] font-medium text-[#f4f4f5] truncate">
                        {previewFileState.filePath}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewFileState((prev) => ({ ...prev, isOpen: false }))}
                      aria-label="Close preview"
                      className="p-1.5 hover:bg-white/[0.06] rounded-md text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
                    >
                      <X className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>

                  <div className="p-5 overflow-y-auto overscroll-contain flex-1 bg-[#09090b] font-mono text-[12px]">
                    {filePreviewMutation.isPending ? (
                      <div className="flex items-center justify-center py-12 text-[#a1a1aa]">
                        <Loader2 className="w-5 h-5 animate-spin mr-2 text-[#8b5cf6]" strokeWidth={1.5} />
                        Loading file preview…
                      </div>
                    ) : filePreviewMutation.isError ? (
                      <div className="text-red-400 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                        Failed to load file preview.
                      </div>
                    ) : filePreviewMutation.data ? (
                      filePreviewMutation.data.isBinary ? (
                        <div className="text-center py-10 text-[#a1a1aa]">
                          <FileText className="w-8 h-8 mx-auto mb-2 text-[#71717a]" strokeWidth={1.5} />
                          <p className="font-medium text-[14px] text-[#f4f4f5]">
                            {filePreviewMutation.data.content}
                          </p>
                          <p className="text-[12px] text-[#71717a] mt-1 tabular-nums">
                            File size: {formatBytes(filePreviewMutation.data.size)}
                          </p>
                        </div>
                      ) : (
                        <pre className="whitespace-pre-wrap break-all leading-relaxed text-[#d4d4d8]">
                          {filePreviewMutation.data.content}
                        </pre>
                      )
                    ) : null}
                  </div>

                  <div className="px-5 py-3 border-t border-white/[0.06] flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg border-white/[0.1] bg-[#111114] text-[#f4f4f5] hover:bg-white/[0.06]"
                      onClick={() => setPreviewFileState((prev) => ({ ...prev, isOpen: false }))}
                    >
                      Close
                    </Button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Connect GitHub Token Modal */}
          <AnimatePresence>
            {isTokenModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
                <motion.form
                  onSubmit={handleSaveToken}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15, ease: EASE_OUT }}
                  className="bg-[#111114] border border-white/[0.1] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Github className="w-4 h-4 text-[#f4f4f5]" strokeWidth={1.5} />
                      <h3 className="text-[16px] font-medium text-[#f4f4f5]">
                        Connect your GitHub account
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsTokenModalOpen(false)}
                      aria-label="Close"
                      className="p-1.5 hover:bg-white/[0.06] rounded-md text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors duration-150"
                    >
                      <X className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>

                  <p className="text-[13px] leading-[1.55] text-[#a1a1aa] [text-wrap:pretty]">
                    Paste a GitHub Personal Access Token with <code className="font-mono text-[#f4f4f5]">repo</code> scope. It is stored only in your browser session and sent per request — never saved on the server.
                  </p>

                  <div className="space-y-2">
                    <Input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="ghp_... or github_pat_..."
                      className="font-mono text-base sm:text-[13px] bg-[#09090b] border-white/[0.1]"
                      autoFocus
                    />
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo&description=RepoForge"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] text-[#c4b5fd] hover:underline"
                    >
                      Generate a token on GitHub
                      <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                    </a>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsTokenModalOpen(false)}
                      className="rounded-lg border-white/[0.1] bg-[#111114] text-[#f4f4f5] hover:bg-white/[0.06]"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!tokenInput.trim()}
                      className="rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] text-white"
                    >
                      Connect
                    </Button>
                  </div>
                </motion.form>
              </div>
            )}
          </AnimatePresence>

          {/* Recent GitHub Repos List */}
          {user && (
          <section className="mt-20 pt-10 border-t border-white/[0.06]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-[18px] font-medium tracking-[-0.01em] text-[#f4f4f5]">
                  Recent repositories
                </h2>
                <p className="text-[13px] text-[#71717a] mt-0.5">
                  Existing repositories on {user.login}
                </p>
              </div>
              <span className="text-[12px] font-mono text-[#a1a1aa] bg-[#111114] px-3 py-1 rounded-md border border-white/[0.08] tabular-nums">
                {user.publicRepos} public
              </span>
            </div>

            {isReposLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-28 bg-[#111114] rounded-xl border border-white/[0.06]" />
                ))}
              </div>
            ) : repos && repos.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {repos.slice(0, 9).map((repo) => (
                  <a
                    key={repo.name}
                    href={repo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block bg-[#111114] border border-white/[0.08] p-4 rounded-xl hover:border-white/[0.2] transition-[border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
                    data-testid={`repo-card-${repo.name}`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <span className="font-medium text-[14px] font-mono text-[#f4f4f5] truncate">
                        {repo.name}
                      </span>
                      {repo.private ? (
                        <span className="shrink-0 bg-white/[0.04] text-[#a1a1aa] text-[11px] font-mono px-2 py-0.5 rounded inline-flex items-center gap-1 border border-white/[0.06]">
                          <Lock className="w-3 h-3" strokeWidth={1.5} />
                          Private
                        </span>
                      ) : (
                        <span className="shrink-0 bg-[#8b5cf6]/10 text-[#c4b5fd] text-[11px] font-mono px-2 py-0.5 rounded inline-flex items-center gap-1 border border-[#8b5cf6]/20">
                          <Globe className="w-3 h-3" strokeWidth={1.5} />
                          Public
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-[#a1a1aa] line-clamp-2 mb-3 min-h-[2.4rem] leading-[1.45] [text-wrap:pretty]">
                      {repo.description || "No description"}
                    </p>
                    <div className="flex items-center justify-between text-[12px] font-mono text-[#71717a] pt-2.5 border-t border-white/[0.06] tabular-nums">
                      <span>{new Date(repo.createdAt).toLocaleDateString()}</span>
                      <span className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-[#f4f4f5]">
                        Open
                        <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 bg-[#111114] border border-dashed border-white/[0.08] rounded-xl">
                <p className="text-[14px] text-[#a1a1aa]">No repositories found.</p>
              </div>
            )}
          </section>
          )}

          <footer className="mt-16 pt-8 border-t border-white/[0.06] text-center text-[12px] text-[#71717a] font-mono">
            RepoForge — Archive to GitHub repository creator
          </footer>
        </div>
      </div>
    </MotionConfig>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/" component={GithubUploaderApp} />
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
