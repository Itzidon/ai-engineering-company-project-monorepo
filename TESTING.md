# TESTING: Building Bullet-Proof Applications (AUTH-088)

## Objetivo y alcance

Verificar Brasaland reutilizando y ampliando las suites pytest existentes.
Base: `feature/error-handling-audit`.
Rama del hito: `feature/auth-088-bullet-proof-testing`.

Este hito cubre los requisitos obligatorios indicados: plan de pruebas,
autenticacion con pytest, casos felices, limite y fallo por endpoint, cobertura
minima del 70 % y ejecucion verificable. La revision incorpora Jest para las
utilidades TypeScript existentes y pruebas directas de negocio Python.
No incluye actividades extra, cambios funcionales de frontend, funcionalidades
nuevas, fusiones ni eliminacion de codigo previo.
El enunciado completo de la academia no esta incluido en este repositorio;
el alcance verificable es el solicitado para este hito.

## Estrategia

- Pruebas de integracion HTTP mediante FastAPI `TestClient`, usando rutas,
  validadores, JWT, hashing y persistencia reales.
- Pruebas focalizadas de configuracion de tokens y envio de recuperacion.
- 22 pruebas directas de negocio seleccionables con `-k business`: no crean
  `TestClient`, no envian HTTP ni sustituyen almacenamiento, hashing o JWT
  reales por mocks. Comparten solo el entorno temporal de autenticacion.
- Jest en Node para las nueve funciones exportadas por los clientes TypeScript
  existentes; `fetch`, almacenamiento del navegador y redireccion simulados.
  Se prueban resultados, entradas, filtros, sesion y errores, no componentes.
- Bases TinyDB temporales por prueba mediante `tmp_path` y `monkeypatch`.
  Nunca se necesita borrar ni reutilizar una base de desarrollo.
- Claves JWT aleatorias de prueba; no se requieren secretos reales.
- Resend simulado con `unittest.mock`: sin red ni correos reales.
- Caducidad de recuperacion determinista configurando el plazo a cero,
  sin esperas. JWT expirados mediante fechas pasadas.
- Comprobaciones de estado HTTP, cuerpo, cabeceras, persistencia, ausencia
  de mutaciones tras errores y ausencia de contrasenas o detalles internos.

## Matriz de endpoints

`S` significa `/suppliers` y `/api/suppliers`: se prueban ambos prefijos.
Los codigos reflejan el contrato actual: incidencias valida con 400; las
demas rutas usan 422. Las incidencias son publicas actualmente; este hito no
modifica esa politica. Las rutas de documentacion generadas por FastAPI no
son endpoints de negocio.

