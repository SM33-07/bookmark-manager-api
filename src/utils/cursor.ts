/**
 * Cursor encoding/decoding for compound cursor-based pagination.
 *
 * Cursor format: Base64 of "{createdAt_ISO}_{id}"
 *
 * This compound cursor ensures stable pagination under ORDER BY createdAt DESC, id DESC:
 * - createdAt is immutable (set once on insert)
 * - id is unique (cuid)
 * - Together they form a deterministic, insertion-order-stable sort key
 *
 * An insert of a new record mid-pagination does NOT corrupt already-fetched pages
 * because the cursor remembers the exact (createdAt, id) boundary.
 */

import { GraphQLError } from "graphql";

interface DecodedCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  const payload = `${createdAt.toISOString()}_${id}`;
  return Buffer.from(payload, "utf-8").toString("base64url");
}

export function decodeCursor(cursor: string): DecodedCursor {
  let payload: string;
  try {
    payload = Buffer.from(cursor, "base64url").toString("utf-8");
  } catch {
    throw new GraphQLError("Invalid cursor format.", {
      extensions: { code: "INVALID_CURSOR" },
    });
  }

  const separatorIndex = payload.indexOf("_");
  if (separatorIndex === -1) {
    throw new GraphQLError("Invalid cursor format.", {
      extensions: { code: "INVALID_CURSOR" },
    });
  }

  const dateStr = payload.slice(0, separatorIndex);
  const id = payload.slice(separatorIndex + 1);

  const createdAt = new Date(dateStr);
  if (isNaN(createdAt.getTime())) {
    throw new GraphQLError("Invalid cursor: malformed date.", {
      extensions: { code: "INVALID_CURSOR" },
    });
  }

  if (!id || id.length === 0) {
    throw new GraphQLError("Invalid cursor: missing id.", {
      extensions: { code: "INVALID_CURSOR" },
    });
  }

  return { createdAt, id };
}
