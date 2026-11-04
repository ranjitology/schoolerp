/** Object-storage rules shared by the API and both web clients. */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export function isAllowedUpload(mimeType: string, sizeBytes: number): boolean {
  return (
    sizeBytes > 0 &&
    sizeBytes <= MAX_UPLOAD_BYTES &&
    (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType)
  );
}

/**
 * Tenant-first key. The school id is always the first path segment so bucket
 * lifecycle rules and deletion jobs can target one tenant without a database
 * lookup, and a leaked key cannot be mistaken for another tenant's document.
 */
export function buildStorageKey(
  schoolId: string,
  kind: string,
  fileName: string,
  id: string,
): string {
  const safeKind = kind.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40) || 'misc';
  const safeName = sanitizeFileName(fileName);
  return `tenants/${schoolId}/${safeKind}/${id}-${safeName}`;
}

export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return cleaned || 'file';
}
