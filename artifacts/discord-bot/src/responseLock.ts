import fs from "fs";

const LOCK_DIR = "/tmp/discord-bot-locks";

try {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
} catch {
  // already exists
}

/**
 * Atomically claims a message ID for processing using exclusive file creation.
 * Only ONE process can ever return true for a given messageId.
 */
export function claimMessage(messageId: string): boolean {
  const lockPath = `${LOCK_DIR}/${messageId}`;
  try {
    // O_EXCL | O_CREAT: fails if file already exists — atomic at OS level
    const fd = fs.openSync(lockPath, "wx");
    fs.closeSync(fd);
    // Schedule cleanup after 5 minutes
    setTimeout(() => {
      try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
    }, 5 * 60 * 1000);
    return true;
  } catch {
    // File already exists — another process claimed it
    return false;
  }
}
