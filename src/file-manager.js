const fs = require('fs/promises');
const path = require('path');

const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg']);

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function listImages(inputDir) {
  const entries = await fs.readdir(inputDir);
  return entries
    .filter((name) => SUPPORTED_EXTS.has(path.extname(name).toLowerCase()))
    .sort()
    .map((name) => path.join(inputDir, name));
}

function getStatePath(outputDir) {
  return path.join(outputDir, 'processing-state.json');
}

async function loadState(outputDir) {
  const statePath = getStatePath(outputDir);
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      processed: Array.isArray(parsed.processed) ? parsed.processed : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed : []
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { processed: [], failed: [] };
    }
    throw err;
  }
}

async function saveState(outputDir, state) {
  const statePath = getStatePath(outputDir);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

async function buildOutputPath(outputDir, inputPath) {
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  let candidate = path.join(outputDir, `${base}_upscaled${ext}`);
  let counter = 2;

  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(outputDir, `${base}_upscaled_${counter}${ext}`);
      counter += 1;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return candidate;
      }
      throw err;
    }
  }
}

async function appendLog(outputDir, line) {
  const logPath = path.join(outputDir, 'processing.log');
  const timestamp = new Date().toISOString();
  await fs.appendFile(logPath, `[${timestamp}] ${line}\n`);
}

module.exports = {
  ensureDir,
  listImages,
  loadState,
  saveState,
  buildOutputPath,
  appendLog
};
