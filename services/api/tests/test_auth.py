from datetime import datetime, timedelta, timezone
import os
import secrets
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from resend.exceptions import ResendError

from services.api.main import app
from services.api.auth import storage
from services.api.auth import password_reset
from services.api.auth.security import create_access_token


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setenv("SUPPLIERS_DB_PATH", str(tmp_path / "suppliers.json"))
    monkeypatch.setenv("JWT_SECRET_KEY", secrets.token_urlsafe(48))
    monkeypatch.setenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")

    with TestClient(app) as c:
        yield c


def register(client, email):
    return client.post("/users", json={
        "email": email,
        "password": "ClaveSegura123!",
        "name": "Usuario Test",
    })


def login(client, email):
    response = client.post("/auth/login", data={
        "username": email,
        "password": "ClaveSegura123!",
    })
    assert response.status_code == 200
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def test_registration_and_profile(client):
    response = register(client, "ana@example.com")
    assert response.status_code == 201
    assert response.json()["role"] == "user"
    assert "hashed_password" not in response.json()
    assert "password" not in response.json()

    user = storage.get_user_by_email("ana@example.com")
    assert user["hashed_password"] != "ClaveSegura123!"

    headers = login(client, "ana@example.com")

    assert client.get("/auth/me", headers=headers).status_code == 200

    profile = client.get("/profiles/me", headers=headers)
    assert profile.status_code == 200
    assert profile.json()["name"] == "Usuario Test"

    updated = client.put("/profiles/me", headers=headers, json={
        "name": "Ana Actualizada"
    })
    assert updated.status_code == 200
    assert updated.json()["name"] == "Ana Actualizada"


def test_permissions(client):
    ana = register(client, "ana@example.com").json()
    bob = register(client, "bob@example.com").json()
    headers = login(client, "ana@example.com")

    assert client.get("/users", headers=headers).status_code == 403
    assert client.get(f"/users/{bob['id']}",
                      headers=headers).status_code == 403
    assert client.delete(
        f"/users/{bob['id']}", headers=headers).status_code == 403

    assert client.get(f"/users/{ana['id']}",
                      headers=headers).status_code == 200

    invalid_role = client.put(
        f"/users/{ana['id']}",
        headers=headers,
        json={"role": "superadmin"},
    )
    assert invalid_role.status_code == 422


