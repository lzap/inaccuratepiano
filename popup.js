const statusElement = document.querySelector("#status");
const connectButton = document.querySelector("#connect");
const devicesElement = document.querySelector("#devices");
const profileElement = document.querySelector("#profile");
const cueTimeElement = document.querySelector("#cue-time");
const hintElement = document.querySelector("#hint");
const captureButtons = [...document.querySelectorAll("button.capture")];
const bindingElements = {
  cue: document.querySelector("#cue-binding"),
  jump: document.querySelector("#jump-binding")
};

let tabId = null;
let latestStatus = null;
let busy = false;

function isWatchUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /(^|\.)youtube\.com$/.test(url.hostname) &&
      url.pathname === "/watch" && Boolean(url.searchParams.get("v"));
  } catch {
    return false;
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.floor(Math.max(0, seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function formatBinding(binding) {
  if (!binding) return "Not assigned";
  const channel = binding.channel === null ? "any channel" : `channel ${binding.channel + 1}`;
  if (binding.kind === "cc") return `CC ${binding.number} · ${channel}`;
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const note = `${names[binding.number % 12]}${Math.floor(binding.number / 12) - 1}`;
  return `${note} (note ${binding.number}) · ${channel}`;
}

function setError(message) {
  statusElement.textContent = message;
  statusElement.classList.add("error");
}

function render(status) {
  latestStatus = status;
  statusElement.classList.toggle("error", Boolean(status.error));
  if (status.error) statusElement.textContent = status.error;
  else if (status.captureAction) statusElement.textContent = "Waiting for the next MIDI note or CC press…";
  else if (status.connected) statusElement.textContent = "MIDI connected";
  else statusElement.textContent = "MIDI is not connected";

  connectButton.disabled = busy || status.connected;
  connectButton.textContent = status.connected ? "MIDI Connected" : "Connect MIDI";
  devicesElement.textContent = status.inputs.length
    ? `Inputs: ${status.inputs.join(", ")}`
    : "No MIDI inputs connected. Plug one in to continue.";
  profileElement.disabled = busy;
  profileElement.value = status.profile;
  for (const action of Object.keys(bindingElements)) {
    bindingElements[action].textContent = formatBinding(status.bindings[action]);
  }
  for (const button of captureButtons) {
    const capturing = status.captureAction === button.dataset.action;
    button.textContent = capturing ? "Cancel" : "Capture";
    button.disabled = busy || !status.connected || Boolean(status.captureAction && !capturing);
  }
  cueTimeElement.textContent = `Cue point: ${formatTime(status.cuePoint)}`;
  hintElement.textContent = "Press Jump & Play to restart; hold for 600 ms to pause at the cue.";
}

async function send(type, extra = {}) {
  const response = await chrome.tabs.sendMessage(tabId, {
    source: "inaccurate-piano-popup", type, ...extra
  });
  if (!response?.ok) throw new Error(response?.error || "The watch page did not respond.");
  return response.status;
}

async function ensureContentScript() {
  try {
    return await send("GET_STATUS");
  } catch {
    // A YouTube homepage can navigate to /watch without a document reload.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await send("GET_STATUS");
  }
}

async function runCommand(type, extra = {}) {
  if (busy) return;
  busy = true;
  if (latestStatus) render(latestStatus);
  try {
    render(await send(type, extra));
  } catch (reason) {
    if (latestStatus) render({ ...latestStatus, error: reason.message || String(reason) });
    else setError(reason.message || String(reason));
  } finally {
    busy = false;
    if (latestStatus) render(latestStatus);
  }
}

connectButton.addEventListener("click", () => runCommand("CONNECT"));
profileElement.addEventListener("change", () => {
  void runCommand("SET_PROFILE", { profile: profileElement.value });
});
for (const button of captureButtons) {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    void runCommand(latestStatus?.captureAction === action ? "CANCEL_CAPTURE" : "START_CAPTURE", { action });
  });
}

async function start() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isWatchUrl(tab.url)) {
      setError("Open a YouTube video watch page first.");
      return;
    }
    tabId = tab.id;
    render(await ensureContentScript());
    setInterval(async () => {
      if (busy) return;
      try { render(await send("GET_STATUS")); }
      catch { setError("Reload the YouTube watch page, then reopen this popup."); }
    }, 800);
  } catch (reason) {
    setError(reason.message || String(reason));
  }
}

void start();
