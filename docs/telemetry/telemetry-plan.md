# Brasaland — Plan de telemetría v1.0.0

**Tipo de entrega:** documento de diseño; no se instrumentan eventos ni se alteran datos reales en este hito.  **Fecha:** 2026-11-04.  **Propiedad:** equipo de ingeniería de Brasaland.  **Cobertura:** 14 locales en Colombia (`CO`) y Florida (`US`).

## 1. Alcance, fuentes y objetivos

El objetivo es responder preguntas accionables de compras, consumo, merma, abastecimiento, trazabilidad y salud del backoffice. El diseño enlaza `FastAPI` + autenticación TinyDB, inventario SQLModel/Supabase y cuatro vistas Next.js. **El éxito se mide por decisiones facilitadas**, no por número bruto de eventos.

**Fuente de requisitos:** briefing oficial [Brasaland — Telemetría](https://github.com/4GeeksAcademy/ai-engineering-syllabus/blob/main/content/contexts/06-telemetry-data-pipelines/telemetry/brasaland-BRIEFING.es.md) y [enunciado del proyecto](https://github.com/4GeeksAcademy/ai-engineering-syllabus/blob/main/content/projects/ai-eng-telemetry-plan/README.es.md). **Referencia técnica:** rama `feature/brasaland-inventory-backoffice` del fork de Brasaland, su API `/inventory` y frontend `uis/application`.

**Inventario actual vs. vocabulario de telemetría:** el backend llama `Ingredient` (equivale a `Product`), `IngredientEntry` (equivale a `InboundOrder`) y `IngredientExit` (equivale a `OutboundOrder`). Los nombres **obligatorios de `event_type` y `properties` son los del briefing de telemetría**, especialmente `product_id` — mapeado desde `Ingredient.id` —, `location_id` y `country`. No se inventan tablas SQL nuevas en este documento.

**Disponibilidad de datos:** las entradas/salidas y stock global están disponibles; el detalle de causa de merma, umbral mínimo por local, costo unitario, histórico de precios y catálogo estable de proveedores **no están implementados según el contrato actual consultado**. Esos eventos son obligatorios **en el diseño**, pero su emisión real depende de las extensiones indicadas. Nunca emitir valores simulados en producción.

## 2. Reglas e invariantes de dominio

1. `current_stock` nunca es editable ni una fuente de verdad independiente. Stock = SUM(entradas) − SUM(salidas); para alerta local, filtrar además por `location_id`.
2. Toda orden persistida tiene creador en TinyDB (`user_uuid`), local 1–14 y producto; los eventos usan `userId` pseudonimizado en el envelope, nunca nombres del personal en `properties`.
3. País `CO` ⇔ moneda `COP`; país `US` ⇔ moneda `USD`. La telemetría **no convierte** montos; la agregación internacional corresponde a reporting posterior.
4. `country` es el país del **local**, no el idioma español/inglés seleccionado en la interfaz.
5. La confirmación se emite después del commit de la transacción; errores/rechazos se emiten sin crear movimientos ni duplicar las métricas de éxito.
6. Una salida `consumption` produce `outbound_order_created`; una salida `waste` con subtipo conocido produce `stock_waste_registered`. No se emiten ambos eventos para un mismo movimiento.

## 3. Flujo extremo a extremo y puntos de instrumentación

```text
Login -> JWT válido -> inventario listado -> producto elegido
             |                  |
             |                  +-> stock visible / advertencia de mínimo
             +-> fallo login / sesión expirada
-> formulario entrada o salida -> validación cliente -> POST autenticado
     |                            |
     +-> formulario abandonado    +-> validación fallida (sin escritura)
-> validación backend, reglas de stock y permisos
     |
     +-> intento de editar current_stock directamente -> rechazo, sin escritura
     +-> stock insuficiente -> HTTP 400, sin escritura
-> commit SQLModel -> evento confirmado -> stock recalculado -> historial
                  |               |
                  +-> umbral mínimo por local (si se cruza)
                  +-> precio unitario anómalo (cuando exista costo)
```

**Puntos instrumentados propuestos (más de cinco):** `auth_login_succeeded`, `inventory_product_viewed`, `inbound_order_form_started`, `outbound_order_form_started`, `inbound_order_validation_failed`, `outbound_order_validation_failed`, `direct_stock_edit_rejected`, `outbound_order_submission_failed`, `inbound_order_created`, `outbound_order_created`, `stock_waste_registered`, `stock_threshold_triggered`, `inventory_workflow_abandoned`. Cada punto tiene un origen y un contrato de propiedades detallados más abajo.

## 4. Catálogo exhaustivo y clasificación

**Total:** 28 eventos = **6 obligatorios del briefing** + **22 oportunidades adicionales propuestas**. Categorías: `autenticación` (4), `errores` (2), `errores/flujo` (2), `errores/operación` (2), `navegación` (5), `negocio/compras` (2), `negocio/flujo` (2), `negocio/inventario` (5), `rendimiento` (3), `seguridad/inventario` (1).

| Grupo | `event_type` | Categoría | Punto de emisión | Stream/batch |
|---|---|---|---|---|
| **Obligatorio** | `inbound_order_created` | negocio/inventario | backend | **batch** |
| **Obligatorio** | `outbound_order_created` | negocio/inventario | backend | **batch** |
| **Obligatorio** | `stock_waste_registered` | negocio/inventario | backend | **stream** |
| **Obligatorio** | `stock_threshold_triggered` | negocio/inventario | backend | **stream** |
| **Obligatorio** | `direct_stock_edit_rejected` | seguridad/inventario | backend | **stream** |
| **Obligatorio** | `ingredient_price_variance_detected` | negocio/compras | backend | **stream** |
| Oportunidad | `inventory_product_viewed` | navegación | frontend | **batch** |
| Oportunidad | `inventory_filters_applied` | navegación | frontend | **batch** |
| Oportunidad | `inbound_order_form_started` | negocio/flujo | frontend | **batch** |
| Oportunidad | `inbound_order_validation_failed` | errores/flujo | frontend | **batch** |
| Oportunidad | `inbound_order_submission_failed` | errores/operación | frontend | **stream** |
| Oportunidad | `outbound_order_form_started` | negocio/flujo | frontend | **batch** |
| Oportunidad | `outbound_order_validation_failed` | errores/flujo | frontend | **batch** |
| Oportunidad | `outbound_order_submission_failed` | errores/operación | frontend | **stream** |
| Oportunidad | `inventory_order_history_viewed` | navegación | frontend | **batch** |
| Oportunidad | `inventory_workflow_abandoned` | navegación | frontend | **batch** |
| Oportunidad | `auth_login_succeeded` | autenticación | backend | **batch** |
| Oportunidad | `auth_login_failed` | autenticación | backend | **stream** |
| Oportunidad | `session_expired` | autenticación | backend | **batch** |
| Oportunidad | `auth_access_denied` | autenticación | backend | **stream** |
| Oportunidad | `api_latency_recorded` | rendimiento | backend | **batch** |
| Oportunidad | `page_load_recorded` | rendimiento | frontend | **batch** |
| Oportunidad | `database_query_slow_detected` | rendimiento | backend | **stream** |
| Oportunidad | `frontend_error_captured` | errores | frontend | **stream** |
| Oportunidad | `api_request_failed` | errores | frontend | **stream** |
| Oportunidad | `supplier_selection_changed` | negocio/compras | frontend | **batch** |
| Oportunidad | `inventory_country_switched` | navegación | frontend | **batch** |
| Oportunidad | `inventory_stock_warning_viewed` | negocio/inventario | frontend | **batch** |

### 4.1 Justificación, propiedades y privacidad por evento

La frase de decisión de **cada** ficha se lee literalmente: *«Capturamos [evento] porque necesitamos saber [hipótesis], lo que permite [decisión]»*. `Obligatorio` significa que está en el briefing; `Oportunidad` que es un añadido justificado. `R` significa requerido y `O` opcional. Todo campo que no figure en una tabla se rechaza al validar el JSON.

#### 1. `inbound_order_created` — OBLIGATORIO · negocio/inventario

**Descripción:** Entrega de mercancía confirmada.  **Origen y disparador:** Backend: después del commit de POST /inventory/orders/inbound.

**Hipótesis:** ¿Cuánto y qué compramos por local y proveedor?  **Decisión:** Consolidar compras y negociar condiciones con proveedores (Lucía).

**Entrega:** **batch**, porque El análisis de compras semanal no exige reacción en segundos.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `location_id` | integer | R | ID del local donde ocurrió el hecho; 1 a 14. |
| `country` | string · CO/US | R | País del local, independiente del idioma de la interfaz. |
| `product_id` | integer | R | ID SQL del ingrediente (Ingredient), llamado Product en el briefing. |
| `product_category` | string · meat/produce/sauce/beverage/packaging/cleaning | R | Categoría del ingrediente, equivalente a Ingredient.category. |
| `quantity` | number | R | Cantidad recibida; siempre positiva. |
| `unit` | string · kg/litro/unidad | R | Unidad de medida de Ingredient.unit. |
| `currency` | string · COP/USD | R | Moneda de origen del local: COP para CO y USD para US. |
| `inbound_order_id` | integer | R | ID persistido de IngredientEntry. |
| `supplier_key` | string | O | Identificador estable no personal del proveedor, derivado de catálogo. |
| `unit_cost` | number | O | Costo unitario en moneda local, cuando esté disponible. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** supplier_key requiere normalización de supplier_name; unit_cost aún no existe en IngredientEntry.

#### 2. `outbound_order_created` — OBLIGATORIO · negocio/inventario

**Descripción:** Consumo registrado, excluyendo mermas.  **Origen y disparador:** Backend: tras commit de POST /inventory/orders/outbound cuando reason=consumption.

**Hipótesis:** ¿Qué productos se consumen más por local y a qué ritmo?  **Decisión:** Ajustar sugerencias de reabastecimiento (Felipe).

**Entrega:** **batch**, porque El cálculo por día/local se actualiza por lotes, sin necesidad de alerta inmediata.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `location_id` | integer | R | ID del local donde ocurrió el hecho; 1 a 14. |
| `country` | string · CO/US | R | País del local, independiente del idioma de la interfaz. |
| `product_id` | integer | R | ID SQL del ingrediente (Ingredient), llamado Product en el briefing. |
| `product_category` | string · meat/produce/sauce/beverage/packaging/cleaning | R | Categoría del ingrediente, equivalente a Ingredient.category. |
| `quantity` | number | R | Cantidad realmente consumida. |
| `unit` | string · kg/litro/unidad | R | Unidad de medida de Ingredient.unit. |
| `currency` | string · COP/USD | R | Moneda de origen del local: COP para CO y USD para US. |
| `outbound_order_id` | integer | R | ID persistido de IngredientExit. |
| `reason` | string · consumption | R | Para consumo, valor fijo consumption. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Implementado: discriminar IngredientExit.reason=consumption.

#### 3. `stock_waste_registered` — OBLIGATORIO · negocio/inventario

**Descripción:** Merma de ingrediente confirmada con causa específica.  **Origen y disparador:** Backend: tras commit de IngredientExit con reason=waste y subtipo validado.

**Hipótesis:** ¿Cuánto se pierde por causa y local?  **Decisión:** Priorizar auditorías de merma (Felipe).

**Entrega:** **stream**, porque Los patrones anómalos de pérdida pueden requerir aviso operativo inmediato.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `location_id` | integer | R | ID del local donde ocurrió el hecho; 1 a 14. |
| `country` | string · CO/US | R | País del local, independiente del idioma de la interfaz. |
| `product_id` | integer | R | ID SQL del ingrediente (Ingredient), llamado Product en el briefing. |
| `product_category` | string · meat/produce/sauce/beverage/packaging/cleaning | R | Categoría del ingrediente, equivalente a Ingredient.category. |
| `quantity` | number | R | Cantidad mermada. |
| `unit` | string · kg/litro/unidad | R | Unidad de medida de Ingredient.unit. |
| `currency` | string · COP/USD | R | Moneda de origen del local: COP para CO y USD para US. |
| `outbound_order_id` | integer | R | ID de IngredientExit. |
| `reason` | string · expired/kitchen_error/theft_suspected | R | Causa concreta de merma. No emitir únicamente "waste". |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** PENDIENTE: el backend actual solo guarda reason=waste. Extender contrato con waste_cause validado antes de emitir. Nunca adivinar la causa.

#### 4. `stock_threshold_triggered` — OBLIGATORIO · negocio/inventario

**Descripción:** Cruce por primera vez bajo el mínimo del producto en un local.  **Origen y disparador:** Backend: después de salida; antes>=mínimo, después<mínimo, por product_id+location_id.

**Hipótesis:** ¿Con qué frecuencia hay faltantes críticos por local?  **Decisión:** Ajustar umbrales y frecuencia de abastecimiento.

**Entrega:** **stream**, porque El responsable debe actuar sobre un faltante en minutos.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `location_id` | integer | R | ID del local donde ocurrió el hecho; 1 a 14. |
| `country` | string · CO/US | R | País del local, independiente del idioma de la interfaz. |
| `product_id` | integer | R | ID SQL del ingrediente (Ingredient), llamado Product en el briefing. |
| `product_category` | string · meat/produce/sauce/beverage/packaging/cleaning | R | Categoría del ingrediente, equivalente a Ingredient.category. |
| `quantity` | number | R | Stock restante en el local, no delta del movimiento. |
| `unit` | string · kg/litro/unidad | R | Unidad de medida de Ingredient.unit. |
| `currency` | string · COP/USD | R | Moneda de origen del local: COP para CO y USD para US. |
| `threshold_quantity` | number | R | Mínimo configurado para ese producto y local. |
| `previous_stock` | number | R | Stock local inmediatamente anterior al movimiento. |
| `outbound_order_id` | integer | R | Orden que causó el cruce. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** PENDIENTE: tabla/configuración de umbrales por local y lectura de stock por local; el endpoint actual expone stock global.

#### 5. `direct_stock_edit_rejected` — OBLIGATORIO · seguridad/inventario

**Descripción:** Bloqueo explícito de intento de alterar stock fuera de orden.  **Origen y disparador:** Backend: regla de autorización/validación que rechaza escritura de current_stock, sin ejecutar UPDATE.

**Hipótesis:** ¿Se intenta eludir la trazabilidad y en qué locales?  **Decisión:** Reforzar capacitación o controles de acceso (Jake).

**Entrega:** **stream**, porque Una posible evasión del control debe investigarse inmediatamente.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `location_id` | integer | R | ID del local donde ocurrió el hecho; 1 a 14. |
| `country` | string · CO/US | R | País del local, independiente del idioma de la interfaz. |
| `product_id` | integer | R | ID SQL del ingrediente (Ingredient), llamado Product en el briefing. |
| `product_category` | string · meat/produce/sauce/beverage/packaging/cleaning | R | Categoría del ingrediente, equivalente a Ingredient.category. |
| `quantity` | number | R | Cantidad que intentaron establecer; no un movimiento persistido. |
| `unit` | string · kg/litro/unidad | R | Unidad de medida de Ingredient.unit. |
| `currency` | string · COP/USD | R | Moneda de origen del local: COP para CO y USD para US. |
| `attempted_operation` | string · direct_set/direct_increment/direct_decrement | R | Tipo de manipulación rechazada. |
| `rejection_code` | string · read_only_stock/forbidden_direct_update | R | Razón técnica no sensible. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** PENDIENTE: instrumentar el punto que rechaza explícitamente la modificación; un 404 genérico no constituye evidencia del intento.

#### 6. `ingredient_price_variance_detected` — OBLIGATORIO · negocio/compras

**Descripción:** Costo unitario excede umbral frente al histórico comparable.  **Origen y disparador:** Backend: al confirmar entrega con costo; comparar mismo product_id+supplier_key+currency.

**Hipótesis:** ¿Qué insumos presentan aumentos de precio anómalos?  **Decisión:** Alertar para renegociar o cambiar proveedor (Lucía/Mariana).

**Entrega:** **stream**, porque La decisión de compra debe corregirse antes de nuevas entregas.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `location_id` | integer | R | ID del local donde ocurrió el hecho; 1 a 14. |
| `country` | string · CO/US | R | País del local, independiente del idioma de la interfaz. |
| `product_id` | integer | R | ID SQL del ingrediente (Ingredient), llamado Product en el briefing. |
| `product_category` | string · meat/produce/sauce/beverage/packaging/cleaning | R | Categoría del ingrediente, equivalente a Ingredient.category. |
| `quantity` | number | R | Unidades compradas en la orden cuyo precio varía. |
| `unit` | string · kg/litro/unidad | R | Unidad de medida de Ingredient.unit. |
| `currency` | string · COP/USD | R | Moneda de origen del local: COP para CO y USD para US. |
| `inbound_order_id` | integer | R | Orden confirmada. |
| `supplier_key` | string | R | Identificador estable del proveedor. |
| `unit_cost` | number | R | Costo observado en moneda local. |
| `baseline_unit_cost` | number | R | Referencia histórica robusta en igual moneda/unidad. |
| `variance_pct` | number | R | Variación porcentual frente a baseline. |
| `threshold_pct` | number | R | Umbral aplicable, p.ej. 10. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** PENDIENTE: captura de costo unitario por entrega, catálogo de proveedores y baseline histórico; sin datos no se emite.

#### 7. `inventory_product_viewed` — OPORTUNIDAD · navegación

**Descripción:** Ficha del ingrediente visualizada.  **Origen y disparador:** Frontend: tras renderizar detalle/ficha de un ingrediente.

**Hipótesis:** ¿Qué insumos generan más consultas operativas?  **Decisión:** Priorizar información y atajos para los insumos consultados.

**Entrega:** **batch**, porque Patrones de navegación se analizan diariamente.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `product_id` | integer | R | Identificador del ingrediente. |
| `country` | string · CO/US | R | Mercado del ingrediente. |
| `entry_point` | string · catalog/history/deep_link | R | Origen de la navegación. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 8. `inventory_filters_applied` — OPORTUNIDAD · navegación

**Descripción:** Operador aplica filtros al inventario.  **Origen y disparador:** Frontend: después de aplicar filtro estable, no cada pulsación.

**Hipótesis:** ¿Qué filtros se necesitan más para encontrar insumos?  **Decisión:** Definir filtros por defecto y accesos rápidos.

**Entrega:** **batch**, porque Basta informe de uso semanal.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `filter_type` | string · country/category/stock_status | R | Dimensión filtrada. |
| `filter_value` | string | R | Valor normalizado del filtro, nunca texto libre. |
| `result_count` | integer | R | Número de ingredientes visibles. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 9. `inbound_order_form_started` — OPORTUNIDAD · negocio/flujo

**Descripción:** Formulario de recepción iniciado.  **Origen y disparador:** Frontend: primera interacción significativa del formulario.

**Hipótesis:** ¿Cuántas recepciones empezadas no llegan a registrarse?  **Decisión:** Reducir fricciones y campos innecesarios.

**Entrega:** **batch**, porque La conversión del flujo se revisa por día.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `form_route` | string · /backoffice/inventory/orders/inbound | R | Ruta fija de formulario. |
| `source` | string · inventory/history/deep_link | R | Desde dónde abrió el formulario. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 10. `inbound_order_validation_failed` — OPORTUNIDAD · errores/flujo

**Descripción:** Validación de formulario de entrada fallida.  **Origen y disparador:** Frontend: validación fallida al intentar enviar.

**Hipótesis:** ¿Qué campos impiden completar recepciones?  **Decisión:** Mejorar ayudas y validaciones visibles.

**Entrega:** **batch**, porque Las mejoras UX se priorizan semanalmente.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `field_key` | string · ingredient_id/quantity/supplier_name/location_id | R | Campo permitido con error. |
| `validation_code` | string · required/invalid_type/out_of_range/invalid_selection | R | Código del error; nunca el valor introducido. |
| `form_route` | string · /backoffice/inventory/orders/inbound | R | Ruta fija. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 11. `inbound_order_submission_failed` — OPORTUNIDAD · errores/operación

**Descripción:** Error servidor/red al guardar una entrega.  **Origen y disparador:** Frontend: API responde error o falla transporte.

**Hipótesis:** ¿Cuántas recepciones fallan por problemas de la API?  **Decisión:** Corregir endpoint o ofrecer reintentos guiados.

**Entrega:** **stream**, porque Las entregas bloqueadas requieren respuesta durante el turno.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `status_code` | integer | R | HTTP 4xx/5xx, 0 si fallo de red. |
| `error_code` | string | R | Código normalizado, sin mensaje bruto. |
| `retryable` | boolean | R | Si el error puede reintentarse con seguridad. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 12. `outbound_order_form_started` — OPORTUNIDAD · negocio/flujo

**Descripción:** Formulario de consumo/merma iniciado.  **Origen y disparador:** Frontend: primera interacción relevante de salida.

**Hipótesis:** ¿Qué proporción de salidas iniciadas se completa?  **Decisión:** Mejorar UX del registro operativo.

**Entrega:** **batch**, porque Se mide conversión por turno/día.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `form_route` | string · /backoffice/inventory/orders/outbound | R | Ruta fija. |
| `source` | string · inventory/history/deep_link | R | Origen de navegación. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 13. `outbound_order_validation_failed` — OPORTUNIDAD · errores/flujo

**Descripción:** Validación de salida fallida antes de enviar.  **Origen y disparador:** Frontend: error al pulsar Registrar salida.

**Hipótesis:** ¿Qué errores provocan más bloqueos al registrar consumos?  **Decisión:** Mejorar la instrucción de cantidades y stock disponible.

**Entrega:** **batch**, porque La priorización de mejoras es diaria/semanal.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `field_key` | string · ingredient_id/quantity/reason/location_id | R | Campo con error. |
| `validation_code` | string · required/invalid_type/out_of_range/insufficient_stock/invalid_selection | R | Código, sin valores ingresados. |
| `available_stock_bucket` | string · zero/low/medium/high | R | Rango de stock, no valor de usuario. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 14. `outbound_order_submission_failed` — OPORTUNIDAD · errores/operación

**Descripción:** API rechaza o falla una salida.  **Origen y disparador:** Frontend: error real de POST outbound, incluido HTTP 400.

**Hipótesis:** ¿Qué causas generan rechazos de salidas por local?  **Decisión:** Ajustar reglas, mensajes y capacitación.

**Entrega:** **stream**, porque Rechazos operativos impiden movimientos y deben verse de inmediato.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `status_code` | integer | R | Código HTTP o 0 sin conexión. |
| `error_code` | string | R | Motivo normalizado, ej. insufficient_stock. |
| `product_id` | integer | R | Ingrediente seleccionado. |
| `location_id` | integer | R | Local afectado. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 15. `inventory_order_history_viewed` — OPORTUNIDAD · navegación

**Descripción:** Historial de órdenes consultado.  **Origen y disparador:** Frontend: carga exitosa de historial de entradas y salidas.

**Hipótesis:** ¿Con qué frecuencia se auditan movimientos?  **Decisión:** Decidir filtros/exportaciones de auditoría.

**Entrega:** **batch**, porque La demanda de auditoría se evalúa por semana.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `result_count` | integer | R | Número de movimientos mostrados. |
| `entry_point` | string · inventory/deep_link | R | Punto de acceso. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 16. `inventory_workflow_abandoned` — OPORTUNIDAD · navegación

**Descripción:** Se abandona formulario con cambios no enviados.  **Origen y disparador:** Frontend: salida de ruta o cierre visible tras edición; no usar beforeunload como único mecanismo.

**Hipótesis:** ¿Qué parte del flujo provoca abandonos?  **Decisión:** Reducir pasos o evitar pérdida de trabajo.

**Entrega:** **batch**, porque El abandono es una métrica de mejora UX no urgente.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `form_kind` | string · inbound/outbound | R | Tipo de formulario. |
| `last_step` | string · ingredient/quantity/details/review | R | Paso alcanzado. |
| `elapsed_seconds` | number | R | Duración redondeada de sesión en formulario. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 17. `auth_login_succeeded` — OPORTUNIDAD · autenticación

**Descripción:** Login completado sin registrar credenciales.  **Origen y disparador:** Backend: token emitido correctamente.

**Hipótesis:** ¿Cuándo se concentra la actividad del personal?  **Decisión:** Ajustar atención y soporte durante cambios de turno.

**Entrega:** **batch**, porque Un resumen diario es suficiente.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `auth_method` | string · password | R | Tipo de autenticación. |
| `role_key` | string | O | Rol normalizado sin nombre ni email. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 18. `auth_login_failed` — OPORTUNIDAD · autenticación

**Descripción:** Inicio de sesión rechazado.  **Origen y disparador:** Backend: credenciales inválidas o bloqueo de cuenta.

**Hipótesis:** ¿Hay picos de fallos de acceso que interrumpen turnos?  **Decisión:** Investigar incidencias de login y endurecer rate limiting.

**Entrega:** **stream**, porque Ráfagas anómalas requieren respuesta rápida.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `failure_code` | string · invalid_credentials/account_unavailable/rate_limited/internal_error | R | Razón genérica sin revelar existencia de cuentas. |
| `attempt_bucket` | string · 1/2-5/6-10/>10 | R | Agrupación aproximada de intentos, sin IP. |

**PII/sanitización:** No incluir email, teléfono, password ni IP. userId=null cuando no hay usuario verificado.  **Condición/pre-requisito:** Disponible

#### 19. `session_expired` — OPORTUNIDAD · autenticación

**Descripción:** Sesión caducada o token expirado.  **Origen y disparador:** Frontend/backend: validación JWT expirado; una emisión por sesión.

**Hipótesis:** ¿Cuántas tareas se interrumpen por caducidad?  **Decisión:** Ajustar TTL y reautenticación segura.

**Entrega:** **batch**, porque No requiere intervención instantánea por caso.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `route_template` | string | R | Ruta de acceso normalizada, sin parámetros. |
| `session_age_bucket` | string · 0-15m/15-30m/30-60m/>60m | R | Intervalo de antigüedad. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 20. `auth_access_denied` — OPORTUNIDAD · autenticación

**Descripción:** Acceso a ruta protegida denegado.  **Origen y disparador:** Backend: respuesta 401/403 en ruta protegida; sin duplicar direct_stock_edit_rejected.

**Hipótesis:** ¿Qué áreas necesitan mejor formación o roles?  **Decisión:** Revisar permisos y UX de acceso.

**Entrega:** **stream**, porque Ráfagas de denegaciones pueden alertar de un abuso.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `route_template` | string | R | Ruta normalizada. |
| `status_code` | integer · 401/403 | R | HTTP autorizado 401 o 403. |
| `denial_code` | string · missing_token/invalid_token/expired_token/forbidden | R | Causa segura. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 21. `api_latency_recorded` — OPORTUNIDAD · rendimiento

**Descripción:** Medición agregable de latencia API.  **Origen y disparador:** Backend: middleware tras finalizar petición.

**Hipótesis:** ¿Qué endpoints empeoran el tiempo de respuesta?  **Decisión:** Priorizar índices, caché y capacidad de servidor.

**Entrega:** **batch**, porque Las tendencias p95 por ruta/día bastan para optimización.  **Dedupe/control de volumen:** Muestreo 10% de 2xx, 100% de 5xx; no cada milisegundo.

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `route_template` | string | R | Plantilla sin IDs concretos ni query string. |
| `method` | string · GET/POST/PUT/PATCH/DELETE | R | Método HTTP. |
| `status_family` | string · 2xx/3xx/4xx/5xx | R | Familia de respuesta. |
| `duration_ms` | number | R | Latencia de servidor en ms. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 22. `page_load_recorded` — OPORTUNIDAD · rendimiento

**Descripción:** Tiempo de carga de página en backoffice.  **Origen y disparador:** Frontend: medida de navegación tras página utilizable.

**Hipótesis:** ¿Qué pantallas ralentizan al personal?  **Decisión:** Optimizar pantalla y carga de datos.

**Entrega:** **batch**, porque Se optimiza mediante tendencias de rendimiento.  **Dedupe/control de volumen:** Muestreo 20% sesiones, máximo una observación por carga/route.

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `route_template` | string | R | Ruta permitida sin datos de usuario. |
| `load_ms` | number | R | Milisegundos hasta pantalla usable. |
| `navigation_kind` | string · initial/client_transition | R | Navegación inicial o interna. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 23. `database_query_slow_detected` — OPORTUNIDAD · rendimiento

**Descripción:** Consulta persistente excede umbral de latencia.  **Origen y disparador:** Backend: instrumentación SQL, solo consultas > 500 ms.

**Hipótesis:** ¿Qué operaciones de base de datos saturan el sistema?  **Decisión:** Optimizar consultas e índices.

**Entrega:** **stream**, porque Degradación severa merece diagnóstico rápido.  **Dedupe/control de volumen:** Emitir una muestra por fingerprint por 60 s con contador agregado.

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `query_fingerprint` | string | R | Huella o nombre de consulta sin parámetros ni SQL bruto. |
| `duration_ms` | number | R | Tiempo de ejecución ms. |
| `db_role` | string · inventory_sql/auth_tinydb | R | Clase de base de datos. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 24. `frontend_error_captured` — OPORTUNIDAD · errores

**Descripción:** Excepción no controlada del frontend.  **Origen y disparador:** Frontend: error boundary o unhandledrejection, sanitizado.

**Hipótesis:** ¿Qué fallos dejan sin servicio a los operadores?  **Decisión:** Priorizar correcciones de errores recurrentes.

**Entrega:** **stream**, porque Un error de ejecución puede bloquear operaciones activas.  **Dedupe/control de volumen:** Máximo 1 evento por fingerprint/sesión/minuto; contar duplicados localmente.

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `error_fingerprint` | string | R | Huella irreversible de tipo/módulo/stack saneado. |
| `route_template` | string | R | Ruta estable sin queries ni datos personales. |
| `severity` | string · warning/error/fatal | R | Gravedad de fallo. |

**PII/sanitización:** Jamás enviar stack completo, message sin filtrar, URL cruda, cookies o datos de formulario.  **Condición/pre-requisito:** Disponible

#### 25. `api_request_failed` — OPORTUNIDAD · errores

**Descripción:** Fallo HTTP inesperado en cliente.  **Origen y disparador:** Frontend: adaptador API detecta 5xx o desconexión; no duplique errores de formulario ya emitidos.

**Hipótesis:** ¿Cuáles son los flujos más afectados por disponibilidad de API?  **Decisión:** Priorizar resiliencia y degradación funcional.

**Entrega:** **stream**, porque Una caída repetida requiere actuación rápida.  **Dedupe/control de volumen:** Una emisión por requestId; no repetir por retry de UI sin nuevo requestId.

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `route_template` | string | R | Plantilla del endpoint. |
| `method` | string · GET/POST/PUT/PATCH/DELETE | R | HTTP verb. |
| `failure_kind` | string · server_5xx/network/timeout/bad_gateway | R | Tipo seguro. |
| `duration_ms` | number | R | Tiempo hasta error. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** Disponible

#### 26. `supplier_selection_changed` — OPORTUNIDAD · negocio/compras

**Descripción:** Elección de proveedor en una orden de entrada.  **Origen y disparador:** Frontend: cambio confirmado de proveedor en formulario de entrega.

**Hipótesis:** ¿Se concentra la elección de proveedores en pocos actores?  **Decisión:** Revisar dependencia de proveedores y mejorar selección.

**Entrega:** **batch**, porque Revisión de concentración por semana/mes.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `supplier_key` | string | R | ID normalizado de proveedor, no email de contacto. |
| `country` | string · CO/US | R | Mercado de operación. |
| `product_category` | string · meat/produce/sauce/beverage/packaging/cleaning | R | Categoría del ingrediente. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** PENDIENTE: el formulario actual usa supplier_name texto libre; normalizar a catálogo de proveedor y emitir solo tras selección de entidad validada.

#### 27. `inventory_country_switched` — OPORTUNIDAD · navegación

**Descripción:** Operador cambia mercado CO/US en inventario.  **Origen y disparador:** Frontend: aplicación efectiva de filtro de país.

**Hipótesis:** ¿Cuáles son los mercados más consultados por operaciones?  **Decisión:** Priorizar vistas y filtros regionales.

**Entrega:** **batch**, porque Tendencia semanal suficiente.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `selected_country` | string · CO/US | R | País elegido, no idioma UI. |
| `result_count` | integer | R | Número de productos filtrados. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** PENDIENTE: añadir filtro UI si todavía no está disponible.

#### 28. `inventory_stock_warning_viewed` — OPORTUNIDAD · negocio/inventario

**Descripción:** Operador visualiza alerta de stock bajo en el listado.  **Origen y disparador:** Frontend: tarjeta con alerta visible al usuario (IntersectionObserver), una vez por sesión/producto.

**Hipótesis:** ¿Se están viendo las alertas emitidas por el sistema?  **Decisión:** Mejorar visibilidad de avisos críticos.

**Entrega:** **batch**, porque La eficacia de visualización se evalúa por turno/día.  **Dedupe/control de volumen:** eventId; una emisión por transición confirmada

| Clave permitida en `properties` | Tipo | R/O | Semántica y regla |
|---|---|---|---|
| `product_id` | integer | R | Producto visible. |
| `location_id` | integer | R | Local del stock observado. |
| `warning_level` | string · low/critical | R | Severidad visual. |

**PII/sanitización:** No. Solo IDs operativos y categorías, sin nombres propios ni texto libre.  **Condición/pre-requisito:** PENDIENTE: el frontend actual visualiza stock global; para advertencia por local necesita consulta/configuración por local.

## 5. Event Envelope estándar (todos los eventos)

| Campo | Tipo | Obligatorio | Obtención y política |
|---|---|---|---|
| `eventId` | UUID v4 string | Sí | Generado una vez por hecho lógico; clave para deduplicación y reintentos. |
| `timestamp` | fecha ISO 8601 UTC string | Sí | Momento real de ocurrencia, p. ej. `2026-11-04T11:00:00Z`; conservar zona UTC. |
| `sessionId` | string o null | Sí | UUID aleatorio de sesión de cliente; null en operaciones sin sesión. No usar cookie/token. |
| `userId` | string o null | Sí | Identidad pseudónima derivada del UUID TinyDB mediante HMAC-SHA256 y secreto aislado; null cuando no hay identidad verificada. |
| `event_type` | string `entidad_acción` | Sí | Nombre constante exacto, sin interpolar valores; solo nombres enumerados en esquema. |
| `schemaVersion` | string | Sí | `1.0.0`; versionar de forma controlada. |
| `requestId` | UUID string | Sí | `X-Request-ID` del flujo frontend->backend->logs, generado si falta, sin datos personales. |
| `properties` | object | Sí | Únicamente claves allowlisted para ese evento; no permitir `additionalProperties`. |

**Ejemplo ilustrativo, no escritura real:**

```json
{
  "eventId": "31ac9bf3-39f0-4789-9424-b6cab09a6d74",
  "timestamp": "2026-11-04T11:00:00Z",
  "sessionId": null,
  "userId": "user_v1_K7Gfyj9nMd7GTlHI",
  "event_type": "inbound_order_created",
  "schemaVersion": "1.0.0",
  "requestId": "d210fc2e-604b-4bba-aa0f-94d705ee94b6",
  "properties": {
    "location_id": 1,
    "country": "CO",
    "product_id": 1,
    "product_category": "meat",
    "quantity": 50,
    "unit": "kg",
    "currency": "COP",
    "inbound_order_id": 101
  }
}
```

**Contrato JSON:** `event-schemas.json` usa JSON Schema draft-07, `oneOf` con 28 alternativas discriminadas por `event_type`, tipos/enum/requeridos precisos y `additionalProperties:false` tanto en envelope como en `properties`. Las seis alternativas de inventario obligatorias validan también la combinación país–moneda. Aceptar `null` solo para `userId`/`sessionId`, nunca para el resto.

## 6. Instrumentación futura por capas y semántica operacional

1. **Backoffice Next.js:** módulo único para telemetría; no enviar desde cada `fetch` de manera independiente. Generar `eventId`/`sessionId` y transportar `requestId`. Eventos de formularios solo ante acciones/errores concretos; no capturar cada tecla. Enviar por lote con `sendBeacon` al cambiar de ruta cuando proceda; deduplicar.
2. **API FastAPI:** middleware de correlación para `X-Request-ID`; hooks de éxito *después* de `commit` de SQLModel; hooks de rechazo antes de escribir. Para fallos de autenticación, no registrar credenciales ni emails.
3. **Persistencia:** cola/outbox o transporte durable para eventos de negocio (consistencia con transacción); idempotencia por `eventId`. Retención en destino restringido: brutos 30 días, agregados diarios/semanales 13 meses, sujeto a política legal. Un fallo de telemetría nunca revierte una orden legítima.
4. **Agregaciones futuras:** por `location_id`, `country`, producto/categoría, proveedor estable, semana ISO y moneda origen; cardinalidad limitada. No convertir COP/USD durante captura.
5. **Validación:** validar cada mensaje contra esquema antes de publicar; registrar rechazo de esquema solo con contador y código, no payload inválido. Un catálogo desconocido o `additionalProperties` causa descarte seguro.

### Mapeo de fuentes actuales y brechas

| Fuente de verdad | Datos existentes | Datos requeridos para el plan | Acción antes de instrumentar |
|---|---|---|---|
| `Ingredient` SQLModel | id/name/sku/unit/category/country | `product_id`, `product_category`, `unit` | Mapear campos sin cambiar dominio SQL. |
| `IngredientEntry` | id/ingredient_id/quantity/supplier_name/location_id/created_at/user_uuid | entradas, proveedor, precio unitario y moneda | Asociar `supplier_key`; añadir `unit_cost` con validación monetaria para precio. |
| `IngredientExit` | id/ingredient_id/quantity/reason=consumption\|waste/location_id/created_at/user_uuid | salidas, merma por causa | Añadir `waste_cause` con enum aprobado para registros `waste`; distinguir consumo y merma. |
| Cálculo stock | existe stock global, helper stock local | umbral por producto y local | Configurar umbrales `product_id+location_id`; calcular cruce de forma atómica. |
| Auth TinyDB / JWT | user UUID y sesión autenticada | `userId` pseudónimo y eventos auth | HMAC en servidor, secreto separado, no mover tokens al almacén de eventos. |
| UI Next.js | inventario, entradas, salidas, historial | flujos/filtros/errores/tiempo de carga | Instrumentar solo vistas/acciones existentes; eventos futuros se activan cuando sus flujos existan. |

### Reglas especiales para los seis eventos obligatorios

- `quantity` es el **volumen del movimiento** para entradas, consumo y merma; para `stock_threshold_triggered` es stock restante local; para `direct_stock_edit_rejected` es cantidad solicitada sin persistir; para `ingredient_price_variance_detected` es el volumen de compra comparable. La diferencia se documenta por evento para no sumar unidades incompatibles.
- Emitir `stock_threshold_triggered` solo al **cruzar** el umbral (`stock_before >= min` y `stock_after < min`); no reemitir en cada lectura ni cada salida si continúa bajo. Rearmar tras volver a estar >= mínimo. Usar lock/transacción/outbox para evitar carreras.
- `ingredient_price_variance_detected`: baseline sugerido = mediana de los últimos 30 días de entregas del mismo producto y proveedor, ≥3 observaciones y misma unidad/moneda; disparar si `abs(variación)` > 10%, o si se establece un umbral configurado. No calcular con histórico insuficiente. La política exacta del umbral queda parametrizada.
- `stock_waste_registered`: `reason` solo `expired`, `kitchen_error`, `theft_suspected`; no convertir silenciosamente el actual `reason="waste"` en una causa específica. Primero recoger causa en el formulario y backend.
- `direct_stock_edit_rejected`: emitir desde guardia de lectura-escritura tras identificar intención real de alterar campo `current_stock`, nunca por cualquier `404` ni a partir de logs con payload sin sanear.

## 7. Entrega stream/batch y gestión de volumen

La clasificación y justificación de **cada evento** se encuentran en la ficha 4.1. Arquitectura sugerida: **stream** = entrega asíncrona duradera cercana a tiempo real (objetivo p95 < 30 s, sin bloquear transacción); **batch** = flush cada 5 minutos y agregación diaria/semanal. Las decisiones críticas de stock/abuso y errores que bloquean operación van a stream; métricas de tendencias y mejoras UX a batch. Ajustar objetivos según SLO del equipo, no por gusto técnico.

**Throttle/debounce y costes:** `api_latency_recorded` muestreo 10% de respuestas 2xx, 100% de 5xx (sin duplicar alertas); `page_load_recorded` muestreo 20% de sesiones; `frontend_error_captured` y `database_query_slow_detected` agregación por huella/ventana de 60 s; `inventory_filters_applied` debounce 500 ms; `inventory_workflow_abandoned` una vez por formulario si existen cambios sin enviar; `inventory_product_viewed` máximo una vez por producto/sesión en ventana de 30 min. **Nunca aplicar sampling a eventos obligatorios de negocio ni a eventos críticos de seguridad**, salvo políticas de seguridad de colas fuera del productor.

**Volumen, reintentos y fallo:** clave de dedupe `eventId`; reintentos exponenciales con máximo 5 intentos; DLQ para fallos de serialización/esquema, sin persistir payload sensible; circuit breaker para proteger API; 1% audit samples para QA de clasificación; medidores de lag/backlog por transporte. Si falla la cola, conservar la operación del inventario y registrar métrica técnica agregada.

## 8. Privacidad, seguridad, riesgos y exclusiones

- **PII excluida:** nombres de empleados/clientes, emails, teléfonos, direcciones, IP, contraseñas, tokens JWT, cookies, headers `Authorization`, URLs con query, cuerpos de petición y errores sin limpiar. No capturar texto de formularios ni SQL completo. `userId` pseudonimizado y llave HMAC gestionada solo en backend, nunca en cliente.
- **Permisos:** roles de lectura por equipo; separar telemetría de TinyDB; secreto de hash con rotación y control de acceso. La tabla de eventos no da acceso a identidad personal. Proteger integridad de `requestId` recibido de clientes externos y sobrescribir valores inválidos.
- **Riesgo de precios:** solo comparar `unit_cost` de la misma moneda y unidad; de lo contrario señal falsa. No emitir `ingredient_price_variance_detected` sin costo persistido, proveedor estable y baseline suficiente.
- **Riesgo de stock:** un stock global de producto no es un stock por local; la alerta local se calcula sobre movimientos de ese `location_id`. Resolver concurrencia y dedupe en la capa transaccional, no en UI.
- **Exclusión: `keystroke_recorded`** — descartado: invasivo, alta cardinalidad y ninguna decisión operativa específica que justifique capturar caracteres.
- **Exclusión: `employee_location_tracked`** — descartado: ubicación personal innecesaria para inventario por local; bastan `location_id` y `country`.
- **Exclusión: `raw_request_payload_stored`** — descartado: podría filtrar tokens, datos de proveedor/personales y violar minimización de datos; usar enum/códigos.
- **Exclusión: `all_success_requests_logged` a 100%** — descartado: alto coste, duplicación y poco valor incremental; usar sampling de latencia y eventos de negocio fiables.
- **Exclusión: `ui_language_as_country`** — descartado por significado incorrecto del dato; capturar idioma por separado solo con caso de uso concreto.

## 9. QA y criterios de aceptación de la instrumentación futura

1. Tests de contrato: cada evento válido pasa `event-schemas.json`; propiedades no listadas, países/monedas cruzadas y motivos de merma desconocidos fallan.
2. Crear entrada o salida válida produce **exactamente un** evento tras commit; una salida HTTP 400 por stock insuficiente no produce `outbound_order_created`.
3. Intento de editar stock directo se rechaza sin escritura y emite evento de seguridad; la alerta de mínimo se emite solo al cruce y se rearma al reponer.
4. Simular pérdida de envío y reintento: se mantiene el mismo `eventId` y almacén deduplica. La caída de telemetría no impide la operación de inventario.
5. Asegurar `userId` pseudónimo y ausencia de email/IP/JWT/raw body en todas las categorías; verificar `sessionId=null` si no hay sesión.
6. Moneda y local: CO→COP, US→USD, local 1–14. Agregar por semana ISO sin mezclar monedas. Evitar correlaciones por nombre de cliente/proveedor.
7. Test de fixtures realistas en entorno de pruebas: 8–10 ingredientes, 3 locales (incluyendo CO y US), 15–20 entradas, 15–20 salidas y 3 mermas; producir 2 cruces de umbral y 1 variación de precio **solo cuando existan los datos necesarios**. No generar datos semilla en producción.

## 10. Checklist de handoff y entrega

- [x] Seis métricas obligatorias definidas exactamente como en el briefing de Brasaland.
- [x] 22 eventos adicionales fundamentados, más de 8 y de al menos 3 categorías.
- [x] Flujo de inventario y al menos cinco puntos de instrumentación identificados.
- [x] Envelope completo, allowlist por evento, esquema JSON draft-07 y protección de PII.
- [x] Justificación stream/batch, throttle/debounce, riesgos y exclusiones.
- [ ] Implementación futura de datos faltantes e instrumentación real (fuera del alcance de este hito de diseño).
- [ ] Abrir PR contra `main` de **tu fork**, título exacto `docs: telemetry design plan`.

**Descripción sugerida del PR:** Diseño de 28 eventos (**6 obligatorios + 22 propuestos**). Categorías: autenticación, errores, errores/flujo, errores/operación, navegación, negocio/compras, negocio/flujo, negocio/inventario, rendimiento, seguridad/inventario. Decisión más difícil: separar los eventos de merma/umbral/precio del inventario actual, porque faltan campos en el backend; se especifican dependencias de implementación en lugar de inventar datos.
