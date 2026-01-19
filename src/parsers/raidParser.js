/**
 * Parser for Old School RuneScape Chambers of Xeric raid notifications
 */

/**
 * Parse a raid completion (points) notification
 * @param {string} message - The message content from webhook
 * @param {string} username - Username from webhook
 * @returns {Object|null} - Parsed raid data or null if not a valid points notification
 */
function parsePointsNotification(message, username = null) {
  try {
    // Pattern: "H y p e r r received a chat message:\nTotal points: 285,423, Personal points: 99,816 (34.97%)"
    const data = {
      timestamp: new Date().toISOString(),
      type: 'points',
      totalPoints: null,
      raidTime: null,
      players: [] // Array of {name, points}
    };

    // Extract player name from "PlayerName received a chat message:"
    // Message format: "H y p e r r received a chat message:\n\nTotal points: ..."
    let playerName = null;
    const playerNameMatch = message.match(/^(.+?)\s+received a chat message:/im);
    if (playerNameMatch) {
      playerName = playerNameMatch[1].trim();
    }

    // Extract total points - must match "Total points: X"
    const totalPointsMatch = message.match(/total\s*points:?\s*([\d,]+)/i);
    if (totalPointsMatch) {
      data.totalPoints = parseInt(totalPointsMatch[1].replace(/,/g, ''), 10);
    }

    // Extract personal points - must match "Personal points: X"
    const personalPointsMatch = message.match(/personal\s*points:?\s*([\d,]+)/i);
    if (personalPointsMatch) {
      const points = parseInt(personalPointsMatch[1].replace(/,/g, ''), 10);
      // Use player name from message if available, otherwise fall back to webhook username
      const name = playerName || username;
      if (name) {
        data.players.push({ name, points });
      }
    }

    // Check if we have at least total points to consider this valid
    if (data.totalPoints !== null) {
      return data;
    }

    return null;
  } catch (error) {
    console.error('Error parsing points notification:', error);
    return null;
  }
}

/**
 * Parse a duration/time notification
 * @param {string} message - The message content from webhook
 * @returns {Object|null} - Parsed duration data or null if not a valid duration notification
 */
function parseDurationNotification(message) {
  try {
    // Pattern: "Team size: 11-15 players Duration: 46:43.80 Personal Best 42.52.80 Olm Duration: 20.57.6"

    const data = {
      timestamp: new Date().toISOString(),
      type: 'duration',
      raidTime: null,
      scale: null
    };

    // Extract team size (scale) - match "Team size: X-Y players" or "Team size: X+ players"
    const teamSizeMatch = message.match(/Team size:\s*(\d+(?:-\d+|\+)?)\s*players?/i);
    if (teamSizeMatch) {
      data.scale = teamSizeMatch[1]; // e.g., "11-15" or "24+"
    }

    // Extract duration - match "Duration: XX:XX.XX" or "Duration: XX:XX"
    const durationMatch = message.match(/Duration:\s*([\d:]+(?:\.[\d]+)?)/i);
    if (durationMatch) {
      // Keep the full time string including milliseconds
      data.raidTime = durationMatch[1];
    }

    // Check if we found a duration
    if (data.raidTime !== null) {
      return data;
    }

    return null;
  } catch (error) {
    console.error('Error parsing duration notification:', error);
    return null;
  }
}

/**
 * Parse a loot notification
 * @param {string} message - The message content from webhook
 * @returns {Object|null} - Parsed loot data or null if not a valid loot notification
 */
