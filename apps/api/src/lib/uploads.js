import multer from 'multer';
import { imageSize } from 'image-size';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { apiRoot } from '../db.js';
import { HttpError } from './errors.js';

export const uploadsDirectory = path.resolve(process.env.API_UPLOAD_DIR || path.join(apiRoot, 'uploads'));
await mkdir(uploadsDirectory, { recursive: true });
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
export const upload = multer({
  defParamCharset: 'utf8',
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, fields: 200, fieldSize: 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!extensions[file.mimetype]) return callback(new HttpError(415, 'Images only: PNG, JPEG, GIF, WebP, HEIC, or HEIF (SVG is not allowed)'));
    callback(null, true);
  },
}).array('files');

export async function removeFiles(names) {
  await Promise.all(names.map(async (name) => {
    try { await unlink(path.join(uploadsDirectory, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }));
}

// Written names are tracked before the enclosing transaction commits, so rollback removes files too.
export async function withUploadCleanup(work) {
  const written = [];
  try { return await work(written); }
  catch (error) {
    await removeFiles(written);
    throw error;
  }
}

export async function saveAttachments(db, taskId, files, written) {
  for (const file of files || []) {
    let dimensions;
    try { dimensions = imageSize(file.buffer); }
    catch { throw new HttpError(415, 'File must contain a valid supported image'); }
    const allowedTypes = { png: ['image/png'], jpg: ['image/jpeg'], gif: ['image/gif'], webp: ['image/webp'], heif: ['image/heic', 'image/heif'], heic: ['image/heic', 'image/heif'] };
    if (!dimensions.width || !dimensions.height || !allowedTypes[dimensions.type]?.includes(file.mimetype)) throw new HttpError(415, 'Image contents do not match its MIME type');
    const id = randomUUID();
    const name = `${id}.${extensions[file.mimetype]}`;
    await writeFile(path.join(uploadsDirectory, name), file.buffer, { flag: 'wx' });
    written.push(name);
    await db.query(`INSERT INTO attachments (id, task_id, filename, mime_type, size, width, height, storage_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, taskId, file.originalname, file.mimetype, file.size, dimensions.width, dimensions.height, name]);
  }
}
