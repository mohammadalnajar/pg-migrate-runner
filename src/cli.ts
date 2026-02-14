#!/usr/bin/env node
/**
 * pg-migrate-runner CLI
 *
 * Standalone command-line interface for PostgreSQL migrations.
 *
 * Commands:
 *   pg-migrate-runner up              Apply all pending migrations
 *   pg-migrate-runner status          Show migration status
 *   pg-migrate-runner rollback [N]    Rollback last N migrations (default: 1)
 *   pg-migrate-runner create <name>   Create a new migration file
 *
 * Flags:
 *   --dry-run       Preview changes without modifying the database
 *   --dir <path>    Path to migration files directory
 *   --table <name>  Name of the tracking table (default: schema_migrations)
 *   --no-lock       Disable advisory locking
 *   --help, -h      Show help
 *   --version, -v   Show version
 *
 * Environment Variables:
 *   DATABASE_URL / POSTGRESQL_URL     Connection string
 *   POSTGRESQL_HOST / PG_HOST         Host (default: localhost)
 *   POSTGRESQL_PORT / PG_PORT         Port (default: 5432)
 *   POSTGRESQL_DATABASE / PG_DATABASE Database name
 *   POSTGRESQL_USER / PG_USER         Username
 *   POSTGRESQL_PASSWORD / PG_PASSWORD Password
 */

import { createMigrationRunner } from './factory';
import { MigrationLockError } from './errors';
import { MigrationConfig } from './types';

// ─── ANSI Colors (no dependency needed) ──────────────────────────────────────

const color = {
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
    gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
    bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    greenBold: (s: string) => `\x1b[1;32m${s}\x1b[0m`
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getVersion(): string {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('../package.json').version;
    } catch {
        return '0.0.0';
    }
}

function printHelp(): void {
    console.log(`
${color.bold('pg-migrate-runner')} v${getVersion()}

${color.bold('Usage:')}
  pg-migrate-runner <command> [options]

${color.bold('Commands:')}
  up                    Apply all pending migrations
  status                Show migration status
  rollback [N]          Rollback last N migrations (default: 1)
  create <name>         Create a new migration file

${color.bold('Options:')}
  --dry-run             Preview changes without modifying the database
  --dir <path>          Path to migration files directory (default: ./migrations)
  --table <name>        Name of the tracking table (default: schema_migrations)
  --no-lock             Disable advisory locking
  -h, --help            Show this help message
  -v, --version         Show version

${color.bold('Environment Variables:')}
  DATABASE_URL          PostgreSQL connection string
  POSTGRESQL_URL        Alternative connection string
  POSTGRESQL_HOST       Host (default: localhost)
  POSTGRESQL_PORT       Port (default: 5432)
  POSTGRESQL_DATABASE   Database name
  POSTGRESQL_USER       Username
  POSTGRESQL_PASSWORD   Password
  PG_HOST / PG_PORT / PG_DATABASE / PG_USER / PG_PASSWORD   Alternative names

${color.bold('Examples:')}
  pg-migrate-runner up
  pg-migrate-runner up --dry-run
  pg-migrate-runner status
  pg-migrate-runner rollback 3
  pg-migrate-runner rollback --dry-run
  pg-migrate-runner create add_users_table
  pg-migrate-runner up --dir ./db/migrations --no-lock
`);
}

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface ParsedArgs {
    command: string;
    dryRun: boolean;
    dir?: string;
    table?: string;
    noLock: boolean;
    rest: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    const result: ParsedArgs = {
        command: '',
        dryRun: false,
        noLock: false,
        rest: []
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg === '--dry-run') {
            result.dryRun = true;
        } else if (arg === '--no-lock') {
            result.noLock = true;
        } else if (arg === '--dir' && i + 1 < args.length) {
            result.dir = args[++i];
        } else if (arg === '--table' && i + 1 < args.length) {
            result.table = args[++i];
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (arg === '--version' || arg === '-v') {
            console.log(getVersion());
            process.exit(0);
        } else if (!arg.startsWith('-')) {
            if (!result.command) {
                result.command = arg;
            } else {
                result.rest.push(arg);
            }
        } else {
            console.error(color.red(`Unknown option: ${arg}`));
            printHelp();
            process.exit(1);
        }

        i++;
    }

    return result;
}

