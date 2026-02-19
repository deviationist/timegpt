// TimeGPT — Runs in MAIN world (page context) at document_start.
// Patches fetch to intercept conversation API responses and extract timestamps.

import type { MessageTimestamp, ConversationTimestamp } from "./types";

(function () {
  "use strict";

  if (__DEBUG__) console.log("[TimeGPT] Interceptor loaded in MAIN world");

  const timestampBuffer: Record<string, MessageTimestamp> = {};
  const conversationBuffer: Record<string, ConversationTimestamp> = {};

  const originalFetch = window.fetch;

  window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
    let url = "";
    try {
      const input = args[0];
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof Request) {
        url = input.url;
      } else if (input instanceof URL) {
        url = input.href;
      }
    } catch {
      // ignore
    }

    const response = await originalFetch.apply(this, args);

    // Match conversation detail endpoint: /backend-api/conversation/{uuid}
    if (
      /\/backend-api\/conversation\/[0-9a-f-]{20,}/.test(url) &&
      !url.includes("/backend-api/conversation/limit") &&
      !url.includes("/backend-api/conversations")
    ) {
      try {
        const cloned = response.clone();
        const json = await cloned.json();
        extractMessageTimestamps(json);
      } catch {
        // ignore
      }
    }

    // Match conversations list endpoint: /backend-api/conversations?...
    if (/\/backend-api\/conversations(\?|$)/.test(url)) {
      try {
        const cloned = response.clone();
        const json = await cloned.json();
        extractConversationTimestamps(json);
      } catch {
        // ignore
      }
    }

    return response;
  };

  interface ConversationDetailResponse {
    mapping?: Record<
      string,
      {
        message?: {
          id?: string;
          create_time?: number | null;
          author?: { role?: string };
        };
      }
    >;
  }

  function extractMessageTimestamps(data: ConversationDetailResponse): void {
    if (!data?.mapping) return;

    const timestamps: Record<string, MessageTimestamp> = {};
    let count = 0;

    for (const [_nodeId, node] of Object.entries(data.mapping)) {
      const msg = node.message;
      if (!msg?.id || msg.create_time == null) continue;

      timestamps[msg.id] = {
        createTime: msg.create_time,
        role: msg.author?.role || null,
      };
      count++;
    }

    if (count === 0) return;

    if (__DEBUG__) console.log(`[TimeGPT] Captured ${count} message timestamps`);
    Object.assign(timestampBuffer, timestamps);
    window.postMessage(
      { type: "TIMEGPT_TIMESTAMPS", timestamps },
      window.location.origin
    );
  }

  interface ConversationsListResponse {
    items?: Array<{
      id?: string;
      create_time?: string;
      update_time?: string | null;
      title?: string | null;
    }>;
  }

  function extractConversationTimestamps(data: ConversationsListResponse): void {
    if (!data?.items || !Array.isArray(data.items)) return;

    const conversations: Record<string, ConversationTimestamp> = {};
    let count = 0;

    for (const item of data.items) {
      if (!item.id || !item.create_time) continue;
      conversations[item.id] = {
        createTime: item.create_time,
        updateTime: item.update_time || null,
        title: item.title || null,
      };
      count++;
    }

    if (count === 0) return;

    if (__DEBUG__) console.log(`[TimeGPT] Captured ${count} conversation timestamps`);
    Object.assign(conversationBuffer, conversations);
    window.postMessage(
      { type: "TIMEGPT_CONVERSATIONS", conversations },
      window.location.origin
    );
  }
  // Listen for drain requests from the content script (ISOLATED world).
  // This avoids inline script injection which violates CSP.
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== "TIMEGPT_DRAIN_REQUEST") return;

    if (Object.keys(timestampBuffer).length > 0) {
      window.postMessage(
        { type: "TIMEGPT_TIMESTAMPS", timestamps: timestampBuffer },
        window.location.origin
      );
    }
    if (Object.keys(conversationBuffer).length > 0) {
      window.postMessage(
        { type: "TIMEGPT_CONVERSATIONS", conversations: conversationBuffer },
        window.location.origin
      );
    }
  });
})();
