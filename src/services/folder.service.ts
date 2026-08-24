/**
 * Folder service — business logic for folder operations.
 *
 * Thin layer between resolvers and Prisma. Keeps resolvers focused on
 * GraphQL concerns (input extraction, response shaping) while services
 * own data access and business rules.
 */

import type { PrismaClient } from "../generated/prisma/index.js";
import { folderNotFoundError } from "../errors/graphql-errors.js";

export interface CreateFolderData {
  name: string;
}

export async function getAllFolders(prisma: PrismaClient) {
  return prisma.folder.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function getFolderById(prisma: PrismaClient, id: string) {
  const folder = await prisma.folder.findUnique({
    where: { id },
  });

  if (!folder) {
    throw folderNotFoundError(id);
  }

  return folder;
}

export async function createFolder(prisma: PrismaClient, data: CreateFolderData) {
  return prisma.folder.create({
    data: {
      name: data.name,
    },
  });
}

/**
 * Verify a folder exists — used before operations that reference a folder
 * (e.g. createBookmark, moveBookmark) to give a clear error message.
 */
export async function ensureFolderExists(prisma: PrismaClient, id: string) {
  const folder = await prisma.folder.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!folder) {
    throw folderNotFoundError(id);
  }
}
