// src/lib/security/csrf.ts
// Origin verification and open-redirect defense for state-changing endpoints

/**
 * Validates whether an incoming request's Origin or Referer header matches the trusted application origin.
 * Defends against Cross-Site Request Forgery (CSRF) on state-changing authenticated endpoints.
 */
export function verifyRequestOrigin(request: Request): { valid: boolean; reason?: string } {
  const method = request.method.toUpperCase();

  // Safe HTTP methods do not require origin checks
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return { valid: true };
  }

  const originHeader = request.headers.get('origin');
  const refererHeader = request.headers.get('referer');
  const hostHeader = request.headers.get('host') || request.headers.get('x-forwarded-host');

  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const isProduction = process.env.NODE_ENV === 'production';

  // Extract source origin from Origin or Referer
  let sourceOrigin: string | null = null;
  if (originHeader) {
    sourceOrigin = originHeader.trim();
  } else if (refererHeader) {
    try {
      const parsedReferer = new URL(refererHeader);
      sourceOrigin = parsedReferer.origin;
    } catch {
      return { valid: false, reason: 'Malformed Referer header.' };
    }
  }

  // In test and non-production environments, allow requests without Origin/Referer (e.g. CLI or integration test runners)
  if (!sourceOrigin) {
    if (!isProduction) {
      return { valid: true };
    }
    return { valid: false, reason: 'Missing Origin and Referer headers on state-changing request.' };
  }

  // Build list of allowed origins
  const allowedOrigins = new Set<string>();

  if (configuredAppUrl) {
    try {
      allowedOrigins.add(new URL(configuredAppUrl).origin);
    } catch {
      // Ignore invalid configured URL
    }
  }

  if (hostHeader) {
    allowedOrigins.add(`http://${hostHeader}`);
    allowedOrigins.add(`https://${hostHeader}`);
  }

  // In non-production, permit standard local development origins
  if (!isProduction) {
    allowedOrigins.add('http://localhost:3000');
    allowedOrigins.add('http://127.0.0.1:3000');
    allowedOrigins.add('http://localhost:3001');
    allowedOrigins.add('http://127.0.0.1:3001');
  }

  if (allowedOrigins.has(sourceOrigin)) {
    return { valid: true };
  }

  // Non-production regex check for any localhost/127.0.0.1 port
  if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(sourceOrigin)) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `Cross-origin request rejected: Origin "${sourceOrigin}" does not match trusted origins.`,
  };
}

/**
 * Sanitizes and validates post-authentication return URLs to prevent open-redirect vulnerabilities.
 * Strictly allows only internal relative paths starting with a single '/' and not '//' or '/\'.
 */
export function sanitizeReturnUrl(returnUrl?: string | null, fallback = '/'): string {
  if (!returnUrl || typeof returnUrl !== 'string') {
    return fallback;
  }

  const trimmed = returnUrl.trim();

  // Reject empty string
  if (trimmed.length === 0) {
    return fallback;
  }

  // Reject absolute URLs, protocol-relative URLs (//example.com), and backslash exploits (/\example.com)
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    trimmed.includes('://') ||
    trimmed.includes('\\')
  ) {
    return fallback;
  }

  return trimmed;
}
