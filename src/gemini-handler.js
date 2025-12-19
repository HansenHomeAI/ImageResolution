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
      () => this.page.locator('[data-test-id="prompt-textarea"]'),
      () => this.page.locator('[data-test-id*="prompt" i]'),
      () => this.page.locator('[data-test-id*="input" i]'),
      () => this.page.getByPlaceholder(/describe your image/i),
      () => this.page.getByRole('textbox'),
      () => this.page.locator('textarea'),
      () => this.page.locator('[contenteditable="true"]')
    ];
  }

  async captureDebug(label, outputDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeLabel = label.replace(/[^a-zA-Z0-9-_]/g, '_');
    const base = `debug-${safeLabel}-${timestamp}`;
    const screenshotPath = `${outputDir}/${base}.png`;
    const htmlPath = `${outputDir}/${base}.html`;
    const urlPath = `${outputDir}/${base}.url.txt`;

    try {
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (err) {
      this.log(`Debug screenshot failed: ${err.message || err}`);
    }

    try {
      const html = await this.page.content();
      await fs.writeFile(htmlPath, html);
    } catch (err) {
      this.log(`Debug HTML dump failed: ${err.message || err}`);
    }

    try {
      const url = this.page.url();
      await fs.writeFile(urlPath, url);
    } catch (err) {
      this.log(`Debug URL dump failed: ${err.message || err}`);
    }

    this.log(`Saved debug artifacts: ${base}.*`);
  }

  async ensureReadyForInput() {
    this.log('Ensuring prompt input is available...');
    const promptCandidates = this._promptCandidates();
    if (await this._checkAnyVisible(promptCandidates)) {
      this.log('Prompt input already visible.');
      return;
    }

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
    const signInIndicators = [
      () => this.page.getByRole('link', { name: /sign in/i }),
      () => this.page.getByRole('button', { name: /sign in/i }),
      () => this.page.locator('a[href*="signin"]')
    ];

    this.log('Checking login state...');
    if (await this._checkAnyVisible(signInIndicators)) {
      this.log('Sign-in prompt detected. Please log in to Gemini in the opened browser.');
      await waitForAnyVisible(
        this.page,
        [() => this.page.locator('[data-test-id="bard-mode-menu-button"]')],
        15 * 60 * 1000
      );
    }

    const sendButton = this.page.getByRole('button', { name: /send message/i });
    try {
      const ariaDisabled = await sendButton.first().getAttribute('aria-disabled');
      if (ariaDisabled && ariaDisabled !== 'false') {
        this.log('Send button disabled; waiting for login to complete.');
        await waitForAnyVisible(
          this.page,
          [() => this.page.locator('[data-test-id="bard-mode-menu-button"]')],
          15 * 60 * 1000
        );
      }
    } catch (err) {
      // If send button check fails, continue with mode/menu indicators.
    }

    await waitForAnyVisible(
      this.page,
      [() => this.page.locator('[data-test-id="bard-mode-menu-button"]')],
      15 * 60 * 1000
    );
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

    let modeButton = null;
    for (const candidate of modeButtonCandidates) {
      const locator = candidate();
      if (await isVisible(locator)) {
        modeButton = locator.first();
        break;
      }
    }

    if (!modeButton) {
      this.log('Mode selector not found; skipping Fast selection.');
      return;
    }

    await modeButton.click();

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
        this.log('Fast option not found after opening mode menu.');
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

    const shadowInputHandle = await this.page.evaluateHandle(() => {
      const uploader = document.querySelector('uploader');
      if (!uploader || !uploader.shadowRoot) return null;
      return uploader.shadowRoot.querySelector('input[type="file"]');
    });
    const shadowInput = shadowInputHandle.asElement();
    if (shadowInput) {
      await shadowInput.setInputFiles(imagePath);
      await shadowInputHandle.dispose();
      return;
    }
    await shadowInputHandle.dispose();

    const hiddenImageButton = this.page.locator(
      '[data-test-id="hidden-local-image-upload-button"]'
    );
    if (await hiddenImageButton.count()) {
      try {
        const [chooser] = await Promise.all([
          this.page.waitForEvent('filechooser', { timeout: 15000 }),
          hiddenImageButton.first().click({ force: true })
        ]);
        await chooser.setFiles(imagePath);
        return;
      } catch (err) {
        this.log(`Hidden upload button click failed: ${err.message || err}`);
      }
    }

    const uploadButtonCandidates = [
      () => this.page.locator('[data-test-id*="upload" i]'),
      () => this.page.getByRole('button', { name: /upload/i }),
      () => this.page.getByRole('button', { name: /add file/i }),
      () => this.page.getByRole('button', { name: /\+/ }),
      () => this.page.getByRole('button', { name: /open upload file menu/i })
    ];

    const button = await waitForAnyVisible(
      this.page,
      uploadButtonCandidates,
      5000
    );

    try {
      await button.click();
      const menuItemCandidates = [
        () => this.page.getByRole('menuitem', { name: /upload image/i }),
        () => this.page.getByRole('menuitem', { name: /upload/i })
      ];
      const menuItem = await waitForAnyVisible(
        this.page,
        menuItemCandidates,
        5000
      );
      const [chooser] = await Promise.all([
        this.page.waitForEvent('filechooser', { timeout: 15000 }),
        menuItem.click()
      ]);
      await chooser.setFiles(imagePath);
    } catch (err) {
      const [chooser] = await Promise.all([
        this.page.waitForEvent('filechooser', { timeout: 15000 }),
        button.click({ force: true })
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
