# Bookmark Manager GraphQL API

A production-quality GraphQL API for organizing bookmarks into folders, built with Bun, TypeScript (strict mode), GraphQL Yoga (schema-first), Prisma, and PostgreSQL.

## Features

- **Full CRUD** — Create, read, update, delete bookmarks and folders
- **Move bookmarks** between folders
- **Search** bookmarks by title (case-insensitive substring matching)
- **Cursor-based pagination** — Stable, compound cursor (`createdAt DESC, id DESC`)
- **Duplicate detection** — Soft warning when creating a bookmark with the same normalized URL in the same folder
- **Folder health** — Computed metrics per folder: total bookmarks, duplicate count, stale count
- **Input validation** — Typed GraphQL errors for empty titles, invalid URLs, not-found entities
- **Schema-first GraphQL** — SDL defined in `.graphql` file, resolvers implemented separately

---

## Quick Start

```bash
# 1. Clone and enter the project
git clone <repo-url>
cd bookmark-manager

# 2. Start PostgreSQL
docker compose up -d

# 3. Install dependencies
bun install

# 4. Generate Prisma client and run migrations
bun run generate
bun run gendb

# 5. Start the dev server
bun run dev
```

The GraphQL playground is available at **http://localhost:4000/graphql**.

---

## Environment Variables

| Variable       | Description                     | Default                                                                    |
|----------------|---------------------------------|----------------------------------------------------------------------------|
| `DATABASE_URL` | PostgreSQL connection string    | `postgresql://bookmark_user:bookmark_pass@localhost:5432/bookmark_manager`  |
| `PORT`         | Server port                     | `4000`                                                                     |

Copy `.env.example` to `.env` and adjust as needed:
```bash
cp .env.example .env
```

---

## Database

### PostgreSQL via Docker Compose

```bash
docker compose up -d
```

This starts PostgreSQL 16 (Alpine) with:
- User: `bookmark_user`
- Password: `bookmark_pass`
- Database: `bookmark_manager`
- A separate `bookmark_manager_test` database is auto-created for integration tests

### Prisma Migrations

Migrations are generated using Prisma's migration tooling:

```bash
# Development (generates + applies migrations interactively)
bun run gendb

# Production (applies existing migrations)
bun run migrate:deploy

# View data in Prisma Studio
bun run studio
```

### Schema

The Prisma schema defines two models:

- **Folder** — `id`, `name`, `createdAt`, and a one-to-many relation to bookmarks
- **Bookmark** — `id`, `title`, `url`, `normalizedUrl`, `tags[]`, `folderId`, `createdAt`, `updatedAt`

Key design decisions:
- `onDelete: Restrict` on the Folder→Bookmark relation — no silent cascade orphaning
- `normalizedUrl` is **indexed but NOT unique** — duplicate detection is a soft warning, not a hard constraint
- `updatedAt` added beyond the original spec to support staleness detection in folder health
- Indexes on `folderId`, `normalizedUrl`, `title`, and `createdAt` for query performance

---

## Running Tests

```bash
# All unit tests (no database required)
bun test tests/unit

# Integration tests (requires Docker + PostgreSQL)
bun test tests/integration

# All tests
bun test

# Full sanity check (lint + typecheck + test)
bun run sanity
```

### Test Coverage

**Unit tests** (mocked Prisma):
- URL normalization (16 cases: www stripping, trailing slash, tracking params, etc.)
- Input validation (title, URL, folder name, pagination bounds — success + failure)
- Cursor encode/decode (roundtrip, format, invalid input)
- Folder resolvers (CRUD, not-found errors, name validation)
- Bookmark resolvers (CRUD, move, pagination, duplicate detection, validation errors)

**Integration tests** (real PostgreSQL):
- Full CRUD lifecycle
- Multi-page cursor pagination
- **Pagination consistency**: insert mid-pagination doesn't corrupt already-fetched pages
- Search filtering (case-insensitive substring)
- Move bookmark between folders
- Duplicate detection (same-folder + cross-folder negative case)
- Folder health computation
- Validation error paths (not-found on delete/update)

---

## API

### Queries

#### `folders`
Returns all folders.