| Metodo y ruta                      | Caso feliz                                     | Caso limite                                                              | Caso de fallo                                                                                         |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `GET /`                            | 200, enlaces de servicios                      | Contrato exacto sin datos                                                | Metodo no admitido 405; ruta inexistente 404                                                          |
| `POST /users`                      | 201, perfil y hash, sin secretos               | Contrasena de 8 caracteres; correo normalizado                           | 7 caracteres o datos invalidos 422; duplicado 409; rol inyectado 422                                  |
| `POST /auth/login`                 | 200, JWT con sujeto y expiracion               | Normalizacion de correo                                                  | Clave incorrecta, usuario desconocido o inactivo 401; formulario incompleto 422                       |
| `GET /auth/me`                     | 200, identidad y perfil                        | Perfil ausente devuelve `null`                                           | Sin JWT, firma falsa, claims incompletos, usuario ausente o inactivo 401                              |
| `POST /auth/forgot-password`       | 200, genera token y solicita envio             | Usuario desconocido o inactivo: misma respuesta, sin envio               | Correo invalido 422; fallo/configuracion del proveedor no filtra informacion                          |
| `POST /auth/reset-password`        | 200; nueva clave funciona y anterior no        | 8 caracteres; token utilizable tras rechazar clave corta                 | Clave corta 422; token vacio, desconocido, expirado, reemplazado, reutilizado o usuario eliminado 400 |
| `POST /auth/change-password`       | 200, cambio efectivo de credenciales           | Clave nueva de 8 caracteres                                              | Clave actual incorrecta 400; clave corta 422; sin JWT 401                                             |
| `GET /users`                       | Admin obtiene lista 200 sin hashes             | Un solo admin registrado                                                 | Usuario normal 403; sin JWT 401                                                                       |
| `GET /users/{id}`                  | Propietario o admin obtiene usuario 200        | ID cero 404                                                              | Otro usuario 403; inexistente 404; ID no numerico 422; sin JWT 401                                    |
| `PUT /users/{id}`                  | Correo propio o rol por admin 200              | `{}` conserva registro; `null` explicito 422 sin mutar                   | Duplicado 409; cambio de rol/otro usuario 403; inexistente 404; datos invalidos 422; sin JWT 401      |
| `DELETE /users/{id}`               | 204, elimina perfil y rechaza JWT posterior    | ID cero 404; recurso ya eliminado 404                                    | Otro usuario 403; inexistente 404; ID invalido 422; sin JWT 401                                       |
| `GET /profiles/me`                 | 200, perfil propio                             | Campos opcionales nulos                                                  | Perfil ausente 404; sin JWT o JWT invalido/expirado 401                                               |
| `PUT /profiles/me`                 | 200, persiste nombre/telefono/direccion        | `{}` conserva perfil; nombre `null` permitido                            | Perfil ausente 404; campos adicionales 422; sin JWT 401                                               |
| `POST S`                           | 201, proveedor persistido                      | Nombre 200, notas 2000, tarifa positiva pequena, categorias deduplicadas | Duplicado 409; longitudes excedidas, tarifa cero, campos/filtros invalidos 422; sin JWT 401           |
| `GET S`                            | 200, filtros y datos de seed                   | Base vacia y filtro sin coincidencias: `[]`                              | Filtros invalidos 422; sin JWT 401                                                                    |
| `GET S/{id}`                       | 200, proveedor esperado                        | ID cero 404                                                              | Inexistente 404; ID no numerico 422; sin JWT 401                                                      |
| `PATCH S/{id}/rate`                | 200, tarifa persistida y timestamp actualizado | Tarifa 0.001 aceptada; cero rechazado sin mutar                          | Tarifa negativa/invalida 422; inexistente 404; ID invalido 422; sin JWT 401                           |
| `PATCH S/{id}/status`              | 200, activa/suspende sin cambiar timestamp     | Mismo estado conserva datos                                              | Estado invalido 422; inexistente 404; ID invalido 422; sin JWT 401                                    |
| `DELETE S/{id}`                    | 204, ya no se recupera                         | Segundo borrado 404; ID cero 404                                         | Inexistente 404; ID invalido 422; sin JWT 401                                                         |
| `POST /api/incidents`              | 201, datos y timestamps                        | Titulo/descripcion de un caracter; estado por defecto                    | Campos ausentes, vacios, blancos o enums invalidos 400; almacenamiento falla 500 seguro               |
| `GET /api/incidents`               | 200, combina filtros                           | Base vacia o filtro sin coincidencias: `[]`                              | Cada filtro invalido 400; error de almacenamiento 500 seguro                                          |
| `GET /api/incidents/summary`       | 200, recuentos correctos                       | Cero registros; un registro con recuentos exactos                        | Fallo interno 500 sin detalles sensibles                                                              |
| `GET /api/incidents/{id}`          | 200, coincide con registro creado              | ID cero 404                                                              | Inexistente 404; ID no numerico 400; fallo interno 500 seguro                                         |
| `PATCH /api/incidents/{id}/status` | 200, transiciones permitidas                   | Mismo estado rechazado; estado terminal no reabre                        | Transicion/datos invalidos 400; inexistente 404; fallo interno 500 seguro                             |

## Suites reutilizadas

| Archivo                                                   | Responsabilidad                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| [test_auth.py](services/api/tests/test_auth.py)           | Registro, login, JWT, recuperacion, cambio de clave y correo simulado |
| [test_admin.py](services/api/tests/test_admin.py)         | Administracion, autorizacion, usuarios, perfiles y acceso anonimo     |
| [test_suppliers.py](services/api/tests/test_suppliers.py) | CRUD, limites, ambos prefijos, persistencia y seed                    |
| [test_incidents.py](services/api/tests/test_incidents.py) | Incidencias, resumen, transiciones y respuestas seguras               |

Se conservan las pruebas anteriores de seed, bootstrap y errores seguros.
Las pruebas Python directas se anaden a la suite existente de autenticacion.
Las dos suites Jest nuevas no sustituyen pytest ni las pruebas Playwright;
`testMatch` impide que Jest intente ejecutar los escenarios Playwright.

- [suppliers-api.test.ts](uis/application/tests/suppliers-api.test.ts): cuatro
  funciones de proveedores, sesion y errores.
- [incidents-api.test.ts](uis/application/tests/incidents-api.test.ts): cinco
  funciones de incidencias, filtros y errores.

## Revision de criterios

