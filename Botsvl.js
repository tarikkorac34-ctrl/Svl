// ============================================================
// SVL Bot — Swedish Virtual League Discord Bot (MongoDB Version)
// Requires: discord.js ^14, mongodb ^6, @napi-rs/canvas ^0.1.52
// ============================================================

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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

if (!TOKEN) { console.error('DISCORD_BOT_TOKEN is not set!'); process.exit(1); }
if (!MONGO_URI) { console.error('MONGODB_URI is not set!'); process.exit(1); }

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
let db, playersCol, gamesCol, pendingCol, resultsCol;

async function connectDB() {
  try {
    await mongoClient.connect();
    db = mongoClient.db('svl_database');
    playersCol = db.collection('players');
    gamesCol   = db.collection('games');
    pendingCol = db.collection('pending');
    resultsCol = db.collection('results');

    await pendingCol.createIndex({ createdAt: 1 }, { expireAfterSeconds: 172800 });
    console.log('✅ Connected to MongoDB Atlas successfully!');
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
}

// ============================================================
// DIVISION & TEAMS DATA
// ============================================================
const DIVISIONS = {
  DIV1: ['DIF', 'GAIS', 'IKS', 'IFK', 'OIS', 'MAIF', 'HAIF', 'MFF'],
  DIV2: ['IFE', 'AIK', 'OSK', 'HIF']
};

const IMAGE_ASSETS = {
  DIV1: 'https://i.imgur.com/hbGRvdD.png',
  DIV2: 'https://i.imgur.com/0y50D4Y.png',
  CUP:  'https://i.imgur.com/wIqQ0Mc.png',
  EMPTY:'https://i.imgur.com/DDObeXl.png'
};

const TEAMS = {
  GAIS: { name: 'GAIS', emojiName: 'Gais',          fullName: 'GAIS'           },
  IKS:  { name: 'IKS',  emojiName: 'IKSirius',      fullName: 'IK Sirius'      },
  AIK:  { name: 'AIK',  emojiName: 'AIK',            fullName: 'AIK'            },
  DIF:  { name: 'DIF',  emojiName: 'DjurgardensIF',  fullName: 'Djurgårdens IF' },
  HAIF: { name: 'HAIF', emojiName: 'HammarbyIF',     fullName: 'Hammarby IF'    },
  HIF:  { name: 'HIF',  emojiName: 'HelsingborgsIF', fullName: 'Helsingborgs IF'},
  IFE:  { name: 'IFE',  emojiName: 'IFElfsborg',     fullName: 'IF Elfsborg'    },
  IFK:  { name: 'IFK',  emojiName: 'IFKGoteborg',    fullName: 'IFK Göteborg'   },
  MFF:  { name: 'MFF',  emojiName: 'MalmoFF',        fullName: 'Malmö FF'       },
  MAIF: { name: 'MAIF', emojiName: 'MjallbyAIF',     fullName: 'Mjällby AIF'    },
  OSK:  { name: 'ÖSK',  emojiName: 'OrebroSK',       fullName: 'Örebro SK'      },
  OIS:  { name: 'ÖIS',  emojiName: 'OrgryteIS',      fullName: 'Örgryte IS'     },
};

const TEAM_CHOICES = Object.entries(TEAMS).map(([key, t]) => ({
  name: `${t.name} — ${t.fullName}`,
  value: key,
}));

// ============================================================
// PENDING REQUEST STORE (MongoDB Driven)
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

function teamEmoji(guild, key) {
  const t = TEAMS[key];
  if (!t) return `[${key}]`;
  if (!guild) return `:${t.emojiName}:`;
  const e = guild.emojis.cache.find(em => em.name === t.emojiName);
  return e ? e.toString() : `:${t.emojiName}:`;
}

function svlEmoji(guild) {
  const e = guild?.emojis.cache.find(em => em.name === 'SVL');
  return e ? e.toString() : '⚽';
}

function findChannel(guild, name) {
  return guild.channels.cache.find(c => c.name === name && c.isTextBased());
}

// ============================================================
// CANVAS TABLE RENDERER
// ============================================================
async function generateStandingsImage(title, rows) {
  let bgImage = null;
  try {
    bgImage = await loadImage(IMAGE_ASSETS.EMPTY);
  } catch (err) {
    console.error('⚠️ Could not load background image asset, using solid background fallback:', err);
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

  // Card Container
  ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
  ctx.roundRect(40, 40, canvasWidth - 80, canvasHeight - 80, 16);
  ctx.fill();

  ctx.textBaseline = 'middle';

  // Registered Font Definitions
  const fontMain = '22px SVLFont, sans-serif';
  const fontTitle = '36px SVLFont, sans-serif';
  const fontHeader = '20px SVLFont, sans-serif';

  // 1. Header Title
  ctx.fillStyle = '#FFFFFF';
  ctx.font = fontTitle;
  ctx.textAlign = 'center';
  ctx.fillText(title.toUpperCase(), canvasWidth / 2, 90);

  // 2. Column Headers
  const startY = 150;
  const rowHeight = 55;

  ctx.font = fontHeader;
  ctx.fillStyle = '#38BDF8';

  ctx.textAlign = 'left';
  ctx.fillText('POS', 70, startY);
  ctx.fillText('TEAM', 150, startY);

  ctx.textAlign = 'right';
  ctx.fillText('GP', 500, startY);
  ctx.fillText('W', 570, startY);
  ctx.fillText('D', 640, startY);
  ctx.fillText('L', 710, startY);
  ctx.fillText('GD', 790, startY);
  ctx.fillText('PTS', 880, startY);

  // Divider Line
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, startY + 20);
  ctx.lineTo(canvasWidth - 60, startY + 20);
  ctx.stroke();

  // 3. Rows
  rows.forEach((row, index) => {
    const y = startY + 60 + (index * rowHeight);

    if (index % 2 === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(60, y - 22, canvasWidth - 120, rowHeight - 8);
    }

    ctx.font = fontMain;
    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'left';
    ctx.fillText(`${index + 1}`, 80, y);
    ctx.fillText(`${row.teamName}`, 150, y);

    ctx.textAlign = 'right';
    ctx.fillText(`${row.GP}`, 500, y);
    ctx.fillText(`${row.W}`, 570, y);
    ctx.fillText(`${row.D}`, 640, y);
    ctx.fillText(`${row.L}`, 710, y);

    if (row.GD > 0) ctx.fillStyle = '#4ADE80';
    else if (row.GD < 0) ctx.fillStyle = '#F87171';
    else ctx.fillStyle = '#94A3B8';

    ctx.fillText(`${row.GD > 0 ? '+' + row.GD : row.GD}`, 790, y);

    ctx.fillStyle = '#FACC15';
    ctx.font = fontMain;
    ctx.fillText(`${row.PTS}`, 880, y);
  });

  return canvas.toBuffer('image/png');
}

// ============================================================
// COMMAND DEFINITIONS
// ============================================================
const commandDefs = [
  new SlashCommandBuilder()
    .setName('teamlist')
    .setDescription('Show all teams and their currently signed players'),

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
    .addStringOption(o => o.setName('venue').setDescription('Match server / venue link').setRequired(true)),

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
        { name: 'Division 2', value: 'DIV2' }
      )),

  new SlashCommandBuilder()
    .setName('resettable')
    .setDescription('Reset standings for a new season (Staff/Admin Only)')
    .addStringOption(o => o.setName('division').setDescription('Division to reset').setRequired(true)
      .addChoices(
        { name: 'Division 1', value: 'DIV1' },
        { name: 'Division 2', value: 'DIV2' },
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
    .addStringOption(o => o.setName('roblox_username').setDescription("Player's Roblox username").setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for signing').setRequired(true)),

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
// SCHEDULER
// ============================================================
function startScheduler() {
  setInterval(async () => {
    const now = Date.now();
    const unnotifiedGames = await gamesCol.find({ notified: false }).toArray();

    for (const game of unnotifiedGames) {
      const matchMs  = new Date(game.utcDatetime).getTime();
      const notifyMs = matchMs - 30 * 60_000;

      if (now >= notifyMs && now < matchMs) {
        try {
          const guild = client.guilds.cache.get(game.guildId);
          if (!guild) continue;
          const ch = findChannel(guild, 'matches');
          if (!ch) continue;

          const svl   = svlEmoji(guild);
          const homeE = teamEmoji(guild, game.homeTeam);
          const awayE = teamEmoji(guild, game.awayTeam);

          const embed = new EmbedBuilder()
            .setTitle(`${svl} | Swedish Virtual League`)
            .setColor(0x005B9F)
            .setDescription(`${homeE} **${TEAMS[game.homeTeam]?.name}** vs ${awayE} **${TEAMS[game.awayTeam]?.name}**`)
            .addFields(
              { name: '🏟️ Stadium', value: game.venue, inline: false },
              { name: '📅 Date', value: dateOf(game.datetimeSwedish), inline: true },
              { name: '⏰ KickOff', value: timeOf(game.datetimeSwedish), inline: true }
            )
            .setFooter({ text: `${game.division} · Swedish Virtual League` });

          await ch.send({ embeds: [embed] });
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
        case 'result':         return await cmdResult(interaction);
        case 'standings':      return await cmdStandings(interaction);
        case 'resettable':     return await cmdResetTable(interaction);
        case 'cancelgame':     return await cmdCancelGame(interaction);
        case 'requestsign':    return await cmdRequestSign(interaction);
        case 'requestrelease': return await cmdRequestRelease(interaction);
        case 'player':         return await cmdPlayer(interaction);
      }
    }
    if (interaction.isAutocomplete()) {
      if (['cancelgame', 'result'].includes(interaction.commandName)) {
        return await handleGameAutocomplete(interaction);
      }
    }
    if (interaction.isButton()) {
      return await handleButton(interaction);
    }
  } catch (err) {
    console.error('Interaction Exception:', err);
  }
});

// ============================================================
// COMMAND IMPLEMENTATIONS
// ============================================================

async function cmdGame(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const division    = interaction.options.getString('division');
  const homeKey     = interaction.options.getString('home_team');
  const awayKey     = interaction.options.getString('away_team');
  const datetimeStr = interaction.options.getString('datetime');
  const venue       = interaction.options.getString('venue');
  const { guild }   = interaction;

  const utcDate = parseStockholmTime(datetimeStr);
  if (!utcDate) return interaction.editReply({ content: '❌ Invalid date format (YYYY-MM-DD HH:MM)' });

  const homeTeam = TEAMS[homeKey];
  const awayTeam = TEAMS[awayKey];

  const embed = new EmbedBuilder()
    .setTitle(`${svlEmoji(guild)} | Swedish Virtual League`)
    .setColor(0x005B9F)
    .setDescription(`**${division}**\n${teamEmoji(guild, homeKey)} **${homeTeam.name}** vs ${teamEmoji(guild, awayKey)} **${awayTeam.name}**`)
    .addFields(
      { name: '🏟️ Stadium', value: venue, inline: false },
      { name: '📅 Date', value: dateOf(datetimeStr), inline: true },
      { name: '⏰ KickOff', value: timeOf(datetimeStr), inline: true }
    )
    .setImage(IMAGE_ASSETS[division] || null)
    .setTimestamp(utcDate);

  const eventCh = findChannel(guild, 'event-schedule');
  if (eventCh) await eventCh.send({ embeds: [embed] });

  let scheduledEvent = null;
  try {
    scheduledEvent = await guild.scheduledEvents.create({
      name: `${division}: ${homeTeam.name} vs ${awayTeam.name}`.slice(0, 100),
      scheduledStartTime: new Date(Math.max(utcDate.getTime(), Date.now() + 60_000)),
      scheduledEndTime: new Date(utcDate.getTime() + 2 * 3600_000),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: venue.slice(0, 100) },
      description: `${division} match — ${homeTeam.fullName} vs ${awayTeam.fullName}`
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
    completed: false,
    notified: false,
  });

  await interaction.editReply({ content: '✅ Match scheduled successfully!' });
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
  const allowedTeams = DIVISIONS[divKey] || [];

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

  const title = divKey === 'DIV1' ? 'Division 1 Standings' : 'Division 2 Standings';

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
    const divLabel = divOption === 'DIV1' ? 'Division 1' : 'Division 2';
    await interaction.editReply(`🔄 **${divLabel} standings table has been reset for a new season!**`);
  }
}

async function cmdTeamList(interaction) {
  await interaction.deferReply();
  const allPlayers = await playersCol.find({ team: { $ne: null } }).toArray();

  const embed = new EmbedBuilder().setTitle('📋 SVL — Team Roster').setColor(0x005B9F);

  for (const [key, team] of Object.entries(TEAMS)) {
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
        { $set: { discordUsername: req.targetUsername, robloxUsername: req.robloxUsername, team: req.teamKey } },
        { upsert: true }
      );
    } else {
      await playersCol.updateOne({ _id: req.targetId }, { $set: { team: null } });
    }
  }

  await deletePending(pendingId);
  await interaction.update({ content: `✅ Request ${action}ed!`, components: [], embeds: [] });
}

// --- /requestsign ---
async function cmdRequestSign(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const teamKey = interaction.options.getString('team_name');
  const targetUser = interaction.options.getUser('discord_username');
  const robloxUser = interaction.options.getString('roblox_username');
  const reason = interaction.options.getString('reason');

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

  await interaction.editReply({ content: '✅ Sign request submitted successfully!' });
}

// --- /requestrelease ---
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
  const p = await playersCol.findOne({ _id: target.id });
  const embed = new EmbedBuilder()
    .setTitle(`${target.username}'s SVL Profile`)
    .addFields(
      { name: 'Team', value: p?.team ? TEAMS[p.team].fullName : 'Free Agent' },
      { name: 'Roblox User', value: p?.robloxUsername || 'N/A' }
    );
  await i.editReply({ embeds: [embed] });
}

async function cmdCancelGame(i) {
  await i.deferReply({ ephemeral: true });
  const id = i.options.getString('game');
  await gamesCol.deleteOne({ _id: id });
  await i.editReply('✅ Game cancelled.');
}

client.login(TOKEN);
