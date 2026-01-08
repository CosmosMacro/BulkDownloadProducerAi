import fs from 'fs';
import path from 'path';

const STATE_FILE = 'download-state.json';

/**
 * Load state from file
 */
export function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading state file:', error.message);
      return getDefaultState();
    }
  }

  return getDefaultState();
}

/**
 * Save state to file
 */
export function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Error saving state file:', error.message);
  }
}

/**
 * Reset state
 */
export function resetState() {
  const state = getDefaultState();
  saveState(state);
  return state;
}

/**
 * Get default state structure
 */
function getDefaultState() {
  return {
    lastOffset: 0,
    downloaded: 0,
    skipped: 0,
    failed: [],
    lastRun: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Clean up orphaned .downloading files
 */
export function cleanupDownloadingFiles(directory) {
  try {
    if (!fs.existsSync(directory)) {
      return 0;
    }

    const files = fs.readdirSync(directory);
    const downloading = files.filter(f => f.endsWith('.downloading'));

    downloading.forEach(filename => {
      const filepath = path.join(directory, filename);
      try {
        fs.unlinkSync(filepath);
        console.log(`   Removed: ${filename}`);
      } catch (error) {
        console.error(`   Failed to remove ${filename}: ${error.message}`);
      }
    });

    return downloading.length;
  } catch (error) {
    console.error('Error cleaning up files:', error.message);
    return 0;
  }
}
