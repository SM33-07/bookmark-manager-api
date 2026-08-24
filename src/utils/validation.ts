/**
 * Input validation utilities.
 *
 * Each validator throws a GraphQLError with a typed error code on failure.
 * Validators are called at the resolver layer before any database interaction.
 */

import { GraphQLError } from "graphql";

// ─── Title Validation ───────────────────────────────────────────────

const MAX_TITLE_LENGTH = 500;

export function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new GraphQLError("Bookmark title cannot be empty or whitespace-only.", {
      extensions: { code: "INVALID_TITLE" },
    });
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new GraphQLError(
      `Bookmark title cannot exceed ${MAX_TITLE_LENGTH} characters.`,
      { extensions: { code: "INVALID_TITLE" } },
    );
  }
  return trimmed;
}

// ─── URL Validation ─────────────────────────────────────────────────

export function validateUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new GraphQLError("Bookmark URL cannot be empty.", {
      extensions: { code: "INVALID_URL" },
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new GraphQLError(`Invalid URL: "${trimmed}" is not a valid URL.`, {
      extensions: { code: "INVALID_URL" },
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new GraphQLError(
      `Invalid URL protocol: "${parsed.protocol}" — only http and https are allowed.`,
      { extensions: { code: "INVALID_URL" } },
    );
  }

  return trimmed;
}

// ─── Folder Name Validation ─────────────────────────────────────────

const MAX_FOLDER_NAME_LENGTH = 200;

export function validateFolderName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new GraphQLError("Folder name cannot be empty or whitespace-only.", {
      extensions: { code: "INVALID_FOLDER_NAME" },
    });
  }
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new GraphQLError(
      `Folder name cannot exceed ${MAX_FOLDER_NAME_LENGTH} characters.`,
      { extensions: { code: "INVALID_FOLDER_NAME" } },
    );
  }
  return trimmed;
}

// ─── Pagination Validation ──────────────────────────────────────────

const MAX_TAKE = 100;
const DEFAULT_TAKE = 20;

export function validateTake(take: number | null | undefined): number {
  if (take === null || take === undefined) {
    return DEFAULT_TAKE;
  }
  if (!Number.isInteger(take) || take < 1) {
    throw new GraphQLError("'take' must be a positive integer.", {
      extensions: { code: "INVALID_INPUT" },
    });
  }
  if (take > MAX_TAKE) {
    throw new GraphQLError(`'take' cannot exceed ${MAX_TAKE}.`, {
      extensions: { code: "INVALID_INPUT" },
    });
  }
  return take;
}
