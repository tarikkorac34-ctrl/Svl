// ============================================================
// SVL Bot — Swedish Virtual League Discord Bot
// Single-file, self-contained. Requires: discord.js ^14
// ============================================================

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  ScheduledEventEntityType,
  ScheduledEventPrivacyLevel,
  PermissionFlagsBits,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) { console.error('DISCORD_BOT_TOKEN is not set!'); process.exit(1); }

// ============================================================
// TEAM DATA
// ============================================================
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

// Choices array for slash command options
const TEAM_CHOICES = Object.entries(TEAMS).map(([key, t]) => ({
  name: `${t.name} — ${t.fullName}`,
  value: key,
}));

// ============================================================
// DATA PERSISTENCE  (players.json, games.json, pending.json)
// ============================================================
const DATA_DIR     = path.join(__dirname, 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const GAMES_FILE   = path.join(DATA_DIR, 'games.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
['{}', '[]', '{}'].forEach((def, i) => {
  const f = [PLAYERS_FILE, GAMES_FILE, PENDING_FILE][i];
  if (!fs.existsSync(f)) fs.writeFileSync(f, def);
});

const load  = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return f.endsWith('[]') ? [] : {}; } };
const save  = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const loadPlayers  = ()  => load(PLAYERS_FILE);
const savePlayers  = (d) => save(PLAYERS_FILE, d);
const loadGames    = ()  => load(GAMES_FILE);
const saveGames    = (d) => save(GAMES_FILE, d);
const loadPending  = ()  => load(PENDING_FILE);
const savePending  = (d) => save(PENDING_FILE, d);

// ============================================================
// PENDING REQUEST STORE  (survives restarts via file)
// ============================================================
function storePending(type, requesterId, targetId, targetUsername, teamKey, robloxUsername) {
  const pending = loadPending();
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  pending[id] = { type, requesterId, targetId, targetUsername, teamKey, robloxUsername };
  savePending(pending);
  // Clean entries older than 48 h
  const cutoff = Date.now() - 48 * 3600 * 1000;
  for (const [k, v] of Object.entries(pending)) {
    if (parseInt(k, 36) < cutoff) delete pending[k];
  }
  savePending(pending);
  return id;
}

function getPending(id) {
  return loadPending()[id] || null;
}

function deletePending(id) {
  const pending = loadPending();
  delete pending[id];
  savePending(pending);
}

// ============================================================
// TIME UTILITIES  (Swedish / Stockholm timezone)
// ============================================================
function lastSundayUTC(year, month0) {
  // Last Sunday of the given month (0-based)
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  last.setUTCDate(last.getUTCDate() - last.getUTCDay());
  return last;
}

function parseStockholmTime(dateStr) {
  // Input: "YYYY-MM-DD HH:MM"  (Swedish local time)
  // Returns: Date object (UTC)
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);

  // Stockholm DST: last Sunday March 02:00 → CEST (+2)
  //                last Sunday October 03:00 → CET  (+1)
  const dstStart = lastSundayUTC(y, 2); dstStart.setUTCHours(1); // 02:00 CET = 01:00 UTC
  const dstEnd   = lastSundayUTC(y, 9); dstEnd.setUTCHours(1);   // 03:00 CEST = 01:00 UTC

  // Treat the user's input naively as UTC, then decide offset
  const naive   = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const isDST   = naive >= dstStart && naive < dstEnd;
  const offset  = isDST ? 120 : 60;  // minutes ahead of UTC

  return new Date(naive.getTime() - offset * 60_000);
}

const dateOf = (s) => s.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? s;
const timeOf = (s) => s.match(/(\d{2}:\d{2})$/)?.[1] ?? s;

