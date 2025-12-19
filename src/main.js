const path = require('path');
const minimist = require('minimist');
const { chromium } = require('playwright');

const { buildConfig } = require('./config');
const {
  ensureDir,
  listImages,
  loadState,
  saveState,
  buildOutputPath,
  appendLog
} = require('./file-manager');
const { GeminiHandler, delay } = require('./gemini-handler');

function getRandomDelay(minMs, maxMs) {
  if (minMs >= maxMs) return minMs;
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

async function run() {
  const args = minimist(process.argv.slice(2));
  const config = buildConfig(args);

  await ensureDir(config.outputDir);
  await ensureDir(config.browserDataDir);

  const state = await loadState(config.outputDir);
  const allImages = await listImages(config.inputDir);
  const pending = allImages.filter((file) => !state.processed.includes(file));
  const limited = config.limit ? pending.slice(0, config.limit) : pending;

  if (!limited.length) {
    console.log('No images to process.');
    return;
  }

  const context = await chromium.launchPersistentContext(
    config.browserDataDir,
    {
      headless: false,
      viewport: { width: 1920, height: 1080 }
    }
  );

  const page = await context.newPage();
  const handler = new GeminiHandler(page, config);

  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
  await handler.ensureLoggedIn();

  let successCount = 0;
  let failureCount = 0;

  for (const imagePath of limited) {
    const baseName = path.basename(imagePath);
    let attempt = 0;
    let succeeded = false;

    while (attempt < config.retries && !succeeded) {
      attempt += 1;
      try {
        console.log(`Processing ${baseName} (attempt ${attempt}/${config.retries})`);
        await handler.selectFastMode();
        await handler.uploadImage(imagePath);
        await handler.enterPrompt(config.prompt);
        await handler.sendPrompt();
        await handler.waitForProcessingComplete();

        const outputPath = await buildOutputPath(config.outputDir, imagePath);
        await handler.downloadImage(outputPath);

        state.processed.push(imagePath);
        await saveState(config.outputDir, state);
        await appendLog(config.outputDir, `SUCCESS ${baseName} -> ${outputPath}`);

        successCount += 1;
        succeeded = true;

        const delayMs = getRandomDelay(config.minDelayMs, config.maxDelayMs);
        await delay(delayMs);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        await appendLog(
          config.outputDir,
          `ERROR ${baseName} attempt ${attempt}: ${message}`
        );
        if (attempt >= config.retries) {
          state.failed.push(imagePath);
          await saveState(config.outputDir, state);
          failureCount += 1;
        } else {
          const backoffMs = 30000 * Math.pow(2, attempt - 1);
          await delay(backoffMs);
        }
      }
    }
  }

  await appendLog(
    config.outputDir,
    `SUMMARY success=${successCount} failed=${failureCount}`
  );

  console.log(`Done. Success: ${successCount}, Failed: ${failureCount}`);
  await context.close();
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
