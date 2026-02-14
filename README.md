# pg-migrate-runner [![npm version](https://img.shields.io/npm/v/pg-migrate-runner.svg)](https://www.npmjs.com/package/pg-migrate-runner)

A lightweight, zero-dependency PostgreSQL migration runner for Node.js.

Uses `pg` as the only peer dependency — bring your own PostgreSQL client.

## Features

- **UP/DOWN migration files** with automatic transaction wrapping
- **SHA-256 checksum verification** — detects modified migrations
- **Advisory locking** — prevents concurrent migration execution across instances
- **Dry-run mode** — preview changes without modifying the database
- **Pluggable logger** — use console, winston, pino, or any custom logger
- **SQL anti-pattern validation** — warns about missing IF NOT EXISTS, destructive ops, etc.
- **Config-driven or legacy constructor** — flexible initialization
- **CLI binary** (`pg-migrate-runner`) — run migrations from the command line
- **TypeScript-first** — full type definitions included

## Installation

```bash
npm install pg-migrate-runner pg
```

> `pg` is a peer dependency — install it alongside this package.

## Quick Start

### Programmatic API

```typescript
import { createMigrationRunner } from 'pg-migrate-runner';

// Create runner from environment variables
const { runner, pool } = createMigrationRunner({
    migrationsDir: './migrations',
    useLock: true
});

// Apply all pending migrations
const summary = await runner.migrate();
console.log(`Applied ${summary.total_applied} migration(s)`);

// Don't forget to close the pool
await pool.end();
```

### With an Existing Pool

```typescript
import { Pool } from 'pg';
import { MigrationRunner } from 'pg-migrate-runner';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const runner = new MigrationRunner({
    pool,
    migrationsDir: './migrations',
    useLock: true,
    tableName: 'schema_migrations'
});

await runner.migrate();
await pool.end();
```

### CLI

```bash
# Apply all pending migrations
pg-migrate-runner up

# Preview what would happen (dry run)
pg-migrate-runner up --dry-run

# Show migration status
pg-migrate-runner status

# Rollback last migration
pg-migrate-runner rollback

# Rollback last 3 migrations
pg-migrate-runner rollback 3

# Create a new migration file
pg-migrate-runner create add_users_table

# Custom migrations directory
pg-migrate-runner up --dir ./db/migrations

# Disable advisory locking
pg-migrate-runner up --no-lock
```

### Usage in npm Scripts

