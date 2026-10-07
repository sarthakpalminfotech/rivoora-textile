import { Router } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import { z } from 'zod';
import { can, type UploadResult } from '@rivoora/shared';
import { badRequest, forbidden } from '../lib/errors';
import { ah } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { storage } from '../storage';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const ALLOWED_MIME = /^image\/(jpeg|png|webp|heic|heif)$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME.test(file.mimetype) || ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(badRequest('Only image files are allowed (JPG, PNG, WebP or HEIC).', 'file'));
  },
});

export const uploadsRouter = Router();

uploadsRouter.post(
  '/',
  requirePermission('canManageMasters', 'canAddOrder', 'canEditOrder', 'canButtaQc', 'canMillQc'),
  upload.single('file'),
  ah(async (req, res) => {
    const { folder } = z.object({ folder: z.enum(['designs', 'notes', 'damages']).default('designs') }).parse(req.query);
    // Butta QC and Mill QC may only upload damage photos.
    if (folder !== 'damages' && !can(req.role, 'canManageMasters') && !can(req.role, 'canAddOrder') && !can(req.role, 'canEditOrder')) {
      throw forbidden('This role can only upload damage photos.');
    }
    if (!req.file) throw badRequest('Choose an image to upload.', 'file');
    const saved = await storage.saveImage(req.file.buffer, { folder });
    const body: UploadResult = { url: saved.url, thumbUrl: saved.thumbUrl };
    res.status(201).json(body);
  }),
);
