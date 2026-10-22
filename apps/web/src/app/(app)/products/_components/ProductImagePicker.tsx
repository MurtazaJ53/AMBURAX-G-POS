"use client";

import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { UploadCloud, Camera, X, Image as ImageIcon, Loader2, Star } from "lucide-react";

interface ProductImagePickerProps {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}

/**
 * Resizes an image file to a maximum dimension (default 1600px) and converts to WebP/JPEG blob.
 */
async function resizeImage(file: File, maxDim = 1600, quality = 0.82): Promise<{ blob: Blob; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context failed"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Try webp first, fallback to jpeg
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve({ blob, mimeType: blob.type || "image/webp" });
            } else {
              canvas.toBlob(
                (jpegBlob) => {
                  if (jpegBlob) {
                    resolve({ blob: jpegBlob, mimeType: "image/jpeg" });
                  } else {
                    reject(new Error("Image encoding failed"));
                  }
                },
                "image/jpeg",
                quality
              );
            }
          },
          "image/webp",
          quality
        );
      };
      img.onerror = () => reject(new Error("Invalid image file"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function ProductImagePicker({ value, onChange, disabled }: ProductImagePickerProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  async function handleFileProcess(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file (JPEG, PNG, or WebP).");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // 1. Client-side canvas resize (< 1600px, WebP/JPEG ~82% quality)
      const { blob, mimeType } = await resizeImage(file, 1600, 0.82);

      // 2. Prepare upload
      const ext = mimeType === "image/webp" ? ".webp" : mimeType === "image/png" ? ".png" : ".jpg";
      const optimizedFile = new File([blob], `upload_${Date.now()}${ext}`, { type: mimeType });

      const formData = new FormData();
      formData.append("file", optimizedFile);

      // 3. Upload to server
      const res = await fetch("/api/v1/catalog/images", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error?.message || "Failed to upload image.");
      }

      onChange(data.url);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  }

  function onFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      void handleFileProcess(file);
    }
    e.target.value = "";
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileProcess(file);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-xs font-semibold text-slate-700">Product Image (Optional)</label>
          <span className="text-[11px] text-slate-400">Not mandatory — you can add or update images anytime</span>
        </div>
        <button
          type="button"
          onClick={() => setShowUrlInput(!showUrlInput)}
          className="text-[11px] font-medium text-primary hover:underline"
        >
          {showUrlInput ? "Use File Upload" : "or paste URL"}
        </button>
      </div>

      {showUrlInput ? (
        <input
          type="url"
          value={value || ""}
          onChange={(e) => onChange(e.target.value.trim() || null)}
          placeholder="https://example.com/product.jpg"
          disabled={disabled}
          className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      ) : value ? (
        // Preview Card
        <div className="relative group w-36 h-36 rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden shadow-xs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Product Cover" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => onChange(null)}
              className="p-1.5 rounded-full bg-white/90 text-red-600 hover:bg-white shadow-xs"
              title="Remove image"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="absolute bottom-1.5 left-1.5 bg-black/60 backdrop-blur-xs text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1">
            <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" /> Cover
          </div>
        </div>
      ) : (
        // Upload Dropzone
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed p-5 text-center transition-all ${
            isDragging
              ? "border-primary bg-sky-50/60"
              : "border-slate-200 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-300"
          }`}
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-2 py-3 text-slate-500">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="text-xs font-medium">Optimizing & Uploading...</p>
            </div>
          ) : (
            <>
              <div className="rounded-full bg-sky-100/70 p-2.5 text-primary">
                <UploadCloud className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-800">
                  Drag and drop a photo here, or{" "}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-primary hover:underline font-bold"
                  >
                    browse files
                  </button>
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">JPEG, PNG, WebP up to 5MB (auto-resized)</p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                >
                  <ImageIcon className="h-3.5 w-3.5 text-slate-500" />
                  Gallery
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                >
                  <Camera className="h-3.5 w-3.5 text-slate-500" />
                  Take Photo
                </button>
              </div>
            </>
          )}

          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFileInputChange}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFileInputChange}
            className="hidden"
          />
        </div>
      )}

      {error && <p className="text-[11px] font-medium text-red-500">{error}</p>}
    </div>
  );
}
