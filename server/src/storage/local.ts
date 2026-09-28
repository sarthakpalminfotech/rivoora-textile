import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { env } from '../env';
import { UnsupportedImageError, type StorageDriver } from './types';

const FULL_MAX_WIDTH = 1600;
const THUMB_SIZE = 320;

/** Saves images on this server's disk under server/uploads, served at /uploads. */
export const localStorage: StorageDriver = {
  async saveImage(input, { folder, baseName }) {
    const name = baseName ?? `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const dir = join(env.uploadsDir, folder);

    let full: Buffer;
    let thumb: Buffer;
    try {
      const base = sharp(input, { failOn: 'error' }).rotate();
      [full, thumb] = await Promise.all([
        base
          .clone()
          .resize({ width: FULL_MAX_WIDTH, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer(),
        base
          .clone()
          .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'cover' })
          .webp({ quality: 72 })
          .toBuffer(),
      ]);
    } catch {
      throw new UnsupportedImageError(
        'This image could not be read. Please upload a JPG, PNG or WebP image (HEIC may not be supported).',
      );
    }

    await mkdir(dir, { recursive: true });
    await Promise.all([
      writeFile(join(dir, `${name}.webp`), full),
      writeFile(join(dir, `${name}-thumb.webp`), thumb),
    ]);

    return {
      url: `/uploads/${folder}/${name}.webp`,
      thumbUrl: `/uploads/${folder}/${name}-thumb.webp`,
    };
  },
};
