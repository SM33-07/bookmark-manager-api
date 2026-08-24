/**
 * Server entry point.
 *
 * Sets up GraphQL Yoga with:
 * - Schema-first approach (SDL loaded from .graphql file)
 * - Prisma context
 * - Request-scoped logging
 * - Graceful shutdown
 */

import { createServer } from "node:http";
import { createSchema, createYoga } from "graphql-yoga";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvers } from "./resolvers/index.js";
import { createContext, disconnectPrisma, type GraphQLContext } from "./context.js";
import { createLogger } from "./logger.js";

const logger = createLogger();

// Load SDL from .graphql file (schema-first approach)
const typeDefs = readFileSync(
  join(import.meta.dir, "schema.graphql"),
  "utf-8",
);

const schema = createSchema<GraphQLContext>({
  typeDefs,
  resolvers,
});

const yoga = createYoga<GraphQLContext>({
  schema,
  context: () => createContext(),
  maskedErrors: {
    isDev: process.env.NODE_ENV !== "production",
  },
  graphiql: {
    title: "Bookmark Manager API",
    defaultQuery: `# Welcome to the Bookmark Manager API!
# 
# Try these example queries:

query GetFolders {
  folders {
    id
    name
    createdAt
    health {
      totalBookmarks
      duplicateCount
      staleCount
    }
  }
}

mutation CreateFolder {
  createFolder(input: { name: "Reading List" }) {
    id
    name
  }
}
`,
  },
});

const port = parseInt(process.env.PORT ?? "4000", 10);

const server = createServer(yoga);

server.listen(port, () => {
  logger.info(`🚀 Bookmark Manager API running at http://localhost:${port}/graphql`);
});

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down...");
  server.close();
  await disconnectPrisma();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
