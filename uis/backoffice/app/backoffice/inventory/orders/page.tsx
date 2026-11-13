"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  fetchInventoryOrders,
  type InventoryOrder,
} from "../../../../lib/inventory";

export default function InventoryOrdersPage() {
  const router = useRouter();

  const [authenticated, setAuthenticated] = useState(false);
  const [orders, setOrders] = useState<InventoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem("brasaland_token")) {
      router.replace("/login");
      return;
    }

    setAuthenticated(true);
    let active = true;

    fetchInventoryOrders()
      .then((data) => {
        if (active) setOrders(data);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error
            ? err.message
            : "No se pudieron cargar las órdenes.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [router, reload]);

  if (!authenticated) {
    return <p>Comprobando acceso...</p>;
  }

  return (
    <main style={{
      maxWidth: 1150,
      margin: "35px auto",
      padding: 24,
    }}>
      <header style={{ marginBottom: 30 }}>
        <p>Brasaland · Operaciones</p>
        <h1>Historial de órdenes de ingredientes</h1>

        <p>
          Consulta las entregas recibidas, los consumos
          y las mermas registradas.
        </p>

        <nav style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          marginTop: 20,
        }}>
          <Link href="/backoffice/inventory/products">
            Inventario
          </Link>

          <Link href="/backoffice/inventory/orders/inbound">
            Registrar entrada
          </Link>

          <Link href="/backoffice/inventory/orders/outbound">
            Registrar salida
          </Link>
        </nav>
      </header>

      {loading && <p>Cargando historial...</p>}

      {error && (
        <div role="alert" style={{
          padding: 16,
          background: "#fff0ed",
          color: "#a22020",
          borderRadius: 10,
        }}>
          <p>{error}</p>
          <button onClick={() => {
            setError("");
            setLoading(true);
            setReload(n => n + 1);
          }}>
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <h2>Órdenes registradas: {orders.length}</h2>

          <div style={{ overflowX: "auto", marginTop: 24 }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "white",
            }}>
              <thead>
                <tr style={{ background: "#eee8df" }}>
                  {[
                    "Tipo",
                    "Ingrediente",
                    "Cantidad",
                    "Local",
                    "Fecha",
                    "Usuario UUID",
                    "Detalle",
                  ].map((title) => (
                    <th key={title} style={{
                      padding: 12,
                      textAlign: "left",
                    }}>
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {orders.map((order) => {
                  const inbound = order.order_type === "inbound";

                  return (
                    <tr key={`${order.order_type}-${order.id}`}
                      style={{
                        borderBottom: "1px solid #ddd",
                      }}>
                      <td style={{ padding: 12 }}>
                        <span style={{
                          color: inbound ? "#176c31" : "#a34316",
                          fontWeight: "bold",
                        }}>
                          {inbound ? "● Entrada" : "● Salida"}
                        </span>
                      </td>

                      <td style={{ padding: 12 }}>
                        {order.ingredient_name}
                      </td>

                      <td style={{ padding: 12 }}>
                        {inbound ? "+" : "-"}{order.quantity}
                      </td>

                      <td style={{ padding: 12 }}>
                        Local {order.location_id}
                      </td>

                      <td style={{ padding: 12 }}>
                        {new Date(order.created_at)
                          .toLocaleString("es-ES")}
                      </td>

                      <td style={{
                        padding: 12,
                        overflowWrap: "anywhere",
                        maxWidth: 200,
                      }}>
                        {order.user_uuid}
                      </td>

                      <td style={{ padding: 12 }}>
                        {inbound
                          ? order.supplier_name
                          : order.reason === "waste"
                            ? "Merma"
                            : "Consumo"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {orders.length === 0 && (
            <p>Todavía no hay órdenes registradas.</p>
          )}
        </>
      )}
    </main>
  );
}