```graphql
query {
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
```

#### `folder(id: ID!)`
Returns a single folder with its nested bookmarks.

```graphql
query {
  folder(id: "clxyz...") {
    id
    name
    bookmarks {
      id
      title
      url
      tags
    }
    health {
      totalBookmarks
      duplicateCount
      staleCount
    }
  }
}
```

#### `bookmarks(folderId?, search?, take?, cursor?)`
Returns bookmarks with optional filtering and cursor-based pagination.

```graphql
query {
  bookmarks(search: "typescript", take: 10) {
    edges {
      cursor
      node {
        id
        title
        url
        tags
        folderId
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
    totalCount
  }
}
```

### Mutations

#### `createFolder(input: CreateFolderInput!)`
```graphql
mutation {
  createFolder(input: { name: "Reading List" }) {
    id
    name
  }
}
```

#### `createBookmark(input: CreateBookmarkInput!)`
Returns the created bookmark and a `duplicateOf` field if a bookmark with the same normalized URL already exists in the same folder.

```graphql
mutation {
  createBookmark(input: {
    title: "TypeScript Docs"
    url: "https://www.typescriptlang.org/docs/"
    tags: ["typescript", "docs"]
    folderId: "clxyz..."
  }) {
    bookmark {
      id
      title
      url
    }
    duplicateOf {
      id
      title
    }
  }
}
```

#### `updateBookmark(id: ID!, input: UpdateBookmarkInput!)`
```graphql
mutation {
  updateBookmark(id: "clxyz...", input: { title: "Updated Title" }) {
    id
    title
    updatedAt
  }
}
```

#### `deleteBookmark(id: ID!)`
```graphql
mutation {
  deleteBookmark(id: "clxyz...") {
    id
    title
  }
}
```

#### `moveBookmark(id: ID!, folderId: ID!)`
```graphql
mutation {
  moveBookmark(id: "clxyz...", folderId: "clabc...") {
    id
    folderId
    folder {
      name
    }
  }
}
```

---

## Pagination Approach

We use **compound cursor-based pagination** with `ORDER BY createdAt DESC, id DESC` (newest first).

### How it works

1. **Cursor encoding**: Each cursor is a Base64url-encoded string of `{createdAt_ISO}_{id}`. This is opaque to the client.

2. **Query logic**: When a cursor is provided, we fetch records where:
   ```sql
   WHERE (created_at < cursor_createdAt)
      OR (created_at = cursor_createdAt AND id < cursor_id)
   ORDER BY created_at DESC, id DESC
   LIMIT take + 1
   ```

3. **hasNextPage detection**: We fetch `take + 1` records. If we get more than `take`, there are more pages — we trim the last record and set `hasNextPage = true`.

4. **Why compound cursor?** Using `id` alone is fragile because `cuid()` values are not guaranteed to sort in creation order across different machines. `createdAt` is immutable (set once on insert), so the `(createdAt, id)` pair forms a deterministic, insertion-order-stable sort key.

5. **Insertion stability**: A new record inserted between page fetches does NOT corrupt already-fetched pages. Since the cursor remembers the exact `(createdAt, id)` boundary, the new record (which has a newer `createdAt`) will appear at the top of a fresh first-page query but won't shift records in subsequent pages.

---

## Tradeoffs & Design Decisions

### Duplicate Detection Race Condition
`createBookmark` does a lookup-then-insert for duplicate detection. Under concurrent requests, there's a small TOCTOU (time-of-check-time-of-use) race — two simultaneous creates of the same URL could both pass the check. This is **intentionally left as-is** because:
- Duplicate detection is a soft warning (`duplicateOf` field), not a hard constraint
- Adding a unique constraint would make it a blocking error, which contradicts the design intent
- The race window is tiny and the consequence is minor (both bookmarks are created, the second just lacks the warning)

### `normalizedUrl` — Indexed but Not Unique
The `normalizedUrl` column is indexed for fast lookups during duplicate detection, but intentionally **not a unique constraint**. Duplicates are allowed at the database level — the warning is advisory, not enforced.

