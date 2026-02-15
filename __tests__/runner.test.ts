import { MigrationRunner } from '../src/runner';
import { computeChecksum } from '../src/helpers';
import { MigrationLockError } from '../src/errors';
import { DEFAULT_TABLE_NAME } from '../src/helpers';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use a loose mock type to avoid strict Pool generics issues
interface MockPool {
    query: jest.Mock;
    connect: jest.Mock;
    end: jest.Mock;
}

// ─── Core Runner Operations ──────────────────────────────────────────────────

describe('MigrationRunner', () => {
    let tmpDir: string;
    let mockPool: MockPool;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
        mockPool = {
            query: jest.fn(),
            connect: jest.fn(),
            end: jest.fn()
        };
        mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ─── readMigrationFiles ──────────────────────────────────────────────

    describe('readMigrationFiles', () => {
        it('should return empty array for empty directory', () => {
            const runner = new MigrationRunner(mockPool as any, tmpDir);
            expect(runner.readMigrationFiles()).toEqual([]);
        });

        it('should return empty array if directory does not exist', () => {
            const runner = new MigrationRunner(mockPool as any, path.join(tmpDir, 'nonexistent'));
            expect(runner.readMigrationFiles()).toEqual([]);
        });

        it('should read and parse valid migration files', () => {
            const content = `-- migrate:up
CREATE TABLE test (id int);

-- migrate:down
DROP TABLE IF EXISTS test;
`;
            fs.writeFileSync(path.join(tmpDir, '20260214120000_create_test.sql'), content);

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const files = runner.readMigrationFiles();

            expect(files).toHaveLength(1);
            expect(files[0].version).toBe('20260214120000');
            expect(files[0].name).toBe('create_test');
            expect(files[0].upSql).toBe('CREATE TABLE test (id int);');
            expect(files[0].downSql).toBe('DROP TABLE IF EXISTS test;');
            expect(files[0].checksum).toMatch(/^[a-f0-9]{16}$/);
        });

        it('should skip old-format files (YYYYMMDD without time)', () => {
            const content = `-- migrate:up\nCREATE TABLE test (id int);`;
            fs.writeFileSync(path.join(tmpDir, '20260214_create_test.sql'), content);

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            expect(runner.readMigrationFiles()).toEqual([]);
        });

        it('should skip ROLLBACK_ files', () => {
            const content = `-- migrate:up\nDROP TABLE test;`;
            fs.writeFileSync(path.join(tmpDir, 'ROLLBACK_20260214120000_create_test.sql'), content);

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            expect(runner.readMigrationFiles()).toEqual([]);
        });

        it('should skip files without migrate:up marker', () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_bad_file.sql'),
                'CREATE TABLE test (id int);'
            );

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            expect(runner.readMigrationFiles()).toEqual([]);
        });

        it('should sort files by version ascending', () => {
            const template = (table: string) =>
                `-- migrate:up\nCREATE TABLE ${table} (id int);\n-- migrate:down\nDROP TABLE ${table};`;

            fs.writeFileSync(path.join(tmpDir, '20260214130000_third.sql'), template('third'));
            fs.writeFileSync(path.join(tmpDir, '20260214110000_first.sql'), template('first'));
            fs.writeFileSync(path.join(tmpDir, '20260214120000_second.sql'), template('second'));

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const files = runner.readMigrationFiles();

            expect(files).toHaveLength(3);
            expect(files[0].name).toBe('first');
            expect(files[1].name).toBe('second');
            expect(files[2].name).toBe('third');
        });

        it('should skip non-.sql files', () => {
            fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Migrations');
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_test.sql'),
                '-- migrate:up\nSELECT 1;'
            );

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            expect(runner.readMigrationFiles()).toHaveLength(1);
        });
    });

    // ─── getStatus ───────────────────────────────────────────────────────

    describe('getStatus', () => {
        it('should mark files as pending when no migrations are applied', async () => {
            const content = `-- migrate:up\nCREATE TABLE test (id int);\n-- migrate:down\nDROP TABLE test;`;
            fs.writeFileSync(path.join(tmpDir, '20260214120000_create_test.sql'), content);

            mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const status = await runner.getStatus();

            expect(status).toHaveLength(1);
            expect(status[0].status).toBe('pending');
            expect(status[0].version).toBe('20260214120000');
        });

        it('should mark files as applied when migration is recorded', async () => {
            const content = `-- migrate:up\nCREATE TABLE test (id int);\n-- migrate:down\nDROP TABLE test;`;
            fs.writeFileSync(path.join(tmpDir, '20260214120000_create_test.sql'), content);

            const checksum = computeChecksum('CREATE TABLE test (id int);');

            mockPool.query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureMigrationsTable
                .mockResolvedValueOnce({
                    rows: [
                        {
                            id: 1,
                            version: '20260214120000',
                            name: 'create_test',
                            applied_at: '2026-02-14T12:00:00Z',
                            execution_time_ms: 15,
                            checksum
                        }
                    ],
                    rowCount: 1
                });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const status = await runner.getStatus();

            expect(status).toHaveLength(1);
            expect(status[0].status).toBe('applied');
            expect(status[0].checksumMismatch).toBe(false);
        });

        it('should detect checksum mismatches', async () => {
            const content = `-- migrate:up\nCREATE TABLE test (id int);\n-- migrate:down\nDROP TABLE test;`;
            fs.writeFileSync(path.join(tmpDir, '20260214120000_create_test.sql'), content);

            mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
                rows: [
                    {
                        id: 1,
                        version: '20260214120000',
                        name: 'create_test',
                        applied_at: '2026-02-14T12:00:00Z',
                        execution_time_ms: 15,
                        checksum: 'differentchecksum'
                    }
                ],
                rowCount: 1
            });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const status = await runner.getStatus();

            expect(status[0].checksumMismatch).toBe(true);
        });
    });

    // ─── getPendingMigrations ────────────────────────────────────────────

    describe('getPendingMigrations', () => {
        it('should return only unapplied migrations', async () => {
            const template = (table: string) =>
                `-- migrate:up\nCREATE TABLE ${table} (id int);\n-- migrate:down\nDROP TABLE ${table};`;

            fs.writeFileSync(path.join(tmpDir, '20260214110000_first.sql'), template('first'));
            fs.writeFileSync(path.join(tmpDir, '20260214120000_second.sql'), template('second'));

            mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
                rows: [
                    {
                        id: 1,
                        version: '20260214110000',
                        name: 'first',
                        applied_at: '2026-02-14T11:00:00Z',
                        execution_time_ms: 10,
                        checksum: computeChecksum('CREATE TABLE first (id int);')
                    }
                ],
                rowCount: 1
            });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const pending = await runner.getPendingMigrations();

            expect(pending).toHaveLength(1);
            expect(pending[0].name).toBe('second');
        });
    });

    // ─── migrate ─────────────────────────────────────────────────────────

    describe('migrate', () => {
        it('should return summary with zero pending when nothing to apply', async () => {
            mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.migrate();

            expect(summary.total_pending).toBe(0);
            expect(summary.total_applied).toBe(0);
            expect(summary.applied).toEqual([]);
            expect(summary.failed).toBeNull();
        });

        it('should apply pending migrations in order', async () => {
            const template = (table: string) =>
                `-- migrate:up\nCREATE TABLE ${table} (id int);\n-- migrate:down\nDROP TABLE ${table};`;

            fs.writeFileSync(path.join(tmpDir, '20260214110000_first.sql'), template('first'));
            fs.writeFileSync(path.join(tmpDir, '20260214120000_second.sql'), template('second'));

            const mockClient = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                release: jest.fn()
            };

            mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
            mockPool.connect.mockResolvedValue(mockClient as any);

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.migrate();

            expect(summary.total_applied).toBe(2);
            expect(summary.applied).toHaveLength(2);
            expect(summary.applied[0].name).toBe('first');
            expect(summary.applied[1].name).toBe('second');
            expect(summary.failed).toBeNull();

            const clientCalls = mockClient.query.mock.calls.map((c: any[]) => c[0]);
            expect(clientCalls.filter((c: string) => c === 'BEGIN')).toHaveLength(2);
            expect(clientCalls.filter((c: string) => c === 'COMMIT')).toHaveLength(2);
        });

        it('should stop on first failure and rollback that transaction', async () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214110000_good.sql'),
                '-- migrate:up\nCREATE TABLE good (id int);\n-- migrate:down\nDROP TABLE good;'
            );
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_bad.sql'),
                '-- migrate:up\nINVALID SQL;\n-- migrate:down\nSELECT 1;'
            );

            const mockClient = {
                query: jest.fn().mockImplementation((sql: string) => {
                    if (sql === 'INVALID SQL;') {
                        throw new Error('syntax error');
                    }
                    return { rows: [], rowCount: 0 };
                }),
                release: jest.fn()
            };

            mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
            mockPool.connect.mockResolvedValue(mockClient as any);

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.migrate();

            expect(summary.total_applied).toBe(1);
            expect(summary.applied).toHaveLength(1);
            expect(summary.applied[0].name).toBe('good');
            expect(summary.failed).not.toBeNull();
            expect(summary.failed!.name).toBe('bad');
            expect(summary.failed!.error).toBe('syntax error');

            const clientCalls = mockClient.query.mock.calls.map((c: any[]) => c[0]);
            expect(clientCalls).toContain('ROLLBACK');
        });

        it('should release client even on failure', async () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_fail.sql'),
                '-- migrate:up\nBAD SQL;\n-- migrate:down\nSELECT 1;'
            );

            const mockClient = {
                query: jest.fn().mockImplementation((sql: string) => {
                    if (sql === 'BAD SQL;') throw new Error('fail');
                    return { rows: [], rowCount: 0 };
                }),
                release: jest.fn()
            };

            mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
            mockPool.connect.mockResolvedValue(mockClient as any);

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            await runner.migrate();

            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    // ─── rollback ────────────────────────────────────────────────────────

    describe('rollback', () => {
        it('should rollback the last applied migration', async () => {
            const content = `-- migrate:up\nCREATE TABLE test (id int);\n-- migrate:down\nDROP TABLE IF EXISTS test;`;
            fs.writeFileSync(path.join(tmpDir, '20260214120000_create_test.sql'), content);

            const mockClient = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                release: jest.fn()
            };

            mockPool.query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({
                    rows: [
                        {
                            id: 1,
                            version: '20260214120000',
                            name: 'create_test',
                            applied_at: '2026-02-14T12:00:00Z',
                            execution_time_ms: 10,
                            checksum: computeChecksum('CREATE TABLE test (id int);')
                        }
                    ],
                    rowCount: 1
                });

            mockPool.connect.mockResolvedValue(mockClient as any);

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.rollback(1);

            expect(summary.total_rolled_back).toBe(1);
            expect(summary.rolledBack[0].name).toBe('create_test');
            expect(summary.failed).toBeNull();

            const clientCalls = mockClient.query.mock.calls.map((c: any[]) => c[0]);
            expect(clientCalls).toContain('DROP TABLE IF EXISTS test;');
        });

        it('should fail if migration file is missing', async () => {
            const mockClient = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                release: jest.fn()
            };

            mockPool.query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({
                    rows: [
                        {
                            id: 1,
                            version: '20260214120000',
                            name: 'missing_file',
                            applied_at: '2026-02-14T12:00:00Z',
                            execution_time_ms: 10,
                            checksum: 'abc123'
                        }
                    ],
                    rowCount: 1
                });

            mockPool.connect.mockResolvedValue(mockClient as any);

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.rollback(1);

            expect(summary.total_rolled_back).toBe(0);
            expect(summary.failed).not.toBeNull();
            expect(summary.failed!.error).toContain('Migration file not found');
        });

        it('should fail if migration has no down section', async () => {
            const content = `-- migrate:up\nCREATE TABLE test (id int);`;
            fs.writeFileSync(path.join(tmpDir, '20260214120000_no_down.sql'), content);

            const mockClient = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                release: jest.fn()
            };

            mockPool.query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({
                    rows: [
                        {
                            id: 1,
                            version: '20260214120000',
                            name: 'no_down',
                            applied_at: '2026-02-14T12:00:00Z',
                            execution_time_ms: 10,
                            checksum: computeChecksum('CREATE TABLE test (id int);')
                        }
                    ],
                    rowCount: 1
                });

            mockPool.connect.mockResolvedValue(mockClient as any);

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.rollback(1);

            expect(summary.total_rolled_back).toBe(0);
            expect(summary.failed).not.toBeNull();
            expect(summary.failed!.error).toContain('no');
        });

        it('should rollback multiple migrations in reverse order', async () => {
            const template = (table: string) =>
                `-- migrate:up\nCREATE TABLE ${table} (id int);\n-- migrate:down\nDROP TABLE IF EXISTS ${table};`;

            fs.writeFileSync(path.join(tmpDir, '20260214110000_first.sql'), template('first'));
            fs.writeFileSync(path.join(tmpDir, '20260214120000_second.sql'), template('second'));
            fs.writeFileSync(path.join(tmpDir, '20260214130000_third.sql'), template('third'));

            const mockClient = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                release: jest.fn()
            };

            mockPool.query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({
                    rows: [
                        {
                            id: 1,
                            version: '20260214110000',
                            name: 'first',
                            applied_at: '2026-02-14T11:00:00Z',
                            execution_time_ms: 10,
                            checksum: computeChecksum('CREATE TABLE first (id int);')
                        },
                        {
                            id: 2,
                            version: '20260214120000',
                            name: 'second',
                            applied_at: '2026-02-14T12:00:00Z',
                            execution_time_ms: 10,
                            checksum: computeChecksum('CREATE TABLE second (id int);')
                        },
                        {
                            id: 3,
                            version: '20260214130000',
                            name: 'third',
                            applied_at: '2026-02-14T13:00:00Z',
                            execution_time_ms: 10,
                            checksum: computeChecksum('CREATE TABLE third (id int);')
                        }
                    ],
                    rowCount: 3
                });

            mockPool.connect.mockResolvedValue(mockClient as any);

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.rollback(2);

            expect(summary.total_rolled_back).toBe(2);
            expect(summary.rolledBack[0].name).toBe('third');
            expect(summary.rolledBack[1].name).toBe('second');
        });
    });

    // ─── createMigrationFile ─────────────────────────────────────────────

    describe('createMigrationFile', () => {
        it('should create a file with the correct format', () => {
            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const result = runner.createMigrationFile('add users table');

            expect(result.filename).toMatch(/^\d{14}_add_users_table\.sql$/);
            expect(fs.existsSync(result.filepath)).toBe(true);

            const content = fs.readFileSync(result.filepath, 'utf-8');
            expect(content).toContain('-- migrate:up');
            expect(content).toContain('-- migrate:down');
            expect(content).toContain('add users table');
        });

        it('should include migration rules in the template', () => {
            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const result = runner.createMigrationFile('test rules');
            const content = fs.readFileSync(result.filepath, 'utf-8');

            expect(content).toContain('MIGRATION RULES');
            expect(content).toContain('IF NOT EXISTS');
            expect(content).toContain('IF EXISTS');
            expect(content).toContain('Do NOT use BEGIN');
            expect(content).toContain('One logical change per migration');
        });

        it('should create the migrations directory if it does not exist', () => {
            const newDir = path.join(tmpDir, 'new', 'subdir');
            const runner = new MigrationRunner(mockPool as any, newDir);
            runner.createMigrationFile('test');

            expect(fs.existsSync(newDir)).toBe(true);
        });

        it('should throw for empty name', () => {
            const runner = new MigrationRunner(mockPool as any, tmpDir);
            expect(() => runner.createMigrationFile('!@#$')).toThrow(
                'at least one alphanumeric character'
            );
        });

        it('should sanitize the name properly', () => {
            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const result = runner.createMigrationFile('Add User-Email Column!');

            expect(result.filename).toContain('add_user_email_column');
        });
    });

    // ─── hasPendingMigrations ────────────────────────────────────────────

    describe('hasPendingMigrations', () => {
        it('should return false when no migration files exist', async () => {
            mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            expect(await runner.hasPendingMigrations()).toBe(false);
        });

        it('should return true when there are unapplied migrations', async () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_test.sql'),
                '-- migrate:up\nSELECT 1;\n-- migrate:down\nSELECT 1;'
            );

            mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            expect(await runner.hasPendingMigrations()).toBe(true);
        });
    });

    // ─── getSummary ──────────────────────────────────────────────────────

    describe('getSummary', () => {
        it('should return correct counts', async () => {
            const template = (table: string) =>
                `-- migrate:up\nCREATE TABLE ${table} (id int);\n-- migrate:down\nDROP TABLE ${table};`;

            fs.writeFileSync(path.join(tmpDir, '20260214110000_applied.sql'), template('applied'));
            fs.writeFileSync(path.join(tmpDir, '20260214120000_pending.sql'), template('pending'));

            mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
                rows: [
                    {
                        id: 1,
                        version: '20260214110000',
                        name: 'applied',
                        applied_at: '2026-02-14T11:00:00Z',
                        execution_time_ms: 10,
                        checksum: computeChecksum('CREATE TABLE applied (id int);')
                    }
                ],
                rowCount: 1
            });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.getSummary();

            expect(summary.applied).toBe(1);
            expect(summary.pending).toBe(1);
            expect(summary.total).toBe(2);
        });
    });
});

