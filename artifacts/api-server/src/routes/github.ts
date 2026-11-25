import { Router, type Request } from "express";
import multer from "multer";
import decompress from "decompress";
import { randomUUID } from "crypto";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const ENV_GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = "https://api.github.com";

function resolveGithubToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const headerToken = req.headers["x-github-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }
  return ENV_GITHUB_TOKEN || undefined;
}

// ─── Types & Interfaces ────────────────────────────────────────────────────────
export type LicenseType = "MIT" | "Apache-2.0" | "GPL-3.0" | "BSD-3-Clause" | "None";

export interface TechDetection {
  framework: string;
  language: string;
  topics: string[];
  badges: string[];
  recommendedGitignore: string;
}

export interface FileEntry {
  path: string;
  content: Buffer;
}

export interface FileTreeNode {
  path: string;
  size: number;
  type: "file" | "directory";
}

export interface FolderInfo {
  name: string;
  fileCount: number;
  totalSizeBytes: number;
  detectedTech: TechDetection;
  files: FileTreeNode[];
}

export interface FolderRepoConfig {
  repoName?: string;
  private?: boolean;
  description?: string;
  topics?: string[];
  license?: LicenseType;
  generateReadme?: boolean;
  generateGitignore?: boolean;
}

export type RepoUploadStatus = "queued" | "uploading" | "done" | "failed";

export interface RepoUploadResult {
  folderName: string;
  repoName: string;
  repoUrl: string;
  filesUploaded: number;
  success: boolean;
  error?: string;
  status?: RepoUploadStatus;
  detectedTech?: TechDetection;
}

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface JobState {
  jobId: string;
  status: JobStatus;
  progress: {
    total: number;
    completed: number;
    currentRepo?: string;
    currentAction?: string;
  };
  results: RepoUploadResult[];
  error?: string;
  createdAt: number;
  expiresAt: number;
}

interface SessionData {
  folders: Map<string, FileEntry[]>;
  archiveName: string;
  expiresAt: number;
}

// ─── In-memory Stores ─────────────────────────────────────────────────────────
const sessions = new Map<string, SessionData>();
const jobs = new Map<string, JobState>();

// Session cleanup every 5 mins
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt < now) sessions.delete(id);
}, 5 * 60 * 1000);

// Job cleanup every 30 mins
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.expiresAt < now) jobs.delete(id);
}, 30 * 60 * 1000);

