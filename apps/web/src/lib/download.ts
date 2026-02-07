/**
 * Shared download utility for file downloads
 * Uses authenticated downloads to create a short-lived download URL
 */

import { filesApi } from './api';

/**
 * Trigger a file download using a signed URL
 * The browser will download the file to the default download folder
 * 
 * @param sessionId - The session ID
 * @param fileId - The file ID
 * @param filename - The filename to save as
 */
export async function triggerDownload(
  sessionId: string,
  fileId: string,
  filename: string
): Promise<void> {
  try {
    // Fetch a short-lived download URL using authenticated API
    const downloadUrl = await filesApi.getDownloadUrl(sessionId, fileId);

    // Create temporary anchor element
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.style.display = 'none';
    
    // Trigger download
    document.body.appendChild(link);
    link.click();
    
    // Clean up
    document.body.removeChild(link);
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
}
