/**
 * File Routes
 * Handles file upload, download, list, and delete for sessions
 */

import { Hono } from 'hono';
import { prisma } from '../services/prisma';
import { requireAuth, AuthContext } from '../middleware/auth';
import {
  validateFile,
  saveFile,
  getFile,
  deleteFile as deleteFileFromDisk,
} from '../services/files';
import path from 'path';

const files = new Hono<AuthContext>();

// All file routes require authentication
files.use('*', requireAuth);

/**
 * POST /api/sessions/:sessionId/files
 * Upload a file to the session workspace
 */
files.post('/sessions/:sessionId/files', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Verify session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  // Parse multipart form data
  let body: FormData;
  try {
    body = await c.req.formData();
  } catch (error) {
    return c.json(
      {
        error: {
          code: 'INVALID_FORM_DATA',
          message: 'Invalid form data. Expected multipart/form-data with file field.',
        },
      },
      400
    );
  }

  const file = body.get('file');
  if (!file || !(file instanceof File)) {
    return c.json(
      {
        error: {
          code: 'FILE_REQUIRED',
          message: 'File is required. Use form field name "file".',
        },
      },
      400
    );
  }

  // Validate file
  const validation = validateFile(file.name, file.size);
  if (!validation.valid) {
    return c.json(
      {
        error: {
          code: 'INVALID_FILE',
          message: validation.error,
        },
      },
      400
    );
  }

  // Determine workspace directory
  const workspaceDir =
    session.workspacePath ||
    path.join(process.env.WORKSPACE_ROOT || '/tmp/manus-workspaces', sessionId);

  try {
    // Save file
    const arrayBuffer = await file.arrayBuffer();
    const metadata = await saveFile(sessionId, workspaceDir, file.name, arrayBuffer);

    // Save to database
    const dbFile = await prisma.file.create({
      data: {
        sessionId,
        filename: metadata.filename,
        filepath: metadata.filepath,
        sizeBytes: BigInt(metadata.sizeBytes),
        mimeType: metadata.mimeType,
      },
    });

    return c.json({
      id: dbFile.id,
      filename: dbFile.filename,
      filepath: dbFile.filepath,
      sizeBytes: Number(dbFile.sizeBytes),
      mimeType: dbFile.mimeType,
      createdAt: dbFile.createdAt.toISOString(),
    });
  } catch (error: any) {
    console.error('File upload failed:', error);
    return c.json(
      {
        error: {
          code: 'UPLOAD_FAILED',
          message: error.message || 'Failed to upload file',
        },
      },
      500
    );
  }
});

/**
 * GET /api/sessions/:sessionId/files
 * List files in the session
 */
files.get('/sessions/:sessionId/files', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Verify session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  // Get files from database
  const dbFiles = await prisma.file.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  });

  return c.json({
    files: dbFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      filepath: f.filepath,
      sizeBytes: Number(f.sizeBytes),
      mimeType: f.mimeType,
      createdAt: f.createdAt.toISOString(),
    })),
  });
});

/**
 * GET /api/sessions/:sessionId/files/:fileId/download
 * Download a file
 */
files.get('/sessions/:sessionId/files/:fileId/download', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const fileId = c.req.param('fileId');

  // Verify session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  // Get file from database
  const dbFile = await prisma.file.findUnique({
    where: {
      id: fileId,
      sessionId,
    },
  });

  if (!dbFile) {
    return c.json(
      {
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'File not found',
        },
      },
      404
    );
  }

  // Determine workspace directory
  const workspaceDir =
    session.workspacePath ||
    path.join(process.env.WORKSPACE_ROOT || '/tmp/manus-workspaces', sessionId);

  try {
    // Read file
    const fileBuffer = await getFile(workspaceDir, dbFile.filepath);

    // Set headers for download
    c.header('Content-Type', dbFile.mimeType || 'application/octet-stream');
    c.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(dbFile.filename)}"`
    );
    c.header('Content-Length', fileBuffer.length.toString());

    return c.body(fileBuffer);
  } catch (error: any) {
    console.error('File download failed:', error);

    if (error.message === 'File not found') {
      return c.json(
        {
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found on disk',
          },
        },
        404
      );
    }

    return c.json(
      {
        error: {
          code: 'DOWNLOAD_FAILED',
          message: error.message || 'Failed to download file',
        },
      },
      500
    );
  }
});

/**
 * DELETE /api/sessions/:sessionId/files/:fileId
 * Delete a file
 */
files.delete('/sessions/:sessionId/files/:fileId', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const fileId = c.req.param('fileId');

  // Verify session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  // Get file from database
  const dbFile = await prisma.file.findUnique({
    where: {
      id: fileId,
      sessionId,
    },
  });

  if (!dbFile) {
    return c.json(
      {
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'File not found',
        },
      },
      404
    );
  }

  // Determine workspace directory
  const workspaceDir =
    session.workspacePath ||
    path.join(process.env.WORKSPACE_ROOT || '/tmp/manus-workspaces', sessionId);

  try {
    // Delete file from disk
    await deleteFileFromDisk(workspaceDir, dbFile.filepath);
  } catch (error) {
    // Log but don't fail if file already deleted from disk
    console.warn('File not found on disk during delete:', error);
  }

  // Delete from database
  await prisma.file.delete({
    where: { id: fileId },
  });

  return c.json({
    success: true,
    message: 'File deleted',
  });
});

export { files as fileRoutes };
