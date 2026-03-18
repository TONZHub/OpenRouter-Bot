import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../data/history.json");
const MAX_HISTORY = 30;

type HistoryStore = Record<string, Message[]>;

function load(): HistoryStore {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw) as HistoryStore;
  } catch {
    return {};
  }
}

function save(store: HistoryStore): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save history:", err);
  }
}

export function getHistory(channelId: string): Message[] {
  const store = load();
  return store[channelId] ?? [];
}

export function addMessage(channelId: string, message: Message): void {
  const store = load();
  const history = store[channelId] ?? [];
  history.push(message);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  store[channelId] = history;
  save(store);
}

export function clearHistory(channelId: string): void {
  const store = load();
  delete store[channelId];
  save(store);
}
