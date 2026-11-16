import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateReadmeEmbedSnippet, getPublicAppUrl } from '../../src/lib/github/embedUtils.ts';

describe('Public README Embed & URL Resolver Engine', () => {
  it('generates consistent Markdown snippets without client-side scripts', () => {
    const { markdown, html, svgUrl } = generateReadmeEmbedSnippet('octocat');

    assert.ok(markdown.includes('![octocat\'s GitHub Profile Pet]('));
    assert.ok(markdown.includes('/api/pet/octocat/svg'));
    assert.ok(html.includes('<img src='));
    assert.ok(svgUrl.endsWith('/api/pet/octocat/svg'));
  });

  it('normalizes handles with leading @ symbol', () => {
    const { svgUrl } = generateReadmeEmbedSnippet('@octocat-trainer');
    assert.ok(svgUrl.includes('/api/pet/octocat-trainer/svg'));
    assert.ok(!svgUrl.includes('@'));
  });

  it('appends theme parameters when non-default theme is chosen', () => {
    const { svgUrl } = generateReadmeEmbedSnippet('octocat', 'cyber-neon');
    assert.ok(svgUrl.includes('?theme=cyber-neon'));
  });

  it('resolves base public application URL from environment or fallback', () => {
    const originalEnv = process.env.NEXT_PUBLIC_APP_URL;

    process.env.NEXT_PUBLIC_APP_URL = 'https://app.githubprofilepet.io/';
    const resolvedUrl = getPublicAppUrl();
    assert.equal(resolvedUrl, 'https://app.githubprofilepet.io');

    // Restore
    if (originalEnv) {
      process.env.NEXT_PUBLIC_APP_URL = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  });
});
