/**
 * Google Sheets integration for logging raid data
 */

const { google } = require('googleapis');
const config = require('../config');
const logger = require('../utils/logger');

let sheetsClient = null;
let lastRateLimitError = 0;
const RATE_LIMIT_COOLDOWN = 60000; // 1 minute cooldown after rate limit

// Track recent raids to match loot with completions
const recentRaids = [];
const MAX_RAID_HISTORY = 10;
const RAID_TIMEOUT = 300000; // 5 minutes

// Buffer for orphaned messages (duration/loot that arrive before points)
const orphanedMessages = {
  durations: [], // { timestamp, raidTime, scale, playerName }
  loots: []      // { timestamp, itemName, playerName }
};
const ORPHAN_TIMEOUT = 10000; // 10 seconds - orphans older than this are discarded

/**
 * Initialize Google Sheets API client
 */
async function initializeSheetsClient() {
  try {
    let auth;

    // Check if credentials is a JSON object (from environment variable) or a file path
    if (typeof config.google.credentials === 'object') {
      // Use credentials directly from JSON
      auth = new google.auth.GoogleAuth({
        credentials: config.google.credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      // Use credentials from file path
      auth = new google.auth.GoogleAuth({
        keyFile: config.google.credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }

    const authClient = await auth.getClient();
    sheetsClient = google.sheets({ version: 'v4', auth: authClient });

    logger.info('Google Sheets client initialized successfully');
    return sheetsClient;
  } catch (error) {
    logger.error('Failed to initialize Google Sheets client:', error);
    throw error;
  }
}

/**
 * Ensure the raids sheet exists with proper headers
 */
async function ensureSheetsExist() {
  try {
    if (!sheetsClient) {
      await initializeSheetsClient();
    }

    const spreadsheet = await sheetsClient.spreadsheets.get({
      spreadsheetId: config.google.sheetId,
    });

    const sheetNames = spreadsheet.data.sheets.map(sheet => sheet.properties.title);
    const sheetName = 'Raids';

    if (!sheetNames.includes(sheetName)) {
      logger.info(`Creating sheet: ${sheetName}`);
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId: config.google.sheetId,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
      });

      // Add headers
      await addHeaders(sheetName);
    }
  } catch (error) {
    logger.error('Error ensuring sheets exist:', error);
    throw error;
  }
}

// Maximum number of players to track per raid
const MAX_PLAYERS = 5;

// Minimum team size to log raids (filter out small scales)
const MIN_TEAM_SIZE = 10;

/**
 * Check if a scale meets the minimum team size requirement
 * @param {string} scale - Scale string like "11-15", "24+", "8-10", etc.
 * @returns {boolean} - True if scale is at least MIN_TEAM_SIZE
 */
function isScaleLargeEnough(scale) {
  if (!scale) return true; // If no scale info, allow it (we'll filter when scale is known)

  // Extract the first number from scale (e.g., "11" from "11-15", "24" from "24+")
  const match = scale.match(/^(\d+)/);
  if (!match) return true; // Can't parse, allow it

  const minPlayers = parseInt(match[1], 10);
  return minPlayers >= MIN_TEAM_SIZE;
}

/**
 * Add headers to the raids sheet
 */
async function addHeaders(sheetName) {
  const headers = [
    'Timestamp',
    'Total Points',
    'Completion Time',
    'Unique Drop'
  ];

  // Add player columns dynamically
  for (let i = 1; i <= MAX_PLAYERS; i++) {
    headers.push(`Player ${i} Name`);
    headers.push(`Player ${i} Points`);
  }

  try {
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      resource: {
        values: [headers],
      },
    });

    // Bold the headers, freeze first row, and add conditional formatting
    const sheetId = await getSheetId(sheetName);
    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId: config.google.sheetId,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: {
                    bold: true,
                  },
                },
              },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId: sheetId,
                gridProperties: {
                  frozenRowCount: 1,
                },
              },
              fields: 'gridProperties.frozenRowCount',
            },
          },
          {
            addConditionalFormatRule: {
              rule: {
                ranges: [
                  {
                    sheetId: sheetId,
                    startColumnIndex: 3, // Column D (Unique Item)
                    endColumnIndex: 4,
                    startRowIndex: 1, // Start after header
                  },
                ],
                booleanRule: {
                  condition: {
                    type: 'NOT_BLANK',
                  },
                  format: {
                    backgroundColor: {
                      red: 0.8,
                      green: 0.6,
                      blue: 0.9,
                    },
                  },
                },
              },
              index: 0,
            },
          },
        ],
      },
    });

    logger.info(`Added headers and conditional formatting to ${sheetName}`);
  } catch (error) {
    logger.error(`Error adding headers to ${sheetName}:`, error);
  }
}