// ─── Config-Driven Constructor Tests ─────────────────────────────────────────

describe('MigrationRunner — Config Constructor', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-config-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should accept legacy constructor (pool, dir) with useLock=false', async () => {
        const mockPool = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            connect: jest.fn(),
            end: jest.fn()
        };

        const runner = new MigrationRunner(mockPool as any, tmpDir);

        const summary = await runner.migrate();
        expect(summary.total_pending).toBe(0);
        expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('should accept config object with pool', () => {
        const mockPool = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            connect: jest.fn(),
            end: jest.fn()
        };

        const runner = new MigrationRunner({ pool: mockPool as any, migrationsDir: tmpDir });
        expect(runner).toBeInstanceOf(MigrationRunner);
    });

    it('should throw MigrationError when config has no pool', () => {
        expect(() => {
            new MigrationRunner({} as any);
        }).toThrow('requires a pool');
    });

    it('should enable useLock by default with config constructor', async () => {
        fs.writeFileSync(
            path.join(tmpDir, '20260214120000_test.sql'),
            '-- migrate:up\nSELECT 1;\n-- migrate:down\nSELECT 1;'
        );

        const mockLockClient = {
            query: jest.fn().mockResolvedValue({ rows: [{ acquired: true }] }),
            release: jest.fn()
        };
        const mockMigrationClient = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            release: jest.fn()
        };

        let connectCallCount = 0;
        const mockPool = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            connect: jest.fn().mockImplementation(() => {
                connectCallCount++;
                return connectCallCount === 1 ? mockLockClient : mockMigrationClient;
            }),
            end: jest.fn()
        };

        const runner = new MigrationRunner({ pool: mockPool as any, migrationsDir: tmpDir });
        await runner.migrate();

        expect(mockPool.connect).toHaveBeenCalled();
        expect(mockLockClient.query).toHaveBeenCalledWith(
            'SELECT pg_try_advisory_lock($1) AS acquired',
            expect.any(Array)
        );
    });

    it('should respect useLock: false in config', async () => {
        const mockPool = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            connect: jest.fn(),
            end: jest.fn()
        };

        const runner = new MigrationRunner({
            pool: mockPool as any,
            migrationsDir: tmpDir,
            useLock: false
        });
        await runner.migrate();

        expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('should use duck-type detection for Pool-like objects', () => {
        const duckPool = {
            connect: jest.fn(),
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            end: jest.fn()
        };

        const runner = new MigrationRunner(duckPool as any, tmpDir);
        expect(runner).toBeInstanceOf(MigrationRunner);
    });

    it('should accept custom tableName in config', async () => {
        const mockPool = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            connect: jest.fn(),
            end: jest.fn()
        };

        const runner = new MigrationRunner({
            pool: mockPool as any,
            migrationsDir: tmpDir,
            tableName: 'custom_migrations',
            useLock: false
        });

        await runner.ensureMigrationsTable();

        const createCall = mockPool.query.mock.calls[0][0];
        expect(createCall).toContain('custom_migrations');
    });

    it('should accept custom logger in config', () => {
        const customLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };
        const mockPool = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            connect: jest.fn(),
            end: jest.fn()
        };

        const runner = new MigrationRunner({
            pool: mockPool as any,
            migrationsDir: tmpDir,
            logger: customLogger,
            useLock: false
        });
        expect(runner).toBeInstanceOf(MigrationRunner);
    });

    it('should use DEFAULT_TABLE_NAME constant for legacy constructor', async () => {
        const mockPool = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            connect: jest.fn(),
            end: jest.fn()
        };

        const runner = new MigrationRunner(mockPool as any, tmpDir);
        await runner.ensureMigrationsTable();

        const createCall = mockPool.query.mock.calls[0][0];
        expect(createCall).toContain(DEFAULT_TABLE_NAME);
    });
});

