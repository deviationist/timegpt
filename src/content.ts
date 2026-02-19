// TimeGPT Content Script — Runs in ISOLATED world at document_idle.
// Listens for timestamp data from the interceptor (MAIN world)
// and renders timestamps below ChatGPT messages and in the sidebar.

import type {
  MessageTimestamp,
  ConversationTimestamp,
  TimestampFormat,
  TimegptTimestampsMessage,
  TimegptConversationsMessage,
} from "./types";

const DEFAULTS = {
  timestampFormat: "relative" as TimestampFormat,
  showMessageTimestamps: true,
  showSidebarTimestamps: true,
};

(function () {
  "use strict";

  if (__DEBUG__) console.log("[TimeGPT] Content script loaded");

  // --- Storage ---
  const timestampMap = new Map<string, MessageTimestamp>();
  const conversationMap = new Map<string, ConversationTimestamp>();

  // --- User preferences ---
  let currentFormat: TimestampFormat = DEFAULTS.timestampFormat;
  let showMessages: boolean = DEFAULTS.showMessageTimestamps;
  let showSidebar: boolean = DEFAULTS.showSidebarTimestamps;

  chrome.storage.sync.get(DEFAULTS, (result) => {
    currentFormat = result.timestampFormat as TimestampFormat;
    showMessages = result.showMessageTimestamps as boolean;
    showSidebar = result.showSidebarTimestamps as boolean;
    if (__DEBUG__) console.log("[TimeGPT] Settings:", { currentFormat, showMessages, showSidebar });
    applyAll();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.timestampFormat) {
      currentFormat = changes.timestampFormat.newValue as TimestampFormat;
    }
    if (changes.showMessageTimestamps) {
      showMessages = changes.showMessageTimestamps.newValue as boolean;
      if (!showMessages) removeMessageTimestamps();
    }
    if (changes.showSidebarTimestamps) {
      showSidebar = changes.showSidebarTimestamps.newValue as boolean;
      if (!showSidebar) removeSidebarTimestamps();
    }
    applyAll();
  });

  function applyAll(): void {
    refreshAllTimestamps();
    if (showMessages) applyMessageTimestamps();
    if (showSidebar) applySidebarTimestamps();
  }

  function removeMessageTimestamps(): void {
    document.querySelectorAll(".timegpt-timestamp").forEach((el) => el.remove());
  }

  function removeSidebarTimestamps(): void {
    document.querySelectorAll(".timegpt-sidebar-time").forEach((el) => el.remove());
  }

  // --- Pick up any data the interceptor already captured ---
  // Send a drain request to the interceptor (MAIN world) via postMessage.
  // The interceptor listens for this and re-posts any buffered data.
  function requestDrain(): void {
    window.postMessage({ type: "TIMEGPT_DRAIN_REQUEST" }, window.location.origin);
  }

  requestDrain();
  setTimeout(requestDrain, 1000);
  setTimeout(requestDrain, 3000);

  // --- Listen for data from the interceptor ---
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;

    const data = event.data as
      | TimegptTimestampsMessage
      | TimegptConversationsMessage
      | { type: string };

    if (data?.type === "TIMEGPT_TIMESTAMPS") {
      const { timestamps } = data as TimegptTimestampsMessage;
      let newCount = 0;
      for (const [id, info] of Object.entries(timestamps)) {
        if (!timestampMap.has(id)) newCount++;
        timestampMap.set(id, info);
      }
      if (newCount > 0) {
        if (__DEBUG__) console.log(
          `[TimeGPT] Received ${newCount} message timestamps (total: ${timestampMap.size})`
        );
        if (showMessages) applyMessageTimestamps();
      }
    }

    if (data?.type === "TIMEGPT_CONVERSATIONS") {
      const { conversations } = data as TimegptConversationsMessage;
      let newCount = 0;
      for (const [id, info] of Object.entries(conversations)) {
        if (!conversationMap.has(id)) newCount++;
        conversationMap.set(id, info);
      }
      if (newCount > 0) {
        if (__DEBUG__) console.log(
          `[TimeGPT] Received ${newCount} conversation timestamps (total: ${conversationMap.size})`
        );
        if (showSidebar) applySidebarTimestamps();
      }
    }
  });

  // --- Formatting ---
  function formatTimestamp(unixSeconds: number): string {
    const date = new Date(unixSeconds * 1000);

    switch (currentFormat) {
      case "relative":
        return formatRelative(date);
      case "datetime24":
        return formatParts(date, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
      case "datetime12":
        return formatParts(date, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
      case "time24":
        return formatParts(date, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
      case "time12":
        return formatParts(date, {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
      case "iso":
        return date.toISOString().slice(0, 19);
      default:
        return formatRelative(date);
    }
  }

  function isoToUnix(isoString: string): number {
    return new Date(isoString).getTime() / 1000;
  }

  function formatRelative(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;

    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatParts(
    date: Date,
    options: Intl.DateTimeFormatOptions
  ): string {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }

  // =============================================
  // MESSAGE TIMESTAMPS (in-conversation)
  // =============================================

  function applyMessageTimestamps(): void {
    const messageEls = document.querySelectorAll("[data-message-id]");
    let applied = 0;

    for (const el of messageEls) {
      const id = el.getAttribute("data-message-id");
      if (!id || !timestampMap.has(id)) continue;

      const article = el.closest("article");
      if (!article) continue;
      if (article.querySelector(".timegpt-timestamp")) continue;

      const toolbarOuter = article.querySelector("div.z-0.flex");
      if (!toolbarOuter) continue;
      const buttonRow = toolbarOuter.firstElementChild;
      if (!buttonRow) continue;

      const info = timestampMap.get(id)!;
      const timeEl = document.createElement("time");
      timeEl.className = "timegpt-timestamp";
      timeEl.dateTime = new Date(info.createTime * 1000).toISOString();
      timeEl.textContent = formatTimestamp(info.createTime);
      timeEl.title = new Date(info.createTime * 1000).toLocaleString();
      timeEl.dataset.timegptUnix = String(info.createTime);

      const role = el.getAttribute("data-message-author-role");
      if (role === "user") {
        timeEl.classList.add("timegpt-timestamp--user");
        buttonRow.prepend(timeEl);
      } else {
        timeEl.classList.add("timegpt-timestamp--assistant");
        buttonRow.appendChild(timeEl);
      }
      applied++;
    }

    if (applied > 0) {
      if (__DEBUG__) console.log(`[TimeGPT] Applied ${applied} message timestamps to DOM`);
    }
  }

  // =============================================
  // SIDEBAR TIMESTAMPS (conversation list)
  // =============================================

  function applySidebarTimestamps(): void {
    const sidebarLinks = document.querySelectorAll<HTMLAnchorElement>(
      'a[data-sidebar-item][href^="/c/"]'
    );
    let applied = 0;

    for (const link of sidebarLinks) {
      if (link.querySelector(".timegpt-sidebar-time")) continue;

      const match = link.getAttribute("href")?.match(/\/c\/([0-9a-f-]+)/);
      if (!match) continue;
      const convId = match[1];

      if (!conversationMap.has(convId)) continue;

      const info = conversationMap.get(convId)!;
      const createUnix = isoToUnix(info.createTime);

      const timeEl = document.createElement("time");
      timeEl.className = "timegpt-sidebar-time";
      timeEl.dateTime = info.createTime;
      timeEl.textContent = formatTimestamp(createUnix);
      timeEl.title = `Created: ${new Date(info.createTime).toLocaleString()}`;
      timeEl.dataset.timegptUnix = String(createUnix);

      const truncateDiv = link.querySelector("div.truncate");
      if (truncateDiv) {
        truncateDiv.appendChild(timeEl);
      }

      applied++;
    }

    if (applied > 0) {
      if (__DEBUG__) console.log(`[TimeGPT] Applied ${applied} sidebar timestamps`);
    }
  }

  // --- Refresh all visible timestamps ---
  function refreshAllTimestamps(): void {
    const allEls = document.querySelectorAll<HTMLElement>(
      "[data-timegpt-unix]"
    );
    for (const el of allEls) {
      el.textContent = formatTimestamp(Number(el.dataset.timegptUnix));
    }
  }

  // --- MutationObserver for messages + sidebar ---
  const observer = new MutationObserver((mutations) => {
    let hasMessages = false;
    let hasSidebar = false;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        if (
          el.hasAttribute?.("data-message-id") ||
          el.querySelector?.("[data-message-id]")
        ) {
          hasMessages = true;
        }
        if (
          el.matches?.("[data-sidebar-item]") ||
          el.querySelector?.("[data-sidebar-item]")
        ) {
          hasSidebar = true;
        }
        if (hasMessages && hasSidebar) break;
      }
      if (hasMessages && hasSidebar) break;
    }

    if (hasMessages && showMessages) applyMessageTimestamps();
    if (hasSidebar && showSidebar) applySidebarTimestamps();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // --- Refresh relative timestamps every 30s ---
  setInterval(refreshAllTimestamps, 30000);
})();
