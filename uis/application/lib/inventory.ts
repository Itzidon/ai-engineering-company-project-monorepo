import { track } from "./telemetry";

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

  const routeTemplate = (`/inventory${path}`)
    .split("?")[0]
    .replace(/\/products\/\d+$/, "/products/:id");
  const method = options.method || "GET";
  const started = performance.now();

  let response: Response;

  try {
    response = await fetch(`/inventory${path}`, {
      ...options,
      headers,
    });
  } catch {
    track("api_request_failed", {
      route_template: routeTemplate,
      method,
      failure_kind: "network",
      duration_ms: performance.now() - started,
    });
    throw new InventoryApiError(
      "No se pudo conectar con el servidor.",
      0
    );
  }

  const duration = performance.now() - started;

  track("api_latency_recorded", {
    route_template: routeTemplate,
    method,
    status_family: `${Math.floor(response.status / 100)}xx`,
    duration_ms: duration,
  });

  if (response.status >= 500) {
    track("api_request_failed", {
      route_template: routeTemplate,
      method,
      failure_kind: "server_5xx",
      duration_ms: duration,
    });
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

export function createInboundOrder(data: InboundData) {
  return inventoryRequest<InventoryOrder>("/orders/inbound", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function createOutboundOrder(data: OutboundData) {
  return inventoryRequest<InventoryOrder>("/orders/outbound", {
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
