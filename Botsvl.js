// ============================================================
// SVL Bot — Swedish Virtual League Discord Bot (MongoDB Version)
// Includes Express API for Roblox Nametag Integration
// Requires: discord.js ^14, mongodb ^6, @napi-rs/canvas ^0.1.52, express ^4
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
  StringSelectMenuOptionBuilder,
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

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const MONGO_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 3000;

if (!TOKEN) { console.error('DISCORD_BOT_TOKEN is not set!'); process.exit(1); }
if (!MONGO_URI) { console.error('MONGODB_URI is not set!'); process.exit(1); }

// Roblox Link Constant
const STADIUM_HUB_LINK = 'https://www.roblox.com/games/117172134431953/Swedish-Virtual-League';

// ============================================================
// ROBLOX TEAM ASSET MAPPING
// ============================================================
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

// ============================================================
// REGISTER CUSTOM TTF FONT
// ============================================================
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
let db, playersCol, gamesCol, pendingCol, resultsCol, refRequestsCol, mvpVotesCol;

async function connectDB() {
  try {
    await mongoClient.connect();
    db = mongoClient.db('svl_database');
    playersCol     = db.collection('players');
    gamesCol       = db.collection('games');
    pendingCol     = db.collection('pending');
    resultsCol     = db.collection('results');
    refRequestsCol = db.collection('ref_requests');
    mvpVotesCol    = db.collection('mvp_votes');

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
    
    // Perform case-insensitive search in MongoDB
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
// DIVISION, GROUPS, TEAMS & STADIUMS DATA
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

// ============================================================
// PENDING REQUEST STORE
// ============================================================
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

// ============================================================
// TIME UTILITIES
// ============================================================
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

// ============================================================
// HELPERS & PERMISSIONS
// ============================================================
function isStaffOrAdmin(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(role => role.name.toUpperCase() === 'REGISTRATION STAFF');
}

function isRefereeManagerOrStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(role => 
    ['REGISTRATION STAFF', 'TEAM MANAGER'].includes(role.name.toUpperCase())
  );
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
    .setDescription('Enter match results')
    .addStringOption(o => o.setName('game').setDescription('Select scheduled game').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('result').setDescription('Result (e.g. 2-1, 1-1)').setRequired(true)),

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
    .setDescription('Create an MVP vote for a match')
    .addStringOption(o => o.setName('game').setDescription('Select the match to vote on').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('time').setDescription('Duration in hours (1-24)').setRequired(true).setMinValue(1).setMaxValue(24)),
].map(c => c.toJSON());

// ============================================================
// CLIENT SETUP
// ============================================================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildScheduledEvents],
});

