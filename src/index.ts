const STORAGE_PREFIX = "citv_live_analytics"
const ANONYMOUS_ID_KEY = `${STORAGE_PREFIX}:anonymous_id`
const VISITED_ROOM_PREFIX = `${STORAGE_PREFIX}:visited_room:`

export interface AnalyticsInitOptions {
  endpoint?: string
}

export interface TrackOptions {
  ccid: string
}

export interface LiveRoomViewEvent {
  event: "live_room_view"
  event_id: string
  ccid: string
  anonymous_id: string
  pv: 1
  uv: 0 | 1
  timestamp: number
}

export interface Analytics {
  init(options?: AnalyticsInitOptions): Analytics
  track(options: TrackOptions): LiveRoomViewEvent
  flush(): Promise<boolean>
}

let endpoint = ""
let fallbackAnonymousId = ""
let visibilityListenerAttached = false
let eventSequence = 0

const fallbackVisitedRooms = new Set<string>()
const pendingEvents = new Map<string, LiveRoomViewEvent>()

function getBrowserWindow(): Window | null {
  return typeof window === "undefined" ? null : window
}

function createId(prefix: string): string {
  eventSequence += 1
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}_${eventSequence.toString(36)}`
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

function getAnonymousId(): string {
  const storage = getStorage()

  if (storage) {
    try {
      const storedId = storage.getItem(ANONYMOUS_ID_KEY)

      if (storedId) {
        fallbackAnonymousId = storedId
        return storedId
      }
    } catch {
      // Fall back to the in-memory id when storage is unavailable.
    }
  }

  if (!fallbackAnonymousId) {
    fallbackAnonymousId = createId("anon")
  }

  if (storage) {
    try {
      storage.setItem(ANONYMOUS_ID_KEY, fallbackAnonymousId)
    } catch {
      // Tracking can still work for the lifetime of the current page.
    }
  }

  return fallbackAnonymousId
}

function getVisitedRoomKey(anonymousId: string, ccid: string): string {
  return `${VISITED_ROOM_PREFIX}${encodeURIComponent(anonymousId)}:${encodeURIComponent(ccid)}`
}

function markRoomVisited(anonymousId: string, ccid: string): boolean {
  const key = getVisitedRoomKey(anonymousId, ccid)
  const storage = getStorage()

  if (storage) {
    try {
      const hasVisited = storage.getItem(key) === "1"

      if (!hasVisited) {
        storage.setItem(key, "1")
      }

      return hasVisited
    } catch {
      // Fall back to page memory when storage is unavailable.
    }
  }

  const hasVisited = fallbackVisitedRooms.has(key)
  fallbackVisitedRooms.add(key)
  return hasVisited
}

function sendWithBeacon(event: LiveRoomViewEvent): boolean {
  const browserWindow = getBrowserWindow()

  if (
    !browserWindow ||
    !endpoint ||
    typeof browserWindow.navigator.sendBeacon !== "function"
  ) {
    return false
  }

  const sendBeacon = browserWindow.navigator.sendBeacon

  try {
    const accepted = sendBeacon.call(
      browserWindow.navigator,
      endpoint,
      JSON.stringify(event),
    )

    if (accepted) {
      pendingEvents.delete(event.event_id)
    }

    return accepted
  } catch {
    return false
  }
}

async function sendWithFetch(event: LiveRoomViewEvent): Promise<boolean> {
  const browserWindow = getBrowserWindow()

  if (!endpoint || typeof browserWindow?.fetch !== "function") {
    return false
  }

  const requestEndpoint = endpoint

  try {
    const response = await browserWindow.fetch(requestEndpoint, {
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

function send(event: LiveRoomViewEvent): void {
  if (!endpoint) {
    return
  }

  pendingEvents.set(event.event_id, event)

  const browserWindow = getBrowserWindow()
  const isHidden = browserWindow?.document.visibilityState === "hidden"

  if (isHidden && sendWithBeacon(event)) {
    return
  }

  void sendWithFetch(event)
}

function flushWithBeacon(): void {
  for (const event of pendingEvents.values()) {
    sendWithBeacon(event)
  }
}

function attachVisibilityListener(): void {
  const browserWindow = getBrowserWindow()

  if (visibilityListenerAttached || !browserWindow) {
    return
  }

  browserWindow.document.addEventListener("visibilitychange", () => {
    if (browserWindow.document.visibilityState === "hidden") {
      flushWithBeacon()
    }
  })
  visibilityListenerAttached = true
}

export function init(options: AnalyticsInitOptions = {}): Analytics {
  if (options.endpoint !== undefined && typeof options.endpoint !== "string") {
    throw new TypeError("analytics.init: endpoint must be a string")
  }

  endpoint = options.endpoint?.trim() || ""
  attachVisibilityListener()

  if (endpoint) {
    for (const event of pendingEvents.values()) {
      void sendWithFetch(event)
    }
  }

  return analytics
}

export function track(options: TrackOptions): LiveRoomViewEvent {
  const ccid = options?.ccid

  if (typeof ccid !== "string" || !ccid.trim()) {
    throw new TypeError("analytics.track: ccid must be a non-empty string")
  }

  attachVisibilityListener()

  const normalizedCcid = ccid.trim()
  const anonymousId = getAnonymousId()
  const hasVisited = markRoomVisited(anonymousId, normalizedCcid)
  const event: LiveRoomViewEvent = {
    event: "live_room_view",
    event_id: createId("evt"),
    ccid: normalizedCcid,
    anonymous_id: anonymousId,
    pv: 1,
    uv: hasVisited ? 0 : 1,
    timestamp: Date.now(),
  }

  send(event)
  return event
}

export async function flush(): Promise<boolean> {
  if (!endpoint) {
    return false
  }

  const results = await Promise.all(
    Array.from(pendingEvents.values(), (event) => sendWithFetch(event)),
  )
  return results.every(Boolean)
}

export const analytics: Analytics = Object.freeze({
  init,
  track,
  flush,
})

export default analytics
