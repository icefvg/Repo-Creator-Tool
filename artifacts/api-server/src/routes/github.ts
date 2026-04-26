import { Router } from "express";
import multer from "multer";
import decompress from "decompress";
import { randomUUID } from "crypto";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = "https://api.github.com";

// ─── Session store ────────────────────────────────────────────────────────────
type FileEntry = { path: string; content: Buffer };
type SessionData = {
  folders: Map<string, FileEntry[]>;
  archiveName: string;
  expiresAt: number;
};
const sessions = new Map<string, SessionData>();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt < now) sessions.delete(id);
}, 5 * 60 * 1000);

// ─── Job store ────────────────────────────────────────────────────────────────
type JobStatus = "pending" | "running" | "done" | "failed";

interface RepoResult {
  folderName: string; repoName: string; repoUrl: string;
  filesUploaded: number; success: boolean; error?: string;
}

interface JobState {
  jobId: string;
  status: JobStatus;
  progress: { total: number; completed: number; currentRepo?: string; currentAction?: string; };
  results: RepoResult[];
  error?: string;
  createdAt: number;
  expiresAt: number;
}

const jobs = new Map<string, JobState>();

// Clean up jobs older than 2 hours
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.expiresAt < now) jobs.delete(id);
}, 30 * 60 * 1000);

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function githubFetch(path: string, options: RequestInit = {}) {
  return fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

async function extractArchive(buffer: Buffer, filename: string): Promise<Map<string, FileEntry[]>> {
  let files: decompress.File[];
  try {
    files = await decompress(buffer);
  } catch {
    throw new Error(`Could not extract "${filename}". Supported: .zip .tar .tar.gz .tgz .tar.bz2 .tar.xz`);
  }

  const folderMap = new Map<string, FileEntry[]>();
  for (const file of files) {
    if (file.type === "directory" || !file.data || file.data.length === 0) continue;
    const normalized = file.path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const topFolder = parts[0];
    const relativePath = parts.slice(1).join("/");
    if (!relativePath) continue;
    if (!folderMap.has(topFolder)) folderMap.set(topFolder, []);
    folderMap.get(topFolder)!.push({ path: relativePath, content: file.data });
  }
  return folderMap;
}

// Background job processor — runs detached from the HTTP request
async function processJob(
  jobId: string,
  session: SessionData,
  selectedFolders: string[],
  repoNameOverrides: Record<string, string>,
  isPrivate: boolean,
  description: string,
) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.progress.total = selectedFolders.length;

  try {
    const meRes = await githubFetch("/user");
    if (!meRes.ok) throw new Error("Failed to authenticate with GitHub");
    const me = await meRes.json() as Record<string, unknown>;
    const login = me["login"] as string;

    for (const folderName of selectedFolders) {
      job.progress.currentRepo = folderName;
      job.progress.currentAction = "Creating repository…";

      const files = session.folders.get(folderName);
      if (!files) {
        job.results.push({ folderName, repoName: folderName, repoUrl: "", filesUploaded: 0, success: false, error: "Folder not found in session" });
        job.progress.completed++;
        continue;
      }

      const rawName = (repoNameOverrides[folderName] ?? folderName).trim() || folderName;
      const repoName = rawName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "repo";

      const createRes = await githubFetch("/user/repos", {
        method: "POST",
        body: JSON.stringify({ name: repoName, private: isPrivate, description, auto_init: false }),
      });

      if (!createRes.ok) {
        const errBody = await createRes.json() as Record<string, unknown>;
        job.results.push({ folderName, repoName, repoUrl: "", filesUploaded: 0, success: false, error: String(errBody["message"] ?? "Failed to create repo") });
        job.progress.completed++;
        continue;
      }

      job.progress.currentAction = `Uploading ${files.length} file${files.length !== 1 ? "s" : ""}…`;
      let filesUploaded = 0;

      for (const f of files) {
        const encoded = f.content.toString("base64");
        const uploadRes = await githubFetch(`/repos/${login}/${repoName}/contents/${f.path}`, {
          method: "PUT",
          body: JSON.stringify({ message: `Add ${f.path}`, content: encoded }),
        });
        if (uploadRes.ok) filesUploaded++;
      }

      job.results.push({ folderName, repoName, repoUrl: `https://github.com/${login}/${repoName}`, filesUploaded, success: true });
      job.progress.completed++;
    }

    job.status = "done";
    job.progress.currentRepo = undefined;
    job.progress.currentAction = undefined;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /github/me
router.get("/github/me", async (req, res) => {
  if (!GITHUB_TOKEN) { res.status(500).json({ error: "GitHub token not configured" }); return; }
  try {
    const r = await githubFetch("/user");
    if (!r.ok) { res.status(r.status).json({ error: "GitHub API error" }); return; }
    const user = await r.json() as Record<string, unknown>;
    res.json({ login: user["login"], name: user["name"] ?? null, avatarUrl: user["avatar_url"], publicRepos: user["public_repos"] });
  } catch (err) {
    req.log.error({ err }, "Failed to get GitHub user");
    res.status(500).json({ error: "Failed to fetch GitHub user" });
  }
});

// GET /github/repos
router.get("/github/repos", async (req, res) => {
  if (!GITHUB_TOKEN) { res.status(500).json({ error: "GitHub token not configured" }); return; }
  try {
    const r = await githubFetch("/user/repos?sort=created&direction=desc&per_page=10");
    if (!r.ok) { res.status(r.status).json({ error: "GitHub API error" }); return; }
    const repos = await r.json() as Record<string, unknown>[];
    res.json(repos.map(repo => ({
      name: repo["name"], fullName: repo["full_name"], url: repo["html_url"],
      private: repo["private"], createdAt: repo["created_at"], description: repo["description"] ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list repos");
    res.status(500).json({ error: "Failed to list repos" });
  }
});

// POST /github/preview
router.post("/github/preview", upload.single("file"), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No archive file uploaded" }); return; }
  try {
    const folderMap = await extractArchive(req.file.buffer, req.file.originalname);
    if (folderMap.size === 0) {
      res.status(400).json({ error: "No subfolders found. Archive must contain at least one folder with files inside it. Root-level files are ignored." });
      return;
    }
    const sessionId = randomUUID();
    sessions.set(sessionId, { folders: folderMap, archiveName: req.file.originalname, expiresAt: Date.now() + 15 * 60 * 1000 });
    res.json({
      sessionId,
      folders: [...folderMap.entries()].map(([name, files]) => ({ name, fileCount: files.length })),
      archiveName: req.file.originalname,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to extract archive");
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /github/upload-selected — spawn background job, return jobId immediately
router.post("/github/upload-selected", async (req, res) => {
  if (!GITHUB_TOKEN) { res.status(500).json({ error: "GitHub token not configured" }); return; }

  const { sessionId, selectedFolders, repoNameOverrides = {}, private: isPrivate = false, description = "" } = req.body as {
    sessionId: string; selectedFolders: string[]; repoNameOverrides?: Record<string, string>;
    private?: boolean; description?: string;
  };

  if (!sessionId || !selectedFolders?.length) {
    res.status(400).json({ error: "sessionId and at least one selectedFolder are required" });
    return;
  }

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    res.status(400).json({ error: "Session expired. Please re-upload the archive." });
    return;
  }

  const jobId = randomUUID();
  const job: JobState = {
    jobId, status: "pending",
    progress: { total: selectedFolders.length, completed: 0 },
    results: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
  };
  jobs.set(jobId, job);

  // Fire-and-forget — browser can close, job keeps running
  processJob(jobId, session, selectedFolders, repoNameOverrides, isPrivate, description)
    .catch(err => req.log.error({ err, jobId }, "Job processing error"));

  res.json({ jobId });
});

// GET /github/jobs/:jobId
router.get("/github/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found or expired" }); return; }
  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    results: job.results,
    error: job.error,
    createdAt: job.createdAt,
  });
});

export default router;
