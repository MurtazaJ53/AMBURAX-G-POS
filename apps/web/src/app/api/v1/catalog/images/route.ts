import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import { catalogStorage } from "@/server/catalog/catalogStorage";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(req: NextRequest) {
  try {
    const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
    const resolved = await resolvePosContext(sessionToken);

    if (resolved.status === "unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    
    if (resolved.status === "no_store") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    if (!canManageCatalog(resolved.context.tenantRole)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ message: "Invalid file type. Only JPEG, PNG, and WebP are allowed." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ message: "File exceeds 5MB limit" }, { status: 400 });
    }

    const url = await catalogStorage.uploadImage(resolved.context.tenantId, file);

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Image upload error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
