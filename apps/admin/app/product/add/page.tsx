"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../lib/api";
import { useAuthStore } from "../../../lib/store/authStore";

const PRODUCT_ADD_DRAFT_KEY = "admin-product-add-draft";

type ProductFormState = {
  name: string;
  shortDescription: string;
  fullDescription: string;
  taxInfo: string;
  mrp: string;
  categoryId: string;
  subcategoryId: string;
  newCategory: string;
  newSubcategory: string;
  brandId: string;
};

type SavedSize = {
  dimension: string;
  label: string;
  price: string;
  stock: string;
  imageKeys: string[];
  imageFileCount: number;
};

type ProductAddDraft = {
  form: ProductFormState;
  selectedTags: string[];
  newTagInput: string;
  tags: string[];
  specifications: { key: string; value: string }[];
  sizes: SavedSize[];
  savedAt: string;
};

const INITIAL_FORM: ProductFormState = {
  name: "",
  shortDescription: "",
  fullDescription: "",
  taxInfo: "",
  mrp: "",
  categoryId: "",
  subcategoryId: "",
  newCategory: "",
  newSubcategory: "",
  brandId: "",
};

type Option = { id: number; name: string; slug?: string };
type ProductSize = {
  dimension: string;
  label: string;
  price: string;
  stock: string;
  imageKeys: string[];
  imageFiles: (File | null)[];
};
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

const initialSize = (): ProductSize => ({
  dimension: "",
  label: "",
  price: "",
  stock: "0",
  imageKeys: [""],
  imageFiles: [null],
});

function serializeSizes(sizes: ProductSize[]): SavedSize[] {
  return sizes.map(({ dimension, label, price, stock, imageKeys, imageFiles }) => ({
    dimension,
    label,
    price,
    stock,
    imageKeys,
    imageFileCount: Math.max(imageFiles?.length ?? 1, 1),
  }));
}

function deserializeSizes(saved: SavedSize[]): ProductSize[] {
  if (!saved.length) return [initialSize()];
  return saved.map((size) => ({
    dimension: size.dimension ?? "",
    label: size.label ?? "",
    price: size.price ?? "",
    stock: size.stock ?? "0",
    imageKeys: size.imageKeys?.length ? size.imageKeys : [""],
    imageFiles: Array.from({ length: Math.max(size.imageFileCount ?? 1, 1) }, () => null),
  }));
}

function clearProductDraft() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(PRODUCT_ADD_DRAFT_KEY);
  }
}

