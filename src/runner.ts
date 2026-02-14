/**
 * pg-migrate-runner — Core Runner Class
 *
 * Config-driven migration runner with advisory locking, dry-run support,
 * and pluggable logging. Designed for reusability across projects.
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

import {
    MigrationConfig,
    MigrationFile,
    MigrationRecord,
    MigrationStatus,
    MigrationResult,
    MigrationRunSummary,
    MigrationRollbackSummary,
    MigrationSummary,
    MigrationLogger,
    MigrateOptions,
    RollbackOptions
} from './types';
import {
    DEFAULT_TABLE_NAME,
    DEFAULT_LOCK_ID,
    UP_MARKER,
    DOWN_MARKER,
    computeChecksum,
    parseMigrationFile,
    parseFilename,
    generateVersion,
    sanitizeName
} from './helpers';
import { MigrationError, MigrationRollbackError, MigrationFileNotFoundError } from './errors';
import { acquireLock, releaseLock } from './lock';
import { createLogger } from './logger';

// ─── Migration Runner ───────────────────────────────────────────────────────

export class MigrationRunner {
    private pool: Pool;
    private migrationsDir: string;
    private tableName: string;
    private lockId: number;
    private useLock: boolean;
    private logger: MigrationLogger;

    /**
     * Create a new MigrationRunner.
     *
     * Supports two constructor signatures for backward compatibility:
     * - `new MigrationRunner(config)` — config-driven (recommended)
     * - `new MigrationRunner(pool, migrationsDir?)` — legacy signature
     *
     * @param configOrPool - A MigrationConfig object, or a pg Pool instance (legacy).
     * @param migrationsDir - (Legacy only) Path to migration files directory.
     */
    constructor(configOrPool: MigrationConfig | Pool, migrationsDir?: string) {
        // Duck-type check: if it has `connect` and `query` methods, treat it as a Pool.
        // This avoids instanceof issues with mocks and different pg versions.
        const isPool =
            configOrPool instanceof Pool ||
            (typeof (configOrPool as any).connect === 'function' &&
                typeof (configOrPool as any).query === 'function');

        if (isPool) {
            // Legacy constructor: MigrationRunner(pool, migrationsDir?)
            this.pool = configOrPool as Pool;
            this.migrationsDir = migrationsDir || path.join(process.cwd(), 'models', 'migrations');
            this.tableName = DEFAULT_TABLE_NAME;
            this.lockId = DEFAULT_LOCK_ID;
            this.useLock = false; // Legacy mode: no advisory locking (backward compat)
            this.logger = createLogger();
        } else {
            // Config-driven constructor
            const config = configOrPool as MigrationConfig;

            if (config.pool) {
                this.pool = config.pool;
            } else {
                throw new MigrationError(
                    'MigrationRunner requires a pool. Provide either config.pool or use createMigrationRunner().'
                );
            }

            this.migrationsDir =
                config.migrationsDir || path.join(process.cwd(), 'models', 'migrations');
            this.tableName = config.tableName || DEFAULT_TABLE_NAME;
            this.lockId = config.lockId ?? DEFAULT_LOCK_ID;
            this.useLock = config.useLock ?? true; // Config mode: locking enabled by default
            this.logger = createLogger(config.logger);
        }
    }

    // ─── Table Management ────────────────────────────────────────────────

    /**
     * Ensure the migrations tracking table exists.
     */
    async ensureMigrationsTable(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                id SERIAL PRIMARY KEY,
                version VARCHAR(14) NOT NULL UNIQUE,
                name VARCHAR(255) NOT NULL,
                applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                execution_time_ms INTEGER NOT NULL DEFAULT 0,
                checksum VARCHAR(16) NOT NULL
            );
        `);
    }

    // ─── File Reading ────────────────────────────────────────────────────

    /**
     * Read all migration files from the migrations directory.
     * Returns them sorted by version (timestamp) ascending.
     */
    readMigrationFiles(): MigrationFile[] {
        if (!fs.existsSync(this.migrationsDir)) {
            return [];
        }

        const files = fs.readdirSync(this.migrationsDir).filter((f) => f.endsWith('.sql'));
        const migrations: MigrationFile[] = [];

        for (const filename of files) {
            const parsed = parseFilename(filename);
            if (!parsed) continue; // Skip files that don't match the naming pattern

            const filePath = path.join(this.migrationsDir, filename);
            const content = fs.readFileSync(filePath, 'utf-8');
            const sections = parseMigrationFile(content);

            if (!sections) {
                this.logger.warn(`Skipping ${filename}: missing '${UP_MARKER}' marker`);
                continue;
            }

            if (!sections.upSql) {
                this.logger.warn(`Skipping ${filename}: empty UP section`);
                continue;
            }

            migrations.push({
                version: parsed.version,
                name: parsed.name,
                filename,
                upSql: sections.upSql,
                downSql: sections.downSql,
                checksum: computeChecksum(sections.upSql)
            });
        }

        // Sort by version ascending
        return migrations.sort((a, b) => a.version.localeCompare(b.version));
    }

    // ─── Database Queries ────────────────────────────────────────────────

    /**
     * Get all applied migrations from the database.
     */
    async getAppliedMigrations(): Promise<MigrationRecord[]> {
        await this.ensureMigrationsTable();
        const result = await this.pool.query(
            `SELECT id, version, name, applied_at, execution_time_ms, checksum
             FROM ${this.tableName}
             ORDER BY version ASC`
        );
        return result.rows;
    }

    /**
     * Get status of all migrations (applied + pending).
     */
    async getStatus(): Promise<MigrationStatus[]> {
        const files = this.readMigrationFiles();
        const applied = await this.getAppliedMigrations();
        const appliedMap = new Map(applied.map((m) => [m.version, m]));

        return files.map((file) => {
            const record = appliedMap.get(file.version);
            if (record) {
                return {
                    version: file.version,
                    name: file.name,
                    filename: file.filename,
                    status: 'applied' as const,
                    applied_at: record.applied_at,
                    execution_time_ms: record.execution_time_ms,
                    checksum: record.checksum,
                    checksumMismatch: record.checksum !== file.checksum
                };
            }
            return {
                version: file.version,
                name: file.name,
                filename: file.filename,
                status: 'pending' as const
            };
        });
    }

    /**
     * Get only pending migrations (not yet applied).
     */
    async getPendingMigrations(): Promise<MigrationFile[]> {
        const files = this.readMigrationFiles();
        const applied = await this.getAppliedMigrations();
        const appliedVersions = new Set(applied.map((m) => m.version));

        return files.filter((f) => !appliedVersions.has(f.version));
    }

    // ─── Migrate ─────────────────────────────────────────────────────────

    /**
     * Apply all pending migrations in order.
     * Each migration runs in its own transaction for atomicity.
     * When advisory locking is enabled, a lock is held during the entire operation.
     *
     * @param options - Optional settings (e.g. `{ dryRun: true }`).
     */
    async migrate(options?: MigrateOptions): Promise<MigrationRunSummary> {
        const dryRun = options?.dryRun ?? false;

        await this.ensureMigrationsTable();
        const pending = await this.getPendingMigrations();

        const summary: MigrationRunSummary = {
            applied: [],
            failed: null,
            total_pending: pending.length,
            total_applied: 0,
            dryRun
        };

        if (pending.length === 0) {
            return summary;
        }

        // Optionally acquire advisory lock
        let lockClient: any = null;
        if (this.useLock) {
            lockClient = await this.pool.connect();
            await acquireLock(lockClient, this.lockId, this.logger);
        }

        try {
            for (const migration of pending) {
                if (dryRun) {
                    // In dry-run mode, just report what would happen
                    summary.applied.push({
                        success: true,
                        version: migration.version,
                        name: migration.name,
                        execution_time_ms: 0
                    });
                    summary.total_applied++;
                    this.logger.info(
                        `[dry-run] Would apply: ${migration.version}_${migration.name}`
                    );
                    continue;
                }

                const client = await this.pool.connect();
                const startTime = Date.now();

                try {
                    await client.query('BEGIN');

                    // Execute the UP SQL
                    await client.query(migration.upSql);

                    // Record the migration
                    await client.query(
                        `INSERT INTO ${this.tableName} (version, name, execution_time_ms, checksum)
                         VALUES ($1, $2, $3, $4)`,
                        [
                            migration.version,
                            migration.name,
                            Date.now() - startTime,
                            migration.checksum
                        ]
                    );

                    await client.query('COMMIT');

                    const result: MigrationResult = {
                        success: true,
                        version: migration.version,
                        name: migration.name,
                        execution_time_ms: Date.now() - startTime
                    };
                    summary.applied.push(result);
                    summary.total_applied++;
                } catch (error: any) {
                    await client.query('ROLLBACK');

                    summary.failed = {
                        success: false,
                        version: migration.version,
                        name: migration.name,
                        execution_time_ms: Date.now() - startTime,
                        error: error.message
                    };

                    // Stop on first failure — don't apply subsequent migrations
                    break;
                } finally {
                    client.release();
                }
            }
        } finally {
            // Release the lock if acquired
            if (lockClient) {
                await releaseLock(lockClient, this.lockId, this.logger);
                lockClient.release();
            }
        }

        return summary;
    }

    // ─── Rollback ────────────────────────────────────────────────────────

    /**
     * Rollback the last N applied migrations (default: 1).
     * Each rollback runs in its own transaction.
     * An advisory lock is held during the entire operation.
     *
     * @param count - Number of migrations to roll back (default: 1).
     * @param options - Optional settings (e.g. `{ dryRun: true }`).
     */
    async rollback(
        count: number = 1,
        options?: RollbackOptions
    ): Promise<MigrationRollbackSummary> {
        const dryRun = options?.dryRun ?? false;

        await this.ensureMigrationsTable();

        const applied = await this.getAppliedMigrations();
        const files = this.readMigrationFiles();
        const fileMap = new Map(files.map((f) => [f.version, f]));

        // Get the last N applied migrations (most recent first)
        const toRollback = applied.slice(-count).reverse();

        const summary: MigrationRollbackSummary = {
            rolledBack: [],
            failed: null,
            total_rolled_back: 0,
            dryRun
        };

        // Optionally acquire advisory lock
        let lockClient: any = null;
        if (this.useLock) {
            lockClient = await this.pool.connect();
            await acquireLock(lockClient, this.lockId, this.logger);
        }

        try {
            for (const record of toRollback) {
                const file = fileMap.get(record.version);

                if (dryRun) {
                    // Validate that rollback is possible, but don't execute
                    if (!file) {
                        summary.failed = {
                            success: false,
                            version: record.version,
                            name: record.name,
                            execution_time_ms: 0,
                            error: `Migration file not found for version ${record.version} (${record.name}).`
                        };
                        break;
                    }
                    if (!file.downSql) {
                        summary.failed = {
                            success: false,
                            version: record.version,
                            name: record.name,
                            execution_time_ms: 0,
                            error: `No DOWN section — rollback not possible.`
                        };
                        break;
                    }

                    summary.rolledBack.push({
                        success: true,
                        version: record.version,
                        name: record.name,
                        execution_time_ms: 0
                    });
                    summary.total_rolled_back++;
                    this.logger.info(`[dry-run] Would rollback: ${record.version}_${record.name}`);
                    continue;
                }

                const client = await this.pool.connect();
                const startTime = Date.now();

                try {
                    if (!file) {
                        throw new MigrationFileNotFoundError(record.version, record.name);
                    }

                    if (!file.downSql) {
                        throw new MigrationRollbackError(
                            record.version,
                            record.name,
                            `No '${DOWN_MARKER}' section. Cannot rollback without down SQL.`
                        );
                    }

                    await client.query('BEGIN');

                    // Execute the DOWN SQL
                    await client.query(file.downSql);

                    // Remove the migration record
                    await client.query(`DELETE FROM ${this.tableName} WHERE version = $1`, [
                        record.version
                    ]);

                    await client.query('COMMIT');

                    summary.rolledBack.push({
                        success: true,
                        version: record.version,
                        name: record.name,
                        execution_time_ms: Date.now() - startTime
                    });
                    summary.total_rolled_back++;
                } catch (error: any) {
                    await client.query('ROLLBACK');

                    summary.failed = {
                        success: false,
                        version: record.version,
                        name: record.name,
                        execution_time_ms: Date.now() - startTime,
                        error: error.message
                    };

                    // Stop on first failure
                    break;
                } finally {
                    client.release();
                }
            }
        } finally {
            // Release the lock if acquired
            if (lockClient) {
                await releaseLock(lockClient, this.lockId, this.logger);
                lockClient.release();
            }
        }

        return summary;
    }

    // ─── Create Migration File ───────────────────────────────────────────

    /**
     * Create a new migration file with the given name.
     * Returns the path to the created file.
     *
     * @param name - Human-readable migration name (will be sanitized to snake_case).
     */
    createMigrationFile(name: string): { filepath: string; filename: string; version: string } {
        const sanitized = sanitizeName(name);
        if (!sanitized) {
            throw new MigrationError(
                'Migration name must contain at least one alphanumeric character.'
            );
        }

        const version = generateVersion();
        const filename = `${version}_${sanitized}.sql`;
        const filepath = path.join(this.migrationsDir, filename);

        // Ensure the migrations directory exists
        if (!fs.existsSync(this.migrationsDir)) {
            fs.mkdirSync(this.migrationsDir, { recursive: true });
        }

        const template = `-- Migration: ${sanitized.replace(/_/g, ' ')}