// ─── Tech Detection & Helpers ─────────────────────────────────────────────────
function detectTechStack(files: FileEntry[]): TechDetection {
  const paths = new Set(files.map((f) => f.path.toLowerCase()));
  const filenames = new Set(files.map((f) => f.path.split("/").pop()?.toLowerCase() ?? ""));

  let packageJson: any = null;
  const pkgFile = files.find((f) => f.path.toLowerCase() === "package.json");
  if (pkgFile) {
    try {
      packageJson = JSON.parse(pkgFile.content.toString("utf-8"));
    } catch {}
  }

  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };

  const isTs = Array.from(paths).some((p) => p.endsWith(".ts") || p.endsWith(".tsx"));

  // 1. Next.js
  if (
    Array.from(filenames).some((f) => f.startsWith("next.config.")) ||
    "next" in deps
  ) {
    return {
      framework: "Next.js",
      language: isTs ? "TypeScript" : "JavaScript",
      topics: ["nextjs", "react", isTs ? "typescript" : "javascript", "web"],
      badges: ["Next.js", "React"],
      recommendedGitignore: "node",
    };
  }

  // 2. React + Vite
  if (
    Array.from(filenames).some((f) => f.startsWith("vite.config.")) ||
    "vite" in deps ||
    ("react" in deps && "react-dom" in deps)
  ) {
    return {
      framework: "React (Vite)",
      language: isTs ? "TypeScript" : "JavaScript",
      topics: ["react", "vite", isTs ? "typescript" : "javascript", "frontend"],
      badges: ["React", "Vite"],
      recommendedGitignore: "node",
    };
  }

  // 3. Flutter
  if (filenames.has("pubspec.yaml")) {
    return {
      framework: "Flutter",
      language: "Dart",
      topics: ["flutter", "dart", "mobile"],
      badges: ["Flutter", "Dart"],
      recommendedGitignore: "flutter",
    };
  }

  // 4. Go
  if (filenames.has("go.mod") || Array.from(paths).some((p) => p.endsWith(".go"))) {
    return {
      framework: "Go App",
      language: "Go",
      topics: ["go", "golang"],
      badges: ["Go"],
      recommendedGitignore: "go",
    };
  }

  // 5. Rust
  if (filenames.has("cargo.toml") || Array.from(paths).some((p) => p.endsWith(".rs"))) {
    return {
      framework: "Rust App",
      language: "Rust",
      topics: ["rust"],
      badges: ["Rust"],
      recommendedGitignore: "rust",
    };
  }

  // 6. Python
  if (
    filenames.has("requirements.txt") ||
    filenames.has("pyproject.toml") ||
    filenames.has("setup.py") ||
    filenames.has("pipfile") ||
    Array.from(paths).some((p) => p.endsWith(".py"))
  ) {
    return {
      framework: "Python App",
      language: "Python",
      topics: ["python", "backend"],
      badges: ["Python"],
      recommendedGitignore: "python",
    };
  }

  // 7. Node.js (Express/Fastify/Backend/General Node)
  if (
    "express" in deps ||
    "fastify" in deps ||
    "nest" in deps ||
    "hono" in deps ||
    "koa" in deps ||
    pkgFile != null ||
    Array.from(paths).some((p) => p.endsWith(".js") || p.endsWith(".ts"))
  ) {
    const frameworkName = "express" in deps ? "Express" : "fastify" in deps ? "Fastify" : "Node.js";
    return {
      framework: frameworkName,
      language: isTs ? "TypeScript" : "JavaScript",
      topics: ["nodejs", frameworkName.toLowerCase(), isTs ? "typescript" : "javascript", "backend"],
      badges: ["Node.js", frameworkName],
      recommendedGitignore: "node",
    };
  }

  return {
    framework: "General App",
    language: "JavaScript",
    topics: ["developer-tool"],
    badges: ["RepoForge"],
    recommendedGitignore: "node",
  };
}

function generateLicenseText(type: LicenseType, owner: string): string {
  const year = new Date().getFullYear();
  switch (type) {
    case "MIT":
      return `MIT License

Copyright (c) ${year} ${owner}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

    case "Apache-2.0":
      return `Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

Copyright ${year} ${owner}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain copy of the License at http://www.apache.org/licenses/LICENSE-2.0`;

    case "GPL-3.0":
      return `GNU GENERAL PUBLIC LICENSE
Version 3, 29 June 2007

Copyright (C) ${year} ${owner}

Everyone is permitted to copy and distribute verbatim copies
of this license document, but changing it is not allowed.`;

    case "BSD-3-Clause":
      return `BSD 3-Clause License

Copyright (c) ${year} ${owner}
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.`;

    default:
      return "";
  }
}

function generateGitignoreText(template: string): string {
  switch (template) {
    case "python":
      return `__pycache__/
*.py[cod]
*$py.class
.venv/
venv/
env/
.env
.pytest_cache/
*.egg-info/
.DS_Store
`;
    case "flutter":
      return `.dart_tool/
.flutter-plugins
.flutter-plugins-dependencies
build/
.packages
.pub/
.env
.DS_Store
`;
    case "go":
      return `bin/
*.exe
*.exe~
*.dll
*.so
*.dylib
*.test
*.out
.env
.DS_Store
`;
    case "rust":
      return `target/
**/*.rs.bk
Cargo.lock
.env
.DS_Store
`;
    case "node":
    default:
      return `node_modules/
.next/
dist/
build/
.env
.env.local
*.log
.DS_Store
coverage/
`;
  }
}

