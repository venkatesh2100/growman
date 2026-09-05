"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, getApiUrl } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";

type Option = { id: number; name: string; slug?: string };

type ProductSize = {
  id?: number;
  label: string;
  price: number;
  stock: number;
  productId?: number;
  imageKeys?: string[];
  images?: string[];
};

type ProductAttribute = {
  id?: number;
  name: string;
  value: string;
  productId?: number;
};

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
  imageUrl?: string;
  status?: string;
  featured?: boolean;
  stock: number;
  categoryId: number;
  subcategoryId?: number | null;
  brandId?: number | null;
  tags?: string[];
  sizes?: ProductSize[];
  attributes?: ProductAttribute[];
  reviews?: unknown[];
};

type ProductResponse = {
  data: Product[];
  pagination?: { total?: number; page?: number; pageSize?: number };
};

type OrderSupportRequest = {
  id: number;
  orderId?: number;
  userId?: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  issueType: string;
  priority: string;
  userMessage: string;
  orderStatus?: string;
  paymentStatus?: string;
  orderAmount?: number;
  orderItems?: string;
  expectedDelivery?: string;
  status: string;
  source?: string;
  createdAt?: string;
};

type EditForm = {
  name: string;
  slug: string;
  shortDescription: string;
  fullDescription: string;
  description: string;
  specifications: string;
  taxInfo: string;
  price: string;
  mrp: string;
  currency: string;
  imageKey: string;
  imageUrl: string;
  status: string;
  featured: boolean;
  stock: string;
  categoryId: string;
  subcategoryId: string;
  brandId: string;
  tags: string[];
  sizes: ProductSize[];
  attributes: ProductAttribute[];
};

const emptySize = (): ProductSize => ({
  label: "",
  price: 0,
  stock: 0,
  imageKeys: [],
  images: [],
});

const emptyAttribute = (): ProductAttribute => ({
  name: "",
  value: "",
});

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const sectionClass = "rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3";

async function uploadProductImage(file: File): Promise<{ imageKey: string; imageUrl: string }> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("prefix", "products");

  const token =
    useAuthStore.getState().token ||
    (typeof window !== "undefined" ? localStorage.getItem("token") : null) ||
    "";

  const res = await fetch(`${getApiUrl()}/images/upload`, {
    method: "POST",
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: "include",
  });
  if (!res.ok) throw new Error((await res.text()) || "Image upload failed");
  const data = (await res.json()) as { imageKey?: string; imageUrl?: string };
  if (!data.imageKey) throw new Error("Upload succeeded but no imageKey returned");
  return {
    imageKey: data.imageKey,
    imageUrl: data.imageUrl || "",
  };
}

