/**
 * File Service
 * Handles file validation, storage, and management for user uploads
 */

import { createWriteStream, promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { getConfig } from './config';

/**
 * File metadata
 */
export interface FileMetadata {
  filename: string;
  filepath: string;
  sizeBytes: number;
  mimeType: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Parse size string to bytes (e.g., "10MB" -> 10485760)
 */
function parseSize(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)?$/i);
  if (!match) return 10 * 1024 * 1024; // Default 10MB

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'MB').toUpperCase();

  const multipliers: Record<string, number> = {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  return Math.floor(value * (multipliers[unit] || multipliers.MB));
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.py': 'text/x-python',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.java': 'text/x-java',
    '.html': 'text/html',
    '.css': 'text/css',
    '.sql': 'application/sql',
    '.sh': 'application/x-sh',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Sanitize filename to prevent path traversal
 */
function sanitizeFilename(filename: string): string {
  // Remove directory components
  const basename = path.basename(filename);
  // Remove any remaining path separators and null bytes
  return basename.replace(/[\/\\:*?"<>|\x00]/g, '_');
}

/**
 * Validate file before upload
 */
export function validateFile(
  filename: string,
  sizeBytes: number
): ValidationResult {
  const config = getConfig();
  const maxSize = parseSize(config.security.maxFileUploadSize);
  const allowedTypes = config.security.allowedFileTypes;

  // Check file size
  if (sizeBytes > maxSize) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed (${config.security.maxFileUploadSize})`,
    };
  }

  // Check file extension
  const ext = path.extname(filename).toLowerCase();
  if (!allowedTypes.includes(ext)) {
    return {
      valid: false,
      error: `File type not allowed: ${ext}. Allowed types: ${allowedTypes.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Save uploaded file to session workspace
 */
export async function saveFile(
  sessionId: string,
  workspaceDir: string,
  filename: string,
  data: ArrayBuffer | Readable
): Promise<FileMetadata> {
  // Sanitize filename
  const safeFilename = sanitizeFilename(filename);
  if (!safeFilename) {
    throw new Error('Invalid filename');
  }

  // Create upload directory if it doesn't exist
  const uploadDir = path.join(workspaceDir, 'uploads');
  await fs.mkdir(uploadDir, { recursive: true });

  // Generate unique filename to avoid collisions
  const timestamp = Date.now();
  const uniqueFilename = `${timestamp}-${safeFilename}`;
  const filepath = path.join(uploadDir, uniqueFilename);

  // Verify path is within workspace
  const resolvedPath = path.resolve(filepath);
  const resolvedWorkspace = path.resolve(workspaceDir);
  if (!resolvedPath.startsWith(resolvedWorkspace)) {
    throw new Error('Path traversal detected');
  }

  let sizeBytes: number;

  if (data instanceof Readable) {
    // Stream data to file
    await new Promise<void>((resolve, reject) => {
      const writeStream = createWriteStream(filepath);
      data.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    const stats = await fs.stat(filepath);
    sizeBytes = stats.size;
  } else {
    // Write ArrayBuffer directly
    await fs.writeFile(filepath, Buffer.from(data));
    sizeBytes = data.byteLength;
  }

  const mimeType = getMimeType(safeFilename);

  return {
    filename: safeFilename,
    filepath: `uploads/${uniqueFilename}`,
    sizeBytes,
    mimeType,
  };
}

/**
 * Get file from session workspace
 */
export async function getFile(
  workspaceDir: string,
  filepath: string
): Promise<Buffer> {
  const fullPath = path.join(workspaceDir, filepath);

  // Verify path is within workspace
  const resolvedPath = path.resolve(fullPath);
  const resolvedWorkspace = path.resolve(workspaceDir);
  if (!resolvedPath.startsWith(resolvedWorkspace)) {
    throw new Error('Path traversal detected');
  }

  // Check file exists
  try {
    await fs.access(fullPath);
  } catch {
    throw new Error('File not found');
  }

  return fs.readFile(fullPath);
}

/**
 * Delete file from session workspace
 */
export async function deleteFile(
  workspaceDir: string,
  filepath: string
): Promise<void> {
  const fullPath = path.join(workspaceDir, filepath);

  // Verify path is within workspace
  const resolvedPath = path.resolve(fullPath);
  const resolvedWorkspace = path.resolve(workspaceDir);
  if (!resolvedPath.startsWith(resolvedWorkspace)) {
    throw new Error('Path traversal detected');
  }

  await fs.unlink(fullPath);
}

/**
 * List files in session workspace uploads directory
 */
export async function listFiles(workspaceDir: string): Promise<string[]> {
  const uploadDir = path.join(workspaceDir, 'uploads');

  try {
    const files = await fs.readdir(uploadDir);
    return files;
  } catch {
    return [];
  }
}

/**
 * Get file info from path
 */
export async function getFileInfo(
  workspaceDir: string,
  filepath: string
): Promise<{ size: number; mimeType: string } | null> {
  const fullPath = path.join(workspaceDir, filepath);

  // Verify path is within workspace
  const resolvedPath = path.resolve(fullPath);
  const resolvedWorkspace = path.resolve(workspaceDir);
  if (!resolvedPath.startsWith(resolvedWorkspace)) {
    return null;
  }

  try {
    const stats = await fs.stat(fullPath);
    return {
      size: stats.size,
      mimeType: getMimeType(path.basename(fullPath)),
    };
  } catch {
    return null;
  }
}