function generateReadmeText(
  repoName: string,
  description: string,
  tech: TechDetection,
  license: LicenseType
): string {
  const descText = description.trim() || `Awesome repository generated with RepoForge.`;
  const badgeSection = tech.badges
    .map(
      (b) =>
        `![${b}](https://img.shields.io/badge/${encodeURIComponent(b)}-blue?style=flat-square)`
    )
    .join(" ");

  const installCmd =
    tech.recommendedGitignore === "python"
      ? "pip install -r requirements.txt"
      : tech.recommendedGitignore === "flutter"
      ? "flutter pub get"
      : tech.recommendedGitignore === "go"
      ? "go mod download"
      : tech.recommendedGitignore === "rust"
      ? "cargo build"
      : "npm install";

  const usageCmd =
    tech.recommendedGitignore === "python"
      ? "python main.py"
      : tech.recommendedGitignore === "flutter"
      ? "flutter run"
      : tech.recommendedGitignore === "rust"
      ? "cargo run"
      : "npm run dev";

  return `# ${repoName}

${badgeSection} ${license !== "None" ? `![License](https://img.shields.io/badge/license-${license}-green?style=flat-square)` : ""}

${descText}

## 🚀 Tech Stack

- **Framework:** ${tech.framework}
- **Language:** ${tech.language}

## 📦 Installation

\`\`\`bash
${installCmd}
\`\`\`

## 💻 Usage

\`\`\`bash
${usageCmd}
\`\`\`

${license !== "None" ? `## 📄 License\n\nThis project is licensed under the ${license} License.` : ""}
`;
}

// GitHub API Fetcher
async function githubFetch(path: string, options: RequestInit = {}, token?: string) {
  return fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token ?? ENV_GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

// ─── Archive Extraction ────────────────────────────────────────────────────────
const IGNORED_PATH_PATTERNS = [
  /(?:^|\/)\.git(?:\/|$)/i,
  /(?:^|\/)node_modules(?:\/|$)/i,
  /(?:^|\/)\.next(?:\/|$)/i,
  /(?:^|\/)dist(?:\/|$)/i,
  /(?:^|\/)build(?:\/|$)/i,
  /(?:^|\/)out(?:\/|$)/i,
  /(?:^|\/)\.venv(?:\/|$)/i,
  /(?:^|\/)venv(?:\/|$)/i,
  /(?:^|\/)env(?:\/|$)/i,
  /(?:^|\/)__pycache__(?:\/|$)/i,
  /(?:^|\/)\.pytest_cache(?:\/|$)/i,
  /(?:^|\/)\.dart_tool(?:\/|$)/i,
  /(?:^|\/)target(?:\/|$)/i,
  /(?:^|\/)__MACOSX(?:\/|$)/i,
  /\.DS_Store$/i,
  /\.pyc$/i,
];

function isIgnoredPath(normalizedPath: string): boolean {
  return IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

async function extractArchives(
  files: { buffer: Buffer; originalname: string }[]
): Promise<{ folderMap: Map<string, FileEntry[]>; primaryArchiveName: string }> {
  const folderMap = new Map<string, FileEntry[]>();
  const primaryArchiveName = files.map((f) => f.originalname).join(", ");

  for (const f of files) {
    let decompressed: decompress.File[];
    try {
      decompressed = await decompress(f.buffer);
    } catch {
      throw new Error(`Could not extract "${f.originalname}". Supported: .zip .tar .tar.gz .tgz .tar.bz2 .tar.xz`);
    }

    const archiveBaseName = f.originalname.replace(/\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz)$/i, "");

    const validFiles = decompressed
      .filter((file) => file.type !== "directory" && file.data && file.data.length > 0)
      .map((file) => ({
        normalized: file.path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, ""),
        data: file.data,
      }))
      .filter((file) => file.normalized.length > 0 && !isIgnoredPath(file.normalized));

    if (validFiles.length === 0) continue;

    const hasRootFiles = validFiles.some((file) => !file.normalized.includes("/"));
    const topFolders = new Set(
      validFiles
        .filter((file) => file.normalized.includes("/"))
        .map((file) => file.normalized.split("/")[0])
    );

    const isSingleProjectArchive = hasRootFiles || topFolders.size === 1;

    for (const file of validFiles) {
      const parts = file.normalized.split("/").filter(Boolean);
      let topFolder: string;
      let relativePath: string;

      if (isSingleProjectArchive) {
        if (hasRootFiles) {
          topFolder = archiveBaseName;
          relativePath = file.normalized;
        } else {
          topFolder = parts[0];
          relativePath = parts.length > 1 ? parts.slice(1).join("/") : parts[0];
        }
      } else {
        topFolder = parts[0];
        relativePath = parts.length > 1 ? parts.slice(1).join("/") : parts[0];
      }

      if (!relativePath) continue;
      if (!folderMap.has(topFolder)) folderMap.set(topFolder, []);
      folderMap.get(topFolder)!.push({ path: relativePath, content: file.data });
    }
  }

  return { folderMap, primaryArchiveName };
}

// ─── Background Job Processor ─────────────────────────────────────────────────
async function processJob(
  jobId: string,
  token: string,
  session: SessionData,
  selectedFolders: string[],
  repoNameOverrides: Record<string, string>,
  repoConfigs: Record<string, FolderRepoConfig>,
  globalIsPrivate: boolean,
  globalDescription: string
) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.progress.total = selectedFolders.length;

  // Initialize status for each repo
  job.results = selectedFolders.map((folderName) => {
    const files = session.folders.get(folderName) ?? [];
    const detectedTech = detectTechStack(files);
    const cfg = repoConfigs[folderName] ?? {};
    const rawName = (cfg.repoName ?? repoNameOverrides[folderName] ?? folderName).trim() || folderName;
    const repoName = rawName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "repo";
    return {
      folderName,
      repoName,
      repoUrl: "",
      filesUploaded: 0,
      success: false,
      status: "queued" as RepoUploadStatus,
      detectedTech,
    };
  });

  try {
    const meRes = await githubFetch("/user", {}, token);
    if (!meRes.ok) throw new Error("Failed to authenticate with GitHub");
    const me = (await meRes.json()) as Record<string, unknown>;
    const login = me["login"] as string;
    const ownerName = (me["name"] as string) || login;

    for (let i = 0; i < selectedFolders.length; i++) {
      const folderName = selectedFolders[i];
      const resultObj = job.results[i];

      job.progress.currentRepo = folderName;
      job.progress.currentAction = "Creating repository…";
      resultObj.status = "uploading";

      const files = session.folders.get(folderName);
      if (!files) {
        resultObj.success = false;
        resultObj.status = "failed";
        resultObj.error = "Folder not found in session";
        job.progress.completed++;
        continue;
      }

      const cfg = repoConfigs[folderName] ?? {};
      const repoName = resultObj.repoName;
      const isPrivate = cfg.private ?? globalIsPrivate;
      const description = cfg.description ?? globalDescription;
      const license = cfg.license ?? "MIT";
      const generateReadme = cfg.generateReadme ?? true;
      const generateGitignore = cfg.generateGitignore ?? true;
      const detectedTech = resultObj.detectedTech ?? detectTechStack(files);
      const topics = cfg.topics ?? detectedTech.topics;

      // 1. Create GitHub Repo
      const createRes = await githubFetch("/user/repos", {
        method: "POST",
        body: JSON.stringify({
          name: repoName,
          private: isPrivate,
          description,
          auto_init: false,
        }),
      }, token);

      if (!createRes.ok) {
        const errBody = (await createRes.json()) as Record<string, unknown>;
        const subErrors = Array.isArray(errBody["errors"])
          ? (errBody["errors"] as Array<Record<string, unknown>>)
              .map((e) => e["message"])
              .filter(Boolean)
              .join(", ")
          : "";
        const baseMsg = String(errBody["message"] ?? "Failed to create repository");
        resultObj.success = false;
        resultObj.status = "failed";
        resultObj.error = subErrors ? `${baseMsg} (${subErrors})` : baseMsg;
        job.progress.completed++;
        continue;
      }

      // Clone files list to add generated README/License/.gitignore if missing
      const fileList = [...files];

      // Generate README if requested or missing
      const hasReadme = fileList.some((f) => f.path.toLowerCase() === "readme.md");
      if (generateReadme && !hasReadme) {
        const readmeContent = generateReadmeText(repoName, description, detectedTech, license);
        fileList.push({ path: "README.md", content: Buffer.from(readmeContent, "utf-8") });
      }

      // Generate LICENSE if license selected and missing
      const hasLicense = fileList.some((f) => f.path.toLowerCase() === "license" || f.path.toLowerCase() === "license.md");
      if (license !== "None" && !hasLicense) {
        const licenseContent = generateLicenseText(license, ownerName);
        if (licenseContent) {
          fileList.push({ path: "LICENSE", content: Buffer.from(licenseContent, "utf-8") });
        }
      }

      // Generate .gitignore if requested and missing
      const hasGitignore = fileList.some((f) => f.path.toLowerCase() === ".gitignore");
      if (generateGitignore && !hasGitignore) {
        const gitignoreContent = generateGitignoreText(detectedTech.recommendedGitignore);
        fileList.push({ path: ".gitignore", content: Buffer.from(gitignoreContent, "utf-8") });
      }

      // 2. Upload files
      job.progress.currentAction = `Uploading ${fileList.length} file${fileList.length !== 1 ? "s" : ""}…`;
      let filesUploaded = 0;

      for (const f of fileList) {
        const encoded = f.content.toString("base64");
        const encodedPath = f.path
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/");
        const uploadRes = await githubFetch(`/repos/${login}/${repoName}/contents/${encodedPath}`, {
          method: "PUT",
          body: JSON.stringify({ message: `Add ${f.path}`, content: encoded }),
        }, token);
        if (uploadRes.ok) filesUploaded++;
      }

      // 3. Set Topics
      if (topics.length > 0) {
        try {
          const cleanTopics = Array.from(
            new Set(
              topics
                .map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 50))
                .filter(Boolean)
            )
          ).slice(0, 20);

          if (cleanTopics.length > 0) {
            await githubFetch(`/repos/${login}/${repoName}/topics`, {
              method: "PUT",
              body: JSON.stringify({ names: cleanTopics }),
            }, token);
          }
        } catch {}
      }

      resultObj.repoUrl = `https://github.com/${login}/${repoName}`;
      resultObj.filesUploaded = filesUploaded;
      resultObj.success = true;
      resultObj.status = "done";
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
  const token = resolveGithubToken(req);
  if (!token) {
    res.status(401).json({ error: "GitHub token required" });
    return;
  }
  try {
    const r = await githubFetch("/user", {}, token);
    if (!r.ok) {
      res.status(r.status).json({ error: "GitHub API error" });
      return;
    }
    const user = (await r.json()) as Record<string, unknown>;
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

// GET /github/repos
router.get("/github/repos", async (req, res) => {
  const token = resolveGithubToken(req);
  if (!token) {
    res.status(401).json({ error: "GitHub token required" });
    return;
  }
  try {
    const r = await githubFetch("/user/repos?sort=created&direction=desc&per_page=12", {}, token);
    if (!r.ok) {
      res.status(r.status).json({ error: "GitHub API error" });
      return;
    }
    const repos = (await r.json()) as Record<string, unknown>[];
    res.json(
      repos.map((repo) => ({
        name: repo["name"],
        fullName: repo["full_name"],
        url: repo["html_url"],
        private: repo["private"],
        createdAt: repo["created_at"],
        description: repo["description"] ?? null,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list repos");
    res.status(500).json({ error: "Failed to list repos" });
  }
});

// POST /github/preview — accept single or multiple files
router.post("/github/preview", upload.any(), async (req, res) => {
  const reqFiles = (req.files as Express.Multer.File[]) ?? [];
  if (reqFiles.length === 0) {
    res.status(400).json({ error: "No archive files uploaded" });
    return;
  }

  try {
    const { folderMap, primaryArchiveName } = await extractArchives(
      reqFiles.map((f) => ({ buffer: f.buffer, originalname: f.originalname }))
    );

    if (folderMap.size === 0) {
      res.status(400).json({
        error:
          "No files found in uploaded archives. Archives must contain project files or folders.",
      });
      return;
    }

    const sessionId = randomUUID();
    sessions.set(sessionId, {
      folders: folderMap,
      archiveName: primaryArchiveName,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });

    const foldersInfo: FolderInfo[] = [...folderMap.entries()].map(([name, files]) => {
      const totalSizeBytes = files.reduce((acc, f) => acc + f.content.length, 0);
      const detectedTech = detectTechStack(files);
      const fileNodes: FileTreeNode[] = files.map((f) => ({
        path: f.path,
        size: f.content.length,
        type: "file",
      }));

      return {
        name,
        fileCount: files.length,
        totalSizeBytes,
        detectedTech,
        files: fileNodes,
      };
    });

    res.json({
      sessionId,
      folders: foldersInfo,
      archiveName: primaryArchiveName,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to extract archive");
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /github/file-preview — get text preview of a file in session
router.post("/github/file-preview", (req, res) => {
  const { sessionId, folderName, filePath } = req.body as {
    sessionId: string;
    folderName: string;
    filePath: string;
  };

  if (!sessionId || !folderName || !filePath) {
    res.status(400).json({ error: "sessionId, folderName, and filePath are required" });
    return;
  }

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    res.status(400).json({ error: "Session expired" });
    return;
  }

  const files = session.folders.get(folderName);
  if (!files) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  const file = files.find((f) => f.path === filePath);
  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  // Check if binary or large file
  const isLarge = file.content.length > 500 * 1024;
  let isBinary = false;
  for (let i = 0; i < Math.min(file.content.length, 512); i++) {
    if (file.content[i] === 0) {
      isBinary = true;
      break;
    }
  }

  if (isBinary || isLarge) {
    res.json({
      path: filePath,
      content: isLarge ? "(File too large to preview)" : "(Binary file)",
      size: file.content.length,
      isBinary: true,
    });
    return;
  }

  const textContent = file.content.toString("utf-8");
  res.json({
    path: filePath,
    content: textContent,
    size: file.content.length,
    isBinary: false,
  });
});

// POST /github/upload-selected — start background job
router.post("/github/upload-selected", async (req, res) => {
  const token = resolveGithubToken(req);
  if (!token) {
    res.status(401).json({ error: "GitHub token required. Please connect your GitHub account." });
    return;
  }

  const {
    sessionId,
    selectedFolders,
    repoNameOverrides = {},
    repoConfigs = {},
    private: globalIsPrivate = false,
    description: globalDescription = "",
  } = req.body as {
    sessionId: string;
    selectedFolders: string[];
    repoNameOverrides?: Record<string, string>;
    repoConfigs?: Record<string, FolderRepoConfig>;
    private?: boolean;
    description?: string;
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
    jobId,
    status: "pending",
    progress: { total: selectedFolders.length, completed: 0 },
    results: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  };
  jobs.set(jobId, job);

  // Background processor fire-and-forget
  processJob(
    jobId,
    token,
    session,
    selectedFolders,
    repoNameOverrides,
    repoConfigs,
    globalIsPrivate,
    globalDescription
  ).catch((err) => req.log.error({ err, jobId }, "Job processing error"));

  res.json({ jobId });
});

// GET /github/jobs/:jobId
router.get("/github/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found or expired" });
    return;
  }
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

