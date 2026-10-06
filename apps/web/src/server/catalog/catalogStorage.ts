import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Minimal storage abstraction for product images.
 * 
 * In production, this would use S3, Cloudflare R2, or Vercel Blob.
 * For this MVP/local development, it uses the local filesystem under public/uploads/.
 */

export interface StorageAdapter {
  uploadImage(tenantId: string, file: File): Promise<string>;
  deleteImage(tenantId: string, url: string): Promise<void>;
}

export class LocalFsStorageAdapter implements StorageAdapter {
  private readonly basePath = path.join(process.cwd(), "public", "uploads");

  async uploadImage(tenantId: string, file: File): Promise<string> {
    const ext = path.extname(file.name) || ".jpg";
    const filename = `${crypto.randomUUID()}${ext}`;
    
    // Ensure tenant directory exists
    const tenantDir = path.join(this.basePath, tenantId);
    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }

    const filePath = path.join(tenantDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    
    fs.writeFileSync(filePath, buffer);
    
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