// ─── Dry-Run Mode Tests ──────────────────────────────────────────────────────

describe('MigrationRunner — Dry-Run Mode', () => {
    let tmpDir: string;
    let mockPool: { query: jest.Mock; connect: jest.Mock; end: jest.Mock };

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-dryrun-test-'));
        mockPool = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            connect: jest.fn(),
            end: jest.fn()
        };
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('migrate({ dryRun: true })', () => {
        it('should report pending migrations without executing SQL', async () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_add_users.sql'),
                '-- migrate:up\nCREATE TABLE users (id int);\n-- migrate:down\nDROP TABLE IF EXISTS users;'
            );
            fs.writeFileSync(
                path.join(tmpDir, '20260214130000_add_posts.sql'),
                '-- migrate:up\nCREATE TABLE posts (id int);\n-- migrate:down\nDROP TABLE IF EXISTS posts;'
            );

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.migrate({ dryRun: true });

            expect(summary.dryRun).toBe(true);
            expect(summary.total_pending).toBe(2);
            expect(summary.total_applied).toBe(2);
            expect(summary.applied).toHaveLength(2);
            expect(summary.applied[0].name).toBe('add_users');
            expect(summary.applied[1].name).toBe('add_posts');
            expect(summary.failed).toBeNull();

            expect(mockPool.connect).not.toHaveBeenCalled();
        });

        it('should set execution_time_ms to 0 for dry-run results', async () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_test.sql'),
                '-- migrate:up\nSELECT 1;\n-- migrate:down\nSELECT 1;'
            );

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.migrate({ dryRun: true });

            expect(summary.applied[0].execution_time_ms).toBe(0);
        });

        it('should set dryRun: false by default', async () => {
            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.migrate();

            expect(summary.dryRun).toBe(false);
        });
    });

    describe('rollback with dryRun', () => {
        it('should report what would be rolled back without executing', async () => {
            const content =
                '-- migrate:up\nCREATE TABLE test (id int);\n-- migrate:down\nDROP TABLE IF EXISTS test;';
            fs.writeFileSync(path.join(tmpDir, '20260214120000_create_test.sql'), content);

            mockPool.query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({
                    rows: [
                        {
                            id: 1,
                            version: '20260214120000',
                            name: 'create_test',
                            applied_at: '2026-02-14T12:00:00Z',
                            execution_time_ms: 10,
                            checksum: computeChecksum('CREATE TABLE test (id int);')
                        }
                    ],
                    rowCount: 1
                });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.rollback(1, { dryRun: true });

            expect(summary.dryRun).toBe(true);
            expect(summary.total_rolled_back).toBe(1);
            expect(summary.rolledBack[0].name).toBe('create_test');
            expect(summary.rolledBack[0].execution_time_ms).toBe(0);
            expect(summary.failed).toBeNull();

            expect(mockPool.connect).not.toHaveBeenCalled();
        });

        it('should detect missing file in dry-run rollback', async () => {
            mockPool.query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({
                    rows: [
                        {
                            id: 1,
                            version: '20260214120000',
                            name: 'missing',
                            applied_at: '2026-02-14T12:00:00Z',
                            execution_time_ms: 10,
                            checksum: 'abc123'
                        }
                    ],
                    rowCount: 1
                });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.rollback(1, { dryRun: true });

            expect(summary.dryRun).toBe(true);
            expect(summary.total_rolled_back).toBe(0);
            expect(summary.failed).not.toBeNull();
            expect(summary.failed!.error).toContain('Migration file not found');
        });

        it('should detect missing DOWN section in dry-run rollback', async () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_no_down.sql'),
                '-- migrate:up\nCREATE TABLE test (id int);'
            );

            mockPool.query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({
                    rows: [
                        {
                            id: 1,
                            version: '20260214120000',
                            name: 'no_down',
                            applied_at: '2026-02-14T12:00:00Z',
                            execution_time_ms: 10,
                            checksum: computeChecksum('CREATE TABLE test (id int);')
                        }
                    ],
                    rowCount: 1
                });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.rollback(1, { dryRun: true });

            expect(summary.dryRun).toBe(true);
            expect(summary.total_rolled_back).toBe(0);
            expect(summary.failed).not.toBeNull();
            expect(summary.failed!.error).toContain('DOWN');
        });

        it('should set dryRun: false by default for rollback', async () => {
            mockPool.query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 });

            const runner = new MigrationRunner(mockPool as any, tmpDir);
            const summary = await runner.rollback(1);

            expect(summary.dryRun).toBe(false);
        });
    });
});

