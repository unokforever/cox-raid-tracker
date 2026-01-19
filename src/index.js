/**
 * Discord bot for tracking Old School RuneScape Chambers of Xeric raid data
 */

const { Client, GatewayIntentBits } = require('discord.js');
const { parseRaidNotification } = require('./parsers/raidParser');
const { appendToSheet } = require('./services/googleSheets');
const config = require('./config');
const logger = require('./utils/logger');

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Track reconnection attempts
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000;

// Message queue to handle concurrent messages sequentially
const messageQueue = [];
let isProcessingQueue = false;

async function processMessageQueue() {
  if (isProcessingQueue || messageQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;

  while (messageQueue.length > 0) {
    const { message, resolve, reject } = messageQueue.shift();
    try {
      await processMessage(message);
      resolve();
    } catch (error) {
      reject(error);
    }
  }

  isProcessingQueue = false;
}

function queueMessage(message) {
  return new Promise((resolve, reject) => {
    messageQueue.push({ message, resolve, reject });
    processMessageQueue();
  });
}

// Bot ready event
client.once('ready', () => {
  logger.info(`Logged in as ${client.user.tag}`);
  logger.info(`Monitoring channel ID: ${config.discord.channelId}`);
  logger.info('Bot is ready and listening for raid notifications!');
  logger.info('---');
  reconnectAttempts = 0;

  // Log heartbeat every 5 minutes to show bot is alive
  setInterval(() => {
    logger.info('💓 Bot is active and monitoring...');
  }, 5 * 60 * 1000);
});

// Process a single message
async function processMessage(message) {
  // Ignore messages from self
  if (message.author.id === client.user.id) {
    return;
  }

  // Only process messages from the configured channel
  if (message.channel.id !== config.discord.channelId) {
    return;
  }

  // Ignore old messages (more than 5 minutes old)
  // This prevents duplicate processing if Discord replays messages on reconnect
  const messageAge = Date.now() - message.createdTimestamp;
  const MAX_MESSAGE_AGE = 300000; // 5 minutes
  if (messageAge > MAX_MESSAGE_AGE) {
    logger.warn(`Ignoring old message from ${message.author.username} (${Math.round(messageAge / 1000)}s old)`);
    return;
  }

  const isWebhook = message.webhookId !== null;
  const username = message.author.username;

  // Collect all content sources (regular content + all embeds)
  const contentSources = [];

  if (message.content) {
    contentSources.push(message.content);
  }

  // Check all embeds for content
  if (message.embeds && message.embeds.length > 0) {
    for (const embed of message.embeds) {
      if (embed.description) {
        contentSources.push(embed.description);
      }
    }
  }

  // Skip if no content found
  if (contentSources.length === 0) {
    return;
  }

  // Process each content source
  for (const content of contentSources) {
    logger.info('---');
    logger.info(`📨 New message from ${isWebhook ? 'webhook' : 'user'}: ${username}`);
    logger.info(`📝 Content: "${content}"`);

    const parsedData = parseRaidNotification(content, username);

    if (!parsedData) {
      logger.warn('⚠️  Message did not match any raid notification patterns');
      continue;
    }

    logger.info(`✅ Parsed ${parsedData.type} notification:`, parsedData);

    // Log to Google Sheets
    await appendToSheet(parsedData);
    logger.info(`💾 Successfully logged ${parsedData.type} data to spreadsheet`);
  }
}

// Message handler - queues messages for sequential processing
client.on('messageCreate', async (message) => {
  try {
    // Debug logging - log ALL messages the bot sees
    logger.debug(`📬 Message received - Channel: ${message.channel.id}, Author: ${message.author.username} (ID: ${message.author.id}), Bot ID: ${client.user.id}`);

    await queueMessage(message);
  } catch (error) {
    logger.error('❌ Error processing message:', error);
    // Continue running despite errors
  }
});

// Error handling
client.on('error', (error) => {
  logger.error('Discord client error:', error);
});

// Handle disconnection
client.on('shardDisconnect', () => {
  logger.warn('Disconnected from Discord');
  attemptReconnect();
});

// Handle rate limits
client.on('rateLimit', (rateLimitInfo) => {
  logger.warn('Rate limit hit:', {
    timeout: rateLimitInfo.timeout,
    limit: rateLimitInfo.limit,
    method: rateLimitInfo.method,
    path: rateLimitInfo.path,
  });
});

// Reconnection logic
function attemptReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts. Exiting.`);
    process.exit(1);
  }

  reconnectAttempts++;
  logger.info(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

  setTimeout(() => {
    client.login(config.discord.token).catch((error) => {
      logger.error('Reconnection failed:', error);
      attemptReconnect();
    });
  }, RECONNECT_DELAY * reconnectAttempts);
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

// Unhandled rejection handler
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection:', error);
});

// Start the bot
logger.info('Starting OSRS CoX Tracker bot...');
client.login(config.discord.token).catch((error) => {
  logger.error('Failed to login:', error);
  process.exit(1);
});
