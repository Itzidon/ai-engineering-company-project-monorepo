
"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          username: email.trim(),
          password,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          response.status === 401
            ? "Correo o contraseña incorrectos."
            : "No se pudo iniciar sesión. Inténtalo de nuevo."
        );
        return;
      }

      if (!data?.access_token) {
        setError("No se pudo completar el inicio de sesión. Inténtalo de nuevo.");
        return;
      }

      localStorage.setItem("brasaland_token", data.access_token);
      router.replace("/suppliers");
    } catch {
      setError("No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: "80px auto", padding: 24 }}>
      <h1>Brasaland</h1>
      <h2>Iniciar sesión</h2>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <label htmlFor="email">Correo electrónico</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && <p role="alert" style={{ color: "red" }}>{error}</p>}
        {searchParams.get("reset") === "success" && (
          <p role="status" style={{ color: "green" }}>
            Contraseña restablecida correctamente. Ya puedes iniciar sesión.
          </p>
        )}

        <button type="submit" disabled={loading}>
          {loading ? "Entrando..." : "Iniciar sesión"}
        </button>
      </form>
      <p><Link href="/forgot-password">¿Olvidaste tu contraseña?</Link></p>

      <p>
        ¿No tienes cuenta? <Link href="/register">Regístrate</Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main><p>Cargando inicio de sesión...</p></main>}>
      <LoginForm />
    </Suspense>
  );
}
