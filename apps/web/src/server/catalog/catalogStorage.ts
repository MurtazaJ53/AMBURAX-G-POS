import fs from "fs";
import path from "path";
import crypto from "crypto";
import { detectImageFormat, IMAGE_FORMATS, type ImageFormat } from "./imageFormat";

/**
 * Minimal storage abstraction for product images.
 * 
 * In production, this would use S3, Cloudflare R2, or Vercel Blob.
 * For this MVP/local development, it uses the local filesystem under public/uploads/.
 */

export interface StorageAdapter {
  uploadImage(tenantId: string, bytes: Uint8Array, format: ImageFormat): Promise<string>;
  deleteImage(tenantId: string, url: string): Promise<void>;
}

export class UnverifiedImageError extends Error {
  constructor() {
    super("Image bytes do not match the declared format");
    this.name = "UnverifiedImageError";
  }
}

export class LocalFsStorageAdapter implements StorageAdapter {
  private readonly basePath = path.join(process.cwd(), "public", "uploads");

  /**
   * Stores bytes already identified as `format`. The bytes are checked again here, so no caller can
   * store unverified content, and the extension comes only from the verified format — never from a
   * client filename.
   */
  async uploadImage(tenantId: string, bytes: Uint8Array, format: ImageFormat): Promise<string> {
    if (detectImageFormat(bytes) !== format) throw new UnverifiedImageError();
    const ext = IMAGE_FORMATS[format].ext;
    const filename = `${crypto.randomUUID()}${ext}`;
    
    // Ensure tenant directory exists
    const tenantDir = path.join(this.basePath, tenantId);
    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }

    const filePath = path.join(tenantDir, filename);

    fs.writeFileSync(filePath, bytes);
    
    return `/uploads/${tenantId}/${filename}`;
  }

  async deleteImage(tenantId: string, url: string): Promise<void> {
    if (!url.startsWith(`/uploads/${tenantId}/`)) {
      // Don't delete URLs that belong to other tenants or external URLs
      return;
    }

    const filename = path.basename(url);
    const filePath = path.join(this.basePath, tenantId, filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

export const catalogStorage = new LocalFsStorageAdapter();