client.once('ready', async () => {
  await connectDB();
  console.log(`✅ SVL Bot online as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commandDefs });
      console.log(`✅ Registered commands in: ${guild.name}`);
    }
  } catch (err) {
    console.error('Command deployment error:', err);
  }

  startScheduler();
});

// ============================================================
// SCHEDULER (NOTIFIES 5 HOURS BEFORE KICK OFF)
// ============================================================
function startScheduler() {
  setInterval(async () => {
    const now = Date.now();
    const unnotifiedGames = await gamesCol.find({ notified: false }).toArray();

    for (const game of unnotifiedGames) {
      const matchMs  = new Date(game.utcDatetime).getTime();
      const notifyMs = matchMs - (5 * 60 * 60_000); // 5 Hours before kickoff

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
        case 'teamlist':       return await cmdTeamList(interaction);
        case 'game':           return await cmdGame(interaction);
        case 'refereerequest': return await cmdRefereeRequest(interaction);
        case 'result':         return await cmdResult(interaction);
        case 'standings':      return await cmdStandings(interaction);
        case 'resettable':     return await cmdResetTable(interaction);
        case 'cancelgame':     return await cmdCancelGame(interaction);
        case 'requestsign':    return await cmdRequestSign(interaction);
        case 'requestrelease': return await cmdRequestRelease(interaction);
        case 'player':         return await cmdPlayer(interaction);
        case 'mvpvote':        return await cmdMvpVote(interaction);
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
      return await handleButton(interaction);
    }
  } catch (err) {
    console.error('Interaction Exception:', err);
  }
});

// ============================================================
// COMMAND IMPLEMENTATIONS
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
  const durationHours = interaction.options.getInteger('time');
  const guild = interaction.guild;

  const mvpChannel = findChannel(guild, 'mvp');
  if (!mvpChannel) {
    return interaction.editReply({ content: '❌ Channel `#mvp` was not found in this server!' });
  }

  const game = await gamesCol.findOne({ _id: gameId });
  if (!game) {
    return interaction.editReply({ content: '❌ Selected game was not found in database.' });
  }

  const homeTeam = TEAMS[game.homeTeam];
  const awayTeam = TEAMS[game.awayTeam];
  const homeEmoji = teamEmoji(guild, game.homeTeam);
  const awayEmoji = teamEmoji(guild, game.awayTeam);

  // Fetch signed players for both teams from MongoDB
  const homePlayers = await playersCol.find({ team: game.homeTeam }).toArray();
  const awayPlayers = await playersCol.find({ team: game.awayTeam }).toArray();

  const formatTeamList = (players) => {
    if (!players || players.length === 0) return '*No signed players*';
    return players
      .map(p => {
        const tag = p._id ? `<@${p._id}>` : (p.discordUsername ? `@${p.discordUsername}` : '@unknown');
        return `${tag} ${p.robloxUsername || 'N/A'}`;
      })
      .join('\n');
  };

  const expireTimestamp = Math.floor((Date.now() + durationHours * 60 * 60 * 1000) / 1000);

  const mainMessageText = 
    `**MVP VOTE**\n` +
    `Select a player to vote to be the MVP of this match.\n\n` +
    `${homeEmoji} ${homeTeam?.fullName || game.homeTeam}\n${formatTeamList(homePlayers)}\n\n` +
    `${awayEmoji} ${awayTeam?.fullName || game.awayTeam}\n${formatTeamList(awayPlayers)}\n\n` +
    `<small>This vote will be done in ${durationHours} hours.</small>`;

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`mvp_menu_${interaction.id}`)
    .setPlaceholder('Select a player to vote...');

  const allPlayers = [
    ...homePlayers.map(p => ({ ...p, teamName: homeTeam?.name || game.homeTeam })),
    ...awayPlayers.map(p => ({ ...p, teamName: awayTeam?.name || game.awayTeam }))
  ];

  if (allPlayers.length === 0) {
    return interaction.editReply({ content: '❌ No signed players were found for either team to create a vote menu.' });
  }

  allPlayers.forEach(p => {
    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${p.robloxUsername || 'Unknown'}`)
        .setDescription(`Team: ${p.teamName} | @${p.discordUsername || 'User'}`)
        .setValue(p.robloxUsername || p._id)
    );
  });

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const mvpMsg = await mvpChannel.send({
    content: mainMessageText,
    components: [row]
  });

  await interaction.editReply({ content: '✅ MVP vote session successfully created in `#mvp`!' });

  const votes = new Map();
  const durationMs = durationHours * 60 * 60 * 1000;

  const collector = mvpMsg.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: durationMs
  });

  collector.on('collect', async i => {
    const selectedValue = i.values[0];
    votes.set(i.user.id, selectedValue);

    await i.reply({
      content: `Your vote for **${selectedValue}** has been registered! You can change your choice anytime before time runs out.`,
      ephemeral: true
    });
  });

  collector.on('end', async () => {
    selectMenu.setDisabled(true).setPlaceholder('Voting has ended!');
    await mvpMsg.edit({
      components: [new ActionRowBuilder().addComponents(selectMenu)]
    }).catch(() => {});

    if (votes.size === 0) {
      return mvpMsg.reply({ content: 'The voting period has ended, but no votes were cast.' });
    }

    const tally = {};
    for (const val of votes.values()) {
      tally[val] = (tally[val] || 0) + 1;
    }

    let topPlayerVal = '';
    let maxVotes = 0;
    for (const [val, count] of Object.entries(tally)) {
      if (count > maxVotes) {
        maxVotes = count;
        topPlayerVal = val;
      }
    }

    const winner = allPlayers.find(p => p.robloxUsername === topPlayerVal || p._id === topPlayerVal);
    const winnerMention = winner 
      ? `<@${winner._id}> (${winner.robloxUsername})` 
      : `**${topPlayerVal}**`;

    await mvpMsg.reply({
      content: `The MVP of this match according to the votes is ${winnerMention}. Congrats!`
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
    .setDescription(`**${division}**\n${teamEmoji(guild, homeKey)} **${homeTeam.name}** vs ${teamEmoji(guild, awayKey)} **${awayTeam.name}**`)
    .addFields(fields)
    .setTimestamp(utcDate);

  const fixturesCh = findChannel(guild, 'fixtures');
  if (fixturesCh) await fixturesCh.send({ embeds: [embed] });

  // Post in #referee-schedule if a referee was assigned
  if (referee) {
    const refScheduleCh = findChannel(guild, 'referee-schedule');
    if (refScheduleCh) {
      const refEmbed = new EmbedBuilder()
        .setTitle('REFEREE SCHEDULE')
        .setColor(0xFACC15)
        .addFields(
          { name: 'Game', value: `${teamEmoji(guild, homeKey)} ${homeTeam.name} vs ${teamEmoji(guild, awayKey)} ${awayTeam.name}`, inline: false },
          { name: 'Game Type', value: division === 'DIV1' ? 'Division 1' : division === 'DIV2' ? 'Division 2' : 'Cup', inline: true },
          { name: 'Date', value: datetimeStr, inline: true },
          { name: 'Referee', value: `<@${referee.id}>`, inline: false }
        );
      await refScheduleCh.send({ embeds: [refEmbed] });
    }
  }

  let scheduledEvent = null;
  try {
    let descriptionText = `${division} match — ${homeTeam.fullName} vs ${awayTeam.fullName}`;
    if (referee) descriptionText += `\nReferee: ${referee.tag}`;

    scheduledEvent = await guild.scheduledEvents.create({
      name: `${division}: ${homeTeam.name} vs ${awayTeam.name}`.slice(0, 100),
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
      { name: 'Match', value: `${teamEmoji(guild, homeKey)} ${TEAMS[homeKey].name} vs ${teamEmoji(guild, awayKey)} ${TEAMS[awayKey].name}`, inline: false },
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
        `📬 Your request of finding a referee for an **${req.gameType}** match **${homeTeam.name} vs ${awayTeam.name}** has been accepted, your referee is <@${interaction.user.id}>.`
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
  await interaction.deferReply();
  const gameId = interaction.options.getString('game');
  const rawScore = interaction.options.getString('result');

  const parts = rawScore.split('-').map(x => parseInt(x.trim()));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    return interaction.editReply('❌ Invalid result format. Please enter as `X-Y` (e.g. `2-1`).');
  }

  const [homeScore, awayScore] = parts;
  const game = await gamesCol.findOne({ _id: gameId });

  if (!game) return interaction.editReply('❌ Scheduled game not found.');

  await resultsCol.insertOne({
    gameId: game._id,
    division: game.division,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    homeScore,
    awayScore,
    createdAt: new Date()
  });

  await gamesCol.updateOne({ _id: game._id }, { $set: { completed: true } });

  const embed = new EmbedBuilder()
    .setTitle('⚽ Match Result Recorded')
    .setColor(0x00FF57)
    .setDescription(`**${TEAMS[game.homeTeam].fullName}** ${homeScore} - ${awayScore} **${TEAMS[game.awayTeam].fullName}**`)
    .setFooter({ text: `${game.division} Match Finished` });

  await interaction.editReply({ embeds: [embed] });
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

  const sortedRows = Object.values(table).sort((a, b) => 
    b.PTS - a.PTS || b.GD - a.GD || b.GF - a.GF || a.teamName.localeCompare(b.teamName)
  );

  const imageBuffer = await generateStandingsImage(title, sortedRows);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'standings.png' });

  await interaction.editReply({ files: [attachment] });
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
    await interaction.editReply('🔄 **All standings tables have been reset for a new season!**');
  } else {
    await resultsCol.deleteMany({ division: divOption });
    const divLabel = divOption === 'DIV1' ? 'Division 1' : divOption === 'DIV2' ? 'Division 2' : 'Cup';
    await interaction.editReply(`🔄 **${divLabel} standings table has been reset for a new season!**`);
  }
}

async function cmdTeamList(interaction) {
  await interaction.deferReply();
  const divKey = interaction.options.getString('division');
  const allowedTeams = DIVISIONS[divKey] || [];
  const divTitle = divKey === 'DIV1' ? 'Division 1' : 'Division 2';

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
  const games = await gamesCol.find({ guildId: interaction.guildId, completed: { $ne: true } }).toArray();

  const choices = games.map(g => ({
    name: `${g.division} | ${TEAMS[g.homeTeam]?.name} vs ${TEAMS[g.awayTeam]?.name} (${g.datetimeSwedish})`,
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
  await targetChannel.send({ embeds: [embed], components:[row] });

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
