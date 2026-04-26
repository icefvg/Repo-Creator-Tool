import React, { useState, useRef } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import { UploadCloud, CheckCircle2, FileArchive, Lock, Globe, Github, AlertCircle, Loader2, Link as LinkIcon, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch as SwitchUI } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  useGetGithubUser,
  getGetGithubUserQueryKey,
  useListRecentRepos,
  getListRecentReposQueryKey,
  useUploadZipToGithub,
} from "@workspace/api-client-react";

const queryClient = new QueryClient();

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 24,
    },
  },
};

function GithubUploaderApp() {
  const qClient = useQueryClient();
  const { data: user, isLoading: isUserLoading, error: userError } = useGetGithubUser(undefined, {
    query: { queryKey: getGetGithubUserQueryKey() },
  });
  
  const { data: repos, isLoading: isReposLoading } = useListRecentRepos(undefined, {
    query: { queryKey: getListRecentReposQueryKey(), enabled: !!user },
  });

  const uploadMutation = useUploadZipToGithub();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [description, setDescription] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ repoName: string; repoUrl: string; filesUploaded: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    const { currentTarget, clientX, clientY } = event;
    const { left, top, width, height } = currentTarget.getBoundingClientRect();
    
    mouseX.set((clientX - left - width / 2) / 20);
    mouseY.set((clientY - top - height / 2) / 20);
  }

  const parallaxX = useTransform(mouseX, [-10, 10], [-5, 5]);
  const parallaxY = useTransform(mouseY, [-10, 10], [-5, 5]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.zip')) {
        setSelectedFile(file);
        setUploadResult(null);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
      setUploadResult(null);
    }
  };

  const handleUpload = () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("private", String(isPrivate));
    formData.append("description", description);

    uploadMutation.mutate({ data: formData as any }, {
      onSuccess: (data) => {
        setUploadResult({
          repoName: data.repoName,
          repoUrl: data.repoUrl,
          filesUploaded: data.filesUploaded,
        });
        qClient.invalidateQueries({ queryKey: getListRecentReposQueryKey() });
        setSelectedFile(null);
        setDescription("");
      }
    });
  };

  if (isUserLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Loader2 className="w-8 h-8 text-primary" />
        </motion.div>
      </div>
    );
  }

  if (userError || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-card border border-border p-8 rounded-2xl max-w-md w-full text-center"
        >
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">
            Please configure your GitHub token to use this tool.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 font-sans overflow-hidden">
      {/* Ambient background glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-accent/10 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12 relative z-10">
        
        {/* Header */}
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center justify-between mb-16"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-accent rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
              <Github className="text-white w-6 h-6" />
            </div>
            <span className="font-bold text-xl tracking-tight">RepoForge</span>
          </div>

          <div className="flex items-center gap-4 bg-card/50 backdrop-blur-md border border-border/50 py-2 px-4 rounded-full">
            <div className="flex items-center gap-2">
              <div className="relative">
                <motion.img 
                  layoutId="user-avatar"
                  src={user.avatarUrl} 
                  alt={user.login} 
                  className="w-8 h-8 rounded-full border border-border"
                />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background animate-pulse" />
              </div>
              <span className="text-sm font-medium">{user.login}</span>
            </div>
          </div>
        </motion.header>

        {/* Main Content */}
        <motion.main 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid gap-16"
        >
          
          {/* Hero / Upload Section */}
          <motion.section variants={itemVariants} className="max-w-2xl mx-auto w-full">
            <div className="text-center mb-10">
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
                Ship repositories faster.
              </h1>
              <p className="text-lg text-muted-foreground">
                Drop a ZIP file. The subfolder becomes the repo name. We handle the rest.
              </p>
            </div>

            <motion.div 
              onMouseMove={handleMouseMove}
              style={{ x: parallaxX, y: parallaxY }}
              className="relative"
            >
              {/* Animated Drag Zone */}
              <motion.div
                animate={{
                  scale: isDragging ? 1.02 : 1,
                  borderColor: isDragging ? "hsl(var(--primary))" : "hsl(var(--border))",
                  backgroundColor: isDragging ? "hsl(var(--primary) / 0.05)" : "hsl(var(--card))"
                }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="relative border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer overflow-hidden group"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept=".zip" 
                  onChange={handleFileChange} 
                />
                
                <AnimatePresence mode="wait">
                  {selectedFile ? (
                    <motion.div 
                      key="file-selected"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="flex flex-col items-center gap-4"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-2">
                        <FileArchive className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="font-semibold text-lg text-foreground">{selectedFile.name}</p>
                        <p className="text-sm text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }} className="mt-2">
                        Remove
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="upload-prompt"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-4"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-secondary text-muted-foreground flex items-center justify-center group-hover:scale-110 group-hover:text-primary transition-all duration-300">
                        <UploadCloud className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="font-medium text-lg mb-1">Click or drag ZIP file here</p>
                        <p className="text-sm text-muted-foreground">Maximum file size: 50MB</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.div>

            {/* Options */}
            <AnimatePresence>
              {selectedFile && !uploadResult && (
                <motion.div 
                  initial={{ opacity: 0, height: 0, y: -20 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -20 }}
                  className="mt-8 space-y-6"
                >
                  <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <h4 className="font-medium flex items-center gap-2">
                          {isPrivate ? <Lock className="w-4 h-4 text-muted-foreground" /> : <Globe className="w-4 h-4 text-muted-foreground" />}
                          Repository Visibility
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {isPrivate ? "Only you can see this repository." : "Anyone on the internet can see this repository."}
                        </p>
                      </div>
                      <SwitchUI checked={isPrivate} onCheckedChange={setIsPrivate} />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Description (optional)</label>
                      <Textarea 
                        placeholder="What is this repository for?" 
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="resize-none bg-background/50 border-border"
                      />
                    </div>
                  </div>

                  <Button 
                    onClick={handleUpload} 
                    disabled={uploadMutation.isPending}
                    className="w-full h-14 text-lg font-medium rounded-xl shadow-xl shadow-primary/20 transition-all"
                  >
                    {uploadMutation.isPending ? (
                      <motion.div className="flex items-center gap-2">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                        >
                          <Loader2 className="w-5 h-5" />
                        </motion.div>
                        Forging Repository...
                      </motion.div>
                    ) : (
                      "Create Repository"
                    )}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Success Card */}
            <AnimatePresence>
              {uploadResult && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  className="mt-8"
                >
                  <div className="bg-card border border-green-500/20 rounded-2xl p-8 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-400 to-emerald-500" />
                    <motion.div 
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", delay: 0.2 }}
                      className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4"
                    >
                      <CheckCircle2 className="w-8 h-8" />
                    </motion.div>
                    <h3 className="text-2xl font-bold mb-2 text-foreground">Ready for liftoff</h3>
                    <p className="text-muted-foreground mb-6">
                      Successfully pushed <span className="text-foreground font-medium">{uploadResult.filesUploaded} files</span> to <span className="text-foreground font-medium">{uploadResult.repoName}</span>
                    </p>
                    <Button 
                      asChild
                      className="bg-foreground text-background hover:bg-foreground/90 h-12 px-8 rounded-xl font-medium"
                    >
                      <a href={uploadResult.repoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                        View on GitHub <ExternalLink className="w-4 h-4" />
                      </a>
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

          {/* Recent Repos */}
          <motion.section 
            variants={itemVariants} 
            className="pt-12 border-t border-border/50"
            whileInView={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 20 }}
            viewport={{ once: true, margin: "-100px" }}
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold tracking-tight">Recent Forges</h2>
              <div className="text-sm text-muted-foreground bg-secondary/50 px-3 py-1 rounded-full border border-border/50">
                {user.publicRepos} Public Repos
              </div>
            </div>

            {isReposLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-32 bg-card/50 rounded-2xl border border-border animate-pulse" />
                ))}
              </div>
            ) : repos && repos.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AnimatePresence>
                  {repos.slice(0, 10).map((repo, i) => (
                    <motion.a
                      key={repo.name}
                      href={repo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      whileHover={{ y: -4, boxShadow: "0 10px 40px -10px rgba(0,0,0,0.3)" }}
                      className="group block bg-card border border-border p-5 rounded-2xl transition-colors hover:border-primary/50"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <Github className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                          <span className="font-semibold text-lg">{repo.name}</span>
                        </div>
                        {repo.private ? (
                          <span className="bg-secondary text-muted-foreground text-xs px-2 py-0.5 rounded flex items-center gap-1 border border-border/50">
                            <Lock className="w-3 h-3" /> Private
                          </span>
                        ) : (
                          <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded flex items-center gap-1 border border-primary/20">
                            <Globe className="w-3 h-3" /> Public
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1 mb-4">
                        {repo.description || "No description provided."}
                      </p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground/70">
                        <span>Created {new Date(repo.createdAt).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-primary">
                          View <ExternalLink className="w-3 h-3" />
                        </span>
                      </div>
                    </motion.a>
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <div className="text-center py-12 bg-card/30 border border-border/50 rounded-2xl border-dashed">
                <p className="text-muted-foreground">No recent repositories found.</p>
              </div>
            )}
          </motion.section>
        </motion.main>
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