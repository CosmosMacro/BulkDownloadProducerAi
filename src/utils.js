import sanitize from 'sanitize-filename';

/**
 * Sanitize filename to prevent path traversal and invalid characters
 */
export function sanitizeFilename(filename) {
  return sanitize(filename, {
    replacement: '_',
  });
}
