# Getting Started with Development

## Prerequisites

- **Node.js**: v24.x or higher
- **npm**: v11.x or higher
- **Git**

## Setup Instructions

1. **Clone the repository and enter workspace**:
   ```bash
   cd D:\Projects\GitHub-Profile-Pet
   ```

2. **Configure Environment Variables**:
   Copy the example environment configuration:
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` to configure required values for local development.

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Run the Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Code Quality Checks**:
   - Check linting:
     ```bash
     npm run lint
     ```
   - Verify production build:
     ```bash
     npm run build
     ```

## Project Directory Quick Reference

- `src/app/`: Next.js App Router root, pages, layouts, and API routes.
- `src/components/`: Reusable presentational components (atomic UI, pet displays, layouts).
- `src/features/`: Domain-specific business logic (streaks, gamification, pets, github).
- `src/lib/`: Shared technical infrastructure (clients, config, utilities).
- `public/`: Static assets (sprites, icons, pet illustrations, backgrounds).
- `tests/`: Automated unit and integration test suites.
