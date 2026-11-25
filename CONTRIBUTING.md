# Contributing to RepoForge

Thank you for helping improve RepoForge.

## Development Workflow

1. Fork the repository and create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Install dependencies at the monorepo root:
   ```bash
   pnpm install
   ```
3. Run typechecks and builds before committing:
   ```bash
   pnpm run typecheck
   pnpm run build
   ```

## Project Notes

- **Frontend (`artifacts/github-uploader`)**: React 19, Vite, Tailwind CSS v4, Framer Motion, and `fflate` for client-side archive extraction. Keep client-side mode working without requiring `artifacts/api-server` so Cloudflare Pages deployments stay self-contained.
- **API Spec (`lib/api-spec/openapi.yaml`)**: If you modify backend API contracts, update `openapi.yaml` and regenerate `lib/api-client-react` and `lib/api-zod` via Orval.
- **Secrets**: Never commit `.env` files, personal access tokens, or credentials. Use `artifacts/api-server/.env.example` for documenting environment variables.

## Pull Requests

- Keep pull requests focused on a single change or fix.
- Include a short description of what changed and how you verified it (`typecheck` / `build` / manual steps).
