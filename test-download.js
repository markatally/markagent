// Test script to verify file download works
const API_BASE = 'http://localhost:4000/api';

async function testDownload() {
  // Test health
  const health = await fetch(`${API_BASE}/health`);
  console.log('Health:', await health.json());

  // List sessions
  const sessionsResp = await fetch(`${API_BASE}/sessions`);
  const sessions = await sessionsResp.json();
  console.log('Sessions:', sessions);

  if (sessions.sessions && sessions.sessions.length > 0) {
    const sessionId = sessions.sessions[0].id;
    console.log('Using session:', sessionId);

    // List files
    const filesResp = await fetch(`${API_BASE}/sessions/${sessionId}/files`);
    const files = await filesResp.json();
    console.log('Files:', files);

    if (files.files && files.files.length > 0) {
      const fileId = files.files[0].id;
      const filename = files.files[0].filename;
      console.log('Testing download:', fileId, filename);

      // Try download
      const downloadResp = await fetch(
        `${API_BASE}/sessions/${sessionId}/files/${fileId}/download`
      );
      console.log('Download response status:', downloadResp.status);
      console.log('Content-Type:', downloadResp.headers.get('content-type'));
      console.log('Content-Disposition:', downloadResp.headers.get('content-disposition'));

      if (!downloadResp.ok) {
        const errorText = await downloadResp.text();
        console.error('Download failed:', errorText);
      } else {
        const blob = await downloadResp.blob();
        console.log('Blob size:', blob.size, 'bytes');
      }
    }
  }
}

testDownload().catch(console.error);
