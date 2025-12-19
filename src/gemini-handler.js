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
        return locator.first();
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
    this.log = config.log || (() => {});
  }

  _promptCandidates() {
    return [
      () => this.page.getByPlaceholder(/describe your image/i),
      () => this.page.getByRole('textbox'),
      () => this.page.locator('textarea'),
      () => this.page.locator('[contenteditable="true"]')
    ];
  }

  async ensureReadyForInput() {
    this.log('Ensuring prompt input is available...');
    const promptCandidates = this._promptCandidates();
    if (await this._checkAnyVisible(promptCandidates)) return;

    const newChatCandidates = [
      () => this.page.getByRole('button', { name: /new chat/i }),
      () => this.page.locator('[aria-label*="new chat" i]')
    ];

    for (const candidate of newChatCandidates) {
      const locator = candidate();
      if (await isVisible(locator)) {
        await locator.first().click();
        break;
      }
    }

    await waitForAnyVisible(this.page, promptCandidates, 10000);
    this.log('Prompt input ready.');
  }

  async ensureLoggedIn() {
    const loginIndicators = [
      () => this.page.getByText('PRO', { exact: false }),
      () => this.page.locator('[data-testid="pro-badge"]'),
      () => this.page.getByRole('button', { name: /new chat/i })
    ];

    this.log('Checking login state...');
    const isLoggedIn = await this._checkAnyVisible(loginIndicators);
    if (isLoggedIn) return;

    this.log('Login required. Please log in to Gemini in the opened browser.');
    await waitForAnyVisible(this.page, loginIndicators, 15 * 60 * 1000);
    this.log('Login detected.');
  }

  async selectFastMode() {
    this.log('Selecting Fast mode...');
    const modeButtonCandidates = [
      () => this.page.getByRole('button', { name: /fast/i }),
      () => this.page.getByRole('button', { name: /mode/i }),
      () => this.page.locator('[aria-label*="mode" i]'),
      () => this.page.locator('[data-test-id="bard-mode-menu-button"]')
    ];

    const fastOptionCandidates = [
      () => this.page.getByRole('option', { name: /^Fast$/i }),
      () => this.page.getByRole('menuitem', { name: /^Fast$/i }),
      () => this.page.getByText(/^Fast$/i)
    ];

    for (const candidate of modeButtonCandidates) {
      const locator = candidate();
      if (await isVisible(locator)) {
        await locator.first().click();
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
    this.log('Fast mode selected.');
  }

  async uploadImage(imagePath) {
    this.log(`Uploading image: ${imagePath}`);
    const input = this.page.locator('input[type="file"]');
    if (await input.count()) {
      await input.first().setInputFiles(imagePath);
      return;
    }

    const uploadButtonCandidates = [
      () => this.page.locator('[data-test-id*="upload" i]'),
      () => this.page.getByRole('button', { name: /upload/i }),
      () => this.page.getByRole('button', { name: /add file/i }),
      () => this.page.getByRole('button', { name: /\+/ })
    ];

    const button = await waitForAnyVisible(
      this.page,
      uploadButtonCandidates,
      5000
    );

    try {
      await button.click();
      await input.first().setInputFiles(imagePath);
    } catch (err) {
      const [chooser] = await Promise.all([
        this.page.waitForEvent('filechooser', { timeout: 5000 }),
        button.click()
      ]);
      await chooser.setFiles(imagePath);
    }
  }

  async enterPrompt(prompt) {
    this.log('Entering prompt...');
    const promptCandidates = this._promptCandidates();

    const promptBox = await waitForAnyVisible(
      this.page,
      promptCandidates,
      10000
    );
    await promptBox.fill(prompt);
  }

  async sendPrompt() {
    this.log('Sending prompt...');
    const sendCandidates = [
      () => this.page.locator('[data-test-id*="send" i]'),
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
    this.log('Waiting for processing to complete...');
    const loading = this.page.getByText(/loading nano banana/i);
    try {
      await loading.waitFor({ state: 'visible', timeout: 20000 });
      await loading.waitFor({ state: 'hidden', timeout: this.config.processingTimeoutMs });
    } catch (err) {
      // Continue to download check; Gemini may skip the loading indicator.
    }

    await this._waitForDownloadButtonWithHeartbeat();
    this.log('Processing complete; download button visible.');
  }

  async downloadImage(outputPath) {
    this.log(`Downloading to: ${outputPath}`);
    const downloadButton = await this._waitForDownloadButtonWithHeartbeat();
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

  async _waitForDownloadButtonWithHeartbeat() {
    const downloadCandidates = [
      () => this.page.getByRole('button', { name: /download full size/i }),
      () => this.page.getByRole('button', { name: /download/i }),
      () => this.page.locator('[aria-label*="download" i]')
    ];

    const start = Date.now();
    let lastLog = start;

    while (Date.now() - start < this.config.processingTimeoutMs) {
      for (const candidate of downloadCandidates) {
        const locator = candidate();
        if (await isVisible(locator)) {
          return locator;
        }
      }

      const now = Date.now();
      if (now - lastLog >= 10000) {
        const elapsed = Math.floor((now - start) / 1000);
        this.log(`Still waiting for download button... ${elapsed}s elapsed`);
        lastLog = now;
      }

      await delay(DEFAULT_POLL_MS);
    }

    throw new Error('Timeout waiting for download button.');
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
