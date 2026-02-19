// Shared type definitions for TimeGPT

export interface MessageTimestamp {
  createTime: number;
  role: string | null;
}

export interface ConversationTimestamp {
  createTime: string;
  updateTime: string | null;
  title: string | null;
}

export type TimestampFormat =
  | "relative"
  | "datetime24"
  | "datetime12"
  | "time24"
  | "time12"
  | "iso";

export interface TimegptSettings {
  timestampFormat: TimestampFormat;
  showMessageTimestamps: boolean;
  showSidebarTimestamps: boolean;
}

export interface TimegptTimestampsMessage {
  type: "TIMEGPT_TIMESTAMPS";
  timestamps: Record<string, MessageTimestamp>;
}

export interface TimegptConversationsMessage {
  type: "TIMEGPT_CONVERSATIONS";
  conversations: Record<string, ConversationTimestamp>;
}
