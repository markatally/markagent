/**
 * Public Download Routes
 * Handles token-based file downloads without authentication
 */

import { Hono } from 'hono';
import { prisma } from '../services/prisma';
import { verifyDownloadToken } from '../services/auth';
import { getFile } from '../services/files';
import path from 'path';

const publicDownload = new Hono();

/**
 * GET /api/public/download?token=xxx
 * Download a file using a temporary download token
 */
publicDownload.get('/download', async (c) => {
  const token = c.req.query('token');

  if (!token) {
    return c.json(
      {
        error: {
          code: 'TOKEN_REQUIRED',
          message: 'Download token is required',
        },
      },
      400
    );
  }

  try {
    // Verify download token
    const payload = verifyDownloadToken(token);

    // Get session to verify it exists
    const session = await prisma.session.findUnique({
      where: {
        id: payload.sessionId,
        userId: payload.userId,
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
        id: payload.fileId,
        sessionId: payload.sessionId,
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
      path.join(process.env.WORKSPACE_ROOT || '/tmp/mark-workspaces', payload.sessionId);

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
      c.header('Cache-Control', 'no-cache');

      return c.body(fileBuffer);
    } catch (error: any) {
      console.error('File download failed:', error);

      const statusCode = error.message === 'File not found' ? 404 : 500;
      const errorCode = error.message === 'File not found' ? 'FILE_NOT_FOUND' : 'DOWNLOAD_FAILED';
      const errorMessage =
        error.message === 'File not found'
          ? 'File not found on disk. The file may have been moved or deleted.'
          : error.message || 'Failed to download file';

      return c.json(
        {
          error: {
            code: errorCode,
            message: errorMessage,
          },
        },
        statusCode
      );
    }
  } catch (error: any) {
    console.error('Token verification failed:', error);
    return c.json(
      {
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired download token',
        },
      },
      401
    );
  }
});

export { publicDownload as publicDownloadRoutes };
