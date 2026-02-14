/**
 * pg-migrate-runner — Pure Helper Functions
 *
 * Stateless utility functions for checksums, parsing, naming, and versioning.
 * No database or filesystem side effects — safe to use anywhere.
 */

import crypto from 'crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default name for the migrations tracking table. */
export const DEFAULT_TABLE_NAME = 'schema_migrations';

/** Default advisory lock ID for preventing concurrent migrations. */
export const DEFAULT_LOCK_ID = 741953;

/** Regex to validate migration filenames: YYYYMMDDHHMMSS_snake_case_name.sql */
export const MIGRATION_FILENAME_REGEX = /^(\d{14})_([a-z0-9_]+)\.sql$/;

/** Marker that starts the UP (apply) section of a migration file. */
export const UP_MARKER = '-- migrate:up';

/** Marker that starts the DOWN (rollback) section of a migration file. */
export const DOWN_MARKER = '-- migrate:down';

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 checksum of migration content (up section only).
 * This detects if a migration file was modified after being applied.
 *
 * @param sql - The SQL content to checksum (typically the UP section).
 * @returns A 16-character hex string.
 */
export function computeChecksum(sql: string): string {
    return crypto.createHash('sha256').update(sql.trim()).digest('hex').substring(0, 16);
}

/**
 * Parse a migration file into its UP and DOWN SQL sections.
 * Returns null if the file format is invalid (missing `-- migrate:up` marker).
 *
 * @param content - The full content of the migration file.
 * @returns An object with `upSql` and `downSql` strings, or null if invalid.
 */
export function parseMigrationFile(content: string): { upSql: string; downSql: string } | null {
    const upIndex = content.indexOf(UP_MARKER);
    const downIndex = content.indexOf(DOWN_MARKER);

    if (upIndex === -1) {
        return null;
    }

    const upStart = upIndex + UP_MARKER.length;

    let upSql: string;
    let downSql: string;

    if (downIndex === -1) {
        // No down section — up is everything after the marker
        upSql = content.substring(upStart).trim();
        downSql = '';
    } else if (downIndex > upIndex) {
        // Normal order: up first, then down
        upSql = content.substring(upStart, downIndex).trim();
        downSql = content.substring(downIndex + DOWN_MARKER.length).trim();
    } else {
        // Down before up (unusual but handle it)
        downSql = content.substring(downIndex + DOWN_MARKER.length, upIndex).trim();
        upSql = content.substring(upStart).trim();
    }

    return { upSql, downSql };
}

/**
 * Validate and extract version + name from a migration filename.
 * Returns null if the filename doesn't match the expected pattern.
 *
 * @param filename - The filename to parse (e.g. "20240101120000_create_users.sql").
 * @returns An object with `version` and `name`, or null if invalid.
 */
export function parseFilename(filename: string): { version: string; name: string } | null {
    const match = filename.match(MIGRATION_FILENAME_REGEX);
    if (!match) return null;
    return { version: match[1], name: match[2] };
}

/**
 * Generate a timestamp-based version string (YYYYMMDDHHMMSS).
 *
 * @returns A 14-digit string representing the current timestamp.
 */
export function generateVersion(): string {
    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    return (
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
}

/**
 * Sanitize a migration name to snake_case (lowercase, alphanumeric + underscores only).
 *
 * @param name - The raw migration name from user input.
 * @returns A sanitized snake_case string (max 100 chars).
 */
export function sanitizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 100);
}