/**
 * Get sheet ID by name
 */
async function getSheetId(sheetName) {
  const spreadsheet = await sheetsClient.spreadsheets.get({
    spreadsheetId: config.google.sheetId,
  });

  const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : null;
}

/**
 * Clean up old orphaned messages
 */
function cleanOrphans() {
  const now = Date.now();
  const cutoff = now - ORPHAN_TIMEOUT;

  // Clean old duration orphans
  orphanedMessages.durations = orphanedMessages.durations.filter(orphan => {
    const orphanTime = new Date(orphan.timestamp).getTime();
    return orphanTime >= cutoff;
  });

  // Clean old loot orphans
  orphanedMessages.loots = orphanedMessages.loots.filter(orphan => {
    const orphanTime = new Date(orphan.timestamp).getTime();
    return orphanTime >= cutoff;
  });
}

/**
 * Try to merge orphaned messages with a raid
 * Only merges orphans that are very recent (within 3 seconds of raid creation)
 * Prioritizes orphans from before the raid timestamp (arrived earlier)
 */
function mergeOrphansWithRaid(raid) {
  let merged = false;
  const raidTime = new Date(raid.timestamp).getTime();
  const MERGE_WINDOW = 3000; // Only merge orphans within 3 seconds of raid creation

  // Try to merge duration orphans (find closest one that arrived BEFORE this raid)
  if (!raid.completionTime && orphanedMessages.durations.length > 0) {
    // Find the orphan closest in time to this raid (within merge window)
    // Prefer orphans that arrived BEFORE the raid (negative time diff)
    let closestIndex = -1;
    let closestTimeDiff = Infinity;

    for (let i = 0; i < orphanedMessages.durations.length; i++) {
      const orphan = orphanedMessages.durations[i];
      const orphanTime = new Date(orphan.timestamp).getTime();
      const timeDiff = raidTime - orphanTime; // Positive if orphan came before raid

      // Only consider orphans that came BEFORE the raid (within window)
      if (timeDiff >= 0 && timeDiff <= MERGE_WINDOW && timeDiff < closestTimeDiff) {
        closestIndex = i;
        closestTimeDiff = timeDiff;
      }
    }

    if (closestIndex >= 0) {
      const durationOrphan = orphanedMessages.durations.splice(closestIndex, 1)[0];
      raid.completionTime = durationOrphan.raidTime;
      if (durationOrphan.scale) {
        raid.scale = durationOrphan.scale;
      }
      logger.info(`Merged orphaned duration ${durationOrphan.raidTime} (scale: ${durationOrphan.scale || 'unknown'}) with raid (orphan was ${closestTimeDiff}ms earlier)`);
      merged = true;
    }
  }

  // Try to merge ALL loot orphans that arrived BEFORE this raid (within merge window)
  if (orphanedMessages.loots.length > 0) {
    // Find all orphans within the merge window that came BEFORE the raid
    const matchingOrphans = [];

    for (let i = orphanedMessages.loots.length - 1; i >= 0; i--) {
      const orphan = orphanedMessages.loots[i];
      const orphanTime = new Date(orphan.timestamp).getTime();
      const timeDiff = raidTime - orphanTime; // Positive if orphan came before raid

      // Only consider orphans that came BEFORE the raid (within window)
      if (timeDiff >= 0 && timeDiff <= MERGE_WINDOW) {
        matchingOrphans.push({ index: i, orphan, timeDiff });
      }
    }

    // Process matching orphans (remove from array in reverse order to preserve indices)
    if (matchingOrphans.length > 0) {
      // Sort by time diff (closest first)
      matchingOrphans.sort((a, b) => a.timeDiff - b.timeDiff);

      for (const match of matchingOrphans) {
        const lootOrphan = match.orphan;
        const lootMessage = lootOrphan.playerName ? `(${lootOrphan.playerName}) - ${lootOrphan.itemName}` : lootOrphan.itemName;

        // Append to existing loot or set it
        if (raid.uniqueDrop) {
          raid.uniqueDrop = `${raid.uniqueDrop}, ${lootMessage}`;
        } else {
          raid.uniqueDrop = lootMessage;
        }
        logger.info(`Merged orphaned loot ${lootMessage} with raid (orphan was ${match.timeDiff}ms earlier)`);
        merged = true;
      }

      // Remove matched orphans from the array (in reverse index order)
      const indicesToRemove = matchingOrphans.map(m => m.index).sort((a, b) => b - a);
      for (const idx of indicesToRemove) {
        orphanedMessages.loots.splice(idx, 1);
      }
    }
  }

  return merged;
}

