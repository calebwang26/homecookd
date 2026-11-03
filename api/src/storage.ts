// The `private` bucket, behind an interface so tests never touch AWS. Phones upload to S3 with a short-lived link and download with
// another: bytes don't pass through a request (SYSTEM-DESIGN.md). The api reads a file itself only to hand it to a model.
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type PresignedPut = { url: string; headers: Record<string, string>; expiresInS: number };

export interface ObjectStore {
  /** A link that accepts exactly this type and this many bytes, for a few minutes. */
  presignPut(key: string, contentType: string, size: number): Promise<PresignedPut>;
  presignGet(key: string): Promise<string>;
  /** A file too big for one PUT, in parts. Returns S3's id for the upload. An unfinished one holds bytes nobody can list: the bucket's lifecycle rule aborts it after 7 days. */
  startParts(key: string, contentType: string): Promise<string>;
  /** A link that accepts exactly this many bytes as this part. */
  presignPart(key: string, multipartId: string, partNumber: number, size: number): Promise<PresignedPut>;
  finishParts(key: string, multipartId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  /** Null when there's no such object. Throws when S3 can't say. `modified` is S3's own time for when the upload landed. */
  head(key: string): Promise<{ size: number; contentType: string | null; modified?: Date | null } | null>;
  read(key: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null>;
  /** Deleting what's already gone is fine. */
  remove(key: string): Promise<void>;
  /** Up to `max` keys under a prefix. The outside purge asks for one more than it will delete, to see a folder that's too big. */
  list(prefix: string, max: number): Promise<string[]>;
  /** Throws if S3 refused any of them, without naming them: a key can hold a slug of what a cook typed. */
  removeMany(keys: string[]): Promise<void>;
  /**
   * A small file the api makes itself, in one request. Only staging's test recipe does (recipes/testRecipe.ts): a family's own files never pass through here.
   * `version` is S3's id for this copy in a versioned bucket, the worker's `?v=` (pipeline/queue_aws.py).
   */
  write(key: string, bytes: Uint8Array, contentType: string, cacheControl?: string): Promise<{ version: string | null }>;
}

/**
 * Long enough to start an upload right after asking for the link: S3 checks a link when a request starts, so a slow upload isn't cut off. A link can be
 * used again until it expires, even to put back a file just deleted (DISH-MIGRATION.md, known limits), so it's as short as it can be.
 */
export const UPLOAD_LINK_S = 2 * 60;
/**
 * A read link is signed for the current hour and lasts two, so it's good for at least an hour and stays the same for an hour:
 * Mom's page polls every 2 seconds, and a new URL each time would restart the audio she's playing.
 */
export const READ_LINK_S = 2 * 60 * 60;
const READ_WINDOW_MS = 60 * 60_000;

export const readWindowStart = (now: number) => new Date(Math.floor(now / READ_WINDOW_MS) * READ_WINDOW_MS);

/**
 * A video's link. A phone hands it to iOS's background uploader, which may start the PUT long after asking, so two minutes can't work. S3 refuses a link once
 * the credentials that signed it expire, whatever it was asked for, so this is an upper bound on a task role and the phone asks again when one is refused
 * (POST /v1/video-uploads/:uploadId/links). Google's signer gave 7 days. docs/build/JOBS-MIGRATION.md, known limits.
 */
export const VIDEO_LINK_S = 6 * 3600;

type S3Send = Pick<S3Client, "send">;

export function s3Store(options: { bucket: string; client?: S3Client; now?: () => number; uploadLinkS?: number }): ObjectStore {
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
  const uploadLinkS = options.uploadLinkS ?? UPLOAD_LINK_S;
  const missing = (error: unknown) => {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
  };
  return {
    async presignPut(key, contentType, size) {
      const command = new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: size });
      const url = await getSignedUrl(client, command, {
        expiresIn: uploadLinkS,
        // Signed, so S3 itself refuses another type or size.
        signableHeaders: new Set(["content-type", "content-length"]),
      });
      return { url, headers: { "Content-Type": contentType }, expiresInS: uploadLinkS };
    },
    async startParts(key, contentType) {
      const { UploadId } = await send(new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }));
      if (!UploadId) throw new Error("S3 gave no upload id");
      return UploadId;
    },
    async presignPart(key, multipartId, partNumber, size) {
      const command = new UploadPartCommand({ Bucket, Key: key, UploadId: multipartId, PartNumber: partNumber, ContentLength: size });
      const url = await getSignedUrl(client, command, { expiresIn: uploadLinkS, signableHeaders: new Set(["content-length"]) });
      return { url, headers: {}, expiresInS: uploadLinkS };
    },
    async finishParts(key, multipartId, parts) {
      await send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: multipartId,
          MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        }),
      );
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
        return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? null, ...(out.LastModified ? { modified: out.LastModified } : {}) };
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
    async list(prefix, max) {
      const keys: string[] = [];
      let ContinuationToken: string | undefined;
      do {
        const out = await send(new ListObjectsV2Command({ Bucket, Prefix: prefix, MaxKeys: Math.min(1000, max - keys.length), ContinuationToken }));
        for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
        ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (ContinuationToken && keys.length < max);
      return keys.slice(0, max);
    },
    async removeMany(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const out = await send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
        if (out.Errors?.length) throw new Error(`S3 refused ${out.Errors.length} deletes (${out.Errors[0].Code ?? "no code"})`);
      }
    },
    async write(key, bytes, contentType, cacheControl) {
      const out = await send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: contentType, ...(cacheControl ? { CacheControl: cacheControl } : {}) }));
      return { version: out.VersionId ?? null };
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

let videos: ObjectStore | undefined;

/** The `uploads` bucket: a cook's raw videos, which the worker reads. */
export function uploadStore(): ObjectStore {
  if (!videos) {
    const bucket = process.env.UPLOAD_BUCKET?.trim();
    if (!bucket) throw new Error("UPLOAD_BUCKET isn't set");
    videos = s3Store({ bucket, uploadLinkS: VIDEO_LINK_S });
  }
  return videos;
}

/** For tests. */
export function useUploadStore(next: ObjectStore | undefined): void {
  videos = next;
}

let media: ObjectStore | undefined;

/** The `media` bucket: published recipes, behind the CDN. The api deletes here, for the outside purge and the sweep, and writes only staging's test recipe. */
export function mediaStore(): ObjectStore {
  if (!media) {
    const bucket = process.env.MEDIA_BUCKET?.trim();
    if (!bucket) throw new Error("MEDIA_BUCKET isn't set");
    media = s3Store({ bucket });
  }
  return media;
}

/** For tests. */
export function useMediaStore(next: ObjectStore | undefined): void {
  media = next;
}

/** The store a `files` row's bucket names. */
export const storeFor = (bucket: "uploads" | "private" | "media") => (bucket === "uploads" ? uploadStore() : bucket === "media" ? mediaStore() : objectStore());
