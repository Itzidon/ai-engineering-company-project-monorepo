"use client";

import { routeTemplate, track } from "./telemetry";

export function startTelemetryCapture(): () => void {
  const originalFetch = window.fetch;
  const telemetryUrl = new URL(
    process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT || "/telemetry/events",
    window.location.origin,
  );

  const observedFetch: typeof fetch = async (input, options) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), window.location.origin);
    if (url.origin !== window.location.origin || url.href === telemetryUrl.href ||
        !/^\/(?:inventory|auth|users|profiles|suppliers|api\/(?:incidents|suppliers))(?:\/|$)/.test(url.pathname)) {
      return originalFetch.call(window, input, options);
    }
    const started = performance.now();
    const method = (options?.method || request?.method || "GET").toUpperCase();
    const properties = { route_template: routeTemplate(url.pathname), method };
    try {
      const response = await originalFetch.call(window, input, options);
      const duration = performance.now() - started;
      track("api_latency_recorded", {
        ...properties, status_family: `${Math.floor(response.status / 100)}xx`, duration_ms: duration,
      });
      if (response.status >= 500) {
        track("api_request_failed", { ...properties, failure_kind: "server_5xx", duration_ms: duration });
      }
      const directEdit = url.pathname.match(/^\/inventory\/products\/(\d+)\/locations\/(\d+)\/stock$/);
      if (directEdit && method === "PATCH" && response.status === 403) {
        try {
          const body = typeof options?.body === "string" ? JSON.parse(options.body) : null;
          const quantity = body?.current_stock;
          const detail = (await response.clone().json()).detail;
          if (typeof quantity === "number" && Number.isFinite(quantity) && quantity >= 0 &&
              detail?.code === "forbidden_direct_update" &&
              detail.product_id === Number(directEdit[1]) &&
              detail.location_id === Number(directEdit[2]) &&
              ["CO", "US"].includes(detail.country) &&
              ["meat", "produce", "sauce", "beverage", "packaging", "cleaning"].includes(detail.product_category) &&
              ["kg", "litro", "unidad"].includes(detail.unit)) {
            track("direct_stock_edit_rejected", {
              product_id: detail.product_id, location_id: detail.location_id,
              country: detail.country, product_category: detail.product_category,
              unit: detail.unit, currency: detail.country === "CO" ? "COP" : "USD",
              quantity, attempted_operation: "direct_set", rejection_code: detail.code,
            });
          }
        } catch {
          // No registrar un intento cuyo payload o contexto no pueda validarse.
        }
      }
      return response;
    } catch (error) {
      track("api_request_failed", {
        ...properties,
        failure_kind: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network",
        duration_ms: performance.now() - started,
      });
      throw error;
    }
  };
  window.fetch = observedFetch;

  const captureError = () => track("frontend_error_captured", {
    error_fingerprint: "window_error", route_template: routeTemplate(window.location.pathname), severity: "error",
  });
  const captureRejection = () => track("frontend_error_captured", {
    error_fingerprint: "unhandled_rejection", route_template: routeTemplate(window.location.pathname), severity: "error",
  });
  window.addEventListener("error", captureError);
  window.addEventListener("unhandledrejection", captureRejection);

  return () => {
    if (window.fetch === observedFetch) window.fetch = originalFetch;
    window.removeEventListener("error", captureError);
    window.removeEventListener("unhandledrejection", captureRejection);
  };
}