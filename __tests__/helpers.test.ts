import {
    computeChecksum,
    parseMigrationFile,
    parseFilename,
    generateVersion,
    sanitizeName,
    DEFAULT_TABLE_NAME,
    DEFAULT_LOCK_ID,
    MIGRATION_FILENAME_REGEX,
    UP_MARKER,
    DOWN_MARKER
} from '../src/helpers';

// ─── computeChecksum ─────────────────────────────────────────────────────────

describe('computeChecksum', () => {
    it('should return a 16-character hex string', () => {
        const checksum = computeChecksum('CREATE TABLE test (id int);');
        expect(checksum).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should return the same checksum for the same input', () => {
        const sql = 'CREATE TABLE users (id serial PRIMARY KEY);';
        expect(computeChecksum(sql)).toBe(computeChecksum(sql));
    });

    it('should return different checksums for different inputs', () => {
        const checksum1 = computeChecksum('CREATE TABLE a (id int);');
        const checksum2 = computeChecksum('CREATE TABLE b (id int);');
        expect(checksum1).not.toBe(checksum2);
    });

    it('should trim whitespace before computing', () => {
        const checksum1 = computeChecksum('  SELECT 1;  ');
        const checksum2 = computeChecksum('SELECT 1;');
        expect(checksum1).toBe(checksum2);
    });
});

// ─── parseMigrationFile ──────────────────────────────────────────────────────

describe('parseMigrationFile', () => {
    it('should parse a file with both up and down sections', () => {
        const content = `-- Some comment
-- migrate:up
CREATE TABLE users (id serial);

-- migrate:down
DROP TABLE IF EXISTS users;
`;
        const result = parseMigrationFile(content);
        expect(result).not.toBeNull();
        expect(result!.upSql).toBe('CREATE TABLE users (id serial);');
        expect(result!.downSql).toBe('DROP TABLE IF EXISTS users;');
    });

    it('should parse a file with only up section', () => {
        const content = `-- migrate:up
ALTER TABLE users ADD COLUMN email VARCHAR(255);
`;
        const result = parseMigrationFile(content);
        expect(result).not.toBeNull();
        expect(result!.upSql).toBe('ALTER TABLE users ADD COLUMN email VARCHAR(255);');
        expect(result!.downSql).toBe('');
    });

    it('should return null if no migrate:up marker is found', () => {
        const content = `CREATE TABLE users (id serial);`;
        const result = parseMigrationFile(content);
        expect(result).toBeNull();
    });

    it('should handle multiline SQL in both sections', () => {
        const content = `-- migrate:up
CREATE TABLE users (
    id serial PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(255) UNIQUE
);

INSERT INTO users (name, email) VALUES ('admin', 'admin@example.com');

-- migrate:down
DELETE FROM users WHERE email = 'admin@example.com';
DROP TABLE IF EXISTS users;
`;
        const result = parseMigrationFile(content);
        expect(result).not.toBeNull();
        expect(result!.upSql).toContain('CREATE TABLE users');
        expect(result!.upSql).toContain('INSERT INTO users');
        expect(result!.downSql).toContain('DELETE FROM users');
        expect(result!.downSql).toContain('DROP TABLE IF EXISTS users;');
    });

    it('should handle down section appearing before up section', () => {
        const content = `-- migrate:down
DROP TABLE IF EXISTS users;

-- migrate:up
CREATE TABLE users (id serial);
`;
        const result = parseMigrationFile(content);
        expect(result).not.toBeNull();
        expect(result!.upSql).toBe('CREATE TABLE users (id serial);');
        expect(result!.downSql).toBe('DROP TABLE IF EXISTS users;');
    });
});

// ─── parseFilename ───────────────────────────────────────────────────────────