// ─── Advisory Locking in Runner Tests ────────────────────────────────────────

describe('MigrationRunner — Advisory Locking', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-lock-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('migrate() with locking', () => {
        it('should acquire and release lock when useLock is true', async () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_test.sql'),
                '-- migrate:up\nCREATE TABLE test (id int);\n-- migrate:down\nDROP TABLE IF EXISTS test;'
            );

            const lockClient = {
                query: jest
                    .fn()
                    .mockResolvedValueOnce({ rows: [{ acquired: true }] })
                    .mockResolvedValueOnce({ rows: [] }),
                release: jest.fn()
            };

            const migrationClient = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                release: jest.fn()
            };

            let connectCallCount = 0;
            const mockPool = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                connect: jest.fn().mockImplementation(() => {
                    connectCallCount++;
                    return connectCallCount === 1 ? lockClient : migrationClient;
                }),
                end: jest.fn()
            };

            const runner = new MigrationRunner({
                pool: mockPool as any,
                migrationsDir: tmpDir,
                useLock: true
            });

            await runner.migrate();

            expect(lockClient.query).toHaveBeenCalledWith(
                'SELECT pg_try_advisory_lock($1) AS acquired',
                expect.any(Array)
            );

            expect(lockClient.query).toHaveBeenCalledWith(
                'SELECT pg_advisory_unlock($1)',
                expect.any(Array)
            );

            expect(lockClient.release).toHaveBeenCalled();
        });

        it('should NOT acquire lock when useLock is false', async () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_test.sql'),
                '-- migrate:up\nCREATE TABLE test (id int);\n-- migrate:down\nDROP TABLE IF EXISTS test;'
            );

            const migrationClient = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                release: jest.fn()
            };

            const mockPool = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                connect: jest.fn().mockResolvedValue(migrationClient),
                end: jest.fn()
            };

            const runner = new MigrationRunner({
                pool: mockPool as any,
                migrationsDir: tmpDir,
                useLock: false
            });

            await runner.migrate();

            const allQueries = migrationClient.query.mock.calls.map((c: any[]) => c[0]);
            expect(allQueries).not.toContain(expect.stringContaining('pg_try_advisory_lock'));
        });

        it('should propagate MigrationLockError when lock cannot be acquired', async () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_test.sql'),
                '-- migrate:up\nSELECT 1;\n-- migrate:down\nSELECT 1;'
            );

            const lockClient = {
                query: jest.fn().mockResolvedValue({ rows: [{ acquired: false }] }),
                release: jest.fn()
            };

            const mockPool = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                connect: jest.fn().mockResolvedValue(lockClient),
                end: jest.fn()
            };

            const runner = new MigrationRunner({
                pool: mockPool as any,
                migrationsDir: tmpDir,
                useLock: true
            });

            await expect(runner.migrate()).rejects.toThrow(MigrationLockError);
        });

        it('should release lock even when migration fails', async () => {
            fs.writeFileSync(
                path.join(tmpDir, '20260214120000_fail.sql'),
                '-- migrate:up\nBAD SQL;\n-- migrate:down\nSELECT 1;'
            );

            const lockClient = {
                query: jest
                    .fn()
                    .mockResolvedValueOnce({ rows: [{ acquired: true }] })
                    .mockResolvedValueOnce({ rows: [] }),
                release: jest.fn()
            };

            const migrationClient = {
                query: jest.fn().mockImplementation((sql: string) => {
                    if (sql === 'BAD SQL;') throw new Error('syntax error');
                    return { rows: [], rowCount: 0 };
                }),
                release: jest.fn()
            };

            let connectCallCount = 0;
            const mockPool = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                connect: jest.fn().mockImplementation(() => {
                    connectCallCount++;
                    return connectCallCount === 1 ? lockClient : migrationClient;
                }),
                end: jest.fn()
            };

            const runner = new MigrationRunner({
                pool: mockPool as any,
                migrationsDir: tmpDir,
                useLock: true
            });

            const summary = await runner.migrate();

            expect(summary.failed).not.toBeNull();

            expect(lockClient.query).toHaveBeenCalledWith(
                'SELECT pg_advisory_unlock($1)',
                expect.any(Array)
            );
            expect(lockClient.release).toHaveBeenCalled();
        });
    });

    describe('rollback() with locking', () => {
        it('should acquire and release lock when useLock is true', async () => {
            const content =
                '-- migrate:up\nCREATE TABLE test (id int);\n-- migrate:down\nDROP TABLE IF EXISTS test;';
            fs.writeFileSync(path.join(tmpDir, '20260214120000_create_test.sql'), content);

            const lockClient = {
                query: jest
                    .fn()
                    .mockResolvedValueOnce({ rows: [{ acquired: true }] })
                    .mockResolvedValueOnce({ rows: [] }),
                release: jest.fn()
            };

            const rollbackClient = {
                query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
                release: jest.fn()
            };

            let connectCallCount = 0;
            const mockPool = {
                query: jest
                    .fn()
                    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                    .mockResolvedValueOnce({
                        rows: [
                            {
                                id: 1,
                                version: '20260214120000',
                                name: 'create_test',
                                applied_at: '2026-02-14T12:00:00Z',
                                execution_time_ms: 10,
                                checksum: computeChecksum('CREATE TABLE test (id int);')
                            }
                        ],
                        rowCount: 1
                    }),
                connect: jest.fn().mockImplementation(() => {
                    connectCallCount++;
                    return connectCallCount === 1 ? lockClient : rollbackClient;
                }),
                end: jest.fn()
            };

            const runner = new MigrationRunner({
                pool: mockPool as any,
                migrationsDir: tmpDir,
                useLock: true
            });

            const summary = await runner.rollback(1);

            expect(summary.total_rolled_back).toBe(1);

            expect(lockClient.query).toHaveBeenCalledWith(
                'SELECT pg_try_advisory_lock($1) AS acquired',
                expect.any(Array)
            );
            expect(lockClient.query).toHaveBeenCalledWith(
                'SELECT pg_advisory_unlock($1)',
                expect.any(Array)
            );
            expect(lockClient.release).toHaveBeenCalled();
        });

        it('should propagate MigrationLockError on rollback when lock fails', async () => {
            const content = '-- migrate:up\nSELECT 1;\n-- migrate:down\nSELECT 1;';
            fs.writeFileSync(path.join(tmpDir, '20260214120000_test.sql'), content);

            const lockClient = {
                query: jest.fn().mockResolvedValue({ rows: [{ acquired: false }] }),
                release: jest.fn()
            };

            const mockPool = {
                query: jest
                    .fn()
                    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                    .mockResolvedValueOnce({
                        rows: [
                            {
                                id: 1,
                                version: '20260214120000',
                                name: 'test',
                                applied_at: '2026-02-14T12:00:00Z',
                                execution_time_ms: 10,
                                checksum: computeChecksum('SELECT 1;')
                            }
                        ],
                        rowCount: 1
                    }),
                connect: jest.fn().mockResolvedValue(lockClient),
                end: jest.fn()
            };

            const runner = new MigrationRunner({
                pool: mockPool as any,
                migrationsDir: tmpDir,
                useLock: true
            });

            await expect(runner.rollback(1)).rejects.toThrow(MigrationLockError);
        });
    });
});
