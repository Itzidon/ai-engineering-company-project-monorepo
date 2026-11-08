"use client";

import allowlist from "./telemetry-allowlist.json";

type EventProperties = Record<string, unknown>;

type TelemetryEvent = {
  eventId: string;
  timestamp: string;
  sessionId: string | null;
  userId: string | null;
  event_type: string;
  schemaVersion: string;
  requestId: string;
  properties: EventProperties;
};

const MAX_BATCH = 20;
const FLUSH_INTERVAL = 10000;
const ENDPOINT =
  process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT ||
  "/telemetry/events";

const allowed = allowlist as Record<string, string[]>;
const queue: TelemetryEvent[] = [];

let initialized = false;
let sending = false;

function currentUserId(): string | null {
  try {
    const token = localStorage.getItem("brasaland_token");
    if (!token) return null;

    const payload = token.split(".")[1];
    if (!payload) return null;

    const normalized = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const claims = JSON.parse(atob(normalized)) as {
      sub?: unknown;
      exp?: unknown;
    };

    if (
      typeof claims.exp === "number" &&
      claims.exp * 1000 <= Date.now()
    ) return null;

    return typeof claims.sub === "string" &&
      /^[0-9]+$/.test(claims.sub)
      ? claims.sub
      : null;
  } catch {
    return null;
  }
}

function sessionId(): string {
  const key = "brasaland_telemetry_session";
  let id = sessionStorage.getItem(key);

  if (!id) {
    id = crypto.randomUUID().replaceAll("-", "");
    sessionStorage.setItem(key, id);
  }

  return id;
}

function initialize(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.setInterval(() => {
    void flushTelemetry();
  }, FLUSH_INTERVAL);

  const sendPending = () => {
    if (queue.length === 0) return;

    const body = JSON.stringify({ events: queue });
    const blob = new Blob([body], {
      type: "application/json",
    });

    if (navigator.sendBeacon?.(ENDPOINT, blob)) {
      queue.length = 0;
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sendPending();
    }
  });

  window.addEventListener("pagehide", sendPending);
}

export function track(
  eventType: string,
  properties: EventProperties = {}
): void {
  if (typeof window === "undefined") return;

  const permitted = allowed[eventType];
  if (!permitted) return;

  initialize();

  const safeProperties = Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) =>
        permitted.includes(key) && value !== undefined
    )
  );

  queue.push({
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: sessionId(),
    userId: currentUserId(),
    event_type: eventType,
    schemaVersion: "1.0.0",
    requestId: crypto.randomUUID(),
    properties: safeProperties,
  });

  if (queue.length >= MAX_BATCH) {
    void flushTelemetry();
  }
}

export async function flushTelemetry(): Promise<void> {
  if (sending || queue.length === 0) return;

  sending = true;
  const batch = queue.splice(0, MAX_BATCH);

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: batch }),
        });

        if (response.ok) return;

        if (response.status >= 400 && response.status < 500) {
          return;
        }
      } catch {
        // Error temporal de conexion.
      }

      if (attempt < 3) {
        await new Promise(resolve =>
          setTimeout(resolve, 500 * 2 ** attempt)
        );
      }
    }
  } finally {
    sending = false;
  }
}
