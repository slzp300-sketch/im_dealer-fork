import { NextRequest, NextResponse } from "next/server";
import { logAdminAction } from "@/lib/audit";
import { checkRateLimit, strictRateLimit } from "@/lib/rate-limit";
import { requireRoleAtLeast } from "@/lib/require-admin";
import {
  ADMIN_UPLOAD_ALLOWED_MIME,
  ADMIN_UPLOAD_CATEGORIES,
  ADMIN_UPLOAD_MAX_SIZE,
  uploadAdminFile,
  type AdminUploadCategory,
} from "@/lib/supabase/storage";

const CATEGORY_SET = new Set<string>(ADMIN_UPLOAD_CATEGORIES);

export async function POST(req: NextRequest) {
  const { admin, error: authError } = await requireRoleAtLeast("staff");
  if (authError) return authError;

  // 인증 뒤에 검사 — 비인증 폭주가 Redis 쿼터를 소모하지 않게 한다.
  // proxy 광역 게이트 제거 후 업로드의 유일한 rate limit 방어선.
  const limited = await checkRateLimit(req, strictRateLimit, "admin-upload");
  if (limited) return limited;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const categoryRaw = formData.get("category");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "파일이 첨부되지 않았습니다." },
        { status: 400 }
      );
    }

    const category =
      typeof categoryRaw === "string" && categoryRaw.length > 0
        ? categoryRaw
        : "vehicles";

    if (!CATEGORY_SET.has(category)) {
      return NextResponse.json(
        { error: "허용되지 않은 카테고리입니다." },
        { status: 400 }
      );
    }

    if (file.size > ADMIN_UPLOAD_MAX_SIZE) {
      return NextResponse.json(
        { error: "파일 크기는 5MB를 초과할 수 없습니다." },
        { status: 413 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "빈 파일은 업로드할 수 없습니다." },
        { status: 400 }
      );
    }

    const mime = file.type.toLowerCase();
    if (!ADMIN_UPLOAD_ALLOWED_MIME.has(mime)) {
      return NextResponse.json(
        { error: "이미지 파일(jpg, png, webp, gif)만 업로드할 수 있습니다." },
        { status: 415 }
      );
    }

    const { url } = await uploadAdminFile({
      category: category as AdminUploadCategory,
      file,
      contentType: mime,
    });

    await logAdminAction({
      request: req,
      actor: admin,
      action: "FILE_UPLOAD",
      resource: "AdminStorage",
      meta: { category, contentType: mime, size: file.size, url },
    });

    return NextResponse.json({ url });
  } catch (error) {
    console.error("[POST /api/admin/upload]", error);
    return NextResponse.json(
      { error: "업로드 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
