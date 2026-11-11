# Evidencia de implementación: captura de telemetría

Rama de trabajo: `feature/brasaland-telemetry-capture`
Título propuesto del PR: `feat: telemetry event capture`

## Alcance

Se implementó captura frontend para los seis eventos de inventario y los eventos transversales instrumentados. El esquema compartido contiene el catálogo de 28 tipos; esto no implica que todos estén instrumentados. La allowlist del cliente y el esquema JSON formal filtran tipos, propiedades, tipos de valores y combinaciones país/moneda. El endpoint `POST /telemetry/events` valida UUID, fecha, versión, propiedades y lotes de 1 a 20 eventos; responde `{ "received": n }` con HTTP 200 para lotes válidos y 422 para inválidos.

La cola envía como máximo 20 eventos tras 10 segundos o al alcanzar el lote máximo; en descargas intenta `sendBeacon`, y si no se acepta mantiene el lote para `fetch` con `keepalive`. Se reintentan errores de red, timeout, 429 y 5xx con backoff limitado. Los lotes no se descartan tras agotarse los reintentos. Los eventos rechazados permanentemente por 4xx distintos de 429 se descartan.

La instrumentación transversal captura navegación, latencia y errores de API, errores no controlados y rechazos de promesas. Normaliza rutas conocidas y descarta rutas no reconocidas; no transmite query strings, mensajes de error, tokens ni propiedades no declaradas. `userId` es `null`: no se implementa una pseudonimización HMAC segura.

## Seis eventos de inventario

| Evento                               | Fuente y condición                                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inbound_order_created`              | Entrega confirmada por el endpoint de inventario.                                                                                                                       |
| `outbound_order_created`             | Salida confirmada con motivo `consumption`.                                                                                                                             |
| `stock_waste_registered`             | Salida confirmada con motivo `waste` y causa seleccionada.                                                                                                              |
| `stock_threshold_triggered`          | Cruce real de stock local desde el mínimo o más hasta debajo del mínimo configurado. Usa stock restante confirmado.                                                     |
| `direct_stock_edit_rejected`         | El interceptor ve un `PATCH` de stock con HTTP 403 y valida ruta, respuesta del backend, contexto del producto y cantidad enviada. Otros errores no emiten este evento. |
| `ingredient_price_variance_detected` | Entrega con costo confirmado y variación absoluta superior al 10 % frente al registro anterior comparable del mismo ingrediente, proveedor normalizado y moneda.        |

La lista existente `stock-minimums.json` solo activa alertas para los pares local/producto configurados; no se generan mínimos por defecto. Los registros de precio se incorporan al realizar entradas con un costo real. Las pruebas usan precios, productos y movimientos de SQLite en memoria.

No hay una pantalla de edición directa de stock en el inventario. El evento solo se emite si una acción real de la aplicación intenta hacer el `PATCH` prohibido y el servidor lo rechaza con HTTP 403. No se crean intentos ni eventos artificiales en producción.

## Privacidad y datos

No se incluyen contraseñas, emails, nombres, motivos de error libres ni JWT. Los datos personales operativos requeridos para crear una orden (por ejemplo, el proveedor) no se copian al evento. `supplier_key` se acepta solo con formato hexadecimal SHA-256 de 64 caracteres. El identificador de sesión es aleatorio. `userId` se envía como `null` hasta disponer de una clave HMAC gestionada correctamente.

## Evidencia local

Las pruebas de integración de backend usan SQLite en memoria y sobrescriben las dependencias de autenticación y base de datos. No escriben ni migran datos reales. La comprobación HTTP en ejecución usa una API local con `DATABASE_URL` vacío y datos de inventario simulados mediante pruebas; los seis eventos obligatorios reciben HTTP 200 a través del proxy del frontend.

Comandos desde la raíz:

```bash
DATABASE_URL='' uv run pytest -q
npm --prefix uis/application run test:coverage
cd uis/application && npx tsc --noEmit
cd uis/application && npx eslint lib/telemetry.ts lib/telemetry-capture.ts lib/inventory.ts app/telemetry-capture.tsx app/layout.tsx app/backoffice/inventory/orders/inbound/page.tsx app/backoffice/inventory/orders/outbound/page.tsx tests/telemetry.test.ts tests/inventory-telemetry.test.ts tests/telemetry.spec.ts next.config.ts jest.config.mjs
cd uis/application && npm run build
```

Estado observado durante la implementación: pytest completo, 193 pruebas aprobadas y 91,09 % de cobertura Python; Jest completo, 74 pruebas aprobadas y cobertura por encima del umbral del 70 % para los módulos frontend instrumentados; TypeScript, lint focalizado y compilación Next de producción aprobados. Se recibió HTTP 200 para cada uno de los seis tipos obligatorios.

La prueba Playwright de escritorio/móvil está preparada en `uis/application/tests/telemetry.spec.ts`. No pudo ejecutarse en este contenedor: Chromium requiere bibliotecas del sistema, incluida `libglib-2.0.so.0`, que no está instalada. No se presenta como evidencia aprobada.

## Pendiente antes del PR

- Ejecutar `uis/application/tests/telemetry.spec.ts` en un entorno con dependencias de Chromium instaladas.
- Revisar y actualizar Next.js: `npm audit --omit=dev` reporta una vulnerabilidad crítica en Next.js 16.3.8 y propone 16.4.6. No se aplicó una actualización de dependencias dentro de este alcance.
- La telemetría usa envío de mejor esfuerzo en el navegador; no se implementaron almacenamiento ni reporting, que quedan fuera del proyecto solicitado.
- Revisar `git status` y añadir selectivamente los archivos del hito. No incluir archivos `.env`, `*.zip` ni informes generados. No se hizo commit, push ni se creó PR.
