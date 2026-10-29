import secrets

import pytest
from fastapi.testclient import TestClient

from services.api.main import app
from services.api.auth import storage
from services.api.auth import bootstrap_admin
from services.api.auth.bootstrap_admin import bootstrap_first_admin
from services.api.auth.security import create_access_token


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setenv("SUPPLIERS_DB_PATH", str(tmp_path / "suppliers.json"))
    monkeypatch.setenv("JWT_SECRET_KEY", secrets.token_urlsafe(48))

    with TestClient(app) as c:
        yield c


def test_first_admin(client):
    response = client.post("/users", json={
        "email": "admin@example.com",
        "password": "ClaveAdmin123!",
        "name": "Administrador",
    })
    assert response.status_code == 201

    with pytest.raises(ValueError):
        bootstrap_first_admin("admin@example.com", "incorrecta")

    admin = bootstrap_first_admin(
        "admin@example.com",
        "ClaveAdmin123!",
    )
    assert admin["role"] == "admin"

    login = client.post("/auth/login", data={
        "username": "admin@example.com",
        "password": "ClaveAdmin123!",
    })
    assert login.status_code == 200

    headers = {
        "Authorization": "Bearer " + login.json()["access_token"]
    }

    assert client.get("/users", headers=headers).status_code == 200

    with pytest.raises(ValueError):
        bootstrap_first_admin(
            "admin@example.com",
            "ClaveAdmin123!",
        )


def test_bootstrap_cli_returns_nonzero_without_echoing_credentials(
    monkeypatch,
    capsys,
):
    monkeypatch.setattr("builtins.input", lambda _prompt: "admin@example.com")
    monkeypatch.setattr(bootstrap_admin, "getpass",
                        lambda _prompt: "secret-password")
    monkeypatch.setattr(
        bootstrap_admin,
        "bootstrap_first_admin",
        lambda _email, _password: (_ for _ in ()).throw(
            ValueError("invalid credentials")
        ),
    )

    assert bootstrap_admin.main() == 1
    captured = capsys.readouterr()
    assert "ERROR:" in captured.err
    assert "secret-password" not in captured.out + captured.err
    assert "admin@example.com" not in captured.out + captured.err


def test_bootstrap_cli_handles_missing_storage_safely(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda _prompt: "admin@example.com")
    monkeypatch.setattr(bootstrap_admin, "getpass",
                        lambda _prompt: "secret-password")
    monkeypatch.setattr(
        bootstrap_admin,
        "bootstrap_first_admin",
        lambda _email, _password: (_ for _ in ()).throw(
            OSError("/private/path/auth.json")
        ),
    )

    assert bootstrap_admin.main() == 1
    captured = capsys.readouterr()
    assert "storage" not in captured.err.lower(
    ) or "almacenamiento" in captured.err.lower()
    assert "/private/path" not in captured.out + captured.err


def test_user_cannot_become_admin(client):
    response = client.post("/users", json={
        "email": "normal@example.com",
        "password": "ClaveNormal123!",
        "role": "admin",
    })
    assert response.status_code == 422

    response = client.post("/users", json={
        "email": "normal@example.com",
        "password": "ClaveNormal123!",
    })
    assert response.status_code == 201

    user_id = response.json()["id"]

    login = client.post("/auth/login", data={
        "username": "normal@example.com",
        "password": "ClaveNormal123!",
    })

    headers = {
        "Authorization": "Bearer " + login.json()["access_token"]
    }

    response = client.put(
        f"/users/{user_id}",
        json={"role": "admin"},
        headers=headers,
    )
    assert response.status_code == 403

    assert storage.get_user_by_id(user_id)["role"] == "user"


@pytest.fixture
def admin_headers(client):
    response = client.post("/users", json={
        "email": "admin@example.com", "password": "ClaveAdmin123!",
    })
    assert response.status_code == 201
    admin = bootstrap_first_admin("admin@example.com", "ClaveAdmin123!")
    return {"Authorization": f"Bearer {create_access_token(admin['id'])}"}