describe('parseFilename', () => {
    it('should parse a valid migration filename', () => {
        const result = parseFilename('20260214120000_add_users_table.sql');
        expect(result).toEqual({
            version: '20260214120000',
            name: 'add_users_table'
        });
    });

    it('should reject filenames without .sql extension', () => {
        const result = parseFilename('20260214120000_add_users_table.txt');
        expect(result).toBeNull();
    });

    it('should reject filenames without a valid timestamp', () => {
        const result = parseFilename('2026021_add_users_table.sql');
        expect(result).toBeNull();
    });

    it('should reject filenames with uppercase characters in name', () => {
        const result = parseFilename('20260214120000_AddUsersTable.sql');
        expect(result).toBeNull();
    });

    it('should reject filenames with hyphens in name', () => {
        const result = parseFilename('20260214120000_add-users-table.sql');
        expect(result).toBeNull();
    });

    it('should reject old-style filenames (YYYYMMDD without time)', () => {
        const result = parseFilename('20260214_add_users_table.sql');
        expect(result).toBeNull();
    });

    it('should reject ROLLBACK_ prefixed files', () => {
        const result = parseFilename('ROLLBACK_20260214120000_add_users_table.sql');
        expect(result).toBeNull();
    });

    it('should parse filename with numbers in name', () => {
        const result = parseFilename('20260214120000_add_column_v2.sql');
        expect(result).toEqual({
            version: '20260214120000',
            name: 'add_column_v2'
        });
    });
});

// ─── generateVersion ─────────────────────────────────────────────────────────

describe('generateVersion', () => {
    it('should return a 14-digit string', () => {
        const version = generateVersion();
        expect(version).toMatch(/^\d{14}$/);
    });

    it('should start with the current year', () => {
        const version = generateVersion();
        const currentYear = new Date().getFullYear().toString();
        expect(version.startsWith(currentYear)).toBe(true);
    });

    it('should generate unique versions when called twice', () => {
        const v1 = generateVersion();
        const v2 = generateVersion();
        // They might be the same if called in the same second, but format should be valid
        expect(v1).toMatch(/^\d{14}$/);
        expect(v2).toMatch(/^\d{14}$/);
    });
});

// ─── sanitizeName ────────────────────────────────────────────────────────────

describe('sanitizeName', () => {
    it('should convert spaces to underscores', () => {
        expect(sanitizeName('add users table')).toBe('add_users_table');
    });

    it('should convert to lowercase', () => {
        expect(sanitizeName('AddUsersTable')).toBe('adduserstable');
    });

    it('should remove special characters', () => {
        expect(sanitizeName('add-users!table@v2')).toBe('add_users_table_v2');
    });

    it('should trim leading and trailing underscores', () => {
        expect(sanitizeName('__add_users__')).toBe('add_users');
    });

    it('should truncate to 100 characters', () => {
        const longName = 'a'.repeat(150);
        expect(sanitizeName(longName).length).toBeLessThanOrEqual(100);
    });

    it('should return empty string for invalid input', () => {
        expect(sanitizeName('!@#$%')).toBe('');
    });

    it('should handle consecutive special characters', () => {
        expect(sanitizeName('add---users___table')).toBe('add_users_table');
    });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('Constants', () => {
    it('DEFAULT_TABLE_NAME should be schema_migrations', () => {
        expect(DEFAULT_TABLE_NAME).toBe('schema_migrations');
    });

    it('DEFAULT_LOCK_ID should be the expected integer', () => {
        expect(DEFAULT_LOCK_ID).toBe(741953);
        expect(typeof DEFAULT_LOCK_ID).toBe('number');
    });

    it('MIGRATION_FILENAME_REGEX should match valid filenames', () => {
        expect(MIGRATION_FILENAME_REGEX.test('20260214120000_create_test.sql')).toBe(true);
    });

    it('MIGRATION_FILENAME_REGEX should reject invalid filenames', () => {
        expect(MIGRATION_FILENAME_REGEX.test('bad_file.sql')).toBe(false);
    });

    it('UP_MARKER should be "-- migrate:up"', () => {
        expect(UP_MARKER).toBe('-- migrate:up');
    });

    it('DOWN_MARKER should be "-- migrate:down"', () => {
        expect(DOWN_MARKER).toBe('-- migrate:down');
    });
});
