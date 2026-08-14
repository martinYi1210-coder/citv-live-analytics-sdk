import assert from "node:assert/strict";
import test from "node:test";

const ENDPOINT = "https://checker.citv.cn/api/v2/analytics/page-views";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const requests = [];
  const beacons = [];
  const timers = [];
  const listeners = new Map();
  const document = {
    visibilityState: "visible",
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
  };
  const window = {
    document,
    localStorage: storage,
    location: { href: "https://example.test/live/room-001" },
    setTimeout(callback, delay) {
      timers.push({ callback, delay, cleared: false });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) {
        timers[id - 1].cleared = true;
      }
    },
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

  return { window, storage, document, requests, beacons, listeners, timers };
}

async function loadFreshModule() {
  return import(`./dist/index.js?test=${Date.now()}-${Math.random()}`);
}

test("init reports exactly one OpenAPI-compatible page view", async () => {
  const browser = createBrowser();
  globalThis.window = browser.window;
  const module = await loadFreshModule();

  assert.equal(module.track, undefined);
  assert.equal(module.analytics.track, undefined);

  const result = module.analytics.init({ appid: "app-1", ccid: "room-001" });
  assert.equal(browser.requests.length, 0);
  assert.equal(browser.timers.length, 1);
  assert.ok(browser.timers[0].delay >= 3 * 60_000);
  assert.ok(browser.timers[0].delay < 5 * 60_000);

  browser.timers[0].callback();
  await Promise.resolve();

  assert.equal(result, undefined);
  assert.equal(browser.requests.length, 1);
  assert.equal(browser.requests[0].url, ENDPOINT);
  assert.equal(browser.requests[0].options.method, "POST");
  assert.equal(browser.requests[0].options.headers["Content-Type"], "application/json");
  assert.equal(browser.requests[0].options.keepalive, true);

  const event = JSON.parse(browser.requests[0].options.body);
  assert.deepEqual(Object.keys(event).sort(), [
    "appid",
    "ccid",
    "event_id",
    "occurred_at",
    "page_url",
    "visitor_id",
  ]);
  assert.equal(event.appid, "app-1");
  assert.equal(event.ccid, "room-001");
  assert.match(event.visitor_id, UUID_PATTERN);
  assert.match(event.event_id, UUID_PATTERN);
  assert.equal(event.page_url, browser.window.location.href);
  assert.equal(new Date(event.occurred_at).toISOString(), event.occurred_at);
});

test("a refresh keeps visitor_id but creates a new page-view event", async () => {
  const browser = createBrowser();
  globalThis.window = browser.window;
  const firstModule = await loadFreshModule();
  firstModule.analytics.init({ appid: "app-1", ccid: "room-001" });
  browser.timers[0].callback();
  await Promise.resolve();
  const firstEvent = JSON.parse(browser.requests[0].options.body);

  const refreshedBrowser = createBrowser(browser.storage);
  globalThis.window = refreshedBrowser.window;
  const refreshedModule = await loadFreshModule();
  refreshedModule.analytics.init({ appid: "app-1", ccid: "room-001" });
  refreshedBrowser.timers[0].callback();
  await Promise.resolve();
  const refreshedEvent = JSON.parse(refreshedBrowser.requests[0].options.body);

  assert.equal(refreshedEvent.visitor_id, firstEvent.visitor_id);
  assert.notEqual(refreshedEvent.event_id, firstEvent.event_id);
});

test("init uses sendBeacon when the page is already hidden", async () => {
  const browser = createBrowser();
  browser.document.visibilityState = "hidden";
  globalThis.window = browser.window;
  const { analytics } = await loadFreshModule();

  analytics.init({ appid: "app-1", ccid: "room-001" });

  assert.equal(browser.requests.length, 0);
  assert.equal(browser.beacons.length, 1);
  assert.equal(browser.beacons[0].url, ENDPOINT);
  assert.equal(browser.beacons[0].body.type, "application/json");
});

test("a rejected beacon falls back to fetch with the same event", async () => {
  const browser = createBrowser();
  browser.document.visibilityState = "hidden";
  browser.window.navigator.sendBeacon = () => false;
  globalThis.window = browser.window;
  const { analytics } = await loadFreshModule();

  analytics.init({ appid: "app-1", ccid: "room-001" });
  await Promise.resolve();

  assert.equal(browser.requests.length, 1);
  assert.equal(browser.requests[0].url, ENDPOINT);
  assert.match(
    JSON.parse(browser.requests[0].options.body).event_id,
    UUID_PATTERN,
  );
});

test("multiple init calls share one timer and are sent sequentially", async () => {
  const browser = createBrowser();
  globalThis.window = browser.window;
  const { analytics } = await loadFreshModule();

  analytics.init({ appid: "app-1", ccid: "room-001" });
  analytics.init({ appid: "app-1", ccid: "room-002" });

  assert.equal(browser.timers.length, 1);
  browser.timers[0].callback();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(browser.requests.length, 2);
  assert.deepEqual(
    browser.requests.map(({ options }) => JSON.parse(options.body).ccid),
    ["room-001", "room-002"],
  );
});

test("init validates appid and ccid", async () => {
  const browser = createBrowser();
  globalThis.window = browser.window;
  const { analytics } = await loadFreshModule();

  assert.throws(() => analytics.init(), /appid/);
  assert.throws(() => analytics.init({ appid: "", ccid: "room-001" }), /appid/);
  assert.throws(() => analytics.init({ appid: "app-1", ccid: "" }), /ccid/);
});
