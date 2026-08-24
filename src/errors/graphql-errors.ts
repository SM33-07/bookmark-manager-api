/**
 * Typed GraphQL error helpers.
 *
 * Each function creates a GraphQLError with a specific error code in extensions.
 * These codes are documented in the schema and can be used by clients for
 * programmatic error handling.
 */

import { GraphQLError } from "graphql";

export function notFoundError(entity: string, id: string): GraphQLError {
  return new GraphQLError(`${entity} with id "${id}" not found.`, {
    extensions: { code: "NOT_FOUND", entity, id },
  });
}

export function folderNotFoundError(id: string): GraphQLError {
  return notFoundError("Folder", id);
}

export function bookmarkNotFoundError(id: string): GraphQLError {
  return notFoundError("Bookmark", id);
}
