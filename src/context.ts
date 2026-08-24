/**
 * GraphQL context factory.
 *
 * Provides:
 * - Prisma client (shared across requests)
 * - Request-scoped logger (logs include timestamp for correlation)
 */

import { PrismaClient } from "./generated/prisma/index.js";
import { createLogger, type Logger } from "./logger.js";

export interface GraphQLContext {
  prisma: PrismaClient;
  logger: Logger;
}

// Singleton Prisma client — shared across all requests.
// Prisma handles connection pooling internally.
let prismaClient: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient();
  }
  return prismaClient;
}

export function createContext(): GraphQLContext {
  return {
    prisma: getPrismaClient(),
    logger: createLogger(),
  };
}

/**
 * Gracefully disconnect Prisma on shutdown.
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}
