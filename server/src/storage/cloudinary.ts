import { createHash, randomUUID } from 'node:crypto';
import { UnsupportedImageError, type StorageDriver } from './types';

/**
 * Cloudinary driver (used when CLOUDINARY_* env vars are set, e.g. on Vercel). Uploads the original image;
 * the full (≤1600px) and 320px thumbnail WebP versions are Cloudinary URL transformations.
 */
export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function cloudinaryConfigFromEnv(): CloudinaryConfig | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

/** Signed upload; returns the public id. */
export async function cloudinaryUpload(cfg: CloudinaryConfig, input: Buffer, publicId: string): Promise<string> {
  const params: Record<string, string> = { public_id: publicId, timestamp: String(Math.floor(Date.now() / 1000)) };
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.append(k, v);
  form.append('api_key', cfg.apiKey);
  form.append('signature', createHash('sha1').update(toSign + cfg.apiSecret).digest('hex'));
  form.append('file', new Blob([new Uint8Array(input)]));

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, { method: 'POST', body: form });
  const data = (await res.json().catch(() => null)) as { public_id?: string; error?: { message?: string } } | null;
  if (res.ok && data?.public_id) return data.public_id;
  if (res.status === 400) {
    throw new UnsupportedImageError(
      'This image could not be read. Please upload a JPG, PNG, WebP or HEIC image.',
    );
  }
  throw new Error(`Image upload failed: ${data?.error?.message ?? res.status}`);
}

export function cloudinaryUrls(cloudName: string, publicId: string) {
  const base = `https://res.cloudinary.com/${cloudName}/image/upload`;
  return {
    url: `${base}/c_limit,w_1600,q_82,f_webp/${publicId}`,
    thumbUrl: `${base}/c_fill,w_320,h_320,q_72,f_webp/${publicId}`,
  };
}

export function cloudinaryStorage(cfg: CloudinaryConfig): StorageDriver {
  return {
    async saveImage(input, { folder, baseName }) {
      const name = baseName ?? `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const publicId = await cloudinaryUpload(cfg, input, `rivoora/${folder}/${name}`);
      return cloudinaryUrls(cfg.cloudName, publicId);
    },
  };
}
