import { track } from "./telemetry";
import minimums from "./stock-minimums.json";

export type Ingredient = {
  id: number;
  name: string;
  sku: string;
  unit: "kg" | "litro" | "unidad";
  category: string;
  country: "CO" | "US";
  current_stock: number;
};

export type InventoryOrder = {
  id: number;
  ingredient_id: number;
  ingredient_name: string;
  sku: string;
  quantity: number;
  order_type: "inbound" | "outbound";
  location_id: number;
  created_at: string;
  user_uuid: string;
  supplier_name?: string | null;
  reason?: string | null;
};

export type InboundData = {
  ingredient_id: number;
  quantity: number;
  supplier_name: string;
  location_id: number;
  unit_cost?: number;
};

export type OutboundData = {
  ingredient_id: number;
  quantity: number;
  reason: "consumption" | "waste";
  location_id: number;
};

export class InventoryApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "InventoryApiError";
  }
}

function errorMessage(data: unknown): string {
  if (typeof data !== "object" || data === null) {
    return "No se pudo completar la operación.";
  }

  const detail = (data as { detail?: unknown }).detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.msg || "Datos no válidos")
      .join(". ");
  }

  return "No se pudo completar la operación.";
}

async function inventoryRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("brasaland_token")
      : null;

  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(`/inventory${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new InventoryApiError(
      "No se pudo conectar con el servidor.",
      0
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("brasaland_token");
      window.location.assign("/login");
    }

    throw new InventoryApiError(
      errorMessage(data),
      response.status
    );
  }

  return data as T;
}

export function fetchIngredients() {
  return inventoryRequest<Ingredient[]>("/products");
}

export function fetchIngredient(id: number) {
  return inventoryRequest<Ingredient>(`/products/${id}`);
}

export function fetchInventoryOrders() {
  return inventoryRequest<InventoryOrder[]>("/orders");
}

export type InboundOrderResult = InventoryOrder & {
  unit_cost?: number | string | null;
  supplier_key?: string | null;
  baseline_unit_cost?: number | null;
  variance_pct?: number | null;
};

export function createInboundOrder(data: InboundData) {
  return inventoryRequest<InboundOrderResult>("/orders/inbound", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function createOutboundOrder(data: OutboundData) {
  return inventoryRequest<OutboundOrderResult>("/orders/outbound", {
    method: "POST",
    body: JSON.stringify(data),
  });
}


export type LocalStock = {
  product_id: number;
  location_id: number;
  country: "CO" | "US";
  unit: "kg" | "litro" | "unidad";
  current_stock: number;
};

export function fetchLocalStock(
  productId: number,
  locationId: number
) {
  return inventoryRequest<LocalStock>(
    `/products/${productId}/locations/${locationId}/stock`
  );
}

export type OutboundOrderResult = InventoryOrder & {
  previous_stock: number;
  current_stock: number;
};

export type WasteReason = "expired" | "kitchen_error" | "theft_suspected";

function productProperties(product: Ingredient, locationId: number) {
  return {
    location_id: locationId,
    country: product.country,
    product_id: product.id,
    product_category: product.category,
    unit: product.unit,
    currency: product.country === "CO" ? "COP" : "USD",
  };
}

export function captureInboundOrder(
  product: Ingredient, data: InboundData, created: InboundOrderResult
) {
  const properties = {
    ...productProperties(product, data.location_id),
    quantity: created.quantity,
    inbound_order_id: created.id,
  };
  track("inbound_order_created", properties);

  const variance = Number(created.variance_pct);
  const cost = Number(created.unit_cost);
  const baseline = Number(created.baseline_unit_cost);
  if (created.supplier_key && created.variance_pct != null &&
      created.unit_cost != null && created.baseline_unit_cost != null &&
      Number.isFinite(variance) && Number.isFinite(cost) &&
      Number.isFinite(baseline) && baseline > 0 && Math.abs(variance) > 10) {
    track("ingredient_price_variance_detected", {
      ...properties, supplier_key: created.supplier_key, unit_cost: cost,
      baseline_unit_cost: baseline, variance_pct: variance, threshold_pct: 10,
    });
  }
}

export function captureOutboundOrder(
  product: Ingredient, data: OutboundData, created: OutboundOrderResult,
  wasteReason: WasteReason
) {
  const properties = {
    ...productProperties(product, data.location_id),
    quantity: created.quantity,
    outbound_order_id: created.id,
  };
  track(data.reason === "waste" ? "stock_waste_registered" : "outbound_order_created", {
    ...properties, reason: data.reason === "waste" ? wasteReason : "consumption",
  });
  const minimum = (minimums as Record<string, number>)[`${data.location_id}:${product.id}`];
  if (Number.isFinite(minimum) && minimum > 0 &&
      Number.isFinite(created.previous_stock) && Number.isFinite(created.current_stock) &&
      created.previous_stock >= minimum && created.current_stock < minimum) {
    track("stock_threshold_triggered", {
      ...properties, quantity: created.current_stock,
      threshold_quantity: minimum, previous_stock: created.previous_stock,
    });
  }
}
