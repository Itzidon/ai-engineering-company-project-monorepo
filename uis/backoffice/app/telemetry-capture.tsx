"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { startTelemetryCapture } from "../lib/telemetry-capture";
import { routeTemplate, track } from "../lib/telemetry";

export default function TelemetryCapture() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => startTelemetryCapture(), []);

  useEffect(() => {
    if (previous.current === pathname) return;
    const started = previous.current === null ? 0 : performance.now();
    const navigationKind = previous.current === null ? "initial" : "client_transition";
    const frame = requestAnimationFrame(() => {
      track("page_load_recorded", {
        route_template: routeTemplate(pathname),
        load_ms: performance.now() - started,
        navigation_kind: navigationKind,
      });
      previous.current = pathname;
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}