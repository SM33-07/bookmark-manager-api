/**
 * Resolver map — merges all resolvers into a single object for Yoga.
 */

import { folderResolvers } from "./folder.js";
import { bookmarkResolvers } from "./bookmark.js";
import { typeResolvers } from "./types.js";

export const resolvers = {
  Query: {
    ...folderResolvers.Query,
    ...bookmarkResolvers.Query,
  },
  Mutation: {
    ...folderResolvers.Mutation,
    ...bookmarkResolvers.Mutation,
  },
  ...typeResolvers,
};
