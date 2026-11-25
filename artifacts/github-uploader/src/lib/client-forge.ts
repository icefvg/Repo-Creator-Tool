import { unzipSync, gunzipSync } from "fflate";
import type {
  FolderInfo,
  TechDetection,
  LicenseType,
  FolderRepoConfig,
  FileTreeNode,
} from "@workspace/api-client-react";

const GITHUB_API = "https://api.github.com";

export interface ClientFileEntry {
  path: string;
  content: Uint8Array;
}

export interface ClientSession {
  sessionId: string;
  archiveName: string;
  folders: Map<string, ClientFileEntry[]>;
  folderInfos: FolderInfo[];
}

export interface ClientRepoResult {
  folderName: string;
  repoName: string;
  repoUrl: string;
  filesUploaded: number;
  success: boolean;
  error?: string;
  status: "queued" | "uploading" | "done" | "failed";
  detectedTech?: TechDetection;
}

export interface ClientJobProgress {
  status: "running" | "done" | "failed";
  progress: {
    total: number;
    completed: number;
    currentRepo?: string;
    currentAction?: string;
  };
  results: ClientRepoResult[];
}

const IGNORED_PATH_PATTERNS = [
  /(?:^|\/)\.git(?:\/|$)/i,
  /(?:^|\/)node_modules(?:\/|$)/i,
  /(?:^|\/)\.next(?:\/|$)/i,
  /(?:^|\/)dist(?:\/|$)/i,
  /(?:^|\/)build(?:\/|$)/i,
  /(?:^|\/)out(?:\/|$)/i,
  /(?:^|\/)\.venv(?:\/|$)/i,
  /(?:^|\/)venv(?:\/|$)/i,
  /(?:^|\/)__pycache__(?:\/|$)/i,
  /(?:^|\/)\.ds_store$/i,
  /(?:^|\/)thumbs\.db$/i,
  /(?:^|\/)\.cache(?:\/|$)/i,
  /(?:^|\/)coverage(?:\/|$)/i,
  /(?:^|\/)\.turbo(?:\/|$)/i,
];

function shouldIgnore(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.endsWith("/")) return true;
  return IGNORED_PATH_PATTERNS.some((p) => p.test(normalized));
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function parseTar(bytes: Uint8Array): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  const decoder = new TextDecoder("utf-8");
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    const isEmpty = header.every((b) => b === 0);
    if (isEmpty) break;

    const rawName = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, "");
    const rawPrefix = decoder.decode(header.subarray(345, 500)).replace(/\0.*$/, "");
    const fullName = rawPrefix ? `${rawPrefix}/${rawName}` : rawName;

    const sizeStr = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, "").trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = header[156];

    offset += 512;

    // Regular file ('0' = 48 or '\0' = 0)
    if ((typeFlag === 48 || typeFlag === 0) && fullName && size >= 0) {
      result[fullName] = bytes.slice(offset, offset + size);
    }

    const paddedSize = Math.ceil(size / 512) * 512;
    offset += paddedSize;
  }

  return result;
}

