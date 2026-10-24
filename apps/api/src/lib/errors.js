export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error.status || 500;
  let message = error.message;
  if (error.name === 'ZodError') {
    status = 400;
    message = 'Invalid request';
    error.details = error.issues.map(({ path, message }) => ({ path: path.join('.'), message }));
  } else if (error.code === 'LIMIT_FILE_SIZE' || error.type === 'entity.too.large') {
    status = 413;
    message = 'File or request too large (maximum 20 MB per image)';
  } else if (error.name === 'MulterError') {
    status = 400;
  } else if (['22P02', '22007', '22008'].includes(error.code)) {
    status = 400;
    message = 'Invalid identifier or date';
  } else if (error.code === '23503') {
    status = 400;
    message = 'Referenced project, user, tag, or task does not exist';
  } else if (error.code === '23505') {
    status = 400;
    message = 'That name already exists';
  }
  if (status >= 500) {
    console.error(error);
    message = 'Internal server error';
  }
  res.status(status).json({ error: message, ...(error.details ? { details: error.details } : {}) });
}
