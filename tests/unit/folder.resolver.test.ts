/**
 * Unit tests for folder resolvers.
 *
 * Uses a mocked Prisma client to test resolver logic in isolation.
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";
import { GraphQLError } from "graphql";
import { folderResolvers } from "../../src/resolvers/folder.js";
import type { GraphQLContext } from "../../src/context.js";

// ─── Mock Prisma ────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    folder: {
      findMany: mock(() => Promise.resolve([])),
      findUnique: mock(() => Promise.resolve(null)),
      create: mock(() => Promise.resolve(null)),
    },
    bookmark: {
      findMany: mock(() => Promise.resolve([])),
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

// ─── Tests ──────────────────────────────────────────────────────────

describe("Folder Query Resolvers", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let context: GraphQLContext;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    context = createMockContext(mockPrisma);
  });

  describe("folders", () => {
    it("should return all folders ordered by createdAt desc", async () => {
      const mockFolders = [
        { id: "1", name: "Work", createdAt: new Date("2025-02-01") },
        { id: "2", name: "Personal", createdAt: new Date("2025-01-01") },
      ];
      mockPrisma.folder.findMany.mockResolvedValue(mockFolders);

      const result = await folderResolvers.Query.folders({}, {}, context);

      expect(result).toEqual(mockFolders);
      expect(mockPrisma.folder.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: "desc" },
      });
    });

    it("should return empty array when no folders exist", async () => {
      mockPrisma.folder.findMany.mockResolvedValue([]);

      const result = await folderResolvers.Query.folders({}, {}, context);

      expect(result).toEqual([]);
    });
  });

  describe("folder", () => {
    it("should return a folder by id", async () => {
      const mockFolder = {
        id: "folder-1",
        name: "Dev Resources",
        createdAt: new Date(),
      };
      mockPrisma.folder.findUnique.mockResolvedValue(mockFolder);

      const result = await folderResolvers.Query.folder(
        {},
        { id: "folder-1" },
        context,
      );

      expect(result).toEqual(mockFolder);
      expect(mockPrisma.folder.findUnique).toHaveBeenCalledWith({
        where: { id: "folder-1" },
      });
    });

    it("should throw NOT_FOUND for non-existent folder", async () => {
      mockPrisma.folder.findUnique.mockResolvedValue(null);

      try {
        await folderResolvers.Query.folder(
          {},
          { id: "nonexistent" },
          context,
        );
        expect(true).toBe(false); // Should not reach here
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("NOT_FOUND");
        expect((e as GraphQLError).message).toContain("nonexistent");
      }
    });
  });
});

describe("Folder Mutation Resolvers", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let context: GraphQLContext;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    context = createMockContext(mockPrisma);
  });

  describe("createFolder", () => {
    it("should create a folder with valid name", async () => {
      const mockFolder = {
        id: "new-folder",
        name: "Reading List",
        createdAt: new Date(),
      };
      mockPrisma.folder.create.mockResolvedValue(mockFolder);

      const result = await folderResolvers.Mutation.createFolder(
        {},
        { input: { name: "  Reading List  " } },
        context,
      );

      expect(result).toEqual(mockFolder);
      // Should receive trimmed name
      expect(mockPrisma.folder.create).toHaveBeenCalledWith({
        data: { name: "Reading List" },
      });
    });

    it("should reject empty folder name", async () => {
      try {
        await folderResolvers.Mutation.createFolder(
          {},
          { input: { name: "" } },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("INVALID_FOLDER_NAME");
      }
    });

    it("should reject whitespace-only folder name", async () => {
      try {
        await folderResolvers.Mutation.createFolder(
          {},
          { input: { name: "   " } },
          context,
        );
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe("INVALID_FOLDER_NAME");
      }
    });
  });
});
