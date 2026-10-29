import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  createSupplier,
  fetchSuppliers,
  SupplierApiError,
  updateRate,
  updateStatus,
} from "../app/suppliers/api";
import type { Supplier, SupplierInput } from "../app/suppliers/types";

const fetchMock = jest.fn<typeof fetch>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const replaceMock = jest.fn();
const input: SupplierInput = {
  name: "Proveedor Test",
  country: "Colombia",
  categories: ["carne"],
  rate_per_unit: 1000,
  currency: "COP",
  status: "active",
};
const supplier: Supplier = {
  ...input,
  id: 1,
  updated_at: "2026-10-29T12:00:00Z",
};
const operations = [
  { name: "fetchSuppliers", run: () => fetchSuppliers(), url: "/api/suppliers", method: undefined, body: undefined, result: [supplier] },
  { name: "createSupplier", run: () => createSupplier(input), url: "/api/suppliers", method: "POST", body: input, result: supplier },
  { name: "updateRate", run: () => updateRate(1, 0.001), url: "/api/suppliers/1/rate", method: "PATCH", body: { rate_per_unit: 0.001 }, result: { ...supplier, rate_per_unit: 0.001 } },
  { name: "updateStatus", run: () => updateStatus(1, "suspended"), url: "/api/suppliers/1/status", method: "PATCH", body: { status: "suspended" }, result: { ...supplier, status: "suspended" } },
];

beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: jest.fn(() => null),
      removeItem: jest.fn(),
      setItem: jest.fn(),
      clear: jest.fn(),
      key: jest.fn(() => null),
      length: 0,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { replace: replaceMock } },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  fetchMock.mockReset();
  if (originalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("fetchSuppliers", () => {
  it("returns an empty supplier directory", async () => {
    fetchMock.mockResolvedValue(Response.json([]));
    await expect(fetchSuppliers()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith("/api/suppliers", expect.objectContaining({
      cache: "no-store",
    }));
  });

  it("wraps network failures without exposing internal details", async () => {
    fetchMock.mockRejectedValue(new Error("PRIVATE_NETWORK_DETAILS"));
    await expect(fetchSuppliers()).rejects.toBeInstanceOf(SupplierApiError);
    await expect(fetchSuppliers()).rejects.not.toThrow("PRIVATE_NETWORK_DETAILS");
  });
});

describe.each(operations)("$name", ({ run, url, method, body, result }) => {
  it("returns the response and sends the expected input without mutating it", async () => {
    const before = structuredClone(input);
    fetchMock.mockResolvedValue(Response.json(result));
    await expect(run()).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestedUrl, options] = fetchMock.mock.calls[0];
    expect(requestedUrl).toBe(url);
    expect(options?.method).toBe(method);
    expect(options?.body).toBe(body ? JSON.stringify(body) : undefined);
    const headers = new Headers(options?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.has("Authorization")).toBe(false);
    expect(input).toEqual(before);
  });

  it("converts a connection failure to a safe domain error", async () => {
    fetchMock.mockRejectedValue(new Error("PRIVATE_NETWORK_DETAILS"));
    await expect(run()).rejects.toMatchObject({
      name: "SupplierApiError",
      message: "No se pudo conectar con el servidor. Inténtalo de nuevo.",
    });
  });

  it("sends the stored JWT and clears an expired session before redirecting", async () => {
    jest.mocked(localStorage.getItem).mockReturnValue("test-token");
    fetchMock.mockResolvedValue(Response.json({ detail: "PRIVATE" }, { status: 401 }));
    await expect(run()).rejects.toMatchObject({ name: "SupplierApiError" });
    expect(localStorage.getItem).toHaveBeenCalledWith("brasaland_token");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer test-token");
    expect(localStorage.removeItem).toHaveBeenCalledWith("brasaland_token");
    expect(replaceMock).toHaveBeenCalledWith("/login");
    expect(jest.mocked(localStorage.removeItem).mock.invocationCallOrder[0]).toBeLessThan(replaceMock.mock.invocationCallOrder[0]);
  });
});

it.each([
  [400, "Revisa los datos introducidos."],
  [422, "Revisa los datos introducidos."],
  [404, "No se encontró el proveedor solicitado."],
  [409, "Ya existe un proveedor con ese nombre."],
  [403, "No se pudo completar la operación. Inténtalo de nuevo."],
  [500, "No se pudo completar la operación. Inténtalo de nuevo."],
])("maps supplier error %i to a safe message", async (status, message) => {
  fetchMock.mockResolvedValue(Response.json({ detail: "PRIVATE_SERVER_DETAILS" }, { status }));
  await expect(fetchSuppliers()).rejects.toMatchObject({ name: "SupplierApiError", message });
  expect(localStorage.removeItem).not.toHaveBeenCalled();
  expect(replaceMock).not.toHaveBeenCalled();
});

it("does not attempt to parse an empty 204 response", async () => {
  const response = new Response(null, { status: 204 });
  const parse = jest.spyOn(response, "json");
  fetchMock.mockResolvedValue(response);
  await expect(updateStatus(1, "active")).resolves.toBeUndefined();
  expect(parse).not.toHaveBeenCalled();
});

it("converts malformed successful JSON to a safe domain error", async () => {
  fetchMock.mockResolvedValue(new Response("PRIVATE_NON_JSON_BODY"));
  await expect(fetchSuppliers()).rejects.toMatchObject({
    name: "SupplierApiError",
    message: "El servidor envió una respuesta no válida. Inténtalo de nuevo.",
  });
});