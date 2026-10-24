import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
const DOCUMENT_TYPES = new Set([
  "affiliation_letter",
  "faculty_certificate",
  "land_record",
  "fire_safety",
  "other",
]);
const API_ORIGIN = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Evidence uploads are not configured. Set BLOB_READ_WRITE_TOKEN in the Vercel project." },
      { status: 503 },
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload: { applicationId?: string; documentType?: string };
        try {
          payload = JSON.parse(clientPayload ?? "") as typeof payload;
        } catch {
          throw new Error("Invalid upload metadata.");
        }
        if (
          !payload.applicationId
          || !UUID_PATTERN.test(payload.applicationId)
          || !payload.documentType
          || !DOCUMENT_TYPES.has(payload.documentType)
          || !pathname.startsWith(`evidence/${payload.applicationId}/`)
          || !/^evidence\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(pathname)
        ) {
          throw new Error("Invalid upload path or metadata.");
        }
        const applicationResponse = await fetch(
          new URL(
            `/api/applications/${encodeURIComponent(payload.applicationId)}/review`,
            API_ORIGIN ?? request.url,
          ),
          { headers: { Authorization: authorization }, cache: "no-store" },
        );
        if (!applicationResponse.ok) {
          throw new Error("You are not authorized to upload to this application.");
        }
        const application = await applicationResponse.json() as {
          application: { status: string };
        };
        if (["approved", "rejected", "pending_admin_review"].includes(application.application.status)) {
          throw new Error("Documents cannot be added after submission for review.");
        }
        return {
          addRandomSuffix: false,
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to authorize upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