// ============================================================
// EMOJI & CHANNEL HELPERS
// ============================================================
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
// SLASH COMMAND DEFINITIONS
// ============================================================
const commandDefs = [
  // /teamlist  — everyone
  new SlashCommandBuilder()
    .setName('teamlist')
    .setDescription('Show all teams and their currently signed players'),

  // /game  — everyone
  new SlashCommandBuilder()
    .setName('game')
    .setDescription('Schedule a match and create a server event')
    .addStringOption(o => o.setName('competition').setDescription('Competition type').setRequired(true)
      .addChoices({ name: 'League', value: 'League' }, { name: 'Cup', value: 'Cup' }))
    .addStringOption(o => o.setName('home_team').setDescription('Home team').setRequired(true).addChoices(...TEAM_CHOICES))
    .addStringOption(o => o.setName('away_team').setDescription('Away team').setRequired(true).addChoices(...TEAM_CHOICES))
    .addStringOption(o => o.setName('datetime').setDescription('Date & time in Swedish time — YYYY-MM-DD HH:MM').setRequired(true))
    .addStringOption(o => o.setName('venue').setDescription('Match server / venue link').setRequired(true)),

  // /requestsign  — everyone
  new SlashCommandBuilder()
    .setName('requestsign')
    .setDescription('Submit a sign request for a player')
    .addStringOption(o => o.setName('team_name').setDescription('Team name').setRequired(true).addChoices(...TEAM_CHOICES))
    .addUserOption(o => o.setName('discord_username').setDescription('Player to sign').setRequired(true))
    .addStringOption(o => o.setName('roblox_username').setDescription("Player's Roblox username").setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for signing').setRequired(true)),

  // /requestrelease  — everyone
  new SlashCommandBuilder()
    .setName('requestrelease')
    .setDescription('Submit a release request for a player')
    .addStringOption(o => o.setName('team_name').setDescription('Team name').setRequired(true).addChoices(...TEAM_CHOICES))
    .addUserOption(o => o.setName('discord_username').setDescription('Player to release').setRequired(true))
    .addStringOption(o => o.setName('roblox_username').setDescription("Player's Roblox username").setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for release').setRequired(true)),

  // /player  — everyone
  new SlashCommandBuilder()
    .setName('player')
    .setDescription('Look up a player profile')
    .addUserOption(o => o.setName('discord_username').setDescription('Discord user to look up').setRequired(true)),
].map(c => c.toJSON());

// ============================================================
// CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildScheduledEvents,
  ],
});

// ============================================================
// READY — register commands & start scheduler
// ============================================================
client.once('ready', async () => {
  console.log(`✅ SVL Bot online as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('🔄 Clearing all old slash commands...');
    // Delete all global commands
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
    // Delete guild-specific commands from every guild
    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: [] });
    }
    console.log('✅ Old commands cleared');

    // Register commands per guild (instant — no 1-hour propagation delay)
    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commandDefs });
      console.log(`✅ Commands registered in guild: ${guild.name}`);
    }
  } catch (err) {
    console.error('Command registration error:', err);
  }

  startScheduler();
});

// ============================================================
// GAME NOTIFICATION SCHEDULER  (checks every 60 s)
// ============================================================
function startScheduler() {
  setInterval(async () => {
    const games = loadGames();
    const now   = Date.now();
    let dirty   = false;

    for (const game of games) {
      if (game.notified) continue;
      const matchMs  = new Date(game.utcDatetime).getTime();
      const notifyMs = matchMs - 30 * 60_000;

      if (now >= notifyMs && now < matchMs) {
        try {
          const guild = client.guilds.cache.get(game.guildId);
          if (!guild) continue;
          const ch = findChannel(guild, 'matches');
          if (!ch) { console.warn(`No #matches channel in guild ${guild.id}`); continue; }

          const svl      = svlEmoji(guild);
          const homeE    = teamEmoji(guild, game.homeTeam);
          const awayE    = teamEmoji(guild, game.awayTeam);
          const homeTeam = TEAMS[game.homeTeam];
          const awayTeam = TEAMS[game.awayTeam];

          const embed = new EmbedBuilder()
            .setTitle(`${svl} | Swedish Virtual League`)
            .setColor(0x005B9F)
            .setDescription(`${homeE} **${homeTeam?.name ?? game.homeTeam}** vs ${awayE} **${awayTeam?.name ?? game.awayTeam}**`)
            .addFields(
              { name: '🏟️ Stadium', value: game.venue,                        inline: false },
              { name: '📅 Date',    value: dateOf(game.datetimeSwedish),       inline: true  },
              { name: '⏰ KickOff', value: timeOf(game.datetimeSwedish),       inline: true  },
            )
            .setFooter({ text: `${game.competition} · Swedish Virtual League` })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Join Server').setStyle(ButtonStyle.Link).setURL(game.venue)
          );

          await ch.send({ content: '@everyone', embeds: [embed], components: [row] });
          game.notified = true;
          dirty = true;
          console.log(`📣 Match notification sent for game ${game.id}`);
        } catch (err) {
          console.error('Notification error:', err.message);
        }
      }
    }

    if (dirty) saveGames(games);
  }, 60_000);

  console.log('⏰ Match notification scheduler running');
}

