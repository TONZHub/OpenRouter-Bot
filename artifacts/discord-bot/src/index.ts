import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { getHistory, addMessage, clearHistory } from "./conversation.js";

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY must be set.");
}

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL = "openrouter/hunter-alpha";

if (!process.env.DISCORD_BOT_TOKEN) {
  throw new Error("DISCORD_BOT_TOKEN must be set.");
}

const TOKEN = process.env.DISCORD_BOT_TOKEN;

const processedMessages = new Set<string>();

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

client.on("messageCreate", async (message) => {
  console.log(`[messageCreate] id=${message.id} author=${message.author.tag} bot=${message.author.bot}`);
  if (message.author.bot) return;

  if (processedMessages.has(message.id)) {
    console.log(`[messageCreate] DUPLICATE skipped id=${message.id}`);
    return;
  }
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 60_000);

  const mentioned =
    message.mentions.has(client.user!) ||
    (message.channel.isDMBased() && !message.author.bot);

  console.log(`[messageCreate] mentioned=${mentioned} isDM=${message.channel.isDMBased()}`);
  if (!mentioned) return;

  const content = message.content
    .replace(/<@!?\d+>/g, "")
    .trim();

  if (!content) return;

  console.log(`[messageCreate] processing message id=${message.id}`);
  try {
    await message.channel.sendTyping();

    const channelId = message.channelId;
    addMessage(channelId, { role: "user", content });

    const history = getHistory(channelId);

    const completion = await openrouter.chat.completions.create({
      model: MODEL,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    const reply = completion.choices[0]?.message?.content ?? "*static hum*";
    addMessage(channelId, { role: "assistant", content: reply });

    const chunks = splitMessage(reply);
    console.log(`[messageCreate] sending ${chunks.length} chunk(s), total length=${reply.length}`);
    await message.reply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await message.channel.send(chunks[i]);
    }
  } catch (err) {
    console.error("Error generating response:", err);
    await message.reply("*the static hum falters — something went wrong*");
  }
});

client.on("interactionCreate", async (interaction) => {
  console.log(`[interactionCreate] type=${interaction.type} isChatInput=${interaction.isChatInputCommand()}`);
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "mireo") {
    console.log(`[interactionCreate] /mireo command fired`);
    const userMessage = interaction.options.getString("message", true);
    const channelId = interaction.channelId;

    await interaction.deferReply();

    try {
      addMessage(channelId, { role: "user", content: userMessage });
      const history = getHistory(channelId);

      const completion = await openrouter.chat.completions.create({
        model: MODEL,
        max_tokens: 600,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ],
      });

      const reply = completion.choices[0]?.message?.content ?? "*static hum*";
      addMessage(channelId, { role: "assistant", content: reply });

      const chunks = splitMessage(reply);
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
    } catch (err) {
      console.error("Error generating response:", err);
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

function splitMessage(text: string, maxLength = 2000): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let cutAt = remaining.lastIndexOf("\n", maxLength);
    if (cutAt <= 0) cutAt = remaining.lastIndexOf(" ", maxLength);
    if (cutAt <= 0) cutAt = maxLength;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }
  return chunks;
}

client.login(TOKEN);
