# CLAUDE.md — TimeGPT

## What is this project?

A Chrome extension (Manifest V3) that adds timestamps to ChatGPT's UI. ChatGPT doesn't display timestamps for messages or conversations, but the backend API includes them. We intercept fetch responses and render timestamps inline.

## Build system

- **esbuild** compiles TypeScript → `dist/` as IIFE bundles (no module syntax)
- **tsc** is used only for type checking (`npm run typecheck`, `noEmit: true`)
- Build config is in `build.js`, not in `tsconfig.json`
- `__DEBUG__` is a compile-time constant injected by esbuild's `define` — use `npm run build:debug` to enable console logging

## Key architecture decisions

- **Two content scripts** with different worlds:
  - `interceptor.ts` runs in `MAIN` world at `document_start` — patches `window.fetch` to capture API responses
  - `content.ts` runs in `ISOLATED` world at `document_idle` — handles DOM manipulation and has access to `chrome.*` APIs
- **Communication**: `window.postMessage` bridges MAIN ↔ ISOLATED worlds
- **Drain mechanism**: Content script sends `TIMEGPT_DRAIN_REQUEST` via postMessage, interceptor responds with buffered data. This avoids inline script injection which violates CSP.
- **No inline scripts**: ChatGPT's CSP blocks inline scripts. All code runs from extension files.

## ChatGPT API endpoints we intercept

- `/backend-api/conversation/{uuid}` — returns message data with `mapping[].message.create_time` (unix timestamp in seconds)
- `/backend-api/conversations?offset=N&limit=N&...` — returns conversation list with `items[].create_time` (ISO 8601 string)
- `/backend-api/f/conversation` — SSE stream for live messages; we tap the stream to extract `create_time` from `input_message` and delta events in real-time

## ChatGPT DOM selectors we depend on

- `[data-message-id]` — message elements, with `data-message-author-role` attribute
- `article` — wraps each conversation turn
- `div.z-0.flex` → `firstElementChild` — the animated button toolbar (Copy, Edit, etc.)
- `a[data-sidebar-item][href^="/c/"]` — sidebar conversation links
- `div.truncate` inside sidebar items — where we append sidebar timestamps

## Settings stored in chrome.storage.sync

- `timestampFormat`: "relative" | "datetime24" | "datetime12" | "time24" | "time12" | "iso"
- `showMessageTimestamps`: boolean
- `showSidebarTimestamps`: boolean

## Common tasks

- **Build**: `npm run build`
- **Type check**: `npm run typecheck`
- **Debug build**: `npm run build:debug`
- **Watch mode**: `npm run watch`
- **Package**: `npm run package` (builds and creates `timegpt.zip`)
- After changing source, reload extension in `chrome://extensions` and hard-refresh ChatGPT