// ============================================================
// INTERACTIONS
// ============================================================
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isButton())          await handleButton(interaction);
  } catch (err) {
    console.error('Interaction error:', err);
    const reply = { content: '❌ Something went wrong. Please try again.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
});

async function handleCommand(interaction) {
  switch (interaction.commandName) {
    case 'teamlist':      return cmdTeamList(interaction);
    case 'game':          return cmdGame(interaction);
    case 'requestsign':   return cmdRequestSign(interaction);
    case 'requestrelease':return cmdRequestRelease(interaction);
    case 'player':        return cmdPlayer(interaction);
  }
}

// ============================================================
// /teamlist
// ============================================================
async function cmdTeamList(interaction) {
  await interaction.deferReply();
  const players = loadPlayers();
  const { guild } = interaction;

  const embed = new EmbedBuilder()
    .setTitle('📋 SVL — Team List')
    .setColor(0x005B9F)
    .setFooter({ text: 'Swedish Virtual League' })
    .setTimestamp();

  for (const [key, team] of Object.entries(TEAMS)) {
    const em      = teamEmoji(guild, key);
    const signed  = Object.values(players).filter(p => p.team === key);
    const listing = signed.length
      ? signed.map(p => `• ${p.discordUsername}`).join('\n')
      : '*No players signed*';

    embed.addFields({ name: `${em} ${team.name} — ${team.fullName}`, value: listing, inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}

// ============================================================
// /game
// ============================================================
async function cmdGame(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const competition = interaction.options.getString('competition');
  const homeKey     = interaction.options.getString('home_team');
  const awayKey     = interaction.options.getString('away_team');
  const datetimeStr = interaction.options.getString('datetime');
  const venue       = interaction.options.getString('venue');
  const { guild }   = interaction;

  // Validate URL
  let venueUrl;
  try { venueUrl = new URL(venue); } catch {
    return interaction.editReply({ content: '❌ Venue must be a valid URL (e.g. https://discord.gg/xxx).' });
  }

  // Parse Swedish time
  const utcDate = parseStockholmTime(datetimeStr);
  if (!utcDate) {
    return interaction.editReply({ content: '❌ Invalid date format. Use: YYYY-MM-DD HH:MM  (e.g. 2025-08-15 20:00)' });
  }
  if (utcDate.getTime() < Date.now()) {
    return interaction.editReply({ content: '❌ The match time must be in the future.' });
  }

  const homeTeam = TEAMS[homeKey];
  const awayTeam = TEAMS[awayKey];
  const homeE    = teamEmoji(guild, homeKey);
  const awayE    = teamEmoji(guild, awayKey);
  const svl      = svlEmoji(guild);

  // Build the schedule embed
  const embed = new EmbedBuilder()
    .setTitle(`${svl} | Swedish Virtual League`)
    .setColor(0x005B9F)
    .setDescription(`**${competition}**\n${homeE} **${homeTeam.name}** vs ${awayE} **${awayTeam.name}**`)
    .addFields(
      { name: '🏟️ Stadium', value: venue,                  inline: false },
      { name: '📅 Date',    value: dateOf(datetimeStr),     inline: true  },
      { name: '⏰ KickOff', value: timeOf(datetimeStr),     inline: true  },
    )
    .setFooter({ text: `${competition} · Swedish Virtual League` })
    .setTimestamp(utcDate);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Join Server').setStyle(ButtonStyle.Link).setURL(venue)
  );

  // Post to #event-schedule
  const eventCh = findChannel(guild, 'event-schedule');
  if (eventCh) {
    await eventCh.send({ embeds: [embed], components: [row] });
  } else {
    console.warn(`No #event-schedule channel found in guild ${guild.id}`);
  }

  // Create Discord scheduled event
  try {
    await guild.scheduledEvents.create({
      name: `${competition}: ${homeTeam.name} vs ${awayTeam.name}`,
      scheduledStartTime: utcDate,
      privacyLevel: ScheduledEventPrivacyLevel.GuildOnly,
      entityType: ScheduledEventEntityType.External,
      entityMetadata: { location: venue },
      description:
        `${competition} match — Swedish Virtual League\n` +
        `${homeTeam.fullName} vs ${awayTeam.fullName}\n` +
        `📅 ${dateOf(datetimeStr)}  ⏰ ${timeOf(datetimeStr)} (Swedish time)`,
    });
    console.log(`📅 Scheduled event created: ${homeTeam.name} vs ${awayTeam.name}`);
  } catch (err) {
    console.error('Failed to create scheduled event:', err.message);
  }

  // Store game for 30-min notification
  const games = loadGames();
  const gameId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  games.push({
    id: gameId,
    guildId: guild.id,
    competition,
    homeTeam: homeKey,
    awayTeam: awayKey,
    utcDatetime: utcDate.toISOString(),
    datetimeSwedish: datetimeStr,
    venue,
    notified: false,
  });
  saveGames(games);

  await interaction.editReply({
    content:
      `✅ Match scheduled!\n` +
      `📢 Posted in #event-schedule\n` +
      `📅 Server event created\n` +
      `⏰ Ping in #matches 30 minutes before kickoff (${dateOf(datetimeStr)} ${timeOf(datetimeStr)} Swedish time)`,
  });
}

// ============================================================
// /requestsign
// ============================================================
async function cmdRequestSign(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const teamKey      = interaction.options.getString('team_name');
  const target       = interaction.options.getUser('discord_username');
  const robloxUser   = interaction.options.getString('roblox_username');
  const reason       = interaction.options.getString('reason');
  const { guild }    = interaction;
  const team         = TEAMS[teamKey];

  // Block if player is already signed to any team
  const players = loadPlayers();
  const existing = players[target.id];
  if (existing && existing.team) {
    const currentTeam = TEAMS[existing.team];
    return interaction.editReply({
      content: `❌ **${target.username}** is already signed to **${currentTeam?.fullName ?? existing.team}**. They must be released first before signing to another club.`,
    });
  }

  const staffCh = findChannel(guild, 'staff-regging');
  if (!staffCh) return interaction.editReply({ content: '❌ Could not find the #staff-regging channel.' });

  const pendingId = storePending('sign', interaction.user.id, target.id, target.username, teamKey, robloxUser);

  const embed = new EmbedBuilder()
    .setTitle('📥 SIGN REQUEST')
    .setColor(0x1A8F3C)
    .addFields(
      { name: 'Team',             value: `${team.name} — ${team.fullName}`, inline: false },
      { name: 'Discord Username', value: target.username,                   inline: true  },
      { name: 'Roblox Username',  value: robloxUser,                        inline: true  },
      { name: 'Reason',           value: reason,                            inline: false },
      { name: 'Requested by',     value: interaction.user.username,         inline: false },
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`decline:${pendingId}`).setLabel('✗  DECLINE').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`accept:${pendingId}` ).setLabel('✓  ACCEPT' ).setStyle(ButtonStyle.Success),
  );

  await staffCh.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: '✅ Your sign request has been submitted to staff!' });
}

