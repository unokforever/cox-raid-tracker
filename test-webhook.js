/**
 * Test script to simulate raid webhook messages using an actual webhook
 *
 * SETUP:
 * 1. Create a webhook in your Discord channel (Channel Settings → Integrations → Webhooks → New Webhook)
 * 2. Copy the webhook URL
 * 3. Add to your .env file: DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
 * 4. Run: node test-webhook.js
 */

const axios = require('axios');
require('dotenv').config();

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

if (!WEBHOOK_URL) {
  console.error('❌ Error: DISCORD_WEBHOOK_URL not found in .env file');
  console.log('\nSetup instructions:');
  console.log('1. Go to your Discord channel');
  console.log('2. Channel Settings → Integrations → Webhooks → New Webhook');
  console.log('3. Copy the webhook URL');
  console.log('4. Add to .env: DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...');
  process.exit(1);
}

// Sample raid data (total points = sum of all personal points)
const sampleRaid1 = {
  totalPoints: 291233, // Sum: 94987 + 94394 + 101852
  duration: '45:43.20',
  uniqueDrop: 'Twisted bow',
  uniqueRecipient: 'H y p e r r',
  players: [
    { name: 'H y p e r r', points: 94987 },
    { name: 'rg44 btw', points: 94394 },
    { name: 'dot o', points: 101852 }
  ]
};

const sampleRaid2 = {
  totalPoints: 212204, // Sum: 104951 + 107253
  duration: '52:10.80',
  uniqueDrop: 'Dexterous prayer scroll',
  uniqueRecipient: 'H y p e r r',
  players: [
    { name: 'dot o', points: 104951 },
    { name: 'H y p e r r', points: 107253 }
  ]
};

const sampleRaid3 = {
  totalPoints: 246575, // Sum: 101329 + 145246
  duration: '1:12:56.40',
  uniqueDrop: null,
  players: [
    { name: 'dot o', points: 101329 },
    { name: 'H y p e r r', points: 145246 }
  ]
};

async function sendWebhookMessage(username, content) {
  try {
    await axios.post(WEBHOOK_URL, {
      username: username,
      content: content
    });
    console.log(`✓ Sent from ${username}`);
    await delay(150); // Small delay between messages
  } catch (error) {
    console.error(`❌ Failed to send message: ${error.message}`);
  }
}

async function simulateRaid(raidData) {
  console.log(`\n📊 Simulating raid with ${raidData.totalPoints.toLocaleString()} total points...`);

  const pointsMessages = [];
  const durationMessages = [];
  const lootMessages = [];

  // Create messages for each player (points)
  for (const player of raidData.players) {
    const percentage = ((player.points / raidData.totalPoints) * 100).toFixed(2);
    pointsMessages.push({
      username: player.name,
      content: `${player.name} received a chat message:\n\n\`\`\`\nTotal points: ${raidData.totalPoints.toLocaleString()}, Personal points: ${player.points.toLocaleString()} (${percentage}%)\n\`\`\``
    });
  }

  // Create duration messages for each player
  for (const player of raidData.players) {
    durationMessages.push({
      username: player.name,
      content: `${player.name} received a chat message:\n\n\`\`\`\nCongratulations - your raid is complete!\nTeam size: 11-15 players Duration: ${raidData.duration} Personal best: 42:52.80\n\`\`\``
    });
  }

  // Create unique drop messages if applicable
  if (raidData.uniqueDrop && raidData.uniqueRecipient) {
    // Loot message from recipient's webhook
    lootMessages.push({
      username: raidData.uniqueRecipient,
      content: `${raidData.uniqueRecipient} received a chat message:\n\n\`\`\`\n${raidData.uniqueRecipient} - ${raidData.uniqueDrop}\n\`\`\``
    });

    // Duplicate loot message from another player's webhook
    const otherPlayer = raidData.players.find(p => p.name !== raidData.uniqueRecipient);
    if (otherPlayer) {
      lootMessages.push({
        username: otherPlayer.name,
        content: `${otherPlayer.name} received a chat message:\n\n\`\`\`\n${raidData.uniqueRecipient} - ${raidData.uniqueDrop}\n\`\`\``
      });
    }
  }

  // Shuffle within each message type to simulate concurrent webhooks
  pointsMessages.sort(() => Math.random() - 0.5);
  durationMessages.sort(() => Math.random() - 0.5);
  lootMessages.sort(() => Math.random() - 0.5);

  // Combine all messages - send points first (more realistic), then duration, then loot
  // All within 2-3 seconds total to simulate real production behavior
  const allMessages = [...pointsMessages, ...durationMessages, ...lootMessages];

  console.log(`Sending ${allMessages.length} messages in realistic order...`);

  // Send all messages rapidly (within ~2 seconds total)
  for (const msg of allMessages) {
    await sendWebhookMessage(msg.username, msg.content);
  }

  console.log(`✓ Raid simulation complete!`);
}

async function runTests() {
  console.log('🚀 Starting raid webhook simulator...\n');
  console.log(`Using webhook URL: ${WEBHOOK_URL.substring(0, 50)}...\n`);

  console.log('==========================================');
  console.log('SIMULATING RAIDS');
  console.log('==========================================');

  // Simulate raid 1 (with unique drop - Twisted bow)
  console.log('\n--- RAID 1: Twisted bow ---');
  await simulateRaid(sampleRaid1);
  console.log('Waiting 65 seconds before next raid (realistic production gap)...');
  await delay(65000); // Wait 65 seconds between raids (realistic - raids are many minutes apart)

  // Simulate raid 2 (with unique drop - Dexterous prayer scroll)
  console.log('\n--- RAID 2: Dexterous prayer scroll ---');
  await simulateRaid(sampleRaid2);
  console.log('Waiting 65 seconds before next raid (realistic production gap)...');
  await delay(65000); // Wait 65 seconds between raids (realistic - raids are many minutes apart)

  // Simulate raid 3 (no unique drop)
  console.log('\n--- RAID 3: No unique drop ---');
  await simulateRaid(sampleRaid3);

  console.log('\n==========================================');
  console.log('✓ ALL SIMULATIONS COMPLETE');
  console.log('==========================================');
  console.log('\nCheck your Google Sheet for 3 new raid entries!');
}

runTests().catch(error => {
  console.error('❌ Error running tests:', error);
  process.exit(1);
});
