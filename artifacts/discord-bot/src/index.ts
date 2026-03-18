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
import { openrouter } from "@workspace/integrations-openrouter-ai";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { getHistory, addMessage, clearHistory } from "./conversation.js";

const MODEL = "openrouter/hunter-alpha";

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

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const mentioned =
    message.mentions.has(client.user!) ||
    (message.channel.isDMBased() && !message.author.bot);

  if (!mentioned) return;

  const content = message.content
    .replace(/<@!?\d+>/g, "")
    .trim();

  if (!content) return;

  try {
    await message.channel.sendTyping();

    const channelId = message.channelId;
    addMessage(channelId, { role: "user", content });

    const history = getHistory(channelId);

    const completion = await openrouter.chat.completions.create({
      model: MODEL,
      max_tokens: 8192,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    const reply = completion.choices[0]?.message?.content ?? "*static hum*";
    addMessage(channelId, { role: "assistant", content: reply });

    const chunks = splitMessage(reply);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  } catch (err) {
    console.error("Error generating response:", err);
    await message.reply("*the static hum falters — something went wrong*");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "mireo") {
    const userMessage = interaction.options.getString("message", true);
    const channelId = interaction.channelId;

    await interaction.deferReply();

    try {
      addMessage(channelId, { role: "user", content: userMessage });
      const history = getHistory(channelId);

      const completion = await openrouter.chat.completions.create({
        model: MODEL,
        max_tokens: 8192,
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
