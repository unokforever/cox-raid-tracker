/**
 * Simple logging utility with color support and log levels
 */

const config = require('../config');

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

class Logger {
  constructor() {
    this.level = LOG_LEVELS[config.logging.level] || LOG_LEVELS.info;
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    return { prefix, message, args };
  }

  shouldLog(level) {
    return LOG_LEVELS[level] >= this.level;
  }

  debug(message, ...args) {
    if (!this.shouldLog('debug')) return;

    const { prefix, message: msg, args: extraArgs } = this.formatMessage('debug', message, ...args);
    console.log(`${COLORS.dim}${prefix}${COLORS.reset} ${msg}`, ...extraArgs);
  }

  info(message, ...args) {
    if (!this.shouldLog('info')) return;

    const { prefix, message: msg, args: extraArgs } = this.formatMessage('info', message, ...args);
    console.log(`${COLORS.cyan}${prefix}${COLORS.reset} ${msg}`, ...extraArgs);
  }

  warn(message, ...args) {
    if (!this.shouldLog('warn')) return;

    const { prefix, message: msg, args: extraArgs } = this.formatMessage('warn', message, ...args);
    console.warn(`${COLORS.yellow}${prefix}${COLORS.reset} ${msg}`, ...extraArgs);
  }

  error(message, ...args) {
    if (!this.shouldLog('error')) return;

    const { prefix, message: msg, args: extraArgs } = this.formatMessage('error', message, ...args);
    console.error(`${COLORS.red}${prefix}${COLORS.reset} ${msg}`, ...extraArgs);
  }

  setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      this.level = LOG_LEVELS[level];
    }
  }
}

module.exports = new Logger();
