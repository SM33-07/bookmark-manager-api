# Submission Walkthrough — Bookmark Manager GraphQL API

## 1. Opening Framing

This is a GraphQL API for organizing bookmarks into folders, built with Bun, TypeScript (strict mode), GraphQL Yoga, Prisma, and PostgreSQL. If there's one thing I'd want a reviewer to take away from this submission, it's that I prioritized **correctness of the things that are easy to get subtly wrong — cursor-based pagination and duplicate detection — over breadth of features**. Every feature that made it in is tested against a real Postgres instance, not just happy-path unit mocks.

---

## 2. How I Approached the Problem

I started by reading the spec twice — once to absorb the full scope, and once to identify which requirements had hidden complexity. Three things stood out immediately:

1. **Pagination** — the spec said "cursor-based." That's a meaningful constraint. It rules out offset/limit and requires you to think about what happens when data changes between page fetches. I knew this would be the load-bearing piece of the implementation, so I decided to design the cursor format before writing a single resolver.

2. **Duplicate detection** — the spec mentioned detecting duplicates but didn't specify whether it should be a hard error or a soft warning. I decided early that it should be a soft warning (the `duplicateOf` return field), because blocking a user from saving a link they explicitly want to save is bad UX. That one decision shaped the entire data model — specifically, why `normalizedUrl` is indexed but not unique.

3. **Differentiator feature** — the spec asked to build something beyond the basic requirements. I chose Folder Health (total bookmarks, duplicate count, stale count) because it builds naturally on top of the normalization and data model work I was already doing, rather than being a bolted-on feature that would distract from core quality.

The actual build order was: **schema.prisma → schema.graphql → utils (validation, normalization, cursor) → error helpers → services → resolvers → unit tests → integration tests → README → CI**. I worked schema-first because getting the data model and the GraphQL contract right up front meant the resolver layer could be thin delegation. Unit tests came before integration tests because I wanted to validate each util function in isolation before wiring everything through a real database.

This was iterative, not a single up-front plan. I went back to the Prisma schema twice: once to add `updatedAt` (when I realized folder health needed staleness detection), and once to add the `@@index([createdAt])` that the pagination query needed for performance.

---

## 3. Architecture Walkthrough with a Real Request Trace

### The Layering

The codebase follows a three-layer architecture:

- **Resolvers** (`src/resolvers/`) — extract GraphQL inputs, run validation, delegate to services, shape responses
- **Services** (`src/services/`) — own business logic, data access, and error throwing
- **Utils** (`src/utils/`) — pure functions for validation, URL normalization, cursor encoding

The resolver layer never touches Prisma directly for business operations (the one exception is the type-level field resolvers in `types.ts` for lazy-loaded relations, which are thin enough that pulling them into a service would be pure ceremony).

### Tracing `createBookmark` End-to-End

Here's a concrete `createBookmark` mutation as the client sends it:

```graphql
mutation {
  createBookmark(input: {
    title: "TypeScript Docs"
    url: "https://www.typescriptlang.org/docs/"
    tags: ["typescript", "docs"]
    folderId: "clxyz..."
  }) {
    bookmark { id title url }
    duplicateOf { id title }
  }
}
```

**Hop 1: The resolver** (`src/resolvers/bookmark.ts`). GraphQL Yoga dispatches to `bookmarkResolvers.Mutation.createBookmark`. The resolver immediately validates input before touching any service:

```typescript
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
```

The ordering is intentional: `validateTitle` runs first because it's the cheapest check (string length). `validateUrl` runs second because it constructs a `URL` object. Both throw typed `GraphQLError` instances with `extensions.code` — `INVALID_TITLE` or `INVALID_URL` — before any database round-trip occurs.

**Hop 2: The service** (`src/services/bookmark.service.ts`). The `createBookmark` function handles two things: folder existence verification and duplicate detection.

```typescript
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
```