function ImageDropzone({
  file,
  onFileChange,
  title = "Drop image here or click to browse",
  hint = "PNG, JPG, or WEBP",
  compact = false,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  title?: string;
  hint?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const acceptFile = (files: FileList | null) => {
    const selected = files?.[0];
    if (selected?.type.startsWith("image/")) {
      onFileChange(selected);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 border-dashed transition-colors ${
        dragging
          ? "border-emerald-500 bg-emerald-50"
          : file
            ? "border-emerald-300 bg-white"
            : "border-slate-300 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50/40"
      } ${compact ? "p-3" : "p-6"}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => acceptFile(e.target.files)}
      />

      {preview ? (
        <div className={`flex ${compact ? "items-center gap-3" : "flex-col items-center gap-3"}`}>
          <div
            className={`relative shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white ${
              compact ? "h-16 w-16" : "h-40 w-full max-w-xs"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Preview" className="h-full w-full object-cover" />
          </div>
          <div className={`min-w-0 ${compact ? "flex-1" : "text-center"}`}>
            <p className="truncate text-sm font-medium text-slate-800">{file?.name}</p>
            <p className="text-xs text-slate-500">
              {file ? `${(file.size / 1024).toFixed(0)} KB` : ""}
            </p>
            <div className={`mt-2 flex flex-wrap gap-2 ${compact ? "" : "justify-center"}`}>
              <button
                type="button"
                className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50"
                onClick={() => inputRef.current?.click()}
              >
                Replace
              </button>
              <button
                type="button"
                className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-50"
                onClick={() => {
                  onFileChange(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`flex w-full flex-col items-center justify-center text-center ${
            compact ? "gap-1 py-2" : "gap-2 py-4"
          }`}
          onClick={() => inputRef.current?.click()}
        >
          <div
            className={`flex items-center justify-center rounded-full bg-white text-emerald-600 shadow-sm ring-1 ring-slate-200 ${
              compact ? "h-9 w-9" : "h-12 w-12"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={compact ? "h-4 w-4" : "h-6 w-6"}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className={`font-medium text-slate-700 ${compact ? "text-xs" : "text-sm"}`}>
            {title}
          </p>
          <p className="text-xs text-slate-500">{hint}</p>
        </button>
      )}
    </div>
  );
}

export default function AddProductPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const [categories, setCategories] = useState<Option[]>([]);
  const [subcategories, setSubcategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [specifications, setSpecifications] = useState<{ key: string; value: string }[]>([
    { key: "", value: "" },
  ]);
  const [sizes, setSizes] = useState<ProductSize[]>([initialSize()]);
  const [mainImageFile, setMainImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftNotice, setDraftNotice] = useState("");
  const [isDraftReady, setIsDraftReady] = useState(false);
  const [requestedProducts, setRequestedProducts] = useState<RequestedProduct[]>([]);
  const [form, setForm] = useState<ProductFormState>(INITIAL_FORM);

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      const raw = localStorage.getItem(PRODUCT_ADD_DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as ProductAddDraft;
        if (draft.form) setForm(draft.form);
        if (draft.selectedTags) setSelectedTags(draft.selectedTags);
        if (draft.newTagInput) setNewTagInput(draft.newTagInput);
        if (draft.specifications?.length) setSpecifications(draft.specifications);
        if (draft.sizes?.length) setSizes(deserializeSizes(draft.sizes));
        if (draft.tags?.length) setTags(draft.tags);
        if (draft.savedAt) {
          setDraftNotice(
            `Draft restored from ${new Date(draft.savedAt).toLocaleString()}. Re-select image files before submitting.`
          );
        }
      }
    } catch (err) {
      console.warn("Failed to restore product draft:", err);
    } finally {
      setIsDraftReady(true);
    }

    apiFetch("/categories").then((r) => r.json()).then(setCategories).catch(() => {});
    apiFetch("/brands").then((r) => r.json()).then(setBrands).catch(() => {});
    apiFetch("/tags")
      .then((r) => r.json())
      .then((fetched: string[]) => {
        setTags((prev) => Array.from(new Set([...(fetched ?? []), ...prev])));
      })
      .catch(() => {});
    apiFetch("/requested-products?status=pending")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRequestedProducts)
      .catch(() => setRequestedProducts([]));
  }, [token, router]);

  useEffect(() => {
    if (!token || !isDraftReady) return;

    const timeout = window.setTimeout(() => {
      const hasContent =
        Object.values(form).some((value) => value.trim()) ||
        selectedTags.length > 0 ||
        specifications.some((spec) => spec.key || spec.value) ||
        sizes.some(
          (size) =>
            size.dimension ||
            size.label ||
            size.price ||
            (size.stock && size.stock !== "0")
        );

      if (!hasContent) {
        clearProductDraft();
        return;
      }

      const draft: ProductAddDraft = {
        form,
        selectedTags,
        newTagInput,
        tags,
        specifications,
        sizes: serializeSizes(sizes),
        savedAt: new Date().toISOString(),
      };

      try {
        localStorage.setItem(PRODUCT_ADD_DRAFT_KEY, JSON.stringify(draft));
      } catch (err) {
        console.warn("Failed to save product draft:", err);
      }
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [
    token,
    isDraftReady,
    form,
    selectedTags,
    newTagInput,
    tags,
    specifications,
    sizes,
  ]);

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
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
      },
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.imageKey;
  };

  const handleSizeChange = (index: number, field: keyof ProductSize, value: string) => {
    setSizes((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const handleSizeImageFileChange = (
    sizeIndex: number,
    imgIndex: number,
    file: File | null
  ) => {
    setSizes((prev) => {
      const next = [...prev];
      const size = next[sizeIndex];
      if (!size) return prev;
      const imageFiles = [...(size.imageFiles || [null])];
      const imageKeys = [...(size.imageKeys || [""])];
      while (imageFiles.length <= imgIndex) imageFiles.push(null);
      while (imageKeys.length <= imgIndex) imageKeys.push("");
      imageFiles[imgIndex] = file;
      next[sizeIndex] = { ...size, imageFiles, imageKeys };
      return next;
    });
  };

  const addSizeImageField = (sizeIndex: number) => {
    setSizes((prev) =>
      prev.map((s, i) =>
        i === sizeIndex
          ? {
              ...s,
              imageFiles: [...(s.imageFiles || [null]), null],
              imageKeys: [...(s.imageKeys || [""]), ""],
            }
          : s
      )
    );
  };

  const removeSizeImageField = (sizeIndex: number, imgIndex: number) => {
    setSizes((prev) =>
      prev.map((s, i) => {
        if (i !== sizeIndex || (s.imageFiles?.length || 1) <= 1) return s;
        const imageFiles = [...(s.imageFiles || [])];
        const imageKeys = [...(s.imageKeys || [])];
        imageFiles.splice(imgIndex, 1);
        imageKeys.splice(imgIndex, 1);
        return { ...s, imageFiles, imageKeys };
      })
    );
  };

  const addSize = () => setSizes((prev) => [...prev, initialSize()]);

  const removeSize = (index: number) => {
    if (sizes.length <= 1) return;
    setSizes((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSpecChange = (index: number, field: "key" | "value", text: string) => {
    setSpecifications((prev) =>
      prev.map((spec, i) => (i === index ? { ...spec, [field]: text } : spec))
    );
  };

  const addSpecField = () =>
    setSpecifications((prev) => [...prev, { key: "", value: "" }]);

  const removeSpecField = (index: number) => {
    if (specifications.length <= 1) return;
    setSpecifications((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    const tag = newTagInput.trim().toLowerCase();
    if (!tag) return;
    if (!tags.includes(tag)) setTags((prev) => [...prev, tag]);
    if (!selectedTags.includes(tag)) setSelectedTags((prev) => [...prev, tag]);
    setNewTagInput("");
  };

  const generateSlug = (name: string): string =>
    name
      .toLowerCase()
      .replace(/[^\w\s]/gi, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .substring(0, 60);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = "Product name is required";
    if (!form.shortDescription.trim())
      newErrors.shortDescription = "Short description is required";
    if (!form.categoryId && !form.newCategory.trim()) {
      newErrors.category = "Select a category or create a new one";
    }
    sizes.forEach((size, index) => {
      if (!size.label.trim())
        newErrors[`size-${index}-label`] = "Label is required";
      if (!size.price || Number(size.price) <= 0)
        newErrors[`size-${index}-price`] = "Valid price is required";
      if (Number(size.stock) < 0)
        newErrors[`size-${index}-stock`] = "Stock cannot be negative";
    });
    return newErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage("");
    setErrors({});

    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setSubmitting(false);
      return;
    }

    try {
      let imageKey = "";
      if (mainImageFile) {
        imageKey = await uploadImage(mainImageFile);
      }

      const sizesWithImageKeys = await Promise.all(
        sizes.map(async (size) => {
          const imageKeys: string[] = [];
          if (size.imageFiles?.length) {
            for (const file of size.imageFiles) {
              if (file) {
                imageKeys.push(await uploadImage(file));
              }
            }
          }
          return {
            label: size.label,
            price: Number(size.price),
            stock: Number(size.stock || 0),
            imageKeys: imageKeys.filter(Boolean),
          };
        })
      );

      const specificationsString = specifications
        .filter((spec) => spec.key && spec.value)
        .map((spec) => `${spec.key}: ${spec.value}`)
        .join(" | ");

      const validCategoryId =
        form.categoryId && form.categoryId !== "0"
          ? Number(form.categoryId)
          : null;

      const payload = {
        name: form.name,
        slug: generateSlug(form.name),
        description: form.shortDescription,
        shortDescription: form.shortDescription,
        fullDescription: form.fullDescription,
        specifications: specificationsString,
        taxInfo: form.taxInfo,
        price: Math.min(...sizes.map((s) => Number(s.price || 0))),
        mrp: Number(form.mrp || 0),
        currency: "INR",
        imageKey,
        status: "active",
        featured: false,
        tags: selectedTags,
        stock: sizes.reduce((sum, s) => sum + Number(s.stock || 0), 0),
        categoryId: validCategoryId || 0,
        subcategoryId: form.subcategoryId ? Number(form.subcategoryId) : null,
        brandId: form.brandId ? Number(form.brandId) : null,
        newCategory: form.newCategory.trim(),
        newSubcategory: form.newSubcategory.trim(),
        sizes: sizesWithImageKeys,
      };

      const res = await apiFetch("/products", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());

      clearProductDraft();
      setMessage("Product created successfully.");
      setDraftNotice("");
      setForm(INITIAL_FORM);
      setSelectedTags([]);
      setNewTagInput("");
      setSpecifications([{ key: "", value: "" }]);
      setSizes([initialSize()]);
      setMainImageFile(null);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create product.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none";
  const selectClass =
    "rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none w-full";
  const sectionClass = "space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4";
  const addBtnClass =
    "rounded-md bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100";
  const removeBtnClass =
    "rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100 disabled:opacity-50";

  const handleClearDraft = () => {
    clearProductDraft();
    setForm(INITIAL_FORM);
    setSelectedTags([]);
    setNewTagInput("");
    setSpecifications([{ key: "", value: "" }]);
    setSizes([initialSize()]);
    setMainImageFile(null);
    setErrors({});
    setDraftNotice("Draft cleared.");
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Add a product with pricing, inventory, images, and category metadata.
            </p>
            <button
              type="button"
              onClick={handleClearDraft}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              Clear draft
            </button>
          </div>
          {draftNotice && (
            <p className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              {draftNotice}
            </p>
          )}
          {message && (
            <p
              className={`mb-4 rounded-md border px-3 py-2 text-sm ${
                message.includes("success")
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {message}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <input
                  className={`${inputClass} ${errors.name ? "border-red-400 bg-red-50" : ""}`}
                  placeholder="Product name *"
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                  required
                />
                {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
              </div>
              <input
                className={inputClass}
                type="number"
                step="0.01"
                placeholder="MRP (original price)"
                value={form.mrp}
                onChange={(e) => setForm((s) => ({ ...s, mrp: e.target.value }))}
              />
            </div>

            <textarea
              className={`${inputClass} ${errors.shortDescription ? "border-red-400 bg-red-50" : ""}`}
              placeholder="Short description *"
              value={form.shortDescription}
              onChange={(e) => setForm((s) => ({ ...s, shortDescription: e.target.value }))}
              required
            />
            {errors.shortDescription && (
              <p className="text-sm text-red-600">{errors.shortDescription}</p>
            )}

            <textarea
              className={inputClass}
              placeholder="Full description"
              value={form.fullDescription}
              onChange={(e) => setForm((s) => ({ ...s, fullDescription: e.target.value }))}
            />

            <input
              className={inputClass}
              placeholder="Tax info (e.g., GST 5%)"
              value={form.taxInfo}
              onChange={(e) => setForm((s) => ({ ...s, taxInfo: e.target.value }))}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-sm font-medium text-slate-700">Category *</p>
                <select
                  className={`${selectClass} ${errors.category ? "border-red-400" : ""}`}
                  value={form.categoryId}
                  onChange={(e) =>
                    setForm((s) => ({
                      ...s,
                      categoryId: e.target.value,
                      subcategoryId: "",
                    }))
                  }
                >
                  <option value="">Select existing category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  className={`${inputClass} mt-2 ${errors.category ? "border-red-400 bg-red-50" : ""}`}
                  placeholder="Or create new category"
                  value={form.newCategory}
                  onChange={(e) => setForm((s) => ({ ...s, newCategory: e.target.value }))}
                />
                {errors.category && (
                  <p className="mt-1 text-sm text-red-600">{errors.category}</p>
                )}
              </div>

              <div>
                <p className="mb-1 text-sm font-medium text-slate-700">Subcategory</p>
                <select
                  className={selectClass}
                  value={form.subcategoryId}
                  onChange={(e) => setForm((s) => ({ ...s, subcategoryId: e.target.value }))}
                  disabled={!form.categoryId && !form.newCategory.trim()}
                >
                  <option value="">Select existing subcategory</option>
                  {subcategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  className={`${inputClass} mt-2 ${!form.categoryId && !form.newCategory.trim() ? "bg-slate-100" : ""}`}
                  placeholder="Or create new subcategory"
                  value={form.newSubcategory}
                  onChange={(e) => setForm((s) => ({ ...s, newSubcategory: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Brand</p>
              <select
                className={selectClass}
                value={form.brandId}
                onChange={(e) => setForm((s) => ({ ...s, brandId: e.target.value }))}
              >
                <option value="">Brand</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">
                Main product image (optional)
              </p>
              <ImageDropzone
                file={mainImageFile}
                onFileChange={setMainImageFile}
                title="Drop main product image here or click to browse"
                hint="Recommended: square image, PNG or JPG"
              />
            </div>

            <div className={sectionClass}>
              <p className="font-medium text-slate-800">Sizes *</p>
              {sizes.map((size, sizeIndex) => (
                <div
                  key={sizeIndex}
                  className="mt-3 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <input
                        className={inputClass}
                        placeholder="Dimension (e.g., S, M, L)"
                        value={size.dimension}
                        onChange={(e) =>
                          handleSizeChange(sizeIndex, "dimension", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <input
                        className={`${inputClass} ${errors[`size-${sizeIndex}-label`] ? "border-red-400 bg-red-50" : ""}`}
                        placeholder="Label *"
                        value={size.label}
                        onChange={(e) => handleSizeChange(sizeIndex, "label", e.target.value)}
                        required
                      />
                      {errors[`size-${sizeIndex}-label`] && (
                        <p className="mt-1 text-sm text-red-600">
                          {errors[`size-${sizeIndex}-label`]}
                        </p>
                      )}
                    </div>
                    <div>
                      <input
                        className={`${inputClass} ${errors[`size-${sizeIndex}-price`] ? "border-red-400 bg-red-50" : ""}`}
                        type="number"
                        step="0.01"
                        placeholder="Price *"
                        value={size.price}
                        onChange={(e) => handleSizeChange(sizeIndex, "price", e.target.value)}
                        required
                      />
                      {errors[`size-${sizeIndex}-price`] && (
                        <p className="mt-1 text-sm text-red-600">
                          {errors[`size-${sizeIndex}-price`]}
                        </p>
                      )}
                    </div>
                    <div>
                      <input
                        className={inputClass}
                        type="number"
                        placeholder="Stock"
                        value={size.stock}
                        onChange={(e) => handleSizeChange(sizeIndex, "stock", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="mb-2 text-sm font-medium text-slate-700">
                      Images for this size (optional)
                    </p>
                    {(size.imageFiles || [null]).map((file, imgIndex) => (
                      <div key={imgIndex} className="mb-3 flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <ImageDropzone
                            compact
                            file={file}
                            onFileChange={(selected) =>
                              handleSizeImageFileChange(sizeIndex, imgIndex, selected)
                            }
                            title="Drop size image or click to browse"
                            hint="Optional product photo for this size"
                          />
                        </div>
                        <button
                          type="button"
                          className={`${removeBtnClass} shrink-0`}
                          onClick={() => removeSizeImageField(sizeIndex, imgIndex)}
                          disabled={(size.imageFiles?.length || 1) <= 1}
                        >
                          Remove slot
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className={addBtnClass}
                      onClick={() => addSizeImageField(sizeIndex)}
                    >
                      + Add Another Image
                    </button>
                  </div>

                  <button
                    type="button"
                    className={`${removeBtnClass} mt-3`}
                    onClick={() => removeSize(sizeIndex)}
                    disabled={sizes.length <= 1}
                  >
                    Remove Size
                  </button>
                </div>
              ))}
              <button type="button" className={`${addBtnClass} mt-2`} onClick={addSize}>
                + Add Another Size
              </button>
            </div>

            <div className={sectionClass}>
              <p className="font-medium text-slate-800">Specifications</p>
              {specifications.map((spec, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 md:grid-cols-5">
                  <input
                    className={`${inputClass} md:col-span-2`}
                    placeholder="Key (e.g., Height)"
                    value={spec.key}
                    onChange={(e) => handleSpecChange(index, "key", e.target.value)}
                  />
                  <input
                    className={`${inputClass} md:col-span-2`}
                    placeholder="Value (e.g., 30cm)"
                    value={spec.value}
                    onChange={(e) => handleSpecChange(index, "value", e.target.value)}
                  />
                  <button
                    type="button"
                    className={removeBtnClass}
                    onClick={() => removeSpecField(index)}
                    disabled={specifications.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className={addBtnClass} onClick={addSpecField}>
                + Add Specification
              </button>
            </div>

            <div className={sectionClass}>
              <p className="font-medium text-slate-800">Tags</p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full border px-3 py-1 text-sm transition ${
                      selectedTags.includes(tag)
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  className={inputClass}
                  placeholder="Add new tag"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomTag();
                    }
                  }}
                />
                <button type="button" className={addBtnClass} onClick={addCustomTag}>
                  Add Tag
                </button>
              </div>
              {selectedTags.length > 0 && (
                <p className="mt-2 text-sm text-slate-600">
                  Selected: {selectedTags.join(", ")}
                </p>
              )}
            </div>

            <button
              disabled={submitting}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
              type="submit"
            >
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
