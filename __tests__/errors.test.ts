import {
    MigrationError,
    ChecksumMismatchError,
    MigrationLockError,
    MigrationParseError,
    MigrationRollbackError,
    MigrationFileNotFoundError
} from '../src/errors';

// ─── MigrationError ──────────────────────────────────────────────────────────

describe('MigrationError', () => {
    it('should set name to MigrationError', () => {
        const err = new MigrationError('something went wrong');
        expect(err.name).toBe('MigrationError');
    });

    it('should be an instance of Error', () => {
        const err = new MigrationError('fail');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(MigrationError);
    });

    it('should store migration and migrationName', () => {
        const err = new MigrationError('fail', '20260214120000', 'add_users');
        expect(err.migration).toBe('20260214120000');
        expect(err.migrationName).toBe('add_users');
    });

    it('should have undefined migration fields when not provided', () => {
        const err = new MigrationError('fail');
        expect(err.migration).toBeUndefined();
        expect(err.migrationName).toBeUndefined();
    });

    it('should preserve the message', () => {
        const err = new MigrationError('custom message');
        expect(err.message).toBe('custom message');
    });
});

// ─── ChecksumMismatchError ──────────────────────────────────────────────────

describe('ChecksumMismatchError', () => {
    it('should be an instance of MigrationError', () => {
        const err = new ChecksumMismatchError('20260214120000', 'add_users', 'aaa', 'bbb');
        expect(err).toBeInstanceOf(MigrationError);
        expect(err).toBeInstanceOf(ChecksumMismatchError);
    });

    it('should set name to ChecksumMismatchError', () => {
        const err = new ChecksumMismatchError('20260214120000', 'add_users', 'aaa', 'bbb');
        expect(err.name).toBe('ChecksumMismatchError');
    });

    it('should store expected and actual checksums', () => {
        const err = new ChecksumMismatchError(
            '20260214120000',
            'add_users',
            'expected123',
            'actual456'
        );
        expect(err.expected).toBe('expected123');
        expect(err.actual).toBe('actual456');
    });

    it('should include version and name in message', () => {
        const err = new ChecksumMismatchError('20260214120000', 'add_users', 'aaa', 'bbb');
        expect(err.message).toContain('20260214120000');
        expect(err.message).toContain('add_users');
        expect(err.message).toContain('aaa');
        expect(err.message).toContain('bbb');
    });

    it('should carry migration metadata', () => {
        const err = new ChecksumMismatchError('20260214120000', 'add_users', 'a', 'b');
        expect(err.migration).toBe('20260214120000');
        expect(err.migrationName).toBe('add_users');
    });
});

// ─── MigrationLockError ─────────────────────────────────────────────────────

describe('MigrationLockError', () => {
    it('should be an instance of MigrationError', () => {
        const err = new MigrationLockError(741953);
        expect(err).toBeInstanceOf(MigrationError);
        expect(err).toBeInstanceOf(MigrationLockError);
    });

    it('should set name to MigrationLockError', () => {
        const err = new MigrationLockError(741953);
        expect(err.name).toBe('MigrationLockError');
    });

    it('should store lockId', () => {
        const err = new MigrationLockError(12345);
        expect(err.lockId).toBe(12345);
    });

    it('should include lockId in message', () => {
        const err = new MigrationLockError(741953);
        expect(err.message).toContain('741953');
        expect(err.message).toContain('lock');
    });
});

// ─── MigrationParseError ────────────────────────────────────────────────────

describe('MigrationParseError', () => {
    it('should be an instance of MigrationError', () => {
        const err = new MigrationParseError('bad_file.sql', 'missing up marker');
        expect(err).toBeInstanceOf(MigrationError);
        expect(err).toBeInstanceOf(MigrationParseError);
    });

    it('should set name to MigrationParseError', () => {
        const err = new MigrationParseError('bad_file.sql', 'missing up marker');
        expect(err.name).toBe('MigrationParseError');
    });

    it('should store filename', () => {
        const err = new MigrationParseError('bad_file.sql', 'missing up marker');
        expect(err.filename).toBe('bad_file.sql');
    });

    it('should include filename and reason in message', () => {
        const err = new MigrationParseError('bad_file.sql', 'missing up marker');
        expect(err.message).toContain('bad_file.sql');
        expect(err.message).toContain('missing up marker');
    });
});

// ─── MigrationRollbackError ─────────────────────────────────────────────────

describe('MigrationRollbackError', () => {
    it('should be an instance of MigrationError', () => {
        const err = new MigrationRollbackError(
            '20260214120000',
            'add_users',
            'no down section'
        );
        expect(err).toBeInstanceOf(MigrationError);
        expect(err).toBeInstanceOf(MigrationRollbackError);
    });

    it('should set name to MigrationRollbackError', () => {
        const err = new MigrationRollbackError('20260214120000', 'add_users', 'reason');
        expect(err.name).toBe('MigrationRollbackError');
    });

    it('should carry migration metadata', () => {
        const err = new MigrationRollbackError('20260214120000', 'add_users', 'reason');
        expect(err.migration).toBe('20260214120000');
        expect(err.migrationName).toBe('add_users');
    });
});

// ─── MigrationFileNotFoundError ─────────────────────────────────────────────

describe('MigrationFileNotFoundError', () => {
    it('should be an instance of MigrationError', () => {
        const err = new MigrationFileNotFoundError('20260214120000', 'add_users');
        expect(err).toBeInstanceOf(MigrationError);
        expect(err).toBeInstanceOf(MigrationFileNotFoundError);
    });

    it('should set name to MigrationFileNotFoundError', () => {
        const err = new MigrationFileNotFoundError('20260214120000', 'add_users');
        expect(err.name).toBe('MigrationFileNotFoundError');
    });

    it('should include version and name in message', () => {
        const err = new MigrationFileNotFoundError('20260214120000', 'add_users');
        expect(err.message).toContain('20260214120000');
        expect(err.message).toContain('add_users');
    });

    it('should carry migration metadata', () => {
        const err = new MigrationFileNotFoundError('20260214120000', 'add_users');
        expect(err.migration).toBe('20260214120000');
        expect(err.migrationName).toBe('add_users');
    });
});
