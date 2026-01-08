import fs from 'fs';
import path from 'path';
import { getDownloadUrl } from './api.js';
import { sanitizeFilename } from './utils.js';

/**
 * Download a single track with .downloading pattern
 */
export async function downloadTrack(generation, token, outputDir, format = 'mp3') {
  const filename = sanitizeFilename(`${generation.title}_${generation.id}.${format}`);
  const finalPath = path.join(outputDir, filename);
  const tempPath = `${finalPath}.downloading`;

  // Check if already downloaded
  if (fs.existsSync(finalPath)) {
    const stats = fs.statSync(finalPath);
    if (stats.size > 0) {
      return {
        status: 'skipped',
        file: filename,
        message: `exists (${stats.size} bytes)`,
      };
    }
  }

  // Clean up old .downloading if present
  if (fs.existsSync(tempPath)) {
    fs.unlinkSync(tempPath);
  }

  // Download to .downloading
  try {
    const url = getDownloadUrl(generation.id, format);
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(tempPath, Buffer.from(buffer));

    // Verify file was written
    const tempStats = fs.statSync(tempPath);
    if (tempStats.size === 0) {
      fs.unlinkSync(tempPath);
      throw new Error('Downloaded file is empty');
    }

    // Atomic rename to final
    fs.renameSync(tempPath, finalPath);

    return {
      status: 'success',
      file: filename,
      size: tempStats.size,
    };
  } catch (error) {
    // Clean up failed .downloading
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

/**
 * Download track with automatic retry
 */
export async function downloadTrackWithRetry(
  generation,
  token,
  outputDir,
  format = 'mp3',
  options = {}
) {
  const { maxRetries = 2 } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await downloadTrack(generation, token, outputDir, format);
    } catch (error) {
      if (attempt === maxRetries) {
        return {
          status: 'failed',
          file: generation.title,
          message: error.message,
          error: error,
        };
      }

      const waitTime = 1000 * attempt; // Exponential backoff
      console.log(
        `⚠️  Retry ${attempt}/${maxRetries}: ${generation.title} - ${error.message}`
      );
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}
