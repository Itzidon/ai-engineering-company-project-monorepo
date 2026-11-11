import { webcrypto } from "node:crypto";

const validProperties = {
  location_id: 1, country: "CO", product_id: 1, product_category: "meat",
  quantity: 2, unit: "kg", currency: "COP", inbound_order_id: 1,
};

describe("telemetry delivery", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { setInterval, addEventListener: jest.fn() },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { addEventListener: jest.fn() },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: { getItem: () => "controlled-session-001", setItem: jest.fn() },
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => null },
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("retains the same event after exhausted retries and recovers", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("offline"));
    globalThis.fetch = fetchMock;
    const { track, flushTelemetry } = await import("../lib/telemetry");
    track("inbound_order_created", validProperties);
    const pending = flushTelemetry();
    await jest.advanceTimersByTimeAsync(3500);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const originalBody = fetchMock.mock.calls[0][1].body;
    fetchMock.mockResolvedValue({ ok: true });
    await flushTelemetry();
    expect(fetchMock.mock.calls[4][1].body).toBe(originalBody);
    await flushTelemetry();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("captures cross-cutting failures without messages, queries, or identifiers", async () => {
    const listeners = new Map<string, () => void>();
    const originalFetch = jest.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    Object.assign(window, {
      fetch: originalFetch,
      location: { origin: "http://localhost", pathname: "/reset-password?token=secret" },
      addEventListener: jest.fn((name, callback) => listeners.set(name, callback)),
      removeEventListener: jest.fn(),
    });
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true });
    const { startTelemetryCapture } = await import("../lib/telemetry-capture");
    const { flushTelemetry } = await import("../lib/telemetry");
    const stop = startTelemetryCapture();
    await window.fetch("/inventory/products/123/locations/1/stock?email=private@example.com");
    listeners.get("error")?.();
    listeners.get("unhandledrejection")?.();
    await flushTelemetry();
    const body = jest.mocked(globalThis.fetch).mock.calls[0][1]?.body as string;
    expect(body).toContain("/inventory/products/:id/locations/:id/stock");
    expect(body).toContain("frontend_error_captured");
    expect(body).toContain("api_request_failed");
    expect(body).not.toMatch(/private|secret|example/);
    stop();
    expect(window.fetch).toBe(originalFetch);
  });

  it("flushes at 10 seconds or immediately at 20 events and drains full batches", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    const { track } = await import("../lib/telemetry");
    track("inbound_order_created", validProperties);
    await jest.advanceTimersByTimeAsync(9999);
    expect(fetchMock).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 40; index++) track("inbound_order_created", validProperties);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).events).toHaveLength(20);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).events).toHaveLength(20);
  });

  it.each([429, 500])("retries transient HTTP %s with unchanged event IDs", async status => {
    const fetchMock = jest.fn().mockResolvedValueOnce({ ok: false, status }).mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    const { track, flushTelemetry } = await import("../lib/telemetry");
    track("inbound_order_created", validProperties);
    const pending = flushTelemetry();
    await jest.advanceTimersByTimeAsync(500);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
  });

  it("does not retry or retain permanently invalid HTTP 422 events", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 422 });
    globalThis.fetch = fetchMock;
    const { track, flushTelemetry } = await import("../lib/telemetry");
    track("inbound_order_created", validProperties);
    await flushTelemetry();
    await flushTelemetry();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("only clears the unload queue when sendBeacon accepts it: %s", async accepted => {
    const listeners = new Map<string, () => void>();
    Object.assign(window, { addEventListener: jest.fn((name, callback) => listeners.set(name, callback)) });
    const beacon = jest.fn().mockReturnValue(accepted);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: beacon } });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    const { track, flushTelemetry } = await import("../lib/telemetry");
    track("inbound_order_created", validProperties);
    listeners.get("pagehide")?.();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][1]).toBeInstanceOf(Blob);
    await flushTelemetry();
    expect(fetchMock).toHaveBeenCalledTimes(accepted ? 0 : 1);
  });

  it("drops unknown events and invalid values, strips PII and never parses the JWT", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    const getToken = jest.fn(() => "must-not-be-read");
    Object.assign(localStorage, { getItem: getToken });
    const { track, flushTelemetry } = await import("../lib/telemetry");
    track("constructor", validProperties);
    track("unknown_event", validProperties);
    track("inbound_order_created", { ...validProperties, country: "person@example.com" });
    track("inbound_order_created", { ...validProperties, product_id: { name: "Private" } });
    track("inbound_order_created", {
      ...validProperties, email: "person@example.com", password: "Private",
      name: "Private", nested: { token: "Private" }, supplier_key: "person@example.com",
    });
    track("inventory_filters_applied", {
      filter_type: "country", filter_value: "Marta", result_count: 1,
    });
    await flushTelemetry();
    const events = JSON.parse(fetchMock.mock.calls[0][1].body).events;
    expect(events).toHaveLength(1);
    expect(events[0].properties).toEqual(validProperties);
    expect(events[0].userId).toBeNull();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("still captures when sessionStorage is blocked", async () => {
    Object.assign(sessionStorage, { getItem: () => { throw new Error("blocked"); } });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    const { track, flushTelemetry } = await import("../lib/telemetry");
    expect(() => track("inbound_order_created", validProperties)).not.toThrow();
    await flushTelemetry();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});