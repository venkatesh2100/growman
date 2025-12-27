"use client";

import { useState } from "react";

export default function ImageUpload() {
  const [mainImageFile, setMainImageFile] = useState<File | null>(null);
  const [mainImageKey, setMainImageKey] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const uploadImage = async (
    file: File,
    prefix: string = ""
  ): Promise<{ imageKey: string; imageUrl: string }> => {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("prefix", prefix);

    const apiUrl =
      process.env.NEXT_PUBLIC_GO_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8080/api/v1";

    const res = await fetch(`${apiUrl}/images/upload`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Image upload failed");
    }

    return res.json();
  };

  const handleUpload = async () => {
    if (!mainImageFile) {
      setError("Please select an image first");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const { imageKey, imageUrl } = await uploadImage(
        mainImageFile,
        "products"
      );

      setMainImageKey(imageKey);
      setImageUrl(imageUrl);

      // 👉 This imageKey is what you store in DB with the product
      console.log("Uploaded imageKey:", imageKey);
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 w-full max-w-md mx-auto">
      <label className="font-medium">Main Product Image</label>

      <input
        type="file"
        accept="image/*"
        onChange={(e) =>
          setMainImageFile(e.target.files?.[0] || null)
        }
      />

      {mainImageFile && (
        <p className="text-sm text-gray-600">
          Selected: {mainImageFile.name}
        </p>
      )}

      <button
        onClick={handleUpload}
        disabled={loading}
        className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
      >
        {loading ? "Uploading..." : "Upload"}
      </button>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {imageUrl && (
        <div className="mt-3">
          <p className="text-sm font-medium">Preview</p>
          <img
            src={imageUrl}
            alt="Uploaded"
            className="mt-2 rounded max-h-64 object-contain"
          />
        </div>
      )}

      {mainImageKey && (
        <p className="text-xs text-gray-500 break-all">
          Stored key: {mainImageKey}
        </p>
      )}
    </div>
  );
}
