"use client";

import allowlist from "./telemetry-allowlist.json";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import contract from "../../../docs/telemetry/event-schemas.json";

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
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validateEvent = ajv.compile(contract);
type EventSchemaDefinition = {
  properties?: Record<string, { properties?: Record<string, { enum?: unknown[] }> }>;
};
const enumValues = new Map<string, Set<string>>();
for (const definition of Object.values(
  (contract as { definitions: Record<string, EventSchemaDefinition> }).definitions
)) {
  for (const [key, schema] of Object.entries(
    definition.properties?.properties?.properties ?? {}
  )) {
    if (!schema.enum) continue;
    const values = enumValues.get(key) ?? new Set<string>();
    schema.enum.forEach(value => {
      if (typeof value === "string") values.add(value);
    });
    enumValues.set(key, values);
  }
}
const queue: TelemetryEvent[] = [];

let initialized = false;
let sending = false;

function sessionId(): string {
  const key = "brasaland_telemetry_session";
  try {
    let id = sessionStorage.getItem(key);
    if (!id || !/^[A-Za-z0-9_-]{16,128}$/.test(id)) {
      id = crypto.randomUUID().replaceAll("-", "");
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return fallbackSession;
  }
}

const fallbackSession = crypto.randomUUID().replaceAll("-", "");

export function routeTemplate(path: string): string {
  const clean = path.split(/[?#]/)[0];
  const normalized = clean.replace(/\/\d+(?=\/|$)/g, "/:id");
  return /^(?:\/|\/(?:login|register|forgot-password|reset-password)|\/account(?:\/(?:profile|password|users))?|\/backoffice\/inventory\/(?:products|orders(?:\/(?:inbound|outbound))?)|\/(?:inventory|api\/incidents|api\/suppliers|auth|users|profiles|suppliers)(?:\/(?:products|orders|inbound|outbound|locations|stock|:id|summary|status|rate|login|register|me|password|forgot-password|reset-password))*)$/.test(normalized)
    ? normalized
    : "/other";
}

function safeText(key: string, value: string): boolean {
  if (enumValues.get(key)?.has(value)) return true;
  if (key === "supplier_key") return /^[a-f0-9]{64}$/.test(value);
  if (key === "route_template" || key === "form_route") {
    return routeTemplate(value) !== "/other";
  }
  if (key === "error_fingerprint") {
    return ["window_error", "unhandled_rejection"].includes(value);
  }
  if (key === "filter_value") {
    return ["CO", "US", "meat", "produce", "sauce", "beverage", "packaging",
      "cleaning", "available", "low", "out_of_stock"].includes(value);
  }
  if (key === "role_key") return ["user", "admin"].includes(value);
  if (key === "error_code") {
    return ["insufficient_stock", "not_found", "forbidden", "unauthorized",
      "validation_error", "network_error"].includes(value);
  }
  return false;
}

function initialize(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.setInterval(() => {
    void flushTelemetry();
  }, FLUSH_INTERVAL);

  const sendPending = () => {
    while (queue.length > 0) {
      const batch = queue.slice(0, MAX_BATCH);
      const blob = new Blob([JSON.stringify({ events: batch })], {
        type: "application/json",
      });
      if (!navigator.sendBeacon?.(ENDPOINT, blob)) {
        void flushTelemetry();
        break;
      }
      queue.splice(0, batch.length);
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

  const permitted = Object.hasOwn(allowed, eventType) ? allowed[eventType] : undefined;
  if (!permitted) return;

  initialize();

  const safeProperties = Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) =>
        permitted.includes(key) && value !== undefined &&
        (typeof value === "number" ? Number.isFinite(value) :
          typeof value === "boolean" ||
          (typeof value === "string" && safeText(key, value)))
    )
  );

  for (const key of ["route_template", "form_route"]) {
    if (typeof safeProperties[key] === "string") {
      safeProperties[key] = routeTemplate(safeProperties[key]);
    }
  }
  const event: TelemetryEvent = {
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: sessionId(),
    userId: null,
    event_type: eventType,
    schemaVersion: "1.0.0",
    requestId: crypto.randomUUID(),
    properties: safeProperties,
  };
  if (!validateEvent(event)) return;
  queue.push(event);

  if (queue.length >= MAX_BATCH) {
    void flushTelemetry();
  }
}

export async function flushTelemetry(): Promise<void> {
  if (sending || queue.length === 0) return;

  sending = true;
  const batch = queue.splice(0, MAX_BATCH);
  let completed = false;

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: batch }),
          keepalive: true,
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          completed = true;
          return;
        }

        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          completed = true;
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
    queue.unshift(...batch);
  } finally {
    sending = false;
    if (completed && queue.length >= MAX_BATCH) void flushTelemetry();
  }
}