function ImageSlot({
  imageUrl,
  imageKey,
  uploading,
  disabled,
  onUpload,
  onDelete,
  label = "Image",
  allowDelete = true,
}: {
  imageUrl?: string;
  imageKey?: string;
  uploading?: boolean;
  disabled?: boolean;
  onUpload: (file: File) => void | Promise<void>;
  onDelete: () => void;
  label?: string;
  allowDelete?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const preview = localPreview || imageUrl || "";
  const busy = Boolean(uploading || disabled);

  const acceptFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file?.type.startsWith("image/") || busy) return;
    const url = URL.createObjectURL(file);
    setLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    await onUpload(file);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 border-dashed bg-white p-3 transition-colors ${
        dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300"
      } ${busy ? "opacity-70" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void acceptFile(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          void acceptFile(e.target.files);
          e.target.value = "";
        }}
      />

      {preview ? (
        <div className="flex items-center gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt={label} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-slate-800">{label}</p>
            {imageKey ? (
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{imageKey}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50 disabled:opacity-50"
                onClick={() => inputRef.current?.click()}
              >
                {uploading ? "Uploading…" : "Replace"}
              </button>
              {allowDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50"
                  onClick={() => {
                    if (localPreview) {
                      URL.revokeObjectURL(localPreview);
                      setLocalPreview(null);
                    }
                    onDelete();
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          className="flex w-full flex-col items-center justify-center gap-1 py-4 text-center disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
        >
          <span className="text-sm font-medium text-slate-700">
            {uploading ? "Uploading…" : "Upload image"}
          </span>
          <span className="text-xs text-slate-500">Drop or click · PNG, JPG, WEBP</span>
        </button>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [supportRequests, setSupportRequests] = useState<OrderSupportRequest[]>([]);
  const [supportLoading, setSupportLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);

  const [categories, setCategories] = useState<Option[]>([]);
  const [subcategories, setSubcategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");

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

  const loadSupportRequests = async () => {
    try {
      setSupportLoading(true);
      const res = await apiFetch("/order-support-requests?status=pending");
      if (!res.ok) throw new Error("Failed to fetch support requests");
      const data = (await res.json()) as OrderSupportRequest[];
      setSupportRequests(Array.isArray(data) ? data : []);
    } catch {
      setSupportRequests([]);
    } finally {
      setSupportLoading(false);
    }
  };

  const loadCatalogOptions = async () => {
    const [catsRes, brandsRes, tagsRes] = await Promise.all([
      apiFetch("/categories"),
      apiFetch("/brands"),
      apiFetch("/tags"),
    ]);
    if (catsRes.ok) {
      const cats = (await catsRes.json()) as Option[];
      setCategories(Array.isArray(cats) ? cats : []);
    }
    if (brandsRes.ok) {
      const b = (await brandsRes.json()) as Option[];
      setBrands(Array.isArray(b) ? b : []);
    }
    if (tagsRes.ok) {
      const t = (await tagsRes.json()) as string[];
      setAvailableTags(Array.isArray(t) ? t : []);
    }
  };

  const loadSubcategories = async (categoryId: string) => {
    if (!categoryId) {
      setSubcategories([]);
      return;
    }
    const selected = categories.find((c) => String(c.id) === categoryId);
    if (!selected?.slug) {
      setSubcategories([]);
      return;
    }
    try {
      const res = await apiFetch(`/categories/${selected.slug}/subcategories`);
      if (!res.ok) {
        setSubcategories([]);
        return;
      }
      const data = (await res.json()) as Option[];
      setSubcategories(Array.isArray(data) ? data : []);
    } catch {
      setSubcategories([]);
    }
  };

  const resolveSupportRequest = async (id: number) => {
    try {
      const res = await apiFetch(`/order-support-requests/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "resolved" }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setMessage(`Support ticket #${id} marked resolved.`);
      await loadSupportRequests();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Failed to update ticket.");
    }
  };

  useEffect(() => {
    loadProducts();
    loadSupportRequests();
    loadCatalogOptions();
  }, []);

  useEffect(() => {
    if (form?.categoryId) {
      loadSubcategories(form.categoryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.categoryId, categories]);

  const totalStock = useMemo(
    () => products.reduce((sum, p) => sum + Number(p.stock || 0), 0),
    [products]
  );

  const openEdit = async (product: Product) => {
    setMessage("");
    setEditing(product);
    setEditLoading(true);
    setNewTagInput("");

    try {
      // List endpoint omits some fields; fetch full detail for editing.
      const res = await apiFetch(`/products/${product.slug}`);
      const full: Product = res.ok ? ((await res.json()) as Product) : product;

      const specs = full.specifications || "";
      const attrsFromSpecs =
        !full.attributes?.length && specs.includes(":")
          ? specs
              .split("|")
              .map((part) => part.trim())
              .filter(Boolean)
              .map((part) => {
                const [name, ...rest] = part.split(":");
                return { name: (name || "").trim(), value: rest.join(":").trim() };
              })
              .filter((a) => a.name || a.value)
          : [];

      setForm({
        name: full.name || "",
        slug: full.slug || "",
        shortDescription: full.shortDescription || "",
        fullDescription: full.fullDescription || "",
        description: full.description || full.shortDescription || "",
        specifications: full.specifications || "",
        taxInfo: full.taxInfo || "",
        price: String(full.price ?? 0),
        mrp: String(full.mrp ?? 0),
        currency: full.currency || "INR",
        imageKey: full.imageKey || "",
        imageUrl: full.imageUrl || "",
        status: full.status || "active",
        featured: Boolean(full.featured),
        stock: String(full.stock ?? 0),
        categoryId: String(full.categoryId || ""),
        subcategoryId: full.subcategoryId ? String(full.subcategoryId) : "",
        brandId: full.brandId ? String(full.brandId) : "",
        tags: [...(full.tags || [])],
        sizes:
          full.sizes && full.sizes.length > 0
            ? full.sizes.map((s) => {
                const keys = (s.imageKeys || []).filter(Boolean);
                const urls = s.images || [];
                return {
                  id: s.id,
                  label: s.label || "",
                  price: Number(s.price || 0),
                  stock: Number(s.stock || 0),
                  productId: s.productId || full.id,
                  imageKeys: keys,
                  images: keys.map((_, i) => urls[i] || ""),
                };
              })
            : [emptySize()],
        attributes:
          full.attributes && full.attributes.length > 0
            ? full.attributes.map((a) => ({
                id: a.id,
                name: a.name || "",
                value: a.value || "",
                productId: a.productId || full.id,
              }))
            : attrsFromSpecs.length
              ? attrsFromSpecs
              : [emptyAttribute()],
      });
      setEditing(full);
    } catch {
      setForm({
        name: product.name || "",
        slug: product.slug || "",
        shortDescription: product.shortDescription || "",
        fullDescription: product.fullDescription || "",
        description: product.description || "",
        specifications: product.specifications || "",
        taxInfo: product.taxInfo || "",
        price: String(product.price ?? 0),
        mrp: String(product.mrp ?? 0),
        currency: product.currency || "INR",
        imageKey: product.imageKey || "",
        imageUrl: product.imageUrl || "",
        status: product.status || "active",
        featured: Boolean(product.featured),
        stock: String(product.stock ?? 0),
        categoryId: String(product.categoryId || ""),
        subcategoryId: product.subcategoryId ? String(product.subcategoryId) : "",
        brandId: product.brandId ? String(product.brandId) : "",
        tags: [...(product.tags || [])],
        sizes: product.sizes?.length
          ? product.sizes.map((s) => {
              const keys = (s.imageKeys || []).filter(Boolean);
              const urls = s.images || [];
              return {
                ...s,
                imageKeys: keys,
                images: keys.map((_, i) => urls[i] || ""),
              };
            })
          : [emptySize()],
        attributes: product.attributes?.length
          ? product.attributes
          : [emptyAttribute()],
      });
    } finally {
      setEditLoading(false);
    }
  };

  const closeEdit = () => {
    setEditing(null);
    setForm(null);
    setNewTagInput("");
    setUploadingSlot(null);
  };

  const updateForm = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleMainImageUpload = async (file: File) => {
    if (!form) return;
    const slot = "main";
    try {
      setUploadingSlot(slot);
      setMessage("");
      const uploaded = await uploadProductImage(file);
      updateForm("imageKey", uploaded.imageKey);
      updateForm("imageUrl", uploaded.imageUrl);
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Failed to upload main image.");
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleMainImageDelete = () => {
    updateForm("imageKey", "");
    updateForm("imageUrl", "");
  };

  const handleSizeImageUpload = async (
    sizeIndex: number,
    imageIndex: number | null,
    file: File
  ) => {
    if (!form) return;
    const slot = `size-${sizeIndex}-${imageIndex ?? "new"}`;
    try {
      setUploadingSlot(slot);
      setMessage("");
      const uploaded = await uploadProductImage(file);
      const next = [...form.sizes];
      const size = next[sizeIndex];
      if (!size) return;
      const keys = [...(size.imageKeys || [])];
      const urls = [...(size.images || [])];
      if (imageIndex == null) {
        keys.push(uploaded.imageKey);
        urls.push(uploaded.imageUrl);
      } else {
        keys[imageIndex] = uploaded.imageKey;
        urls[imageIndex] = uploaded.imageUrl;
      }
      next[sizeIndex] = { ...size, imageKeys: keys, images: urls };
      updateForm("sizes", next);
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Failed to upload size image.");
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleSizeImageDelete = (sizeIndex: number, imageIndex: number) => {
    if (!form) return;
    const next = [...form.sizes];
    const size = next[sizeIndex];
    if (!size) return;
    next[sizeIndex] = {
      ...size,
      imageKeys: (size.imageKeys || []).filter((_, i) => i !== imageIndex),
      images: (size.images || []).filter((_, i) => i !== imageIndex),
    };
    updateForm("sizes", next);
  };

  const handleSave = async () => {
    if (!editing || !form) return;
    try {
      setSaving(true);
      setMessage("");

      const sizesPayload = form.sizes
        .filter((s) => s.label.trim() || Number(s.price) > 0)
        .map((s) => ({
          ...(s.id ? { id: s.id } : {}),
          label: s.label.trim(),
          price: Number(s.price || 0),
          stock: Number(s.stock || 0),
          productId: editing.id,
          imageKeys: (s.imageKeys || []).map((k) => k.trim()).filter(Boolean),
        }));

      const attributesPayload = form.attributes
        .filter((a) => a.name.trim() || a.value.trim())
        .map((a) => ({
          ...(a.id ? { id: a.id } : {}),
          name: a.name.trim(),
          value: a.value.trim(),
          productId: editing.id,
        }));

      const specsFromAttrs = attributesPayload
        .map((a) => `${a.name}: ${a.value}`)
        .join(" | ");

      const totalSizeStock = sizesPayload.reduce((sum, s) => sum + s.stock, 0);
      const minSizePrice =
        sizesPayload.length > 0
          ? Math.min(...sizesPayload.map((s) => s.price))
          : Number(form.price || 0);

      const payload = {
        ...editing,
        name: form.name.trim(),
        slug: form.slug.trim(),
        shortDescription: form.shortDescription,
        fullDescription: form.fullDescription,
        description: form.description || form.shortDescription,
        specifications: form.specifications.trim() || specsFromAttrs,
        taxInfo: form.taxInfo,
        price: Number(form.price || minSizePrice || 0),
        mrp: Number(form.mrp || 0),
        currency: form.currency || "INR",
        imageKey: form.imageKey.trim(),
        status: form.status || "active",
        featured: form.featured,
        stock: Number(form.stock || totalSizeStock || 0),
        categoryId: Number(form.categoryId || 0),
        subcategoryId: form.subcategoryId ? Number(form.subcategoryId) : null,
        brandId: form.brandId ? Number(form.brandId) : null,
        tags: form.tags,
        sizes: sizesPayload,
        attributes: attributesPayload,
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

  const toggleTag = (tag: string) => {
    if (!form) return;
    const exists = form.tags.includes(tag);
    updateForm(
      "tags",
      exists ? form.tags.filter((t) => t !== tag) : [...form.tags, tag]
    );
  };

  const addCustomTag = () => {
    const tag = newTagInput.trim();
    if (!tag || !form) return;
    if (!form.tags.includes(tag)) {
      updateForm("tags", [...form.tags, tag]);
    }
    if (!availableTags.includes(tag)) {
      setAvailableTags((prev) => [...prev, tag]);
    }
    setNewTagInput("");
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Products</h1>
          <p className="mt-1 text-sm text-slate-600">
            Edit plant details including name, stock, pricing, sizes, attributes, and metadata.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card label="Total Products" value={String(products.length)} />
          <Card label="Total Stock" value={String(totalStock)} />
          <Card
            label="Featured Products"
            value={String(products.filter((p) => p.featured).length)}
          />
          <Card
            label="Priority Order Support"
            value={String(supportRequests.length)}
            highlight={supportRequests.length > 0}
          />
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 shadow-sm">
          <div className="border-b border-amber-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Priority order support (from Dootha chat)</h2>
            <p className="mt-1 text-sm text-slate-600">
              Delivery delays, escalations, and order help requests from customers.
            </p>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-white/80 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Ticket</th>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Issue</th>
                  <th className="px-4 py-3 font-medium">Order details</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {supportLoading ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={8}>
                      Loading support requests...
                    </td>
                  </tr>
                ) : supportRequests.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={8}>
                      No pending order support requests.
                    </td>
                  </tr>
                ) : (
                  supportRequests.map((req) => (
                    <tr key={req.id} className="border-t border-amber-100 bg-white">
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
                          HIGH #{req.id}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {req.orderId ? `#${req.orderId}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div>{req.customerName || "—"}</div>
                        <div className="text-xs text-slate-500">{req.customerEmail || req.customerPhone || ""}</div>
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-700">
                        {(req.issueType || "order_support").replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {req.orderStatus && (
                          <div>
                            {req.orderStatus}
                            {req.paymentStatus ? ` · ${req.paymentStatus}` : ""}
                          </div>
                        )}
                        {req.orderAmount != null && req.orderAmount > 0 && (
                          <div className="text-xs">₹{Math.round(req.orderAmount)}</div>
                        )}
                        {req.orderItems && (
                          <div className="mt-1 line-clamp-2 text-xs text-slate-500">{req.orderItems}</div>
                        )}
                        {req.expectedDelivery && (
                          <div className="text-xs text-slate-500">ETA: {req.expectedDelivery}</div>
                        )}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-slate-700">
                        <p className="line-clamp-3 text-xs">{req.userMessage}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {req.createdAt ? new Date(req.createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => resolveSupportRequest(req.id)}
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          Resolve
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
          <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Edit Product #{editing.id}
                </h2>
                <p className="text-sm text-slate-500">{editing.name}</p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                disabled={saving}
              >
                Close
              </button>
            </div>

            {editLoading || !form ? (
              <p className="mt-6 text-sm text-slate-500">Loading full product details...</p>
            ) : (
              <div className="mt-4 space-y-4">
                {/* Basics */}
                <div className={sectionClass}>
                  <h3 className="text-sm font-semibold text-slate-800">Basics</h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label>
                      <span className={labelClass}>Name</span>
                      <input
                        className={inputClass}
                        value={form.name}
                        onChange={(e) => updateForm("name", e.target.value)}
                      />
                    </label>
                    <label>
                      <span className={labelClass}>Slug</span>
                      <input
                        className={inputClass}
                        value={form.slug}
                        onChange={(e) => updateForm("slug", e.target.value)}
                      />
                    </label>
                    <label>
                      <span className={labelClass}>Status</span>
                      <select
                        className={inputClass}
                        value={form.status}
                        onChange={(e) => updateForm("status", e.target.value)}
                      >
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                        <option value="draft">draft</option>
                        <option value="out_of_stock">out_of_stock</option>
                      </select>
                    </label>
                    <label className="flex items-end gap-2 pb-2">
                      <input
                        type="checkbox"
                        checked={form.featured}
                        onChange={(e) => updateForm("featured", e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span className="text-sm font-medium text-slate-700">Featured product</span>
                    </label>
                  </div>
                </div>

                {/* Descriptions */}
                <div className={sectionClass}>
                  <h3 className="text-sm font-semibold text-slate-800">Descriptions</h3>
                  <label>
                    <span className={labelClass}>Short description</span>
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={form.shortDescription}
                      onChange={(e) => updateForm("shortDescription", e.target.value)}
                    />
                  </label>
                  {/* <label>
                    <span className={labelClass}>Description</span>
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={form.description}
                      onChange={(e) => updateForm("description", e.target.value)}
                    />
                  </label> */}
                  <label>
                    <span className={labelClass}>Full description</span>
                    <textarea
                      className={inputClass}
                      rows={4}
                      value={form.fullDescription}
                      onChange={(e) => updateForm("fullDescription", e.target.value)}
                    />
                  </label>
                  <label>
                    <span className={labelClass}>Tax info</span>
                    <input
                      className={inputClass}
                      placeholder="e.g. GST 5%"
                      value={form.taxInfo}
                      onChange={(e) => updateForm("taxInfo", e.target.value)}
                    />
                  </label>
                  <label>
                    <span className={labelClass}>Specifications (raw)</span>
                    <textarea
                      className={inputClass}
                      rows={2}
                      placeholder="Height: 30cm | Light: Indirect"
                      value={form.specifications}
                      onChange={(e) => updateForm("specifications", e.target.value)}
                    />
                  </label>
                </div>

                {/* Pricing & stock */}
                <div className={sectionClass}>
                  <h3 className="text-sm font-semibold text-slate-800">Pricing & stock</h3>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <label>
                      <span className={labelClass}>Price</span>
                      <input
                        type="number"
                        step="0.01"
                        className={inputClass}
                        value={form.price}
                        onChange={(e) => updateForm("price", e.target.value)}
                      />
                    </label>
                    <label>
                      <span className={labelClass}>MRP</span>
                      <input
                        type="number"
                        step="0.01"
                        className={inputClass}
                        value={form.mrp}
                        onChange={(e) => updateForm("mrp", e.target.value)}
                      />
                    </label>
                    <label>
                      <span className={labelClass}>Currency</span>
                      <select
                        className={inputClass}
                        value={form.currency}
                        onChange={(e) => updateForm("currency", e.target.value)}
                      >
                        <option value="INR">INR</option>
                        <option value="USD">USD</option>
                      </select>
                    </label>
                    <label>
                      <span className={labelClass}>Total stock</span>
                      <input
                        type="number"
                        className={inputClass}
                        value={form.stock}
                        onChange={(e) => updateForm("stock", e.target.value)}
                      />
                    </label>
                  </div>
                </div>

                {/* Catalog */}
                <div className={sectionClass}>
                  <h3 className="text-sm font-semibold text-slate-800">Catalog</h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <label>
                      <span className={labelClass}>Category</span>
                      <select
                        className={inputClass}
                        value={form.categoryId}
                        onChange={(e) => {
                          updateForm("categoryId", e.target.value);
                          updateForm("subcategoryId", "");
                        }}
                      >
                        <option value="">Select category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className={labelClass}>Subcategory</span>
                      <select
                        className={inputClass}
                        value={form.subcategoryId}
                        onChange={(e) => updateForm("subcategoryId", e.target.value)}
                        disabled={!form.categoryId}
                      >
                        <option value="">None</option>
                        {subcategories.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className={labelClass}>Brand</span>
                      <select
                        className={inputClass}
                        value={form.brandId}
                        onChange={(e) => updateForm("brandId", e.target.value)}
                      >
                        <option value="">None</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div>
                    <span className={labelClass}>Main product image</span>
                    <ImageSlot
                      label="Main image"
                      imageKey={form.imageKey}
                      imageUrl={form.imageUrl}
                      uploading={uploadingSlot === "main"}
                      disabled={saving || Boolean(uploadingSlot && uploadingSlot !== "main")}
                      onUpload={handleMainImageUpload}
                      onDelete={handleMainImageDelete}
                    />
                  </div>
                </div>

                {/* Tags */}
                <div className={sectionClass}>
                  <h3 className="text-sm font-semibold text-slate-800">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(new Set([...availableTags, ...form.tags])).map((tag) => {
                      const selected = form.tags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTag(tag)}
                          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                            selected
                              ? "bg-emerald-600 text-white ring-emerald-600"
                              : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      placeholder="Add custom tag"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomTag();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={addCustomTag}
                      className="shrink-0 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Attributes */}
                <div className={sectionClass}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">Attributes</h3>
                    <button
                      type="button"
                      className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
                      onClick={() =>
                        updateForm("attributes", [...form.attributes, emptyAttribute()])
                      }
                    >
                      + Add attribute
                    </button>
                  </div>
                  {form.attributes.map((attr, idx) => (
                    <div key={attr.id ?? `attr-${idx}`} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <input
                        className={inputClass}
                        placeholder="Name (e.g. Height)"
                        value={attr.name}
                        onChange={(e) => {
                          const next = [...form.attributes];
                          next[idx] = { ...attr, name: e.target.value };
                          updateForm("attributes", next);
                        }}
                      />
                      <input
                        className={inputClass}
                        placeholder="Value (e.g. 30cm)"
                        value={attr.value}
                        onChange={(e) => {
                          const next = [...form.attributes];
                          next[idx] = { ...attr, value: e.target.value };
                          updateForm("attributes", next);
                        }}
                      />
                      <button
                        type="button"
                        className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-200 disabled:opacity-40"
                        disabled={form.attributes.length <= 1}
                        onClick={() =>
                          updateForm(
                            "attributes",
                            form.attributes.filter((_, i) => i !== idx)
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                {/* Sizes */}
                <div className={sectionClass}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">Sizes / variants</h3>
                    <button
                      type="button"
                      className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
                      onClick={() => updateForm("sizes", [...form.sizes, emptySize()])}
                    >
                      + Add size
                    </button>
                  </div>
                  {form.sizes.map((size, idx) => (
                    <div
                      key={size.id ?? `size-${idx}`}
                      className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"
                    >
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                        <label>
                          <span className={labelClass}>Label</span>
                          <input
                            className={inputClass}
                            placeholder="e.g. Small / 6 inch"
                            value={size.label}
                            onChange={(e) => {
                              const next = [...form.sizes];
                              next[idx] = { ...size, label: e.target.value };
                              updateForm("sizes", next);
                            }}
                          />
                        </label>
                        <label>
                          <span className={labelClass}>Price</span>
                          <input
                            type="number"
                            step="0.01"
                            className={inputClass}
                            value={size.price}
                            onChange={(e) => {
                              const next = [...form.sizes];
                              next[idx] = { ...size, price: Number(e.target.value || 0) };
                              updateForm("sizes", next);
                            }}
                          />
                        </label>
                        <label>
                          <span className={labelClass}>Stock</span>
                          <input
                            type="number"
                            className={inputClass}
                            value={size.stock}
                            onChange={(e) => {
                              const next = [...form.sizes];
                              next[idx] = { ...size, stock: Number(e.target.value || 0) };
                              updateForm("sizes", next);
                            }}
                          />
                        </label>
                        <div className="flex items-end">
                          <button
                            type="button"
                            className="w-full rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-200 disabled:opacity-40"
                            disabled={form.sizes.length <= 1}
                            onClick={() =>
                              updateForm(
                                "sizes",
                                form.sizes.filter((_, i) => i !== idx)
                              )
                            }
                          >
                            Remove size
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className={labelClass}>Images</span>
                          <span className="text-xs text-slate-500">
                            {(size.imageKeys || []).length} image
                            {(size.imageKeys || []).length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {(size.imageKeys || []).map((key, keyIdx) => (
                            <ImageSlot
                              key={`${size.id ?? idx}-${key}-${keyIdx}`}
                              label={`Size image ${keyIdx + 1}`}
                              imageKey={key}
                              imageUrl={(size.images || [])[keyIdx]}
                              uploading={uploadingSlot === `size-${idx}-${keyIdx}`}
                              disabled={
                                saving ||
                                Boolean(
                                  uploadingSlot &&
                                    uploadingSlot !== `size-${idx}-${keyIdx}`
                                )
                              }
                              onUpload={(file) => handleSizeImageUpload(idx, keyIdx, file)}
                              onDelete={() => handleSizeImageDelete(idx, keyIdx)}
                            />
                          ))}
                          <ImageSlot
                            key={`add-${idx}-${(size.imageKeys || []).length}`}
                            label="Add image"
                            allowDelete={false}
                            uploading={uploadingSlot === `size-${idx}-new`}
                            disabled={
                              saving ||
                              Boolean(
                                uploadingSlot && uploadingSlot !== `size-${idx}-new`
                              )
                            }
                            onUpload={(file) => handleSizeImageUpload(idx, null, file)}
                            onDelete={() => undefined}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white pt-4">
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
                    {saving ? "Saving..." : "Save all changes"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function Card({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        highlight ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${highlight ? "text-amber-900" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}
