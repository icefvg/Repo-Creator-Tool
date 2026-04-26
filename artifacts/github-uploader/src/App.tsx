import React, { useState, useRef, useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import {
  UploadCloud, CheckCircle2, FileArchive, Lock, Globe, Github,
  AlertCircle, Loader2, ExternalLink, FolderOpen, ArrowRight,
  RotateCcw, PackageOpen, X, ChevronRight, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch as SwitchUI } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

import {
  useGetGithubUser,
  getGetGithubUserQueryKey,
  useListRecentRepos,
  getListRecentReposQueryKey,
  usePreviewArchive,
  useUploadSelectedFolders,
} from "@workspace/api-client-react";

const queryClient = new QueryClient();

const ACCEPTED_FORMATS = ".zip,.tar,.tar.gz,.tgz,.tar.bz2,.tbz2,.tar.xz,.txz";

const spring = { type: "spring", stiffness: 320, damping: 28 } as const;

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: spring },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};

type Step = "drop" | "select" | "result";

interface FolderInfo { name: string; fileCount: number; }
interface RepoResult {
  folderName: string; repoName: string; repoUrl: string;
  filesUploaded: number; success: boolean; error?: string;
}

function GithubUploaderApp() {
  const qClient = useQueryClient();
  const { data: user, isLoading: isUserLoading, error: userError } =
    useGetGithubUser(undefined, { query: { queryKey: getGetGithubUserQueryKey() } });
  const { data: repos, isLoading: isReposLoading } = useListRecentRepos(undefined, {
    query: { queryKey: getListRecentReposQueryKey(), enabled: !!user },
  });

  const previewMutation = usePreviewArchive();
  const uploadMutation = useUploadSelectedFolders();

  const [step, setStep] = useState<Step>("drop");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [archiveName, setArchiveName] = useState<string>("");
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [repoNameOverrides, setRepoNameOverrides] = useState<Map<string, string>>(new Map());
  const [isPrivate, setIsPrivate] = useState(false);
  const [description, setDescription] = useState("");
  const [results, setResults] = useState<RepoResult[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const parallaxX = useTransform(mouseX, [-15, 15], [-6, 6]);
  const parallaxY = useTransform(mouseY, [-15, 15], [-6, 6]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - left - width / 2) / 20);
    mouseY.set((e.clientY - top - height / 2) / 20);
  }, [mouseX, mouseY]);

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file);
    setStep("drop");
    setResults([]);
    setSelectedFolders(new Set());
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handlePreview = useCallback(() => {
    if (!selectedFile) return;
    previewMutation.mutate({ data: { file: selectedFile } }, {
      onSuccess: (data) => {
        setSessionId(data.sessionId);
        setArchiveName(data.archiveName);
        setFolders(data.folders);
        setSelectedFolders(new Set(data.folders.map(f => f.name)));
        setRepoNameOverrides(new Map(data.folders.map(f => [f.name, f.name])));
        setStep("select");
      },
    });
  }, [selectedFile, previewMutation]);

  const handleUpload = useCallback(() => {
    if (!sessionId || selectedFolders.size === 0) return;
    const overrides: Record<string, string> = {};
    for (const [folder, name] of repoNameOverrides) {
      if (name.trim() && name.trim() !== folder) overrides[folder] = name.trim();
    }
    uploadMutation.mutate({
      data: {
        sessionId,
        selectedFolders: [...selectedFolders],
        repoNameOverrides: overrides,
        private: isPrivate,
        description,
      },
    }, {
      onSuccess: (data) => {
        setResults(data.results);
        setStep("result");
        qClient.invalidateQueries({ queryKey: getListRecentReposQueryKey() });
      },
    });
  }, [sessionId, selectedFolders, repoNameOverrides, isPrivate, description, uploadMutation, qClient]);

  const handleReset = useCallback(() => {
    setStep("drop");
    setSelectedFile(null);
    setSessionId("");
    setFolders([]);
    setSelectedFolders(new Set());
    setRepoNameOverrides(new Map());
    setDescription("");
    previewMutation.reset();
    uploadMutation.reset();
  }, [previewMutation, uploadMutation]);

  const handleRename = (folderName: string, value: string) => {
    setRepoNameOverrides(prev => {
      const next = new Map(prev);
      next.set(folderName, value);
      return next;
    });
  };

  const toggleFolder = (name: string) => {
    setSelectedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  if (isUserLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
          <Loader2 className="w-8 h-8 text-primary" />
        </motion.div>
      </div>
    );
  }

  if (userError || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-card border border-border p-8 rounded-2xl max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">GitHub Token Missing</h2>
          <p className="text-muted-foreground">Configure your GITHUB_TOKEN to use RepoForge.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-15%] left-[-5%] w-[45%] h-[45%] bg-primary/8 blur-[140px] rounded-full" />
        <div className="absolute bottom-[-15%] right-[-5%] w-[40%] h-[40%] bg-violet-500/6 blur-[140px] rounded-full" />
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10 relative z-10">

        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center justify-between mb-14"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-primary to-violet-400 rounded-xl flex items-center justify-center shadow-lg shadow-primary/25">
              <Github className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight">RepoForge</span>
          </div>
          <motion.div
            className="flex items-center gap-2.5 bg-card/60 backdrop-blur-md border border-border/50 py-2 px-4 rounded-full"
            whileHover={{ scale: 1.02 }}
          >
            <div className="relative">
              <img src={user.avatarUrl} alt={user.login} className="w-7 h-7 rounded-full border border-border" />
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-background" />
            </div>
            <span className="text-sm font-medium">{user.login}</span>
            <span className="text-xs text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">{user.publicRepos} repos</span>
          </motion.div>
        </motion.header>

        {/* Step indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 mb-10 max-w-2xl mx-auto"
        >
          {(["drop", "select", "result"] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${step === s ? "text-foreground" : i < ["drop","select","result"].indexOf(step) ? "text-primary" : "text-muted-foreground/40"}`}>
                <motion.div
                  animate={{ scale: step === s ? 1 : 0.85, backgroundColor: step === s ? "hsl(var(--primary))" : i < ["drop","select","result"].indexOf(step) ? "hsl(var(--primary) / 0.4)" : "hsl(var(--secondary))" }}
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                >
                  {i < ["drop","select","result"].indexOf(step) ? "✓" : i + 1}
                </motion.div>
                <span className="hidden sm:inline">{s === "drop" ? "Upload" : s === "select" ? "Select" : "Done"}</span>
              </div>
              {i < 2 && <ChevronRight className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />}
            </React.Fragment>
          ))}
        </motion.div>

        {/* Main card */}
        <motion.main className="max-w-2xl mx-auto" layout>

          {/* STEP 1: Drop */}
          <AnimatePresence mode="wait">
            {step === "drop" && (
              <motion.div key="drop" variants={stagger} initial="hidden" animate="visible" exit={{ opacity: 0, y: -10 }}>

                <motion.div variants={fadeUp} className="text-center mb-8">
                  <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-3 bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground to-foreground/50">
                    Ship repos faster.
                  </h1>
                  <p className="text-muted-foreground text-base">
                    Upload a ZIP, TAR, or any archive. Pick folders. Each becomes a GitHub repo.
                  </p>
                </motion.div>

                {/* Format badges */}
                <motion.div variants={fadeUp} className="flex flex-wrap gap-1.5 justify-center mb-8">
                  {[".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz"].map(fmt => (
                    <span key={fmt} className="text-[11px] font-mono bg-secondary/60 text-muted-foreground border border-border/40 px-2 py-0.5 rounded-md">{fmt}</span>
                  ))}
                </motion.div>

                {/* Drop zone */}
                <motion.div variants={fadeUp} onMouseMove={handleMouseMove} style={{ x: parallaxX, y: parallaxY }}>
                  <motion.div
                    data-testid="dropzone"
                    animate={{
                      scale: isDragging ? 1.025 : 1,
                      borderColor: isDragging ? "hsl(var(--primary))" : selectedFile ? "hsl(var(--primary) / 0.5)" : "hsl(var(--border))",
                      backgroundColor: isDragging ? "hsl(var(--primary) / 0.04)" : "hsl(var(--card))",
                    }}
                    transition={spring}
                    className="relative border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer group overflow-hidden"
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept={ACCEPTED_FORMATS}
                      data-testid="file-input"
                      onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                    />

                    <AnimatePresence mode="wait">
                      {selectedFile ? (
                        <motion.div key="file" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex flex-col items-center gap-3">
                          <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                            <FileArchive className="w-8 h-8" />
                          </div>
                          <div>
                            <p className="font-semibold text-lg">{selectedFile.name}</p>
                            <p className="text-sm text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); setSelectedFile(null); }} data-testid="remove-file">
                            <X className="w-3.5 h-3.5 mr-1.5" /> Remove
                          </Button>
                        </motion.div>
                      ) : (
                        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4">
                          <div className="w-16 h-16 rounded-2xl bg-secondary text-muted-foreground flex items-center justify-center group-hover:scale-110 group-hover:text-primary transition-all duration-300">
                            <UploadCloud className="w-8 h-8" />
                          </div>
                          <div>
                            <p className="font-medium text-lg mb-1">Click or drag archive here</p>
                            <p className="text-sm text-muted-foreground">ZIP, TAR, TAR.GZ, TGZ, TAR.BZ2, TAR.XZ · Max 100MB</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </motion.div>

                {/* Error */}
                <AnimatePresence>
                  {previewMutation.isError && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="mt-4 flex items-start gap-2.5 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{(previewMutation.error as any)?.message ?? "Failed to extract archive"}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* CTA */}
                <AnimatePresence>
                  {selectedFile && (
                    <motion.div variants={fadeUp} initial="hidden" animate="visible" exit={{ opacity: 0, height: 0 }} className="mt-6">
                      <Button
                        onClick={handlePreview}
                        disabled={previewMutation.isPending}
                        className="w-full h-13 text-base font-semibold rounded-xl shadow-lg shadow-primary/20"
                        data-testid="preview-btn"
                        size="lg"
                      >
                        {previewMutation.isPending ? (
                          <span className="flex items-center gap-2">
                            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}>
                              <Loader2 className="w-4.5 h-4.5" />
                            </motion.div>
                            Scanning archive...
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <PackageOpen className="w-4.5 h-4.5" />
                            Scan & Select Folders
                            <ArrowRight className="w-4 h-4" />
                          </span>
                        )}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* STEP 2: Select folders */}
            {step === "select" && (
              <motion.div key="select" variants={stagger} initial="hidden" animate="visible" exit={{ opacity: 0, y: -10 }}>

                <motion.div variants={fadeUp} className="mb-6">
                  <div className="flex items-center gap-3 mb-1">
                    <button onClick={handleReset} className="text-muted-foreground hover:text-foreground transition-colors">
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <h2 className="text-2xl font-bold tracking-tight">Select Folders</h2>
                  </div>
                  <p className="text-muted-foreground text-sm ml-7">
                    Found <span className="text-foreground font-medium">{folders.length}</span> folder{folders.length !== 1 ? "s" : ""} in <span className="text-foreground font-medium">{archiveName}</span>. Each selected folder becomes a separate repo.
                  </p>
                </motion.div>

                {/* Folder list */}
                <motion.div variants={stagger} className="space-y-2 mb-6">
                  {folders.map((folder) => {
                    const checked = selectedFolders.has(folder.name);
                    const repoName = repoNameOverrides.get(folder.name) ?? folder.name;
                    const isRenamed = repoName.trim() && repoName.trim() !== folder.name;
                    return (
                      <motion.div
                        key={folder.name}
                        variants={fadeUp}
                        transition={spring}
                        data-testid={`folder-${folder.name}`}
                        className={`rounded-xl border transition-colors ${
                          checked ? "bg-primary/5 border-primary/30" : "bg-card border-border opacity-60 hover:opacity-80"
                        }`}
                      >
                        {/* Top row: checkbox + folder source name */}
                        <div
                          className="flex items-center justify-between px-4 pt-3.5 pb-2 cursor-pointer select-none"
                          onClick={() => toggleFolder(folder.name)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleFolder(folder.name)}
                              className="pointer-events-none flex-shrink-0"
                              data-testid={`checkbox-${folder.name}`}
                            />
                            <FolderOpen className={`w-4 h-4 flex-shrink-0 ${checked ? "text-primary" : "text-muted-foreground"}`} />
                            <span className={`font-mono text-sm truncate ${checked ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                              {folder.name}
                            </span>
                          </div>
                          <span className="text-xs bg-secondary/60 border border-border/30 px-2 py-0.5 rounded-md ml-2 flex-shrink-0">
                            {folder.fileCount} file{folder.fileCount !== 1 ? "s" : ""}
                          </span>
                        </div>

                        {/* Repo name row (only when checked) */}
                        <AnimatePresence>
                          {checked && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.18 }}
                              className="overflow-hidden"
                            >
                              <div className="flex items-center gap-2 px-4 pb-3.5 pt-0.5">
                                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                                <div className="relative flex-1">
                                  <Pencil className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50 pointer-events-none" />
                                  <Input
                                    value={repoName}
                                    onChange={e => handleRename(folder.name, e.target.value)}
                                    onClick={e => e.stopPropagation()}
                                    onKeyDown={e => e.stopPropagation()}
                                    className="h-7 pl-7 text-xs font-mono bg-background/60 border-border/40 focus-visible:ring-1 focus-visible:ring-primary/40"
                                    placeholder={folder.name}
                                    data-testid={`rename-input-${folder.name}`}
                                  />
                                </div>
                                {isRenamed && (
                                  <button
                                    onClick={e => { e.stopPropagation(); handleRename(folder.name, folder.name); }}
                                    className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0"
                                    title="Reset to folder name"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </motion.div>

                {/* Options */}
                <motion.div variants={fadeUp} className="bg-card border border-border rounded-2xl p-5 space-y-5 mb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 font-medium text-sm">
                        {isPrivate ? <Lock className="w-4 h-4 text-muted-foreground" /> : <Globe className="w-4 h-4 text-muted-foreground" />}
                        Repository Visibility
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isPrivate ? "Private — only you" : "Public — visible to everyone"}
                      </p>
                    </div>
                    <SwitchUI checked={isPrivate} onCheckedChange={setIsPrivate} data-testid="toggle-private" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                    <Textarea
                      placeholder="What are these repos for?"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      className="resize-none bg-background/50 text-sm"
                      rows={2}
                      data-testid="description-input"
                    />
                  </div>
                </motion.div>

                {/* Upload error */}
                <AnimatePresence>
                  {uploadMutation.isError && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="mb-4 flex items-start gap-2.5 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{(uploadMutation.error as any)?.message ?? "Upload failed"}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.div variants={fadeUp} className="flex gap-3">
                  <Button variant="outline" onClick={handleReset} className="flex-shrink-0 rounded-xl" data-testid="back-btn">
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={handleUpload}
                    disabled={selectedFolders.size === 0 || uploadMutation.isPending}
                    className="flex-1 h-12 text-base font-semibold rounded-xl shadow-lg shadow-primary/20"
                    data-testid="upload-btn"
                  >
                    {uploadMutation.isPending ? (
                      <span className="flex items-center gap-2">
                        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}>
                          <Loader2 className="w-4 h-4" />
                        </motion.div>
                        Creating {selectedFolders.size} repo{selectedFolders.size !== 1 ? "s" : ""}...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        Create {selectedFolders.size} Repo{selectedFolders.size !== 1 ? "s" : ""}
                        <ArrowRight className="w-4 h-4" />
                      </span>
                    )}
                  </Button>
                </motion.div>
              </motion.div>
            )}

            {/* STEP 3: Results */}
            {step === "result" && (
              <motion.div key="result" variants={stagger} initial="hidden" animate="visible" exit={{ opacity: 0 }}>

                <motion.div variants={fadeUp} className="text-center mb-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.15, stiffness: 260, damping: 18 }}
                    className="w-20 h-20 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-5"
                  >
                    <CheckCircle2 className="w-10 h-10" />
                  </motion.div>
                  <h2 className="text-3xl font-extrabold tracking-tight mb-2">
                    {results.filter(r => r.success).length === results.length ? "All repos created!" : `${results.filter(r => r.success).length} of ${results.length} created`}
                  </h2>
                  <p className="text-muted-foreground">Your repositories are live on GitHub.</p>
                </motion.div>

                <motion.div variants={stagger} className="space-y-3 mb-8">
                  {results.map((r, i) => (
                    <motion.div
                      key={r.folderName}
                      variants={fadeUp}
                      className={`flex items-center justify-between p-4 rounded-xl border ${r.success ? "bg-card border-emerald-500/20" : "bg-destructive/5 border-destructive/20"}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {r.success
                          ? <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 flex-shrink-0" />
                          : <AlertCircle className="w-4.5 h-4.5 text-destructive flex-shrink-0" />}
                        <div className="min-w-0">
                          <p className="font-mono font-medium text-sm truncate">{r.repoName}</p>
                          {r.success
                            ? <p className="text-xs text-muted-foreground">{r.filesUploaded} file{r.filesUploaded !== 1 ? "s" : ""} uploaded</p>
                            : <p className="text-xs text-destructive">{r.error}</p>}
                        </div>
                      </div>
                      {r.success && (
                        <a href={r.repoUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors flex-shrink-0 ml-3"
                          data-testid={`view-repo-${r.repoName}`}>
                          View <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </motion.div>
                  ))}
                </motion.div>

                <motion.div variants={fadeUp}>
                  <Button onClick={handleReset} variant="outline" className="w-full h-12 rounded-xl" data-testid="upload-another-btn">
                    <RotateCcw className="w-4 h-4 mr-2" /> Upload Another Archive
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.main>

        {/* Recent Repos */}
        <motion.section
          className="mt-20 pt-10 border-t border-border/40 max-w-5xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-center justify-between mb-7">
            <h2 className="text-xl font-bold tracking-tight">Recent Repos</h2>
            <span className="text-xs text-muted-foreground bg-secondary/50 px-3 py-1 rounded-full border border-border/40">
              {user.publicRepos} public
            </span>
          </div>

          {isReposLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-28 bg-card/40 rounded-xl border border-border animate-pulse" />
              ))}
            </div>
          ) : repos && repos.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <AnimatePresence>
                {repos.slice(0, 9).map((repo, i) => (
                  <motion.a
                    key={repo.name}
                    href={repo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    whileHover={{ y: -3, boxShadow: "0 8px 30px -8px rgba(0,0,0,0.4)" }}
                    className="group block bg-card border border-border p-4 rounded-xl hover:border-primary/30 transition-colors"
                    data-testid={`repo-card-${repo.name}`}
                  >
                    <div className="flex justify-between items-start mb-2.5">
                      <span className="font-semibold text-sm truncate mr-2">{repo.name}</span>
                      {repo.private
                        ? <span className="flex-shrink-0 bg-secondary text-muted-foreground text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 border border-border/40"><Lock className="w-2.5 h-2.5" />Private</span>
                        : <span className="flex-shrink-0 bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 border border-primary/20"><Globe className="w-2.5 h-2.5" />Public</span>
                      }
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3 min-h-[2rem]">
                      {repo.description || "No description"}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground/60">
                      <span>{new Date(repo.createdAt).toLocaleDateString()}</span>
                      <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-primary">
                        Open <ExternalLink className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  </motion.a>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="text-center py-10 bg-card/30 border border-dashed border-border/50 rounded-xl">
              <p className="text-sm text-muted-foreground">No repositories yet.</p>
            </div>
          )}
        </motion.section>

        <footer className="mt-16 text-center text-xs text-muted-foreground/40">
          RepoForge — drop archives, forge repos
        </footer>
      </div>
    </div>
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
