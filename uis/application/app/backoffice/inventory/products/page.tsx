"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchIngredients,
  type Ingredient,
} from "../../../../lib/inventory";

const categories: Record<string, string> = {
  meat: "Carne",
  produce: "Verduras",
  sauce: "Salsas",
  beverage: "Bebidas",
  packaging: "Envases",
  cleaning: "Limpieza",
};

function stockStatus(item: Ingredient) {
  // Umbrales visuales para el personal de operaciones.
  // Se pueden ajustar según las necesidades de Brasaland.
  const minimum = item.unit === "unidad" ? 20 :
                  item.unit === "litro" ? 5 : 10;

  if (item.current_stock <= 0) {
    return { label: "Sin stock", color: "#b42318" };
  }

  if (item.current_stock < minimum) {
    return { label: "Stock bajo", color: "#b7791f" };
  }

  return { label: "Stock disponible", color: "#16803c" };
}

export default function InventoryProductsPage() {
  const router = useRouter();

  const [products, setProducts] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("brasaland_token");

    if (!token) {
      router.replace("/login");
      return;
    }

    let active = true;

    fetchIngredients()
      .then((data) => {
        if (active) setProducts(data);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error
            ? err.message
            : "No se pudo cargar el inventario.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router, reload]);

  return (
    <main style={{
      maxWidth: 1100,
      margin: "0 auto",
      padding: 28,
      color: "#242424"
    }}>
      <header style={{ marginBottom: 30 }}>
        <p style={{ color: "#986227" }}>
          BRASALAND · OPERACIONES
        </p>

        <h1>Inventario de ingredientes</h1>

        <p>
          Consulta el stock global disponible en los
          restaurantes de Colombia y Estados Unidos.
        </p>

        <nav style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          marginTop: 20
        }}>
          <Link href="/backoffice/inventory/orders/inbound">
            + Registrar entrada
          </Link>

          <Link href="/backoffice/inventory/orders/outbound">
            Registrar salida
          </Link>

          <Link href="/backoffice/inventory/orders">
            Historial de órdenes
          </Link>
        </nav>
      </header>

      {loading && <p>Cargando ingredientes...</p>}

      {error && (
        <div role="alert" style={{
          padding: 16,
          background: "#fff0ed",
          borderRadius: 10,
          marginBottom: 20
        }}>
          <p>{error}</p>
          <button onClick={() => {
            setError("");
            setLoading(true);
            setReload((n) => n + 1);
          }}>
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <h2>
            Ingredientes registrados: {products.length}
          </h2>

          <section style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 18,
            marginTop: 20
          }}>
            {products.map((product) => {
              const status = stockStatus(product);

              return (
                <article key={product.id} style={{
                  padding: 22,
                  border: "1px solid #ddd",
                  borderRadius: 14,
                  background: "#fff"
                }}>
                  <h3>{product.name}</h3>

                  <p>SKU: {product.sku}</p>

                  <p>
                    Categoría: {
                      categories[product.category] ||
                      product.category
                    }
                  </p>

                  <p>
                    País: {
                      product.country === "CO"
                        ? "Colombia"
                        : "Estados Unidos"
                    }
                  </p>

                  <p style={{
                    fontSize: 28,
                    fontWeight: "bold",
                    marginBottom: 8
                  }}>
                    {product.current_stock.toLocaleString(
                      "es-ES",
                      { maximumFractionDigits: 2 }
                    )} {product.unit}
                  </p>

                  <p style={{
                    color: status.color,
                    fontWeight: "bold"
                  }}>
                    ● {status.label}
                  </p>

                  <div style={{
                    display: "flex",
                    gap: 16,
                    marginTop: 20
                  }}>
                    <Link href={
                      `/backoffice/inventory/orders/inbound?ingredient_id=${product.id}`
                    }>
                      + Entrada
                    </Link>

                    <Link href={
                      `/backoffice/inventory/orders/outbound?ingredient_id=${product.id}`
                    }>
                      - Salida
                    </Link>
                  </div>
                </article>
              );
            })}
          </section>

          {products.length === 0 && (
            <p>No hay ingredientes registrados.</p>
          )}
        </>
      )}
    </main>
  );
}