| Criterio obligatorio revisado                           | Evidencia verificable                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Plan de pruebas completo                                | Estrategia, matrices, casos felices/limite/fallo y comandos de este documento                                                   |
| Autenticacion con pytest                                | 52 pruebas en `test_auth.py`, incluidas 22 directas de negocio                                                                  |
| Backend: logica de negocio, no solo HTTP                | Hash con sal, normalizacion, unicidad, rollback, emision/revocacion de JWT, permisos de bootstrap y recuperacion de un solo uso |
| Utilidades TypeScript con Jest                          | 50 pruebas para las nueve funciones existentes, con exito y fallo en cada funcion                                               |
| Cobertura minima del 70 %                               | Python global 90.82 %, autenticacion 97.75 %, negocio aislado 75.84 %; Jest 100 %                                               |
| Resultados ejecutados y comprobados                     | Informes JSON y comandos reproducibles, typecheck y lint correctos                                                              |
| Sin actividades extra ni cambios a proyectos anteriores | Misma rama del hito; sin cambios funcionales de aplicacion en esta revision ni fusiones                                         |

### Evidencia de negocio Python

Las funciones `test_business_*` invocan directamente los validadores,
`create_user`, `login`, `change_password`, `get_current_user`, almacenamiento,
hashing, recuperacion y `bootstrap_first_admin`. Comprueban:

- Registro normalizado, hash verificable y perfil asociado; entradas invalidas
  y duplicados no crean ni modifican registros.
- Fallo al insertar el perfil revierte la creacion del usuario.
- La misma clave genera hashes distintos con sal; una clave incorrecta no verifica.
- Login emite identidad y expiracion correctas sin mutar el usuario; credenciales
  incorrectas no emiten ningun token.
- Una identidad eliminada o inactiva invalida un JWT previamente valido.
- Recuperacion aceptada un microsegundo antes de caducar y rechazada exactamente
  al caducar o despues; la clave y la eliminacion del token reflejan el resultado.
- Los tokens se almacenan hasheados, se reemplazan por cuenta y solo funcionan
  una vez, sin afectar a otro usuario.
- Cambiar la clave exige la clave actual y cambia realmente el hash almacenado.
- El bootstrap promueve una sola cuenta existente y rechaza credenciales
  incorrectas o cuentas inactivas sin conceder permisos.

Las pruebas HTTP anteriores tambien verifican invariantes persistentes,
timestamps, filtros, transiciones, permisos y cambios efectivos de credenciales;
se conservan como integracion, no como sustituto de estas pruebas directas.

### Matriz de utilidades TypeScript

| Funcion existente      | Camino feliz / limite                                     | Fallo comprobado                                                  |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `fetchSuppliers`       | Lista con datos o vacia, sin cache y sin JWT opcional     | Red, sesion caducada, 400/422/404/409/403/500 y JSON invalido     |
| `createSupplier`       | Datos serializados sin mutar entrada; opcionales omitidos | Red y sesion caducada                                             |
| `updateRate`           | Tarifa 0.001 y ruta correctas                             | Red y sesion caducada                                             |
| `updateStatus`         | Estado y ruta correctos; respuesta vacia 204 no se parsea | Red y sesion caducada                                             |
| `fetchIncidents`       | Lista, filtros combinados, vacios u omitidos              | Red, 400 estructurado/texto/generico, 404/422/500 y JSON invalido |
| `fetchIncident`        | Identificador y datos correctos                           | Red y 500 con mensaje seguro                                      |
| `createIncident`       | Datos serializados sin mutar entrada                      | Red y 500 con mensaje seguro                                      |
| `updateIncidentStatus` | Nuevo estado serializado y ruta correctos                 | Red y 500 con mensaje seguro                                      |
| `fetchIncidentSummary` | Resumen correcto y sin cache                              | Red y 500 con mensaje seguro                                      |

En proveedores se comprueban cabecera JWT, eliminacion de sesion antes de
redirigir a login y ausencia de filtracion de detalles del servidor. En
incidencias se comprueba la propagacion del campo de validacion. Una respuesta
200 con JSON invalido en incidencias actualmente rechaza con `SyntaxError`;
la prueba documenta ese comportamiento existente sin cambiar la aplicacion.
No hay funciones ejecutables en los tipos compartidos; no se inventan
utilidades nuevas para justificar Jest.

## Ejecucion reproducible

Requisitos: Python 3.11+ y `uv`. Ejecutar desde la raiz del repositorio:

```bash
uv sync --locked --group dev
uv run pytest
```

