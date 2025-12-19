const path = require('path');
const minimist = require('minimist');
const { chromium } = require('playwright');
const fs = require('fs/promises');
const { execSync } = require('child_process');

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

async function cleanupProfileLocks(config, log) {
  const entries = await fs.readdir(config.browserDataDir).catch(() => []);
  const lockFiles = entries.filter((name) => name.startsWith('Singleton'));
  if (!lockFiles.length || !config.forceUnlock) return;

  let hasChromeTesting = false;
  if (process.platform === 'darwin') {
    try {
      const psOutput = execSync('ps -ax').toString();
      hasChromeTesting = psOutput.includes('Google Chrome for Testing');
    } catch (err) {
      // If ps fails, skip cleanup to be safe.
      hasChromeTesting = true;
    }
  }

  if (hasChromeTesting) {
    throw new Error(
      'Chrome for Testing appears to be running; close it before retrying.'
    );
  }

  for (const name of lockFiles) {
    await fs.rm(path.join(config.browserDataDir, name), { force: true });
  }
  log('Removed stale profile lock files.');
}

async function run() {
  const args = minimist(process.argv.slice(2));
  const config = buildConfig(args);
  const log = config.verbose ? console.log : () => {};
  config.log = log;

  log('Starting Gemini upscaler...');
  await ensureDir(config.outputDir);
  await ensureDir(config.browserDataDir);
  await cleanupProfileLocks(config, log);

  const state = await loadState(config.outputDir);
  const allImages = await listImages(config.inputDir);
  const pending = allImages.filter((file) => !state.processed.includes(file));
  const limited = config.limit ? pending.slice(0, config.limit) : pending;

  if (!limited.length) {
    console.log('No images to process.');
    return;
  }

  log(`Launching browser with profile at ${config.browserDataDir}`);
  const context = await chromium.launchPersistentContext(
    config.browserDataDir,
    {
      headless: false,
      viewport: { width: 1920, height: 1080 }
    }
  );

  const page = await context.newPage();
  const handler = new GeminiHandler(page, config);

  log('Navigating to Gemini...');
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
      let currentStep = 'init';
      try {
        log(`Processing ${baseName} (attempt ${attempt}/${config.retries})`);
        currentStep = 'ensure-ready';
        await handler.ensureReadyForInput();
        currentStep = 'select-fast';
        await handler.selectFastMode();
        currentStep = 'upload';
        await handler.uploadImage(imagePath);
        currentStep = 'prompt';
        await handler.enterPrompt(config.prompt);
        currentStep = 'send';
        await handler.sendPrompt();
        currentStep = 'processing';
        await handler.waitForProcessingComplete();

        currentStep = 'download';
        const outputPath = await buildOutputPath(config.outputDir, imagePath);
        await handler.downloadImage(outputPath);

        state.processed.push(imagePath);
        await saveState(config.outputDir, state);
        await appendLog(config.outputDir, `SUCCESS ${baseName} -> ${outputPath}`);

        successCount += 1;
        succeeded = true;

        const delayMs = getRandomDelay(config.minDelayMs, config.maxDelayMs);
        log(`Waiting ${delayMs}ms before next image...`);
        await delay(delayMs);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        const stepMessage = `step=${currentStep} ${message}`;
        await appendLog(
          config.outputDir,
          `ERROR ${baseName} attempt ${attempt}: ${stepMessage}`
        );
        if (config.debug) {
          await handler.captureDebug(
            `${baseName}-attempt-${attempt}-${currentStep}`,
            config.outputDir
          );
        }
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