export async function extractArchivesClient(files: File[]): Promise<ClientSession> {
  const folderMap = new Map<string, ClientFileEntry[]>();
  const primaryArchiveName =
    files.length === 1 ? files[0].name : `${files.length} archives`;

  for (const file of files) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const lowerName = file.name.toLowerCase();
    let extracted: Record<string, Uint8Array> = {};

    if (lowerName.endsWith(".zip")) {
      extracted = unzipSync(buffer);
    } else if (lowerName.endsWith(".tar.gz") || lowerName.endsWith(".tgz")) {
      const tarBytes = gunzipSync(buffer);
      extracted = parseTar(tarBytes);
    } else if (lowerName.endsWith(".tar")) {
      extracted = parseTar(buffer);
    } else {
      throw new Error(
        `Unsupported format for "${file.name}". Supported formats in browser: .zip, .tar, .tar.gz, .tgz`
      );
    }

    const archiveBaseName = file.name.replace(/\.(zip|tar|tar\.gz|tgz)$/i, "");

    const validFiles = Object.entries(extracted)
      .map(([rawPath, data]) => ({
        normalized: rawPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, ""),
        data,
      }))
      .filter((entry) => !shouldIgnore(entry.normalized));

    if (validFiles.length === 0) continue;

    const rootEntries = new Set<string>();
    let hasRootFiles = false;

    for (const entry of validFiles) {
      const parts = entry.normalized.split("/").filter(Boolean);
      if (parts.length === 1) {
        hasRootFiles = true;
      } else if (parts.length > 1) {
        rootEntries.add(parts[0]);
      }
    }

    const isSingleProjectArchive =
      files.length === 1 && (hasRootFiles || rootEntries.size === 1);

    for (const entry of validFiles) {
      const parts = entry.normalized.split("/").filter(Boolean);
      if (parts.length === 0) continue;

      let topFolder: string;
      let relativePath: string;

      if (isSingleProjectArchive) {
        if (hasRootFiles) {
          topFolder = archiveBaseName;
          relativePath = entry.normalized;
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
      folderMap.get(topFolder)!.push({ path: relativePath, content: entry.data });
    }
  }

  if (folderMap.size === 0) {
    throw new Error(
      "No files found in uploaded archives. Archives must contain project files or folders."
    );
  }

  const folderInfos: FolderInfo[] = [...folderMap.entries()].map(([name, entries]) => {
    const totalSizeBytes = entries.reduce((acc, f) => acc + f.content.length, 0);
    const detectedTech = detectTechStackClient(entries);
    const fileNodes: FileTreeNode[] = entries.map((f) => ({
      path: f.path,
      size: f.content.length,
      type: "file",
    }));

    return {
      name,
      fileCount: entries.length,
      totalSizeBytes,
      detectedTech,
      files: fileNodes,
    };
  });

  return {
    sessionId: crypto.randomUUID(),
    archiveName: primaryArchiveName,
    folders: folderMap,
    folderInfos,
  };
}

export function detectTechStackClient(files: ClientFileEntry[]): TechDetection {
  const filenames = new Set(
    files.map((f) => f.path.split("/").pop()?.toLowerCase() ?? "")
  );
  const decoder = new TextDecoder("utf-8");

  let packageJson: Record<string, any> | null = null;
  const pkgFile = files.find((f) => f.path.toLowerCase() === "package.json");
  if (pkgFile) {
    try {
      packageJson = JSON.parse(decoder.decode(pkgFile.content));
    } catch {}
  }

  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };

  let framework = "General";
  let language = "Unknown";
  const topics = new Set<string>();
  const badges = new Set<string>();
  let recommendedGitignore = "node";

  const hasTs = files.some(
    (f) => f.path.endsWith(".ts") || f.path.endsWith(".tsx") || filenames.has("tsconfig.json")
  );
  const hasJs = files.some((f) => f.path.endsWith(".js") || f.path.endsWith(".jsx"));
  const hasPy = files.some((f) => f.path.endsWith(".py"));
  const hasDart = files.some((f) => f.path.endsWith(".dart"));
  const hasGo = files.some((f) => f.path.endsWith(".go"));
  const hasRust = files.some((f) => f.path.endsWith(".rs"));
  const hasHtml = files.some((f) => f.path.endsWith(".html"));

  if (filenames.has("next.config.js") || filenames.has("next.config.mjs") || filenames.has("next.config.ts") || deps["next"]) {
    framework = "Next.js";
    language = hasTs ? "TypeScript" : "JavaScript";
    topics.add("nextjs");
    topics.add("react");
    topics.add(hasTs ? "typescript" : "javascript");
    badges.add("Next.js");
    badges.add("React");
    if (hasTs) badges.add("TypeScript");
    recommendedGitignore = "node";
  } else if (filenames.has("vite.config.js") || filenames.has("vite.config.ts") || filenames.has("vite.config.mjs") || deps["vite"]) {
    framework = deps["react"] ? "React + Vite" : deps["vue"] ? "Vue + Vite" : "Vite";
    language = hasTs ? "TypeScript" : "JavaScript";
    topics.add("vite");
    if (deps["react"]) topics.add("react");
    if (deps["vue"]) topics.add("vue");
    topics.add(hasTs ? "typescript" : "javascript");
    badges.add("Vite");
    if (deps["react"]) badges.add("React");
    if (hasTs) badges.add("TypeScript");
    recommendedGitignore = "node";
  } else if (filenames.has("pubspec.yaml")) {
    framework = "Flutter";
    language = "Dart";
    topics.add("flutter");
    topics.add("dart");
    topics.add("mobile");
    badges.add("Flutter");
    badges.add("Dart");
    recommendedGitignore = "flutter";
  } else if (filenames.has("requirements.txt") || filenames.has("pyproject.toml") || filenames.has("pipfile") || hasPy) {
    framework = "Python";
    language = "Python";
    topics.add("python");
    badges.add("Python");
    recommendedGitignore = "python";
  } else if (deps["express"] || deps["fastify"] || deps["koa"] || filenames.has("package.json")) {
    framework = deps["express"] ? "Node (Express)" : deps["fastify"] ? "Node (Fastify)" : "Node.js";
    language = hasTs ? "TypeScript" : "JavaScript";
    topics.add("nodejs");
    if (deps["express"]) topics.add("express");
    if (deps["fastify"]) topics.add("fastify");
    topics.add(hasTs ? "typescript" : "javascript");
    badges.add("Node.js");
    if (hasTs) badges.add("TypeScript");
    recommendedGitignore = "node";
  } else if (filenames.has("go.mod") || hasGo) {
    framework = "Go";
    language = "Go";
    topics.add("golang");
    badges.add("Go");
    recommendedGitignore = "go";
  } else if (filenames.has("cargo.toml") || hasRust) {
    framework = "Rust";
    language = "Rust";
    topics.add("rust");
    badges.add("Rust");
    recommendedGitignore = "rust";
  } else if (hasHtml) {
    framework = "Static Web";
    language = hasJs ? "JavaScript" : "HTML/CSS";
    topics.add("html");
    topics.add("css");
    badges.add("HTML5");
    recommendedGitignore = "node";
  }

  if (deps["tailwindcss"] || filenames.has("tailwind.config.js") || filenames.has("tailwind.config.ts")) {
    topics.add("tailwindcss");
    badges.add("Tailwind CSS");
  }

  if (language === "Unknown") {
    if (hasTs) language = "TypeScript";
    else if (hasJs) language = "JavaScript";
    else if (hasPy) language = "Python";
    else if (hasDart) language = "Dart";
  }

  return {
    framework,
    language,
    topics: Array.from(topics).slice(0, 10),
    badges: Array.from(badges),
    recommendedGitignore,
  };
}