La configuracion versionada en [pyproject.toml](pyproject.toml) aplica siempre
`--cov-fail-under=70`. Se mide `services.api` y `packages.shared`, incluidas
las ramas, y solo se excluyen los propios tests. No se omiten modulos de
produccion poco cubiertos para elevar artificialmente el porcentaje.
El umbral se aplica al total conjunto de lineas y ramas, no por archivo.

Los informes locales, excluidos de Git por ser generados, son:

- Terminal: porcentaje total y lineas pendientes por archivo.
- `htmlcov/index.html`: detalle navegable de lineas y ramas.
- `coverage.json`: resultados estructurados para comprobar los porcentajes.

Para trabajar en una sola suite sin aplicar el umbral global a un subconjunto:

```bash
uv run pytest services/api/tests/test_auth.py --no-cov -q
uv run pytest services/api/tests/test_admin.py --no-cov -q
uv run pytest services/api/tests/test_incidents.py services/api/tests/test_suppliers.py --no-cov -q
```

Estos comandos focalizados no sustituyen a la ejecucion final completa.

### Negocio sin HTTP

Desde la raiz, antes de la suite completa para dejar como informe principal
la medicion global de la ultima ejecucion:

```bash
uv run pytest services/api/tests/test_auth.py -k business -o addopts= \
  --cov=services.api.auth --cov=services.api.routes.auth \
  --cov-report=term-missing --cov-report=json:htmlcov/business-coverage.json \
  --cov-fail-under=70 -q
uv run pytest
```

`-o addopts=` permite medir solo autenticacion, sin aplicar a este subconjunto
el denominador del resto del backend. Mantiene cobertura de ramas y el umbral
conjunto del 70 %. Incluye todos los archivos de autenticacion, tambien bootstrap.

### Jest, TypeScript y lint

Requisito adicional: Node.js 22 y npm. Desde `uis/application`:

```bash
npm ci
npm run test:coverage
npx tsc --noEmit
npx eslint jest.config.mjs tests/suppliers-api.test.ts tests/incidents-api.test.ts
```

`npm test` ejecuta las mismas pruebas Jest sin informe de cobertura.
[jest.config.mjs](uis/application/jest.config.mjs) usa el transformador de Next.js,
sin servidor ni navegador, y exige el 70 % de lineas, ramas, funciones y
sentencias. Mide los dos modulos TypeScript con funciones existentes:
`app/suppliers/api.ts` y `app/incidents/api.ts`. No mide componentes ni representa
cobertura global de toda la interfaz. Informes locales ignorados por Git:
`uis/application/coverage/index.html` y
`uis/application/coverage/coverage-summary.json`.

## Criterios de aceptacion

1. Todas las pruebas existentes y nuevas pasan; sin fallos ni casos omitidos.
2. Cada endpoint de negocio tiene casos felices, limite y fallo en la matriz.
3. Autenticacion comprueba credenciales, permisos, tokens y cambios reales de clave.
4. Cobertura conjunta minima del 70 %, verificada con pytest-cov y su informe JSON.
5. No se filtran claves, tokens de recuperacion ni errores internos en respuestas.
6. No se afectan datos reales, se envian correos ni se realizan actividades extra.
7. Jest verifica caminos felices y fallos de todas las funciones TypeScript existentes.
8. Las pruebas directas de negocio verifican invariantes sin depender de HTTP.

## Regresion corregida

`PUT /users/{id}` admitia `{"email": null}` o `{"role": null}`, escribia
valores incompatibles con el modelo publico y terminaba devolviendo 500.
Una prueba parametrizada reprodujo ambos fallos. El modelo ahora rechaza
esos valores con 422 antes de escribir; `{}` sigue siendo una actualizacion
valida que conserva el usuario. Las pruebas verifican la integridad del registro.

## Resultados verificados

Base inicial: **67 pruebas pasadas**, cobertura conjunta **77.50 %**.
Revision anterior: **152 pytest**, cobertura global **90.50 %**.

Verificacion final: **2026-10-29**, Linux, Python **3.12.15**, pytest **9.1.1**,
pytest-cov **7.1.0**, Node **22.23.3** y Jest **30.5.2**. Comandos ejecutados:

```bash
uv sync --locked --group dev
uv run pytest
git diff --check
```