/**
 * Create a raid entry and store it in recent raids
 */
function createRaidEntry(data) {
  // Filter out players below the minimum points threshold (alts)
  const MIN_POINTS_THRESHOLD = 2000;
  const filteredPlayers = data.players
    .filter(p => p.points >= MIN_POINTS_THRESHOLD)
    .slice(0, MAX_PLAYERS); // Max players based on constant

  const raid = {
    timestamp: data.timestamp,
    totalPoints: data.totalPoints,
    completionTime: data.raidTime || '',
    scale: '', // Team size e.g., "11-15" or "24+"
    uniqueDrop: '', // Full loot message
    players: filteredPlayers,
    sheetRow: null,
    addedToSheet: false
  };

  // Add to recent raids buffer
  recentRaids.push(raid);

  // Keep only recent raids
  if (recentRaids.length > MAX_RAID_HISTORY) {
    recentRaids.shift();
  }

  // Clean up old raids
  const now = Date.now();
  const cutoff = now - RAID_TIMEOUT;
  while (recentRaids.length > 0) {
    const oldestRaid = recentRaids[0];
    const raidTime = new Date(oldestRaid.timestamp).getTime();
    if (raidTime < cutoff) {
      recentRaids.shift();
    } else {
      break;
    }
  }

  return raid;
}

/**
 * Find the most recent raid for a loot drop
 */
function findRaidForLoot(lootData) {
  const TIME_WINDOW = 60000; // 60 seconds - loot should come within 1 minute of raid completion
  const now = Date.now();

  // Look for a recent raid where the player participated (within time window)
  for (let i = recentRaids.length - 1; i >= 0; i--) {
    const raid = recentRaids[i];
    const raidTime = new Date(raid.timestamp).getTime();
    const timeDiff = now - raidTime;

    // Only consider raids within the time window AND where player participated
    if (timeDiff <= TIME_WINDOW) {
      const hasPlayer = raid.players.some(p => p.name === lootData.playerName);
      if (hasPlayer) {
        return raid;
      }
    }
  }

  // If no matching player within time window, return most recent raid (within time window)
  for (let i = recentRaids.length - 1; i >= 0; i--) {
    const raid = recentRaids[i];
    const raidTime = new Date(raid.timestamp).getTime();
    const timeDiff = now - raidTime;

    if (timeDiff <= TIME_WINDOW) {
      return raid;
    }
  }

  return null;
}

