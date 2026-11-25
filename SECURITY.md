# Security Policy

## Token Handling

- **Static / Cloudflare Pages deployment**: Visitors enter their own GitHub Personal Access Token (`repo` scope) in the browser UI. The token is stored in `sessionStorage` (`repoforge_gh_token`), sent directly from the browser to `https://api.github.com`, and cleared when the browser tab closes or when clicking **Disconnect**.
- **Local API server (`artifacts/api-server`)**: Reads `GITHUB_TOKEN` from `artifacts/api-server/.env` (which is gitignored) only when running locally, or accepts an `Authorization: Bearer <token>` / `X-GitHub-Token` header per request.
- **Public deployments**: Never set a personal `GITHUB_TOKEN` environment variable on a publicly accessible server, as visitors would otherwise create repositories on that account.

## Reporting a Vulnerability

If you discover a security issue, please report it responsibly by opening a private security advisory on GitHub or contacting the repository maintainer directly rather than posting public exploit details.
