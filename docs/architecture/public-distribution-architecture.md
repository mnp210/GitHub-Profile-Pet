# GitHub Profile Pet: Public Distribution, Architecture & Deployment Blueprint

**Document Version:** 1.0.0 (Stage 1.2 Transition Specification)  
**Status:** Approved Architecture Plan  
**Target Audience:** Engineering, Architecture & DevOps

---

## 1. Executive Summary & Vision

**GitHub Profile Pet** is architected as an autonomous, multi-tenant public web service. 

End users (GitHub developers) must never be expected to clone the repository, run local servers, install Node.js/npm, or self-host infrastructure. 

```text
                                  PUBLIC CLOUD / EDGE
    ┌────────────────────────┐         ┌────────────────────────┐
    │ Public Next.js Web App │ ──────> │ Public GitHub Profile  │
    │  - OAuth Login         │         │  - README.md Markdown  │
    │  - Pet Customizer      │         │    embed snippet       │
    │  - Interaction Arena   │         └───────────┬────────────┘
    └───────────┬────────────┘                     │
                │ HTTPS                            │ HTTP GET (Raw SVG)
                ▼                                  ▼
    ┌───────────────────────────────────────────────────────────┐
    │        GitHub Profile Pet Public Edge & API Gateway       │
    │   - GitHub OAuth Callback   - /api/pet/[username]/svg     │
    │   - Rate Limiting           - /api/pet/[username]/status  │
    │   - Secure Session Cookies  - Edge Cache Invalidation     │
    └─────────────┬─────────────────────────────────┬───────────┘
                  │                                 │
                  ▼                                 ▼
    ┌───────────────────────────┐     ┌─────────────────────────┐
    │ Progression & Sync Engine │     │ Persistent Storage      │
    │  - Pure Gameplay Logic    │     │  - User Accounts (UUID) │
    │  - Rolling Diminishing    │     │  - Pet Attributes       │
    │  - Background GitHub Sync │     │  - Encrypted Tokens     │
    └───────────────────────────┘     └─────────────────────────┘
```

The user journey is frictionless:
1. **Visit:** Access the public platform via secure HTTPS domain (`https://githubprofilepet.io` or configured public URL).
2. **Authorize:** Authenticate through GitHub OAuth (`read:user` scope only).
3. **Customize:** Adopt, name, and style an original pixel companion.
4. **Care & Progress:** Interact with the pet (Pet, Train, Feed, Rest) or power progression through everyday GitHub activity.
5. **Embed:** Copy a 1-line standard Markdown image link into their GitHub profile `README.md`.
6. **Public Visibility:** Visitors to the developer's profile see an animated, server-generated pixel companion rendered without JavaScript, without authentication, and without leaking tokens.

---

## 2. Server-Side SVG README Embed Architecture

GitHub READMEs run under strict security sandboxes:
- Client-side `<script>` tags are completely stripped.
- External images are proxied through GitHub's Camo image cache (`camo.githubusercontent.com`).
- Direct DOM interactions or WebSockets are forbidden.

### 2.1 Dynamic SVG Rendering Pipeline (`/api/pet/[username]/svg`)
The public endpoint `/api/pet/[username]/svg` serves standalone, standards-compliant SVG with embedded CSS pixel styling:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160" viewBox="0 0 480 160" shape-rendering="crispEdges">
  <defs>
    <style>
      @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-4px); } }
      .pet-sprite { animation: float 3s ease-in-out infinite; }
      .font-mono { font-family: ui-monospace, SFMono-Regular, "Courier New", monospace; }
    </style>
  </defs>
  <!-- Background Panel -->
  <rect width="480" height="160" fill="#090e18" stroke="#202e48" stroke-width="2"/>
  <!-- Crisp Pixel-Art Companion Sprite -->
  <g class="pet-sprite" transform="translate(24, 20)">
    <!-- Rendered Pure SVG Pixel Grid -->
  </g>
  <!-- Companion Metadata & Telemetry -->
  <text x="160" y="40" fill="#f8fafc" font-size="16" font-weight="bold" class="font-mono">NOCTURNE (LVL 5)</text>
  <text x="160" y="60" fill="#818cf8" font-size="11" class="font-mono">VOID STALKER • JUVENILE FORM</text>
  <!-- Progress Bars -->
  ...
