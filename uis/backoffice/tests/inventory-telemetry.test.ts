import { track } from "../lib/telemetry";
import { startTelemetryCapture } from "../lib/telemetry-capture";
import {
  captureInboundOrder, captureOutboundOrder,
  type Ingredient, type InboundOrderResult, type OutboundOrderResult,
} from "../lib/inventory";

jest.mock("../lib/telemetry", () => ({
  track: jest.fn(),
  routeTemplate: (path: string) => path.replace(/\d+/g, ":id"),
}));

const product: Ingredient = {
  id: 3, name: "Never captured", sku: "INTERNAL", unit: "kg", category: "meat",
  country: "CO", current_stock: 10,
};
const inbound = { ingredient_id: 3, location_id: 1, quantity: 2, supplier_name: "Never captured" };
const outbound = { ingredient_id: 3, location_id: 1, quantity: 2, reason: "consumption" as const };
const created = {
  id: 1, ingredient_id: 3, quantity: 2, location_id: 1,
  ingredient_name: "Never captured", sku: "INTERNAL", order_type: "outbound" as const,
  created_at: "2026-11-10T00:00:00Z", user_uuid: "never-captured",
  previous_stock: 10, current_stock: 8,
};

beforeEach(() => jest.clearAllMocks());

it("captures confirmed inbound and real comparable price variance", () => {
  captureInboundOrder(product, inbound, {
    ...created, order_type: "inbound", supplier_key: "a".repeat(64),
    unit_cost: "120", baseline_unit_cost: 100, variance_pct: 20,
  } satisfies InboundOrderResult);
  expect(track).toHaveBeenNthCalledWith(1, "inbound_order_created", expect.objectContaining({ inbound_order_id: 1 }));
  expect(track).toHaveBeenNthCalledWith(2, "ingredient_price_variance_detected", expect.objectContaining({ variance_pct: 20 }));
  expect(JSON.stringify(jest.mocked(track).mock.calls)).not.toContain("Never captured");
});

it.each([null, 10, -10, 0])("does not invent price alerts for variance %s", variance => {
  captureInboundOrder(product, inbound, { ...created, variance_pct: variance } as InboundOrderResult);
  expect(track).toHaveBeenCalledTimes(1);
});

it("captures consumption and crossing with remaining stock rather than movement quantity", () => {
  captureOutboundOrder(product, outbound, created, "expired");
  expect(track).toHaveBeenNthCalledWith(1, "outbound_order_created", expect.objectContaining({ reason: "consumption", quantity: 2 }));
  expect(track).toHaveBeenNthCalledWith(2, "stock_threshold_triggered", expect.objectContaining({ quantity: 8, previous_stock: 10, threshold_quantity: 9 }));
});

it.each([
  { previous_stock: 8, current_stock: 7 },
  { previous_stock: 10, current_stock: 9 },
])("does not repeat alerts when no new crossing occurred", stock => {
  captureOutboundOrder(product, outbound, { ...created, ...stock }, "expired");
  expect(track).toHaveBeenCalledTimes(1);
});

it("does not invent a minimum for an unconfigured product", () => {
  captureOutboundOrder({ ...product, id: 999 }, outbound, created, "expired");
  expect(track).toHaveBeenCalledTimes(1);
});

it("captures waste with selected cause, never as consumption", () => {
  captureOutboundOrder(product, { ...outbound, reason: "waste" }, {
    ...created, previous_stock: 8, current_stock: 6,
  } satisfies OutboundOrderResult, "kitchen_error");
  expect(track).toHaveBeenCalledTimes(1);
  expect(track).toHaveBeenCalledWith("stock_waste_registered", expect.objectContaining({ reason: "kitchen_error" }));
});

it.each([403, 401, 404, 500])("only captures actual direct edit rejection on HTTP 403, not %s otherwise", async status => {
  globalThis.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
    detail: {
      code: "forbidden_direct_update", product_id: 3, location_id: 1,
      country: "CO", product_category: "meat", unit: "kg",
    },
  }), { status }));
  const listeners = new Map<string, () => void>();
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: require("node:crypto").webcrypto });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    fetch: originalFetch,
    location: { origin: "http://localhost", pathname: "/inventory/products/3/locations/1/stock" },
    setInterval: jest.fn(), addEventListener: jest.fn((name: string, callback: () => void) => listeners.set(name, callback)),
    removeEventListener: jest.fn(),
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { addEventListener: jest.fn() } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => "controlled-session-001", setItem: jest.fn() } });
  const stop = startTelemetryCapture();
  await window.fetch("/inventory/products/3/locations/1/stock", {
    method: "PATCH", body: JSON.stringify({ current_stock: 999 }),
  });
  const rejections = jest.mocked(track).mock.calls.filter(([name]) => name === "direct_stock_edit_rejected");
  expect(rejections).toHaveLength(status === 403 ? 1 : 0);
  if (status === 403) expect(rejections[0][1]).toMatchObject({ quantity: 999, attempted_operation: "direct_set" });
  stop();
});