// ============================================================
// /requestrelease
// ============================================================
async function cmdRequestRelease(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const teamKey      = interaction.options.getString('team_name');
  const target       = interaction.options.getUser('discord_username');
  const robloxUser   = interaction.options.getString('roblox_username');
  const reason       = interaction.options.getString('reason');
  const { guild }    = interaction;
  const team         = TEAMS[teamKey];

  const staffCh = findChannel(guild, 'staff-regging');
  if (!staffCh) return interaction.editReply({ content: '❌ Could not find the #staff-regging channel.' });

  const pendingId = storePending('release', interaction.user.id, target.id, target.username, teamKey, robloxUser);

  const embed = new EmbedBuilder()
    .setTitle('📤 RELEASE REQUEST')
    .setColor(0xC0392B)
    .addFields(
      { name: 'Team',             value: `${team.name} — ${team.fullName}`, inline: false },
      { name: 'Discord Username', value: target.username,                   inline: true  },
      { name: 'Roblox Username',  value: robloxUser,                        inline: true  },
      { name: 'Reason',           value: reason,                            inline: false },
      { name: 'Requested by',     value: interaction.user.username,         inline: false },
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`decline:${pendingId}`).setLabel('✗  DECLINE').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`accept:${pendingId}` ).setLabel('✓  ACCEPT' ).setStyle(ButtonStyle.Success),
  );

  await staffCh.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: '✅ Your release request has been submitted to staff!' });
}

