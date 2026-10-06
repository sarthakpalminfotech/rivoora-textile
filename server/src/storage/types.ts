export type UploadFolder = 'designs' | 'notes' | 'damages' | 'demo';

export interface SaveImageOptions {
  folder: UploadFolder;
  /** Fixed base name (used by the seed); a random one is generated otherwise. */
  baseName?: string;
}

export interface StoredImage {
  url: string;
  thumbUrl: string;
}

/**
 * Storage driver contract. Swap the local driver for an R2/S3 implementation
 * with the same shape and nothing else in the app has to change.
 */
export interface StorageDriver {
  saveImage(input: Buffer, options: SaveImageOptions): Promise<StoredImage>;
}

export class UnsupportedImageError extends Error {}
