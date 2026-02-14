/**
 * pg-migrate-runner — Typed Error Classes
 *
 * Provides specific error types so consumers can catch and handle
 * different failure modes (lock contention, checksum mismatch, parse errors, etc.).
 */

// ─── Base Error ──────────────────────────────────────────────────────────────

/**
 * Base error class for all migration-related errors.
 */
export class MigrationError extends Error {
    /** The migration version (YYYYMMDDHHMMSS) that caused the error, if applicable. */
    public readonly migration?: string;

    /** The migration name, if applicable. */
    public readonly migrationName?: string;

    constructor(message: string, migration?: string, migrationName?: string) {
        super(message);
        this.name = 'MigrationError';
        this.migration = migration;
        this.migrationName = migrationName;

        // Fix prototype chain for instanceof checks (TypeScript compilation target <ES2015)
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── Specific Errors ─────────────────────────────────────────────────────────

/**
 * Thrown when a migration file's checksum doesn't match the recorded checksum.
 * Indicates the migration file was modified after being applied.
 */
export class ChecksumMismatchError extends MigrationError {
    /** The checksum stored in the database. */
    public readonly expected: string;

    /** The checksum computed from the current file. */
    public readonly actual: string;

    constructor(migration: string, migrationName: string, expected: string, actual: string) {
        super(
            `Checksum mismatch for migration ${migration}_${migrationName}. ` +
                `Expected: ${expected}, Actual: ${actual}. ` +
                `The migration file was modified after it was applied.`,
            migration,
            migrationName
        );
        this.name = 'ChecksumMismatchError';
        this.expected = expected;
        this.actual = actual;

        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown when the advisory lock cannot be acquired (another migration is in progress).
 */
export class MigrationLockError extends MigrationError {
    /** The lock ID that was attempted. */
    public readonly lockId: number;

    constructor(lockId: number) {
        super(
            `Could not acquire migration lock (lock ID: ${lockId}). ` +
                `Another migration may be in progress. ` +
                `If no other migration is running, the lock may need manual release.`
        );
        this.name = 'MigrationLockError';
        this.lockId = lockId;

        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown when a migration file cannot be parsed (missing markers, invalid format).
 */
export class MigrationParseError extends MigrationError {
    /** The filename that failed to parse. */
    public readonly filename: string;

    constructor(filename: string, reason: string) {
        super(`Failed to parse migration file '${filename}': ${reason}`);
        this.name = 'MigrationParseError';
        this.filename = filename;

        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown when a rollback is attempted but the migration has no DOWN section.
 */
export class MigrationRollbackError extends MigrationError {
    constructor(migration: string, migrationName: string, reason: string) {
        super(
            `Cannot rollback migration ${migration}_${migrationName}: ${reason}`,
            migration,
            migrationName
        );
        this.name = 'MigrationRollbackError';

        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown when a migration file is not found on disk but exists in the database.
 */
export class MigrationFileNotFoundError extends MigrationError {
    constructor(migration: string, migrationName: string) {
        super(
            `Migration file not found for version ${migration} (${migrationName}). ` +
                `Cannot rollback without the migration file.`,
            migration,
            migrationName
        );
        this.name = 'MigrationFileNotFoundError';

        Object.setPrototypeOf(this, new.target.prototype);
    }
}