// ============================================================
// /player
// ============================================================
async function cmdPlayer(interaction) {
  await interaction.deferReply();

  const target    = interaction.options.getUser('discord_username');
  const { guild } = interaction;
  const players   = loadPlayers();
  const data      = players[target.id];
  const teamKey   = data?.team ?? null;
  const team      = teamKey ? TEAMS[teamKey] : null;

  const statusText = team ? 'Signed' : 'F/A';
  const teamText   = team ? `${teamEmoji(guild, teamKey)} ${team.name}` : 'N/A';

  const embed = new EmbedBuilder()
    .setTitle(`${target.username}'s SVL Player Profile`)
    .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
    .setColor(0x00FF57)   // bright green bar matching the screenshot
    .addFields(
      { name: 'Discord Username', value: target.username,            inline: false },
      { name: 'Roblox Username',  value: data?.robloxUsername ?? 'N/A', inline: false },
      { name: 'Status',           value: statusText,                 inline: false },
      { name: 'Team',             value: teamText,                   inline: false },
      { name: 'Season',           value: '1',                        inline: false },
    );

  await interaction.editReply({ embeds: [embed] });
}

// ============================================================
// BUTTON HANDLER  (Accept / Decline for sign & release)
// ============================================================
async function handleButton(interaction) {
  const [action, pendingId] = interaction.customId.split(':');
  const req = getPending(pendingId);

  if (!req) {
    return interaction.reply({ content: '⚠️ This request has already been handled or has expired.', ephemeral: true });
  }

  const requester = await client.users.fetch(req.requesterId).catch(() => null);
  const target    = await client.users.fetch(req.targetId).catch(() => null);
  const team      = TEAMS[req.teamKey];
  const isSign    = req.type === 'sign';

  if (action === 'accept') {
    // Update player data
    const players = loadPlayers();
    if (isSign) {
      players[req.targetId] = {
        discordId:       req.targetId,
        discordUsername: req.targetUsername,
        robloxUsername:  req.robloxUsername,
        team:            req.teamKey,
      };
    } else {
      // Release: keep player record but clear team
      if (players[req.targetId]) {
        players[req.targetId].team = null;
      }
    }
    savePlayers(players);

    // DM the requester
    const verb = isSign ? 'signing' : 'releasing';
    if (requester) {
      await requester.send(
        `✅ Your request to ${isSign ? 'sign' : 'release'} **${req.targetUsername}** ` +
        `${isSign ? `to **${team?.fullName ?? req.teamKey}**` : `from **${team?.fullName ?? req.teamKey}**`} ` +
        `has been **accepted**! ✓`
      ).catch(() => {});
    }

    // Update the embed to show accepted state
    const oldEmbed = interaction.message.embeds[0];
    const updated  = EmbedBuilder.from(oldEmbed)
      .setColor(0x1A8F3C)
      .setFooter({ text: `✓ Accepted by ${interaction.user.username}` });

    await interaction.update({ embeds: [updated], components: [] });

  } else if (action === 'decline') {
    // DM the requester
    if (requester) {
      await requester.send(
        `✗ Your request to ${isSign ? 'sign' : 'release'} **${req.targetUsername}** ` +
        `has been **declined**. ✗`
      ).catch(() => {});
    }

    // Update the embed to show declined state
    const oldEmbed = interaction.message.embeds[0];
    const updated  = EmbedBuilder.from(oldEmbed)
      .setColor(0xC0392B)
      .setFooter({ text: `✗ Declined by ${interaction.user.username}` });

    await interaction.update({ embeds: [updated], components: [] });
  }

  // Remove from pending store
  deletePending(pendingId);
}

// ============================================================
// LOGIN
// ============================================================
client.login(TOKEN);
