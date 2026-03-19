import http from "http";
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import OpenAI from "openai";
import { SYSTEM_PROMPT, FORMAT_INSTRUCTION } from "./systemPrompt.js";
import { getHistory, addMessage, clearHistory } from "./conversation.js";
import { claimMessage } from "./responseLock.js";

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY must be set.");
}

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL = "openrouter/hunter-alpha";
const FULL_SYSTEM_PROMPT = SYSTEM_PROMPT + "\n" + FORMAT_INSTRUCTION;

if (!process.env.DISCORD_BOT_TOKEN) {
  throw new Error("DISCORD_BOT_TOKEN must be set.");
}

const TOKEN = process.env.DISCORD_BOT_TOKEN;

const commands = [
  new SlashCommandBuilder()
    .setName("mireo")
    .setDescription("Speak with Mireo // Silt")
    .addStringOption((opt) =>
      opt.setName("message").setDescription("What would you like to say?").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("clearmemory")
    .setDescription("Clear Mireo // Silt's memory for this channel"),
].map((c) => c.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once("ready", async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(readyClient.user.id), {
      body: commands,
    });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
});

function parseVoices(raw: string): { mireo: string; silt: string } {
  const mireoMatch = raw.match(/\[MIREO\]\s*([\s\S]*?)(?=\[SILT\]|$)/i);
  const siltMatch = raw.match(/\[SILT\]\s*([\s\S]*?)$/i);
  const mireo = mireoMatch?.[1]?.trim() || raw.trim();
  const silt = siltMatch?.[1]?.trim() || "";
  return { mireo, silt };
}

async function getCompletion(channelId: string, userContent: string, username?: string): Promise<{ mireo: string; silt: string }> {
  const taggedContent = username ? `[${username}]: ${userContent}` : userContent;
  addMessage(channelId, { role: "user", content: taggedContent });
  const history = getHistory(channelId);

  const completion = await openrouter.chat.completions.create({
    model: MODEL,
    max_tokens: 800,
    messages: [
      { role: "system", content: FULL_SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "*static hum*\n\n[SILT]\n*the flavor's gone quiet*";
  addMessage(channelId, { role: "assistant", content: raw });
  return parseVoices(raw);
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!claimMessage(message.id)) return;

  const mentioned =
    message.mentions.has(client.user!) ||
    (message.channel.isDMBased() && !message.author.bot);

  if (!mentioned) return;

  const content = message.content.replace(/<@!?\d+>/g, "").trim();
  if (!content) return;

  try {
    await message.channel.sendTyping();
    const { mireo, silt } = await getCompletion(message.channelId, content, message.author.username);

    await message.reply(`**Mireo —**\n${mireo}`);
    if (silt) await message.channel.send(`**Silt —**\n${silt}`);
  } catch (err) {
    console.error("Error:", err);
    await message.reply("*the static hum falters — something went wrong*");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "mireo") {
    const userMessage = interaction.options.getString("message", true);
    await interaction.deferReply();

    try {
      const { mireo, silt } = await getCompletion(interaction.channelId, userMessage, interaction.user.username);
      await interaction.editReply(`**Mireo —**\n${mireo}`);
      if (silt) await interaction.followUp(`**Silt —**\n${silt}`);
    } catch (err) {
      console.error("Error:", err);
      await interaction.editReply("*the static hum falters — something went wrong*");
    }
  }

  if (interaction.commandName === "clearmemory") {
    clearHistory(interaction.channelId);
    await interaction.reply({
      content: "*the threads unravel and resettle — memory cleared for this channel*",
      flags: MessageFlags.Ephemeral,
    });
  }
});

process.on("SIGTERM", () => {
  client.destroy();
  process.exit(0);
});

process.on("SIGINT", () => {
  client.destroy();
  process.exit(0);
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
http.createServer((_, res) => {
  res.writeHead(200);
  res.end("Mireo // Silt is online.");
}).listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});

client.login(TOKEN);
