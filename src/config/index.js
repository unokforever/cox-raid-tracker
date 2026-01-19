/**
 * Configuration loader with validation
 */

require('dotenv').config();
const path = require('path');

/**
 * Validate required environment variables
 */
function validateConfig() {
  const required = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_CHANNEL_ID',
    'GOOGLE_SHEET_ID',
  ];

  // Either GOOGLE_CREDENTIALS_PATH or GOOGLE_CREDENTIALS_JSON must be set
  const hasCredentialsPath = !!process.env.GOOGLE_CREDENTIALS_PATH;
  const hasCredentialsJson = !!process.env.GOOGLE_CREDENTIALS_JSON;

  if (!hasCredentialsPath && !hasCredentialsJson) {
    throw new Error('Either GOOGLE_CREDENTIALS_PATH or GOOGLE_CREDENTIALS_JSON must be set');
  }

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Get Google credentials - either from file path or JSON environment variable
 */
function getGoogleCredentials() {
  // If JSON is provided directly (for Railway/cloud deployment)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } catch (error) {
      throw new Error('Invalid JSON in GOOGLE_CREDENTIALS_JSON environment variable');
    }
  }

  // Otherwise use file path (for local development)
  const credentialsPath = path.resolve(process.cwd(), process.env.GOOGLE_CREDENTIALS_PATH);
  return credentialsPath;
}

/**
 * Load and validate configuration
 */
function loadConfig() {
  validateConfig();

  const googleCredentials = getGoogleCredentials();

  return {
    discord: {
      token: process.env.DISCORD_BOT_TOKEN,
      channelId: process.env.DISCORD_CHANNEL_ID,
    },
    google: {
      sheetId: process.env.GOOGLE_SHEET_ID,
      // Can be either a file path (string) or parsed JSON object
      credentials: googleCredentials,
      serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
    },
  };
}

let config;

try {
  config = loadConfig();
} catch (error) {
  console.error('Configuration error:', error.message);
  console.error('Please check your .env file and ensure all required variables are set.');
  console.error('See .env.example for reference.');
  process.exit(1);
}

module.exports = config;
