// Shared browser discovery for the headless tools (Windows dev box with a GPU, or a GPU-less Linux sandbox).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

// Chrome for Testing installed by: npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/cozy-chrome
function cachedHeadlessShell() {
  const base = path.join(os.homedir(), '.cache', 'cozy-chrome', 'chrome-headless-shell');
  try {
    for (const d of fs.readdirSync(base).sort().reverse()) {
      const p = path.join(base, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) { /* not installed */ }
  return null;
}

export const CHROME = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  cachedHeadlessShell(),
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(p => fs.existsSync(p));

if (!CHROME) {
  console.error('[chrome] no browser found. Set CHROME_PATH or run: npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/cozy-chrome');
  process.exit(2);
}

// Recent Chrome only falls back to SwiftShader (software WebGL) when explicitly allowed; in containers the separate
// GPU process fails to start, so it has to run in-process.
export const GPU_ARGS = process.platform === 'win32'
  ? ['--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--in-process-gpu', '--disable-dev-shm-usage',
    '--ignore-gpu-blocklist', '--no-sandbox'];

export function pageUrl(htmlPath, query) {
  return pathToFileURL(htmlPath).href + '?' + query;
}
