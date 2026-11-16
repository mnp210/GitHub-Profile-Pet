# Domain Boundaries & Architectural Guidelines

## 1. Directory & Responsibility Map

### `src/app/` (Application Shell & Routing)
- Contains Next.js App Router route groups, pages, layouts, error boundaries, and API entry points.
- **Rule**: Route handlers (`src/app/api/...`) must act as HTTP adapters. They handle parsing request parameters, invoking feature-layer handlers, and formatting HTTP responses. Core business rules must not be implemented directly inside route files.
- Route Groups:
  - `(dashboard)/`: Authenticated dashboard routes containing the interactive pet arena, statistics, and configuration views.
  - `api/`: API route entry points for OAuth callbacks, activity sync webhooks/polling, and dynamic README widget rendering.

### `src/components/` (Presentation Layer)
- Houses purely reusable presentational React components.
- Subdirectories:
  - `layout/`: Navbars, footers, sidebars, page containers.
  - `dashboard/`: Presentational cards, metric badges, layout grids.
  - `pet/`: Pet canvas viewers, mood indicators, sprite stage wrappers.
  - `activity/`: Contribution heatmaps, streak counters, history timelines.
  - `auth/`: Login buttons, session badges, avatar chips.
  - `ui/`: Fundamental primitive UI components (buttons, dialogs, tooltips, cards).
- **Rule**: Components in this folder must not import from `src/features/` directly unless receiving structured view models via props.

### `src/features/` (Domain-Driven Modules)
Each domain module is self-contained and may define internal services, state logic, and domain types:
- `authentication/`: User session state, OAuth token refresh flows, session guards.
- `github/`: Ingestion of GitHub GraphQL data, contribution calendar parsing, event normalization.
- `streaks/`: Pure algorithmic streak calculations (current commit streak, longest streak, contribution intensity).
- `pets/`: Species catalog, mood determination, state machine transitions, sprite configuration.
- `gamification/`: XP calculation, level progression, badge unlock criteria, evolution rules.
- **Rule**: Feature logic must be unit-testable without requiring a browser DOM or running Next.js server.

### `src/lib/` (Infrastructure & Third-Party Adapters)
- `github/`: Octokit / GraphQL client setup, rate limiting handlers, query definitions.
- `auth/`: Cryptographic helpers, OAuth provider configurations, cookie management.
- `utils/`: General-purpose helper functions (date formatting, string manipulation).
- `config/`: Validated environment variables and runtime configurations.

### `src/types/` & `src/constants/`
- Shared domain contracts, API interfaces, game balancing constants, and route tables.

---

## 2. Dependency Flow Rules

```text
[ src/app (Routes / API) ]
           │
           ▼
[ src/features (Domain Logic & State) ] ◄──► [ src/components (Presentation) ]
           │
           ▼
[ src/lib (Infrastructure & Clients) ]
           │
           ▼
[ src/types & src/constants ]
```

1. **Top-to-Bottom Flow**: Higher-level modules (routes) can depend on lower-level modules (features, lib), never vice-versa.
2. **Feature Isolation**: Features must avoid tight coupling with other features. Communication across features should occur via shared types or unified facade services.
3. **Pure Presentation**: Components should remain declarative and receive state from feature hooks or server components.