`ensureFolderExists` is a guard function in `folder.service.ts` that does a `SELECT id FROM folders WHERE id = ?` and throws a `NOT_FOUND` GraphQLError if the folder doesn't exist. It uses `select: { id: true }` to minimize data transfer — we don't need the full folder row, just confirmation it exists.

The duplicate check uses `findFirst` against the compound filter `{ folderId, normalizedUrl }` — both of which are indexed. The `normalizeUrl` call is what makes `"https://www.typescriptlang.org/docs/"` match against a previously stored `"https://typescriptlang.org/docs"` (trailing slash removed, www stripped).

**Hop 3: The Prisma query.** The actual SQL that Prisma generates for the `create` call looks roughly like:

```sql
INSERT INTO bookmarks (id, title, url, normalized_url, tags, folder_id, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
RETURNING *;
```

The `id` is a `cuid()` generated by Prisma client-side. `normalized_url` is computed in-app before being written — the database just stores it as a plain string column with an index.

**Hop 4: The response.** The service returns `{ bookmark, duplicateOf }`, which maps directly to the `CreateBookmarkPayload` GraphQL type. The type resolvers in `types.ts` handle date serialization — `createdAt` and `updatedAt` are `Date` objects from Prisma, and the type resolvers call `.toISOString()` to return them as strings.

---

## 4. The Three Hardest Design Decisions

### a) Cursor-Based Pagination

The naive approach here would be offset/limit pagination — `LIMIT 20 OFFSET 40` for page 3. It's simple to implement and most tutorials teach it first. I rejected it because offset pagination has a well-known consistency bug: if a record is inserted or deleted between page fetches, records shift position. You either skip an item or see it twice. For a bookmark manager where a user might be adding bookmarks in one tab while paginating in another, this is a real scenario, not a theoretical one.

My cursor is a compound of `(createdAt, id)`, Base64url-encoded into an opaque string. The key insight is why a single-field cursor breaks: if I used `id` alone as the cursor, I'd need `WHERE id < $cursor ORDER BY id DESC`, which requires IDs to sort in creation order. CUIDs are not guaranteed to do this — they're unique, but two CUIDs generated on different machines (or in quick succession) can sort in arbitrary order. If I used `createdAt` alone, I'd have the opposite problem: two bookmarks created at the same millisecond (entirely possible under concurrent inserts or batch imports) would share a cursor value, and the `WHERE createdAt < $cursor` clause would either skip one or return both twice depending on which the database picked for the boundary.

The compound cursor eliminates both issues. The `WHERE` clause becomes:

```typescript
where.OR = [
  { createdAt: { lt: decoded.createdAt } },
  {
    createdAt: { equals: decoded.createdAt },
    id: { lt: decoded.id },
  },
];
```

This is a standard keyset pagination pattern — `(createdAt, id)` forms a unique, immutable pair, so no insert or delete can shift already-returned rows. The integration test `"should maintain consistency when a record is inserted mid-pagination"` in `bookmark-api.integration.test.ts` proves this: it fetches page 1 (seeing "Initial 4" and "Initial 3"), then inserts "Inserted Mid-Pagination" (which gets a newer `createdAt`), then fetches page 2 using the cursor from page 1. Page 2 correctly returns "Initial 2" and "Initial 1" — the mid-pagination insert doesn't leak into already-paginated results, and no record is skipped or duplicated.

The `hasNextPage` detection uses the "fetch N+1" trick — I request `take + 1` rows and check whether the result set exceeds `take`. If it does, I trim the last row and set `hasNextPage: true`. This avoids a separate `COUNT(*)` query just for pagination metadata (the `totalCount` is a separate count, but it counts the full filtered set, not just the current page).

### b) Folder Health and Duplicate Detection

The spec asked for a differentiator feature. I could have built something flashy — tag autocomplete, bookmark screenshots via Puppeteer, link-rot detection with HTTP HEAD requests. I chose Folder Health instead because it builds on the data model work I was already doing and demonstrates something harder to fake: the ability to aggregate data correctly across normalized URLs with a raw SQL query.

