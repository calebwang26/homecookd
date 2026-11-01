// The `private` bucket, behind an interface so tests never touch AWS. Phones upload to S3 with a short-lived link and download with
// another: bytes don't pass through a request (SYSTEM-DESIGN.md). The api reads a file itself only to hand it to a model.
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type PresignedPut = { url: string; headers: Record<string, string>; expiresInS: number };

export interface ObjectStore {
  /** A link that accepts exactly this type and this many bytes, for a few minutes. */
  presignPut(key: string, contentType: string, size: number): Promise<PresignedPut>;
  presignGet(key: string): Promise<string>;
  /** Null when there's no such object. Throws when S3 can't say. */
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  read(key: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null>;
  /** Deleting what's already gone is fine. */
  remove(key: string): Promise<void>;
}

export const UPLOAD_LINK_S = 15 * 60;
/**
 * A read link is signed for the current hour and lasts two, so it's good for at least an hour and stays the same for an hour:
 * Mom's page polls every 2 seconds, and a new URL each time would restart the audio she's playing.
 */
export const READ_LINK_S = 2 * 60 * 60;
const READ_WINDOW_MS = 60 * 60_000;

export const readWindowStart = (now: number) => new Date(Math.floor(now / READ_WINDOW_MS) * READ_WINDOW_MS);

type S3Send = Pick<S3Client, "send">;

export function s3Store(options: { bucket: string; client?: S3Client; now?: () => number }): ObjectStore {
  const client =
    options.client ??
    new S3Client({
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 2_000, requestTimeout: 15_000 },
      // Without this the SDK adds checksum fields to a presigned PUT, which a browser's plain PUT then fails.
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  const send: S3Send["send"] = client.send.bind(client);
  const Bucket = options.bucket;
  const now = options.now ?? Date.now;
  const missing = (error: unknown) => {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
  };
  return {
    async presignPut(key, contentType, size) {
      const command = new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: size });
      const url = await getSignedUrl(client, command, {
        expiresIn: UPLOAD_LINK_S,
        // Signed, so S3 itself refuses another type or size.
        signableHeaders: new Set(["content-type", "content-length"]),
      });
      return { url, headers: { "Content-Type": contentType }, expiresInS: UPLOAD_LINK_S };
    },
    presignGet(key) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), {
        expiresIn: READ_LINK_S,
        signingDate: readWindowStart(now()),
      });
    },
    async head(key) {
      try {
        const out = await send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? null };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async read(key) {
      try {
        const out = await send(new GetObjectCommand({ Bucket, Key: key }));
        if (!out.Body) return null;
        return { bytes: await out.Body.transformToByteArray(), contentType: out.ContentType ?? null };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async remove(key) {
      await send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

let store: ObjectStore | undefined;

export function objectStore(): ObjectStore {
  if (!store) {
    const bucket = process.env.PRIVATE_BUCKET?.trim();
    if (!bucket) throw new Error("PRIVATE_BUCKET isn't set");
    store = s3Store({ bucket });
  }
  return store;
}

/** For tests. */
export function useObjectStore(next: ObjectStore | undefined): void {
  store = next;
}
