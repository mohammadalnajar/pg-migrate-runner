/**
 * pg-migrate-runner — SQL Validator
 *
 * Validates migration SQL for common anti-patterns and best-practice violations.
 * Returns an array of warnings/errors. Does NOT block execution — callers decide.
 */

import { ValidationWarning } from './types';

/**
 * Validate migration SQL for common anti-patterns and best-practice violations.
 *
 * Checks performed:
 * - Empty UP/DOWN sections
 * - CREATE TABLE/INDEX without IF NOT EXISTS
 * - DROP TABLE/INDEX without IF EXISTS
 * - DROP + CREATE anti-pattern (prefer CREATE IF NOT EXISTS)
 * - DROP TABLE/SEQUENCE/VIEW/FUNCTION/TYPE without CASCADE
 * - ADD COLUMN without IF NOT EXISTS
 * - ADD CONSTRAINT without idempotency guard
 * - INSERT without ON CONFLICT
 * - RAISE outside DO $$ block (syntax error in plain SQL)
 * - Destructive operations (DROP COLUMN, TRUNCATE, DELETE without WHERE)
 * - Manual transaction control (BEGIN/COMMIT/ROLLBACK)
 * - ALTER TYPE ... ADD VALUE (cannot run in a transaction)
 *
 * @param upSql - The UP (apply) SQL to validate.
 * @param downSql - The DOWN (rollback) SQL to validate.
 * @param migrationName - Optional migration name for clearer error messages.
 * @returns An array of validation warnings/errors.
 */
