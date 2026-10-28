
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Profile = {
  name: string | null;
  phone: string | null;
  address: string | null;
};

type CurrentUser = {
  email: string;
  profile: Profile | null;
};

export default function ProfilePage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [profileRetry, setProfileRetry] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function logout() {
    localStorage.removeItem("brasaland_token");
    router.replace("/login");
  }

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setLoading(true);
      setLoadError("");

      try {
        const token = localStorage.getItem("brasaland_token");

        if (!token) {
          router.replace("/login");
          return;
        }

        const response = await fetch("/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });

        if (response.status === 401) {
          localStorage.removeItem("brasaland_token");
          router.replace("/login");
          return;
        }

        if (!response.ok) {
          throw new Error("profile-load-failed");
        }

        const user: CurrentUser = await response.json();

        if (active) {
          setEmail(user.email ?? "");
          setName(user.profile?.name ?? "");
          setPhone(user.profile?.phone ?? "");
          setAddress(user.profile?.address ?? "");
        }
      } catch {
        if (active) {
          setLoadError("No se pudo cargar el perfil. Comprueba tu conexión e inténtalo de nuevo.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [router, profileRetry]);

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const token = localStorage.getItem("brasaland_token");

      if (!token) {
        logout();
        return;
      }

      const response = await fetch("/profiles/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
        }),
      });

      if (response.status === 401) {
        logout();
        return;
      }

      if (!response.ok) {
        throw new Error("No se pudo actualizar el perfil.");
      }

      setSuccess("Perfil actualizado correctamente.");
    } catch {
      setError("No se pudo guardar el perfil. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main><p>Cargando perfil...</p></main>;
  }

  if (loadError) {
    return (
      <main style={{ maxWidth: 500, margin: "60px auto", padding: 24 }}>
        <h1>Mi perfil - Brasaland</h1>
        <p role="alert" style={{ color: "red" }}>{loadError}</p>
        <button
          type="button"
          onClick={() => setProfileRetry((current) => current + 1)}
        >
          Reintentar
        </button>{" "}
        <a href="/login">Ir al inicio de sesión</a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 500, margin: "60px auto", padding: 24 }}>
      <h1>Mi perfil - Brasaland</h1>

      <p><strong>Email:</strong> {email}</p>

      <form onSubmit={handleSave} style={{ display: "grid", gap: 12 }}>
        <label htmlFor="name">Nombre</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label htmlFor="phone">Teléfono</label>
        <input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <label htmlFor="address">Dirección</label>
        <input
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />

        {error && <p role="alert" style={{ color: "red" }}>{error}</p>}
        {success && <p role="status" style={{ color: "green" }}>{success}</p>}

        <button type="submit" disabled={saving}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </form>
      <p><a href="/account/change-password">Cambiar contraseña</a></p>

      <button
        type="button"
        onClick={logout}
        style={{ marginTop: 24 }}
      >
        Cerrar sesión
      </button>
    </main>
  );
}
