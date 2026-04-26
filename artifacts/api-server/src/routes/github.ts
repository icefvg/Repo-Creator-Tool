import { Router } from "express";
import multer from "multer";
import decompress from "decompress";
import { randomUUID } from "crypto";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = "https://api.github.com";

// In-memory session store: sessionId -> extracted folder contents
type FileEntry = { path: string; content: Buffer };
type SessionData = {
  folders: Map<string, FileEntry[]>;
  archiveName: string;
  expiresAt: number;
};
const sessions = new Map<string, SessionData>();

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(id);
  }
}, 5 * 60 * 1000);

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
  } catch (err) {
    throw new Error(`Could not extract archive "${filename}". Supported formats: .zip, .tar, .tar.gz, .tgz, .tar.bz2, .tar.xz`);
  }

  const folderMap = new Map<string, FileEntry[]>();

  for (const file of files) {
    if (file.type === "directory" || !file.data || file.data.length === 0) continue;

    const normalized = file.path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length < 2) continue; // skip root-level files

    const topFolder = parts[0];
    const relativePath = parts.slice(1).join("/");
    if (!relativePath) continue;

    if (!folderMap.has(topFolder)) folderMap.set(topFolder, []);
    folderMap.get(topFolder)!.push({ path: relativePath, content: file.data });
  }

  return folderMap;
}

// GET /github/me
router.get("/github/me", async (req, res) => {
  if (!GITHUB_TOKEN) { res.status(500).json({ error: "GitHub token not configured" }); return; }
  try {
    const r = await githubFetch("/user");
    if (!r.ok) { res.status(r.status).json({ error: "GitHub API error", details: await r.text() }); return; }
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
    if (!r.ok) { res.status(r.status).json({ error: "GitHub API error", details: await r.text() }); return; }
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

// POST /github/preview — upload archive, return folder list + store session
router.post("/github/preview", upload.single("file"), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No archive file uploaded" }); return; }
  try {
    const folderMap = await extractArchive(req.file.buffer, req.file.originalname);
    if (folderMap.size === 0) {
      res.status(400).json({ error: "No subfolders found. Archive must contain at least one folder with files inside it. Root-level files are ignored." });
      return;
    }

    const sessionId = randomUUID();
    sessions.set(sessionId, {
      folders: folderMap,
      archiveName: req.file.originalname,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    res.json({
      sessionId,
      folders: [...folderMap.entries()].map(([name, files]) => ({ name, fileCount: files.length })),
      archiveName: req.file.originalname,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to extract archive");
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /github/upload-selected — create one repo per selected folder
router.post("/github/upload-selected", async (req, res) => {
  if (!GITHUB_TOKEN) { res.status(500).json({ error: "GitHub token not configured" }); return; }

  const { sessionId, selectedFolders, private: isPrivate = false, description = "" } = req.body as {
    sessionId: string; selectedFolders: string[]; private?: boolean; description?: string;
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

  const meRes = await githubFetch("/user");
  if (!meRes.ok) { res.status(500).json({ error: "Failed to authenticate with GitHub" }); return; }
  const me = await meRes.json() as Record<string, unknown>;
  const login = me["login"] as string;

  const results: {
    folderName: string; repoName: string; repoUrl: string;
    filesUploaded: number; success: boolean; error?: string;
  }[] = [];

  for (const folderName of selectedFolders) {
    const files = session.folders.get(folderName);
    if (!files) {
      results.push({ folderName, repoName: folderName, repoUrl: "", filesUploaded: 0, success: false, error: "Folder not found in session" });
      continue;
    }

    const repoName = folderName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "repo";

    const createRes = await githubFetch("/user/repos", {
      method: "POST",
      body: JSON.stringify({ name: repoName, private: isPrivate, description, auto_init: false }),
    });

    if (!createRes.ok) {
      const errBody = await createRes.json() as Record<string, unknown>;
      results.push({ folderName, repoName, repoUrl: "", filesUploaded: 0, success: false, error: String(errBody["message"] ?? "Failed to create repo") });
      continue;
    }

    let filesUploaded = 0;
    for (const f of files) {
      const encoded = f.content.toString("base64");
      const uploadRes = await githubFetch(`/repos/${login}/${repoName}/contents/${f.path}`, {
        method: "PUT",
        body: JSON.stringify({ message: `Add ${f.path}`, content: encoded }),
      });
      if (uploadRes.ok) filesUploaded++;
      else req.log.warn({ path: f.path, status: uploadRes.status }, "Failed to upload file");
    }

    results.push({ folderName, repoName, repoUrl: `https://github.com/${login}/${repoName}`, filesUploaded, success: true });
  }

  res.json({
    results,
    totalCreated: results.filter(r => r.success).length,
    totalFailed: results.filter(r => !r.success).length,
  });
});

export default router;