The CLI reads database config from environment variables (see [Environment Variables](#environment-variables)).
It does **not** load `.env` files automatically — this is by design to keep the package dependency-free.

#### When env vars are already set (Docker, CI/CD, production)

The CLI works directly — no extra setup needed:

```json
{
  "scripts": {
    "migrate": "pg-migrate-runner up",
    "migrate:status": "pg-migrate-runner status",
    "migrate:rollback": "pg-migrate-runner rollback",
    "migrate:create": "pg-migrate-runner create"
  }
}
```

Docker Compose example:
```yaml
services:
  app:
    environment:
      POSTGRESQL_HOST: postgres
      POSTGRESQL_DATABASE: mydb
      POSTGRESQL_USER: myuser
      POSTGRESQL_PASSWORD: mypass
    command: ["pg-migrate-runner", "up"]
```

#### When using a `.env` file (local development)

Use `node -r dotenv/config` to preload the `.env` file before the CLI runs.

> **Important:** When using `node -r`, you must provide the full path to the binary
> (`./node_modules/.bin/pg-migrate-runner`), because Node interprets the argument
> as a module path, not a shell command.

```json
{
  "scripts": {
    "migrate": "node -r dotenv/config ./node_modules/.bin/pg-migrate-runner up",
    "migrate:status": "node -r dotenv/config ./node_modules/.bin/pg-migrate-runner status",
    "migrate:rollback": "node -r dotenv/config ./node_modules/.bin/pg-migrate-runner rollback",
    "migrate:create": "node -r dotenv/config ./node_modules/.bin/pg-migrate-runner create"
  }
}
```

Make sure `dotenv` is installed:
```bash
npm install --save-dev dotenv
```

## Migration File Format

Migration files use a simple SQL format with `-- migrate:up` and `-- migrate:down` markers:

```sql
-- migrate:up
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- migrate:down
DROP INDEX IF EXISTS idx_users_email;
DROP TABLE IF EXISTS users;
```

### File Naming

Migration files must follow the pattern: `YYYYMMDDHHMMSS_snake_case_name.sql`

Example: `20240115143000_create_users_table.sql`

Use `pg-migrate-runner create <name>` to generate files with the correct naming and a helpful template.

## API Reference

### `createMigrationRunner(config?)`

Factory function that creates a `MigrationRunner` with a fresh `Pool` from environment variables.

```typescript
const { runner, pool } = createMigrationRunner({
    migrationsDir: './migrations',  // default: ./models/migrations
    tableName: 'schema_migrations', // default: schema_migrations
    useLock: true,                  // default: true
    lockId: 741953,                 // default: 741953
    logger: false                   // false = silent, undefined = console
});

// IMPORTANT: caller must close the pool
await pool.end();
```

### `new MigrationRunner(config)`

Config-driven constructor for full control.

```typescript
const runner = new MigrationRunner({
    pool,                           // required: pg Pool instance
    migrationsDir: './migrations',
    tableName: 'schema_migrations',
    useLock: true,
    lockId: 741953,
    logger: myCustomLogger          // or false for silent
});
```

### `runner.migrate(options?)`

Apply all pending migrations. Returns a `MigrationRunSummary`.

```typescript
// Normal run
const summary = await runner.migrate();

// Dry run — preview without executing
const preview = await runner.migrate({ dryRun: true });

// Summary shape
interface MigrationRunSummary {
    applied: MigrationResult[];
    failed: MigrationResult | null;
    total_pending: number;
    total_applied: number;
    dryRun: boolean;
}
```

### `runner.rollback(count?, options?)`

Rollback the last N applied migrations. Returns a `MigrationRollbackSummary`.

```typescript
// Rollback last migration
const summary = await runner.rollback();

// Rollback last 3
const summary = await runner.rollback(3);

// Dry run
const preview = await runner.rollback(1, { dryRun: true });
```

### `runner.getStatus()`

Get status of all migrations (applied + pending).

```typescript
const status = await runner.getStatus();
// Returns MigrationStatus[]
// Each has: version, name, filename, status ('applied' | 'pending'),
//           applied_at?, execution_time_ms?, checksum?, checksumMismatch?
```

### `runner.getSummary()`

Quick summary counts.

```typescript
const { applied, pending, total } = await runner.getSummary();
```

### `runner.createMigrationFile(name)`

Create a new migration file with a timestamp version.

```typescript
const { filepath, filename, version } = runner.createMigrationFile('add_users_table');
// Creates: 20240115143000_add_users_table.sql
```

### `runner.hasPendingMigrations()`

Check if there are any pending migrations.

```typescript
if (await runner.hasPendingMigrations()) {
    console.log('Database needs updating');
}
```

### `validateMigrationSQL(upSql, downSql, name?)`

Validate migration SQL for common anti-patterns.

```typescript
import { validateMigrationSQL } from 'pg-migrate-runner';

const warnings = validateMigrationSQL(upSql, downSql, 'create_users');
for (const w of warnings) {
    console.log(`[${w.level}] ${w.message}`);
}
```

Checks for:
- CREATE TABLE/INDEX without IF NOT EXISTS
- DROP TABLE/INDEX without IF EXISTS
- Destructive operations (DROP COLUMN, TRUNCATE, DELETE without WHERE)
- Manual transaction control (BEGIN/COMMIT/ROLLBACK)
- ALTER TYPE ... ADD VALUE (cannot run in a transaction)

## Error Handling

The package exports typed error classes for precise error handling:

```typescript
import {
    MigrationError,        // Base error class
    MigrationLockError,    // Advisory lock contention (→ 409 Conflict)
    ChecksumMismatchError, // Migration file modified after being applied
    MigrationParseError,   // Invalid migration file format
    MigrationRollbackError,// Rollback not possible (no DOWN section)
    MigrationFileNotFoundError // Migration file missing from disk
} from 'pg-migrate-runner';

try {
    await runner.migrate();
} catch (error) {
    if (error instanceof MigrationLockError) {
        // Another migration is in progress
        console.error('Lock contention — retry later');
    } else if (error instanceof ChecksumMismatchError) {
        // A migration file was modified after being applied
        console.error(`Checksum mismatch: expected ${error.expected}, got ${error.actual}`);
    }
}
```

## Custom Logger

Implement the `MigrationLogger` interface to use any logger:

```typescript
import { MigrationLogger, MigrationRunner } from 'pg-migrate-runner';

const myLogger: MigrationLogger = {
    info: (msg, ...args) => winston.info(msg, ...args),
    warn: (msg, ...args) => winston.warn(msg, ...args),
    error: (msg, ...args) => winston.error(msg, ...args),
    debug: (msg, ...args) => winston.debug(msg, ...args)
};

const runner = new MigrationRunner({
    pool,
    logger: myLogger
});
```

Pass `logger: false` to disable all logging.

## Environment Variables

The `createMigrationRunner()` factory detects connection info from environment variables:

| Variable                              | Description                   |
| ------------------------------------- | ----------------------------- |
| `DATABASE_URL`                        | PostgreSQL connection string  |
| `POSTGRESQL_URL`                      | Alternative connection string |
| `POSTGRESQL_HOST` / `PG_HOST`         | Host (default: `localhost`)   |
| `POSTGRESQL_PORT` / `PG_PORT`         | Port (default: `5432`)        |
| `POSTGRESQL_DATABASE` / `PG_DATABASE` | Database name                 |
| `POSTGRESQL_USER` / `PG_USER`         | Username                      |
| `POSTGRESQL_PASSWORD` / `PG_PASSWORD` | Password                      |

SSL is auto-enabled in production (`NODE_ENV=production`) unless connecting to a Docker container (host = `postgres`).

## Advisory Locking

When `useLock: true` (default for config-driven constructor), the runner acquires a PostgreSQL advisory lock before running migrations. This prevents race conditions when multiple instances start simultaneously (e.g., Docker containers, serverless functions).

```typescript
// Enabled by default
const runner = new MigrationRunner({ pool, useLock: true });

// Disable if you handle concurrency yourself
const runner = new MigrationRunner({ pool, useLock: false });
```

The lock ID defaults to `741953` but can be customized via `lockId` config.

## License

MIT
