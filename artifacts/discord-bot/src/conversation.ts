export interface Message {
  role: "user" | "assistant";
  content: string;
}

const histories = new Map<string, Message[]>();

const MAX_HISTORY = 20;

export function getHistory(channelId: string): Message[] {
  return histories.get(channelId) ?? [];
}

export function addMessage(channelId: string, message: Message): void {
  const history = histories.get(channelId) ?? [];
  history.push(message);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  histories.set(channelId, history);
}

export function clearHistory(channelId: string): void {
  histories.delete(channelId);
}
