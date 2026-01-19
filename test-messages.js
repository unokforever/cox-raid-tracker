/**
 * Test script to simulate raid webhook messages
 * Run with: node test-messages.js
 */

const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Sample raid data
const sampleRaid1 = {
  totalPoints: 285717,
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
  totalPoints: 247144,
  duration: '52:10.80',
  uniqueDrop: 'Dexterous prayer scroll',
  uniqueRecipient: 'H y p e r r',
  players: [
    { name: 'dot o', points: 104951 },
    { name: 'H y p e r r', points: 107253 }
  ]
};

const sampleRaid3 = {
  totalPoints: 246575,
  duration: '1:12:56.40',
  uniqueDrop: null, // No unique drop
  players: [
    { name: 'dot o', points: 101329 },
    { name: 'H y p e r r', points: 145246 }
  ]
};

async function sendMessage(channel, content) {
  await channel.send(content);
  console.log(`✓ Sent: ${content.substring(0, 50)}...`);
  await delay(100); // Small delay between messages
}

async function simulateRaid(channel, raidData) {
  console.log(`\n📊 Simulating raid with ${raidData.totalPoints} total points...`);

  const messages = [];

  // Create messages for each player (points)
  for (const player of raidData.players) {
    messages.push({
      type: 'points',
      player: player.name,
      content: `${player.name} received a chat message:\n\n\`\`\`\nTotal points: ${raidData.totalPoints.toLocaleString()}, Personal points: ${player.points.toLocaleString()} (${((player.points / raidData.totalPoints) * 100).toFixed(2)}%)\n\`\`\``
    });
  }

  // Create duration messages for each player
  for (const player of raidData.players) {
    messages.push({
      type: 'duration',
      player: player.name,
      content: `${player.name} received a chat message:\n\n\`\`\`\nCongratulations - your raid is complete!\nTeam size: 11-15 players Duration: ${raidData.duration} Personal best: 42:52.80\n\`\`\``
    });
  }

  // Create unique drop messages if applicable
  if (raidData.uniqueDrop && raidData.uniqueRecipient) {
    // Multiple webhooks might post the same loot
    messages.push({
      type: 'loot',
      player: raidData.uniqueRecipient,
      content: `${raidData.uniqueRecipient} received a chat message:\n\n\`\`\`\n${raidData.uniqueRecipient} - ${raidData.uniqueDrop}\n\`\`\``
    });

    // Simulate duplicate from another player's webhook
    const otherPlayer = raidData.players.find(p => p.name !== raidData.uniqueRecipient);
    if (otherPlayer) {
      messages.push({
        type: 'loot',
        player: otherPlayer.name,
        content: `${otherPlayer.name} received a chat message:\n\n\`\`\`\n${raidData.uniqueRecipient} - ${raidData.uniqueDrop}\n\`\`\``
      });
    }
  }

  // Shuffle messages to simulate real concurrent arrival
  messages.sort(() => Math.random() - 0.5);

  console.log(`Sending ${messages.length} messages...`);

  // Send all messages rapidly (simulating concurrent arrival)
  for (const msg of messages) {
    await sendMessage(channel, msg.content);
  }

  console.log(`✓ Raid simulation complete!\n`);
}

async function runTests() {
  console.log('🚀 Starting raid message simulator...\n');
  console.log(`Target channel ID: ${CHANNEL_ID}\n`);

  const channel = await client.channels.fetch(CHANNEL_ID);

  if (!channel) {
    console.error('❌ Could not find channel!');
    return;
  }

  console.log(`✓ Connected to channel: ${channel.name}\n`);

  // Wait a moment before starting
  await delay(2000);

  console.log('==========================================');
  console.log('SIMULATING RAIDS');
  console.log('==========================================');

  // Simulate raid 1 (with unique drop)
  await simulateRaid(channel, sampleRaid1);
  await delay(3000); // Wait between raids

  // Simulate raid 2 (with unique drop)
  await simulateRaid(channel, sampleRaid2);
  await delay(3000); // Wait between raids

  // Simulate raid 3 (no unique drop)
  await simulateRaid(channel, sampleRaid3);

  console.log('\n==========================================');
  console.log('✓ ALL SIMULATIONS COMPLETE');
  console.log('==========================================');
  console.log('\nCheck your Google Sheet for results!');

  await delay(2000);
  process.exit(0);
}

client.once('ready', () => {
  console.log(`✓ Logged in as ${client.user.tag}\n`);
  runTests().catch(error => {
    console.error('❌ Error running tests:', error);
    process.exit(1);
  });
});

client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
  console.error('❌ Failed to login:', error);
  process.exit(1);
});
