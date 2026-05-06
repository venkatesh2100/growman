"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../lib/api";
import { useAuthStore } from "../../../lib/store/authStore";

type Option = { id: number; name: string; slug?: string };
type ProductSize = { label: string; price: string; stock: string };
type RequestedProduct = {
  id: number;
  productName: string;
  details?: string;
  source?: string;
  status?: string;
  requesterName?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  adminNotes?: string;
  createdAt?: string;
};

export default function AddProductPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const [categories, setCategories] = useState<Option[]>([]);
  const [subcategories, setSubcategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sizes, setSizes] = useState<ProductSize[]>([
    { label: "", price: "", stock: "0" },
  ]);
  const [mainImageFile, setMainImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [requestedProducts, setRequestedProducts] = useState<RequestedProduct[]>([]);
  const [form, setForm] = useState({
    name: "",
    shortDescription: "",
    fullDescription: "",
    taxInfo: "",
    mrp: "",
    categoryId: "",
    subcategoryId: "",
    brandId: "",
  });

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    apiFetch("/categories").then((r) => r.json()).then(setCategories).catch(() => {});
    apiFetch("/brands").then((r) => r.json()).then(setBrands).catch(() => {});
    apiFetch("/tags").then((r) => r.json()).then(setTags).catch(() => {});
    apiFetch("/requested-products?status=pending")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRequestedProducts)
      .catch(() => setRequestedProducts([]));
  }, [token, router]);

  useEffect(() => {
    if (!form.categoryId) {
      setSubcategories([]);
      return;
    }
    const selected = categories.find(
      (cat) => String(cat.id) === String(form.categoryId)
    );
    if (!selected?.slug) return;
    apiFetch(`/categories/${selected.slug}/subcategories`)
      .then((r) => r.json())
      .then(setSubcategories)
      .catch(() => setSubcategories([]));
  }, [form.categoryId, categories]);

  const uploadImage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("prefix", "products");
    const apiUrl =
      process.env.NEXT_PUBLIC_GO_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8080/api/v1";
    const res = await fetch(`${apiUrl}/images/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.imageKey;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      let imageKey = "";
      if (mainImageFile) {
        imageKey = await uploadImage(mainImageFile);
      }
      const payload = {
        name: form.name,
        slug: form.name.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, "-"),
        description: form.shortDescription,
        shortDescription: form.shortDescription,
        fullDescription: form.fullDescription,
        taxInfo: form.taxInfo,
        price: Math.min(...sizes.map((s) => Number(s.price || 0))),
        mrp: Number(form.mrp || 0),
        currency: "INR",
        imageKey,
        status: "active",
        featured: false,
        tags: selectedTags,
        stock: sizes.reduce((sum, s) => sum + Number(s.stock || 0), 0),
        categoryId: Number(form.categoryId),
        subcategoryId: form.subcategoryId ? Number(form.subcategoryId) : null,
        brandId: form.brandId ? Number(form.brandId) : null,
        sizes: sizes.map((s) => ({
          label: s.label,
          price: Number(s.price),
          stock: Number(s.stock || 0),
          imageKeys: [],
        })),
      };
      const res = await apiFetch("/products", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Product created successfully.");
      setForm({
        name: "",
        shortDescription: "",
        fullDescription: "",
        taxInfo: "",
        mrp: "",
        categoryId: "",
        subcategoryId: "",
        brandId: "",
      });
      setSelectedTags([]);
      setSizes([{ label: "", price: "", stock: "0" }]);
      setMainImageFile(null);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create product.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm text-slate-600">
            Add a product with pricing, inventory, and category metadata.
          </p>
          {message && (
            <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {message}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none" placeholder="Product name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} required />
            <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none" placeholder="Short description" value={form.shortDescription} onChange={(e) => setForm((s) => ({ ...s, shortDescription: e.target.value }))} required />
            <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none" placeholder="Full description" value={form.fullDescription} onChange={(e) => setForm((s) => ({ ...s, fullDescription: e.target.value }))} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <select className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none" value={form.categoryId} onChange={(e) => setForm((s) => ({ ...s, categoryId: e.target.value, subcategoryId: "" }))} required>
                <option value="">Category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none" value={form.subcategoryId} onChange={(e) => setForm((s) => ({ ...s, subcategoryId: e.target.value }))}>
                <option value="">Subcategory</option>
                {subcategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none" value={form.brandId} onChange={(e) => setForm((s) => ({ ...s, brandId: e.target.value }))}>
                <option value="">Brand</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2" type="file" accept="image/*" onChange={(e) => setMainImageFile(e.target.files?.[0] ?? null)} />
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="font-medium text-slate-800">Sizes</p>
              {sizes.map((size, index) => (
                <div key={index} className="grid grid-cols-3 gap-2">
                  <input className="rounded-md border border-slate-300 px-3 py-2" placeholder="Label" value={size.label} onChange={(e) => setSizes((prev) => prev.map((s, i) => i === index ? { ...s, label: e.target.value } : s))} required />
                  <input className="rounded-md border border-slate-300 px-3 py-2" type="number" placeholder="Price" value={size.price} onChange={(e) => setSizes((prev) => prev.map((s, i) => i === index ? { ...s, price: e.target.value } : s))} required />
                  <input className="rounded-md border border-slate-300 px-3 py-2" type="number" placeholder="Stock" value={size.stock} onChange={(e) => setSizes((prev) => prev.map((s, i) => i === index ? { ...s, stock: e.target.value } : s))} />
                </div>
              ))}
              <button type="button" className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50" onClick={() => setSizes((prev) => [...prev, { label: "", price: "", stock: "0" }])}>
                Add size
              </button>
            </div>
            <div className="space-y-2">
              <p className="font-medium text-slate-800">Tags</p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setSelectedTags((prev) =>
                        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-sm transition ${selectedTags.includes(tag) ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
            <button disabled={submitting} className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60" type="submit">
              {submitting ? "Saving..." : "Create Product"}
            </button>
          </form>
        </section>
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Requested Products (Pending)</h2>
          <p className="mt-1 text-sm text-slate-600">
            Use these requests to create missing products users asked for.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-2 py-2 font-medium">Product</th>
                  <th className="px-2 py-2 font-medium">Details</th>
                  <th className="px-2 py-2 font-medium">Requester</th>
                  <th className="px-2 py-2 font-medium">Source</th>
                  <th className="px-2 py-2 font-medium">Admin Notes</th>
                  <th className="px-2 py-2 font-medium">Requested At</th>
                </tr>
              </thead>
              <tbody>
                {requestedProducts.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 align-top">
                    <td className="px-2 py-2 font-medium text-slate-800">{item.productName}</td>
                    <td className="px-2 py-2 text-slate-600">{item.details || "-"}</td>
                    <td className="px-2 py-2 text-slate-600">
                      <div>{item.requesterName || "-"}</div>
                      <div className="text-xs">{item.requesterEmail || "-"}</div>
                      <div className="text-xs">{item.requesterPhone || "-"}</div>
                    </td>
                    <td className="px-2 py-2 text-slate-600">{item.source || "manual"}</td>
                    <td className="px-2 py-2 text-slate-600">{item.adminNotes || "-"}</td>
                    <td className="px-2 py-2 text-slate-600">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
                {requestedProducts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-4 text-center text-slate-500">
                      No pending product requests.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
