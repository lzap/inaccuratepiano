(() => {
  // YouTube can change videos without reloading the page. The popup may inject
  // this file again after such a navigation, so keep one listener per document.
  if (globalThis.__inaccuratePianoMidi) {
    globalThis.__inaccuratePianoMidi.refreshPage();
    return;
  }

  const STORAGE_KEY = "config";
  const HOLD_MS = 600;
  const ACTIONS = ["cue", "jump"];
  const PROFILES = {
    pedals: {
      cue: { kind: "cc", number: 66, channel: null },
      jump: { kind: "cc", number: 67, channel: null }
    },
    piano88: {
      cue: { kind: "note", number: 21, channel: null },
      jump: { kind: "note", number: 22, channel: null }
    },
    piano61: {
      cue: { kind: "note", number: 36, channel: null },
      jump: { kind: "note", number: 37, channel: null }
    }
  };

  let config = { profile: "pedals", custom: clone(PROFILES.pedals) };
  let midiAccess = null;
  let connecting = null;
  let capture = null;
  let cuePoint = 0;
  let videoId = null;
  let holdTimer = null;
  let holdKey = null;
  let error = "";
  const pressed = new Set();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isWatchPage() {
    return /(^|\.)youtube\.com$/.test(location.hostname) &&
      location.pathname === "/watch" &&
      Boolean(new URL(location.href).searchParams.get("v"));
  }

  function cancelHold() {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    holdKey = null;
  }

  function refreshPage() {
    const nextId = isWatchPage() ? new URL(location.href).searchParams.get("v") : null;
    if (nextId !== videoId) {
      videoId = nextId;
      cuePoint = 0;
      capture = null;
      cancelHold();
      pressed.clear();
    }
  }

  function validBinding(binding) {
    if (!binding || !["note", "cc"].includes(binding.kind) ||
        !Number.isInteger(binding.number) || binding.number < 0 || binding.number > 127 ||
        !(binding.channel === null || Number.isInteger(binding.channel) &&
          binding.channel >= 0 && binding.channel <= 15)) {
      return null;
    }
    return { kind: binding.kind, number: binding.number, channel: binding.channel };
  }

  function normalizeConfig(raw) {
    const profile = ["pedals", "piano88", "piano61", "custom"].includes(raw?.profile)
      ? raw.profile : "pedals";
    const custom = {};
    for (const action of ACTIONS) {
      custom[action] = validBinding(raw?.custom?.[action]) || clone(PROFILES.pedals[action]);
    }
    return { profile, custom };
  }

  function activeBindings() {
    return config.profile === "custom" ? config.custom : PROFILES[config.profile];
  }

  function getVideo() {
    if (!isWatchPage() || document.querySelector("#movie_player.ad-showing")) return null;
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function setCue() {
    const video = getVideo();
    if (!video || !Number.isFinite(video.currentTime)) return;
    cuePoint = video.currentTime;
    error = "";
  }

  function play(video) {
    const result = video.play();
    if (result?.catch) result.catch((reason) => {
      if (reason?.name === "AbortError" && video.paused) return;
      error = `Playback was blocked: ${reason.message || reason}`;
    });
  }

  function jumpAndPlay() {
    const video = getVideo();
    if (!video) return;
    try {
      const end = Number.isFinite(video.duration) ? video.duration : cuePoint;
      video.currentTime = Math.min(cuePoint, end);
      error = "";
      play(video);
    } catch (reason) {
      error = `Could not seek: ${reason.message || reason}`;
    }
  }

  function stopAtCue() {
    const video = getVideo();
    if (!video) return;
    try {
      video.pause();
      const end = Number.isFinite(video.duration) ? video.duration : cuePoint;
      video.currentTime = Math.min(cuePoint, end);
      error = "";
    } catch (reason) {
      error = `Could not return to cue: ${reason.message || reason}`;
    }
  }

  function startHold(key) {
    cancelHold();
    holdKey = key;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (holdKey !== key || !pressed.has(key) ||
          document.visibilityState === "hidden" || !isWatchPage()) return;
      holdKey = null;
      stopAtCue();
    }, HOLD_MS);
  }

  function matches(binding, event) {
    return binding && binding.kind === event.kind && binding.number === event.number &&
      (binding.channel === null || binding.channel === event.channel);
  }

  function conflicts(candidate, other) {
    return other && candidate.kind === other.kind && candidate.number === other.number &&
      (candidate.channel === null || other.channel === null ||
        candidate.channel === other.channel);
  }

  async function saveCapture(event) {
    const pending = capture;
    capture = null;
    const binding = { kind: event.kind, number: event.number, channel: event.channel };
    const custom = clone(pending.base);
    for (const otherAction of ACTIONS) {
      if (otherAction !== pending.action &&
          conflicts(binding, custom[otherAction])) {
        error = "That MIDI control is already assigned to another action.";
        return;
      }
    }
    custom[pending.action] = binding;
    config = { profile: "custom", custom };
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: config });
      error = "";
    } catch (reason) {
      error = `Could not save mapping: ${reason.message || reason}`;
    }
  }

  function handleMidiMessage(message) {
    if (document.visibilityState === "hidden" || !isWatchPage()) return;
    const data = message.data;
    if (!data || data.length < 3) return;
    const type = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    const number = data[1];
    const value = data[2];
    const kind = type === 0xb0 ? "cc" : "note";
    if (type !== 0xb0 && type !== 0x90 && type !== 0x80) return;
    const key = `${message.currentTarget?.id || "input"}:${kind}:${channel}:${number}`;
    const release = type === 0x80 || type === 0x90 && value === 0 ||
      type === 0xb0 && value === 0;
    if (release) {
      pressed.delete(key);
      if (holdKey === key) cancelHold();
      return;
    }
    if (pressed.has(key)) return;
    pressed.add(key);
    const event = { kind, number, channel };
    if (capture) {
      void saveCapture(event);
      return;
    }

    const bindings = activeBindings();
    if (matches(bindings.cue, event)) setCue();
    else if (matches(bindings.jump, event)) {
      jumpAndPlay();
      startHold(key);
    }
  }

  function syncInputs() {
    if (!midiAccess) return;
    for (const input of midiAccess.inputs.values()) {
      input.onmidimessage = input.state === "connected" ? handleMidiMessage : null;
    }
    cancelHold();
    pressed.clear();
  }

  async function connectMidi() {
    if (!isWatchPage()) throw new Error("Open a YouTube watch page first.");
    if (midiAccess) return getStatus();
    if (connecting) return connecting;
    if (typeof navigator.requestMIDIAccess !== "function") {
      throw new Error("Web MIDI is unavailable in this Chrome window.");
    }
    connecting = (async () => {
      try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        midiAccess.onstatechange = syncInputs;
        syncInputs();
        await chrome.storage.local.set({ midiEnabled: true });
        error = "";
        return getStatus();
      } catch (reason) {
        error = `MIDI access failed: ${reason.message || reason}`;
        throw new Error(error);
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  }

  function getStatus() {
    refreshPage();
    const inputs = midiAccess ? [...midiAccess.inputs.values()]
      .filter((input) => input.state === "connected")
      .map((input) => input.name || "Unnamed MIDI input") : [];
    return {
      connected: Boolean(midiAccess),
      inputs,
      captureAction: capture?.action || null,
      cuePoint,
      videoId,
      profile: config.profile,
      bindings: clone(activeBindings()),
      error
    };
  }

  const ready = chrome.storage.local.get([STORAGE_KEY, "midiEnabled"]).then(async (stored) => {
    config = normalizeConfig(stored[STORAGE_KEY]);
    refreshPage();
    if (!stored.midiEnabled || !isWatchPage()) return;
    try {
      const permission = await navigator.permissions?.query({ name: "midi", sysex: false });
      if (permission?.state === "granted") await connectMidi();
    } catch (reason) {
      error = `MIDI connection needs attention: ${reason.message || reason}`;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      config = normalizeConfig(changes[STORAGE_KEY].newValue);
      cancelHold();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.source !== "inaccurate-piano-popup") return false;
    (async () => {
      await ready;
      refreshPage();
      switch (message.type) {
        case "GET_STATUS": return getStatus();
        case "CONNECT": return await connectMidi();
        case "START_CAPTURE":
          if (!midiAccess) throw new Error("Connect MIDI before capturing a control.");
          if (!ACTIONS.includes(message.action)) throw new Error("Unknown action.");
          capture = { action: message.action, base: clone(activeBindings()) };
          error = "";
          return getStatus();
        case "CANCEL_CAPTURE":
          capture = null;
          return getStatus();
        case "SET_PROFILE":
          if (!["pedals", "piano88", "piano61", "custom"].includes(message.profile)) {
            throw new Error("Unknown mapping profile.");
          }
          capture = null;
          config = { ...config, profile: message.profile };
          await chrome.storage.local.set({ [STORAGE_KEY]: config });
          error = "";
          return getStatus();
        default: throw new Error("Unknown popup command.");
      }
    })().then((status) => sendResponse({ ok: true, status }))
      .catch((reason) => sendResponse({ ok: false, error: reason.message || String(reason) }));
    return true;
  });

  document.addEventListener("yt-navigate-finish", refreshPage);
  document.addEventListener("visibilitychange", () => {
    pressed.clear();
    cancelHold();
  });
  window.addEventListener("popstate", refreshPage);
  globalThis.__inaccuratePianoMidi = { refreshPage };
})();
