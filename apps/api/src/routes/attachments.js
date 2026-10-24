import { Router } from 'express';
import { pool, transaction } from '../db.js';
import { id } from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';
import { removeFiles, uploadsDirectory } from '../lib/uploads.js';

export const attachmentsRouter = Router();
attachmentsRouter.get('/:id/file', async (req, res) => {
  const { rows: [attachment] } = await pool.query('SELECT storage_name, mime_type FROM attachments WHERE id = $1', [id.parse(req.params.id)]);
  if (!attachment) throw new HttpError(404, 'Attachment not found');
  res.set({ 'Content-Type': attachment.mime_type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(attachment.storage_name, { root: uploadsDirectory, cacheControl: false, dotfiles: 'deny' });
});
attachmentsRouter.delete('/:id', async (req, res) => {
  const attachmentId = id.parse(req.params.id);
  const name = await transaction(async (db) => {
    // Acquire the task lock before touching its attachments, just like task updates/deletion.
    await db.query('SELECT id FROM tasks WHERE id = (SELECT task_id FROM attachments WHERE id = $1) FOR UPDATE', [attachmentId]);
    const { rows: [attachment] } = await db.query('DELETE FROM attachments WHERE id = $1 RETURNING storage_name, task_id', [attachmentId]);
    if (!attachment) throw new HttpError(404, 'Attachment not found');
    await db.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [attachment.task_id]);
    return attachment.storage_name;
  });
  await removeFiles([name]);
  res.json({ ok: true });
});