def test_invalid_and_expired_tokens(client, monkeypatch):
    user = register(client, "ana@example.com").json()

    assert client.get("/profiles/me").status_code == 401
    assert client.get(
        "/profiles/me",
        headers={"Authorization": "Bearer invalid-token"},
    ).status_code == 401

    expired = jwt.encode(
        {
            "sub": str(user["id"]),
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        __import__("os").environ["JWT_SECRET_KEY"],
        algorithm="HS256",
    )

    assert client.get(
        "/profiles/me",
        headers={"Authorization": f"Bearer {expired}"},
    ).status_code == 401


def test_forgot_password_handles_resend_failure_without_leaking_details(
    client,
    caplog,
):
    register(client, "ana@example.com")
    resend_error = ResendError(
        code=503,
        error_type="ProviderError",
        message="SENSITIVE_PROVIDER_RESPONSE",
        suggested_action="Retry later",
    )

    with patch(
        "services.api.routes.auth.send_reset_email",
        side_effect=resend_error,
    ):
        response = client.post(
            "/auth/forgot-password",
            json={"email": "ana@example.com"},
        )

    assert response.status_code == 200
    assert "SENSITIVE_PROVIDER_RESPONSE" not in response.text
    assert "ProviderError" not in response.text
    assert "No se pudo entregar el correo de recuperacion" in caplog.text


def test_forgot_password_handles_missing_resend_configuration(client, caplog):
    register(client, "ana@example.com")

    with patch(
        "services.api.routes.auth.send_reset_email",
        side_effect=RuntimeError("RESEND_API_KEY no configurada"),
    ):
        response = client.post(
            "/auth/forgot-password",
            json={"email": "ana@example.com"},
        )

    assert response.status_code == 200
    assert "RESEND_API_KEY" not in response.text
    assert "No se pudo entregar el correo de recuperacion" in caplog.text


@pytest.mark.parametrize("password,status", [("1234567", 422), ("12345678", 201)])
def test_registration_password_boundary(client, password, status):
    response = client.post("/users", json={
        "email": "boundary@example.com", "password": password,
    })
    assert response.status_code == status
    assert password not in response.text
    assert "password" not in response.json()
    assert "hashed_password" not in response.json()


def test_duplicate_registration_is_case_insensitive(client):
    assert register(client, "ana@example.com").status_code == 201
    assert register(client, "ANA@example.com").status_code == 409
    assert len(storage.list_users()) == 1


@pytest.mark.parametrize("scenario", ["unknown", "wrong_password", "inactive"])
def test_login_rejects_bad_credentials(client, scenario):
    if scenario != "unknown":
        user = register(client, "ana@example.com").json()
        if scenario == "inactive":
            storage.update_user(user["id"], {"is_active": False})
    response = client.post("/auth/login", data={
        "username": "ana@example.com",
        "password": "incorrect" if scenario == "wrong_password" else "ClaveSegura123!",
    })
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert "access_token" not in response.json()


def test_login_normalizes_email_and_requires_form_fields(client):
    register(client, "ana@example.com")
    response = client.post("/auth/login", data={
        "username": " ANA@example.com ", "password": "ClaveSegura123!",
    })
    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    claims = jwt.decode(response.json()["access_token"],
                        os.environ["JWT_SECRET_KEY"], algorithms=["HS256"])
    assert claims["sub"].isdecimal()
    assert claims["exp"] > datetime.now(timezone.utc).timestamp()
    assert client.post("/auth/login", data={}).status_code == 422


@pytest.mark.parametrize("claims", [
    {}, {"sub": "1"}, {"sub": "abc", "exp": 4102444800},
    {"sub": 1, "exp": 4102444800}, {"sub": "99999", "exp": 4102444800},
])
def test_me_rejects_incomplete_or_unknown_subject(client, claims):
    token = jwt.encode(claims, os.environ["JWT_SECRET_KEY"], algorithm="HS256")
    response = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_me_rejects_wrong_signature_and_inactive_user(client):
    user = register(client, "ana@example.com").json()
    headers = login(client, "ana@example.com")
    forged = jwt.encode({"sub": str(user["id"]), "exp": 4102444800},
                        "different-secret", algorithm="HS256")
    assert client.get("/auth/me", headers={
        "Authorization": f"Bearer {forged}",
    }).status_code == 401
    storage.update_user(user["id"], {"is_active": False})
    assert client.get("/auth/me", headers=headers).status_code == 401


def test_me_without_profile(client):
    user = register(client, "ana@example.com").json()
    headers = login(client, "ana@example.com")
    with storage.open_db() as db:
        db.table("profiles").truncate()
    response = client.get("/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.json() == {
        "email": user["email"], "role": "user", "profile": None}


def test_forgot_password_is_private_and_creates_single_use_token(client):
    user = register(client, "ana@example.com").json()
    with patch("services.api.routes.auth.send_reset_email") as send_email:
        known = client.post("/auth/forgot-password",
                            json={"email": user["email"]})
        send_email.assert_called_once()
        recipient, token = send_email.call_args.args
        assert recipient == user["email"]
        assert token not in known.text
        with storage.open_db() as db:
            record = db.table("password_reset_tokens").all()[0]
            assert record["token_hash"] != token
            assert "token" not in record
        send_email.reset_mock()
        unknown = client.post("/auth/forgot-password",
                              json={"email": "unknown@example.com"})
        storage.update_user(user["id"], {"is_active": False})
        inactive = client.post("/auth/forgot-password",
                               json={"email": user["email"]})
        send_email.assert_not_called()
    assert known.status_code == unknown.status_code == inactive.status_code == 200
    assert known.json() == unknown.json() == inactive.json()
    assert client.post("/auth/forgot-password",
                       json={"email": "invalid"}).status_code == 422


def test_reset_password_changes_login_and_consumes_token(client):
    user = register(client, "ana@example.com").json()
    token = password_reset.create_reset_token(user["id"])
    payload = {"token": token, "new_password": "12345678"}
    assert client.post("/auth/reset-password", json=payload).status_code == 200
    assert client.post("/auth/reset-password", json=payload).status_code == 400
    assert client.post("/auth/login", data={
        "username": user["email"], "password": "ClaveSegura123!",
    }).status_code == 401
    assert client.post("/auth/login", data={
        "username": user["email"], "password": "12345678",
    }).status_code == 200


@pytest.mark.parametrize("scenario", ["empty", "unknown", "expired", "replaced", "deleted_user"])
def test_reset_password_rejects_invalid_tokens(client, monkeypatch, scenario):
    user = register(client, "ana@example.com").json()
    if scenario == "expired":
        monkeypatch.setattr(password_reset, "TOKEN_EXPIRY_MINUTES", 0)
    token = password_reset.create_reset_token(user["id"])
    if scenario == "empty":
        token = ""
    elif scenario == "unknown":
        token = "unknown-token"
    elif scenario == "replaced":
        password_reset.create_reset_token(user["id"])
    elif scenario == "deleted_user":
        storage.delete_user(user["id"])
    response = client.post("/auth/reset-password", json={
        "token": token, "new_password": "NuevaClave123!",
    })
    assert response.status_code == 400
    if token:
        assert token not in response.text
    if scenario != "deleted_user":
        login(client, user["email"])


def test_reset_password_short_password_does_not_consume_token(client):
    user = register(client, "ana@example.com").json()
    token = password_reset.create_reset_token(user["id"])
    assert client.post("/auth/reset-password", json={
        "token": token, "new_password": "1234567",
    }).status_code == 422
    assert client.post("/auth/reset-password", json={
        "token": token, "new_password": "12345678",
    }).status_code == 200


def test_change_password_validates_current_password_and_boundary(client):
    register(client, "ana@example.com")
    headers = login(client, "ana@example.com")
    for current, new, status in [
        ("wrong", "12345678", 400),
        ("ClaveSegura123!", "1234567", 422),
        ("ClaveSegura123!", "12345678", 200),
    ]:
        response = client.post("/auth/change-password", headers=headers, json={
            "current_password": current, "new_password": new,
        })
        assert response.status_code == status
    assert client.post("/auth/login", data={
        "username": "ana@example.com", "password": "ClaveSegura123!",
    }).status_code == 401
    assert client.post("/auth/login", data={
        "username": "ana@example.com", "password": "12345678",
    }).status_code == 200


def test_reset_email_configuration_and_delivery_are_mocked(client, monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="RESEND_API_KEY"):
        password_reset.send_reset_email("ana@example.com", "secret-token")
    monkeypatch.setenv("RESEND_API_KEY", "test-not-a-real-key")
    monkeypatch.setenv("FRONTEND_URL", "https://example.com/")
    monkeypatch.setenv("RESEND_FROM_EMAIL", "test@example.com")
    monkeypatch.setattr(password_reset.resend, "api_key", None)
    with patch.object(password_reset.resend.Emails, "send", return_value={"id": "test"}) as send:
        assert password_reset.send_reset_email(
            "ana@example.com", "a+b/c") == {"id": "test"}
    message = send.call_args.args[0]
    assert message["to"] == ["ana@example.com"]
    assert message["from"] == "test@example.com"
    assert "https://example.com/reset-password?token=a%2Bb%2Fc" in message["text"]


def test_token_configuration_fails_closed(client, monkeypatch):
    monkeypatch.setenv("ACCESS_TOKEN_EXPIRE_MINUTES", "0")
    with pytest.raises(ValueError, match="positiva"):
        create_access_token(1)
    monkeypatch.setenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
    monkeypatch.delenv("JWT_SECRET_KEY")
    with pytest.raises(RuntimeError, match="JWT_SECRET_KEY"):
        create_access_token(1)