/**
 * Format timestamp to EST timezone with 12-hour format
 * e.g., "Jan 4, 10:29 PM"
 */
function formatTimestamp(isoTimestamp) {
  const date = new Date(isoTimestamp);
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Convert raid data to spreadsheet row format
 */
function raidToRow(raid) {
  const completionTime = raid.completionTime || '';

  // Format timestamp to EST with 12-hour format
  const formattedTimestamp = formatTimestamp(raid.timestamp);

  const row = [
    formattedTimestamp,
    raid.totalPoints || '',
    completionTime,
    raid.uniqueDrop || ''
  ];

  // Add up to MAX_PLAYERS players (name and points pairs)
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (i < raid.players.length) {
      row.push(raid.players[i].name || '');
      row.push(raid.players[i].points || '');
    } else {
      row.push('');
      row.push('');
    }
  }

  // Add scale (team size) in column O (index 14, after 4 base + 10 player columns)
  row.push(raid.scale || '');

  return row;
}

/**
 * Append a row to the sheet with retry logic
 */
async function appendRow(sheetName, row, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;

  try {
    // Check if we're in rate limit cooldown
    const now = Date.now();
    if (now - lastRateLimitError < RATE_LIMIT_COOLDOWN) {
      const waitTime = RATE_LIMIT_COOLDOWN - (now - lastRateLimitError);
      logger.warn(`In rate limit cooldown, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    if (!sheetsClient) {
      await initializeSheetsClient();
      await ensureSheetsExist();
    }

    const response = await sheetsClient.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'OVERWRITE',
      resource: {
        values: [row],
      },
    });

    logger.debug(`Appended row to ${sheetName}`);
    return response;
  } catch (error) {
    // Handle rate limiting
    if (error.code === 429 || error.message?.includes('rate limit')) {
      lastRateLimitError = Date.now();
      logger.warn(`Rate limit hit for ${sheetName}, attempt ${retryCount + 1}/${MAX_RETRIES}`);

      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY * Math.pow(2, retryCount);
        logger.info(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return appendRow(sheetName, row, retryCount + 1);
      } else {
        throw new Error(`Failed to append row after ${MAX_RETRIES} retries due to rate limiting`);
      }
    }

    // Handle authentication errors
    if (error.code === 401 || error.code === 403) {
      logger.error('Authentication error with Google Sheets API:', error.message);
      sheetsClient = null;

      if (retryCount < MAX_RETRIES) {
        logger.info('Re-initializing sheets client...');
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return appendRow(sheetName, row, retryCount + 1);
      }
    }

    throw error;
  }
}

/**
 * Update a specific row in the sheet
 */
async function updateRow(sheetName, rowNumber, row, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;

  try {
    const now = Date.now();
    if (now - lastRateLimitError < RATE_LIMIT_COOLDOWN) {
      const waitTime = RATE_LIMIT_COOLDOWN - (now - lastRateLimitError);
      logger.warn(`In rate limit cooldown, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    if (!sheetsClient) {
      await initializeSheetsClient();
      await ensureSheetsExist();
    }

    // Calculate the end column based on MAX_PLAYERS (4 base columns + 2 per player + 1 for scale)
    const endColumn = String.fromCharCode(65 + 3 + (MAX_PLAYERS * 2) + 1); // 65 is 'A', +3 for first 4 cols, +2 per player, +1 for scale

    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: config.google.sheetId,
      range: `${sheetName}!A${rowNumber}:${endColumn}${rowNumber}`,
      valueInputOption: 'RAW',
      resource: {
        values: [row],
      },
    });

    logger.debug(`Updated row ${rowNumber} in ${sheetName}`);
  } catch (error) {
    if (error.code === 429 || error.message?.includes('rate limit')) {
      lastRateLimitError = Date.now();
      logger.warn(`Rate limit hit for ${sheetName}, attempt ${retryCount + 1}/${MAX_RETRIES}`);

      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY * Math.pow(2, retryCount);
        logger.info(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return updateRow(sheetName, rowNumber, row, retryCount + 1);
      }
    }

    throw error;
  }
}


