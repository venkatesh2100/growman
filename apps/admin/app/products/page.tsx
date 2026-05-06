"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";

type Product = {
  id: number;
  name: string;
  slug: string;
  shortDescription?: string;
  fullDescription?: string;
  specifications?: string;
  taxInfo?: string;
  description?: string;
  price: number;
  mrp: number;
  currency?: string;
  imageKey?: string;
  status?: string;
  featured?: boolean;
  stock: number;
  categoryId: number;
  subcategoryId?: number | null;
  brandId?: number | null;
  tags?: string[];
  sizes?: unknown[];
  attributes?: unknown[];
  reviews?: unknown[];
};

type ProductResponse = {
  data: Product[];
  pagination?: { total?: number; page?: number; pageSize?: number };
};

export default function ProductsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const loadProducts = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/products?page=1&pageSize=200");
      if (!res.ok) throw new Error("Failed to fetch products");
      const data = (await res.json()) as ProductResponse;
      setProducts(Array.isArray(data.data) ? data.data : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const totalStock = useMemo(
    () => products.reduce((sum, p) => sum + Number(p.stock || 0), 0),
    [products]
  );

  const openEdit = (product: Product) => {
    setMessage("");
    setEditing(product);
    setForm({
      name: product.name || "",
      slug: product.slug || "",
      shortDescription: product.shortDescription || "",
      fullDescription: product.fullDescription || "",
      specifications: product.specifications || "",
      taxInfo: product.taxInfo || "",
      description: product.description || "",
      price: String(product.price ?? 0),
      mrp: String(product.mrp ?? 0),
      currency: product.currency || "INR",
      imageKey: product.imageKey || "",
      status: product.status || "active",
      featured: product.featured ? "true" : "false",
      stock: String(product.stock ?? 0),
      categoryId: String(product.categoryId || 0),
      subcategoryId: String(product.subcategoryId || ""),
      brandId: String(product.brandId || ""),
      tags: (product.tags || []).join(", "),
    });
  };

  const closeEdit = () => {
    setEditing(null);
    setForm({});
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      setSaving(true);
      setMessage("");
      const getF = (key: string) => form[key] ?? "";

      const payload: Product = {
        ...editing,
        name: getF("name"),
        slug: getF("slug"),
        shortDescription: getF("shortDescription"),
        fullDescription: getF("fullDescription"),
        specifications: getF("specifications"),
        taxInfo: getF("taxInfo"),
        description: getF("description"),
        price: Number(getF("price") || 0),
        mrp: Number(getF("mrp") || 0),
        currency: getF("currency") || "INR",
        imageKey: getF("imageKey"),
        status: getF("status"),
        featured: getF("featured") === "true",
        stock: Number(getF("stock") || 0),
        categoryId: Number(getF("categoryId") || 0),
        subcategoryId: getF("subcategoryId") ? Number(getF("subcategoryId")) : null,
        brandId: getF("brandId") ? Number(getF("brandId")) : null,
        tags: getF("tags")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        sizes: editing.sizes || [],
        attributes: editing.attributes || [],
        reviews: editing.reviews || [],
      };

      const res = await apiFetch(`/products/${editing.slug}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to update product");
      }

      setMessage("Product updated successfully.");
      closeEdit();
      await loadProducts();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Failed to save product.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Products</h1>
          <p className="mt-1 text-sm text-slate-600">
            Edit plant details including name, stock, pricing, and product metadata.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card label="Total Products" value={String(products.length)} />
          <Card label="Total Stock" value={String(totalStock)} />
          <Card
            label="Featured Products"
            value={String(products.filter((p) => p.featured).length)}
          />
        </section>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-auto">
            <table className="w-full min-w-[1200px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Slug</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">MRP</th>
                  <th className="px-4 py-3 font-medium">Stock</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Featured</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={9}>
                      Loading products...
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={9}>
                      No products found.
                    </td>
                  </tr>
                ) : (
                  products.map((product) => (
                    <tr key={product.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 text-slate-700">{product.id}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{product.name}</td>
                      <td className="px-4 py-3 text-slate-700">{product.slug}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {(product.currency || "INR").toUpperCase()} {Number(product.price || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{Number(product.mrp || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-700">{product.stock}</td>
                      <td className="px-4 py-3 text-slate-700">{product.status || "-"}</td>
                      <td className="px-4 py-3 text-slate-700">{product.featured ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openEdit(product)}
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">
              Edit Product #{editing.id}
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {Object.entries(form).map(([key, value]) => (
                <label key={key} className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">{key}</span>
                  <input
                    value={value}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeEdit}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
