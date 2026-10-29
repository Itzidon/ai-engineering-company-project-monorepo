
import type { Supplier, SupplierInput, SupplierStatus } from "./types";

const BASE_URL = "/api/suppliers";

export class SupplierApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("brasaland_token");

  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch {
    throw new SupplierApiError(
      "No se pudo conectar con el servidor. Inténtalo de nuevo."
    );
  }

  if (response.status === 401) {
    localStorage.removeItem("brasaland_token");
    window.location.replace("/login");
    throw new SupplierApiError("Sesión caducada. Inicia sesión de nuevo.");
  }

  if (!response.ok) {
    const message =
      response.status === 400 || response.status === 422
        ? "Revisa los datos introducidos."
        : response.status === 404
          ? "No se encontró el proveedor solicitado."
          : response.status === 409
            ? "Ya existe un proveedor con ese nombre."
            : "No se pudo completar la operación. Inténtalo de nuevo.";

    throw new SupplierApiError(message);
  }

  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch {
    throw new SupplierApiError(
      "El servidor envió una respuesta no válida. Inténtalo de nuevo."
    );
  }
}

export function fetchSuppliers(): Promise<Supplier[]> {
  return request<Supplier[]>(BASE_URL, { cache: "no-store" });
}

export function createSupplier(data: SupplierInput): Promise<Supplier> {
  return request<Supplier>(BASE_URL, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateRate(
  id: number,
  rate_per_unit: number
): Promise<Supplier> {
  return request<Supplier>(`${BASE_URL}/${id}/rate`, {
    method: "PATCH",
    body: JSON.stringify({ rate_per_unit }),
  });
}

export function updateStatus(
  id: number,
  status: SupplierStatus
): Promise<Supplier> {
  return request<Supplier>(`${BASE_URL}/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