/**
 * Find existing raid by total points (within a time window)
 * If totalPoints is provided, search for match within tolerance (game can report slightly different totals)
 * If null, find most recent placeholder raid (raid without total points)
 */
function findRaidByTotalPoints(totalPoints) {
  const TIME_WINDOW = 120000; // 2 minutes in milliseconds
  const POINTS_TOLERANCE = 500; // Allow up to 500 points difference (game reports different totals to each player)
  const now = Date.now();

  // Look for a raid with matching total points within the time window (most recent first)
  for (let i = recentRaids.length - 1; i >= 0; i--) {
    const raid = recentRaids[i];
    const raidTime = new Date(raid.timestamp).getTime();
    const timeDiff = now - raidTime;

    // If we're looking for a specific total points value
    if (totalPoints !== null) {
      // Match if total points are within tolerance AND raid is within 2 minutes
      const pointsDiff = Math.abs(raid.totalPoints - totalPoints);
      if (pointsDiff <= POINTS_TOLERANCE && timeDiff <= TIME_WINDOW) {
        return raid;
      }
    } else {
      // Looking for a placeholder raid (no total points yet)
      if (raid.totalPoints === null && timeDiff <= TIME_WINDOW) {
        return raid;
      }
    }
  }
  return null;
}

/**
 * Handle raid completion data
 */