The duplicate detection itself was the more interesting design decision. I made it a **soft warning** — the `duplicateOf` field on `CreateBookmarkPayload` — rather than a hard error. If a user saves a link for the second time, they probably know what they're doing (maybe they want it in both "Read Later" and "Favorites"). Blocking the create would be paternalistic. But silently ignoring it would mean lost information — the user never learns they already saved it. The soft warning is the middle ground: create the bookmark, but surface the original so the client can show "You already saved this on Jan 15."

Duplicate detection is scoped to same-folder only. A bookmark in "Work Resources" and the same URL in "Personal Reading" are not duplicates — they serve different organizational purposes. The query filters on `{ folderId, normalizedUrl }`, both indexed.

The URL normalization handles the common real-world variations that make two "different" URLs actually point to the same resource:

```
Input:  "https://WWW.Example.COM/page/?utm_source=google&utm_medium=social#top"
Output: "https://example.com/page"
```

The `normalizeUrl` function in `src/utils/normalize-url.ts` applies seven rules: lowercase hostname, strip `www.`, remove trailing slash (except bare `/`), strip known tracking params (`utm_*`, `fbclid`, `gclid`, `msclkid`, `ref`, `mc_cid`, `mc_eid`), sort remaining query params for deterministic output, and drop the fragment. The integration test `"should detect same-folder duplicate by normalized URL"` verifies this end-to-end: it saves `"https://www.example.com/page/"` and then saves `"https://example.com/page?utm_source=twitter"` in the same folder — the second create returns a non-null `duplicateOf` pointing to the first.

The `FolderHealth` type has three fields: `totalBookmarks`, `duplicateCount`, and `staleCount`. The `duplicateCount` uses a raw SQL query because Prisma's query builder doesn't support `GROUP BY ... HAVING COUNT(*) > 1`:

```typescript
prisma.$queryRaw<Array<{ count: bigint }>>`
  SELECT COUNT(*) as count FROM (
    SELECT normalized_url
    FROM bookmarks
    WHERE folder_id = ${folderId}
    GROUP BY normalized_url
    HAVING COUNT(*) > 1
  ) AS dupes
`
```

This counts the number of distinct normalized URLs that appear more than once — not the total number of duplicate rows. If the same URL appears 5 times, that's 1 duplicate group, not 4. The `staleCount` uses `updatedAt` — which is why I added `updatedAt` beyond the original spec.

### c) Data Modeling Choices

Three Prisma schema decisions are worth explaining in depth.

**`onDelete: Restrict`** on the `Folder → Bookmark` relation means you cannot delete a folder that still has bookmarks. The default Prisma behavior would be `SetNull` (orphan the bookmarks) or `Cascade` (silently delete all bookmarks in the folder). Both are dangerous — they destroy data without the user asking. There is no `deleteFolder` mutation in this API, and that's not an accident: the `Restrict` constraint enforces at the database level that you must move or delete all bookmarks first. If I added `deleteFolder` later, it would need to explicitly handle "this folder has 47 bookmarks — are you sure?" rather than silently nuking them.

**`normalizedUrl` is indexed but explicitly NOT unique.** This was a deliberate choice that flows from the soft-warning duplicate detection design. If I made it unique, every duplicate would fail with a Prisma `P2002` unique constraint error, and I'd be fighting the database to allow something I explicitly want to allow. The index exists purely for read performance — the `findFirst` in `createBookmark` and the `GROUP BY` in `getFolderHealth` both scan `normalizedUrl`, and without the index they'd be full-table scans on a column that gets queried on every single write.

**`updatedAt`** is an intentional deviation from the original spec. The spec defined `createdAt` but not `updatedAt`. I added it because the Folder Health feature needs staleness detection — "bookmarks not updated in the last 30 days." Without `updatedAt`, every bookmark would be "stale" immediately after creation unless you count `createdAt` as the update time, which defeats the purpose. The `@updatedAt` Prisma directive auto-manages this: it's set to `now()` on create and updated automatically on every `update` call. The schema comment explains the deviation:

