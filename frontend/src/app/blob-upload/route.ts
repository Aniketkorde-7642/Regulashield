import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
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
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!process.env.BLOB_STORE_ID || !process.env.BLOB_WEBHOOK_PUBLIC_KEY) {
    return NextResponse.json(
      { error: "Evidence uploads require a private Blob store connected to this Vercel project." },
      { status: 503 },
    );
  }

  let body: HandleUploadPresignedBody;
  try {
    body = (await request.json()) as HandleUploadPresignedBody;
  } catch {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname, clientPayload) => {
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
            request.url,
          ),
          { headers: { Authorization: authorization }, cache: "no-store" },
        );
        if (!applicationResponse.ok) {
          throw new Error("You are not authorized to upload to this application.");
        }
        if (!applicationResponse.headers.get("content-type")?.includes("application/json")) {
          throw new Error("The application API returned an unexpected response. Please retry.");
        }
        const application = await applicationResponse.json() as {
          application: { status: string };
        };
        if (["approved", "rejected", "pending_admin_review"].includes(application.application.status)) {
          throw new Error("Documents cannot be added after submission for review.");
        }
        return {
          token: await issueSignedToken({
            storeId: process.env.BLOB_STORE_ID,
            pathname,
            operations: ["put"],
            validUntil: Date.now() + 10 * 60 * 1000,
            allowedContentTypes: ["application/pdf"],
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
          }),
        };
      },
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY,
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to authorize upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