async function handleRaidCompletion(data) {
  const sheetName = 'Raids';

  // Prevent processing stale data (older than 5 minutes)
  // This guards against duplicate webhook messages or retries
  const dataAge = Date.now() - new Date(data.timestamp).getTime();
  const MAX_DATA_AGE = 300000; // 5 minutes
  if (dataAge > MAX_DATA_AGE) {
    logger.warn(`Ignoring stale raid data from ${data.timestamp} (${Math.round(dataAge / 1000)}s old)`);
    return null;
  }

  // Clean up old orphans
  cleanOrphans();

  // First check if a raid with this total points already exists
  let raid = findRaidByTotalPoints(data.totalPoints);

  // Minimum points threshold to filter out alts
  const MIN_POINTS_THRESHOLD = 2000;

  if (raid) {
    // Found existing raid with same total points
    // Update total points if it was a placeholder
    if (raid.totalPoints === null) {
      raid.totalPoints = data.totalPoints;
      logger.info(`Updating placeholder raid with total points: ${data.totalPoints}`);
    }

    // Add player to existing raid (if not already present and under limit)
    const newPlayer = data.players[0];

    // Skip players with less than minimum points (likely alts)
    if (newPlayer && newPlayer.points < MIN_POINTS_THRESHOLD) {
      logger.info(`Skipping player ${newPlayer.name} with ${newPlayer.points} points (below ${MIN_POINTS_THRESHOLD} threshold - likely an alt)`);
      return raid;
    }

    if (newPlayer && raid.players.length < MAX_PLAYERS) {
      const playerExists = raid.players.some(p => p.name === newPlayer.name);
      if (!playerExists) {
        raid.players.push(newPlayer);
        logger.info(`Adding player ${newPlayer.name} to existing raid (${raid.totalPoints} points)`);

        // Update the sheet row if it was already added
        if (raid.addedToSheet && raid.sheetRow) {
          const row = raidToRow(raid);
          await updateRow(sheetName, raid.sheetRow, row);
          logger.info(`Updated raid at row ${raid.sheetRow} with new player`);
        } else {
          // Raid not yet written to sheet - schedule a delayed update
          logger.info(`Raid not yet in sheet, scheduling delayed update for ${newPlayer.name}`);
          setTimeout(async () => {
            if (raid.addedToSheet && raid.sheetRow) {
              const row = raidToRow(raid);
              await updateRow(sheetName, raid.sheetRow, row);
              logger.info(`Delayed update: Updated raid at row ${raid.sheetRow} with player ${newPlayer.name}`);
            }
          }, 2000); // Wait 2 seconds for the initial append to complete
        }
      } else {
        logger.info(`Player ${newPlayer.name} already exists in raid (${raid.totalPoints} points)`);
      }
    } else if (raid.players.length >= MAX_PLAYERS) {
      logger.warn(`Raid already has ${MAX_PLAYERS} players, cannot add ${data.players[0]?.name}`);
    }
  } else {
    // No raid with matching points - check for placeholder raids (no total points yet)
    const placeholderRaid = findRaidByTotalPoints(null);

    if (placeholderRaid) {
      // Merge with placeholder raid
      logger.info(`Merging points data with placeholder raid`);
      raid = placeholderRaid;
      raid.totalPoints = data.totalPoints;

      // Add the new player (if above threshold)
      const newPlayer = data.players[0];
      if (newPlayer && newPlayer.points >= MIN_POINTS_THRESHOLD && raid.players.length < MAX_PLAYERS) {
        const playerExists = raid.players.some(p => p.name === newPlayer.name);
        if (!playerExists) {
          raid.players.push(newPlayer);
        }
      } else if (newPlayer && newPlayer.points < MIN_POINTS_THRESHOLD) {
        logger.info(`Skipping player ${newPlayer.name} with ${newPlayer.points} points (below threshold - likely an alt)`);
      }
    } else {
      // Create new raid entry
      raid = createRaidEntry(data);
      logger.info(`Creating new raid: ${raid.totalPoints} points, ${raid.players.length} player(s)`);

      // Try to merge any orphaned messages with this new raid
      const merged = mergeOrphansWithRaid(raid);
      if (merged) {
        logger.info('Merged orphaned messages with new raid');
      }
    }

    // Check if scale is large enough (at least MIN_TEAM_SIZE players)
    if (!isScaleLargeEnough(raid.scale)) {
      logger.info(`Skipping raid with scale ${raid.scale} (below ${MIN_TEAM_SIZE} player minimum)`);
      return raid;
    }

    // Add to sheet if it has total points (required field)
    if (raid.totalPoints !== null && !raid.addedToSheet) {
      const row = raidToRow(raid);
      const response = await appendRow(sheetName, row);

      // Extract row number from response
      if (response && response.data && response.data.updates) {
        const range = response.data.updates.updatedRange;
        const rowMatch = range.match(/!A(\d+)/);
        if (rowMatch) {
          raid.sheetRow = parseInt(rowMatch[1], 10);
          raid.addedToSheet = true;
          logger.debug(`Raid added to sheet at row ${raid.sheetRow}`);
        }
      }
    } else if (raid.addedToSheet && raid.sheetRow) {
      // Update existing row
      const row = raidToRow(raid);
      await updateRow(sheetName, raid.sheetRow, row);
      logger.info(`Updated raid at row ${raid.sheetRow} with merged data`);
    }
  }

  // Return the raid for potential chaining
  return raid;
}

/**
 * Handle duration/time update
 */