| Resultado                              | Valor                                                |
| -------------------------------------- | ---------------------------------------------------- |
| Pruebas pytest ejecutadas / pasadas    | **174 / 174**                                        |
| Fallos / errores / omitidas            | **0 / 0 / 0**                                        |
| Administracion y permisos              | **40 pasadas**                                       |
| Autenticacion                          | **52 pasadas**, incluidas **22 de negocio sin HTTP** |
| Incidencias                            | **29 pasadas**                                       |
| Proveedores                            | **53 pasadas**                                       |
| Duracion de la suite pytest completa   | **53.45 s** (ultima verificacion antes del commit)   |
| Lineas cubiertas                       | **723 / 781 (92.57 %)**                              |
| Ramas cubiertas                        | **128 / 156 (82.05 %)**                              |
| Cobertura conjunta                     | **90.82 %**, supera el minimo del **70 %**           |
| Autenticacion completa: lineas         | **303 / 310 (97.74 %)**                              |
| Autenticacion completa: ramas          | **45 / 46 (97.83 %)**                                |
| Autenticacion completa: conjunta       | **97.75 %**, supera el minimo del **70 %**           |
| Negocio sin HTTP: lineas               | **245 / 310 (79.03 %)**                              |
| Negocio sin HTTP: ramas                | **25 / 46 (54.35 %)**                                |
| Negocio sin HTTP: conjunta             | **75.84 %**, supera el minimo conjunto del **70 %**  |
| Pruebas Jest ejecutadas / pasadas      | **50 / 50**, dos suites, sin omitidas                |
| Jest proveedores / incidencias         | **22 / 28 pruebas pasadas**                          |
| Jest lineas / sentencias               | **67 / 67 (100 %) / 69 / 69 (100 %)**                |
| Jest funciones / ramas                 | **14 / 14 (100 %) / 36 / 36 (100 %)**                |
| TypeScript / ESLint de pruebas         | **Correctos**, codigo de salida 0                    |
| Modulos de produccion medidos          | **21**                                               |
| Controladores de rutas                 | **100 % en cada archivo**                            |
| Seguridad y recuperacion de contrasena | **100 % en cada archivo**                            |

Los totales se comprobaron leyendo `coverage.json`,
`htmlcov/business-coverage.json` y el resumen JSON de Jest con `JSON.parse`,
verificando los umbrales y que no se incluyeran archivos de tests. El editor
no reporta errores en los archivos de pruebas modificados.

La cobertura de autenticacion completa agrega todos los archivos de
`services/api/auth/` (incluidos almacenamiento y bootstrap) y
`services/api/routes/auth.py`. No es la cobertura de ejecutar solo
`test_auth.py`: se calcula sobre la suite completa. Las rutas de autenticacion,
la seguridad JWT y la recuperacion de contrasena alcanzan individualmente el
100 % de lineas y ramas. El paquete `services/api/auth/` sin el controlador
alcanza el 97.21 % conjunto. La cobertura aislada de negocio no se confunde
con la de toda la suite: su umbral es conjunto, no el 70 % por cada metrica;
la suite completa de autenticacion cubre el 97.83 % de ramas.

Advertencia no bloqueante: Starlette avisa de la futura retirada de su soporte
de `httpx` en `TestClient`. No hay fallos asociados; migrar a `httpx2` queda
fuera de este hito. La verificacion se ha realizado en Python 3.12, no en todas
las versiones admitidas por el proyecto.

Advertencias de dependencias: `npm ci` finaliza correctamente pero `npm audit`
informa de **6 vulnerabilidades (5 bajas y 1 critica)**. La critica corresponde
a Next.js **16.3.8**, version ya fijada antes de esta revision; las bajas afectan
a `deepmerge` y su cadena de dependencias de Jest. No se ha ejecutado
`npm audit fix --force` ni actualizado Next.js fuera del alcance de pruebas.
Tambien hay avisos de deprecacion de dependencias. Que las pruebas pasen no
significa que la auditoria de seguridad este limpia; queda pendiente la
actualizacion de Next.js en un cambio separado antes de desplegar.

Cobertura residual: el modulo compartido `incidents_analysis.py` alcanza el
37 % porque incluye analisis no expuestos por estos endpoints. Sigue incluido
en el calculo global; no se han realizado actividades extra para cubrirlo.

## Entrega

Rama exclusiva del hito: `feature/auth-088-bullet-proof-testing`.
Los resultados anteriores se verificaron antes del commit y de la subida.
No se fusionan ramas ni se modifican las ramas de proyectos anteriores.

[Proyecto para entregar en GitHub](https://github.com/Itzidon/ai-engineering-company-project-monorepo/tree/feature/auth-088-bullet-proof-testing).

La revision confirma los requisitos obligatorios indicados en la solicitud;
no sustituye la evaluacion de la academia contra su rubrica completa, que no
esta incluida en el repositorio. Los repositorios publicos de entregas de
AUTH-088 no se han tratado como una rubrica oficial.
