import secrets

import pytest
from fastapi.testclient import TestClient

from services.api.main import app
from services.api.auth import storage
from services.api.auth import bootstrap_admin
from services.api.auth.bootstrap_admin import bootstrap_first_admin


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