async function handleDurationUpdate(data) {
  const sheetName = 'Raids';
  const TIME_THRESHOLD = 60000; // 60 seconds - duration should come within 1 minute of raid completion

  // Clean up old orphans
  cleanOrphans();

  // Find the most recent raid WITHOUT a completion time
  let targetRaid = null;
  for (let i = recentRaids.length - 1; i >= 0; i--) {
    const raid = recentRaids[i];
    const now = Date.now();
    const raidTime = new Date(raid.timestamp).getTime();
    const timeDiff = now - raidTime;

    // Find first raid within time window that doesn't have a completion time yet
    if (timeDiff <= TIME_THRESHOLD && !raid.completionTime) {
      targetRaid = raid;
      break;
    }
  }

  if (targetRaid) {
    logger.info(`Updating raid${targetRaid.totalPoints ? ` (${targetRaid.totalPoints} points)` : ''} with duration: ${data.raidTime}, scale: ${data.scale || 'unknown'}`);

    // Update the raid entry with duration and scale
    targetRaid.completionTime = data.raidTime;
    if (data.scale) {
      targetRaid.scale = data.scale;
    }

    // If raid was already added to sheet, update it
    if (targetRaid.addedToSheet && targetRaid.sheetRow) {
      const row = raidToRow(targetRaid);
      await updateRow(sheetName, targetRaid.sheetRow, row);
      logger.info(`Updated raid at row ${targetRaid.sheetRow} with duration: ${data.raidTime}`);
    } else {
      // Raid hasn't been added yet, just update the entry (will be included when added)
      logger.debug(`Duration ${data.raidTime} will be included when raid is added to sheet`);
    }
  } else {
    // No raid found yet - add to orphan buffer
    logger.info(`No raid found for duration ${data.raidTime}, adding to orphan buffer`);
    orphanedMessages.durations.push({
      timestamp: data.timestamp,
      raidTime: data.raidTime,
      scale: data.scale || null,
      playerName: data.playerName || null
    });
  }
}

/**
 * Handle loot drop data
 */
async function handleLootDrop(data) {
  const sheetName = 'Raids';

  // Clean up old orphans
  cleanOrphans();

  let raid = findRaidForLoot(data);

  // Create the full loot message format: "(playerName) - itemName"
  const lootMessage = data.playerName ? `(${data.playerName}) - ${data.itemName}` : data.itemName;

  if (!raid) {
    // No raid found yet - add to orphan buffer
    logger.info(`No raid found for loot ${lootMessage}, adding to orphan buffer`);
    orphanedMessages.loots.push({
      timestamp: data.timestamp,
      itemName: data.itemName,
      playerName: data.playerName || null
    });
    return;
  }

  // Each player can only receive one purple per raid - skip if this player already has one
  if (raid.uniqueDrop && data.playerName) {
    if (raid.uniqueDrop.includes(`(${data.playerName})`)) {
      logger.debug(`Player ${data.playerName} already has a purple in this raid - skipping duplicate`);
      return;
    }
  }

  logger.info(`Matching loot ${data.itemName} to raid from ${raid.timestamp}`);

  // Append to existing loot if there's already a drop, otherwise set it
  if (raid.uniqueDrop) {
    raid.uniqueDrop = `${raid.uniqueDrop}, ${lootMessage}`;
    logger.info(`Added additional loot drop: ${lootMessage}`);
  } else {
    raid.uniqueDrop = lootMessage;
  }

  // If raid was already added to sheet, update it
  if (raid.addedToSheet && raid.sheetRow) {
    const row = raidToRow(raid);
    await updateRow(sheetName, raid.sheetRow, row);
    logger.info(`Updated raid at row ${raid.sheetRow} with loot: ${lootMessage}`);
  } else {
    // Raid hasn't been added yet, just update the entry (will be included when added)
    logger.debug(`Loot ${lootMessage} will be included when raid is added to sheet`);
  }
}

/**
 * Main function to handle parsed data
 */
async function appendToSheet(data) {
  try {
    if (data.type === 'points') {
      await handleRaidCompletion(data);
    } else if (data.type === 'duration') {
      await handleDurationUpdate(data);
    } else if (data.type === 'loot') {
      await handleLootDrop(data);
    } else {
      throw new Error(`Unknown data type: ${data.type}`);
    }
  } catch (error) {
    logger.error('Error appending to sheet:', error);
    throw error;
  }
}

// Initialize on module load
(async () => {
  try {
    await initializeSheetsClient();
    await ensureSheetsExist();
  } catch (error) {
    logger.error('Failed to initialize Google Sheets on startup:', error);
  }
})();

module.exports = {
  appendToSheet,
  initializeSheetsClient,
  ensureSheetsExist,
};
