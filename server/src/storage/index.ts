import { localStorage } from './local';
import type { StorageDriver } from './types';

export * from './types';

/** The active storage driver. Change this line to move uploads to cloud storage. */
export const storage: StorageDriver = localStorage;
