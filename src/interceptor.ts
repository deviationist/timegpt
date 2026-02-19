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

    // Match streaming conversation endpoint: /backend-api/f/conversation
    // Tap into the SSE stream to extract timestamps from new messages.
    if (
      /\/backend-api\/f\/conversation$/.test(url) &&
      response.body &&
      response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      try {
        return tapSSEStream(response);
      } catch {
        // ignore — return original response
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
  // --- SSE stream tapping for live messages ---
  // Wraps the response body to peek at SSE events without consuming them.
  function tapSSEStream(response: Response): Response {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          // Process any remaining buffer
          if (buffer.length > 0) processSSEBuffer(buffer);
          controller.close();
          return;
        }
        // Decode chunk and accumulate for SSE parsing
        buffer += decoder.decode(value, { stream: true });
        // Process complete SSE events (separated by double newlines)
        const parts = buffer.split("\n\n");
        // Keep the last incomplete part in the buffer
        buffer = parts.pop() || "";
        for (const part of parts) {
          processSSEEvent(part);
        }
        // Pass the original bytes through untouched
        controller.enqueue(value);
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  function processSSEBuffer(buf: string): void {
    const parts = buf.split("\n\n");
    for (const part of parts) {
      processSSEEvent(part);
    }
  }

  function processSSEEvent(raw: string): void {
    // SSE format: "data: {json}\n" or "event: type\ndata: {json}\n"
    // ChatGPT uses a custom format where each line is like:
    //   data: {"type": "input_message", ...}
    // or for deltas the event field indicates the type.
    // We look for JSON payloads in "data:" lines.
    let jsonStr = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("data: ")) {
        jsonStr = line.slice(6);
      }
    }
    if (!jsonStr || jsonStr === "[DONE]") return;

    try {
      const data = JSON.parse(jsonStr);
      extractStreamTimestamp(data);
    } catch {
      // not JSON, ignore
    }
  }

  function extractStreamTimestamp(data: any): void {
    const timestamps: Record<string, MessageTimestamp> = {};

    // input_message event — user message
    if (data?.type === "input_message" && data.input_message) {
      const msg = data.input_message;
      if (msg.id && msg.create_time != null) {
        timestamps[msg.id] = {
          createTime: msg.create_time,
          role: msg.author?.role || null,
        };
      }
    }

    // delta with message data — covers both formats:
    // - Second+ turns: {"o": "add", "v": {"message": {...}}}
    // - First turn (new conversation): {"v": {"message": {...}}, "c": N}
    if (data?.v?.message) {
      const msg = data.v.message;
      if (msg.id && msg.create_time != null) {
        timestamps[msg.id] = {
          createTime: msg.create_time,
          role: msg.author?.role || null,
        };
      }
    }

    if (Object.keys(timestamps).length === 0) return;

    if (__DEBUG__) {
      console.log("[TimeGPT] Captured streaming timestamps:", Object.keys(timestamps));
    }
    Object.assign(timestampBuffer, timestamps);
    window.postMessage(
      { type: "TIMEGPT_TIMESTAMPS", timestamps },
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
