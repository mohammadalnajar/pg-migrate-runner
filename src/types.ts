/**
 * pg-migrate-runner — Type Definitions
 *
 * All interfaces and configuration types used across the migration runner.
 */

import { Pool } from 'pg';

// ─── Logger ──────────────────────────────────────────────────────────────────

/**
 * Logger interface for the migration runner.
 * Consumers can provide any logger that implements these methods.
 */
export interface MigrationLogger {
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
}

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Configuration for the MigrationRunner.
 * All fields are optional — sensible defaults are applied.
 */
export interface MigrationConfig {
    /** An existing pg Pool instance. If provided, connectionString / connection fields are ignored. */
    pool?: Pool;

    /** PostgreSQL connection string (e.g. postgres://user:pass@host:5432/db). */
    connectionString?: string;

    /** Individual connection fields (used when connectionString is not set). */
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;

    /** Enable SSL for the connection (default: false). */
    ssl?: boolean | { rejectUnauthorized: boolean };

    /** Directory containing migration SQL files (default: <cwd>/migrations). */
    migrationsDir?: string;

    /** Name of the tracking table (default: 'schema_migrations'). */
    tableName?: string;

    /** PostgreSQL advisory lock ID to prevent concurrent migrations (default: 741953). */
    lockId?: number;

    /** Whether to use advisory locking during migrate/rollback (default: true). */
    useLock?: boolean;

    /** Logger instance (default: console-based logger). Use `false` to disable logging. */
    logger?: MigrationLogger | false;
}

// ─── Migration Options ───────────────────────────────────────────────────────

/**
 * Options for the migrate() method.
 */
export interface MigrateOptions {
    /** If true, preview which migrations would run without executing them (default: false). */
    dryRun?: boolean;
}

/**
 * Options for the rollback() method.
 */
export interface RollbackOptions {
    /** If true, preview which migrations would be rolled back without executing them (default: false). */
    dryRun?: boolean;
}

// ─── Data Types ──────────────────────────────────────────────────────────────

/**
 * A migration record as stored in the tracking table.
 */
export interface MigrationRecord {
    id: number;
    version: string;
    name: string;
    applied_at: string;
    execution_time_ms: number;
    checksum: string;
}

/**
 * A migration file parsed from disk.
 */
export interface MigrationFile {
    version: string;
    name: string;
    filename: string;
    upSql: string;
    downSql: string;
    checksum: string;
}

/**
 * Combined status of a migration (file + database record).
 */
export interface MigrationStatus {
    version: string;
    name: string;
    filename: string;
    status: 'applied' | 'pending';
    applied_at?: string;
    execution_time_ms?: number;
    checksum?: string;
    checksumMismatch?: boolean;
}

/**
 * Result of applying or rolling back a single migration.
 */
export interface MigrationResult {
    success: boolean;
    version: string;
    name: string;
    execution_time_ms: number;
    error?: string;
}

/**
 * Summary of a migrate() operation.
 */
export interface MigrationRunSummary {
    applied: MigrationResult[];
    failed: MigrationResult | null;
    total_pending: number;
    total_applied: number;
    dryRun: boolean;
}

/**
 * Summary of a rollback() operation.
 */
export interface MigrationRollbackSummary {
    rolledBack: MigrationResult[];
    failed: MigrationResult | null;
    total_rolled_back: number;
    dryRun: boolean;
}

/**
 * Summary counts for quick status checks.
 */
export interface MigrationSummary {
    applied: number;
    pending: number;
    total: number;
}

/**
 * A warning or error from SQL validation.
 */
export interface ValidationWarning {
    level: 'error' | 'warning';
    message: string;
    line?: number;
}