### `updatedAt` — Beyond Original Spec
We added `updatedAt` (Prisma's `@updatedAt`) to the Bookmark model to support the "stale bookmarks" metric in folder health. This is documented as an intentional, additive deviation from the original spec.

### `deleteBookmark` Returns Full Bookmark
We return the entire deleted bookmark (not just the ID) to give clients all the data they might need for UI updates (undo, cache eviction) without a second query. This is consistent with how `updateBookmark` and `moveBookmark` work.

---

## How I'd Extend This

If this became a larger production system, I'd consider:

### Authentication & Authorization
- JWT-based auth with user scoping (each user sees only their folders/bookmarks)
- Row-level security in PostgreSQL as defense-in-depth

### Live Link Checking
- Background job (via BullMQ + Redis) to periodically ping bookmark URLs and detect dead links
- `folderHealth.brokenCount` field — intentionally left out of v1 to avoid flaky network-dependent tests and external API calls

### Search Improvements
- Full-text search via PostgreSQL's `tsvector`/`tsquery` (currently using `ILIKE` substring matching)
- Search across tags and URL, not just title
- Faceted search / filtering by tags

### Caching
- DataLoader for N+1 prevention on `Bookmark.folder` and `Folder.bookmarks` field resolvers
- Redis cache for expensive aggregations (folder health) with TTL-based invalidation

### Observability
- Structured logging with pino (correlation IDs per request)
- OpenTelemetry tracing for resolver-level performance visibility
- GraphQL-specific metrics (query depth, field usage, error rates)

### API Versioning
- Schema evolution via field deprecation (`@deprecated` directive) rather than URL versioning
- Persisted queries for production clients

### Scaling
- Read replicas for query traffic
- Connection pooling via PgBouncer
- Horizontal scaling of the GraphQL service (stateless, behind a load balancer)

---

## Project Structure

```
bookmark-manager/
├── docker-compose.yml          # PostgreSQL setup
├── Dockerfile                  # Multi-stage Bun production image
├── package.json
├── tsconfig.json               # Strict mode, no any
├── prisma/
│   └── schema.prisma           # Data model with indexes & constraints
├── src/
│   ├── index.ts                # Server entry (Yoga + HTTP)
│   ├── schema.graphql          # GraphQL SDL (schema-first)
│   ├── context.ts              # Prisma client + logger context
│   ├── logger.ts               # Structured logger
│   ├── resolvers/
│   │   ├── index.ts            # Resolver merge
│   │   ├── folder.ts           # Folder queries & mutations
│   │   ├── bookmark.ts         # Bookmark queries & mutations
│   │   └── types.ts            # Field resolvers (Folder.health, etc.)
│   ├── services/
│   │   ├── folder.service.ts   # Folder business logic
│   │   └── bookmark.service.ts # Bookmark business logic + pagination
│   ├── utils/
│   │   ├── normalize-url.ts    # URL normalization
│   │   ├── validation.ts       # Input validators
│   │   └── cursor.ts           # Cursor encode/decode
│   └── errors/
│       └── graphql-errors.ts   # Typed error factories
├── tests/
│   ├── unit/                   # Mocked Prisma tests
│   └── integration/            # Real PostgreSQL tests
├── scripts/
│   └── init-test-db.sql        # Auto-creates test database
└── .github/
    └── workflows/
        └── ci.yml              # Lint + typecheck + test
```

---

## Scripts

| Script             | Command                    | Description                          |
|--------------------|----------------------------|--------------------------------------|
| `bun run dev`      | `bun run --watch src/index.ts` | Start dev server with hot reload |
| `bun run gendb`    | `bunx prisma migrate dev`  | Generate & apply Prisma migrations   |
| `bun run generate` | `bunx prisma generate`     | Generate Prisma client               |
| `bun run test`     | `bun test`                 | Run all tests                        |
| `bun run test:unit`| `bun test tests/unit`      | Run unit tests only                  |
| `bun run lint`     | `bunx eslint src/ tests/`  | Lint source and test files           |
| `bun run typecheck`| `bunx tsc --noEmit`        | TypeScript type checking             |
| `bun run sanity`   | lint + typecheck + test    | Full sanity check                    |
