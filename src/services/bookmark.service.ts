/**
 * Bookmark service — business logic for bookmark operations.
 *
 * Handles CRUD, duplicate detection, cursor pagination, and folder health.
 */

import type { PrismaClient, Bookmark } from "../generated/prisma/index.js";
import { bookmarkNotFoundError } from "../errors/graphql-errors.js";
import { normalizeUrl } from "../utils/normalize-url.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";
import { ensureFolderExists } from "./folder.service.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface CreateBookmarkData {
  title: string;
  url: string;
  tags: string[];
  folderId: string;
}

export interface UpdateBookmarkData {
  title?: string;
  url?: string;
  tags?: string[];
}

export interface PaginatedBookmarksArgs {
  folderId?: string | null;
  search?: string | null;
  take: number;
  cursor?: string | null;
}

export interface BookmarkEdge {
  cursor: string;
  node: Bookmark;
}

export interface BookmarkConnection {
  edges: BookmarkEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
  totalCount: number;
}

export interface FolderHealthData {
  totalBookmarks: number;
  duplicateCount: number;
  staleCount: number;
}

export interface CreateBookmarkResult {
  bookmark: Bookmark;
  duplicateOf: Bookmark | null;
}

// ─── Stale threshold (30 days) ──────────────────────────────────────

const STALE_THRESHOLD_DAYS = 30;

// ─── Operations ─────────────────────────────────────────────────────

export async function createBookmark(
  prisma: PrismaClient,
  data: CreateBookmarkData,
): Promise<CreateBookmarkResult> {
  // Verify folder exists before creating
  await ensureFolderExists(prisma, data.folderId);

  const normalized = normalizeUrl(data.url);

  // Check for same-folder duplicate (soft warning, not a hard error)
  const existingDuplicate = await prisma.bookmark.findFirst({
    where: {
      folderId: data.folderId,
      normalizedUrl: normalized,
    },
    orderBy: { createdAt: "asc" },
  });

  const bookmark = await prisma.bookmark.create({
    data: {
      title: data.title,
      url: data.url,
      normalizedUrl: normalized,
      tags: data.tags,
      folderId: data.folderId,
    },
  });

  return {
    bookmark,
    duplicateOf: existingDuplicate,
  };
}

export async function updateBookmark(
  prisma: PrismaClient,
  id: string,
  data: UpdateBookmarkData,
): Promise<Bookmark> {
  // Verify bookmark exists
  const existing = await prisma.bookmark.findUnique({ where: { id } });
  if (!existing) {
    throw bookmarkNotFoundError(id);
  }

  // Build update payload — only include fields that were provided
  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) {
    updateData.title = data.title;
  }
  if (data.url !== undefined) {
    updateData.url = data.url;
    updateData.normalizedUrl = normalizeUrl(data.url);
  }
  if (data.tags !== undefined) {
    updateData.tags = data.tags;
  }

  return prisma.bookmark.update({
    where: { id },
    data: updateData,
  });
}

export async function deleteBookmark(
  prisma: PrismaClient,
  id: string,
): Promise<Bookmark> {
  const existing = await prisma.bookmark.findUnique({ where: { id } });
  if (!existing) {
    throw bookmarkNotFoundError(id);
  }

  return prisma.bookmark.delete({ where: { id } });
}

export async function moveBookmark(
  prisma: PrismaClient,
  id: string,
  folderId: string,
): Promise<Bookmark> {
  // Verify both exist
  const existing = await prisma.bookmark.findUnique({ where: { id } });
  if (!existing) {
    throw bookmarkNotFoundError(id);
  }

  await ensureFolderExists(prisma, folderId);

  return prisma.bookmark.update({
    where: { id },
    data: { folderId },
  });
}

/**
 * Cursor-based pagination for bookmarks.
 *
 * Ordering: createdAt DESC, id DESC (newest first)
 * Cursor: Base64url of "{createdAt_ISO}_{id}"
 *
 * The compound cursor ensures stable pagination even when new records are
 * inserted between page fetches, because the sort key (createdAt, id) is
 * immutable and unique.
 */
export async function getBookmarksPaginated(
  prisma: PrismaClient,
  args: PaginatedBookmarksArgs,
): Promise<BookmarkConnection> {
  const { folderId, search, take, cursor } = args;

  // Build WHERE clause
  const where: Record<string, unknown> = {};

  if (folderId) {
    where.folderId = folderId;
  }

  if (search && search.trim().length > 0) {
    where.title = {
      contains: search.trim(),
      mode: "insensitive",
    };
  }

  // Cursor-based filtering
  if (cursor) {
    const decoded = decodeCursor(cursor);
    // WHERE (createdAt < cursorCreatedAt)
    //    OR (createdAt = cursorCreatedAt AND id < cursorId)
    where.OR = [
      { createdAt: { lt: decoded.createdAt } },
      {
        createdAt: { equals: decoded.createdAt },
        id: { lt: decoded.id },
      },
    ];
  }

  // Fetch take+1 to determine hasNextPage
  const [bookmarks, totalCount] = await Promise.all([
    prisma.bookmark.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
    prisma.bookmark.count({
      where: (() => {
        // Total count uses same filters but WITHOUT cursor
        const countWhere: Record<string, unknown> = {};
        if (folderId) countWhere.folderId = folderId;
        if (search && search.trim().length > 0) {
          countWhere.title = { contains: search.trim(), mode: "insensitive" };
        }
        return countWhere;
      })(),
    }),
  ]);

  const hasNextPage = bookmarks.length > take;
  const resultBookmarks = hasNextPage ? bookmarks.slice(0, take) : bookmarks;

  const edges: BookmarkEdge[] = resultBookmarks.map((bookmark) => ({
    cursor: encodeCursor(bookmark.createdAt, bookmark.id),
    node: bookmark,
  }));

  const lastEdge = edges[edges.length - 1];

  return {
    edges,
    pageInfo: {
      hasNextPage,
      endCursor: lastEdge ? lastEdge.cursor : null,
    },
    totalCount,
  };
}

/**
 * Compute folder health metrics.
 *
 * - totalBookmarks: count of bookmarks in the folder
 * - duplicateCount: number of normalizedUrls that appear more than once
 * - staleCount: bookmarks not updated in STALE_THRESHOLD_DAYS days
 *
 * Pure computation over existing data — no cron, no external calls.
 */
export async function getFolderHealth(
  prisma: PrismaClient,
  folderId: string,
): Promise<FolderHealthData> {
  const staleThreshold = new Date(
    Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
  );

  const [totalBookmarks, staleCount, duplicateRows] = await Promise.all([
    prisma.bookmark.count({ where: { folderId } }),
    prisma.bookmark.count({
      where: {
        folderId,
        updatedAt: { lt: staleThreshold },
      },
    }),
    // Count normalizedUrls with more than one occurrence in this folder
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM (
        SELECT normalized_url
        FROM bookmarks
        WHERE folder_id = ${folderId}
        GROUP BY normalized_url
        HAVING COUNT(*) > 1
      ) AS dupes
    `,
  ]);

  const duplicateCount = Number(duplicateRows[0]?.count ?? 0);

  return {
    totalBookmarks,
    duplicateCount,
    staleCount,
  };
}
