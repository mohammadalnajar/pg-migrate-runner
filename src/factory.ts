/**
 * pg-migrate-runner — Factory
 *
 * Convenience function to create a MigrationRunner from environment variables.
 * Handles connection string detection, SSL configuration, and pool creation.
 *
 * Supports multiple env var naming conventions:
 *   - DATABASE_URL / POSTGRESQL_URL (connection string)
 *   - POSTGRESQL_HOST, POSTGRESQL_PORT, POSTGRESQL_DATABASE, etc. (individual fields)
 *   - PG_HOST, PG_PORT, PG_DATABASE, etc. (pg convention)
 */

import { Pool, PoolConfig } from 'pg';
import path from 'path';

import { MigrationConfig } from './types';
import { MigrationRunner } from './runner';

/**
 * Create a MigrationRunner with a fresh Pool using environment variables.
 * Caller is responsible for closing the pool when done.
 *
 * @param configOrDir - A MigrationConfig for overrides, or a string path (legacy).
 * @returns An object with `runner` and `pool` (caller must call `pool.end()`).
 */
export function createMigrationRunner(configOrDir?: string | Partial<MigrationConfig>): {
    runner: MigrationRunner;
    pool: Pool;
} {
    // Normalize input: string → { migrationsDir: string }
    const config: Partial<MigrationConfig> =
        typeof configOrDir === 'string' ? { migrationsDir: configOrDir } : configOrDir || {};

    const isProduction = process.env.NODE_ENV === 'production';

    // Detect connection string from env vars (multiple conventions)
    const connectionString =
        config.connectionString || process.env.DATABASE_URL || process.env.POSTGRESQL_URL;

    // Detect if running inside Docker (common pattern: host = 'postgres')
    const host = config.host || process.env.POSTGRESQL_HOST || process.env.PG_HOST || 'localhost';
    const isDockerContainer = host === 'postgres';

    // Build SSL config
    let sslConfig: PoolConfig['ssl'] = undefined;
    if (config.ssl === true) {
        sslConfig = { rejectUnauthorized: false };
    } else if (typeof config.ssl === 'object') {
        sslConfig = config.ssl;
    } else if (isProduction && !isDockerContainer && config.ssl !== false) {
        // Auto-enable SSL in production (except Docker containers)
        sslConfig = { rejectUnauthorized: false };
    }

    // Build connection config
    const connectionConfig: PoolConfig = connectionString
        ? {
              connectionString,
              ...(sslConfig && { ssl: sslConfig })
          }
        : {
              user: config.user || process.env.POSTGRESQL_USER || process.env.PG_USER,
              host,
              database:
                  config.database || process.env.POSTGRESQL_DATABASE || process.env.PG_DATABASE,
              password:
                  config.password || process.env.POSTGRESQL_PASSWORD || process.env.PG_PASSWORD,
              port:
                  config.port || Number(process.env.POSTGRESQL_PORT || process.env.PG_PORT) || 5432,
              ...(sslConfig && { ssl: sslConfig })
          };

    const pool = new Pool({
        ...connectionConfig,
        max: 2, // Migrations only need a small pool
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 5000,
        allowExitOnIdle: true
    });

    const migrationsDir = config.migrationsDir || path.join(process.cwd(), 'models', 'migrations');

    const runner = new MigrationRunner({
        pool,
        migrationsDir,
        tableName: config.tableName,
        lockId: config.lockId,
        useLock: config.useLock,
        logger: config.logger
    });

    return { runner, pool };
}
