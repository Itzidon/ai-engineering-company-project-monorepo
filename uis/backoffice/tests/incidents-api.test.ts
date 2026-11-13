import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  createIncident,
  fetchIncident,
  fetchIncidents,
  fetchIncidentSummary,
  IncidentApiError,
  updateIncidentStatus,
} from "../app/incidents/api";
import type { Incident, IncidentInput, IncidentSummary } from "../app/incidents/types";

const fetchMock = jest.fn<typeof fetch>();
const input: IncidentInput = {
  title: "Horno averiado",
  description: "El horno principal no funciona.",
  category: "equipment_failure",
  status: "open",
  origin: "branch",
  branch: "medellin_centro",
};
const incident: Incident = {
  ...input,
  id: 1,
  created_at: "2026-10-29T12:00:00Z",
  updated_at: "2026-10-29T12:00:00Z",
};
const summary: IncidentSummary = {
  total: 1,
  by_status: { open: 1 },
  by_category: { equipment_failure: 1 },
  by_origin: { branch: 1 },
  by_branch: { medellin_centro: 1 },
};
const operations = [
  { name: "fetchIncidents", run: () => fetchIncidents(), url: "/api/incidents", method: undefined, body: undefined, result: [incident] },
  { name: "fetchIncident", run: () => fetchIncident(1), url: "/api/incidents/1", method: undefined, body: undefined, result: incident },
  { name: "createIncident", run: () => createIncident(input), url: "/api/incidents", method: "POST", body: input, result: incident },
  { name: "updateIncidentStatus", run: () => updateIncidentStatus(1, "in_progress"), url: "/api/incidents/1/status", method: "PATCH", body: { status: "in_progress" }, result: { ...incident, status: "in_progress" } },
  { name: "fetchIncidentSummary", run: () => fetchIncidentSummary(), url: "/api/incidents/summary", method: undefined, body: undefined, result: summary },
];

beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
});

afterEach(() => {
  jest.restoreAllMocks();
  fetchMock.mockReset();
});

describe.each(operations)("$name", ({ run, url, method, body, result }) => {
  it("returns the expected data and preserves the caller input", async () => {
    const before = structuredClone(input);
    fetchMock.mockResolvedValue(Response.json(result));
    await expect(run()).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestedUrl, options] = fetchMock.mock.calls[0];
    expect(requestedUrl).toBe(url);
    expect(options?.method).toBe(method);
    expect(options?.body).toBe(body ? JSON.stringify(body) : undefined);
    expect(options?.cache).toBe("no-store");
    const headers = new Headers(options?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.has("Authorization")).toBe(false);
    expect(input).toEqual(before);
  });

  it("rejects connection failures with a domain error", async () => {
    fetchMock.mockRejectedValue(new Error("PRIVATE_NETWORK_DETAILS"));
    await expect(run()).rejects.toBeInstanceOf(IncidentApiError);
  });

  it("rejects unexpected server errors without exposing their details", async () => {
    fetchMock.mockResolvedValue(Response.json({ detail: "PRIVATE_SERVER_DETAILS" }, { status: 500 }));
    await expect(run()).rejects.toMatchObject({
      name: "IncidentApiError",
      message: "Ha ocurrido un error. Inténtalo de nuevo.",
      field: undefined,
    });
  });
});

it("encodes all incident filters without changing the original filters", async () => {
  const filters = {
    status: "open", origin: "branch", branch: "medellin_centro", category: "equipment_failure",
  } as const;
  fetchMock.mockResolvedValue(Response.json([]));
  await expect(fetchIncidents(filters)).resolves.toEqual([]);
  const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
  expect(url.pathname).toBe("/api/incidents");
  expect(Object.fromEntries(url.searchParams)).toEqual(filters);
  expect(filters).toEqual({ status: "open", origin: "branch", branch: "medellin_centro", category: "equipment_failure" });
});

it.each([{}, { status: undefined }])("omits an empty incident query: %j", async (filters) => {
  fetchMock.mockResolvedValue(Response.json([]));
  await expect(fetchIncidents(filters)).resolves.toEqual([]);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/incidents");
});

it.each([
  { status: 400, body: { detail: { message: "Estado no permitido", field: "status" } }, message: "Estado no permitido", field: "status" },
  { status: 400, body: { detail: "Datos incorrectos" }, message: "Datos incorrectos", field: undefined },
  { status: 400, body: { detail: { message: 123 } }, message: "Comprueba los datos introducidos.", field: undefined },
  { status: 400, body: {}, message: "Comprueba los datos introducidos.", field: undefined },
  { status: 404, body: { detail: "PRIVATE_SERVER_DETAILS" }, message: "La incidencia solicitada no existe.", field: undefined },
  { status: 422, body: { detail: "PRIVATE_SERVER_DETAILS" }, message: "Ha ocurrido un error. Inténtalo de nuevo.", field: undefined },
])("maps incident error $status with body $body", async ({ status, body, message, field }) => {
  fetchMock.mockResolvedValue(Response.json(body, { status }));
  await expect(fetchIncidents()).rejects.toMatchObject({ name: "IncidentApiError", message, field });
});

it.each([
  [400, "Comprueba los datos introducidos."],
  [404, "La incidencia solicitada no existe."],
  [500, "Ha ocurrido un error. Inténtalo de nuevo."],
])("handles malformed JSON in incident error %i", async (status, message) => {
  fetchMock.mockResolvedValue(new Response("PRIVATE_NON_JSON_BODY", { status }));
  await expect(fetchIncidents()).rejects.toMatchObject({ name: "IncidentApiError", message });
});

it("rejects a successful response with malformed JSON rather than returning invalid data", async () => {
  fetchMock.mockResolvedValue(new Response("not-json"));
  await expect(fetchIncidents()).rejects.toMatchObject({ name: "SyntaxError" });
});