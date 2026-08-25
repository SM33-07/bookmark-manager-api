/**
 * Unit tests for URL normalization.
 *
 * Tests the pure normalizeUrl function across various edge cases:
 * - www stripping, trailing slash removal, tracking param removal
 * - Query param sorting, fragment removal, protocol preservation
 */

import { describe, expect, it } from "bun:test";
import { normalizeUrl } from "../../src/utils/normalize-url.js";

describe("normalizeUrl", () => {
  it("should lowercase the hostname", () => {
    expect(normalizeUrl("https://EXAMPLE.COM/path")).toBe(
      "https://example.com/path",
    );
  });

  it("should strip www. prefix", () => {
    expect(normalizeUrl("https://www.example.com/page")).toBe(
      "https://example.com/page",
    );
  });

  it("should strip www. and lowercase combined", () => {
    expect(normalizeUrl("https://WWW.Example.COM/")).toBe(
      "https://example.com/",
    );
  });

  it("should remove trailing slash from pathname", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe(
      "https://example.com/path",
    );
  });

  it("should keep the root slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("should remove utm_* tracking params", () => {
    const url =
      "https://example.com/page?utm_source=twitter&utm_medium=social&key=value";
    expect(normalizeUrl(url)).toBe("https://example.com/page?key=value");
  });

  it("should remove fbclid, gclid, msclkid tracking params", () => {
    const url =
      "https://example.com/page?fbclid=abc&gclid=def&msclkid=ghi&keep=yes";
    expect(normalizeUrl(url)).toBe("https://example.com/page?keep=yes");
  });

  it("should sort remaining query params alphabetically", () => {
    const url = "https://example.com/page?z=1&a=2&m=3";
    expect(normalizeUrl(url)).toBe("https://example.com/page?a=2&m=3&z=1");
  });

  it("should drop the fragment/hash", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe(
      "https://example.com/page",
    );
  });

  it("should handle URLs with no path", () => {
    expect(normalizeUrl("https://example.com")).toBe(
      "https://example.com/",
    );
  });

  it("should handle http protocol", () => {
    expect(normalizeUrl("http://example.com/page")).toBe(
      "http://example.com/page",
    );
  });

  it("should produce identical output for trivially different URLs", () => {
    const url1 = "https://www.Example.COM/page/?utm_source=google#top";
    const url2 = "https://example.com/page";
    expect(normalizeUrl(url1)).toBe(normalizeUrl(url2));
  });

  it("should handle URLs with ports", () => {
    expect(normalizeUrl("https://example.com:8080/api")).toBe(
      "https://example.com:8080/api",
    );
  });

  it("should handle URLs with auth info", () => {
    // URL constructor handles user:pass@host
    const result = normalizeUrl("https://user:pass@example.com/path");
    expect(result).toContain("example.com/path");
  });

  it("should throw on invalid URLs", () => {
    expect(() => normalizeUrl("not-a-url")).toThrow();
  });

  it("should handle empty query string after removing tracking params", () => {
    const url = "https://example.com/page?utm_source=twitter&utm_medium=social";
    expect(normalizeUrl(url)).toBe("https://example.com/page");
  });
});
