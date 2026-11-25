# RepoForge

Turn local `.zip`, `.tar`, `.tar.gz`, and `.tgz` project archives into GitHub repositories directly from your browser — without installing or configuring Git CLI.

RepoForge extracts archives, lets you inspect the folder tree and file contents, detects each project's tech stack, generates `README.md`, `LICENSE`, and `.gitignore` files, and publishes public or private repositories via the GitHub REST API.

---

## Features

- **Archive Preview & File Explorer**: Expand folders, inspect file counts and byte sizes, and preview text files (`package.json`, `README.md`, source files) before creating anything on GitHub.
- **Smart Tech Detection**: Scans project manifests and config files (`next.config.*`, `vite.config.*`, `package.json`, `requirements.txt`, `pubspec.yaml`, `go.mod`, `Cargo.toml`) to auto-fill repository topics and `.gitignore` templates.
- **Multi-Archive Drag & Drop**: Drop single or multiple `.zip`, `.tar`, `.tar.gz`, or `.tgz` archives and select which project folders become repositories.
- **Per-Repository Configuration**: Set global Public/Private visibility and license defaults, or override repository names, visibility, licenses, and doc generation per folder.
- **README & License Generator**: Auto-generates structured `README.md` files (title, description, tech stack, installation, usage) and `LICENSE` files (`MIT`, `Apache-2.0`, `GPL-3.0`, `BSD-3-Clause`).
- **Live Progress & Bulk URL Export**: Track each repository from `queued` → `uploading` → `done`, copy individual URLs, copy all URLs, or open all created repositories in GitHub.
- **100% Client-Side Mode (Cloudflare Pages Ready)**: Extracts archives in the browser with `fflate` and communicates directly with `https://api.github.com` using the visitor's own `sessionStorage` token — no backend server required.

---

## Monorepo Structure

```text
Repo-Creator-Tool/
├── artifacts/
│   ├── github-uploader/     # React + Vite frontend (runs standalone on Cloudflare Pages)
│   ├── api-server/          # Optional Express backend for local/server-side mode
│   └── mockup-sandbox/      # UI component sandbox
├── lib/
│   ├── api-spec/            # OpenAPI 3.1 specification & Orval config
│   ├── api-client-react/    # Generated React Query hooks & customFetch client
│   ├── api-zod/             # Generated Zod schemas
│   └── db/                  # Shared workspace database package
├── package.json
└── pnpm-workspace.yaml
```

---

## Quick Start (Local Development)

### Prerequisites

- **Node.js** `20+`
- **pnpm** `10+` (`corepack enable`)

### 1. Install dependencies

```bash
git clone https://github.com/icefvg/Repo-Creator-Tool.git
cd Repo-Creator-Tool
pnpm install
```

### 2. Run the frontend (Client-Side Mode)

You can run the frontend on its own — archive extraction and GitHub publishing work directly in the browser once you connect a GitHub Personal Access Token in the UI:

```bash
pnpm --filter @workspace/github-uploader dev
```

Open [http://localhost:3000](http://localhost:3000).

### 3. (Optional) Run with the local Express API server

If you want to run the Express backend locally with a `.env` token:

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
# Edit artifacts/api-server/.env and add your GITHUB_TOKEN
pnpm --filter @workspace/api-server dev
```

In a second terminal, start the frontend:

```bash
pnpm --filter @workspace/github-uploader dev
```

The Vite dev server proxies `/api/*` requests to `http://localhost:8080`.

---

## Deploying to Cloudflare Pages

RepoForge runs **100% client-side** on Cloudflare Pages with zero backend server:

1. Connect `icefvg/Repo-Creator-Tool` in **Cloudflare Dashboard → Workers & Pages → Create → Pages**.
2. Configure the build settings:
   - **Production branch**: `main`
   - **Framework preset**: `None` (or `Vite`)
   - **Build command**: `pnpm --filter @workspace/github-uploader build`
   - **Build output directory**: `artifacts/github-uploader/dist/public`
   - **Root directory**: `/` (leave blank so monorepo `lib/` packages resolve)
3. Click **Save and Deploy**.

### How visitors connect GitHub on the live site

1. Visitors click **Open workspace** and can immediately test **Upload**, **Archive preview**, and **Tech detection** without signing in.
2. Before forging repositories, they click **Connect GitHub**, follow the one-click link to create a `repo`-scoped Personal Access Token on GitHub, and paste it into the modal.
3. The token is saved **only in the visitor's browser `sessionStorage`** and sent directly from their browser to `https://api.github.com`.

---

## Workspace Scripts

```bash
# Typecheck all packages and apps
pnpm run typecheck

# Build all packages and apps
pnpm run build

# Typecheck / build frontend only
pnpm --filter @workspace/github-uploader typecheck
pnpm --filter @workspace/github-uploader build

# Typecheck / build backend only
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
```

---

## Notes & Troubleshooting

- **Repository already exists (`422`)**: GitHub rejects creating a repository if that name already exists on your account. Rename the target repository in **Step 4 (Configure)** before clicking **Forge**.
- **Ignored build artifacts**: Folders such as `.git`, `node_modules`, `.next`, `dist`, `build`, `out`, `.venv`, `venv`, `__pycache__`, `.cache`, `coverage`, and `.turbo` are automatically skipped during extraction.
- **Security**: Never commit `.env` files or personal access tokens. See [SECURITY.md](./SECURITY.md) for details.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## License

Licensed under the [MIT License](./LICENSE).
