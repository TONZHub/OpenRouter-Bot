import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

const MAX_HISTORY = 30;

const USE_DB = !!process.env.DATABASE_URL;

let pool: pg.Pool | null = null;

async function getPool(): Promise<pg.Pool> {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        channel_id TEXT NOT NULL,
        idx        INTEGER NOT NULL,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        PRIMARY KEY (channel_id, idx)
      )
    `);
  }
  return pool;
}

async function dbGetHistory(channelId: string): Promise<Message[]> {
  const db = await getPool();
  const { rows } = await db.query(
    `SELECT role, content FROM conversation_history
     WHERE channel_id = $1 ORDER BY idx ASC`,
    [channelId]
  );
  return rows as Message[];
}

async function dbAddMessage(channelId: string, message: Message): Promise<void> {
  const db = await getPool();
  const history = await dbGetHistory(channelId);
  history.push(message);
  const trimmed = history.slice(-MAX_HISTORY);

  await db.query(`DELETE FROM conversation_history WHERE channel_id = $1`, [channelId]);
  for (let i = 0; i < trimmed.length; i++) {
    await db.query(
      `INSERT INTO conversation_history (channel_id, idx, role, content) VALUES ($1, $2, $3, $4)`,
      [channelId, i, trimmed[i].role, trimmed[i].content]
    );
  }
}

async function dbClearHistory(channelId: string): Promise<void> {
  const db = await getPool();
  await db.query(`DELETE FROM conversation_history WHERE channel_id = $1`, [channelId]);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../data/history.json");

type HistoryStore = Record<string, Message[]>;

function fileLoad(): HistoryStore {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as HistoryStore;
  } catch {
    return {};
  }
}

function fileSave(store: HistoryStore): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save history:", err);
  }
}

export async function getHistory(channelId: string): Promise<Message[]> {
  if (USE_DB) return dbGetHistory(channelId);
  return fileLoad()[channelId] ?? [];
}

export async function addMessage(channelId: string, message: Message): Promise<void> {
  if (USE_DB) return dbAddMessage(channelId, message);
  const store = fileLoad();
  const history = store[channelId] ?? [];
  history.push(message);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  store[channelId] = history;
  fileSave(store);
}

export async function clearHistory(channelId: string): Promise<void> {
  if (USE_DB) return dbClearHistory(channelId);
  const store = fileLoad();
  delete store[channelId];
  fileSave(store);
}