function parseLootNotification(message) {
  try {
    // Common patterns for loot messages:
    // "H y p e r r - Dexterous prayer scroll"
    // "(username) - Twisted bow"
    // "Player1 received: Twisted bow (1,200,000,000 gp)"
    // "Loot: Dexterous prayer scroll - Player2"

    const data = {
      timestamp: new Date().toISOString(),
      type: 'loot',
      playerName: null,
      itemName: null,
      itemValue: null
    };

    // List of unique CoX items to help identify loot messages
    const coxUniques = [
      'twisted bow',
      'twisted buckler',
      'dragon hunter crossbow',
      'ancestral hat',
      'ancestral robe top',
      'ancestral robe bottom',
      'dragon claws',
      'elder maul',
      'kodai insignia',
      'dexterous prayer scroll',
      'arcane prayer scroll',
      'dinhs bulwark',
      "dinh's bulwark", // With apostrophe
      "dinhis bulwark"  // Alternative spelling
    ];

    // Remove backticks and other markdown formatting FIRST
    const cleanMessage = message.replace(/```/g, '').trim();
    const messageLower = cleanMessage.toLowerCase();

    // Check if message contains a CoX unique
    const containsUnique = coxUniques.some(item => messageLower.includes(item));

    if (!containsUnique) {
      return null; // Not a loot notification
    }

    // Split message into lines and look for the loot line
    const lines = cleanMessage.split('\n').map(line => line.trim()).filter(line => line);

    // Extract player name and item - try different patterns
    const lootPatterns = [
      // Pattern: "username - item name" (no parentheses)
      /^([A-Za-z0-9_\s]+?)\s*-\s*(.+?)$/i,
      // Pattern: "(username) - Twisted bow"
      /^\(([A-Za-z0-9_\s]+?)\)\s*-\s*(.+?)$/i,
      // Pattern: "Player1 received: Twisted bow"
      /([A-Za-z0-9_\s]+?)\s+(?:received|got|obtained):?\s+(.+?)(?:\(|worth|$)/i,
      // Pattern: "Loot: Twisted bow - Player2"
      /loot:?\s+(.+?)\s+-\s+([A-Za-z0-9_\s]+)/i,
      // Pattern: "Player1 has received Twisted bow"
      /([A-Za-z0-9_\s]+?)\s+(?:has\s+)?received?\s+(?:a\s+)?(.+?)(?:\s+worth|\s+\(|$)/i
    ];

    // Try each line
    for (const line of lines) {
      // Skip lines that are clearly not loot or empty lines
      if (!line ||
          line.includes('received a chat message') ||
          line.includes('Congratulations') ||
          line.includes('Total points') ||
          line.includes('Personal points') ||
          line.includes('Team size') ||
          line.includes('Duration') ||
          line.includes('collection log')) {
        continue;
      }

      for (const pattern of lootPatterns) {
        const match = line.match(pattern);
        if (match) {
          // First group is usually player, second is item (or vice versa depending on pattern)
          let player = match[1].trim();
          let item = match[2].trim();

          // Check which one is the item (contains a CoX unique)
          if (!coxUniques.some(unique => item.toLowerCase().includes(unique))) {
            // Swap if item doesn't contain a unique
            [player, item] = [item, player];
          }

          data.playerName = player;
          data.itemName = item;
          break;
        }
      }

      if (data.playerName && data.itemName) {
        break;
      }
    }

    // Extract item value
    const valuePatterns = [
      /\(?\s*([\d,]+)\s*(?:gp|coins?|gold)\s*\)?/i,
      /worth:?\s*([\d,]+)/i,
      /value:?\s*([\d,]+)/i
    ];

    for (const pattern of valuePatterns) {
      const match = message.match(pattern);
      if (match) {
        data.itemValue = parseInt(match[1].replace(/,/g, ''), 10);
        break;
      }
    }

    // Check if we have at least player and item
    if (data.playerName && data.itemName) {
      return data;
    }

    return null;
  } catch (error) {
    console.error('Error parsing loot notification:', error);
    return null;
  }
}

/**
 * Determine notification type and parse accordingly
 * @param {string} message - The message content from webhook
 * @param {string} username - Username from webhook
 * @returns {Object|null} - Parsed data or null if not recognized
 */
function parseRaidNotification(message, username = null) {
  // Try parsing as duration first (specific pattern)
  const durationData = parseDurationNotification(message);
  if (durationData) {
    return durationData;
  }

  // Try parsing as loot (more specific)
  const lootData = parseLootNotification(message);
  if (lootData) {
    return lootData;
  }

  // Try parsing as points notification
  const pointsData = parsePointsNotification(message, username);
  if (pointsData) {
    return pointsData;
  }

  return null;
}

module.exports = {
  parseRaidNotification,
  parsePointsNotification,
  parseDurationNotification,
  parseLootNotification
};
