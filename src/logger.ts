/**
 * pg-migrate-runner — Logger
 *
 * Provides a pluggable logger interface and a default console-based implementation.
 * Consumers can pass their own logger (e.g. winston, pino) via MigrationConfig.
 */

import { MigrationLogger } from './types';

// ─── Default Console Logger ─────────────────────────────────────────────────

/**
 * Default logger that writes to console with prefixed messages.
 */
export class DefaultLogger implements MigrationLogger {
    private prefix: string;

    constructor(prefix: string = '[migrate]') {
        this.prefix = prefix;
    }

    info(message: string, ...args: any[]): void {
        console.log(`${this.prefix} ${message}`, ...args);
    }

    warn(message: string, ...args: any[]): void {
        console.warn(`${this.prefix} ⚠️  ${message}`, ...args);
    }

    error(message: string, ...args: any[]): void {
        console.error(`${this.prefix} ❌ ${message}`, ...args);
    }

    debug(message: string, ...args: any[]): void {
        // Only log debug messages if DEBUG env var is set
        if (process.env.DEBUG) {
            console.log(`${this.prefix} [debug] ${message}`, ...args);
        }
    }
}

// ─── Silent Logger ──────────────────────────────────────────────────────────

/**
 * A logger that discards all output. Used when logger is set to `false`.
 */
export class SilentLogger implements MigrationLogger {
    info(_message: string, ..._args: any[]): void {}
    warn(_message: string, ..._args: any[]): void {}
    error(_message: string, ..._args: any[]): void {}
    debug(_message: string, ..._args: any[]): void {}
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create the appropriate logger based on config.
 * - `false` → SilentLogger (no output)
 * - `undefined` → DefaultLogger (console output)
 * - MigrationLogger instance → use as-is
 */
export function createLogger(logger?: MigrationLogger | false): MigrationLogger {
    if (logger === false) {
        return new SilentLogger();
    }
    if (logger) {
        return logger;
    }
    return new DefaultLogger();
}
