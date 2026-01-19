# OSRS Chambers of Xeric Tracker

A Discord bot that automatically tracks Old School RuneScape Chambers of Xeric raid completions and loot drops from webhook notifications and logs them to Google Sheets.

## Features

- Monitors Discord channel for raid notifications from webhooks
- Parses raid completion data (total points, individual player points, raid time)
- Parses loot drop notifications and correlates them with raids
- Logs each raid as a single row with all data (completion + loot + up to 3 players)
- Automatically matches loot drops to the most recent raid
- Handles API rate limits gracefully with retry logic
- Automatic reconnection on disconnect
- Comprehensive error handling and logging

## Prerequisites

- Node.js 16 or higher
- A Discord bot token
- A Google Cloud service account with Sheets API access
- A Google Spreadsheet

## Setup

### 1. Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section and click "Add Bot"
4. Under "Privileged Gateway Intents", enable:
   - Message Content Intent
5. Copy your bot token (you'll need this later)
6. Go to "OAuth2" > "URL Generator"
7. Select scopes: `bot`
8. Select bot permissions: `Read Messages/View Channels`, `Send Messages`, `Read Message History`
9. Copy the generated URL and open it in your browser to invite the bot to your server
10. Get your channel ID:
   - Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
   - Right-click the channel where raid notifications are posted
   - Click "Copy Channel ID"

### 2. Google Sheets Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Sheets API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"
4. Create a service account:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Fill in the details and click "Create"
   - Skip the optional steps and click "Done"
5. Create a key for the service account:
   - Click on the service account you just created
   - Go to "Keys" tab
   - Click "Add Key" > "Create New Key"
   - Choose JSON format
   - Save the downloaded file as `google-credentials.json`
6. Create a new Google Spreadsheet:
   - Go to [Google Sheets](https://sheets.google.com)
   - Create a new spreadsheet
   - Share it with your service account email (found in the JSON file)
   - Give it "Editor" access
   - Copy the spreadsheet ID from the URL (the long string between `/d/` and `/edit`)

### 3. Project Setup

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `credentials` folder in the project root:
   ```bash
   mkdir credentials
   ```

4. Move your `google-credentials.json` file to the `credentials` folder

5. Create a `.env` file in the project root by copying `.env.example`:
   ```bash
   cp .env.example .env
   ```

6. Edit `.env` and fill in your configuration:
   ```env
   DISCORD_BOT_TOKEN=your_discord_bot_token_here
   DISCORD_CHANNEL_ID=your_channel_id_here
   GOOGLE_SHEET_ID=your_google_sheet_id_here
   GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account_email@project.iam.gserviceaccount.com
   GOOGLE_CREDENTIALS_PATH=./credentials/google-credentials.json
   ```

### 4. Running the Bot

Start the bot:
```bash
npm start
```

For development with auto-restart on file changes:
```bash
npm run dev
```

## Usage

Once the bot is running, it will automatically:

1. Monitor the configured Discord channel
2. Parse raid completion and loot drop messages
3. Log each raid as a single row in the "Raids" sheet with the following columns:
   - **Timestamp**: When the raid was completed
   - **Total Points**: Total raid points
   - **Completion Time**: Raid duration (e.g., "25:30")
   - **Unique Item**: Name of unique drop (if any, added when loot message is posted)
   - **Player 1-3 Names & Points**: Up to 3 players with their individual points

### How Raid Tracking Works

1. **Raid Completion**: When a raid completion message is posted, a new row is added to the sheet
2. **Loot Drops**: When a loot drop message is posted (within 5 minutes), the bot:
   - Finds the most recent raid where that player participated
   - Updates the raid row to include the unique item
3. **Player Matching**: The bot extracts player names and points from webhook usernames and message content

### Supported Message Formats

The bot can parse various message formats. Here are some examples:

**Raid Completions:**
- "Congratulations - your raid is complete! Total points: 30,000 (6,000 personal)"
- "Raid complete! Total: 25,000 points | Personal: 5,000 | Time: 25:30"
- "Total points: 18,500 | Personal: 4,200 | Time: 32:15"

**Loot Drops:**
- "Player1 received: Twisted bow (1,200,000,000 gp)"
- "Loot: Dexterous prayer scroll - Player2"
- "Player3 got Dragon claws worth 50,000,000"

**Note**: The bot uses the webhook username to identify which player completed the raid. Make sure your webhooks are set up with player-specific usernames.

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_BOT_TOKEN` | Your Discord bot token | Yes |
| `DISCORD_CHANNEL_ID` | Channel ID to monitor | Yes |
| `GOOGLE_SHEET_ID` | Google Spreadsheet ID | Yes |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email | Yes |
| `GOOGLE_CREDENTIALS_PATH` | Path to credentials JSON | Yes |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | No (default: info) |

### Logging Levels

- `debug`: Verbose logging including all message processing
- `info`: General information about bot operations (default)
- `warn`: Warnings about rate limits, reconnections, etc.
- `error`: Only error messages

## Troubleshooting

### Bot doesn't respond to messages

- Ensure Message Content Intent is enabled in Discord Developer Portal
- Verify the channel ID is correct
- Check that the bot has permission to read messages in the channel

### Google Sheets errors

- Verify the service account email has "Editor" access to the spreadsheet
- Check that the Google Sheets API is enabled in your Google Cloud project
- Ensure the credentials file path is correct

### Rate limiting

The bot handles rate limits automatically with exponential backoff. If you're hitting rate limits frequently:
- Consider implementing batching for high-volume channels
- Check your Google Sheets API quotas in Google Cloud Console

## Project Structure

```
osrs-cox-tracker/
├── src/
│   ├── config/
│   │   └── index.js          # Configuration loader
│   ├── parsers/
│   │   └── raidParser.js     # Message parsing logic (extracts player points)
│   ├── services/
│   │   └── googleSheets.js   # Google Sheets integration (raid tracking & correlation)
│   ├── utils/
│   │   └── logger.js         # Logging utility
│   └── index.js              # Main bot file
├── credentials/
│   └── google-credentials.json
├── .env                       # Environment variables
├── .env.example              # Example environment file
├── .gitignore
├── package.json
└── README.md
```

## Development

### Adding New Message Patterns

To support new message formats, edit [src/parsers/raidParser.js](src/parsers/raidParser.js) and add new regex patterns to the appropriate parsing functions.

### Modifying Spreadsheet Format

To change the columns or add new data fields:
1. Update the parsers in [src/parsers/raidParser.js](src/parsers/raidParser.js) to extract the new data
2. Modify the `raidToRow` function in [src/services/googleSheets.js](src/services/googleSheets.js) to include the new fields
3. Update the headers array in the `addHeaders` function

### How Raid Correlation Works

The bot maintains a buffer of recent raids (up to 10 raids, max 5 minutes old) in memory:
- When a raid completion is posted, it's added to the buffer and immediately written to the sheet
- When a loot drop is posted, the bot searches the buffer for a matching raid
- Matching priority: raids where the player participated, then most recent raid
- The matched raid row is then updated with the unique item name

## License

MIT
