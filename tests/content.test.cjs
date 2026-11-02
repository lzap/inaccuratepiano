const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

function harness(initialStore = {}) {
  const store = { ...initialStore };
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
  let nextTimerId = 1;
  const timers = new Map();
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
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { time: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
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
    setTime(value) {
      now = value;
      for (const [id, timer] of [...timers]) {
        if (timer.time <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    } };
}

test("pedal cue and repeated jump presses", async () => {
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
  h.video.currentTime = 20;
  h.setTime(280);
  h.emit(0xb0, 67, 127);
  assert.equal(h.video.paused, false);
  assert.equal(h.video.currentTime, 12.5);
  assert.deepEqual(Object.keys((await h.send("GET_STATUS")).bindings), ["cue", "jump"]);
});

test("hold pause ignores interrupted play but reports actual playback failure", async () => {
  const h = harness();
  await h.send("CONNECT");
  let rejectPlay;
  h.video.play = function () {
    this.paused = false;
    return new Promise((_, reject) => { rejectPlay = reject; });
  };
  h.video.pause = function () {
    this.paused = true;
    const interrupted = new Error("The play() request was interrupted by a call to pause().");
    interrupted.name = "AbortError";
    rejectPlay(interrupted);
  };

  h.setTime(100);
  h.emit(0xb0, 67, 127);
  h.setTime(700);
  await new Promise(setImmediate);
  assert.equal(h.video.paused, true);
  assert.equal((await h.send("GET_STATUS")).error, "");

  const blocked = harness();
  await blocked.send("CONNECT");
  blocked.video.play = function () {
    const denied = new Error("User activation is required.");
    denied.name = "NotAllowedError";
    return Promise.reject(denied);
  };
  blocked.emit(0xb0, 67, 127);
  await new Promise(setImmediate);
  assert.match((await blocked.send("GET_STATUS")).error, /Playback was blocked: User activation is required/);
});

test("holding a jump pedal pauses and returns to cue, while a short tap keeps playing", async () => {
  const h = harness();
  await h.send("CONNECT");
  h.video.currentTime = 12;
  h.emit(0xb0, 66, 127);
  h.emit(0xb0, 66, 0);

  h.video.currentTime = 40;
  h.setTime(100);
  h.emit(0xb0, 67, 127);
  assert.equal(h.video.currentTime, 12);
  assert.equal(h.video.paused, false);
  h.setTime(400);
  h.emit(0xb0, 67, 0);
  h.setTime(800);
  assert.equal(h.video.paused, false);

  h.video.currentTime = 50;
  h.setTime(1000);
  h.emit(0xb0, 67, 127);
  assert.equal(h.video.currentTime, 12);
  h.setTime(1599);
  assert.equal(h.video.paused, false);
  h.setTime(1600);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.currentTime, 12);
  h.emit(0xb0, 67, 0);
  assert.equal((await h.send("GET_STATUS")).error, "");
});

test("both keyboard profiles jump on press and stop at cue on hold", async () => {
  for (const [profile, notes] of [["piano88", [21, 22, 23]], ["piano61", [36, 37, 38]]]) {
    const h = harness();
    await h.send("CONNECT");
    await h.send("SET_PROFILE", { profile });
    h.video.currentTime = 19;
    h.emit(0x90, notes[0], 90);
    h.emit(0x90, notes[0], 0);
    h.video.currentTime = 35;
    h.setTime(100);
    h.emit(0x90, notes[1], 100);
    assert.equal(h.video.currentTime, 19);
    assert.equal(h.video.paused, false);
    h.setTime(400);
    h.emit(0x80, notes[1], 0);
    h.setTime(800);
    assert.equal(h.video.paused, false);

    h.video.currentTime = 42;
    h.setTime(1000);
    h.emit(0x90, notes[1], 100);
    assert.equal(h.video.currentTime, 19);
    h.setTime(1599);
    assert.equal(h.video.paused, false);
    h.setTime(1600);
    assert.equal(h.video.paused, true);
    assert.equal(h.video.currentTime, 19);
    h.emit(0x90, notes[1], 0);
    h.emit(0x90, notes[2], 100);
    assert.equal(h.video.paused, true);
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

test("an old third-action mapping is ignored and removed when saving custom settings", async () => {
  const h = harness({ config: {
    profile: "custom",
    custom: {
      cue: { kind: "cc", number: 66, channel: null },
      jump: { kind: "cc", number: 67, channel: null },
      toggle: { kind: "doubleTap", number: 67, channel: null }
    }
  } });
  await h.send("CONNECT");
  assert.deepEqual(Object.keys((await h.send("GET_STATUS")).bindings), ["cue", "jump"]);
  await h.send("START_CAPTURE", { action: "jump" });
  h.emit(0xb0, 68, 127);
  await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(h.store.config.custom.jump)),
    { kind: "cc", number: 68, channel: 0 });
  assert.equal(Object.hasOwn(h.store.config.custom, "toggle"), false);
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
