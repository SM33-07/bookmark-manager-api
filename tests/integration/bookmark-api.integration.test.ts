/**
 * Integration test against a real PostgreSQL database.
 *
 * This test runs against a live PostgreSQL instance (via Docker Compose or CI).
 * When PostgreSQL is offline, it skips gracefully with a helpful message.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach } from "bun:test";
import { PrismaClient } from "../../src/generated/prisma/index.js";
import { GraphQLError } from "graphql";
import * as folderService from "../../src/services/folder.service.js";
import * as bookmarkService from "../../src/services/bookmark.service.js";

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

let dbAvailable = false;

beforeAll(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    console.log("ℹ️  PostgreSQL not reachable: skipping integration suite (start with `docker compose up -d`)");
  }
});

afterAll(async () => {
  if (dbAvailable) {
    await prisma.$disconnect();
  }
});

beforeEach(async () => {
  if (!dbAvailable) return;
  await prisma.bookmark.deleteMany();
  await prisma.folder.deleteMany();
});

describe("Integration: Full CRUD Lifecycle", () => {
  it("should create a folder, add bookmarks, query, update, and delete", async () => {
    if (!dbAvailable) return;

    // 1. Create folder
    const folder = await folderService.createFolder(prisma, { name: "Dev Tools" });
    expect(folder.id).toBeTruthy();
    expect(folder.name).toBe("Dev Tools");

    // 2. Create bookmark
    const result = await bookmarkService.createBookmark(prisma, {
      title: "GitHub",
      url: "https://github.com",
      tags: ["dev", "git"],
      folderId: folder.id,
    });
    expect(result.bookmark.title).toBe("GitHub");
    expect(result.bookmark.folderId).toBe(folder.id);
    expect(result.duplicateOf).toBeNull();

    // 3. Query by folder
    const paginated = await bookmarkService.getBookmarksPaginated(prisma, {
      folderId: folder.id,
      take: 10,
    });
    expect(paginated.edges).toHaveLength(1);
    expect(paginated.edges[0]?.node.title).toBe("GitHub");
    expect(paginated.totalCount).toBe(1);

    // 4. Update bookmark
    const updated = await bookmarkService.updateBookmark(
      prisma,
      result.bookmark.id,
      { title: "GitHub - Updated" },
    );
    expect(updated.title).toBe("GitHub - Updated");

    // 5. Delete bookmark
    const deleted = await bookmarkService.deleteBookmark(prisma, result.bookmark.id);
    expect(deleted.id).toBe(result.bookmark.id);

    // 6. Verify deletion
    const afterDelete = await bookmarkService.getBookmarksPaginated(prisma, {
      folderId: folder.id,
      take: 10,
    });
    expect(afterDelete.edges).toHaveLength(0);
    expect(afterDelete.totalCount).toBe(0);
  });
});

describe("Integration: Cursor Pagination", () => {
  it("should paginate correctly across multiple pages", async () => {
    if (!dbAvailable) return;

    const folder = await folderService.createFolder(prisma, { name: "Pagination Test" });

    for (let i = 1; i <= 5; i++) {
      await bookmarkService.createBookmark(prisma, {
        title: `Bookmark ${i}`,
        url: `https://example.com/page-${i}`,
        tags: [],
        folderId: folder.id,
      });
      await new Promise((r) => setTimeout(r, 10));
    }

    const page1 = await bookmarkService.getBookmarksPaginated(prisma, {
      folderId: folder.id,
      take: 2,
    });
    expect(page1.edges).toHaveLength(2);
    expect(page1.pageInfo.hasNextPage).toBe(true);
    expect(page1.totalCount).toBe(5);
    expect(page1.edges[0]?.node.title).toBe("Bookmark 5");
    expect(page1.edges[1]?.node.title).toBe("Bookmark 4");

    const page2 = await bookmarkService.getBookmarksPaginated(prisma, {
      folderId: folder.id,
      take: 2,
      cursor: page1.pageInfo.endCursor,
    });
    expect(page2.edges).toHaveLength(2);
    expect(page2.pageInfo.hasNextPage).toBe(true);
    expect(page2.edges[0]?.node.title).toBe("Bookmark 3");
    expect(page2.edges[1]?.node.title).toBe("Bookmark 2");

    const page3 = await bookmarkService.getBookmarksPaginated(prisma, {
      folderId: folder.id,
      take: 2,
      cursor: page2.pageInfo.endCursor,
    });
    expect(page3.edges).toHaveLength(1);
    expect(page3.pageInfo.hasNextPage).toBe(false);
    expect(page3.edges[0]?.node.title).toBe("Bookmark 1");

    const allTitles = [
      ...page1.edges.map((e) => e.node.title),
      ...page2.edges.map((e) => e.node.title),
      ...page3.edges.map((e) => e.node.title),
    ];
    expect(new Set(allTitles).size).toBe(5);
  });

  it("should maintain consistency when a record is inserted mid-pagination", async () => {
    if (!dbAvailable) return;

    const folder = await folderService.createFolder(prisma, { name: "Consistency Test" });

    for (let i = 1; i <= 4; i++) {
      await bookmarkService.createBookmark(prisma, {
        title: `Initial ${i}`,
        url: `https://example.com/initial-${i}`,
        tags: [],
        folderId: folder.id,
      });
      await new Promise((r) => setTimeout(r, 10));
    }

    const page1 = await bookmarkService.getBookmarksPaginated(prisma, {
      folderId: folder.id,
      take: 2,
    });
    expect(page1.edges).toHaveLength(2);
    expect(page1.edges[0]?.node.title).toBe("Initial 4");
    expect(page1.edges[1]?.node.title).toBe("Initial 3");

    await bookmarkService.createBookmark(prisma, {
      title: "Inserted Mid-Pagination",
      url: "https://example.com/mid-insert",
      tags: [],
      folderId: folder.id,
    });

    const page2 = await bookmarkService.getBookmarksPaginated(prisma, {
      folderId: folder.id,
      take: 2,
      cursor: page1.pageInfo.endCursor,
    });
    expect(page2.edges).toHaveLength(2);
    expect(page2.edges[0]?.node.title).toBe("Initial 2");
    expect(page2.edges[1]?.node.title).toBe("Initial 1");

    const page2Titles = page2.edges.map((e) => e.node.title);
    expect(page2Titles).not.toContain("Inserted Mid-Pagination");
  });
});

describe("Integration: Search", () => {
  it("should search bookmarks by title substring (case-insensitive)", async () => {
    if (!dbAvailable) return;

    const folder = await folderService.createFolder(prisma, { name: "Search Test" });

    await bookmarkService.createBookmark(prisma, {
      title: "TypeScript Handbook",
      url: "https://typescriptlang.org/docs/handbook",
      tags: ["ts"],
      folderId: folder.id,
    });
    await bookmarkService.createBookmark(prisma, {
      title: "JavaScript Guide",
      url: "https://developer.mozilla.org/docs/javascript",
      tags: ["js"],
      folderId: folder.id,
    });
    await bookmarkService.createBookmark(prisma, {
      title: "Rust Book",
      url: "https://doc.rust-lang.org/book",
      tags: ["rust"],
      folderId: folder.id,
    });

    const results = await bookmarkService.getBookmarksPaginated(prisma, {
      search: "script",
      take: 10,
    });
    expect(results.edges).toHaveLength(2);
    const titles = results.edges.map((e) => e.node.title);
    expect(titles).toContain("TypeScript Handbook");
    expect(titles).toContain("JavaScript Guide");

    const upper = await bookmarkService.getBookmarksPaginated(prisma, {
      search: "TYPESCRIPT",
      take: 10,
    });
    expect(upper.edges).toHaveLength(1);
    expect(upper.edges[0]?.node.title).toBe("TypeScript Handbook");
  });
});

describe("Integration: Move Bookmark", () => {
  it("should move a bookmark between folders", async () => {
    if (!dbAvailable) return;

    const folder1 = await folderService.createFolder(prisma, { name: "Folder A" });
    const folder2 = await folderService.createFolder(prisma, { name: "Folder B" });

    const { bookmark } = await bookmarkService.createBookmark(prisma, {
      title: "Moveable",
      url: "https://example.com/move-me",
      tags: [],
      folderId: folder1.id,
    });

    expect(bookmark.folderId).toBe(folder1.id);

    const moved = await bookmarkService.moveBookmark(prisma, bookmark.id, folder2.id);
    expect(moved.folderId).toBe(folder2.id);

    const f1Bookmarks = await bookmarkService.getBookmarksPaginated(prisma, {
      folderId: folder1.id,
      take: 10,
    });
    expect(f1Bookmarks.edges).toHaveLength(0);

    const f2Bookmarks = await bookmarkService.getBookmarksPaginated(prisma, {
      folderId: folder2.id,
      take: 10,
    });
    expect(f2Bookmarks.edges).toHaveLength(1);
    expect(f2Bookmarks.edges[0]?.node.id).toBe(bookmark.id);
  });

  it("should throw NOT_FOUND when moving to non-existent folder", async () => {
    if (!dbAvailable) return;

    const folder = await folderService.createFolder(prisma, { name: "Source" });
    const { bookmark } = await bookmarkService.createBookmark(prisma, {
      title: "Stay Put",
      url: "https://example.com/stay",
      tags: [],
      folderId: folder.id,
    });

    try {
      await bookmarkService.moveBookmark(prisma, bookmark.id, "nonexistent-folder");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe("NOT_FOUND");
    }
  });
});

describe("Integration: Duplicate Detection", () => {
  it("should detect same-folder duplicate by normalized URL", async () => {
    if (!dbAvailable) return;

    const folder = await folderService.createFolder(prisma, { name: "Dupes" });

    const first = await bookmarkService.createBookmark(prisma, {
      title: "Original",
      url: "https://www.example.com/page/",
      tags: [],
      folderId: folder.id,
    });
    expect(first.duplicateOf).toBeNull();

    const second = await bookmarkService.createBookmark(prisma, {
      title: "Duplicate",
      url: "https://example.com/page?utm_source=twitter",
      tags: [],
      folderId: folder.id,
    });
    expect(second.duplicateOf).not.toBeNull();
    expect(second.duplicateOf?.id).toBe(first.bookmark.id);
    expect(second.bookmark.id).not.toBe(first.bookmark.id);
  });

  it("should NOT flag duplicate across different folders", async () => {
    if (!dbAvailable) return;

    const folder1 = await folderService.createFolder(prisma, { name: "Folder 1" });
    const folder2 = await folderService.createFolder(prisma, { name: "Folder 2" });

    await bookmarkService.createBookmark(prisma, {
      title: "In Folder 1",
      url: "https://example.com/page",
      tags: [],
      folderId: folder1.id,
    });

    const inFolder2 = await bookmarkService.createBookmark(prisma, {
      title: "In Folder 2",
      url: "https://example.com/page",
      tags: [],
      folderId: folder2.id,
    });

    expect(inFolder2.duplicateOf).toBeNull();
  });
});

describe("Integration: Folder Health", () => {
  it("should compute folder health metrics", async () => {
    if (!dbAvailable) return;

    const folder = await folderService.createFolder(prisma, { name: "Health Test" });

    await bookmarkService.createBookmark(prisma, {
      title: "Unique 1",
      url: "https://example.com/unique-1",
      tags: [],
      folderId: folder.id,
    });
    await bookmarkService.createBookmark(prisma, {
      title: "Duplicate A",
      url: "https://example.com/same-page",
      tags: [],
      folderId: folder.id,
    });
    await bookmarkService.createBookmark(prisma, {
      title: "Duplicate B",
      url: "https://www.example.com/same-page/",
      tags: [],
      folderId: folder.id,
    });

    const health = await bookmarkService.getFolderHealth(prisma, folder.id);

    expect(health.totalBookmarks).toBe(3);
    expect(health.duplicateCount).toBe(1);
    expect(health.staleCount).toBe(0);
  });
});

describe("Integration: Validation Errors", () => {
  it("should reject non-existent bookmark for delete", async () => {
    if (!dbAvailable) return;

    try {
      await bookmarkService.deleteBookmark(prisma, "nonexistent-id");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe("NOT_FOUND");
    }
  });

  it("should reject non-existent bookmark for update", async () => {
    if (!dbAvailable) return;

    try {
      await bookmarkService.updateBookmark(prisma, "nonexistent-id", {
        title: "New Title",
      });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe("NOT_FOUND");
    }
  });
});
