/**
 * Type-level field resolvers.
 *
 * These resolve computed/nested fields on types returned by Query/Mutation
 * resolvers. They run lazily — only when the client requests these fields.
 *
 * - Folder.bookmarks → lazy-load bookmarks for a folder
 * - Folder.health → computed folder health metrics
 * - Bookmark.folder → lazy-load parent folder
 * - Bookmark.createdAt / updatedAt → ISO string formatting
 */

import type { Folder, Bookmark } from "../generated/prisma/index.js";
import type { GraphQLContext } from "../context.js";
import * as bookmarkService from "../services/bookmark.service.js";

export const typeResolvers = {
  Folder: {
    bookmarks: async (
      parent: Folder,
      _args: Record<string, never>,
      context: GraphQLContext,
    ) => {
      return context.prisma.bookmark.findMany({
        where: { folderId: parent.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    },

    health: async (
      parent: Folder,
      _args: Record<string, never>,
      context: GraphQLContext,
    ) => {
      return bookmarkService.getFolderHealth(context.prisma, parent.id);
    },

    createdAt: (parent: Folder) => {
      return parent.createdAt.toISOString();
    },
  },

  Bookmark: {
    folder: async (
      parent: Bookmark,
      _args: Record<string, never>,
      context: GraphQLContext,
    ) => {
      return context.prisma.folder.findUnique({
        where: { id: parent.folderId },
      });
    },

    createdAt: (parent: Bookmark) => {
      return parent.createdAt.toISOString();
    },

    updatedAt: (parent: Bookmark) => {
      return parent.updatedAt.toISOString();
    },
  },

  // CreateBookmarkPayload field resolvers — ensure nested bookmark/duplicateOf
  // also get proper date formatting via the Bookmark type resolvers above.
  CreateBookmarkPayload: {
    bookmark: (parent: { bookmark: Bookmark }) => parent.bookmark,
    duplicateOf: (parent: { duplicateOf: Bookmark | null }) => parent.duplicateOf,
  },
};
