import { formatMessageTime, parseLegacyChatTime } from './timeFormat';

export type ChatMessage = {
  id: string;
  text?: string;
  image?: string;
  voice?: string;
  imageWidth?: number;
  imageHeight?: number;
  sender: 'me' | 'other';
  createdAt: number;
  time?: string;
  replyTo?: ChatMessage;
  isDeleted?: boolean;
};

export function createMessage(
  partial: Omit<ChatMessage, 'createdAt'> & { createdAt?: number }
): ChatMessage {
  const createdAt = partial.createdAt ?? Date.now();
  return {
    ...partial,
    createdAt,
    time: formatMessageTime(createdAt),
  };
}

/** Upgrade stored messages (old `time`-only format) */
export function normalizeStoredMessage(raw: Record<string, unknown>): ChatMessage {
  let createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : 0;
  if (!createdAt) {
    createdAt = parseLegacyChatTime(raw.time as string);
  }
  return createMessage({
    id: String(raw.id),
    text: raw.text as string | undefined,
    image: raw.image as string | undefined,
    voice: raw.voice as string | undefined,
    imageWidth: raw.imageWidth as number | undefined,
    imageHeight: raw.imageHeight as number | undefined,
    sender: raw.sender as 'me' | 'other',
    createdAt,
    replyTo: raw.replyTo ? normalizeStoredMessage(raw.replyTo as Record<string, unknown>) : undefined,
    isDeleted: Boolean(raw.isDeleted),
  });
}

export function normalizeStoredMessages(raw: unknown[]): ChatMessage[] {
  return raw.map((m) => normalizeStoredMessage(m as Record<string, unknown>));
}

export function getMessageDisplayTime(message: ChatMessage): string {
  return formatMessageTime(message.createdAt);
}