export function getFilePreviewClient(
  session: ClientSession,
  folderName: string,
  filePath: string
): { path: string; content: string; size: number; isBinary: boolean } {
  const entries = session.folders.get(folderName);
  if (!entries) throw new Error("Folder not found");
  const file = entries.find((f) => f.path === filePath);
  if (!file) throw new Error("File not found");

  const isLarge = file.content.length > 500 * 1024;
  let isBinary = false;
  for (let i = 0; i < Math.min(file.content.length, 512); i++) {
    if (file.content[i] === 0) {
      isBinary = true;
      break;
    }
  }

  if (isLarge || isBinary) {
    return {
      path: filePath,
      content: isLarge ? "(File too large to preview)" : "(Binary file)",
      size: file.content.length,
      isBinary: true,
    };
  }

  return {
    path: filePath,
    content: new TextDecoder("utf-8").decode(file.content),
    size: file.content.length,
    isBinary: false,
  };
}

function generateGitignoreText(template: string): string {
  switch (template) {
    case "python":
      return "__pycache__/\n*.py[cod]\n*$py.class\n.venv/\nvenv/\nENV/\n.env\n.pytest_cache/\ndist/\nbuild/\n*.egg-info/\n";
    case "flutter":
      return ".dart_tool/\n.packages\nbuild/\n.flutter-plugins\n.flutter-plugins-dependencies\n.pub-cache/\n.pub/\n";
    case "go":
      return "*.exe\n*.exe~\n*.dll\n*.so\n*.dylib\n*.test\n*.out\nvendor/\n";
    case "rust":
      return "/target/\n**/*.rs.bk\nCargo.lock\n";
    case "node":
    default:
      return "node_modules/\ndist/\nbuild/\n.next/\n.env\n.env.local\n.DS_Store\nnpm-debug.log*\nyarn-debug.log*\npnpm-debug.log*\n";
  }
}

