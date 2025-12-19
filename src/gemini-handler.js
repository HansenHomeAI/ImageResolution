const fs = require('fs/promises');

const DEFAULT_POLL_MS = 1000;

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isVisible(locator) {
  try {
    return await locator.first().isVisible();
  } catch (err) {
    return false;
  }
}

async function waitForAnyVisible(page, locatorFactories, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const factory of locatorFactories) {
      const locator = factory();
      if (await isVisible(locator)) {
        return locator;
      }
    }
    await delay(DEFAULT_POLL_MS);
  }
  throw new Error('Timeout waiting for expected UI element.');
}

class GeminiHandler {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  async ensureLoggedIn() {
    const loginIndicators = [
      () => this.page.getByText('PRO', { exact: false }),
      () => this.page.locator('[data-testid="pro-badge"]'),
      () => this.page.getByRole('button', { name: /new chat/i })
    ];

    const isLoggedIn = await this._checkAnyVisible(loginIndicators);
    if (isLoggedIn) return;

    console.log('Login required. Please log in to Gemini in the opened browser.');
    await waitForAnyVisible(this.page, loginIndicators, 15 * 60 * 1000);
  }

  async selectFastMode() {
    const modeButtonCandidates = [
      () => this.page.getByRole('button', { name: /fast/i }),
      () => this.page.getByRole('button', { name: /mode/i }),
      () => this.page.locator('[aria-label*="mode" i]')
    ];

    const fastOptionCandidates = [
      () => this.page.getByRole('option', { name: /^Fast$/i }),
      () => this.page.getByRole('menuitem', { name: /^Fast$/i }),
      () => this.page.getByText(/^Fast$/i)
    ];

    for (const candidate of modeButtonCandidates) {
      const locator = candidate();
      if (await isVisible(locator)) {
        await locator.click();
        break;
      }
    }

    try {
      const option = await waitForAnyVisible(
        this.page,
        fastOptionCandidates,
        5000
      );
      await option.click();
    } catch (err) {
      const fastSelected = await this._checkAnyVisible([
        () => this.page.getByRole('button', { name: /fast/i })
      ]);
      if (!fastSelected) {
        throw err;
      }
    }
  }

  async uploadImage(imagePath) {
    const input = this.page.locator('input[type="file"]');
    if (await input.count()) {
      await input.first().setInputFiles(imagePath);
      return;
    }

    const uploadButtonCandidates = [
      () => this.page.getByRole('button', { name: /upload/i }),
      () => this.page.getByRole('button', { name: /add file/i }),
      () => this.page.getByRole('button', { name: /\+/ })
    ];

    const button = await waitForAnyVisible(
      this.page,
      uploadButtonCandidates,
      5000
    );
    await button.click();
    await input.first().setInputFiles(imagePath);
  }

  async enterPrompt(prompt) {
    const promptCandidates = [
      () => this.page.getByPlaceholder(/describe your image/i),
      () => this.page.getByRole('textbox'),
      () => this.page.locator('textarea')
    ];

    const promptBox = await waitForAnyVisible(
      this.page,
      promptCandidates,
      10000
    );
    await promptBox.fill(prompt);
  }

  async sendPrompt() {
    const sendCandidates = [
      () => this.page.getByRole('button', { name: /send/i }),
      () => this.page.locator('[aria-label*="send" i]')
    ];

    try {
      const button = await waitForAnyVisible(
        this.page,
        sendCandidates,
        5000
      );
      await button.click();
    } catch (err) {
      await this.page.keyboard.press('Enter');
    }
  }

  async waitForProcessingComplete() {
    const loading = this.page.getByText(/loading nano banana/i);
    try {
      await loading.waitFor({ state: 'visible', timeout: 20000 });
      await loading.waitFor({ state: 'hidden', timeout: this.config.processingTimeoutMs });
    } catch (err) {
      // Continue to download check; Gemini may skip the loading indicator.
    }

    await this._waitForDownloadButton();
  }

  async downloadImage(outputPath) {
    const downloadButton = await this._waitForDownloadButton();
    const [download] = await Promise.all([
      this.page.waitForEvent('download', {
        timeout: this.config.downloadTimeoutMs
      }),
      downloadButton.click()
    ]);

    await download.saveAs(outputPath);

    const stats = await fs.stat(outputPath);
    if (!stats.size) {
      throw new Error(`Downloaded file is empty: ${outputPath}`);
    }
  }

  async _waitForDownloadButton() {
    const downloadCandidates = [
      () => this.page.getByRole('button', { name: /download full size/i }),
      () => this.page.getByRole('button', { name: /download/i }),
      () => this.page.locator('[aria-label*="download" i]')
    ];

    return waitForAnyVisible(
      this.page,
      downloadCandidates,
      this.config.processingTimeoutMs
    );
  }

  async _checkAnyVisible(locatorFactories) {
    for (const factory of locatorFactories) {
      const locator = factory();
      if (await isVisible(locator)) {
        return true;
      }
    }
    return false;
  }
}

module.exports = {
  GeminiHandler,
  delay
};
