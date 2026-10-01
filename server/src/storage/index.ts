import { cloudinaryConfigFromEnv, cloudinaryStorage } from './cloudinary';
import type { StorageDriver } from './types';

export * from './types';

/** Local disk, loaded on first use (keeps the native image library out of the Vercel function). */
const lazyLocalStorage: StorageDriver = {
  saveImage: async (input, options) => (await import('./local')).localStorage.saveImage(input, options),
};

/**
 * The active storage driver: Cloudinary when CLOUDINARY_* env vars are set (Vercel), otherwise local disk
 * (server/uploads — the default for `npm run dev`).
 */
const cloudinary = cloudinaryConfigFromEnv();
export const storage: StorageDriver = cloudinary ? cloudinaryStorage(cloudinary) : lazyLocalStorage;
