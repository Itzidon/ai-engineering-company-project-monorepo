import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.requests import Request

from services.api import database
from services.api.auth.security import get_current_user
from services.api.routes.auth import router as auth_router
from services.api.routes.users import router as users_router
from services.api.routes.profiles import router as profiles_router
from services.api.routes.suppliers import router as suppliers_router
from services.api.routes.incidents import router as incidents_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    database.close_db()


app = FastAPI(
    title="Brasaland API - Gestor de Incidencias",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def handle_request_validation_error(
    request: Request,
    exc: RequestValidationError,
):
    errors = []
    for error in exc.errors():
        location = error.get("loc", ())
        errors.append({
            "loc": list(location),
            "msg": "El valor enviado no es válido.",
            "type": "value_error",
        })

    return JSONResponse(
        status_code=422,
        content={"detail": errors},
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(
    request: Request,
    exc: Exception,
):
    logger.error("Unhandled API exception (%s)", type(exc).__name__)
    return JSONResponse(
        status_code=500,
        content={
            "detail": {
                "code": "internal_error",
                "message": "Se produjo un error interno.",
            }
        },
    )


# Autenticacion y usuarios
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(profiles_router)


# Proveedores protegidos con JWT
app.include_router(
    suppliers_router,
    prefix="/suppliers",
    dependencies=[Depends(get_current_user)],
)


# Rutas compatibles con el frontend
app.include_router(
    suppliers_router,
    prefix="/api/suppliers",
    dependencies=[Depends(get_current_user)],
    include_in_schema=False,
)


# Gestor de incidencias de Brasaland
app.include_router(
    incidents_router,
    prefix="/api/incidents",
)


@app.get("/")
def root():
    return {
        "message": "Brasaland API",
        "suppliers": "/suppliers",
        "incidents": "/api/incidents",
        "docs": "/docs",
    }
