/**
 * pg-migrate-runner
 *
 * A lightweight, zero-dependency PostgreSQL migration runner.
 * Uses `pg` as the only peer dependency.
 *
 * Features:
 * - UP/DOWN migration files with transaction safety
 * - SHA-256 checksum verification
 * - Advisory locking for concurrent safety
 * - Dry-run mode
 * - Pluggable logger
 * - SQL anti-pattern validation
 * - Config-driven or legacy Pool constructor
 * - CLI binary (`pg-migrate`)
 *
 * Migration File Format:
 * ```sql
 * -- migrate:up
 * CREATE TABLE IF NOT EXISTS example (...);
 *
 * -- migrate:down
 * DROP TABLE IF EXISTS example;
 * ```
 *
 * Quick Start:
 * ```ts
 * import { createMigrationRunner } from '@afa/pg-migrate-runner';
 *
 * const { runner, pool } = createMigrationRunner({ useLock: true });
 * await runner.migrate();
 * await pool.end();
 * ```
 */

// --- Types ---
export type {
    MigrationConfig,
    MigrationLogger,
    MigrateOptions,
    RollbackOptions,
    MigrationRecord,
    MigrationFile,
    MigrationStatus,
    MigrationResult,
    MigrationRunSummary,
    MigrationRollbackSummary,
    MigrationSummary,
    ValidationWarning
} from './types';

// --- Errors ---
export {
    MigrationError,
    ChecksumMismatchError,
    MigrationLockError,
    MigrationParseError,
    MigrationRollbackError,
    MigrationFileNotFoundError
} from './errors';

// --- Logger ---
export { DefaultLogger, SilentLogger, createLogger } from './logger';

// --- Helpers ---
export {
    DEFAULT_TABLE_NAME,
    DEFAULT_LOCK_ID,
    MIGRATION_FILENAME_REGEX,
    UP_MARKER,
    DOWN_MARKER,
    computeChecksum,
    parseMigrationFile,
    parseFilename,
    generateVersion,
    sanitizeName
} from './helpers';

// --- Validator ---
export { validateMigrationSQL } from './validator';

// --- Lock ---
export { acquireLock, releaseLock } from './lock';

// --- Runner ---
export { MigrationRunner } from './runner';

// --- Factory ---
export { createMigrationRunner } from './factory';