function buildConfig(parsed: ParsedArgs): Partial<MigrationConfig> {
    const config: Partial<MigrationConfig> = {};
    if (parsed.dir) config.migrationsDir = parsed.dir;
    if (parsed.table) config.tableName = parsed.table;
    if (parsed.noLock) config.useLock = false;
    return config;
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdUp(parsed: ParsedArgs): Promise<void> {
    const config = buildConfig(parsed);
    const { runner, pool } = createMigrationRunner(config);

    try {
        if (parsed.dryRun) {
            console.log(color.cyan('Dry run — previewing pending migrations...'));
        } else {
            console.log(color.cyan('Checking for pending migrations...'));
        }

        const summary = await runner.migrate({ dryRun: parsed.dryRun });

        if (summary.total_pending === 0) {
            console.log(color.green('Database is up to date. No pending migrations.'));
            return;
        }

        const prefix = parsed.dryRun ? 'Would apply' : 'Applied';
        for (const result of summary.applied) {
            const timeStr = parsed.dryRun ? '' : color.gray(` (${result.execution_time_ms}ms)`);
            console.log(color.green(`  ${prefix}: ${result.version}_${result.name}`) + timeStr);
        }

        if (summary.failed) {
            console.error(color.red(`  Failed: ${summary.failed.version}_${summary.failed.name}`));
            console.error(color.red(`    Error: ${summary.failed.error}`));
            process.exitCode = 1;
            return;
        }

        if (parsed.dryRun) {
            console.log(
                color.cyan(
                    `\nDry run complete: ${summary.total_applied} migration(s) would be applied.`
                )
            );
        } else {
            console.log(
                color.greenBold(`\nApplied ${summary.total_applied} migration(s) successfully.`)
            );
        }
    } catch (error: any) {
        if (error instanceof MigrationLockError) {
            console.error(color.red('Another migration is already in progress.'));
            console.error(
                color.gray('Wait for it to finish or manually release the advisory lock.')
            );
            process.exitCode = 1;
            return;
        }
        throw error;
    } finally {
        await pool.end();
    }
}

async function cmdStatus(parsed: ParsedArgs): Promise<void> {
    const config = buildConfig(parsed);
    const { runner, pool } = createMigrationRunner(config);

    try {
        const status = await runner.getStatus();

        if (status.length === 0) {
            console.log(color.yellow('No migration files found.'));
            return;
        }

        console.log(`\n${color.bold('Migration Status')}\n`);

        console.log(
            'Version'.padEnd(16) +
                'Name'.padEnd(45) +
                'Status'.padEnd(12) +
                'Applied At'.padEnd(22) +
                'Time (ms)'
        );
        console.log('-'.repeat(105));

        for (const m of status) {
            const statusStr =
                m.status === 'applied'
                    ? m.checksumMismatch
                        ? color.yellow('MODIFIED')
                        : color.green('Applied')
                    : color.cyan('Pending');

            const appliedAt = m.applied_at
                ? new Date(m.applied_at).toISOString().replace('T', ' ').substring(0, 19)
                : '-';

            const time = m.execution_time_ms !== undefined ? String(m.execution_time_ms) : '-';

            console.log(
                m.version.padEnd(16) +
                    m.name.padEnd(45) +
                    statusStr.padEnd(22) +
                    appliedAt.padEnd(22) +
                    time
            );
        }

        const summary = await runner.getSummary();
        console.log(
            `\nTotal: ${summary.total} | Applied: ${summary.applied} | Pending: ${summary.pending}`
        );
    } finally {
        await pool.end();
    }
}

async function cmdRollback(parsed: ParsedArgs): Promise<void> {
    const count = parseInt(parsed.rest[0], 10) || 1;
    const config = buildConfig(parsed);
    const { runner, pool } = createMigrationRunner(config);

    try {
        if (count < 1) {
            console.error(color.red('Rollback count must be at least 1.'));
            process.exitCode = 1;
            return;
        }

        if (parsed.dryRun) {
            console.log(color.cyan(`Dry run — previewing rollback of ${count} migration(s)...`));
        } else {
            console.log(color.cyan(`Rolling back ${count} migration(s)...`));
        }

        const summary = await runner.rollback(count, { dryRun: parsed.dryRun });

        if (summary.total_rolled_back === 0 && !summary.failed) {
            console.log(color.yellow('No migrations to roll back.'));
            return;
        }

        const prefix = parsed.dryRun ? 'Would rollback' : 'Rolled back';
        for (const result of summary.rolledBack) {
            const timeStr = parsed.dryRun ? '' : color.gray(` (${result.execution_time_ms}ms)`);
            console.log(color.green(`  ${prefix}: ${result.version}_${result.name}`) + timeStr);
        }

        if (summary.failed) {
            console.error(color.red(`  Failed: ${summary.failed.version}_${summary.failed.name}`));
            console.error(color.red(`    Error: ${summary.failed.error}`));
            process.exitCode = 1;
            return;
        }

        if (parsed.dryRun) {
            console.log(
                color.cyan(
                    `\nDry run complete: ${summary.total_rolled_back} migration(s) would be rolled back.`
                )
            );
        } else {
            console.log(
                color.greenBold(
                    `\nRolled back ${summary.total_rolled_back} migration(s) successfully.`
                )
            );
        }
    } catch (error: any) {
        if (error instanceof MigrationLockError) {
            console.error(color.red('Another migration is already in progress.'));
            console.error(
                color.gray('Wait for it to finish or manually release the advisory lock.')
            );
            process.exitCode = 1;
            return;
        }
        throw error;
    } finally {
        await pool.end();
    }
}

function cmdCreate(parsed: ParsedArgs): void {
    const name = parsed.rest.join('_');
    if (!name) {
        console.error(color.red('Please provide a migration name.'));
        console.log(color.gray('  Example: pg-migrate-runner create add_users_table'));
        process.exitCode = 1;
        return;
    }

    const config = buildConfig(parsed);
    const { runner, pool } = createMigrationRunner(config);

    try {
        const result = runner.createMigrationFile(name);
        console.log(color.greenBold('\nCreated migration file:'));
        console.log(color.cyan(`  ${result.filename}`));
        console.log(color.gray(`  ${result.filepath}`));
        console.log(`\nEdit the file, then run ${color.bold('pg-migrate-runner up')} to apply.\n`);
    } catch (error: any) {
        console.error(color.red(error.message));
        process.exitCode = 1;
    } finally {
        pool.end();
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv);

    if (!parsed.command) {
        parsed.command = 'up';
    }

    switch (parsed.command) {
        case 'up':
            await cmdUp(parsed);
            break;

        case 'status':
            await cmdStatus(parsed);
            break;

        case 'rollback':
            await cmdRollback(parsed);
            break;

        case 'create':
            cmdCreate(parsed);
            break;

        default:
            console.error(color.red(`Unknown command: ${parsed.command}`));
            printHelp();
            process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(color.red(`Migration error: ${error.message}`));
    process.exitCode = 1;
});
