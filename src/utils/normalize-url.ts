/**
 * URL normalization for duplicate detection.
 *
 * Normalizes a URL to a canonical form so that trivially different URLs
 * (trailing slashes, www prefix, tracking params) are recognized as the same resource.
 *
 * Rules:
 * 1. Parse with URL constructor (validates format)
 * 2. Lowercase the hostname
 * 3. Strip "www." prefix from hostname
 * 4. Remove trailing slash from pathname (unless pathname is just "/")
 * 5. Remove known tracking query params (utm_*, fbclid, gclid, etc.)
 * 6. Sort remaining query params for deterministic output
 * 7. Drop the fragment/hash (not sent to server)
 */

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "msclkid",
  "ref",
  "mc_cid",
  "mc_eid",
]);

export function normalizeUrl(raw: string): string {
  const url = new URL(raw);

  // Lowercase hostname and strip www.
  let hostname = url.hostname.toLowerCase();
  if (hostname.startsWith("www.")) {
    hostname = hostname.slice(4);
  }

  // Remove trailing slash from pathname (keep "/" if that's the entire path)
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  // Filter and sort query params
  const params = new URLSearchParams();
  const sortedKeys = Array.from(url.searchParams.keys()).sort();
  for (const key of sortedKeys) {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) {
      const value = url.searchParams.get(key);
      if (value !== null) {
        params.set(key, value);
      }
    }
  }

  const queryString = params.toString();
  const search = queryString ? `?${queryString}` : "";

  // Include port if non-default
  const port = url.port ? `:${url.port}` : "";

  // Reconstruct — drop fragment entirely
  return `${url.protocol}//${hostname}${port}${pathname}${search}`;
}
