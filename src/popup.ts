// TimeGPT popup — format picker + visibility toggles

import type { TimestampFormat } from "./types";

const DEFAULTS = {
  timestampFormat: "relative" as TimestampFormat,
  showMessageTimestamps: true,
  showSidebarTimestamps: true,
};

interface FormatOption {
  id: TimestampFormat;
  name: string;
  example: string;
}

const FORMATS: FormatOption[] = [
  { id: "relative", name: "Relative", example: "5m ago, 2h ago, 3d ago" },
  { id: "datetime24", name: "Date + Time (24h)", example: "2025-01-15 14:30" },
  {
    id: "datetime12",
    name: "Date + Time (12h)",
    example: "Jan 15, 2025 2:30 PM",
  },
  { id: "time24", name: "Time only (24h)", example: "14:30" },
  { id: "time12", name: "Time only (12h)", example: "2:30 PM" },
  { id: "iso", name: "ISO 8601", example: "2025-01-15T14:30:00" },
];

const container = document.getElementById("options")!;
const savedEl = document.getElementById("saved")!;
const msgToggle = document.getElementById(
  "toggle-messages"
) as HTMLInputElement;
const sidebarToggle = document.getElementById(
  "toggle-sidebar"
) as HTMLInputElement;

// Build format radio buttons
FORMATS.forEach((fmt) => {
  const label = document.createElement("label");
  label.innerHTML = `
    <input type="radio" name="format" value="${fmt.id}">
    <span class="format-name">${fmt.name}</span>
    <span class="format-example">${fmt.example}</span>
  `;
  container.appendChild(label);
});

// Load current settings
chrome.storage.sync.get(DEFAULTS, (result) => {
  const radio = document.querySelector<HTMLInputElement>(
    `input[value="${result.timestampFormat}"]`
  );
  if (radio) radio.checked = true;
  msgToggle.checked = result.showMessageTimestamps as boolean;
  sidebarToggle.checked = result.showSidebarTimestamps as boolean;
});

function showSaved(): void {
  savedEl.classList.add("show");
  setTimeout(() => savedEl.classList.remove("show"), 2000);
}

// Save format on change
container.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.name !== "format") return;
  chrome.storage.sync.set({ timestampFormat: target.value }, showSaved);
});

// Save visibility toggles
msgToggle.addEventListener("change", () => {
  chrome.storage.sync.set(
    { showMessageTimestamps: msgToggle.checked },
    showSaved
  );
});

sidebarToggle.addEventListener("change", () => {
  chrome.storage.sync.set(
    { showSidebarTimestamps: sidebarToggle.checked },
    showSaved
  );
});
