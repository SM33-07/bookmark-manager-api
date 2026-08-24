/**
 * Unit tests for bookmark resolvers.
 *
 * Tests resolver logic with mocked Prisma client:
 * - CRUD operations
 * - Input validation (title, URL)
 * - Move bookmark
 * - Duplicate detection on create
 * - Error paths (not found, invalid input)
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";
import { GraphQLError } from "graphql";
import { bookmarkResolvers } from "../../src/resolvers/bookmark.js";
import type { GraphQLContext } from "../../src/context.js";

// ─── Mock Prisma ────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    folder: {
      findUnique: mock(() => Promise.resolve({ id: "folder-1" })),
    },
    bookmark: {
      findFirst: mock(() => Promise.resolve(null)),
      findUnique: mock(() => Promise.resolve(null)),
      findMany: mock(() => Promise.resolve([])),
      create: mock(() => Promise.resolve(null)),
      update: mock(() => Promise.resolve(null)),
      delete: mock(() => Promise.resolve(null)),
      count: mock(() => Promise.resolve(0)),
    },
  };
}

function createMockContext(prisma: ReturnType<typeof createMockPrisma>): GraphQLContext {
  return {
    prisma: prisma as unknown as GraphQLContext["prisma"],
    logger: {
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
  };
}

// ─── Helper ─────────────────────────────────────────────────────────

function mockBookmark(overrides: Record<string, unknown> = {}) {
  return {
    id: "bm-1",
    title: "Test Bookmark",
    url: "https://example.com",
    normalizedUrl: "https://example.com/",
    tags: ["test"],
    folderId: "folder-1",
    createdAt: new Date("2025-01-15T10:00:00Z"),
    updatedAt: new Date("2025-01-15T10:00:00Z"),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Bookmark Mutation Resolvers", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let context: GraphQLContext;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    context = createMockContext(mockPrisma);
  });

  describe("createBookmark", () => {
    it("should create a bookmark with valid input", async () => {
      const created = mockBookmark();
      mockPrisma.bookmark.create.mockResolvedValue(created);
      mockPrisma.bookmark.findFirst.mockResolvedValue(null); // no duplicate

      const result = await bookmarkResolvers.Mutation.createBookmark(
        {},
        {
          input: {
            title: "Test Bookmark",
            url: "https://example.com",
            tags: ["test"],
            folderId: "folder-1",
          },
        },
        context,
      );

      expect(result.bookmark).toEqual(created);
      expect(result.duplicateOf).toBeNull();
    });

    it("should return duplicateOf when same normalized URL exists in folder", async () => {
      const existing = mockBookmark({ id: "existing-bm" });
      const created = mockBookmark({ id: "new-bm" });
      mockPrisma.bookmark.findFirst.mockResolvedValue(existing);
      mockPrisma.bookmark.create.mockResolvedValue(created);

      const result = await bookmarkResolvers.Mutation.createBookmark(
        {},
        {
          input: {
            title: "Duplicate Bookmark",
            url: "https://example.com",
            folderId: "folder-1",
          },
        },
        context,
      );

      expect(result.bookmark).toEqual(created);
      expect(result.duplicateOf).toEqual(existing);
    });

    it("should reject empty title", async () => {
      try {
        await bookmarkResolvers.Mutation.createBookmark(
          {},
          {
            input: {
              title: "",
              url: "https://example.com",
              folderId: "folder-1",
            },
          },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("INVALID_TITLE");
      }
    });

    it("should reject invalid URL", async () => {
      try {
        await bookmarkResolvers.Mutation.createBookmark(
          {},
          {
            input: {
              title: "Valid Title",
              url: "not-a-url",
              folderId: "folder-1",
            },
          },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("INVALID_URL");
      }
    });

    it("should reject non-http/https URL", async () => {
      try {
        await bookmarkResolvers.Mutation.createBookmark(
          {},
          {
            input: {
              title: "Valid Title",
              url: "ftp://example.com",
              folderId: "folder-1",
            },
          },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("INVALID_URL");
      }
    });

    it("should reject when folder does not exist", async () => {
      mockPrisma.folder.findUnique.mockResolvedValue(null);

      try {
        await bookmarkResolvers.Mutation.createBookmark(
          {},
          {
            input: {
              title: "Valid Title",
              url: "https://example.com",
              folderId: "nonexistent-folder",
            },
          },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("NOT_FOUND");
      }
    });

    it("should log a warning when duplicate is detected", async () => {
      const existing = mockBookmark({ id: "existing-bm" });
      const created = mockBookmark({ id: "new-bm" });
      mockPrisma.bookmark.findFirst.mockResolvedValue(existing);
      mockPrisma.bookmark.create.mockResolvedValue(created);

      await bookmarkResolvers.Mutation.createBookmark(
        {},
        {
          input: {
            title: "Dup",
            url: "https://example.com",
            folderId: "folder-1",
          },
        },
        context,
      );

      expect(context.logger.warn).toHaveBeenCalled();
    });
  });

  describe("updateBookmark", () => {
    it("should update bookmark title", async () => {
      const existing = mockBookmark();
      const updated = mockBookmark({ title: "Updated Title" });
      mockPrisma.bookmark.findUnique.mockResolvedValue(existing);
      mockPrisma.bookmark.update.mockResolvedValue(updated);

      const result = await bookmarkResolvers.Mutation.updateBookmark(
        {},
        { id: "bm-1", input: { title: "Updated Title" } },
        context,
      );

      expect(result).toEqual(updated);
    });

    it("should reject invalid title on update", async () => {
      try {
        await bookmarkResolvers.Mutation.updateBookmark(
          {},
          { id: "bm-1", input: { title: "   " } },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("INVALID_TITLE");
      }
    });

    it("should reject invalid URL on update", async () => {
      try {
        await bookmarkResolvers.Mutation.updateBookmark(
          {},
          { id: "bm-1", input: { url: "bad-url" } },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("INVALID_URL");
      }
    });
  });

  describe("deleteBookmark", () => {
    it("should delete and return the bookmark", async () => {
      const existing = mockBookmark();
      mockPrisma.bookmark.findUnique.mockResolvedValue(existing);
      mockPrisma.bookmark.delete.mockResolvedValue(existing);

      const result = await bookmarkResolvers.Mutation.deleteBookmark(
        {},
        { id: "bm-1" },
        context,
      );

      expect(result).toEqual(existing);
    });

    it("should throw NOT_FOUND for non-existent bookmark", async () => {
      mockPrisma.bookmark.findUnique.mockResolvedValue(null);

      try {
        await bookmarkResolvers.Mutation.deleteBookmark(
          {},
          { id: "nonexistent" },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("moveBookmark", () => {
    it("should move bookmark to another folder", async () => {
      const existing = mockBookmark();
      const moved = mockBookmark({ folderId: "folder-2" });
      mockPrisma.bookmark.findUnique.mockResolvedValue(existing);
      mockPrisma.bookmark.update.mockResolvedValue(moved);

      const result = await bookmarkResolvers.Mutation.moveBookmark(
        {},
        { id: "bm-1", folderId: "folder-2" },
        context,
      );

      expect(result.folderId).toBe("folder-2");
    });

    it("should throw NOT_FOUND when bookmark doesn't exist", async () => {
      mockPrisma.bookmark.findUnique.mockResolvedValue(null);

      try {
        await bookmarkResolvers.Mutation.moveBookmark(
          {},
          { id: "nonexistent", folderId: "folder-2" },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("NOT_FOUND");
      }
    });

    it("should throw NOT_FOUND when target folder doesn't exist", async () => {
      const existing = mockBookmark();
      // First call: bookmark.findUnique → found
      // Second call: folder.findUnique → not found
      mockPrisma.bookmark.findUnique.mockResolvedValue(existing);
      mockPrisma.folder.findUnique.mockResolvedValueOnce(null);

      try {
        await bookmarkResolvers.Mutation.moveBookmark(
          {},
          { id: "bm-1", folderId: "nonexistent-folder" },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("NOT_FOUND");
      }
    });
  });
});

describe("Bookmark Query Resolvers", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let context: GraphQLContext;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    context = createMockContext(mockPrisma);
  });

  describe("bookmarks (pagination)", () => {
    it("should return paginated bookmarks with pageInfo", async () => {
      const bookmarks = [
        mockBookmark({ id: "bm-1", createdAt: new Date("2025-01-15T10:00:00Z") }),
        mockBookmark({ id: "bm-2", createdAt: new Date("2025-01-14T10:00:00Z") }),
      ];
      // Return exactly take items (no next page)
      mockPrisma.bookmark.findMany.mockResolvedValue(bookmarks);
      mockPrisma.bookmark.count.mockResolvedValue(2);

      const result = await bookmarkResolvers.Query.bookmarks(
        {},
        { take: 2 },
        context,
      );

      expect(result.edges).toHaveLength(2);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.totalCount).toBe(2);
    });

    it("should detect hasNextPage when more results exist", async () => {
      // Return take+1 items to signal more pages
      const bookmarks = [
        mockBookmark({ id: "bm-1" }),
        mockBookmark({ id: "bm-2" }),
        mockBookmark({ id: "bm-3" }), // extra item
      ];
      mockPrisma.bookmark.findMany.mockResolvedValue(bookmarks);
      mockPrisma.bookmark.count.mockResolvedValue(5);

      const result = await bookmarkResolvers.Query.bookmarks(
        {},
        { take: 2 },
        context,
      );

      expect(result.edges).toHaveLength(2); // trimmed to take
      expect(result.pageInfo.hasNextPage).toBe(true);
      expect(result.pageInfo.endCursor).toBeTruthy();
    });

    it("should return empty edges for no results", async () => {
      mockPrisma.bookmark.findMany.mockResolvedValue([]);
      mockPrisma.bookmark.count.mockResolvedValue(0);

      const result = await bookmarkResolvers.Query.bookmarks(
        {},
        {},
        context,
      );

      expect(result.edges).toHaveLength(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.endCursor).toBeNull();
      expect(result.totalCount).toBe(0);
    });

    it("should reject invalid take value", async () => {
      try {
        await bookmarkResolvers.Query.bookmarks(
          {},
          { take: 0 },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("INVALID_INPUT");
      }
    });
  });
});
