"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchSuppliers, SupplierApiError } from "./api";
import SupplierCard from "./SupplierCard";
import SupplierForm from "./SupplierForm";
import styles from "./suppliers.module.css";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  COUNTRIES,
  STATUS_LABELS,
  STATUSES,
  type Category,
  type Country,
  type Supplier,
  type SupplierStatus,
} from "./types";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const [country, setCountry] = useState<Country | "">("");
  const [category, setCategory] = useState<Category | "">("");
  const [status, setStatus] = useState<SupplierStatus | "">("");

  useEffect(() => {
    let active = true;

    async function loadSuppliers() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchSuppliers();
        if (active) setSuppliers(data);
      } catch (err) {
        if (active) {
          setError(
            err instanceof SupplierApiError
              ? err.message
              : "No se pudieron cargar los proveedores. Inténtalo de nuevo."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadSuppliers();

    return () => {
      active = false;
    };
  }, [reloadCount]);

  const filtered = useMemo(
    () =>
      suppliers
        .filter((s) => !country || s.country === country)
        .filter((s) => !category || s.categories.includes(category))
        .filter((s) => !status || s.status === status)
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [suppliers, country, category, status],
  );

  const activeCount = suppliers.filter((s) => s.status === "active").length;

  function replaceSupplier(updated: Supplier) {
    setSuppliers((current) => current.map((s) => (s.id === updated.id ? updated : s)));
  }

  function handleCreated(created: Supplier) {
    setSuppliers((current) => [...current, created]);
    setShowForm(false);
    setFlash(`Proveedor "${created.name}" registrado correctamente.`);
  }

  const hasFilters = country || category || status;

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Brasaland · Compras</p>
          <h1>Directorio de proveedores</h1>
          <p className={styles.subtitle}>
            {suppliers.length} proveedores · {activeCount} activos ·{" "}
            {suppliers.length - activeCount} suspendidos
          </p>
        </div>
        <a href="/incidents" className={styles.secondary} style={{ display: "inline-block", textDecoration: "none" }}>Gestor de incidencias</a>
        <a href="/account/profile" className={styles.secondary} style={{ display: "inline-block", textDecoration: "none" }}>Mi perfil</a>
        {!showForm && (
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              setFlash(null);
              setShowForm(true);
            }}
          >
            + Nuevo proveedor
          </button>
        )}
      </header>

      {flash && <p className={styles.flash}>{flash}</p>}

      {showForm && (
        <SupplierForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />
      )}

      <section className={styles.filters} aria-label="Filtros">
        <label>
          País
          <select value={country} onChange={(e) => setCountry(e.target.value as Country | "")}>
            <option value="">Todos</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Categoría
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category | "")}
          >
            <option value="">Todas</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SupplierStatus | "")}
          >
            <option value="">Todos</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {hasFilters && (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              setCountry("");
              setCategory("");
              setStatus("");
            }}
          >
            Limpiar filtros
          </button>
        )}
      </section>

      {loading && <p>Cargando proveedores…</p>}
      {error && (
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setReloadCount((current) => current + 1)}
            disabled={loading}
          >
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <p className={styles.resultCount}>
            Mostrando {filtered.length} de {suppliers.length}
          </p>
          {filtered.length === 0 ? (
            <p className={styles.empty}>No hay proveedores que coincidan con los filtros.</p>
          ) : (
            <section className={styles.grid}>
              {filtered.map((s) => (
                <SupplierCard key={s.id} supplier={s} onUpdated={replaceSupplier} />
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
