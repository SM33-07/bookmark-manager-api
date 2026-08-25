/**
 * Bookmark resolvers — Query and Mutation resolvers for Bookmark operations.
 */

import type { GraphQLContext } from "../context.js";
import { validateTitle, validateUrl, validateTake } from "../utils/validation.js";
import * as bookmarkService from "../services/bookmark.service.js";

export interface CreateBookmarkInput {
  title: string;
  url: string;
  tags?: string[] | null;
  folderId: string;
}

export interface UpdateBookmarkInput {
  title?: string | null;
  url?: string | null;
  tags?: string[] | null;
}

export interface BookmarksArgs {
  folderId?: string | null;
  search?: string | null;
  take?: number | null;
  cursor?: string | null;
}

export const bookmarkResolvers = {
  Query: {
    bookmarks: async (
      _parent: unknown,
      args: BookmarksArgs,
      context: GraphQLContext,
    ) => {
      const take = validateTake(args.take);

      context.logger.info("Fetching bookmarks", {
        folderId: args.folderId ?? undefined,
        search: args.search ?? undefined,
        take,
        hasCursor: !!args.cursor,
      });

      return bookmarkService.getBookmarksPaginated(context.prisma, {
        folderId: args.folderId,
        search: args.search,
        take,
        cursor: args.cursor,
      });
    },
  },

  Mutation: {
    createBookmark: async (
      _parent: unknown,
      args: { input: CreateBookmarkInput },
      context: GraphQLContext,
    ) => {
      const title = validateTitle(args.input.title);
      const url = validateUrl(args.input.url);
      const tags = args.input.tags ?? [];

      context.logger.info("Creating bookmark", { title, folderId: args.input.folderId });

      const result = await bookmarkService.createBookmark(context.prisma, {
        title,
        url,
        tags,
        folderId: args.input.folderId,
      });

      if (result.duplicateOf) {
        context.logger.warn("Duplicate bookmark detected", {
          newId: result.bookmark.id,
          duplicateOfId: result.duplicateOf.id,
          normalizedUrl: result.bookmark.normalizedUrl,
        });
      }

      return result;
    },

    updateBookmark: async (
      _parent: unknown,
      args: { id: string; input: UpdateBookmarkInput },
      context: GraphQLContext,
    ) => {
      const updateData: bookmarkService.UpdateBookmarkData = {};

      if (args.input.title !== undefined && args.input.title !== null) {
        updateData.title = validateTitle(args.input.title);
      }
      if (args.input.url !== undefined && args.input.url !== null) {
        updateData.url = validateUrl(args.input.url);
      }
      if (args.input.tags !== undefined && args.input.tags !== null) {
        updateData.tags = args.input.tags;
      }

      context.logger.info("Updating bookmark", { id: args.id });

      return bookmarkService.updateBookmark(context.prisma, args.id, updateData);
    },

    deleteBookmark: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext,
    ) => {
      context.logger.info("Deleting bookmark", { id: args.id });
      return bookmarkService.deleteBookmark(context.prisma, args.id);
    },

    moveBookmark: async (
      _parent: unknown,
      args: { id: string; folderId: string },
      context: GraphQLContext,
    ) => {
      context.logger.info("Moving bookmark", {
        id: args.id,
        targetFolderId: args.folderId,
      });
      return bookmarkService.moveBookmark(context.prisma, args.id, args.folderId);
    },
  },
};

