/**
 * pg-migrate-runner — Advisory Lock
 *
 * Uses PostgreSQL advisory locks to prevent concurrent migration execution.
 * This ensures that only one migration process runs at a time, even across
 * multiple instances (e.g. multiple Docker containers starting simultaneously).
 *
 * Advisory locks are session-level: automatically released when the connection closes.
 * We also explicitly release them for cleanliness.
 */

import { PoolClient } from 'pg';
import { MigrationLockError } from './errors';
import { MigrationLogger } from './types';
import { DEFAULT_LOCK_ID } from './helpers';

/**
 * Acquire a PostgreSQL advisory lock for migrations.
 *
 * Uses `pg_try_advisory_lock` (non-blocking) to immediately fail
 * if another migration process holds the lock.
 *
 * @param client - A connected PoolClient to acquire the lock on.
 * @param lockId - The advisory lock ID (default: 741953).
 * @param logger - Logger for debug output.
 * @throws MigrationLockError if the lock cannot be acquired.
 */
export async function acquireLock(
    client: PoolClient,
    lockId: number = DEFAULT_LOCK_ID,
    logger?: MigrationLogger
): Promise<void> {
    logger?.debug(`Attempting to acquire advisory lock (ID: ${lockId})...`);

    const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [lockId]);
    const acquired = result.rows[0]?.acquired;

    if (!acquired) {
        throw new MigrationLockError(lockId);
    }

    logger?.debug(`Advisory lock acquired (ID: ${lockId}).`);
}

/**
 * Release a PostgreSQL advisory lock for migrations.
 *
 * Safe to call even if the lock was not acquired (will simply return false).
 *
 * @param client - The PoolClient that holds the lock.
 * @param lockId - The advisory lock ID to release.
 * @param logger - Logger for debug output.
 */
export async function releaseLock(
    client: PoolClient,
    lockId: number = DEFAULT_LOCK_ID,
    logger?: MigrationLogger
): Promise<void> {
    try {
        await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
        logger?.debug(`Advisory lock released (ID: ${lockId}).`);
    } catch (error: any) {
        // Don't throw on unlock failure — the lock will auto-release when the session ends
        logger?.warn(`Failed to release advisory lock (ID: ${lockId}): ${error.message}`);
    }
}
