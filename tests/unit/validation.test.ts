/**
 * Unit tests for input validation.
 *
 * Tests validation functions for:
 * - Bookmark title (empty, whitespace, length)
 * - Bookmark URL (malformed, wrong protocol, valid)
 * - Folder name (empty, whitespace, length)
 * - Pagination take (bounds, type)
 *
 * Each validator should throw a GraphQLError with a specific code on failure.
 */

import { describe, expect, it } from "bun:test";
import { GraphQLError } from "graphql";
import {
  validateTitle,
  validateUrl,
  validateFolderName,
  validateTake,
} from "../../src/utils/validation.js";

// ─── validateTitle ──────────────────────────────────────────────────

describe("validateTitle", () => {
  it("should return trimmed title for valid input", () => {
    expect(validateTitle("  My Bookmark  ")).toBe("My Bookmark");
  });

  it("should reject empty string", () => {
    expect(() => validateTitle("")).toThrow(GraphQLError);
    try {
      validateTitle("");
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe("INVALID_TITLE");
    }
  });

  it("should reject whitespace-only string", () => {
    expect(() => validateTitle("   \t\n  ")).toThrow(GraphQLError);
    try {
      validateTitle("   \t\n  ");
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe("INVALID_TITLE");
    }
  });

  it("should reject titles exceeding max length", () => {
    const longTitle = "a".repeat(501);
    expect(() => validateTitle(longTitle)).toThrow(GraphQLError);
    try {
      validateTitle(longTitle);
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe("INVALID_TITLE");
    }
  });

  it("should accept title at exactly max length", () => {
    const maxTitle = "a".repeat(500);
    expect(validateTitle(maxTitle)).toBe(maxTitle);
  });
});

// ─── validateUrl ────────────────────────────────────────────────────

describe("validateUrl", () => {
  it("should accept valid https URL", () => {
    expect(validateUrl("https://example.com")).toBe("https://example.com");
  });

  it("should accept valid http URL", () => {
    expect(validateUrl("http://example.com/path")).toBe(
      "http://example.com/path",
    );
  });

  it("should trim whitespace", () => {
    expect(validateUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("should reject empty string", () => {
    expect(() => validateUrl("")).toThrow(GraphQLError);
    try {
      validateUrl("");
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe("INVALID_URL");
    }
  });

  it("should reject malformed URLs", () => {
    expect(() => validateUrl("not-a-url")).toThrow(GraphQLError);
    try {
      validateUrl("not-a-url");
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe("INVALID_URL");
    }
  });

  it("should reject non-http/https protocols", () => {
    expect(() => validateUrl("ftp://example.com")).toThrow(GraphQLError);
    try {
      validateUrl("ftp://example.com");
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe("INVALID_URL");
      expect((e as GraphQLError).message).toContain("ftp:");
    }
  });

  it("should reject javascript: protocol", () => {
    expect(() => validateUrl("javascript:alert(1)")).toThrow(GraphQLError);
  });

  it("should accept URLs with query strings and fragments", () => {
    expect(validateUrl("https://example.com/path?q=1#section")).toBe(
      "https://example.com/path?q=1#section",
    );
  });
});

// ─── validateFolderName ─────────────────────────────────────────────

describe("validateFolderName", () => {
  it("should return trimmed name for valid input", () => {
    expect(validateFolderName("  My Folder  ")).toBe("My Folder");
  });

  it("should reject empty string", () => {
    expect(() => validateFolderName("")).toThrow(GraphQLError);
    try {
      validateFolderName("");
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe("INVALID_FOLDER_NAME");
    }
  });

  it("should reject whitespace-only string", () => {
    expect(() => validateFolderName("   ")).toThrow(GraphQLError);
  });

  it("should reject names exceeding max length", () => {
    const longName = "b".repeat(201);
    expect(() => validateFolderName(longName)).toThrow(GraphQLError);
  });
});

// ─── validateTake ───────────────────────────────────────────────────

describe("validateTake", () => {
  it("should return default (20) for null", () => {
    expect(validateTake(null)).toBe(20);
  });

  it("should return default (20) for undefined", () => {
    expect(validateTake(undefined)).toBe(20);
  });

  it("should accept valid positive integer", () => {
    expect(validateTake(10)).toBe(10);
  });

  it("should accept maximum value (100)", () => {
    expect(validateTake(100)).toBe(100);
  });

  it("should reject zero", () => {
    expect(() => validateTake(0)).toThrow(GraphQLError);
  });

  it("should reject negative numbers", () => {
    expect(() => validateTake(-5)).toThrow(GraphQLError);
  });

  it("should reject values over 100", () => {
    expect(() => validateTake(101)).toThrow(GraphQLError);
    try {
      validateTake(101);
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe("INVALID_INPUT");
    }
  });
});
