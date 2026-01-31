import { getFile } from './apps/api/src/services/files';

async function testGetFile() {
  try {
    // Test reading a file from outputs directory
    const buffer = await getFile('/tmp/test-workspace', 'outputs/ppt/ai-intro.pptx');
    console.log('SUCCESS: Got file, size:', buffer.length, 'bytes');
  } catch (error) {
    console.error('FAILED:', error.message);
  }
}

testGetFile();
