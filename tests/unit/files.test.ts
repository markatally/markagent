import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Set CONFIG_PATH for tests if not already set
if (!process.env.CONFIG_PATH) {
  process.env.CONFIG_PATH = path.join(process.cwd(), 'config/default.json');
}

// Import after setting CONFIG_PATH
import {
  validateFile,
  saveFile,
  getFile,
  deleteFile,
  listFiles,
  getFileInfo,
} from '../../apps/api/src/services/files';

describe('Phase 6.2: File Upload/Download', () => {
  let testWorkspace: string;
  const testSessionId = 'test-session-files';

  beforeAll(async () => {
    // Create temporary workspace for testing
    testWorkspace = path.join(os.tmpdir(), `manus-files-test-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup test workspace
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('File Validation', () => {
    it('should validate allowed file types', () => {
      const result = validateFile('test.txt', 1000);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate .md files', () => {
      const result = validateFile('readme.md', 5000);
      expect(result.valid).toBe(true);
    });

    it('should validate .json files', () => {
      const result = validateFile('config.json', 2000);
      expect(result.valid).toBe(true);
    });

    it('should validate .ts files', () => {
      const result = validateFile('index.ts', 10000);
      expect(result.valid).toBe(true);
    });

    it('should validate .py files', () => {
      const result = validateFile('script.py', 3000);
      expect(result.valid).toBe(true);
    });

    it('should validate image files', () => {
      expect(validateFile('image.png', 500000).valid).toBe(true);
      expect(validateFile('photo.jpg', 500000).valid).toBe(true);
      expect(validateFile('picture.jpeg', 500000).valid).toBe(true);
      expect(validateFile('animation.gif', 100000).valid).toBe(true);
    });

    it('should validate .pdf files', () => {
      const result = validateFile('document.pdf', 1000000);
      expect(result.valid).toBe(true);
    });

    it('should reject disallowed file types', () => {
      const result = validateFile('malware.exe', 1000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('File type not allowed');
    });

    it('should reject files that are too large', () => {
      // Config has maxFileUploadSize = "10MB" = 10485760 bytes
      const result = validateFile('large.txt', 20 * 1024 * 1024); // 20MB
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum');
    });

    it('should accept files at max size', () => {
      // 10MB should be accepted
      const result = validateFile('max.txt', 10 * 1024 * 1024);
      expect(result.valid).toBe(true);
    });
  });

  describe('File Save', () => {
    it('should save file with ArrayBuffer data', async () => {
      const content = 'Hello, World!';
      const data = new TextEncoder().encode(content).buffer;

      const metadata = await saveFile(
        testSessionId,
        testWorkspace,
        'test.txt',
        data as ArrayBuffer
      );

      expect(metadata.filename).toBe('test.txt');
      expect(metadata.filepath).toMatch(/^uploads\/\d+-test\.txt$/);
      expect(metadata.sizeBytes).toBe(content.length);
      expect(metadata.mimeType).toBe('text/plain');
    });

    it('should sanitize filenames', async () => {
      const content = 'Test content';
      const data = new TextEncoder().encode(content).buffer;

      const metadata = await saveFile(
        testSessionId,
        testWorkspace,
        '../../../etc/passwd',
        data as ArrayBuffer
      );

      // Should strip path traversal
      expect(metadata.filename).toBe('passwd');
    });

    it('should handle filenames with special characters', async () => {
      const content = 'Test';
      const data = new TextEncoder().encode(content).buffer;

      const metadata = await saveFile(
        testSessionId,
        testWorkspace,
        'file:with*special?chars.txt',
        data as ArrayBuffer
      );

      // Special chars should be replaced with underscores
      expect(metadata.filename).not.toContain(':');
      expect(metadata.filename).not.toContain('*');
      expect(metadata.filename).not.toContain('?');
    });

    it('should assign correct MIME types', async () => {
      const data = new TextEncoder().encode('test').buffer as ArrayBuffer;

      const mdFile = await saveFile(testSessionId, testWorkspace, 'file.md', data);
      expect(mdFile.mimeType).toBe('text/markdown');

      const jsonFile = await saveFile(testSessionId, testWorkspace, 'file.json', data);
      expect(jsonFile.mimeType).toBe('application/json');

      const tsFile = await saveFile(testSessionId, testWorkspace, 'file.ts', data);
      expect(tsFile.mimeType).toBe('application/typescript');
    });
  });

  describe('File Read', () => {
    it('should read saved file', async () => {
      const content = 'Read test content';
      const data = new TextEncoder().encode(content).buffer;

      const metadata = await saveFile(
        testSessionId,
        testWorkspace,
        'readable.txt',
        data as ArrayBuffer
      );

      const fileData = await getFile(testWorkspace, metadata.filepath);
      const readContent = new TextDecoder().decode(fileData);

      expect(readContent).toBe(content);
    });

    it('should throw error for non-existent file', async () => {
      await expect(getFile(testWorkspace, 'uploads/nonexistent.txt')).rejects.toThrow(
        'File not found'
      );
    });

    it('should prevent path traversal on read', async () => {
      await expect(getFile(testWorkspace, '../../../etc/passwd')).rejects.toThrow(
        'Path traversal detected'
      );
    });
  });

  describe('File Delete', () => {
    it('should delete existing file', async () => {
      const content = 'Delete me';
      const data = new TextEncoder().encode(content).buffer;

      const metadata = await saveFile(
        testSessionId,
        testWorkspace,
        'deletable.txt',
        data as ArrayBuffer
      );

      // File should exist
      const fileData = await getFile(testWorkspace, metadata.filepath);
      expect(fileData).toBeDefined();

      // Delete it
      await deleteFile(testWorkspace, metadata.filepath);

      // File should no longer exist
      await expect(getFile(testWorkspace, metadata.filepath)).rejects.toThrow();
    });

    it('should prevent path traversal on delete', async () => {
      await expect(deleteFile(testWorkspace, '../../../etc/passwd')).rejects.toThrow(
        'Path traversal detected'
      );
    });
  });

  describe('File List', () => {
    it('should list files in uploads directory', async () => {
      const content = 'Listed file';
      const data = new TextEncoder().encode(content).buffer;

      await saveFile(testSessionId, testWorkspace, 'listed1.txt', data as ArrayBuffer);
      await saveFile(testSessionId, testWorkspace, 'listed2.txt', data as ArrayBuffer);

      const files = await listFiles(testWorkspace);

      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty array for non-existent uploads dir', async () => {
      const emptyWorkspace = path.join(os.tmpdir(), `empty-${Date.now()}`);
      await fs.mkdir(emptyWorkspace, { recursive: true });

      const files = await listFiles(emptyWorkspace);
      expect(files).toEqual([]);

      await fs.rm(emptyWorkspace, { recursive: true, force: true });
    });
  });

  describe('File Info', () => {
    it('should get file info for existing file', async () => {
      const content = 'Info test';
      const data = new TextEncoder().encode(content).buffer;

      const metadata = await saveFile(
        testSessionId,
        testWorkspace,
        'info.txt',
        data as ArrayBuffer
      );

      const info = await getFileInfo(testWorkspace, metadata.filepath);

      expect(info).not.toBeNull();
      expect(info!.size).toBe(content.length);
      expect(info!.mimeType).toBe('text/plain');
    });

    it('should return null for non-existent file', async () => {
      const info = await getFileInfo(testWorkspace, 'uploads/nonexistent.txt');
      expect(info).toBeNull();
    });

    it('should return null for path traversal attempt', async () => {
      const info = await getFileInfo(testWorkspace, '../../../etc/passwd');
      expect(info).toBeNull();
    });
  });
});