export function validateMigrationSQL(
    upSql: string,
    downSql: string,
    migrationName?: string
): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];
    const label = migrationName ? ` (${migrationName})` : '';

    // ─── UP SQL checks ───

    if (!upSql || !upSql.trim()) {
        warnings.push({
            level: 'error',
            message: `Empty UP section${label}. Migration must contain SQL statements.`
        });
    }

    if (upSql) {
        const upLines = upSql.split('\n');

        // CREATE TABLE without IF NOT EXISTS
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^CREATE\s+TABLE\b/) && !trimmed.includes('IF NOT EXISTS')) {
                warnings.push({
                    level: 'error',
                    message: `CREATE TABLE without IF NOT EXISTS${label}. Use: CREATE TABLE IF NOT EXISTS`,
                    line: idx + 1
                });
            }
        });

        // CREATE INDEX without IF NOT EXISTS
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (
                trimmed.match(/^CREATE\s+(UNIQUE\s+)?INDEX\b/) &&
                !trimmed.includes('IF NOT EXISTS')
            ) {
                warnings.push({
                    level: 'warning',
                    message: `CREATE INDEX without IF NOT EXISTS${label}. Consider: CREATE INDEX IF NOT EXISTS`,
                    line: idx + 1
                });
            }
        });

        // ADD COLUMN without IF NOT EXISTS
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/ADD\s+COLUMN\b/) && !trimmed.includes('IF NOT EXISTS')) {
                warnings.push({
                    level: 'warning',
                    message: `ADD COLUMN without IF NOT EXISTS${label}. Will fail if the column already exists. Use: ADD COLUMN IF NOT EXISTS`,
                    line: idx + 1
                });
            }
        });

        // RAISE outside DO $$ block — RAISE is a PL/pgSQL statement and causes
        // syntax errors when used in plain SQL context.
        // We strip out DO $$ ... END $$ blocks first, then check remaining lines.
        const upWithoutDoBlocks = upSql.replace(/DO\s+\$\$[\s\S]*?\$\$/gi, '');
        const upRemainingLines = upWithoutDoBlocks.split('\n');
        upRemainingLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^RAISE\s+(NOTICE|WARNING|EXCEPTION|INFO|LOG|DEBUG)\b/)) {
                warnings.push({
                    level: 'error',
                    message: `RAISE statement outside DO $$ block${label}. RAISE is PL/pgSQL and must be inside a DO $$ BEGIN ... END $$ block.`,
                    line: idx + 1
                });
            }
        });

        // DROP TABLE in UP (destructive)
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^DROP\s+TABLE\b/)) {
                if (!trimmed.includes('IF EXISTS')) {
                    warnings.push({
                        level: 'error',
                        message: `DROP TABLE without IF EXISTS${label}. Use: DROP TABLE IF EXISTS`,
                        line: idx + 1
                    });
                }
                warnings.push({
                    level: 'warning',
                    message: `Destructive operation: DROP TABLE in UP section${label}. Ensure this is intentional.`,
                    line: idx + 1
                });
            }
        });

        // DROP COLUMN (destructive, non-reversible data loss)
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/DROP\s+COLUMN\b/)) {
                warnings.push({
                    level: 'warning',
                    message: `Destructive operation: DROP COLUMN${label}. Data will be permanently lost.`,
                    line: idx + 1
                });
            }
        });

        // TRUNCATE / DELETE FROM without WHERE (data loss)
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^TRUNCATE\b/)) {
                warnings.push({
                    level: 'warning',
                    message: `Destructive operation: TRUNCATE${label}. All data will be removed.`,
                    line: idx + 1
                });
            }
            if (trimmed.match(/^DELETE\s+FROM\b/) && !trimmed.includes('WHERE')) {
                warnings.push({
                    level: 'warning',
                    message: `DELETE FROM without WHERE clause${label}. This deletes all rows.`,
                    line: idx + 1
                });
            }
        });

        // BEGIN/COMMIT/ROLLBACK — runner already wraps in transaction
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^(BEGIN|COMMIT|ROLLBACK)\s*;?$/)) {
                warnings.push({
                    level: 'error',
                    message: `Do not use ${trimmed.replace(';', '')} in migration SQL${label}. The runner wraps each migration in a transaction automatically.`,
                    line: idx + 1
                });
            }
        });

        // ALTER TYPE ... ADD VALUE — cannot run inside transaction in PostgreSQL
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/ALTER\s+TYPE\b.*ADD\s+VALUE\b/)) {
                warnings.push({
                    level: 'warning',
                    message: `ALTER TYPE ... ADD VALUE cannot run inside a transaction in PostgreSQL${label}. This migration may fail. Consider a workaround.`,
                    line: idx + 1
                });
            }
        });

        // DROP + CREATE pattern — prefer CREATE IF NOT EXISTS for idempotency
        const upUpper = upSql.toUpperCase();
        if (
            (upUpper.match(/DROP\s+TABLE\b/) && upUpper.match(/CREATE\s+TABLE\b/)) ||
            (upUpper.match(/DROP\s+SEQUENCE\b/) && upUpper.match(/CREATE\s+SEQUENCE\b/))
        ) {
            warnings.push({
                level: 'warning',
                message: `DROP + CREATE pattern detected in UP section${label}. Prefer CREATE ... IF NOT EXISTS for idempotent migrations. DROP can fail if other objects depend on the dropped object.`
            });
        }

        // DROP TABLE/SEQUENCE/VIEW/FUNCTION/TYPE without CASCADE in UP
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (
                trimmed.match(/^DROP\s+(TABLE|SEQUENCE|VIEW|FUNCTION|TYPE)\b/) &&
                !trimmed.includes('CASCADE')
            ) {
                warnings.push({
                    level: 'warning',
                    message: `DROP without CASCADE${label}. If other objects depend on this, the migration will fail. Consider adding CASCADE.`,
                    line: idx + 1
                });
            }
        });

        // ADD CONSTRAINT without idempotency guard
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/ADD\s+CONSTRAINT\b/) && !upSql.includes('pg_constraint')) {
                warnings.push({
                    level: 'warning',
                    message: `ADD CONSTRAINT without idempotency guard${label}. Will fail if the constraint already exists. Wrap in a DO $$ block checking pg_constraint, or use a separate migration.`,
                    line: idx + 1
                });
            }
        });

        // INSERT without ON CONFLICT
        upLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^INSERT\s+INTO\b/) && !upUpper.includes('ON CONFLICT')) {
                warnings.push({
                    level: 'warning',
                    message: `INSERT without ON CONFLICT${label}. If this migration is re-run or data already exists, it will fail on unique constraints. Consider adding ON CONFLICT DO NOTHING or ON CONFLICT DO UPDATE.`,
                    line: idx + 1
                });
            }
        });
    }

    // ─── DOWN SQL checks ───

    if (!downSql || !downSql.trim()) {
        warnings.push({
            level: 'warning',
            message: `Empty DOWN section${label}. Rollback will not be possible for this migration.`
        });
    }

    if (downSql) {
        const downLines = downSql.split('\n');

        // DROP TABLE without IF EXISTS in DOWN
        downLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^DROP\s+TABLE\b/) && !trimmed.includes('IF EXISTS')) {
                warnings.push({
                    level: 'error',
                    message: `DROP TABLE without IF EXISTS in DOWN section${label}. Use: DROP TABLE IF EXISTS`,
                    line: idx + 1
                });
            }
        });

        // DROP INDEX without IF EXISTS in DOWN
        downLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^DROP\s+INDEX\b/) && !trimmed.includes('IF EXISTS')) {
                warnings.push({
                    level: 'warning',
                    message: `DROP INDEX without IF EXISTS in DOWN section${label}. Use: DROP INDEX IF EXISTS`,
                    line: idx + 1
                });
            }
        });

        // BEGIN/COMMIT in DOWN
        downLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^(BEGIN|COMMIT|ROLLBACK)\s*;?$/)) {
                warnings.push({
                    level: 'error',
                    message: `Do not use ${trimmed.replace(';', '')} in DOWN section${label}. The runner wraps rollbacks in a transaction automatically.`,
                    line: idx + 1
                });
            }
        });

        // DROP TABLE/SEQUENCE without CASCADE in DOWN
        downLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^DROP\s+(TABLE|SEQUENCE)\b/) && !trimmed.includes('CASCADE')) {
                warnings.push({
                    level: 'warning',
                    message: `DROP without CASCADE in DOWN section${label}. If other objects depend on this, rollback will fail. Consider adding CASCADE.`,
                    line: idx + 1
                });
            }
        });

        // ADD COLUMN without IF NOT EXISTS in DOWN
        downLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/ADD\s+COLUMN\b/) && !trimmed.includes('IF NOT EXISTS')) {
                warnings.push({
                    level: 'warning',
                    message: `ADD COLUMN without IF NOT EXISTS in DOWN section${label}. Will fail if the column already exists. Use: ADD COLUMN IF NOT EXISTS`,
                    line: idx + 1
                });
            }
        });

        // RAISE outside DO $$ block in DOWN
        const downWithoutDoBlocks = downSql.replace(/DO\s+\$\$[\s\S]*?\$\$/gi, '');
        const downRemainingLines = downWithoutDoBlocks.split('\n');
        downRemainingLines.forEach((line, idx) => {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.match(/^RAISE\s+(NOTICE|WARNING|EXCEPTION|INFO|LOG|DEBUG)\b/)) {
                warnings.push({
                    level: 'error',
                    message: `RAISE statement outside DO $$ block in DOWN section${label}. RAISE is PL/pgSQL and must be inside a DO $$ BEGIN ... END $$ block.`,
                    line: idx + 1
                });
            }
        });
    }

    return warnings;
}