def test_admin_user_lifecycle(client, admin_headers):
    created = client.post("/users", json={
        "email": "user@example.com", "password": "ClaveUser123!",
    })
    assert created.status_code == 201
    user_id = created.json()["id"]
    url = f"/users/{user_id}"
    response = client.get(url, headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["email"] == "user@example.com"
    updated = client.put(url, headers=admin_headers, json={
        "email": "updated@example.com", "role": "manager",
    })
    assert updated.status_code == 200
    assert updated.json()["role"] == "manager"
    assert updated.json()["email"] == "updated@example.com"
    listed = client.get("/users", headers=admin_headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 2
    assert "hashed_password" not in listed.text
    token = create_access_token(user_id)
    assert client.delete(url, headers=admin_headers).status_code == 204
    assert storage.get_profile_by_user_id(user_id) is None
    assert client.get(url, headers=admin_headers).status_code == 404
    assert client.get("/auth/me", headers={
        "Authorization": f"Bearer {token}",
    }).status_code == 401


@pytest.mark.parametrize("method", ["get", "put", "delete"])
@pytest.mark.parametrize("identifier,status", [("999999", 404), ("abc", 422), ("0", 404)])
def test_admin_missing_or_invalid_user(client, admin_headers, method, identifier, status):
    kwargs = {"json": {}} if method == "put" else {}
    response = client.request(
        method, f"/users/{identifier}", headers=admin_headers, **kwargs)
    assert response.status_code == status


def test_update_user_duplicate_email_and_empty_update(client, admin_headers):
    user = client.post("/users", json={
        "email": "user@example.com", "password": "ClaveUser123!",
    }).json()
    url = f"/users/{user['id']}"
    assert client.put(url, headers=admin_headers, json={}).json() == user
    duplicate = client.put(url, headers=admin_headers, json={
                           "email": "ADMIN@example.com"})
    assert duplicate.status_code == 409
    assert client.get(url, headers=admin_headers).json() == user


@pytest.mark.parametrize("field", ["email", "role"])
def test_user_update_rejects_explicit_null_without_mutation(client, admin_headers, field):
    user = storage.get_user_by_email("admin@example.com")
    with TestClient(app, raise_server_exceptions=False) as test_client:
        response = test_client.put(f"/users/{user['id']}",
                                   headers=admin_headers, json={field: None})
    assert response.status_code == 422
    assert storage.get_user_by_id(user["id"]) == user


def test_self_service_update_and_delete(client):
    user = client.post("/users", json={
        "email": "user@example.com", "password": "ClaveUser123!",
    }).json()
    headers = {"Authorization": f"Bearer {create_access_token(user['id'])}"}
    response = client.put(f"/users/{user['id']}", headers=headers,
                          json={"email": "new@example.com"})
    assert response.status_code == 200
    assert response.json()["email"] == "new@example.com"
    assert client.delete(
        f"/users/{user['id']}", headers=headers).status_code == 204
    assert client.get("/auth/me", headers=headers).status_code == 401


def test_user_cannot_update_another_user(client):
    users = [client.post("/users", json={
        "email": email, "password": "ClaveUser123!",
    }).json() for email in ("ana@example.com", "bob@example.com")]
    headers = {
        "Authorization": f"Bearer {create_access_token(users[0]['id'])}"}
    response = client.put(f"/users/{users[1]['id']}", headers=headers,
                          json={"email": "changed@example.com"})
    assert response.status_code == 403
    assert storage.get_user_by_id(users[1]["id"])["email"] == "bob@example.com"


def test_profile_empty_update_nullable_fields_and_missing_profile(client):
    user = client.post("/users", json={
        "email": "user@example.com", "password": "ClaveUser123!", "name": "Ana",
    }).json()
    headers = {"Authorization": f"Bearer {create_access_token(user['id'])}"}
    original = client.get("/profiles/me", headers=headers)
    assert original.status_code == 200
    unchanged = client.put("/profiles/me", headers=headers, json={})
    assert unchanged.status_code == 200
    assert unchanged.json() == original.json()
    updated = client.put("/profiles/me", headers=headers, json={
        "name": None, "phone": "123456", "address": "Calle 1",
    })
    assert updated.status_code == 200
    assert updated.json()["name"] is None
    assert updated.json()["phone"] == "123456"
    assert updated.json()["address"] == "Calle 1"
    assert client.get("/profiles/me", headers=headers).json() == updated.json()
    assert client.put("/profiles/me", headers=headers,
                      json={"role": "admin"}).status_code == 422
    with storage.open_db() as db:
        db.table("profiles").truncate()
    assert client.get("/profiles/me", headers=headers).status_code == 404
    assert client.put("/profiles/me", headers=headers,
                      json={"name": "Ana"}).status_code == 404


@pytest.mark.parametrize("method,path", [
    ("GET", "/auth/me"), ("POST", "/auth/change-password"),
    ("GET", "/users"), ("GET", "/users/1"),
    ("PUT", "/users/1"), ("DELETE", "/users/1"),
    ("GET", "/profiles/me"), ("PUT", "/profiles/me"),
] + [
    (method, prefix + suffix)
    for prefix in ("/suppliers", "/api/suppliers")
    for method, suffix in [
        ("POST", ""), ("GET", ""), ("GET", "/1"),
        ("PATCH", "/1/rate"), ("PATCH", "/1/status"), ("DELETE", "/1"),
    ]
])
def test_all_protected_endpoints_reject_anonymous_requests(client, method, path):
    response = client.request(method, path, json={})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
