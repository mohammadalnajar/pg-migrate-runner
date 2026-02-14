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
    }

    return warnings;
}
