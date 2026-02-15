import { acquireLock, releaseLock } from '../src/lock';
import { MigrationLockError } from '../src/errors';
import { DEFAULT_LOCK_ID } from '../src/helpers';

// ─── acquireLock ─────────────────────────────────────────────────────────────

describe('acquireLock', () => {
    it('should succeed when pg_try_advisory_lock returns true', async () => {
        const mockClient = {
            query: jest.fn().mockResolvedValue({ rows: [{ acquired: true }] })
        };

        await expect(acquireLock(mockClient as any)).resolves.not.toThrow();
        expect(mockClient.query).toHaveBeenCalledWith(
            'SELECT pg_try_advisory_lock($1) AS acquired',
            [DEFAULT_LOCK_ID]
        );
    });

    it('should throw MigrationLockError when lock is not acquired', async () => {
        const mockClient = {
            query: jest.fn().mockResolvedValue({ rows: [{ acquired: false }] })
        };

        await expect(acquireLock(mockClient as any)).rejects.toThrow(MigrationLockError);
    });

    it('should use custom lock ID when provided', async () => {
        const mockClient = {
            query: jest.fn().mockResolvedValue({ rows: [{ acquired: true }] })
        };

        await acquireLock(mockClient as any, 99999);
        expect(mockClient.query).toHaveBeenCalledWith(
            'SELECT pg_try_advisory_lock($1) AS acquired',
            [99999]
        );
    });

    it('should call logger.debug when logger is provided', async () => {
        const mockClient = {
            query: jest.fn().mockResolvedValue({ rows: [{ acquired: true }] })
        };
        const mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };

        await acquireLock(mockClient as any, DEFAULT_LOCK_ID, mockLogger);
        expect(mockLogger.debug).toHaveBeenCalledTimes(2); // Attempting + Acquired
    });

    it('should include lockId in MigrationLockError when thrown', async () => {
        const mockClient = {
            query: jest.fn().mockResolvedValue({ rows: [{ acquired: false }] })
        };

        try {
            await acquireLock(mockClient as any, 12345);
            fail('Should have thrown');
        } catch (err: any) {
            expect(err).toBeInstanceOf(MigrationLockError);
            expect(err.lockId).toBe(12345);
        }
    });
});

// ─── releaseLock ─────────────────────────────────────────────────────────────

describe('releaseLock', () => {
    it('should call pg_advisory_unlock', async () => {
        const mockClient = {
            query: jest.fn().mockResolvedValue({ rows: [] })
        };

        await releaseLock(mockClient as any);
        expect(mockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
            DEFAULT_LOCK_ID
        ]);
    });

    it('should use custom lock ID', async () => {
        const mockClient = {
            query: jest.fn().mockResolvedValue({ rows: [] })
        };

        await releaseLock(mockClient as any, 99999);
        expect(mockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [99999]);
    });

    it('should NOT throw when unlock fails', async () => {
        const mockClient = {
            query: jest.fn().mockRejectedValue(new Error('connection lost'))
        };

        // releaseLock swallows errors
        await expect(releaseLock(mockClient as any)).resolves.not.toThrow();
    });

    it('should log a warning when unlock fails', async () => {
        const mockClient = {
            query: jest.fn().mockRejectedValue(new Error('connection lost'))
        };
        const mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };

        await releaseLock(mockClient as any, DEFAULT_LOCK_ID, mockLogger);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
    });
});
