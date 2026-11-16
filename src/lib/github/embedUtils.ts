/**
 * Resolves the public base URL of the deployed application.
 *
 * Evaluation Order:
 * 1. Process environment: NEXT_PUBLIC_APP_URL
 * 2. Vercel deployment URL: VERCEL_PROJECT_PRODUCTION_URL or VERCEL_URL
 * 3. Fallback to standard protocol + host if in browser context
 * 4. Fallback to relative path or default localhost for local development
 */
export function getPublicAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  }

  if (process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL.replace(/\/+$/, '')}`;
  }

  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL.replace(/\/+$/, '')}`;
  }

  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }

  return 'http://localhost:3000';
}

/**
 * Generates the standardized Markdown embed snippet for a user's GitHub README.
 */
export function generateReadmeEmbedSnippet(username: string, theme: string = 'dark-pixel'): {
  markdown: string;
  html: string;
  svgUrl: string;
} {
  const baseUrl = getPublicAppUrl();
  const safeUsername = encodeURIComponent(username.replace(/^@/, ''));
  const svgUrl = `${baseUrl}/api/pet/${safeUsername}/svg${theme !== 'dark-pixel' ? `?theme=${encodeURIComponent(theme)}` : ''}`;
  const profileUrl = `${baseUrl}`;

  const markdown = `[![${username}'s GitHub Profile Pet](${svgUrl})](${profileUrl})`;
  const html = `<a href="${profileUrl}"><img src="${svgUrl}" alt="${username}'s GitHub Profile Pet" /></a>`;

  return { markdown, html, svgUrl };
}
