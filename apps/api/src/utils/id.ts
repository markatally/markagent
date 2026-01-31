/**
 * Utility to generate unique IDs
 */

/**
 * Generate a unique ID
 * Uses crypto.randomUUID when available, falls back to timestamp + random
 */
export function generateId(): string {
  try {
    // Use crypto.randomUUID if available (Node.js 15+)
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : fallbackId();
  } catch {
    return fallbackId();
  }
}

/**
 * Fallback ID generator using timestamp and random
 */
function fallbackId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return `${timestamp}-${random}`;
}

/**
 * Generate a short ID (useful for in-memory IDs)
 */
export function generateShortId(): string {
  return Math.random().toString(36).substring(2, 10);
}
