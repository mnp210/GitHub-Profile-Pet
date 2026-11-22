# Sprint 4.3 — GitHub Pages Readiness Audit

**Assessment Date:** 2026-11-22  
**Candidate Implementation:** Next.js 16.4.6 Static HTML/CSS/JS Export  
**Target Production Repository:** `mnp210/GitHub-Profile-Pet` (Public)  
**Staging Reference:** `mnp210/GitHub-Profile-Pet-R3.40-Staging` (Private)  

---

## 1. Technical Architecture & Export Compatibility

The candidate web application has been built, exported, and verified using Next.js Turbopack (`output: 'export'`).

### Configuration Analysis (`next.config.ts`)
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  images: {
    unoptimized: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
```

### Static Asset Layout
- Next.js export generates pure static HTML, CSS, JavaScript, and SVG assets in `./out`.
- `out/index.html`: Main interactive virtual pet application.
- `out/_not-found/index.html`: Client-side 404 fallback page.
- `out/_next/static/`: Bundled client-side JavaScript, React runtime, and Tailwind CSS.
- `out/.nojekyll`: Instructs GitHub Pages not to process static directories with Jekyll, ensuring `_next` assets are served correctly.

---

## 2. Subpath Routing & Base Path Resolution

### The GitHub Pages Subpath Problem
On GitHub Pages, project repositories are served from a subpath corresponding to the repository name:
`https://<OWNER>.github.io/<REPO>/` (e.g., `https://mnp210.github.io/GitHub-Profile-Pet/`).
If asset URLs are hardcoded to the root domain (`/_next/static/...`), browsers receive HTTP 404 when requesting assets from `https://mnp210.github.io/`.

### Candidate Resolution
The deployment workflow `.github/workflows/deploy-pages.yml` dynamically provides the exact repository name at build time:
```yaml
      - name: Build static export
        env:
          NEXT_PUBLIC_BASE_PATH: /${{ github.event.repository.name }}
        run: npm run build
```
This guarantees that all script tags, CSS links, and internal asset references compile to `/<REPO>/_next/...`, completely eliminating 404 asset failures regardless of repository name.

---

## 3. Production vs. Staging Repository Capability

| Repository | Visibility | Current Pages Status | GitHub Free Plan Support | Deployment Readiness |
| :--- | :--- | :--- | :--- | :--- |
| **`mnp210/GitHub-Profile-Pet-R3.40-Staging`** | **Private** | Not Configured (HTTP 404) | **UNSUPPORTED** (HTTP 422: Plan requires Pro/Enterprise for private Pages) | **BLOCKED** on Free plan |
| **`mnp210/GitHub-Profile-Pet`** | **Public** | Not Configured (HTTP 404) | **SUPPORTED** (GitHub Free natively supports Pages on public repositories) | **READY** for controlled enablement |

### Reason Staging Remained Blocked in Sprint 4.2
In Sprint 4.2, enabling Pages via `gh api --method POST repos/mnp210/GitHub-Profile-Pet-R3.40-Staging/pages` returned:
`HTTP 422: Your current plan does not support GitHub Pages for this repository`.
Staging was strictly preserved as private to adhere to non-destructive project boundaries.

---

## 4. Controlled Production Deployment Procedure (Pre-Deployment Plan)

When production release is authorized in a future deployment milestone:

1. **Enable GitHub Pages on Production:**
   ```powershell
   gh api --method POST repos/mnp210/GitHub-Profile-Pet/pages -f "build_type=workflow"
   ```
2. **Merge Candidate Branch to Production Default Branch:**
   Fast-forward merge candidate commits to `origin/main`.
3. **Automated Deployment:**
   The push to `main` automatically triggers `.github/workflows/deploy-pages.yml`:
   - Checks out repository.
   - Installs dependencies (`npm ci`).
   - Builds static export with `NEXT_PUBLIC_BASE_PATH: /GitHub-Profile-Pet`.
   - Generates `.nojekyll`.
   - Uploads Pages artifact (`actions/upload-pages-artifact@v3`).
   - Deploys to GitHub Pages environment (`actions/deploy-pages@v4`).
4. **Post-Deployment Verification:**
   - Request `https://mnp210.github.io/GitHub-Profile-Pet/` and verify HTTP 200 OK.
   - Verify asset MIME types: `text/css` and `application/javascript` load with 0 console errors.
   - Verify visitor mode defaults to clean read-only simulation.
   - Verify README navigation links redirect into the hosted game with `?repo=mnp210/GitHub-Profile-Pet&action=feed`.

---

## 5. Summary Verdict

- **Configuration Readiness:** **100% READY**. Build scripts, Next.js config, base path handling, and deployment workflows are verified.
- **Hosted Live Verification:** **BLOCKED** until public repository enablement.
