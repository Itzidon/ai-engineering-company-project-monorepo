
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setLoading(true);

    try {
      const response = await fetch("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          ...(name.trim() && { name: name.trim() }),
          ...(phone.trim() && { phone: phone.trim() }),
          ...(address.trim() && { address: address.trim() }),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (Array.isArray(data?.detail)) {
          const fieldErrors: Record<string, string> = {};
          for (const err of data.detail) {
            const field = String(err.loc?.at(-1) ?? "general");
            fieldErrors[field] = field === "password"
              ? "La contraseña no cumple los requisitos mínimos."
              : "Revisa este dato e inténtalo de nuevo.";
          }
          setErrors(fieldErrors);
          return;
        }

        setErrors({
          [response.status === 409 ? "email" : "general"]:
            response.status === 409
              ? "Ya existe una cuenta con este correo."
              : "No se pudo completar el registro. Inténtalo de nuevo.",
        });
        return;
      }

      const loginResponse = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          username: email.trim(),
          password,
        }),
      });

      const loginData = await loginResponse.json().catch(() => null);

      if (!loginResponse.ok || !loginData?.access_token) {
        setErrors({
          general: "Cuenta creada, pero no se pudo iniciar sesión. Continúa desde la página de acceso.",
        });
        return;
      }

      localStorage.setItem("brasaland_token", loginData.access_token);
      router.replace("/suppliers");
    } catch {
      setErrors({
        general: "No se pudo completar el registro. Comprueba tu conexión e inténtalo de nuevo.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "60px auto", padding: 24 }}>
      <h1>Brasaland</h1>
      <h2>Crear cuenta</h2>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <label htmlFor="email">Email *</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        {errors.email && <p role="alert">{errors.email}</p>}

        <label htmlFor="password">Contraseña *</label>
        <input
          id="password"
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        {errors.password && <p role="alert">{errors.password}</p>}

        <label htmlFor="name">Nombre (opcional)</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label htmlFor="phone">Teléfono (opcional)</label>
        <input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <label htmlFor="address">Dirección (opcional)</label>
        <input
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />

        {errors.general && <p role="alert">{errors.general}</p>}

        <button type="submit" disabled={loading}>
          {loading ? "Registrando..." : "Crear cuenta"}
        </button>
      </form>

      <p>
        ¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link>
      </p>
    </main>
  );
}