-- Version: ${version}
-- Created: ${new Date().toISOString()}
--
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION RULES — Read before writing SQL                     ║
-- ╠══════════════════════════════════════════════════════════════════╣
-- ║  1. Use IF NOT EXISTS for CREATE TABLE / CREATE INDEX           ║
-- ║  2. Use IF EXISTS for DROP TABLE / DROP INDEX                   ║
-- ║  3. Do NOT use BEGIN / COMMIT / ROLLBACK                       ║
-- ║     → The runner wraps each migration in a transaction          ║
-- ║  4. One logical change per migration file                      ║
-- ║  5. Always write a DOWN section for rollback support            ║
-- ║  6. DOWN must reverse UP exactly (idempotent when possible)     ║
-- ║  7. Avoid destructive ops (DROP COLUMN, TRUNCATE) unless       ║
-- ║     absolutely necessary — document the reason                  ║
-- ║  8. ALTER TYPE ... ADD VALUE cannot run in a transaction        ║
-- ║     → Use a workaround if adding enum values                    ║
-- ║  9. Test migrations on a copy of production data first          ║
-- ║  10. Never modify a migration that has already been applied     ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- migrate:up
-- TODO: Write your UP migration SQL here
-- Example:
--   CREATE TABLE IF NOT EXISTS my_table (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL,
--     created_at TIMESTAMPTZ DEFAULT NOW()
--   );


-- migrate:down
-- TODO: Write your DOWN (rollback) SQL here
-- Example:
--   DROP TABLE IF EXISTS my_table;

`;

        fs.writeFileSync(filepath, template, 'utf-8');

        return { filepath, filename, version };
    }

    // ─── Convenience Methods ─────────────────────────────────────────────

    /**
     * Check if there are any pending migrations.
     */
    async hasPendingMigrations(): Promise<boolean> {
        const pending = await this.getPendingMigrations();
        return pending.length > 0;
    }

    /**
     * Get a summary count of applied vs pending migrations.
     */
    async getSummary(): Promise<MigrationSummary> {
        const status = await this.getStatus();
        const applied = status.filter((s) => s.status === 'applied').length;
        const pending = status.filter((s) => s.status === 'pending').length;
        return { applied, pending, total: status.length };
    }
}
