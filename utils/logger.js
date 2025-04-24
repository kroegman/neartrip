/**
 * Logging utility for NearTRIP application
 * Provides consistent, configurable logging throughout the application
 */
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFile = path.join(logsDir, 'application.log');

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Default to INFO in production, DEBUG in development
const currentLevel = process.env.NODE_ENV === 'production' 
  ? LOG_LEVELS.INFO 
  : LOG_LEVELS.DEBUG;

/**
 * Format log message with timestamp and level
 * @param {string} level - The log level
 * @param {string} message - The message to log
 * @returns {string} - Formatted log message
 */
function formatLogMessage(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] ${message}`;
}

/**
 * Write log message to file
 * @param {string} message - The formatted message to log
 */
function writeToFile(message) {
  fs.appendFileSync(logFile, message + '\n');
}

/**
 * Log an error message
 * @param {string} message - The message to log
 * @param {Error} [error] - Optional error object to include stack trace
 */
function error(message, error) {
  if (currentLevel >= LOG_LEVELS.ERROR) {
    const formattedMessage = formatLogMessage('ERROR', message);
    console.error(formattedMessage);
    writeToFile(formattedMessage);
    
    if (error && error.stack) {
      console.error(error.stack);
      writeToFile(error.stack);
    }
  }
}

/**
 * Log a warning message
 * @param {string} message - The message to log
 */
function warn(message) {
  if (currentLevel >= LOG_LEVELS.WARN) {
    const formattedMessage = formatLogMessage('WARN', message);
    console.warn(formattedMessage);
    writeToFile(formattedMessage);
  }
}

/**
 * Log an info message
 * @param {string} message - The message to log
 */
function info(message) {
  if (currentLevel >= LOG_LEVELS.INFO) {
    const formattedMessage = formatLogMessage('INFO', message);
    console.log(formattedMessage);
    writeToFile(formattedMessage);
  }
}

/**
 * Log a debug message
 * @param {string} message - The message to log
 */
function debug(message) {
  if (currentLevel >= LOG_LEVELS.DEBUG) {
    const formattedMessage = formatLogMessage('DEBUG', message);
    console.log(formattedMessage);
    writeToFile(formattedMessage);
  }
}

module.exports = {
  error,
  warn,
  info,
  debug
};