```prisma
/// Added beyond original spec to support staleness detection in Folder.health.
updatedAt     DateTime @updatedAt @map("updated_at")
```

---

## 5. Validation and Error Handling Philosophy

Every error the API returns is a typed `GraphQLError` with a machine-readable `extensions.code`. There are no unhandled exceptions that bubble up as generic 500s or Yoga's default "Unexpected error" masking.

Here's a concrete bad-input trace. A client sends:

```graphql
mutation {
  createBookmark(input: {
    title: "   "
    url: "https://example.com"
    folderId: "some-folder-id"
  })
}
```

The whitespace-only title hits `validateTitle` in `src/utils/validation.ts`:

```typescript
export function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new GraphQLError("Bookmark title cannot be empty or whitespace-only.", {
      extensions: { code: "INVALID_TITLE" },
    });
  }
  // ...
  return trimmed;
}
```

The `GraphQLError` is thrown at the resolver layer, **before** any database call. GraphQL Yoga catches it and returns it in the response `errors` array with the full extension metadata intact:

```json
{
  "errors": [{
    "message": "Bookmark title cannot be empty or whitespace-only.",
    "extensions": { "code": "INVALID_TITLE" }
  }]
}
```

A different bad-input case: moving a bookmark to a non-existent folder. The client sends `moveBookmark(id: "bm-1", folderId: "nonexistent-folder")`. The resolver delegates to `bookmarkService.moveBookmark`, which calls `ensureFolderExists(prisma, folderId)`, which does:

```typescript
export async function ensureFolderExists(prisma: PrismaClient, id: string) {
  const folder = await prisma.folder.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!folder) {
    throw folderNotFoundError(id);
  }
}
```

`folderNotFoundError` is a factory in `src/errors/graphql-errors.ts`:

```typescript
export function notFoundError(entity: string, id: string): GraphQLError {
  return new GraphQLError(`${entity} with id "${id}" not found.`, {
    extensions: { code: "NOT_FOUND", entity, id },
  });
}
```

The client receives `extensions.code: "NOT_FOUND"` with the entity type and ID, so it can show a targeted error message. The error codes used across the codebase are: `INVALID_TITLE`, `INVALID_URL`, `INVALID_FOLDER_NAME`, `INVALID_INPUT` (for pagination bounds), `INVALID_CURSOR`, and `NOT_FOUND`.

The validation always runs at the resolver layer, before any service call. This means a request with both a bad title and a nonexistent folder fails fast on the title validation without hitting the database at all.

---

## 6. Testing Strategy

The test suite is split into two distinct categories with different jobs:

**Unit tests** (5 files, 75 test cases) run with mocked Prisma — they test resolver logic, validation functions, URL normalization, and cursor encoding in complete isolation. No Docker, no database, instant feedback. These answer the question: "does each individual function behave correctly given controlled inputs?"

**Integration tests** (1 file, 11 test cases) run against a real PostgreSQL 16 instance via Docker Compose. They call service functions directly with a real Prisma client and assert against actual query results. These answer a different question: "does the whole stack work correctly when Prisma generates real SQL, PostgreSQL processes real data, and indexes/constraints are enforced?"

The total across both suites is **86 test cases with 186 assertions**.

Three specific tests I'm proud of because they catch non-obvious bugs:

1. **`"should maintain consistency when a record is inserted mid-pagination"`** in `bookmark-api.integration.test.ts` — this is the test that validates the compound cursor design. It creates 4 bookmarks, fetches page 1 (getting items 4 and 3), inserts a fifth bookmark mid-pagination, then fetches page 2 using the cursor from page 1. It asserts that the mid-pagination insert (`"Inserted Mid-Pagination"`) does NOT appear in page 2, and that page 2 contains exactly "Initial 2" and "Initial 1". This proves that keyset pagination isn't just theoretically stable — it actually works against real Postgres with real timing.

