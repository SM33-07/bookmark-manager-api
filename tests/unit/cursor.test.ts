/**
 * Unit tests for cursor encoding/decoding.
 *
 * Tests the compound cursor (createdAt + id) encode/decode roundtrip,
 * plus invalid cursor error handling.
 */

import { describe, expect, it } from "bun:test";
import { GraphQLError } from "graphql";
import { encodeCursor, decodeCursor } from "../../src/utils/cursor.js";

describe("cursor encode/decode", () => {
  it("should roundtrip correctly", () => {
    const createdAt = new Date("2025-01-15T10:30:00.000Z");
    const id = "cltest123abc";

    const encoded = encodeCursor(createdAt, id);
    const decoded = decodeCursor(encoded);

    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded.id).toBe(id);
  });

  it("should produce a base64url string", () => {
    const encoded = encodeCursor(new Date(), "test-id");
    // base64url: no +, /, or = padding (may have - and _)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("should produce different cursors for different inputs", () => {
    const date = new Date("2025-01-15T10:30:00.000Z");
    const cursor1 = encodeCursor(date, "id-1");
    const cursor2 = encodeCursor(date, "id-2");
    expect(cursor1).not.toBe(cursor2);
  });

  it("should produce different cursors for different dates", () => {
    const date1 = new Date("2025-01-15T10:30:00.000Z");
    const date2 = new Date("2025-01-16T10:30:00.000Z");
    const cursor1 = encodeCursor(date1, "same-id");
    const cursor2 = encodeCursor(date2, "same-id");
    expect(cursor1).not.toBe(cursor2);
  });

  it("should throw on completely invalid base64", () => {
    expect(() => decodeCursor("!!!invalid!!!")).toThrow(GraphQLError);
    try {
      decodeCursor("!!!invalid!!!");
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe("INVALID_CURSOR");
    }
  });

  it("should throw on base64 without separator", () => {
    const noSeparator = Buffer.from("noseparator", "utf-8").toString("base64url");
    expect(() => decodeCursor(noSeparator)).toThrow(GraphQLError);
  });

  it("should throw on base64 with invalid date", () => {
    const badDate = Buffer.from("not-a-date_valid-id", "utf-8").toString("base64url");
    expect(() => decodeCursor(badDate)).toThrow(GraphQLError);
  });

  it("should throw on base64 with missing id", () => {
    const missingId = Buffer.from("2025-01-15T10:30:00.000Z_", "utf-8").toString("base64url");
    expect(() => decodeCursor(missingId)).toThrow(GraphQLError);
  });

  it("should handle dates with millisecond precision", () => {
    const preciseDate = new Date("2025-06-15T12:34:56.789Z");
    const id = "precise-id";

    const encoded = encodeCursor(preciseDate, id);
    const decoded = decodeCursor(encoded);

    expect(decoded.createdAt.getTime()).toBe(preciseDate.getTime());
  });
});
