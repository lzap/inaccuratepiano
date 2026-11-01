const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

function harness() {
  const store = {};
  const storageListeners = [];
  const documentListeners = {};
  const input = { id: "keyboard", name: "Keyboard", state: "connected", onmidimessage: null };
  const midiAccess = { inputs: new Map([[input.id, input]]), onstatechange: null };
  const video = {
    currentTime: 0, duration: 100, paused: true,
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }
  };
  const location = {
    href: "https://www.youtube.com/watch?v=first",
    hostname: "www.youtube.com",
    pathname: "/watch"
  };
  const document = {
    visibilityState: "visible",
    querySelector(selector) {
      if (selector === "#movie_player.ad-showing") return null;
      return selector === "video.html5-main-video" ? video : null;
    },
    addEventListener(name, callback) { documentListeners[name] = callback; }
  };
  let listener;
  let now = 0;
  const chrome = {
    storage: {
      local: {
        async get(keys) { return Object.fromEntries(keys.map((key) => [key, store[key]])); },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          for (const callback of storageListeners) callback(changes, "local");
        }
      },
      onChanged: { addListener(callback) { storageListeners.push(callback); } }
    },
    runtime: { onMessage: { addListener(callback) { listener = callback; } } }
  };
  const context = vm.createContext({
    chrome, document, location, window: { addEventListener() {} },
    navigator: {
      requestMIDIAccess: async () => midiAccess,
      permissions: { query: async () => ({ state: "granted" }) }
    },
    performance: { now: () => now },
    URL, console
  });
  vm.runInContext(script, context);

  async function send(type, extra = {}) {
    const response = await new Promise((resolve) => {
      listener({ source: "inaccurate-piano-popup", type, ...extra }, {}, resolve);
    });
    assert.equal(response.ok, true, response.error);
    return response.status;
  }
  function emit(status, number, value) {
    assert.equal(typeof input.onmidimessage, "function");
    input.onmidimessage({ currentTarget: input, data: [status, number, value] });
  }
  return { send, emit, store, video, document, location, documentListeners,
    setTime(value) { now = value; } };
}

test("pedal cue, jump, and double-tap toggle", async () => {
  const h = harness();
  await h.send("CONNECT");
  h.video.currentTime = 12.5;
  h.emit(0xb0, 66, 127);
  h.emit(0xb0, 66, 0);
  assert.equal((await h.send("GET_STATUS")).cuePoint, 12.5);

  h.video.currentTime = 40;
  h.setTime(100);
  h.emit(0xb0, 67, 127);
  assert.equal(h.video.currentTime, 12.5);
  assert.equal(h.video.paused, false);
  h.emit(0xb0, 67, 0);
  h.setTime(280);
  h.emit(0xb0, 67, 127);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.currentTime, 12.5);
});

test("both keyboard profiles use note on, with velocity-zero release", async () => {
  const h = harness();
  await h.send("CONNECT");
  for (const [profile, notes] of [["piano88", [21, 22, 23]], ["piano61", [36, 37, 38]]]) {
    await h.send("SET_PROFILE", { profile });
    h.video.currentTime = 19;
    h.emit(0x90, notes[0], 90);
    h.emit(0x90, notes[0], 0);
    h.video.currentTime = 35;
    h.emit(0x90, notes[1], 100);
    assert.equal(h.video.currentTime, 19);
    assert.equal(h.video.paused, false);
    h.emit(0x80, notes[1], 0);
    h.emit(0x90, notes[2], 100);
    assert.equal(h.video.paused, true);
    h.emit(0x90, notes[2], 0);
  }
});

test("capture saves the MIDI channel and rejects a duplicate binding", async () => {
  const h = harness();
  await h.send("CONNECT");
  await h.send("SET_PROFILE", { profile: "piano88" });
  await h.send("START_CAPTURE", { action: "cue" });
  h.emit(0x92, 50, 90);
  await new Promise(setImmediate);
  assert.equal(h.store.config.profile, "custom");
  assert.deepEqual(JSON.parse(JSON.stringify(h.store.config.custom.cue)),
    { kind: "note", number: 50, channel: 2 });
  assert.equal(h.store.config.custom.jump.number, 22);

  h.emit(0x92, 50, 0);
  await h.send("START_CAPTURE", { action: "jump" });
  h.emit(0x92, 50, 100);
  await new Promise(setImmediate);
  assert.match((await h.send("GET_STATUS")).error, /already assigned/);
  assert.equal(h.store.config.custom.jump.number, 22);
});

test("cue resets for a new video and hidden pages ignore MIDI", async () => {
  const h = harness();
  await h.send("CONNECT");
  h.video.currentTime = 25;
  h.emit(0xb0, 66, 127);
  h.location.href = "https://www.youtube.com/watch?v=second";
  h.documentListeners["yt-navigate-finish"]();
  assert.equal((await h.send("GET_STATUS")).cuePoint, 0);
  h.document.visibilityState = "hidden";
  h.video.currentTime = 40;
  h.emit(0xb0, 66, 127);
  assert.equal((await h.send("GET_STATUS")).cuePoint, 0);
});
