import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { discordAuth, loadConfig, validateToken } from './auth-discord.js';
import { fetchGenerations } from './api.js';
import { downloadTrackWithRetry } from './downloader.js';
import { loadState, saveState, cleanupDownloadingFiles } from './state.js';
import { sanitizeFilename } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(process.cwd(), 'config.json');

/**
 * Main orchestrator for BulkDownloadProducerAi
 */
async function main() {
  console.log('🎵 BulkDownloadProducerAi - Producer.ai Music Library Downloader\n');

  try {
    // Step 1: Load or authenticate
    console.log('📋 Step 1: Authentication\n');
    let config = await loadConfig(CONFIG_PATH);

    if (!config) {
      console.log('⚠️  No valid config found. Starting Discord authentication...\n');
      const auth = await discordAuth({
        headless: false,
        timeout: 120000,
        saveToConfig: true,
        configPath: CONFIG_PATH,
      });

      config = {
        token: auth.token,
        userId: auth.userId,
        outputDir: './downloads',
        format: 'mp3',
        authMethod: 'discord',
      };
    }

    // Step 2: Validate token
    console.log('\n📋 Step 2: Token Validation\n');
    const isTokenValid = await validateToken(config.token);
    if (!isTokenValid) {
      throw new Error('Token is invalid. Please re-authenticate.');
    }

    // Step 3: Setup output directory
    console.log('\n📋 Step 3: Setup\n');
    console.log(`📁 Output directory: ${path.resolve(config.outputDir)}`);

    if (!fs.existsSync(config.outputDir)) {
      fs.mkdirSync(config.outputDir, { recursive: true });
      console.log('   Created');
    } else {
      console.log('   Exists');
    }

    // Cleanup orphaned .downloading files
    console.log('\n🧹 Cleaning up orphaned .downloading files');
    cleanupDownloadingFiles(config.outputDir);

    // Step 4: Load state
    console.log('\n📋 Step 4: Load Progress State\n');
    let state = loadState();
    console.log(`Last offset: ${state.lastOffset}`);
    console.log(`Downloaded: ${state.downloaded}`);
    console.log(`Skipped: ${state.skipped}`);
    console.log(`Failed: ${state.failed.length}`);

    // Step 5: Download loop
    console.log('\n📋 Step 5: Download Tracks\n');
    console.log('Starting download process...\n');

    const stats = {
      downloaded: state.downloaded,
      skipped: state.skipped,
      failed: state.failed.length,
    };

    let offset = state.lastOffset;
    const limit = 20;
    let hasMore = true;
    let totalProcessed = 0;

    while (hasMore) {
      console.log(`\n📥 Fetching page offset=${offset}...`);

      try {
        const response = await fetchGenerations(config.token, config.userId, offset, limit);
        const generations = response.generations || [];

        if (generations.length === 0) {
          console.log('   No more tracks');
          hasMore = false;
          break;
        }

        console.log(`   Found ${generations.length} tracks`);

        // Download each track
        for (const generation of generations) {
          try {
            const result = await downloadTrackWithRetry(
              generation,
              config.token,
              config.outputDir,
              config.format,
              {
                maxRetries: 2,
              }
            );

            totalProcessed++;

            if (result.status === 'success') {
              stats.downloaded++;
              console.log(`✅ ${result.file}`);
            } else if (result.status === 'skipped') {
              stats.skipped++;
              console.log(`⏭️  ${result.file}`);
            } else if (result.status === 'failed') {
              stats.failed++;
              state.failed.push(generation.id);
              console.log(`❌ ${result.file} - ${result.message}`);
            }

            // Save state every 10 tracks
            if (totalProcessed % 10 === 0) {
              state.lastOffset = offset;
              state.downloaded = stats.downloaded;
              state.skipped = stats.skipped;
              saveState(state);
            }
          } catch (error) {
            console.error(`   Error processing track: ${error.message}`);
            stats.failed++;
            state.failed.push(generation.id);
          }
        }

        offset += limit;
        state.lastOffset = offset;
        state.downloaded = stats.downloaded;
        state.skipped = stats.skipped;
        saveState(state);
      } catch (error) {
        console.error(`\n⚠️  Error fetching generations: ${error.message}`);
        console.log('   Retrying in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Step 6: Final summary
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Download Complete!');
    console.log('='.repeat(60));
    console.log(`\nDownloaded: ${stats.downloaded}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Total: ${stats.downloaded + stats.skipped + stats.failed}`);

    if (stats.failed > 0) {
      console.log(`\n⚠️  ${stats.failed} track(s) failed:`);
      state.failed.forEach(id => console.log(`   - ${id}`));
      console.log('\nRun again to retry failed tracks.');
    }

    console.log(`\n📁 Files saved to: ${path.resolve(config.outputDir)}`);

    // Reset state on complete success
    if (stats.failed === 0 && hasMore === false) {
      console.log('✅ All tracks downloaded successfully!');
      state.lastOffset = 0;
      state.downloaded = 0;
      state.skipped = 0;
      state.failed = [];
      saveState(state);
      console.log('   Progress reset for next sync');
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run main
main().catch(error => {
  console.error('Uncaught error:', error);
  process.exit(1);
});
