
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SuppliersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;

    async function checkAuth() {
      setChecking(true);
      setError("");

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
          throw new Error("session-check-failed");
        }

        if (active) setAuthorized(true);
      } catch {
        if (active) {
          setError("No se pudo comprobar la sesión. Inténtalo de nuevo o inicia sesión.");
        }
      } finally {
        if (active) setChecking(false);
      }
    }

    checkAuth();

    return () => {
      active = false;
    };
  }, [router, retryCount]);

  if (checking) {
    return <main>Comprobando sesión...</main>;
  }

  if (error) {
    return (
      <main>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => setRetryCount((count) => count + 1)}>
          Reintentar
        </button>{" "}
        <a href="/login">Ir al inicio de sesión</a>
      </main>
    );
  }

  if (!authorized) {
    return <main>Redirigiendo al inicio de sesión...</main>;
  }

  return <>{children}</>;
}