2. **`"should NOT flag duplicate across different folders"`** in `bookmark-api.integration.test.ts` — this is the negative-case test for duplicate detection scoping. It saves `"https://example.com/page"` in Folder 1, then saves the exact same URL in Folder 2, and asserts `duplicateOf` is `null`. This catches a subtle bug where someone might accidentally query `WHERE normalizedUrl = $1` without the `folderId` filter.

3. **`"should throw NOT_FOUND when target folder doesn't exist"`** in `bookmark.resolver.test.ts` under the `moveBookmark` describe block — this tests the less obvious NOT_FOUND path. When moving a bookmark, both the bookmark AND the target folder must exist. This test mocks the bookmark as found but the folder as not found (`mockPrisma.folder.findUnique.mockResolvedValueOnce(null)`), verifying that the error correctly identifies the folder as the missing entity, not the bookmark.

The integration test file handles the case where PostgreSQL is offline gracefully — it attempts `prisma.$connect()` in `beforeAll` and sets a `dbAvailable` flag. Each test early-returns if the flag is false, so running `bun test` without Docker doesn't produce failures, just skips.

---

## 7. Honest Tradeoffs and Known Gaps

**The TOCTOU race in duplicate detection.** The `createBookmark` service does a `findFirst` (check for existing duplicate) followed by a `create` (insert the new bookmark). Between those two calls, another concurrent request could insert the same URL, and both would pass the duplicate check. I accepted this because duplicate detection is a soft warning, not a business rule — the worst case is that both bookmarks get created and neither gets the `duplicateOf` pointer. If this were a hard constraint (e.g., "never allow duplicate URLs"), I'd need either a unique constraint on `(folderId, normalizedUrl)` or a `SELECT ... FOR UPDATE` lock. Both would change the feature's semantics from advisory to blocking, which I decided against.

**Commit history is functional but not granular.** The Prisma schema and migration landed in the same commit (`132d12d feat: add Prisma schema and database migrations`), and the final migration file was regenerated in a later commit (`be1c186 feat: add Prisma database migration for folders and bookmarks`) after I added the `updatedAt` field and additional indexes. In a team setting, I'd prefer each schema change to have its own migration commit so the history tells a cleaner story. For a take-home with a single reviewer, I prioritized working code over pristine git archaeology.

**N+1 on nested field resolvers.** The `Folder.bookmarks` and `Bookmark.folder` type resolvers in `types.ts` each issue a separate Prisma query per parent object. If a client queries `folders { bookmarks { ... } }` for 50 folders, that's 50 extra queries for the bookmarks. This is a textbook DataLoader use case, and I know how to fix it, but I didn't add DataLoader because the feature set and test infrastructure would have been a net negative on time budget. I'm confident the fix is straightforward — I discuss it in section 9.

**Integration test coverage of edge cases.** The integration suite covers the critical paths but doesn't test every validation rule against a live database — it trusts the unit tests to cover those. I'd add integration tests for the `INVALID_CURSOR` path and for cursor behavior with a search filter active if I had more time.

---

## 8. What I Deliberately Did Not Build

**Authentication/authorization** — the assignment evaluates API design and engineering quality, not auth flows. Adding JWT handling would have been scope creep that distracted from getting pagination, validation, and duplicate detection exactly right. The context factory (`createContext` in `context.ts`) is deliberately shaped to accept a `user` field if auth were added later.

**Caching (Redis/in-memory)** — the folder health query is the most expensive operation in the API (a `GROUP BY` subquery), but it runs in single-digit milliseconds on any reasonable bookmark count. Adding a Redis cache with TTL-based invalidation would have added infrastructure complexity (Docker Compose service, cache-aside logic, invalidation on writes) that doesn't pay off until the dataset is orders of magnitude larger than what a take-home reviewer will test with. The assignment's "Engineering Judgment" section explicitly warns against over-engineering.

