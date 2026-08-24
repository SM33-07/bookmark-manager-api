/**
 * Folder resolvers — Query and Mutation resolvers for Folder operations.
 */

import type { GraphQLContext } from "../context.js";
import { validateFolderName } from "../utils/validation.js";
import * as folderService from "../services/folder.service.js";

export interface CreateFolderInput {
  name: string;
}

export const folderResolvers = {
  Query: {
    folders: async (
      _parent: unknown,
      _args: Record<string, never>,
      context: GraphQLContext,
    ) => {
      context.logger.info("Fetching all folders");
      return folderService.getAllFolders(context.prisma);
    },

    folder: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext,
    ) => {
      context.logger.info("Fetching folder", { id: args.id });
      return folderService.getFolderById(context.prisma, args.id);
    },
  },

  Mutation: {
    createFolder: async (
      _parent: unknown,
      args: { input: CreateFolderInput },
      context: GraphQLContext,
    ) => {
      const name = validateFolderName(args.input.name);
      context.logger.info("Creating folder", { name });
      return folderService.createFolder(context.prisma, { name });
    },
  },
};

