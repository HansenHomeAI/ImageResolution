const os = require('os');
const path = require('path');

function resolveHomePath(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function buildConfig(args) {
  const inputDir = resolveHomePath(
    args.input || '~/Downloads/frames_DJI_0924_0926_3s/all/'
  );
  const outputDir = resolveHomePath(
    args.output || './output/upscaled_images/'
  );

  return {
    inputDir,
    outputDir,
    browserDataDir: resolveHomePath(args.browserData || './browser-data'),
    prompt:
      args.prompt ||
      'Can you please increase the resolution of this photo from 1920x1080 to be 4000x2250',
    mode: args.mode || 'Fast',
    minDelayMs: Number(args.minDelayMs || 10000),
    maxDelayMs: Number(args.maxDelayMs || 15000),
    retries: Number(args.retries || 3),
    processingTimeoutMs: Number(args.processingTimeoutMs || 5 * 60 * 1000),
    downloadTimeoutMs: Number(args.downloadTimeoutMs || 2 * 60 * 1000),
    limit: args.limit ? Number(args.limit) : undefined,
    verbose: args.verbose !== undefined ? Boolean(args.verbose) : true,
    forceUnlock: args.forceUnlock !== undefined ? Boolean(args.forceUnlock) : true
  };
}

module.exports = {
  buildConfig,
  resolveHomePath
};