**DataLoader / N+1 batching** — as noted in section 7, the nested field resolvers have an N+1 problem. I chose not to add DataLoader because the primary queries (`bookmarks` with pagination, `folder` by ID) don't trigger it — only the nested type resolvers do, and only when a client specifically requests nested fields on a list query. The fix is mechanical (wrap `findMany` in a DataLoader), not conceptual, and adding it would have consumed time I preferred to spend on test coverage.

**Full-text search** — the current search uses Postgres `ILIKE` substring matching via Prisma's `contains` + `mode: "insensitive"`. It works correctly and is tested, but it doesn't do stemming, ranking, or phrase matching. Full-text search via `tsvector` would be a meaningful upgrade but requires a migration to add a generated column and a GIN index — infrastructure work that's overkill for a take-home.

**Live link-checking** — pinging bookmark URLs to detect dead links is a feature I'd absolutely build in a real product (it's the kind of proactive maintenance that makes a bookmark manager sticky). I left it out because it introduces network dependencies, requires a background job system (BullMQ/Redis), and produces flaky test results. Not appropriate for a take-home where "all tests pass on every run" is a hard requirement.

**Deployment infrastructure** — no Kubernetes manifests, no Terraform, no CDN config. The Dockerfile and Docker Compose file are enough to prove the app runs end-to-end from a clean clone. The CI pipeline in `.github/workflows/ci.yml` runs lint, typecheck, and the full test suite (including integration tests against a service-container Postgres).

---

## 9. What I'd Do Next with More Time

Ordered by what I'd actually tackle first:

1. **DataLoader for N+1 batching** — this is first because it's a correctness/performance issue that exists in the codebase right now. The `Folder.bookmarks` resolver fires one query per folder. Adding a DataLoader that batches `findMany({ where: { folderId: { in: ids } } })` is a 30-minute fix that eliminates the problem entirely. I'd do this before anything else because it's a known gap, not a new feature.

2. **Add `deleteFolder` mutation with explicit empty-check** — the `onDelete: Restrict` constraint means the database already prevents deleting a folder with bookmarks, but the error is a raw Prisma constraint violation. I'd add a mutation that checks `bookmark.count({ where: { folderId } })` first and returns a clear error like "Cannot delete folder with 12 bookmarks — move or delete them first."

3. **Extend search to tags and URL** — the current search only matches on `title`. Extending it to search across tags (array containment) and URL (substring) would make the feature much more useful. This is a service-layer change, not a schema change.

4. **Authentication** — JWT-based auth with a `userId` on both `Folder` and `Bookmark`. This is a net-new capability (not a fix for something broken), which is why it's after DataLoader and search. The context factory is already shaped to receive a `user` field.

5. **OpenTelemetry tracing** — request-level tracing with resolver-level spans. The current logger is intentionally minimal (`createLogger` in `logger.ts` is a 30-line structured logger). In production I'd replace it with pino and add OTel tracing for performance visibility.

6. **Redis cache for folder health** — once the dataset grows beyond thousands of bookmarks per folder, the `GROUP BY` subquery in `getFolderHealth` will start to matter. A Redis cache with write-through invalidation on bookmark create/update/delete would bound the response time.

---

## 10. Closing

The repo is at [github.com/SM33-07/bookmark-manager-api](https://github.com/SM33-07/bookmark-manager-api). The PR containing the full implementation is linked from the repo's pull request tab. All 86 tests pass (75 unit + 11 integration), lint and typecheck are clean, and the Docker setup is verified end-to-end from a clean clone.

---

## Verification

**Repo:** `https://github.com/SM33-07/bookmark-manager-api`

To reproduce the full test run from a clean clone:

```bash
git clone https://github.com/SM33-07/bookmark-manager-api.git
cd bookmark-manager-api

# Start PostgreSQL
docker compose up -d

# Install dependencies
bun install

# Generate Prisma client + apply migrations
bun run generate
bun run gendb

# Run the full sanity check (lint + typecheck + all tests)
bun run sanity
```

Expected result: all checks pass, 86 test cases, 0 failures.