</svg>
```

### 2.2 Camo Proxy & Cache-Control Strategy
Because GitHub Camo caches images aggressively:
- Responses MUST emit explicit headers:
  ```http
  Content-Type: image/svg+xml; charset=utf-8
  Cache-Control: public, max-age=180, s-maxage=300, stale-while-revalidate=60
  ETag: W/"<pet-state-hash>"
  ```
- Instant Invalidation: When a user performs an action in the web app, an event triggers an update to the pet's state hash. Subsequent Camo edge requests revalidate with the updated ETag.

### 2.3 Generated Markdown Snippet Format
Users are provided a clean Markdown copy-paste block:

```markdown
<!-- GitHub Profile Pet Embed -->
[![My GitHub Profile Pet](https://githubprofilepet.io/api/pet/octocat/svg)](https://githubprofilepet.io)
```

---

## 3. Public System Architecture & Service Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PUBLIC INTERNET (HTTPS)                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              EDGE CDN & APPLICATION ROUTER (Next.js App)               │
│  - Host: https://app.githubprofilepet.io (Custom Domain + TLS 1.3)     │
│  - Edge Middleware: Rate Limiting & Bot Filtering                     │
│  - Static Asset Delivery (Sprites, Webfonts, Icons)                    │
├───────────────────────────────────┬────────────────────────────────────┤
│           WEB APPLICATION         │             PUBLIC API             │
│  - App Router Dashboard           │  - /api/auth/github (OAuth Start)  │
│  - Interactive Pet Arena Stage    │  - /api/auth/callback (OAuth Ret)  │
│  - Account & Preferences Page     │  - /api/pet/[username]/svg (Embed) │
│  - Bestiary & Roster Catalog      │  - /api/pet/[username]/status      │
└─────────────────┬─────────────────┴──────────────────┬─────────────────┘
                  │                                    │
                  ▼                                    ▼
┌───────────────────────────────────┐    ┌───────────────────────────────┐
│     STATE & RECOVERY ENGINE       │    │     DATA ACCESS LAYER (DAL)   │
│  - Pure Progression Functions     │    │  - Parameterized ORM/Prisma   │
│  - Rolling Diminishing Multipliers│    │  - Token AES-256-GCM Crypt    │
│  - Rest & Vitals Restoration      │    │  - Read/Write Separation      │
└─────────────────┬─────────────────┘    └─────────────┬─────────────────┘
                  │                                    │
                  ▼                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        MANAGED DATABASE CLUSTER                        │
│  - PostgreSQL 16+ (Supabase / Neon / AWS RDS)                          │
│  - Connection Pooling (PgBouncer)                                      │
│  - Automatic Point-In-Time Recovery (PITR)                             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Security, Isolation & Identity Isolation

1. **Zero Token Leakage:**
   - GitHub OAuth access tokens are stored in the database encrypted at rest with AES-256-GCM using an independent master key (`TOKEN_ENCRYPTION_KEY`).
   - Tokens are NEVER sent to the client browser.
   - Public SVG and telemetry endpoints NEVER expose tokens, internal IDs, or private email addresses.
2. **Strict Minimum Scope:**
   - Request strictly `read:user` and public activity permissions. Never request `repo` (write) or organizational administration privileges.
3. **HTTP-Only, Secure, SameSite Cookies:**
   - Session identities are stored in encrypted HTTP-Only cookies with `Secure`, `SameSite=Lax`, and `HttpOnly` attributes.
4. **DDoS & Camo Throttling:**
   - Rate limit `/api/pet/[username]/svg` to 120 requests/minute per IP, while allowing GitHub's Camo CIDR blocks (`140.82.112.0/20`) high throughput.

---

## 5. Deployment Topology & Provisioning Matrix

| Component | Production Target | Environment Variable Config | Redundancy |
| :--- | :--- | :--- | :--- |
| **Frontend / API** | Vercel / Cloudflare Pages / Railway | `NEXT_PUBLIC_APP_URL=https://...` | Global Edge / Auto-scale |
| **Database** | Managed PostgreSQL (Supabase / RDS) | `DATABASE_URL=postgresql://...` | Primary + Standby Replica |
| **Background Sync**| Node worker / Serverless Cron | `GITHUB_SYNC_CRON="*/30 * * * *"` | Distributed Task Queue |
| **Edge Cache** | Cloudflare CDN / Vercel Edge Cache | Handled via `Cache-Control` | 300+ Edge Points of Presence |

---

## 6. Implementation Stages Roadmap

- **Stage 1.1:** Workspace scaffolding, architecture verification, and configuration audit. *(Completed)*
- **Stage 1.2:** Pixel-art frontend foundation, responsive design, dynamic account models, and deterministic gamification engine. *(Completed)*
- **Stage 1.3:** Public architecture definition, environment URL normalization, and SVG preview generator. *(Current)*
- **Stage 2.0:** Public backend deployment, GitHub OAuth 2.0 flow, and persistent PostgreSQL storage.
- **Stage 2.1:** Live GitHub GraphQL contribution synchronizer and automated profile README badge distribution.
