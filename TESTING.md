# TESTING: Building Bullet-Proof Applications (AUTH-088)

## Objetivo y alcance

Verificar Brasaland reutilizando y ampliando las suites pytest existentes.
Base: `feature/error-handling-audit`.
Rama del hito: `feature/auth-088-bullet-proof-testing`.

Este hito cubre los requisitos obligatorios indicados: plan de pruebas,
autenticacion con pytest, casos felices, limite y fallo por endpoint, cobertura
minima del 70 % y ejecucion verificable. No incluye actividades extra, cambios
de frontend, funcionalidades nuevas, fusiones ni eliminacion de codigo previo.
El enunciado completo de la academia no esta incluido en este repositorio;
el alcance verificable es el solicitado para este hito.

## Estrategia

- Pruebas de integracion HTTP mediante FastAPI `TestClient`, usando rutas,
  validadores, JWT, hashing y persistencia reales.
- Pruebas focalizadas de configuracion de tokens y envio de recuperacion.
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
No se han creado suites paralelas ni reemplazado los escenarios anteriores.

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

## Criterios de aceptacion

1. Todas las pruebas existentes y nuevas pasan; sin fallos ni casos omitidos.
2. Cada endpoint de negocio tiene casos felices, limite y fallo en la matriz.
3. Autenticacion comprueba credenciales, permisos, tokens y cambios reales de clave.
4. Cobertura conjunta minima del 70 %, verificada con pytest-cov y su informe JSON.
5. No se filtran claves, tokens de recuperacion ni errores internos en respuestas.
6. No se afectan datos reales, se envian correos ni se realizan actividades extra.

## Regresion corregida

`PUT /users/{id}` admitia `{"email": null}` o `{"role": null}`, escribia
valores incompatibles con el modelo publico y terminaba devolviendo 500.
Una prueba parametrizada reprodujo ambos fallos. El modelo ahora rechaza
esos valores con 422 antes de escribir; `{}` sigue siendo una actualizacion
valida que conserva el usuario. Las pruebas verifican la integridad del registro.

## Resultados verificados

Base inicial: **67 pruebas pasadas**, cobertura conjunta **77.50 %**.

Verificacion final: **2026-10-29**, Linux, Python **3.12.15**, pytest **9.1.1**,
pytest-cov **7.1.0**. Comandos ejecutados:

```bash
uv sync --locked --group dev
uv run pytest
git diff --check
```

| Resultado                              | Valor                                              |
| -------------------------------------- | -------------------------------------------------- |
| Pruebas ejecutadas / pasadas           | **152 / 152**                                      |
| Fallos / errores / omitidas            | **0 / 0 / 0**                                      |
| Administracion y permisos              | **40 pasadas**                                     |
| Autenticacion                          | **30 pasadas**                                     |
| Incidencias                            | **29 pasadas**                                     |
| Proveedores                            | **53 pasadas**                                     |
| Duracion de la suite completa          | **41.39 s** (ultima verificacion antes del commit) |
| Lineas cubiertas                       | **720 / 781 (92.19 %)**                            |
| Ramas cubiertas                        | **128 / 156 (82.05 %)**                            |
| Cobertura conjunta                     | **90.50 %**, supera el minimo del **70 %**         |
| Autenticacion completa: lineas         | **300 / 310 (96.77 %)**                            |
| Autenticacion completa: ramas          | **45 / 46 (97.83 %)**                              |
| Autenticacion completa: conjunta       | **96.91 %**, supera el minimo del **70 %**         |
| Modulos de produccion medidos          | **21**                                             |
| Controladores de rutas                 | **100 % en cada archivo**                          |
| Seguridad y recuperacion de contrasena | **100 % en cada archivo**                          |

Los totales se comprobaron leyendo `coverage.json` con `JSON.parse`, verificando
el umbral y que no se incluyeran archivos de tests. El editor no reporta errores
en los archivos Python modificados ni en la configuracion del proyecto.

La cobertura de autenticacion completa agrega todos los archivos de
`services/api/auth/` (incluidos almacenamiento y bootstrap) y
`services/api/routes/auth.py`. No es la cobertura de ejecutar solo
`test_auth.py`: se calcula sobre la suite completa. Las rutas de autenticacion,
la seguridad JWT y la recuperacion de contrasena alcanzan individualmente el
100 % de lineas y ramas. El paquete `services/api/auth/` sin el controlador
alcanza el 96.17 % conjunto.

Advertencia no bloqueante: Starlette avisa de la futura retirada de su soporte
de `httpx` en `TestClient`. No hay fallos asociados; migrar a `httpx2` queda
fuera de este hito. La verificacion se ha realizado en Python 3.12, no en todas
las versiones admitidas por el proyecto.

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
