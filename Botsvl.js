// ============================================================
// SVL Bot — Swedish Virtual League Discord Bot (MongoDB Version)
// Includes Express API, Canvas Graphics & OpenCloud Rank Requests
// Requires: discord.js ^14, mongodb ^6, @napi-rs/canvas ^0.1.52, express ^4, noblox.js ^4.15
// ============================================================

const express = require('express');
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  REST,
  Routes,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  PermissionFlagsBits
} = require('discord.js');
const { MongoClient } = require('mongodb');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const noblox = require('noblox.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const MONGO_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 3000;
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const ROBLOX_GROUP_ID = process.env.ROBLOX_GROUP_ID ? parseInt(process.env.ROBLOX_GROUP_ID) : null;

if (!TOKEN) { console.error('DISCORD_BOT_TOKEN is not set!'); process.exit(1); }
if (!MONGO_URI) { console.error('MONGODB_URI is not set!'); process.exit(1); }

// Verify OpenCloud API Setup
function initRoblox() {
  if (ROBLOX_API_KEY && ROBLOX_GROUP_ID) {
    console.log('✅ Roblox OpenCloud API Key and Group ID loaded successfully.');
  } else {
    console.warn('⚠️ ROBLOX_API_KEY or ROBLOX_GROUP_ID is missing. Automatic ranking disabled.');
  }
}

// Roblox Link Constant
const STADIUM_HUB_LINK = 'https://www.roblox.com/games/117172134431953/Swedish-Virtual-League';

// ============================================================
// ROBLOX & DISCORD RANK CONFIGURATION
// ============================================================
const RANK_CONFIG = {
  STAFF:       { name: 'Staff',       robloxRank: 200, discordRole: 'Staff' },
  REFEREE:     { name: 'Referee',     robloxRank: 199, discordRole: 'Referee Team' },
  TEAM_OWNER:  { name: 'Team Owner',  robloxRank: 182, discordRole: 'Team Owner' },
  PLAYER:      { name: 'Player',      robloxRank: 181, discordRole: null },
  FAN_LEADER:  { name: 'Fan Leader',  robloxRank: 180, discordRole: null }
};

const TEAM_ASSET_IDS = {
  HIF:  'rbxassetid://103608001095729',
  IFK:  'rbxassetid://99911675010857',
  DIF:  'rbxassetid://79642663925964',
  IKS:  'rbxassetid://81829157754531',
  AIK:  'rbxassetid://118329362686883',
  OIS:  'rbxassetid://88981317869527',
  MFF:  'rbxassetid://85046406829676',
  GAIS: 'rbxassetid://137970073492201',
  HAIF: 'rbxassetid://97391475371961',
  MAIF: 'rbxassetid://85280230695625',
  IFE:  'rbxassetid://110206835719682',
  OSK:  'rbxassetid://94708646876895'
};

// Custom Font Loading
try {
  GlobalFonts.registerFromPath(path.join(__dirname, 'font.ttf'), 'SVLFont');
  console.log('✅ Custom font loaded successfully!');
} catch (err) {
  console.error('⚠️ Could not load font.ttf file:', err.message);
}

// ============================================================
// DATABASE CONNECTION LAYER
// ============================================================
const mongoClient = new MongoClient(MONGO_URI);
let db, playersCol, gamesCol, pendingCol, resultsCol, refRequestsCol, rankRequestsCol, manualStandingsCol;

async function connectDB() {
  try {
    await mongoClient.connect();
    db = mongoClient.db('svl_database');
    playersCol         = db.collection('players');
    gamesCol           = db.collection('games');
    pendingCol         = db.collection('pending');
    resultsCol         = db.collection('results');
    refRequestsCol     = db.collection('ref_requests');
    rankRequestsCol    = db.collection('rank_requests');
    manualStandingsCol = db.collection('manual_standings');

    await pendingCol.createIndex({ createdAt: 1 }, { expireAfterSeconds: 172800 });
    await refRequestsCol.createIndex({ createdAt: 1 }, { expireAfterSeconds: 172800 });
    console.log('✅ Connected to MongoDB Atlas successfully!');
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
}

// ============================================================
// EXPRESS WEB API FOR ROBLOX
// ============================================================
const app = express();

app.get('/api/player/:robloxUsername', async (req, res) => {
  try {
    const robloxUsername = req.params.robloxUsername;
    
    const player = await playersCol.findOne({
      robloxUsername: { $regex: new RegExp(`^${robloxUsername}$`, 'i') }
    });

    if (player && player.team && TEAM_ASSET_IDS[player.team]) {
      return res.json({
        hasTeam: true,
        teamKey: player.team,
        logoAssetId: TEAM_ASSET_IDS[player.team]
      });
    }

    return res.json({ hasTeam: false, logoAssetId: null });
  } catch (err) {
    console.error('API Endpoint Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Express API server live on Railway port ${PORT}`);
});

// ============================================================
// CONSTANTS & HELPERS
// ============================================================
const DIVISIONS = {
  DIV1: ['DIF', 'GAIS', 'IKS', 'IFK', 'OIS', 'MAIF', 'HAIF', 'MFF'],
  DIV2: ['IFE', 'AIK', 'OSK', 'HIF']
};

const CUP_GROUPS = {
  G1: ['HIF', 'HAIF', 'MFF'],
  G2: ['OIS', 'GAIS', 'IFE'],
  G3: ['IKS', 'DIF', 'MAIF'],
  G4: ['IFK', 'OSK', 'AIK']
};

const IMAGE_ASSETS = {
  EMPTY: 'https://i.imgur.com/DDObeXl.png'
};

const TEAMS = {
  GAIS: { name: 'GAIS', emojiNames: ['Gais', 'GAIS'],                        fullName: 'GAIS'           },
  IKS:  { name: 'IKS',  emojiNames: ['IKSirius', 'IKS'],                     fullName: 'IK Sirius'      },
  AIK:  { name: 'AIK',  emojiNames: ['AIK', 'AlK'],                          fullName: 'AIK'            },
  DIF:  { name: 'DIF',  emojiNames: ['DjurgardensIF', 'DjurgardensiF', 'DIF'], fullName: 'Djurgårdens IF' },
  HAIF: { name: 'HAIF', emojiNames: ['HammarbyIF', 'HammarbylF', 'HAIF'],      fullName: 'Hammarby IF'    },
  HIF:  { name: 'HIF',  emojiNames: ['HelsingborgsIF', 'Helsingborgs|F'],     fullName: 'Helsingborgs IF'},
  IFE:  { name: 'IFE',  emojiNames: ['IFElfsborg', '|FElfsborg', 'IFE'],       fullName: 'IF Elfsborg'    },
  IFK:  { name: 'IFK',  emojiNames: ['IFKGoteborg', 'IFK'],                  fullName: 'IFK Göteborg'   },
  MFF:  { name: 'MFF',  emojiNames: ['MalmoFF', 'MFF'],                      fullName: 'Malmö FF'       },
  MAIF: { name: 'MAIF', emojiNames: ['MjallbyAIF', 'MAIF'],                    fullName: 'Mjällby AIF'    },
  OSK:  { name: 'ÖSK',  emojiNames: ['OrebroSK', 'OSK'],                     fullName: 'Örebro SK'      },
  OIS:  { name: 'ÖIS',  emojiNames: ['OrgryteIS', 'OrgrytelS', 'OIS'],       fullName: 'Örgryte IS'     },
};

const TEAM_CHOICES = Object.entries(TEAMS).map(([key, t]) => ({
  name: `${t.name} — ${t.fullName}`,
  value: key,
}));

const STADIUM_CHOICES = [
  { name: 'GAIS PARKEN',             value: 'GAIS PARKEN' },
  { name: 'ÄNGLARNAS FÄSTE',         value: 'ÄNGLARNAS FÄSTE' },
  { name: 'NYA STOCKHOLMS ARENAN',  value: 'NYA STOCKHOLMS ARENAN' },
  { name: 'SÖDER STADION',           value: 'SÖDER STADION' },
  { name: 'SOLNA STADION',           value: 'SOLNA STADION' },
  { name: 'NYA MALMÖ STADION',       value: 'NYA MALMÖ STADION' },
  { name: 'STUDENTERNAS IP',         value: 'STUDENTERNAS IP' },
  { name: 'RYA VALLEN',              value: 'RYA VALLEN' },
  { name: 'OLYMPIA HELSINGBORG',     value: 'OLYMPIA HELSINGBORG' },
  { name: 'NYA NORD VALLEN',         value: 'NYA NORD VALLEN' },
];

async function storePending(type, requesterId, targetId, targetUsername, teamKey, robloxUsername) {
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  await pendingCol.insertOne({
    _id: id,
    type, requesterId, targetId, targetUsername, teamKey, robloxUsername,
    createdAt: new Date()
  });
  return id;
}

async function getPending(id) {
  return await pendingCol.findOne({ _id: id });
}

async function deletePending(id) {
  await pendingCol.deleteOne({ _id: id });
}

function lastSundayUTC(year, month0) {
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  last.setUTCDate(last.getUTCDate() - last.getUTCDay());
  return last;
}

function parseStockholmTime(dateStr) {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);

  const dstStart = lastSundayUTC(y, 2); dstStart.setUTCHours(1);
  const dstEnd   = lastSundayUTC(y, 9); dstEnd.setUTCHours(1);

  const naive   = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const isDST   = naive >= dstStart && naive < dstEnd;
  const offset  = isDST ? 120 : 60;

  return new Date(naive.getTime() - offset * 60_000);
}

const dateOf = (s) => s.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? s;
const timeOf = (s) => s.match(/(\d{2}:\d{2})$/)?.[1] ?? s;

function isStaffOrAdmin(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(role => 
    ['REGISTRATION STAFF', 'STAFF', 'ADMINISTRATOR'].includes(role.name.toUpperCase())
  );
}

function isRefereeManagerOrStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(role => 
    ['REGISTRATION STAFF', 'STAFF', 'TEAM MANAGER', 'REFEREE MANAGER'].includes(role.name.toUpperCase())
  );
}

function isRefereeOrStaffOrAdmin(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const allowedRoles = ['REGISTRATION STAFF', 'STAFF', '— REFEREE TEAM', '— HEAD REFEREE'];
  return member.roles.cache.some(role => allowedRoles.includes(role.name.toUpperCase()));
}

function teamEmoji(guild, key) {
  const t = TEAMS[key];
  if (!t) return `[${key}]`;
  if (!guild) return '';

  const foundEmoji = guild.emojis.cache.find(e => 
    t.emojiNames.some(name => name.toLowerCase() === e.name.toLowerCase())
  );

  return foundEmoji ? foundEmoji.toString() : '';
}

function svlEmoji(guild) {
  const e = guild?.emojis.cache.find(em => em.name === 'SVL');
  return e ? e.toString() : ':SVL:';
}

function findChannel(guild, name) {
  return guild.channels.cache.find(c => c.name === name && c.isTextBased());
}

function formatStadiumLink(venueName) {
  const cleanVenue = (venueName || 'Stadium').replace(/https?:\/\/\S+/gi, '').trim() || 'Stadium';
  return `[SVL Stadium Hub ${cleanVenue}](${STADIUM_HUB_LINK})`;
}

function getDivisionTitle(divCode) {
  if (divCode === 'DIV1') return 'Division 1';
  if (divCode === 'DIV2') return 'Division 2';
  if (divCode === 'CUP') return 'Cup';
  return divCode;
}

// ============================================================
// DYNAMIC CANVAS TABLE RENDERER
// ============================================================
async function generateStandingsImage(title, rows) {
  let bgImage = null;
  try {
    bgImage = await loadImage(IMAGE_ASSETS.EMPTY);
  } catch (err) {
    console.error('⚠️ Could not load background image asset:', err);
  }

  const canvasWidth = bgImage && bgImage.width > 0 ? bgImage.width : 1000;
  const canvasHeight = bgImage && bgImage.height > 0 ? bgImage.height : 800;

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');

  if (bgImage) {
    ctx.drawImage(bgImage, 0, 0, canvasWidth, canvasHeight);
  } else {
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  const cardMarginX = canvasWidth * 0.08; 
  const cardMarginY = canvasHeight * 0.06;
  const cardWidth   = canvasWidth - (cardMarginX * 2);
  const cardHeight  = canvasHeight - (cardMarginY * 2);
  const cardRight   = cardMarginX + cardWidth;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
  ctx.roundRect(cardMarginX, cardMarginY, cardWidth, cardHeight, canvasWidth * 0.02);
  ctx.fill();

  ctx.textBaseline = 'middle';

  const fontSizeMain   = Math.round(canvasWidth * 0.024);
  const fontSizeTitle  = Math.round(canvasWidth * 0.038);
  const fontSizeHeader = Math.round(canvasWidth * 0.022);

  const fontMain   = `${fontSizeMain}px SVLFont, sans-serif`;
  const fontTitle  = `${fontSizeTitle}px SVLFont, sans-serif`;
  const fontHeader = `${fontSizeHeader}px SVLFont, sans-serif`;

  ctx.fillStyle = '#FFFFFF';
  ctx.font = fontTitle;
  ctx.textAlign = 'center';
  ctx.fillText(title.toUpperCase(), canvasWidth / 2, cardMarginY + (canvasHeight * 0.08));

  const startY = cardMarginY + (canvasHeight * 0.18);
  const rowHeight = canvasHeight * 0.07;

  const colPOS  = cardMarginX + (cardWidth * 0.05);
  const colTEAM = cardMarginX + (cardWidth * 0.14);
  
  const colPTS  = cardRight - (cardWidth * 0.06);
  const colGD   = cardRight - (cardWidth * 0.15);
  const colL    = cardRight - (cardWidth * 0.23);
  const colD    = cardRight - (cardWidth * 0.30);
  const colW    = cardRight - (cardWidth * 0.37);
  const colP    = cardRight - (cardWidth * 0.44);

  ctx.font = fontHeader;
  ctx.fillStyle = '#38BDF8';

  ctx.textAlign = 'left';
  ctx.fillText('POS', colPOS, startY);
  ctx.fillText('TEAM', colTEAM, startY);

  ctx.textAlign = 'right';
  ctx.fillText('P',   colP, startY);
  ctx.fillText('W',   colW, startY);
  ctx.fillText('D',   colD, startY);
  ctx.fillText('L',   colL, startY);
  ctx.fillText('GD',  colGD, startY);
  ctx.fillText('PTS', colPTS, startY);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = Math.max(1, Math.round(canvasWidth * 0.002));
  ctx.beginPath();
  ctx.moveTo(cardMarginX + (cardWidth * 0.03), startY + (canvasHeight * 0.03));
  ctx.lineTo(cardRight - (cardWidth * 0.03), startY + (canvasHeight * 0.03));
  ctx.stroke();

  rows.forEach((row, index) => {
    const y = startY + (canvasHeight * 0.08) + (index * rowHeight);

    if (index % 2 === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(
        cardMarginX + (cardWidth * 0.02), 
        y - (rowHeight * 0.4), 
        cardWidth * 0.96, 
        rowHeight * 0.85
      );
    }

    ctx.font = fontMain;
    ctx.fillStyle = '#F8FAFC';

    ctx.textAlign = 'left';
    ctx.fillText(`${index + 1}`, colPOS, y);
    ctx.fillText(`${row.teamName}`, colTEAM, y);

    ctx.textAlign = 'right';
    ctx.fillText(`${row.GP}`, colP, y);
    ctx.fillText(`${row.W}`,  colW, y);
    ctx.fillText(`${row.D}`,  colD, y);
    ctx.fillText(`${row.L}`,  colL, y);

    if (row.GD > 0) ctx.fillStyle = '#4ADE80';
    else if (row.GD < 0) ctx.fillStyle = '#F87171';
    else ctx.fillStyle = '#94A3B8';

    ctx.fillText(`${row.GD > 0 ? '+' + row.GD : row.GD}`, colGD, y);

    ctx.fillStyle = '#FACC15';
    ctx.fillText(`${row.PTS}`, colPTS, y);
  });

  return canvas.toBuffer('image/png');
}

// ============================================================
// COMMAND DEFINITIONS
// ============================================================
const commandDefs = [
  new SlashCommandBuilder()
    .setName('rankrequest')
    .setDescription('Submit a rank request for Roblox and Discord')
    .addStringOption(o => o.setName('roblox_username').setDescription('Your Roblox Username').setRequired(true))
    .addStringOption(o => o.setName('role').setDescription('Role/Rank being requested').setRequired(true)
      .addChoices(
        { name: 'Staff (Roblox + Discord)', value: 'STAFF' },
        { name: 'Referee (Roblox + Discord)', value: 'REFEREE' },
        { name: 'Team Owner (Roblox + Discord)', value: 'TEAM_OWNER' },
        { name: 'Player (Roblox Only)', value: 'PLAYER' },
        { name: 'Fan Leader (Roblox Only)', value: 'FAN_LEADER' }
      ))
    .addAttachmentOption(o => o.setName('proof').setDescription('Upload proof image for rank verification').setRequired(true)),

  new SlashCommandBuilder()
    .setName('teamlist')
    .setDescription('Show teams and their signed players by division')
    .addStringOption(o => o.setName('division').setDescription('Select Division').setRequired(true)
      .addChoices(
        { name: 'Division 1', value: 'DIV1' },
        { name: 'Division 2', value: 'DIV2' }
      )),

  new SlashCommandBuilder()
    .setName('game')
    .setDescription('Schedule a match and create a server event')
    .addStringOption(o => o.setName('division').setDescription('Select Division/Cup').setRequired(true)
      .addChoices(
        { name: 'Division 1', value: 'DIV1' },
        { name: 'Division 2', value: 'DIV2' },
        { name: 'Cup', value: 'CUP' }
      ))
    .addStringOption(o => o.setName('home_team').setDescription('Home team').setRequired(true).addChoices(...TEAM_CHOICES))
    .addStringOption(o => o.setName('away_team').setDescription('Away team').setRequired(true).addChoices(...TEAM_CHOICES))
    .addStringOption(o => o.setName('datetime').setDescription('Date & time — YYYY-MM-DD HH:MM').setRequired(true))
    .addStringOption(o => o.setName('venue').setDescription('Match venue').setRequired(true).addChoices(...STADIUM_CHOICES))
    .addUserOption(o => o.setName('referee').setDescription('Assign referee from — Referee Team').setRequired(false)),

  new SlashCommandBuilder()
    .setName('refereerequest')
    .setDescription('Request a referee for an upcoming game')
    .addStringOption(o => o.setName('game').setDescription('Game type').setRequired(true)
      .addChoices(
        { name: 'League', value: 'League' },
        { name: 'Cup', value: 'Cup' },
        { name: 'Friendly', value: 'Friendly' }
      ))
    .addStringOption(o => o.setName('home_team').setDescription('Home team').setRequired(true).addChoices(...TEAM_CHOICES))
    .addStringOption(o => o.setName('away_team').setDescription('Away team').setRequired(true).addChoices(...TEAM_CHOICES))
    .addStringOption(o => o.setName('date').setDescription('Kickoff Date & Time — YYYY-MM-DD HH:MM').setRequired(true)),

  new SlashCommandBuilder()
    .setName('result')
    .setDescription('Enter match results and post to #ft-scores')
    .addStringOption(o => o.setName('game').setDescription('Select scheduled game').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('result').setDescription('Result (e.g. 3-0, 2-1)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('standings')
    .setDescription('View the current league table/standings')
    .addStringOption(o => o.setName('division').setDescription('Select division').setRequired(true)
      .addChoices(
        { name: 'Division 1', value: 'DIV1' },
        { name: 'Division 2', value: 'DIV2' },
        { name: 'Cup', value: 'CUP' }
      ))
    .addStringOption(o => o.setName('group').setDescription('Select group (Required if Cup is selected)').setRequired(false)
      .addChoices(
        { name: 'Group 1', value: 'G1' },
        { name: 'Group 2', value: 'G2' },
        { name: 'Group 3', value: 'G3' },
        { name: 'Group 4', value: 'G4' }
      )),

  new SlashCommandBuilder()
    .setName('changestandings')
    .setDescription('Manually edit a team standings entry (Staff/Admin Only)')
    .addStringOption(o => o.setName('type').setDescription('Select Competition Type').setRequired(true)
      .addChoices(
        { name: 'Division 1', value: 'DIV1' },
        { name: 'Division 2', value: 'DIV2' },
        { name: 'Cup', value: 'CUP' }
      ))
    .addStringOption(o => o.setName('team').setDescription('Select Team').setRequired(true).addChoices(...TEAM_CHOICES))
    .addIntegerOption(o => o.setName('p').setDescription('Played (P)').setRequired(true))
    .addIntegerOption(o => o.setName('w').setDescription('Wins (W)').setRequired(true))
    .addIntegerOption(o => o.setName('d').setDescription('Draws (D)').setRequired(true))
    .addIntegerOption(o => o.setName('l').setDescription('Losses (L)').setRequired(true))
    .addIntegerOption(o => o.setName('gd').setDescription('Goal Difference (GD)').setRequired(true))
    .addIntegerOption(o => o.setName('pts').setDescription('Points (PTS)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('resettable')
    .setDescription('Reset standings for a new season (Staff/Admin Only)')
    .addStringOption(o => o.setName('division').setDescription('Division to reset').setRequired(true)
      .addChoices(
        { name: 'Division 1', value: 'DIV1' },
        { name: 'Division 2', value: 'DIV2' },
        { name: 'Cup', value: 'CUP' },
        { name: 'All Divisions', value: 'ALL' }
      )),

  new SlashCommandBuilder()
    .setName('cancelgame')
    .setDescription('Cancel a scheduled game')
    .addStringOption(o => o.setName('game').setDescription('Game to cancel').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('requestsign')
    .setDescription('Submit a sign request for a player')
    .addStringOption(o => o.setName('team_name').setDescription('Team name').setRequired(true).addChoices(...TEAM_CHOICES))
    .addUserOption(o => o.setName('discord_username').setDescription('Player to sign').setRequired(true))
    .addStringOption(o => o.setName('roblox_username').setDescription("Player's Roblox username").setRequired(true)),

  new SlashCommandBuilder()
    .setName('requestrelease')
    .setDescription('Submit a release request for a player')
    .addStringOption(o => o.setName('team_name').setDescription('Team name').setRequired(true).addChoices(...TEAM_CHOICES))
    .addUserOption(o => o.setName('discord_username').setDescription('Player to release').setRequired(true))
    .addStringOption(o => o.setName('roblox_username').setDescription("Player's Roblox username").setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for release').setRequired(true)),

  new SlashCommandBuilder()
    .setName('player')
    .setDescription('Look up a player profile')
    .addUserOption(o => o.setName('discord_username').setDescription('Discord user to look up').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mvpvote')
    .setDescription('Create a 5-hour MVP vote for a match')
    .addStringOption(o => o.setName('game').setDescription('Select game').setRequired(true).setAutocomplete(true)),
].map(c => c.toJSON());

// ============================================================
// CLIENT SETUP
// ============================================================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildScheduledEvents, GatewayIntentBits.GuildMembers],
});

client.once('clientReady', async () => {
  await connectDB();
  initRoblox();
  console.log(`✅ SVL Bot online as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: [] });
    }
    console.log('✅ Cleaned up old guild commands.');
  } catch (err) {
    console.error('⚠️ Could not clear guild commands:', err.message);
  }

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commandDefs });
    console.log('✅ Registered commands globally!');
  } catch (err) {
    console.error('❌ Global command deployment error:', err);
  }

  startScheduler();
});

// ============================================================
// SCHEDULER
// ============================================================
function startScheduler() {
  setInterval(async () => {
    const now = Date.now();
    const unnotifiedGames = await gamesCol.find({ notified: false }).toArray();

    for (const game of unnotifiedGames) {
      const matchMs  = new Date(game.utcDatetime).getTime();
      const notifyMs = matchMs - (5 * 60 * 60_000);

      if (now >= notifyMs && now < matchMs) {
        try {
          const guild = client.guilds.cache.get(game.guildId);
          if (!guild) continue;

          const ch = findChannel(guild, 'matches');
          if (!ch) continue;

          const pingRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'matchday ping');
          const pingText = pingRole ? `<@&${pingRole.id}>` : '@Matchday ping';

          const svl   = svlEmoji(guild);
          const homeE = teamEmoji(guild, game.homeTeam);
          const awayE = teamEmoji(guild, game.awayTeam);

          const fields = [
            { name: '🏟️ Stadium', value: formatStadiumLink(game.venue), inline: false },
            { name: '📅 Date', value: dateOf(game.datetimeSwedish), inline: true },
            { name: '⏰ KickOff', value: timeOf(game.datetimeSwedish), inline: true }
          ];

          if (game.refereeId) {
            fields.push({ name: '🟨 Referee', value: `<@${game.refereeId}>`, inline: false });
          }

          const embed = new EmbedBuilder()
            .setTitle(`${svl} | Swedish Virtual League`)
            .setColor(0x005B9F)
            .setDescription(`${homeE} **${TEAMS[game.homeTeam]?.name}** vs ${awayE} **${TEAMS[game.awayTeam]?.name}**`)
            .addFields(fields)
            .setFooter({ text: `${game.division} · Swedish Virtual League` });

          await ch.send({ content: pingText, embeds: [embed] });
          await gamesCol.updateOne({ _id: game._id }, { $set: { notified: true } });
        } catch (err) {
          console.error('Scheduler notify error:', err.message);
        }
      }
    }
  }, 60_000);
}

// ============================================================
// INTERACTION ROUTER
// ============================================================
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'rankrequest':      return await cmdRankRequest(interaction);
        case 'teamlist':         return await cmdTeamList(interaction);
        case 'game':             return await cmdGame(interaction);
        case 'refereerequest':   return await cmdRefereeRequest(interaction);
        case 'result':           return await cmdResult(interaction);
        case 'standings':        return await cmdStandings(interaction);
        case 'changestandings':  return await cmdChangeStandings(interaction);
        case 'resettable':       return await cmdResetTable(interaction);
        case 'cancelgame':       return await cmdCancelGame(interaction);
        case 'requestsign':      return await cmdRequestSign(interaction);
        case 'requestrelease':   return await cmdRequestRelease(interaction);
        case 'player':           return await cmdPlayer(interaction);
        case 'mvpvote':          return await cmdMvpVote(interaction);
      }
    }
    if (interaction.isAutocomplete()) {
      if (['cancelgame', 'result', 'mvpvote'].includes(interaction.commandName)) {
        return await handleGameAutocomplete(interaction);
      }
    }
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('accept_ref:')) {
        return await handleRefereeAcceptButton(interaction);
      }
      if (interaction.customId.startsWith('rank_accept:')) {
        return await handleRankAccept(interaction);
      }
      if (interaction.customId.startsWith('rank_decline:')) {
        return await handleRankDeclineModalShow(interaction);
      }
      return await handleButton(interaction);
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('rank_decline_modal:')) {
        return await handleRankDeclineSubmit(interaction);
      }
    }
  } catch (err) {
    console.error('Interaction Exception:', err);
  }
});

// ============================================================
// RANK REQUEST SYSTEM (ROBLOX OPENCLOUD VERSION)
// ============================================================
async function cmdRankRequest(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const robloxUsername = interaction.options.getString('roblox_username').trim();
  const roleKey        = interaction.options.getString('role');
  const proofAttachment= interaction.options.getAttachment('proof');

  const rankInfo = RANK_CONFIG[roleKey];
  if (!rankInfo) {
    return interaction.editReply({ content: '❌ Invalid role selected.' });
  }

  const targetChan = findChannel(interaction.guild, 'rr-logs') || 
                     findChannel(interaction.guild, 'rank-requests') || 
                     findChannel(interaction.guild, 'staff-regging');

  if (!targetChan) {
    return interaction.editReply({ content: '❌ Could not find `#rr-logs` channel.' });
  }

  const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);

  await rankRequestsCol.insertOne({
    _id: requestId,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    robloxUsername,
    roleKey,
    proofUrl: proofAttachment.url,
    status: 'PENDING',
    createdAt: new Date()
  });

  const embed = new EmbedBuilder()
    .setTitle('📌 New Rank Request')
    .setColor(0x38BDF8)
    .addFields(
      { name: 'Discord User', value: `<@${interaction.user.id}> (\`@${interaction.user.username}\`)`, inline: true },
      { name: 'Roblox Username', value: robloxUsername, inline: true },
      { name: 'Requested Role', value: rankInfo.name, inline: true }
    )
    .setImage(proofAttachment.url)
    .setFooter({ text: `Request ID: ${requestId}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rank_accept:${requestId}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rank_decline:${requestId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger)
  );

  await targetChan.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: '✅ Your rank request has been submitted to `#rr-logs` for review!' });
}

async function handleRankAccept(interaction) {
  if (!isStaffOrAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ Only staff can review rank requests.', ephemeral: true });
  }

  await interaction.deferUpdate();

  const reqId = interaction.customId.split(':')[1];
  const req = await rankRequestsCol.findOne({ _id: reqId });

  if (!req || req.status !== 'PENDING') {
    return interaction.followUp({ content: '⚠️ Request no longer exists or has already been reviewed.', ephemeral: true });
  }

  const rankInfo = RANK_CONFIG[req.roleKey];

  // 1. Automatic Roblox Group Ranking via OpenCloud API
  let robloxStatus = 'Not Configured';
  if (ROBLOX_GROUP_ID && ROBLOX_API_KEY) {
    try {
      const robloxId = await noblox.getIdFromUsername(req.robloxUsername);

      const response = await fetch(
        `https://apis.roblox.com/cloud/v2/groups/${ROBLOX_GROUP_ID}/memberships/users/${robloxId}`,
        {
          method: 'PATCH',
          headers: {
            'x-api-key': ROBLOX_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            role: `groups/${ROBLOX_GROUP_ID}/roles/${rankInfo.robloxRank}`
          })
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || `API Error ${response.status}`);
      }

      robloxStatus = `Ranked to ${rankInfo.name} (${rankInfo.robloxRank})`;
    } catch (err) {
      console.error('Roblox ranking error:', err);
      robloxStatus = `Failed to rank on Roblox: ${err.message}`;
    }
  }

  // 2. Automatic Discord Role Assignment
  let discordStatus = 'No Role Configured';
  if (rankInfo.discordRole) {
    try {
      const targetMember = await interaction.guild.members.fetch(req.userId);
      const targetRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === rankInfo.discordRole.toLowerCase());

      if (targetRole && targetMember) {
        await targetMember.roles.add(targetRole);
        discordStatus = `Assigned @${targetRole.name}`;
      } else {
        discordStatus = `Role "${rankInfo.discordRole}" not found in server`;
      }
    } catch (err) {
      console.error('Discord role assignment error:', err);
      discordStatus = `Failed to assign Discord role: ${err.message}`;
    }
  }

  await rankRequestsCol.updateOne({ _id: reqId }, { $set: { status: 'ACCEPTED', reviewerId: interaction.user.id } });

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0x22C55E)
    .setTitle('✅ Rank Request Accepted')
    .addFields(
      { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: false },
      { name: 'Roblox Status', value: robloxStatus, inline: true },
      { name: 'Discord Status', value: discordStatus, inline: true }
    );

  await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

  try {
    const requester = await client.users.fetch(req.userId);
    if (requester) {
      await requester.send(
        `> **RANK REQUEST**\n` +
        `> <@${req.userId}>\n` +
        `> **Accepted.**`
      );
    }
  } catch (err) {
    console.error(`Could not DM user ${req.userId}:`, err.message);
  }
}

async function handleRankDeclineModalShow(interaction) {
  if (!isStaffOrAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ Only staff can review rank requests.', ephemeral: true });
  }

  const reqId = interaction.customId.split(':')[1];

  const modal = new ModalBuilder()
    .setCustomId(`rank_decline_modal:${reqId}`)
    .setTitle('Decline Rank Request');

  const reasonInput = new TextInputBuilder()
    .setCustomId('decline_reason')
    .setLabel('Reason for declining')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter the reason for declining this request...')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  await interaction.showModal(modal);
}

async function handleRankDeclineSubmit(interaction) {
  await interaction.deferUpdate();

  const reqId = interaction.customId.split(':')[1];
  const reason = interaction.fields.getTextInputValue('decline_reason');

  const req = await rankRequestsCol.findOne({ _id: reqId });

  if (!req || req.status !== 'PENDING') {
    return interaction.followUp({ content: '⚠️ Request no longer exists or has already been reviewed.', ephemeral: true });
  }

  await rankRequestsCol.updateOne({ _id: reqId }, { $set: { status: 'DECLINED', reviewerId: interaction.user.id, reason } });

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0xEF4444)
    .setTitle('❌ Rank Request Declined')
    .addFields(
      { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: false },
      { name: 'Reason', value: reason, inline: false }
    );

  await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

  try {
    const requester = await client.users.fetch(req.userId);
    if (requester) {
      await requester.send(
        `> **RANK REQUEST**\n` +
        `> <@${req.userId}>\n` +
        `> **Declined.**\n` +
        `> **Reason:**\n` +
        `> ${reason}`
      );
    }
  } catch (err) {
    console.error(`Could not DM user ${req.userId}:`, err.message);
  }
}

// ============================================================
// OTHER COMMAND IMPLEMENTATIONS & MVP VOTE
// ============================================================

async function cmdMvpVote(interaction) {
  if (!isStaffOrAdmin(interaction.member)) {
    return interaction.reply({
      content: '❌ You must be an **Administrator** or have the **REGISTRATION STAFF** role to use this command!',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const gameId = interaction.options.getString('game');
  const guild  = interaction.guild;

  const game = await gamesCol.findOne({ _id: gameId });
  if (!game) {
    return interaction.editReply({ content: '❌ Selected match was not found.' });
  }

  const mvpChannel = findChannel(guild, 'mvp');
  if (!mvpChannel) {
    return interaction.editReply({ content: '❌ Channel `#mvp` was not found in this server!' });
  }

  const homeKey = game.homeTeam;
  const awayKey = game.awayTeam;

  const homeTeamInfo = TEAMS[homeKey];
  const awayTeamInfo = TEAMS[awayKey];

  const homeEmojiStr = teamEmoji(guild, homeKey);
  const awayEmojiStr = teamEmoji(guild, awayKey);

  const homePlayers = await playersCol.find({ team: homeKey }).toArray();
  const awayPlayers = await playersCol.find({ team: awayKey }).toArray();

  const homeRoster = homePlayers.map(p => p.robloxUsername).filter(Boolean);
  const awayRoster = awayPlayers.map(p => p.robloxUsername).filter(Boolean);

  if (homeRoster.length === 0 && awayRoster.length === 0) {
    return interaction.editReply({ content: '❌ No registered Roblox players were found for either team!' });
  }

  const userVotes = new Map();

  const generateMvpEmbed = () => {
    const voteCounts = {};
    userVotes.forEach((robloxUser) => {
      voteCounts[robloxUser] = (voteCounts[robloxUser] || 0) + 1;
    });

    const formatRoster = (roster) => {
      if (roster.length === 0) return '*No players registered*';
      return roster.map(p => `• **${p}** — ${voteCounts[p] || 0} votes`).join('\n');
    };

    return new EmbedBuilder()
      .setTitle(`🏆 MVP Vote: ${homeTeamInfo ? homeTeamInfo.name : homeKey} vs ${awayTeamInfo ? awayTeamInfo.name : awayKey}`)
      .setColor(0xFACC15)
      .setDescription(
        `${homeEmojiStr} **${homeTeamInfo ? homeTeamInfo.fullName : homeKey}**\n${formatRoster(homeRoster)}\n\n` +
        `${awayEmojiStr} **${awayTeamInfo ? awayTeamInfo.fullName : awayKey}**\n${formatRoster(awayRoster)}`
      )
      .setFooter({ text: 'Voting closes in 5 hours. You can change your vote anytime!' })
      .setTimestamp();
  };

  const selectOptions = [];

  homeRoster.forEach(robloxUser => {
    selectOptions.push({
      label: `${robloxUser} (${homeTeamInfo ? homeTeamInfo.name : homeKey})`,
      value: robloxUser,
      description: `Vote for ${robloxUser}`
    });
  });

  awayRoster.forEach(robloxUser => {
    selectOptions.push({
      label: `${robloxUser} (${awayTeamInfo ? awayTeamInfo.name : awayKey})`,
      value: robloxUser,
      description: `Vote for ${robloxUser}`
    });
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('mvp_select_menu')
    .setPlaceholder('Choose a player to vote for...')
    .addOptions(selectOptions.slice(0, 25));

  const menuRow = new ActionRowBuilder().addComponents(selectMenu);

  const mvpMessage = await mvpChannel.send({
    embeds: [generateMvpEmbed()],
    components: [menuRow]
  });

  await interaction.editReply({ content: '✅ MVP vote session successfully posted to `#mvp` for 5 hours!' });

  const collector = mvpMessage.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: 5 * 60 * 60 * 1000 
  });

  collector.on('collect', async (i) => {
    const selectedPlayer = i.values[0];
    userVotes.set(i.user.id, selectedPlayer);

    await mvpMessage.edit({
      embeds: [generateMvpEmbed()],
      components: [menuRow]
    });

    await i.reply({
      content: `✅ Your vote for **${selectedPlayer}** has been recorded! You can change it anytime before voting ends.`,
      ephemeral: true
    });
  });

  collector.on('end', async () => {
    const closedEmbed = generateMvpEmbed()
      .setFooter({ text: '🔒 Voting has ended! Vote is now closed.' });

    selectMenu.setDisabled(true);
    const disabledRow = new ActionRowBuilder().addComponents(selectMenu);

    await mvpMessage.edit({
      embeds: [closedEmbed],
      components: [disabledRow]
    });
  });
}

async function cmdGame(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const division    = interaction.options.getString('division');
  const homeKey     = interaction.options.getString('home_team');
  const awayKey     = interaction.options.getString('away_team');
  const datetimeStr = interaction.options.getString('datetime');
  const venue       = interaction.options.getString('venue');
  const referee     = interaction.options.getUser('referee');
  const { guild }   = interaction;

  const utcDate = parseStockholmTime(datetimeStr);
  if (!utcDate) return interaction.editReply({ content: '❌ Invalid date format (YYYY-MM-DD HH:MM)' });

  const homeTeam = TEAMS[homeKey];
  const awayTeam = TEAMS[awayKey];

  const fields = [
    { name: '🏟️ Stadium', value: formatStadiumLink(venue), inline: false },
    { name: '📅 Date', value: dateOf(datetimeStr), inline: true },
    { name: '⏰ KickOff', value: timeOf(datetimeStr), inline: true }
  ];

  if (referee) {
    fields.push({ name: '🟨 Referee', value: `<@${referee.id}>`, inline: false });
  }

  const embed = new EmbedBuilder()
    .setTitle(`${svlEmoji(guild)} | Swedish Virtual League`)
    .setColor(0x005B9F)
    .setDescription(`**${division}**\n${teamEmoji(guild, homeKey)} **${homeTeam ? homeTeam.name : homeKey}** vs ${teamEmoji(guild, awayKey)} **${awayTeam ? awayTeam.name : awayKey}**`)
    .addFields(fields)
    .setTimestamp(utcDate);

  const fixturesCh = findChannel(guild, 'fixtures');
  if (fixturesCh) await fixturesCh.send({ embeds: [embed] });

  if (referee) {
    const refScheduleCh = findChannel(guild, 'referee-schedule');
    if (refScheduleCh) {
      const refEmbed = new EmbedBuilder()
        .setTitle('REFEREE SCHEDULE')
        .setColor(0xFACC15)
        .addFields(
          { name: 'Game', value: `${teamEmoji(guild, homeKey)} ${homeTeam ? homeTeam.name : homeKey} vs ${teamEmoji(guild, awayKey)} ${awayTeam ? awayTeam.name : awayKey}`, inline: false },
          { name: 'Game Type', value: getDivisionTitle(division), inline: true },
          { name: 'Date', value: datetimeStr, inline: true },
          { name: 'Referee', value: `<@${referee.id}>`, inline: false }
        );
      await refScheduleCh.send({ embeds: [refEmbed] });
    }
  }

  let scheduledEvent = null;
  try {
    let descriptionText = `${division} match — ${homeTeam ? homeTeam.fullName : homeKey} vs ${awayTeam ? awayTeam.fullName : awayKey}`;
    if (referee) descriptionText += `\nReferee: ${referee.tag}`;

    scheduledEvent = await guild.scheduledEvents.create({
      name: `${division}: ${homeTeam ? homeTeam.name : homeKey} vs ${awayTeam ? awayTeam.name : awayKey}`.slice(0, 100),
      scheduledStartTime: new Date(Math.max(utcDate.getTime(), Date.now() + 60_000)),
      scheduledEndTime: new Date(utcDate.getTime() + 2 * 3600_000),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: STADIUM_HUB_LINK.slice(0, 100) },
      description: descriptionText
    });
  } catch (err) {
    console.error('Scheduled event creation failed:', err.message);
  }

  const gameId = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  await gamesCol.insertOne({
    _id: gameId,
    eventId: scheduledEvent?.id || null,
    guildId: guild.id,
    division,
    homeTeam: homeKey,
    awayTeam: awayKey,
    utcDatetime: utcDate.toISOString(),
    datetimeSwedish: datetimeStr,
    venue,
    refereeId: referee ? referee.id : null,
    completed: false,
    notified: false,
  });

  await interaction.editReply({ content: '✅ Match scheduled successfully!' });
}

async function cmdRefereeRequest(interaction) {
  if (!isRefereeManagerOrStaff(interaction.member)) {
    return interaction.reply({
      content: '❌ You must have the **Team Manager**, **REGISTRATION STAFF**, or **Administrator** role to use this command!',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const gameType = interaction.options.getString('game');
  const homeKey = interaction.options.getString('home_team');
  const awayKey = interaction.options.getString('away_team');
  const dateStr = interaction.options.getString('date');
  const guild   = interaction.guild;

  const reqId = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

  await refRequestsCol.insertOne({
    _id: reqId,
    requesterId: interaction.user.id,
    gameType,
    homeKey,
    awayKey,
    dateStr,
    createdAt: new Date()
  });

  const refChannel = findChannel(guild, 'referee-availability');
  if (!refChannel) {
    return interaction.editReply('❌ Channel `#referee-availability` was not found!');
  }

  const refRole = guild.roles.cache.find(r => r.name === '— Referee Team');
  const refPing = refRole ? `<@&${refRole.id}>` : '@— Referee Team';

  const embed = new EmbedBuilder()
    .setTitle('REFEREE REQUEST')
    .setColor(0x38BDF8)
    .addFields(
      { name: 'Requester', value: `<@${interaction.user.id}>`, inline: false },
      { name: 'Match', value: `${teamEmoji(guild, homeKey)} ${TEAMS[homeKey]?.name || homeKey} vs ${teamEmoji(guild, awayKey)} ${TEAMS[awayKey]?.name || awayKey}`, inline: false },
      { name: 'Game Type', value: gameType, inline: false },
      { name: 'Kickoff time', value: timeOf(dateStr), inline: false }
    )
    .setFooter({ text: dateStr });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`accept_ref:${reqId}`)
      .setLabel('ACCEPT')
      .setStyle(ButtonStyle.Success)
  );

  await refChannel.send({ content: refPing, embeds: [embed], components: [row] });
  await interaction.editReply('✅ Referee request submitted successfully!');
}

async function handleRefereeAcceptButton(interaction) {
  const reqId = interaction.customId.split(':')[1];
  const req = await refRequestsCol.findOne({ _id: reqId });

  if (!req) {
    return interaction.reply({ content: '⚠️ Referee request no longer exists or has expired.', ephemeral: true });
  }

  const homeTeam = TEAMS[req.homeKey];
  const awayTeam = TEAMS[req.awayKey];

  try {
    const requester = await client.users.fetch(req.requesterId);
    if (requester) {
      await requester.send(
        `📬 Your request of finding a referee for an **${req.gameType}** match **${homeTeam ? homeTeam.name : req.homeKey} vs ${awayTeam ? awayTeam.name : req.awayKey}** has been accepted, your referee is <@${interaction.user.id}>.`
      );
    }
  } catch (err) {
    console.error(`Could not send DM to referee requester ${req.requesterId}:`, err.message);
  }

  await refRequestsCol.deleteOne({ _id: reqId });
  await interaction.update({
    content: `✅ Referee request accepted by <@${interaction.user.id}>.`,
    components: [],
    embeds: []
  });
}

async function cmdResult(interaction) {
  if (!isRefereeOrStaffOrAdmin(interaction.member)) {
    return interaction.reply({
      content: '❌ You must be an **Administrator**, **Staff**, or have the **— Referee Team** / **— Head Referee** role to use this command!',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const gameId = interaction.options.getString('game');
  const rawScore = interaction.options.getString('result');
  const guild = interaction.guild;

  const parts = rawScore.split('-').map(x => parseInt(x.trim()));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    return interaction.editReply('❌ Invalid result format. Please enter as `X-Y` (e.g. `3-0` or `2-1`).');
  }

  const [homeScore, awayScore] = parts;
  const game = await gamesCol.findOne({ _id: gameId });

  if (!game) return interaction.editReply('❌ Scheduled game not found.');

  const ftChannel = findChannel(guild, 'ft-scores');
  if (!ftChannel) {
    return interaction.editReply('❌ Channel `#ft-scores` was not found in this server!');
  }

  const homeEmoji = teamEmoji(guild, game.homeTeam);
  const awayEmoji = teamEmoji(guild, game.awayTeam);
  const homeName  = TEAMS[game.homeTeam]?.name || game.homeTeam;
  const awayName  = TEAMS[game.awayTeam]?.name || game.awayTeam;
  const divTitle  = getDivisionTitle(game.division);

  const formattedMsg = 
    `**${divTitle} RESULTS**\n` +
    `Game: ${homeEmoji} **${homeName}** vs **${awayName}** ${awayEmoji}\n` +
    `Result: **${rawScore}**\n` +
    `MVP: Pending...`;

  const postedMsg = await ftChannel.send(formattedMsg);

  await resultsCol.insertOne({
    gameId: game._id,
    division: game.division,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    homeScore,
    awayScore,
    scoreText: rawScore,
    scoresMsgId: postedMsg.id,
    createdAt: new Date()
  });

  await gamesCol.updateOne({ _id: game._id }, { $set: { completed: true } });

  await interaction.editReply({ content: '✅ Match result posted successfully to `#ft-scores`!' });
}

async function cmdStandings(interaction) {
  await interaction.deferReply();
  const divKey = interaction.options.getString('division');
  const groupKey = interaction.options.getString('group');

  if (divKey === 'CUP' && !groupKey) {
    return interaction.editReply('❌ You must select a **Group** option (Group 1, 2, 3, or 4) when viewing Cup standings!');
  }

  let allowedTeams = [];
  let title = '';

  if (divKey === 'CUP') {
    allowedTeams = CUP_GROUPS[groupKey] || [];
    const groupNum = groupKey.replace('G', '');
    title = `Cup Standings — Group ${groupNum}`;
  } else {
    allowedTeams = DIVISIONS[divKey] || [];
    title = divKey === 'DIV1' ? 'Division 1 Standings' : 'Division 2 Standings';
  }

  const table = {};
  allowedTeams.forEach(t => {
    table[t] = { 
      teamKey: t, 
      teamName: TEAMS[t]?.fullName || t, 
      GP: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, PTS: 0 
    };
  });

  const results = await resultsCol.find({ division: divKey }).toArray();

  results.forEach(r => {
    if (!table[r.homeTeam] || !table[r.awayTeam]) return;

    const home = table[r.homeTeam];
    const away = table[r.awayTeam];

    home.GP++; 
    away.GP++;
    home.GF += r.homeScore; 
    home.GA += r.awayScore;
    away.GF += r.awayScore; 
    away.GA += r.homeScore;

    if (r.homeScore > r.awayScore) {
      home.W++; home.PTS += 3;
      away.L++;
    } else if (r.homeScore < r.awayScore) {
      away.W++; away.PTS += 3;
      home.L++;
    } else {
      home.D++; home.PTS += 1;
      away.D++; away.PTS += 1;
    }

    home.GD = home.GF - home.GA;
    away.GD = away.GF - away.GA;
  });

  const manualOverrides = await manualStandingsCol.find({ division: divKey }).toArray();
  manualOverrides.forEach(override => {
    if (table[override.teamKey]) {
      table[override.teamKey].GP = override.GP;
      table[override.teamKey].W = override.W;
      table[override.teamKey].D = override.D;
      table[override.teamKey].L = override.L;
      table[override.teamKey].GD = override.GD;
      table[override.teamKey].PTS = override.PTS;
    }
  });

  const sortedRows = Object.values(table).sort((a, b) => 
    b.PTS - a.PTS || b.GD - a.GD || b.GF - a.GF || a.teamName.localeCompare(b.teamName)
  );

  const imageBuffer = await generateStandingsImage(title, sortedRows);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'standings.png' });

  await interaction.editReply({ files: [attachment] });
}

async function cmdChangeStandings(interaction) {
  if (!isStaffOrAdmin(interaction.member)) {
    return interaction.reply({
      content: '❌ You must be an **Administrator** or have the **REGISTRATION STAFF** role to use this command!',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const division = interaction.options.getString('type');
  const teamKey  = interaction.options.getString('team');
  const GP       = interaction.options.getInteger('p');
  const W        = interaction.options.getInteger('w');
  const D        = interaction.options.getInteger('d');
  const L        = interaction.options.getInteger('l');
  const GD       = interaction.options.getInteger('gd');
  const PTS      = interaction.options.getInteger('pts');

  await manualStandingsCol.updateOne(
    { division, teamKey },
    {
      $set: {
        division,
        teamKey,
        GP,
        W,
        D,
        L,
        GD,
        PTS,
        updatedAt: new Date(),
        updatedBy: interaction.user.id
      }
    },
    { upsert: true }
  );

  const teamName = TEAMS[teamKey]?.fullName || teamKey;
  const divLabel = getDivisionTitle(division);

  await interaction.editReply({
    content: `✅ Successfully updated standings for **${teamName}** in **${divLabel}**!\n` +
             `📊 **Stats:** P: \`${GP}\` | W: \`${W}\` | D: \`${D}\` | L: \`${L}\` | GD: \`${GD}\` | PTS: \`${PTS}\``
  });
}

async function cmdResetTable(interaction) {
  if (!isStaffOrAdmin(interaction.member)) {
    return interaction.reply({ 
      content: '❌ You need to be an **Administrator** or have the **REGISTRATION STAFF** role to use this command!', 
      ephemeral: true 
    });
  }

  await interaction.deferReply({ ephemeral: true });
  const divOption = interaction.options.getString('division');

  if (divOption === 'ALL') {
    await resultsCol.deleteMany({});
    await manualStandingsCol.deleteMany({});
    await interaction.editReply('🔄 **All standings tables have been reset for a new season!**');
  } else {
    await resultsCol.deleteMany({ division: divOption });
    await manualStandingsCol.deleteMany({ division: divOption });
    const divLabel = getDivisionTitle(divOption);
    await interaction.editReply(`🔄 **${divLabel} standings table has been reset for a new season!**`);
  }
}

async function cmdTeamList(interaction) {
  await interaction.deferReply();
  const divKey = interaction.options.getString('division');
  const allowedTeams = DIVISIONS[divKey] || [];
  const divTitle = getDivisionTitle(divKey);

  const allPlayers = await playersCol.find({ team: { $ne: null } }).toArray();

  const embed = new EmbedBuilder()
    .setTitle(`📋 SVL — Team Roster (${divTitle})`)
    .setColor(0x005B9F);

  for (const key of allowedTeams) {
    const team = TEAMS[key];
    if (!team) continue;

    const signed = allPlayers.filter(p => p.team === key);
    const listing = signed.length 
      ? signed.map(p => `• ${p.discordUsername}`).join('\n') 
      : '*No players signed*';

    embed.addFields({ name: `${teamEmoji(interaction.guild, key)} ${team.fullName}`, value: listing });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleGameAutocomplete(interaction) {
  const games = await gamesCol.find({ guildId: interaction.guildId }).toArray();

  const choices = games.map(g => ({
    name: `${getDivisionTitle(g.division)} | ${TEAMS[g.homeTeam]?.name || g.homeTeam} vs ${TEAMS[g.awayTeam]?.name || g.awayTeam} (${g.datetimeSwedish})`,
    value: g._id
  }));

  await interaction.respond(choices.slice(0, 25));
}

async function handleButton(interaction) {
  const [action, pendingId] = interaction.customId.split(':');
  const req = await getPending(pendingId);

  if (!req) return interaction.reply({ content: '⚠️ Request expired or not found.', ephemeral: true });

  if (action === 'accept') {
    if (req.type === 'sign') {
      await playersCol.updateOne(
        { _id: req.targetId },
        { 
          $set: { 
            discordUsername: req.targetUsername, 
            robloxUsername: req.robloxUsername, 
            team: req.teamKey 
          } 
        },
        { upsert: true }
      );
    } else {
      await playersCol.updateOne(
        { _id: req.targetId }, 
        { $set: { team: null } }
      );
    }
  }

  try {
    const requester = await client.users.fetch(req.requesterId);
    if (requester) {
      const actionText = action === 'accept' ? 'accepted' : 'declined';
      const typeText = req.type === 'sign' ? 'signing' : 'releasing';
      const teamName = TEAMS[req.teamKey]?.fullName || req.teamKey;

      await requester.send(
        `📬 Your request of **${typeText}** <@${req.targetId}> (${req.robloxUsername}) for **${teamName}** has been **${actionText}**.`
      );
    }
  } catch (err) {
    console.error(`Could not send DM to requester ${req.requesterId}:`, err.message);
  }

  await deletePending(pendingId);
  await interaction.update({ 
    content: `✅ Request for <@${req.targetId}> was **${action === 'accept' ? 'ACCEPTED' : 'DECLINED'}** by <@${interaction.user.id}>.`, 
    components: [], 
    embeds: [] 
  });
}

async function cmdRequestSign(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const teamKey = interaction.options.getString('team_name');
  const targetUser = interaction.options.getUser('discord_username');
  const robloxUser = interaction.options.getString('roblox_username');

  const existingPlayer = await playersCol.findOne({
    $or: [
      { _id: targetUser.id },
      { discordUsername: { $regex: new RegExp(`^${targetUser.username}$`, 'i') } },
      { robloxUsername: { $regex: new RegExp(`^${robloxUser.trim()}$`, 'i') } }
    ]
  });

  if (existingPlayer && existingPlayer.team) {
    const currentTeamName = TEAMS[existingPlayer.team]?.fullName || existingPlayer.team;
    return interaction.editReply({
      content: `❌ **Sign Request Denied:** This player (${robloxUser}) is currently signed to **${currentTeamName}**.\n\nThey must be released by their current team or become a Free Agent (F/A) before a new sign request can be submitted.`
    });
  }

  const pendingId = await storePending(
    'sign',
    interaction.user.id,
    targetUser.id,
    targetUser.username,
    teamKey,
    robloxUser
  );

  const embed = new EmbedBuilder()
    .setTitle('📝 Sign Request')
    .setColor(0x00FF57)
    .addFields(
      { name: 'Requester', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Player', value: `<@${targetUser.id}>`, inline: true },
      { name: 'Roblox Username', value: robloxUser, inline: true },
      { name: 'Team', value: TEAMS[teamKey]?.fullName || teamKey, inline: true }
    )
    .setFooter({ text: `Request ID: ${pendingId}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`accept:${pendingId}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`decline:${pendingId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger)
  );

  const targetChannel = findChannel(interaction.guild, 'staff-regging') || interaction.channel;
  await targetChannel.send({ embeds: [embed], components: [row] });

  await interaction.editReply({ content: '✅ Sign request submitted successfully!' });
}

async function cmdRequestRelease(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const teamKey = interaction.options.getString('team_name');
  const targetUser = interaction.options.getUser('discord_username');
  const robloxUser = interaction.options.getString('roblox_username');
  const reason = interaction.options.getString('reason');

  const pendingId = await storePending(
    'release',
    interaction.user.id,
    targetUser.id,
    targetUser.username,
    teamKey,
    robloxUser
  );

  const embed = new EmbedBuilder()
    .setTitle('🚪 Release Request')
    .setColor(0xFF3333)
    .addFields(
      { name: 'Requester', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Player', value: `<@${targetUser.id}>`, inline: true },
      { name: 'Roblox Username', value: robloxUser, inline: true },
      { name: 'Team', value: TEAMS[teamKey]?.fullName || teamKey, inline: true },
      { name: 'Reason', value: reason, inline: false }
    )
    .setFooter({ text: `Request ID: ${pendingId}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`accept:${pendingId}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`decline:${pendingId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger)
  );

  const targetChannel = findChannel(interaction.guild, 'staff-regging') || interaction.channel;
  await targetChannel.send({ embeds: [embed], components: [row] });

  await interaction.editReply({ content: '✅ Release request submitted successfully!' });
}

async function cmdPlayer(i) {
  await i.deferReply();
  const target = i.options.getUser('discord_username');

  const p = await playersCol.findOne({
    $or: [
      { _id: target.id },
      { discordUsername: target.username }
    ]
  });

  const robloxName = p?.robloxUsername || 'N/A';
  const hasTeam = Boolean(p?.team);

  const emoji = hasTeam ? teamEmoji(i.guild, p.team) : '';
  const teamLabel = hasTeam ? TEAMS[p.team]?.name || p.team : 'N/A';
  
  const teamText = hasTeam ? `${emoji} ${teamLabel}`.trim() : 'N/A';
  const statusText = hasTeam ? 'Registered' : 'F/A';

  const embed = new EmbedBuilder()
    .setTitle(`Player Profile: ${robloxName !== 'N/A' ? robloxName : target.username}`)
    .setColor(0xED4245)
    .addFields(
      { name: 'Roblox', value: robloxName, inline: false },
      { name: 'Discord', value: `<@${target.id}>`, inline: false },
      { name: 'Team', value: teamText, inline: false },
      { name: 'Status', value: statusText, inline: false }
    )
    .setTimestamp();

  await i.editReply({ embeds: [embed] });
}

async function cmdCancelGame(i) {
  await i.deferReply({ ephemeral: true });
  const id = i.options.getString('game');
  await gamesCol.deleteOne({ _id: id });
  await i.editReply('✅ Game cancelled.');
}

client.login(TOKEN);
