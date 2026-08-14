import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function createBrowser(storage = new MemoryStorage()) {
  const listeners = new Map();
  const requests = [];
  const beacons = [];
  const document = {
    visibilityState: "visible",
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
  };
  const window = {
    document,
    localStorage: storage,
    navigator: {
      sendBeacon(url, body) {
        beacons.push({ url, body });
        return true;
      },
    },
    async fetch(url, options) {
      requests.push({ url, options });
      return { ok: true };
    },
  };

  return { window, storage, document, listeners, requests, beacons };
}

async function loadFreshModule() {
  return import(`./dist/index.js?test=${Date.now()}-${Math.random()}`);
}

test("every room entry is a PV while UV is unique per anonymous_id and ccid", async () => {
  const browser = createBrowser();
  globalThis.window = browser.window;
  const { analytics } = await loadFreshModule();

  const first = analytics.track({ ccid: "ccid_10001" });
  const repeated = analytics.track({ ccid: "ccid_10001" });
  const anotherRoom = analytics.track({ ccid: "ccid_10002" });

  assert.equal(first.pv, 1);
  assert.equal(first.uv, 1);
  assert.equal(repeated.pv, 1);
  assert.equal(repeated.uv, 0);
  assert.equal(anotherRoom.uv, 1);
  assert.equal(first.anonymous_id, repeated.anonymous_id);
  assert.equal(first.anonymous_id, anotherRoom.anonymous_id);
});

test("a simulated refresh keeps anonymous_id and does not add UV", async () => {
  const browser = createBrowser();
  globalThis.window = browser.window;
  const firstModule = await loadFreshModule();
  const first = firstModule.analytics.track({ ccid: "ccid_10001" });

  const refreshedBrowser = createBrowser(browser.storage);
  globalThis.window = refreshedBrowser.window;
  const refreshedModule = await loadFreshModule();
  const refreshed = refreshedModule.analytics.track({ ccid: "ccid_10001" });

  assert.equal(refreshed.pv, 1);
  assert.equal(refreshed.uv, 0);
  assert.equal(refreshed.anonymous_id, first.anonymous_id);
});

test("configured delivery uses fetch while visible and beacon while hidden", async () => {
  const browser = createBrowser();
  globalThis.window = browser.window;
  const { analytics } = await loadFreshModule();
  analytics.init({ endpoint: "https://example.test/events" });

  const visibleEvent = analytics.track({ ccid: "visible" });
  await Promise.resolve();

  assert.equal(browser.requests.length, 1);
  assert.equal(browser.requests[0].url, "https://example.test/events");
  assert.deepEqual(JSON.parse(browser.requests[0].options.body), visibleEvent);

  browser.document.visibilityState = "hidden";
  const hiddenEvent = analytics.track({ ccid: "hidden" });

  assert.equal(browser.beacons.length, 1);
  assert.equal(browser.beacons[0].url, "https://example.test/events");
  assert.deepEqual(JSON.parse(browser.beacons[0].body), hiddenEvent);
});

test("track rejects a missing or empty ccid", async () => {
  const browser = createBrowser();
  globalThis.window = browser.window;
  const { analytics } = await loadFreshModule();

  assert.throws(() => analytics.track(), /ccid/);
  assert.throws(() => analytics.track({ ccid: "  " }), /ccid/);
});