function generateLicenseText(license: LicenseType, authorName: string): string {
  const year = new Date().getFullYear();
  if (license === "MIT") {
    return `MIT License\n\nCopyright (c) ${year} ${authorName}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
  }
  if (license === "Apache-2.0") {
    return `Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\n\nCopyright ${year} ${authorName}\n\nLicensed under the Apache License, Version 2.0 (the "License");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0\n`;
  }
  if (license === "GPL-3.0") {
    return `GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n\nCopyright (C) ${year} ${authorName}\nEveryone is permitted to copy and distribute verbatim copies of this license document, but changing it is not allowed.\n`;
  }
  if (license === "BSD-3-Clause") {
    return `BSD 3-Clause License\n\nCopyright (c) ${year}, ${authorName}\nAll rights reserved.\n`;
  }
  return "";
}

function generateReadmeText(
  repoName: string,
  description: string,
  tech: TechDetection,
  license: LicenseType
): string {
  const badgesMd = tech.badges
    .map((b) => `![${b}](https://img.shields.io/badge/${encodeURIComponent(b)}-blue?style=flat-square)`)
    .join(" ");

  const installCmd =
    tech.recommendedGitignore === "python"
      ? "pip install -r requirements.txt"
      : tech.recommendedGitignore === "flutter"
      ? "flutter pub get"
      : tech.recommendedGitignore === "go"
      ? "go mod download"
      : "npm install";

  const runCmd =
    tech.framework.includes("Next") || tech.framework.includes("Vite")
      ? "npm run dev"
      : tech.recommendedGitignore === "python"
      ? "python main.py"
      : tech.recommendedGitignore === "flutter"
      ? "flutter run"
      : "npm start";

  return `# ${repoName}

${badgesMd ? `${badgesMd}\n` : ""}
${description || `A ${tech.framework} project built with ${tech.language}.`}

## Tech Stack
- **Framework**: ${tech.framework}
- **Language**: ${tech.language}

## Installation

\`\`\`bash
git clone https://github.com/your-username/${repoName}.git
cd ${repoName}
${installCmd}
\`\`\`

## Usage

\`\`\`bash
${runCmd}
\`\`\`

${license !== "None" ? `## License\n\nThis project is licensed under the ${license} License.` : ""}
`;
}

async function githubApiFetch(path: string, token: string, options: RequestInit = {}) {
  return fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

export async function fetchGithubUserClient(token: string) {
  const r = await githubApiFetch("/user", token);
  if (!r.ok) {
    throw new Error("Invalid or expired GitHub token");
  }
  const user = (await r.json()) as Record<string, unknown>;
  return {
    login: String(user["login"] ?? ""),
    name: (user["name"] as string) ?? null,
    avatarUrl: String(user["avatar_url"] ?? ""),
    publicRepos: Number(user["public_repos"] ?? 0),
  };
}

export async function listRecentReposClient(token: string) {
  const r = await githubApiFetch(
    "/user/repos?sort=created&direction=desc&per_page=12",
    token
  );
  if (!r.ok) return [];
  const repos = (await r.json()) as Record<string, unknown>[];
  return repos.map((repo) => ({
    name: String(repo["name"] ?? ""),
    fullName: String(repo["full_name"] ?? ""),
    url: String(repo["html_url"] ?? ""),
    private: Boolean(repo["private"]),
    createdAt: String(repo["created_at"] ?? ""),
    description: (repo["description"] as string) ?? null,
  }));
}

export async function forgeRepositoriesClient(params: {
  token: string;
  session: ClientSession;
  selectedFolders: string[];
  repoConfigs: Record<string, FolderRepoConfig>;
  globalIsPrivate: boolean;
  globalDescription: string;
  onProgress: (state: ClientJobProgress) => void;
}): Promise<ClientJobProgress> {
  const {
    token,
    session,
    selectedFolders,
    repoConfigs,
    globalIsPrivate,
    globalDescription,
    onProgress,
  } = params;

  const encoder = new TextEncoder();

  const state: ClientJobProgress = {
    status: "running",
    progress: { total: selectedFolders.length, completed: 0 },
    results: selectedFolders.map((folderName) => {
      const files = session.folders.get(folderName) ?? [];
      const detectedTech = detectTechStackClient(files);
      const cfg = repoConfigs[folderName] ?? {};
      const rawName = (cfg.repoName ?? folderName).trim() || folderName;
      const repoName =
        rawName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "repo";
      return {
        folderName,
        repoName,
        repoUrl: "",
        filesUploaded: 0,
        success: false,
        status: "queued",
        detectedTech,
      };
    }),
  };

  onProgress({ ...state, results: [...state.results] });

  try {
    const me = await fetchGithubUserClient(token);
    const login = me.login;
    const ownerName = me.name || login;

    for (let i = 0; i < selectedFolders.length; i++) {
      const folderName = selectedFolders[i];
      const resultObj = state.results[i];

      state.progress.currentRepo = folderName;
      state.progress.currentAction = "Creating repository…";
      resultObj.status = "uploading";
      onProgress({ ...state, progress: { ...state.progress }, results: [...state.results] });

      const files = session.folders.get(folderName);
      if (!files) {
        resultObj.success = false;
        resultObj.status = "failed";
        resultObj.error = "Folder not found in archive session";
        state.progress.completed++;
        onProgress({ ...state, progress: { ...state.progress }, results: [...state.results] });
        continue;
      }

      const cfg = repoConfigs[folderName] ?? {};
      const repoName = resultObj.repoName;
      const isPrivate = cfg.private ?? globalIsPrivate;
      const description = cfg.description ?? globalDescription;
      const license = cfg.license ?? "MIT";
      const generateReadme = cfg.generateReadme ?? true;
      const generateGitignore = cfg.generateGitignore ?? true;
      const detectedTech = resultObj.detectedTech ?? detectTechStackClient(files);
      const topics = cfg.topics ?? detectedTech.topics;

      const createRes = await githubApiFetch("/user/repos", token, {
        method: "POST",
        body: JSON.stringify({
          name: repoName,
          private: isPrivate,
          description,
          auto_init: false,
        }),
      });

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
        state.progress.completed++;
        onProgress({ ...state, progress: { ...state.progress }, results: [...state.results] });
        continue;
      }

      const fileList = [...files];

      const hasReadme = fileList.some((f) => f.path.toLowerCase() === "readme.md");
      if (generateReadme && !hasReadme) {
        const readmeContent = generateReadmeText(repoName, description, detectedTech, license);
        fileList.push({ path: "README.md", content: encoder.encode(readmeContent) });
      }

      const hasLicense = fileList.some(
        (f) => f.path.toLowerCase() === "license" || f.path.toLowerCase() === "license.md"
      );
      if (license !== "None" && !hasLicense) {
        const licenseContent = generateLicenseText(license, ownerName);
        if (licenseContent) {
          fileList.push({ path: "LICENSE", content: encoder.encode(licenseContent) });
        }
      }

      const hasGitignore = fileList.some((f) => f.path.toLowerCase() === ".gitignore");
      if (generateGitignore && !hasGitignore) {
        const gitignoreContent = generateGitignoreText(detectedTech.recommendedGitignore);
        fileList.push({ path: ".gitignore", content: encoder.encode(gitignoreContent) });
      }

      state.progress.currentAction = `Uploading ${fileList.length} file${fileList.length !== 1 ? "s" : ""}…`;
      onProgress({ ...state, progress: { ...state.progress }, results: [...state.results] });

      let filesUploaded = 0;
      for (const f of fileList) {
        const encoded = uint8ToBase64(f.content);
        const encodedPath = f.path
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/");
        const uploadRes = await githubApiFetch(
          `/repos/${login}/${repoName}/contents/${encodedPath}`,
          token,
          {
            method: "PUT",
            body: JSON.stringify({ message: `Add ${f.path}`, content: encoded }),
          }
        );
        if (uploadRes.ok) filesUploaded++;
      }

      if (topics.length > 0) {
        try {
          const cleanTopics = Array.from(
            new Set(
              topics
                .map((t) =>
                  t
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "")
                    .replace(/^-+|-+$/g, "")
                    .slice(0, 50)
                )
                .filter(Boolean)
            )
          ).slice(0, 20);

          if (cleanTopics.length > 0) {
            await githubApiFetch(`/repos/${login}/${repoName}/topics`, token, {
              method: "PUT",
              body: JSON.stringify({ names: cleanTopics }),
            });
          }
        } catch {}
      }

      resultObj.repoUrl = `https://github.com/${login}/${repoName}`;
      resultObj.filesUploaded = filesUploaded;
      resultObj.success = true;
      resultObj.status = "done";
      state.progress.completed++;
      onProgress({ ...state, progress: { ...state.progress }, results: [...state.results] });
    }

    state.status = "done";
    state.progress.currentRepo = undefined;
    state.progress.currentAction = undefined;
    onProgress({ ...state, progress: { ...state.progress }, results: [...state.results] });
    return state;
  } catch (err) {
    state.status = "failed";
    onProgress({ ...state, progress: { ...state.progress }, results: [...state.results] });
    throw err;
  }
}
