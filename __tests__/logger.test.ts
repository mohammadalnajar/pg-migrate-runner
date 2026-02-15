import { DefaultLogger, SilentLogger, createLogger } from '../src/logger';

// ─── DefaultLogger ──────────────────────────────────────────────────────────

describe('DefaultLogger', () => {
    let consoleSpy: { log: jest.SpyInstance; warn: jest.SpyInstance; error: jest.SpyInstance };

    beforeEach(() => {
        consoleSpy = {
            log: jest.spyOn(console, 'log').mockImplementation(),
            warn: jest.spyOn(console, 'warn').mockImplementation(),
            error: jest.spyOn(console, 'error').mockImplementation()
        };
    });

    afterEach(() => {
        consoleSpy.log.mockRestore();
        consoleSpy.warn.mockRestore();
        consoleSpy.error.mockRestore();
        delete process.env.DEBUG;
    });

    it('should log info messages to console.log', () => {
        const logger = new DefaultLogger();
        logger.info('test message');
        expect(consoleSpy.log).toHaveBeenCalledWith('[migrate] test message');
    });

    it('should log warn messages to console.warn', () => {
        const logger = new DefaultLogger();
        logger.warn('warning message');
        expect(consoleSpy.warn).toHaveBeenCalledWith(
            expect.stringContaining('warning message')
        );
    });

    it('should log error messages to console.error', () => {
        const logger = new DefaultLogger();
        logger.error('error message');
        expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('error message'));
    });

    it('should NOT log debug messages when DEBUG env is not set', () => {
        delete process.env.DEBUG;
        const logger = new DefaultLogger();
        logger.debug('debug message');
        expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should log debug messages when DEBUG env is set', () => {
        process.env.DEBUG = '1';
        const logger = new DefaultLogger();
        logger.debug('debug message');
        expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('debug message'));
    });

    it('should use custom prefix when provided', () => {
        const logger = new DefaultLogger('[custom]');
        logger.info('hello');
        expect(consoleSpy.log).toHaveBeenCalledWith('[custom] hello');
    });
});

// ─── SilentLogger ────────────────────────────────────────────────────────────

describe('SilentLogger', () => {
    it('should not call console methods', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();

        const logger = new SilentLogger();
        logger.info('info');
        logger.warn('warn');
        logger.error('error');
        logger.debug('debug');

        expect(logSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();

        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });
});

// ─── createLogger ────────────────────────────────────────────────────────────

describe('createLogger', () => {
    it('should return DefaultLogger when called with no args', () => {
        const logger = createLogger();
        expect(logger).toBeInstanceOf(DefaultLogger);
    });

    it('should return SilentLogger when called with false', () => {
        const logger = createLogger(false);
        expect(logger).toBeInstanceOf(SilentLogger);
    });

    it('should return the same logger instance when a custom logger is provided', () => {
        const custom = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        const logger = createLogger(custom);
        expect(logger).toBe(custom);
    });
});
