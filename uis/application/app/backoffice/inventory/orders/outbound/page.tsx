"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  fetchIngredients,
  fetchIngredient,
  fetchLocalStock,
  createOutboundOrder,
  type Ingredient,
} from "../../../../../lib/inventory";

import { track } from "../../../../../lib/telemetry";

export default function OutboundPage() {
  const router = useRouter();
  const trackedFormVisit = useRef(false);

  const [authenticated, setAuthenticated] = useState(false);
  const [products, setProducts] = useState<Ingredient[]>([]);
  const [ingredientId, setIngredientId] = useState("");
  const [selected, setSelected] = useState<Ingredient | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<"consumption" | "waste">(
    "consumption"
  );
  const [wasteReason, setWasteReason] = useState<
    "expired" | "kitchen_error" | "theft_suspected"
  >("expired");

  const [locationId, setLocationId] = useState("1");

  const [loading, setLoading] = useState(true);
  const [loadingStock, setLoadingStock] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [stockError, setStockError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!localStorage.getItem("brasaland_token")) {
      router.replace("/login");
      return;
    }

    setAuthenticated(true);

    if (!trackedFormVisit.current) {
      trackedFormVisit.current = true;
      track("outbound_order_form_started", {
        form_route: "/backoffice/inventory/orders/outbound",
        source: new URLSearchParams(
          window.location.search
        ).has("ingredient_id") ? "inventory" : "deep_link",
      });
    }

    fetchIngredients()
      .then((data) => {
        setProducts(data);
        const id = new URLSearchParams(
          window.location.search
        ).get("ingredient_id");

        if (id && data.some(p => String(p.id) === id)) {
          setIngredientId(id);
        }
      })
      .catch(err => setError(
        err instanceof Error ? err.message :
        "No se pudieron cargar los ingredientes."
      ))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!ingredientId) {
      setSelected(null);
      return;
    }

    let active = true;
    setLoadingStock(true);
    setSelected(null);
    setStockError("");

    Promise.all([
      fetchIngredient(Number(ingredientId)),
      fetchLocalStock(Number(ingredientId), Number(locationId)),
    ])
      .then(([data, local]) => {
        if (active) {
          setSelected({
            ...data,
            current_stock: local.current_stock,
          });
        }
      })
      .catch(err => {
        if (active) setStockError(
          err instanceof Error ? err.message :
          "No se pudo consultar el stock."
        );
      })
      .finally(() => {
        if (active) setLoadingStock(false);
      });

    return () => { active = false; };
  }, [ingredientId, locationId]);

  const amount = Number(quantity);
  const available = selected?.current_stock ?? 0;
  const insufficient = Boolean(
    selected && quantity && amount > available
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!selected || !Number.isFinite(amount) || amount <= 0) {
      setError("Selecciona un ingrediente y una cantidad válida.");
      return;
    }

    if (insufficient) {
      setError("La cantidad supera el stock disponible.");
      return;
    }

    setSaving(true);

    try {
      const created = await createOutboundOrder({
        ingredient_id: selected.id,
        quantity: amount,
        reason,
        location_id: Number(locationId),
      });

      if (reason === "consumption") {
        track("outbound_order_created", {
          location_id: Number(locationId),
          country: selected.country,
          product_id: selected.id,
          product_category: selected.category,
          quantity: amount,
          unit: selected.unit,
          currency: selected.country === "CO" ? "COP" : "USD",
          outbound_order_id: created.id,
          reason: "consumption",
        });
      }

      if (reason === "waste") {
        track("stock_waste_registered", {
          location_id: Number(locationId),
          country: selected.country,
          product_id: selected.id,
          product_category: selected.category,
          quantity: amount,
          unit: selected.unit,
          currency: selected.country === "CO" ? "COP" : "USD",
          outbound_order_id: created.id,
          reason: wasteReason,
        });
      }

      setSuccess("Salida registrada correctamente.");
      setQuantity("");

      // Consultar de nuevo el stock real tras la salida.
      const [updated, local] = await Promise.all([
        fetchIngredient(selected.id),
        fetchLocalStock(selected.id, Number(locationId)),
      ]);
      setSelected({
        ...updated,
        current_stock: local.current_stock,
      });
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : "No se pudo registrar la salida.");
    } finally {
      setSaving(false);
    }
  }

  const field = {
    padding: 12,
    width: "100%",
    border: "1px solid #ccc",
    borderRadius: 8,
    boxSizing: "border-box" as const,
  };

  if (!authenticated) return <p>Comprobando acceso...</p>;

  return (
    <main style={{
      maxWidth: 650,
      margin: "40px auto",
      padding: 24,
    }}>
      <p>Brasaland · Operaciones</p>
      <h1>Registrar salida de ingredientes</h1>
      <p>Registra consumos de cocina o mermas.</p>

      <Link href="/backoffice/inventory/products">
        Volver al inventario
      </Link>

      {loading && <p>Cargando ingredientes...</p>}

      {success && (
        <p role="status" style={{
          padding: 14,
          background: "#e7f7ea",
          color: "#176c31",
        }}>{success}</p>
      )}

      {error && (
        <p role="alert" style={{
          padding: 14,
          background: "#fff0ed",
          color: "#a22020",
        }}>{error}</p>
      )}

      {!loading && (
        <form onSubmit={submit} style={{
          display: "grid",
          gap: 18,
          marginTop: 25,
        }}>
          <label>
            Ingrediente
            <select
              style={field}
              required
              value={ingredientId}
              onChange={e => {
                setIngredientId(e.target.value);
                setError("");
                setSuccess("");
              }}
            >
              <option value="">Selecciona un ingrediente</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.country})
                </option>
              ))}
            </select>
          </label>

          {loadingStock && <p>Consultando stock...</p>}

          {stockError && (
            <p role="alert" style={{ color: "#a22020" }}>
              {stockError}
            </p>
          )}

          {selected && (
            <div style={{
              padding: 18,
              background: "#f0f7f2",
              borderRadius: 10,
            }}>
              <strong>Stock disponible actualmente:</strong>
              <p style={{ fontSize: 26, margin: "8px 0" }}>
                {selected.current_stock} {selected.unit}
              </p>
            </div>
          )}

          <label>
            Cantidad a retirar
            <input
              style={field}
              type="number"
              min="0.001"
              step="any"
              required
              value={quantity}
              onChange={e => {
                setQuantity(e.target.value);
                setError("");
              }}
            />
            {insufficient && (
              <span role="alert" style={{
                display: "block",
                color: "#b42318",
                marginTop: 8,
              }}>
                Stock insuficiente. Solo quedan {available}{" "}
                {selected?.unit}.
              </span>
            )}
            {error && (
              <span role="alert" style={{
                display: "block",
                color: "#b42318",
                marginTop: 8,
              }}>
                {error}
              </span>
            )}
          </label>

          <label>
            Motivo
            <select
              style={field}
              value={reason}
              onChange={e => setReason(
                e.target.value as "consumption" | "waste"
              )}
            >
              <option value="consumption">Consumo</option>
              <option value="waste">Merma</option>
            </select>
          </label>

          {reason === "waste" && (
            <label>
              Causa de la merma
              <select
                style={field}
                value={wasteReason}
                onChange={e => setWasteReason(
                  e.target.value as
                    "expired" | "kitchen_error" | "theft_suspected"
                )}
              >
                <option value="expired">Producto caducado</option>
                <option value="kitchen_error">Error de cocina</option>
                <option value="theft_suspected">Posible robo</option>
              </select>
            </label>
          )}

          <label>
            Local (1-14)
            <select
              style={field}
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
            >
              {Array.from({ length: 14 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Local {i + 1}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={
              saving || !selected || loadingStock ||
              insufficient || !quantity || amount <= 0
            }
            style={{
              padding: 14,
              background: "#8b4513",
              color: "white",
              border: "none",
              borderRadius: 9,
            }}
          >
            {saving ? "Registrando..." : "Registrar salida"}
          </button>
        </form>
      )}
    </main>
  );
}
