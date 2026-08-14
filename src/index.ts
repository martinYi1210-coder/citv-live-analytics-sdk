const REPORT_ENDPOINT = "https://checker.citv.cn/v2/analytics/page-views"
const VISITOR_ID_KEY = "citv_live_analytics:visitor_id"
const REPORT_DELAY_MIN_MS = 3 * 60_000
const REPORT_DELAY_JITTER_MS = 2 * 60_000

export interface AnalyticsInitOptions {
  appid: string
  ccid: string
}

export interface PageViewRequest {
  appid: string
  ccid: string
  visitor_id: string
  event_id: string
  occurred_at: string
  page_url: string
}

export interface Analytics {
  init(options: AnalyticsInitOptions): void
}

let fallbackVisitorId = ""
let visibilityListenerAttached = false
let reportTimer: number | null = null

const pendingEvents = new Map<string, PageViewRequest>()

function getBrowserWindow(): Window | null {
  return typeof window === "undefined" ? null : window
}

function createUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    const value = character === "x" ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function getStorage(): Storage | null {
  const browserWindow = getBrowserWindow()

  if (!browserWindow) {
    return null
  }

  try {
    return browserWindow.localStorage
  } catch {
    return null
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function getVisitorId(): string {
  const storage = getStorage()

  if (storage) {
    try {
      const storedId = storage.getItem(VISITOR_ID_KEY)

      if (storedId && isUuid(storedId)) {
        fallbackVisitorId = storedId
        return storedId
      }
    } catch {
      // Fall back to page memory when localStorage is unavailable.
    }
  }

  if (!fallbackVisitorId) {
    fallbackVisitorId = createUuid()
  }

  if (storage) {
    try {
      storage.setItem(VISITOR_ID_KEY, fallbackVisitorId)
    } catch {
      // The in-memory visitor id remains usable for the current page.
    }
  }

  return fallbackVisitorId
}

function sendWithBeacon(event: PageViewRequest): boolean {
  const browserWindow = getBrowserWindow()

  if (
    !browserWindow ||
    typeof browserWindow.navigator.sendBeacon !== "function"
  ) {
    return false
  }

  try {
    const body = new Blob([JSON.stringify(event)], {
      type: "application/json",
    })
    const accepted = browserWindow.navigator.sendBeacon(REPORT_ENDPOINT, body)

    if (accepted) {
      pendingEvents.delete(event.event_id)
    }

    return accepted
  } catch {
    return false
  }
}

async function sendWithFetch(event: PageViewRequest): Promise<boolean> {
  const browserWindow = getBrowserWindow()

  if (typeof browserWindow?.fetch !== "function") {
    return false
  }

  try {
    const response = await browserWindow.fetch(REPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
      keepalive: true,
    })

    if (!response.ok) {
      return false
    }

    pendingEvents.delete(event.event_id)
    return true
  } catch {
    return false
  }
}

async function flushWithFetch(): Promise<void> {
  for (const event of Array.from(pendingEvents.values())) {
    await sendWithFetch(event)
  }
}

function flushWithBeacon(): void {
  for (const event of pendingEvents.values()) {
    sendWithBeacon(event)
  }
}

function attachVisibilityListener(browserWindow: Window): void {
  if (visibilityListenerAttached) {
    return
  }

  browserWindow.document.addEventListener("visibilitychange", () => {
    if (browserWindow.document.visibilityState === "hidden") {
      if (reportTimer !== null) {
        browserWindow.clearTimeout(reportTimer)
        reportTimer = null
      }

      flushWithBeacon()
      void flushWithFetch()
    }
  })
  visibilityListenerAttached = true
}

function scheduleReport(browserWindow: Window): void {
  if (reportTimer !== null) {
    return
  }

  const delay =
    REPORT_DELAY_MIN_MS + Math.floor(Math.random() * REPORT_DELAY_JITTER_MS)

  reportTimer = browserWindow.setTimeout(() => {
    reportTimer = null
    void flushWithFetch()
  }, delay)
}

function validateIdentifier(name: "appid" | "ccid", value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`analytics.init: ${name} must be a non-empty string`)
  }

  const normalizedValue = value.trim()

  if (normalizedValue.length > 128) {
    throw new TypeError(`analytics.init: ${name} must not exceed 128 characters`)
  }

  return normalizedValue
}

export function init(options: AnalyticsInitOptions): void {
  const appid = validateIdentifier("appid", options?.appid)
  const ccid = validateIdentifier("ccid", options?.ccid)
  const browserWindow = getBrowserWindow()

  if (!browserWindow) {
    throw new Error("analytics.init: a browser environment is required")
  }

  const pageUrl = browserWindow.location.href

  if (pageUrl.length > 2048) {
    throw new TypeError("analytics.init: page_url must not exceed 2048 characters")
  }

  attachVisibilityListener(browserWindow)

  const event: PageViewRequest = {
    appid,
    ccid,
    visitor_id: getVisitorId(),
    event_id: createUuid(),
    occurred_at: new Date().toISOString(),
    page_url: pageUrl,
  }

  pendingEvents.set(event.event_id, event)

  if (
    browserWindow.document.visibilityState === "hidden" &&
    sendWithBeacon(event)
  ) {
    return
  }

  if (browserWindow.document.visibilityState === "hidden") {
    void flushWithFetch()
    return
  }

  scheduleReport(browserWindow)
}

export const analytics: Analytics = Object.freeze({
  init,
})

export default analytics
