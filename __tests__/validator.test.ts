import { validateMigrationSQL } from '../src/validator';

// ─── UP section checks ──────────────────────────────────────────────────────

describe('validateMigrationSQL', () => {
    it('should return error when UP section is empty', () => {
        const warnings = validateMigrationSQL('', 'DROP TABLE IF EXISTS t;');
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('Empty UP section')
            })
        );
    });

    it('should return error when UP section is only whitespace', () => {
        const warnings = validateMigrationSQL('   \n  ', 'DROP TABLE IF EXISTS t;');
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('Empty UP section')
            })
        );
    });

    it('should return error for CREATE TABLE without IF NOT EXISTS', () => {
        const warnings = validateMigrationSQL(
            'CREATE TABLE users (id serial PRIMARY KEY);',
            'DROP TABLE IF EXISTS users;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('CREATE TABLE without IF NOT EXISTS')
            })
        );
    });

    it('should NOT flag CREATE TABLE IF NOT EXISTS', () => {
        const warnings = validateMigrationSQL(
            'CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY);',
            'DROP TABLE IF EXISTS users;'
        );
        const createTableErrors = warnings.filter((w) =>
            w.message.includes('CREATE TABLE without')
        );
        expect(createTableErrors).toHaveLength(0);
    });

    it('should warn for CREATE INDEX without IF NOT EXISTS', () => {
        const warnings = validateMigrationSQL(
            'CREATE INDEX idx_users_email ON users (email);',
            'DROP INDEX IF EXISTS idx_users_email;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('CREATE INDEX without IF NOT EXISTS')
            })
        );
    });

    it('should NOT flag CREATE INDEX IF NOT EXISTS', () => {
        const warnings = validateMigrationSQL(
            'CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);',
            'DROP INDEX IF EXISTS idx_users_email;'
        );
        const indexWarnings = warnings.filter((w) => w.message.includes('CREATE INDEX without'));
        expect(indexWarnings).toHaveLength(0);
    });

    it('should warn for CREATE UNIQUE INDEX without IF NOT EXISTS', () => {
        const warnings = validateMigrationSQL(
            'CREATE UNIQUE INDEX idx_email ON users (email);',
            'DROP INDEX IF EXISTS idx_email;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('CREATE INDEX without IF NOT EXISTS')
            })
        );
    });

    it('should error for DROP TABLE without IF EXISTS in UP', () => {
        const warnings = validateMigrationSQL(
            'DROP TABLE old_table;',
            'CREATE TABLE IF NOT EXISTS old_table (id int);'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('DROP TABLE without IF EXISTS')
            })
        );
    });

    it('should warn about destructive DROP TABLE in UP even with IF EXISTS', () => {
        const warnings = validateMigrationSQL(
            'DROP TABLE IF EXISTS old_table;',
            'CREATE TABLE IF NOT EXISTS old_table (id int);'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('Destructive operation: DROP TABLE')
            })
        );
    });

    it('should warn for DROP COLUMN', () => {
        const warnings = validateMigrationSQL(
            'ALTER TABLE users DROP COLUMN age;',
            'ALTER TABLE users ADD COLUMN age integer;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('DROP COLUMN')
            })
        );
    });

    it('should warn for TRUNCATE', () => {
        const warnings = validateMigrationSQL(
            'TRUNCATE TABLE sessions;',
            'SELECT 1; -- cannot undo truncate'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('TRUNCATE')
            })
        );
    });

    it('should warn for DELETE FROM without WHERE', () => {
        const warnings = validateMigrationSQL('DELETE FROM sessions;', 'SELECT 1;');
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('DELETE FROM without WHERE')
            })
        );
    });

    it('should NOT warn for DELETE FROM with WHERE', () => {
        const warnings = validateMigrationSQL(
            'DELETE FROM sessions WHERE expired_at < NOW();',
            'SELECT 1;'
        );
        const deleteWarnings = warnings.filter((w) =>
            w.message.includes('DELETE FROM without WHERE')
        );
        expect(deleteWarnings).toHaveLength(0);
    });

    it('should error for BEGIN in UP section', () => {
        const warnings = validateMigrationSQL(
            'BEGIN;\nCREATE TABLE IF NOT EXISTS t (id int);\nCOMMIT;',
            'DROP TABLE IF EXISTS t;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('Do not use BEGIN')
            })
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('Do not use COMMIT')
            })
        );
    });

    it('should error for ROLLBACK in UP section', () => {
        const warnings = validateMigrationSQL('ROLLBACK;', 'SELECT 1;');
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('Do not use ROLLBACK')
            })
        );
    });

    it('should warn for ALTER TYPE ADD VALUE', () => {
        const warnings = validateMigrationSQL(
            "ALTER TYPE user_role ADD VALUE 'moderator';",
            'SELECT 1; -- cannot remove enum values'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining(
                    'ALTER TYPE ... ADD VALUE cannot run inside a transaction'
                )
            })
        );
    });

    // ─── DOWN section checks ─────────────────────────────────────────────

    it('should warn when DOWN section is empty', () => {
        const warnings = validateMigrationSQL('CREATE TABLE IF NOT EXISTS t (id int);', '');
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('Empty DOWN section')
            })
        );
    });

    it('should error for DROP TABLE without IF EXISTS in DOWN', () => {
        const warnings = validateMigrationSQL(
            'CREATE TABLE IF NOT EXISTS t (id int);',
            'DROP TABLE t;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('DROP TABLE without IF EXISTS in DOWN')
            })
        );
    });

    it('should NOT flag DROP TABLE IF EXISTS in DOWN', () => {
        const warnings = validateMigrationSQL(
            'CREATE TABLE IF NOT EXISTS t (id int);',
            'DROP TABLE IF EXISTS t;'
        );
        const dropErrors = warnings.filter((w) =>
            w.message.includes('DROP TABLE without IF EXISTS')
        );
        expect(dropErrors).toHaveLength(0);
    });

    it('should warn for DROP INDEX without IF EXISTS in DOWN', () => {
        const warnings = validateMigrationSQL(
            'CREATE INDEX IF NOT EXISTS idx_t ON t (col);',
            'DROP INDEX idx_t;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('DROP INDEX without IF EXISTS in DOWN')
            })
        );
    });

    it('should error for BEGIN/COMMIT in DOWN section', () => {
        const warnings = validateMigrationSQL(
            'CREATE TABLE IF NOT EXISTS t (id int);',
            'BEGIN;\nDROP TABLE IF EXISTS t;\nCOMMIT;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('Do not use BEGIN in DOWN')
            })
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('Do not use COMMIT in DOWN')
            })
        );
    });

    // ─── Combined / edge cases ───────────────────────────────────────────

    it('should return empty array for a well-formed migration', () => {
        const warnings = validateMigrationSQL(
            'CREATE TABLE IF NOT EXISTS users (\n  id SERIAL PRIMARY KEY,\n  name VARCHAR(255)\n);',
            'DROP TABLE IF EXISTS users CASCADE;'
        );
        expect(warnings).toHaveLength(0);
    });

    it('should include migration name in messages when provided', () => {
        const warnings = validateMigrationSQL(
            'CREATE TABLE users (id int);',
            'DROP TABLE users;',
            'create_users'
        );
        const withName = warnings.filter((w) => w.message.includes('(create_users)'));
        expect(withName.length).toBeGreaterThan(0);
    });

    it('should report correct line numbers', () => {
        const upSql = '-- Add table\nCREATE TABLE bad (id int);\n-- done';
        const warnings = validateMigrationSQL(upSql, 'DROP TABLE IF EXISTS bad CASCADE;');
        const createError = warnings.find((w) => w.message.includes('CREATE TABLE without'));
        expect(createError?.line).toBe(2);
    });

    it('should detect multiple issues in a single migration', () => {
        const upSql = [
            'BEGIN;',
            'CREATE TABLE users (id int);',
            'CREATE INDEX idx_email ON users (email);',
            'TRUNCATE TABLE old_data;',
            'COMMIT;'
        ].join('\n');
        const downSql = 'DROP TABLE users;';

        const warnings = validateMigrationSQL(upSql, downSql);
        // Should find: BEGIN, CREATE TABLE, CREATE INDEX, TRUNCATE, COMMIT in UP + DROP TABLE without IF EXISTS in DOWN
        expect(warnings.length).toBeGreaterThanOrEqual(5);
    });

    it('should handle SQL comments (lines starting with --) without false positives', () => {
        const warnings = validateMigrationSQL(
            '-- CREATE TABLE without if not exists is bad\nCREATE TABLE IF NOT EXISTS t (id int);',
            '-- DROP TABLE is fine in comments\nDROP TABLE IF EXISTS t CASCADE;'
        );
        // Comments should not trigger warnings
        expect(warnings).toHaveLength(0);
    });

    // ─── Idempotency & dependency safety rules ──────────────────────────

    it('should warn for DROP + CREATE pattern in UP section', () => {
        const warnings = validateMigrationSQL(
            'DROP TABLE IF EXISTS t CASCADE;\nCREATE TABLE IF NOT EXISTS t (id int);',
            'DROP TABLE IF EXISTS t CASCADE;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('DROP + CREATE pattern')
            })
        );
    });

    it('should warn for DROP SEQUENCE + CREATE SEQUENCE pattern in UP section', () => {
        const warnings = validateMigrationSQL(
            'DROP SEQUENCE IF EXISTS seq CASCADE;\nCREATE SEQUENCE IF NOT EXISTS seq;',
            'DROP SEQUENCE IF EXISTS seq;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('DROP + CREATE pattern')
            })
        );
    });

    it('should NOT warn for DROP + CREATE when only one is present', () => {
        const warnings = validateMigrationSQL(
            'CREATE TABLE IF NOT EXISTS t (id int);',
            'DROP TABLE IF EXISTS t CASCADE;'
        );
        const dropCreateWarnings = warnings.filter((w) =>
            w.message.includes('DROP + CREATE pattern')
        );
        expect(dropCreateWarnings).toHaveLength(0);
    });

    it('should warn for DROP TABLE without CASCADE in UP', () => {
        const warnings = validateMigrationSQL('DROP TABLE IF EXISTS old_data;', 'SELECT 1;');
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('DROP without CASCADE')
            })
        );
    });

    it('should warn for DROP SEQUENCE without CASCADE in UP', () => {
        const warnings = validateMigrationSQL('DROP SEQUENCE IF EXISTS old_seq;', 'SELECT 1;');
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('DROP without CASCADE')
            })
        );
    });

    it('should NOT warn for DROP TABLE with CASCADE in UP', () => {
        const warnings = validateMigrationSQL(
            'DROP TABLE IF EXISTS old_data CASCADE;',
            'SELECT 1;'
        );
        const cascadeWarnings = warnings.filter((w) => w.message.includes('DROP without CASCADE'));
        expect(cascadeWarnings).toHaveLength(0);
    });

    it('should warn for DROP TABLE without CASCADE in DOWN', () => {
        const warnings = validateMigrationSQL(
            'CREATE TABLE IF NOT EXISTS t (id int);',
            'DROP TABLE IF EXISTS t;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('DROP without CASCADE in DOWN')
            })
        );
    });

    it('should NOT warn for DROP TABLE with CASCADE in DOWN', () => {
        const warnings = validateMigrationSQL(
            'CREATE TABLE IF NOT EXISTS t (id int);',
            'DROP TABLE IF EXISTS t CASCADE;'
        );
        const cascadeWarnings = warnings.filter((w) =>
            w.message.includes('DROP without CASCADE in DOWN')
        );
        expect(cascadeWarnings).toHaveLength(0);
    });

    it('should warn for ADD CONSTRAINT without idempotency guard', () => {
        const warnings = validateMigrationSQL(
            'ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);',
            'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('ADD CONSTRAINT without idempotency')
            })
        );
    });

    it('should NOT warn for ADD CONSTRAINT with pg_constraint guard', () => {
        const upSql = `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key') THEN
        ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
    END IF;
END $$;`;
        const warnings = validateMigrationSQL(
            upSql,
            'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;'
        );
        const constraintWarnings = warnings.filter((w) =>
            w.message.includes('ADD CONSTRAINT without idempotency')
        );
        expect(constraintWarnings).toHaveLength(0);
    });

    it('should warn for INSERT without ON CONFLICT', () => {
        const warnings = validateMigrationSQL(
            "INSERT INTO roles (name) VALUES ('admin'), ('user');",
            "DELETE FROM roles WHERE name IN ('admin', 'user');"
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('INSERT without ON CONFLICT')
            })
        );
    });

    it('should NOT warn for INSERT with ON CONFLICT DO NOTHING', () => {
        const warnings = validateMigrationSQL(
            "INSERT INTO roles (name) VALUES ('admin') ON CONFLICT DO NOTHING;",
            'SELECT 1;'
        );
        const insertWarnings = warnings.filter((w) =>
            w.message.includes('INSERT without ON CONFLICT')
        );
        expect(insertWarnings).toHaveLength(0);
    });

    it('should NOT warn for INSERT with ON CONFLICT DO UPDATE', () => {
        const warnings = validateMigrationSQL(
            "INSERT INTO roles (name) VALUES ('admin') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;",
            'SELECT 1;'
        );
        const insertWarnings = warnings.filter((w) =>
            w.message.includes('INSERT without ON CONFLICT')
        );
        expect(insertWarnings).toHaveLength(0);
    });

    // ─── ADD COLUMN without IF NOT EXISTS ─────────────────────────────────

    it('should warn for ADD COLUMN without IF NOT EXISTS in UP', () => {
        const warnings = validateMigrationSQL(
            'ALTER TABLE users ADD COLUMN email varchar(255);',
            'ALTER TABLE users DROP COLUMN IF EXISTS email;'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('ADD COLUMN without IF NOT EXISTS')
            })
        );
    });

    it('should NOT warn for ADD COLUMN IF NOT EXISTS in UP', () => {
        const warnings = validateMigrationSQL(
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS email varchar(255);',
            'ALTER TABLE users DROP COLUMN IF EXISTS email;'
        );
        const addColWarnings = warnings.filter((w) =>
            w.message.includes('ADD COLUMN without IF NOT EXISTS')
        );
        expect(addColWarnings).toHaveLength(0);
    });

    it('should warn for ADD COLUMN without IF NOT EXISTS in DOWN', () => {
        const warnings = validateMigrationSQL(
            'ALTER TABLE users DROP COLUMN IF EXISTS email;',
            'ALTER TABLE users ADD COLUMN email varchar(255);'
        );
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('ADD COLUMN without IF NOT EXISTS in DOWN')
            })
        );
    });

    it('should NOT warn for ADD COLUMN IF NOT EXISTS in DOWN', () => {
        const warnings = validateMigrationSQL(
            'ALTER TABLE users DROP COLUMN IF EXISTS email;',
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS email varchar(255);'
        );
        const addColWarnings = warnings.filter((w) =>
            w.message.includes('ADD COLUMN without IF NOT EXISTS')
        );
        expect(addColWarnings).toHaveLength(0);
    });

    // ─── RAISE outside DO $$ block ────────────────────────────────────────

    it('should error for RAISE NOTICE outside DO block in UP', () => {
        const warnings = validateMigrationSQL("RAISE NOTICE 'Migration complete';", 'SELECT 1;');
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('RAISE statement outside DO $$ block')
            })
        );
    });

    it('should error for RAISE WARNING outside DO block in UP', () => {
        const warnings = validateMigrationSQL("RAISE WARNING 'Something went wrong';", 'SELECT 1;');
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('RAISE statement outside DO $$ block')
            })
        );
    });

    it('should error for RAISE NOTICE outside DO block in DOWN', () => {
        const warnings = validateMigrationSQL('SELECT 1;', "RAISE NOTICE 'Rollback complete';");
        expect(warnings).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('RAISE statement outside DO $$ block in DOWN')
            })
        );
    });

    it('should NOT error for RAISE inside a DO $$ block', () => {
        const upSql = `DO $$ BEGIN
    RAISE NOTICE 'Migration complete';
END $$;`;
        const warnings = validateMigrationSQL(upSql, 'SELECT 1;');
        const raiseWarnings = warnings.filter((w) =>
            w.message.includes('RAISE statement outside DO')
        );
        expect(raiseWarnings).toHaveLength(0);
    });

    it('should detect multiple ADD COLUMN issues in one migration', () => {
        const warnings = validateMigrationSQL(
            `ALTER TABLE users ADD COLUMN email varchar(255);
ALTER TABLE users ADD COLUMN phone varchar(20);`,
            'SELECT 1;'
        );
        const addColWarnings = warnings.filter((w) =>
            w.message.includes('ADD COLUMN without IF NOT EXISTS')
        );
        expect(addColWarnings).toHaveLength(2);
    });
});
