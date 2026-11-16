---
name: github-pet-quality-assurance
description: >-
  Enforces multi-layer quality assurance, responsive viewport auditing,
  accessibility standards, reduced-motion compliance, automated testing,
  and browser-based visual verification for GitHub Profile Pet.
  Activate before declaring any UI, gameplay, or layout work complete.
---

# GitHub Profile Pet — Quality Assurance & Verification Skill

This skill enforces strict testing, accessibility, responsive validation, and evidence capture standards for **GitHub Profile Pet**.

---

## 1. Zero Assumptions Quality Principle

> **"A successful build is not proof that the UI works. Never claim browser verification without actual browser evidence."**

Every frontend, layout, or gameplay change must pass three rigorous gates:
1. Automated Static & Unit Verification.
2. Full Multi-Viewport Responsive Browser Inspection.
3. Interactive Functional Smoke Testing with Captured Evidence.

---

## 2. Automated Validation Gates

Execute these synchronously and verify exit code 0:
```bash
npm run lint    # ESLint strict validation (0 errors, 0 warnings)
npm test        # Native Node 24 test runner (All test suites pass)
npm run build   # Next.js 16 App Router Turbopack static build
```

---

## 3. Mandatory Multi-Viewport Responsive Matrix

Every UI change must be visually verified in a real browser at all 5 target viewports:

| Viewport | Device Class | Width × Height | Verification Checklist |
| :--- | :--- | :--- | :--- |
| **1920px** | Large Desktop | 1920 × 1080 | Content constrained to `max-w-[1140px]` centered; 240px sidebar; comfortable outer margins; no stretched cards. |
| **1440px** | Standard Desktop | 1440 × 900 | Content centered at 1140px; balanced 2-column arena/vitals layout; 0px horizontal overflow. |
| **990px** | Tablet / Laptop | 990 × 900 | Sidebar cleanly collapsed; hamburger toggle visible in topbar; drawer opens with backdrop; 0px horizontal overflow. |
| **390px** | Mobile | 390 × 844 | Single-column fluid stack; action buttons form 2×2 grid; readable text without clipping; 0px horizontal overflow. |
| **375px** | Narrow Mobile | 375 × 667 | Strict mobile boundary; all buttons fit comfortably without wrapping awkwardly; exactly 0px horizontal overflow. |

### Horizontal Overflow Calculation Check
Inspect DOM in browser:
```javascript
const hasOverflow = document.documentElement.scrollWidth > window.innerWidth;
console.log(`ScrollWidth: ${document.documentElement.scrollWidth}, WindowWidth: ${window.innerWidth}, Overflow: ${hasOverflow}`);
```

---

## 4. Accessibility (a11y) & Usability Checklist

1. **Keyboard Navigation:**
   - Every interactive control (buttons, pet arena stage, tabs, calendar cells, inputs) must be focusable via `Tab`.
   - Distinct, visible focus rings enforced via `:focus-visible { outline: 2px solid #6366f1 !important; outline-offset: 2px !important; }`.
   - The Pet Arena stage must support `Enter` or `Space` interaction with proper `role="button"`, `tabIndex={0}`, and `aria-label`.
2. **Color Contrast:**
   - Minimum WCAG AA 4.5:1 ratio between text and surface.
   - Text `#f1f5f9` and secondary `#94a3b8` on background `#0c0e12` / surfaces `#12151b`.
3. **Reduced Motion (`prefers-reduced-motion`):**
   - All keyframe animations (`animate-pet-cat`, `animate-pet-dragon`, etc.) must be completely halted when `prefers-reduced-motion: reduce` is enabled.

---

## 5. Live Browser Verification & Screenshot Capture

Use the `browser` subagent to perform visual regression checks and capture clean screenshots to the artifact directory:
- Overview Dashboard (1440px, 1920px, 990px, 390px, 375px).
- Settings README Embed Preview (1440px).
- Companion Bestiary & Roster Catalog (1440px).
- Active interaction state showing feedback banners and floating particles.

Always reference captured evidence in reports with full clickable markdown links.

## References
- Test Suite: `tests/unit/*.test.ts`
- Responsive Corrections History: `docs/architecture/system-overview.md`
- Visual Identity Specs: `docs/architecture/character-art-specification.md`
