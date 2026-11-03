"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  fetchIngredients,
  createInboundOrder,
  type Ingredient,
} from "../../../../../lib/inventory";

export default function InboundPage() {
  const router = useRouter();

  const [authenticated, setAuthenticated] = useState(false);
  const [products, setProducts] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [supplier, setSupplier] = useState("");
  const [locationId, setLocationId] = useState("1");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("brasaland_token");

    if (!token) {
      router.replace("/login");
      return;
    }

    setAuthenticated(true);

    const params = new URLSearchParams(window.location.search);
    const selectedId = params.get("ingredient_id");

    fetchIngredients()
      .then((data) => {
        setProducts(data);

        if (selectedId && data.some(
          (item) => String(item.id) === selectedId
        )) {
          setIngredientId(selectedId);
        }
      })
      .catch((err) => {
        setError(err instanceof Error
          ? err.message
          : "No se pudieron cargar los ingredientes.");
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const amount = Number(quantity);
    const location = Number(locationId);

    if (!ingredientId || !Number.isFinite(amount) || amount <= 0) {
      setError("Selecciona un ingrediente y una cantidad válida.");
      return;
    }

    if (!Number.isInteger(location) || location < 1 || location > 14) {
      setError("Selecciona un local válido del 1 al 14.");
      return;
    }

    setSaving(true);

    try {
      await createInboundOrder({
        ingredient_id: Number(ingredientId),
        quantity: amount,
        supplier_name: supplier.trim(),
        location_id: location,
      });

      setSuccess("Entrega registrada correctamente.");

      setIngredientId("");
      setQuantity("");
      setSupplier("");
      setLocationId("1");
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : "No se pudo registrar la entrega.");
    } finally {
      setSaving(false);
    }
  }

  if (!authenticated) {
    return <main>Comprobando acceso...</main>;
  }

  const fieldStyle = {
    padding: 12,
    border: "1px solid #ccc",
    borderRadius: 8,
    width: "100%",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "grid",
    gap: 6,
  };

  return (
    <main style={{
      maxWidth: 650,
      margin: "45px auto",
      padding: 24,
    }}>
      <p>Brasaland · Operaciones</p>

      <h1>Registrar entrada de ingredientes</h1>

      <p>
        Registra las entregas recibidas de proveedores
        en los restaurantes de Brasaland.
      </p>

      <nav style={{ marginBottom: 25 }}>
        <Link href="/backoffice/inventory/products">
          Volver al inventario
        </Link>
      </nav>

      {loading && <p>Cargando ingredientes...</p>}

      {error && (
        <p role="alert" style={{
          background: "#fff0ed",
          padding: 14,
          color: "#a22020",
          borderRadius: 8,
        }}>
          {error}
        </p>
      )}

      {success && (
        <p role="status" style={{
          background: "#e7f7ea",
          padding: 14,
          color: "#176c31",
          borderRadius: 8,
        }}>
          {success}
        </p>
      )}

      {!loading && (
        <form onSubmit={handleSubmit} style={{
          display: "grid",
          gap: 20,
          marginTop: 24,
        }}>
          <label style={labelStyle}>
            Ingrediente
            <select
              style={fieldStyle}
              value={ingredientId}
              onChange={(e) => setIngredientId(e.target.value)}
              required
            >
              <option value="">Selecciona un ingrediente</option>

              {products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.country})
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Cantidad recibida
            <input
              style={fieldStyle}
              type="number"
              min="0.001"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </label>

          <label style={labelStyle}>
            Nombre del proveedor
            <input
              style={fieldStyle}
              type="text"
              placeholder="Ej.: Carnes del Valle S.A."
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              required
            />
          </label>

          <label style={labelStyle}>
            Local receptor (1-14)
            <select
              style={fieldStyle}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              required
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
            disabled={saving || products.length === 0}
            style={{
              padding: 14,
              border: "none",
              borderRadius: 9,
              background: "#8b4513",
              color: "white",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            {saving ? "Registrando..." : "Registrar entrega"}
          </button>
        </form>
      )}
    </main>
  );
}
