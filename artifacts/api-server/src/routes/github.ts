import { Router } from "express";
import multer from "multer";
import unzipper from "unzipper";
import { Readable } from "stream";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = "https://api.github.com";

async function githubFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  return res;
}

router.get("/github/me", async (req, res) => {
  if (!GITHUB_TOKEN) {
    res.status(500).json({ error: "GitHub token not configured" });
    return;
  }
  try {
    const r = await githubFetch("/user");
    if (!r.ok) {
      const body = await r.text();
      res.status(r.status).json({ error: "GitHub API error", details: body });
      return;
    }
    const user = await r.json() as Record<string, unknown>;
    res.json({
      login: user["login"],
      name: user["name"] ?? null,
      avatarUrl: user["avatar_url"],
      publicRepos: user["public_repos"],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get GitHub user");
    res.status(500).json({ error: "Failed to fetch GitHub user" });
  }
});

router.get("/github/repos", async (req, res) => {
  if (!GITHUB_TOKEN) {
    res.status(500).json({ error: "GitHub token not configured" });
    return;
  }
  try {
    const r = await githubFetch("/user/repos?sort=created&direction=desc&per_page=10");
    if (!r.ok) {
      const body = await r.text();
      res.status(r.status).json({ error: "GitHub API error", details: body });
      return;
    }
    const repos = await r.json() as Record<string, unknown>[];
    res.json(repos.map((repo) => ({
      name: repo["name"],
      fullName: repo["full_name"],
      url: repo["html_url"],
      private: repo["private"],
      createdAt: repo["created_at"],
      description: repo["description"] ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list repos");
    res.status(500).json({ error: "Failed to list repos" });
  }
});

router.post("/github/upload", upload.single("file"), async (req, res) => {
  if (!GITHUB_TOKEN) {
    res.status(500).json({ error: "GitHub token not configured" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No ZIP file uploaded" });
    return;
  }

  const isPrivate = req.body.private === "true" || req.body.private === true;
  const description: string = req.body.description ?? "";

  try {
    // Extract ZIP in memory
    const zipBuffer = req.file.buffer;
    const directory = await unzipper.Open.buffer(zipBuffer);

    // Find the top-level subfolder(s) — these become the repo name
    // Structure: zip -> subfolder -> files...
    const allPaths = directory.files.map((f) => f.path);

    // Find unique top-level directories
    const topLevelDirs = new Set<string>();
    for (const p of allPaths) {
      const parts = p.split("/");
      if (parts.length > 1 && parts[0]) {
        topLevelDirs.add(parts[0]);
      }
    }

    if (topLevelDirs.size === 0) {
      res.status(400).json({ error: "ZIP must contain at least one subfolder. Files at root level are not supported." });
      return;
    }

    // Use the first top-level directory as the repo name
    const repoName = [...topLevelDirs][0].replace(/[^a-zA-Z0-9._-]/g, "-");

    // Get the authenticated user's login for the repo URL
    const meRes = await githubFetch("/user");
    if (!meRes.ok) {
      res.status(500).json({ error: "Failed to authenticate with GitHub" });
      return;
    }
    const me = await meRes.json() as Record<string, unknown>;
    const login = me["login"] as string;

    // Create the repository
    const createRes = await githubFetch("/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name: repoName,
        private: isPrivate,
        description,
        auto_init: false,
      }),
    });

    if (!createRes.ok) {
      const errBody = await createRes.json() as Record<string, unknown>;
      const msg = (errBody["message"] as string) ?? "Failed to create repository";
      res.status(400).json({ error: msg, details: JSON.stringify(errBody["errors"] ?? "") });
      return;
    }

    // Read all files from the ZIP that belong to the first top-level folder
    const filesToUpload: { path: string; content: Buffer }[] = [];

    for (const file of directory.files) {
      if (file.type === "Directory") continue;
      const parts = file.path.split("/");
      if (parts[0] !== [...topLevelDirs][0]) continue;

      // Get path relative to the subfolder
      const relativePath = parts.slice(1).join("/");
      if (!relativePath) continue;

      const content = await file.buffer();
      filesToUpload.push({ path: relativePath, content });
    }

    if (filesToUpload.length === 0) {
      res.status(400).json({ error: "No files found inside the subfolder" });
      return;
    }

    // Upload files one by one via GitHub Contents API
    let filesUploaded = 0;
    for (const f of filesToUpload) {
      const encoded = f.content.toString("base64");
      const uploadRes = await githubFetch(`/repos/${login}/${repoName}/contents/${f.path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `Add ${f.path}`,
          content: encoded,
        }),
      });
      if (uploadRes.ok) {
        filesUploaded++;
      } else {
        req.log.warn({ path: f.path, status: uploadRes.status }, "Failed to upload file");
      }
    }

    res.json({
      repoName,
      repoUrl: `https://github.com/${login}/${repoName}`,
      filesUploaded,
      message: `Repository "${repoName}" created with ${filesUploaded} file(s) uploaded successfully.`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to upload ZIP to GitHub");
    res.status(500).json({ error: "Failed to process ZIP file", details: String(err) });
  }
});

export default router;
