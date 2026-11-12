import type { Metadata } from "next";
import "./globals.css";
import TelemetryCapture from "./telemetry-capture";

export const metadata: Metadata = {
  title: "Brasaland · Directorio de Proveedores",
  description: "Fuente única de verdad de los proveedores de Brasaland",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body><TelemetryCapture />{children}</body>
    </html>
  );
}
