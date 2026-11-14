import { spawn } from 'node:child_process';

function launch(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Opens a URL in the default browser. */
export function openBrowser(url: string): Promise<boolean> {
  // Windows: `start` in cmd would cut the URL at the first "&", so use the URL protocol handler.
  if (process.platform === 'win32') return launch('rundll32', ['url.dll,FileProtocolHandler', url]);
  if (process.platform === 'darwin') return launch('open', [url]);
  return launch('xdg-open', [url]);
}

/**
 * Opens a URL in a chromeless "app" window (Chrome / Edge / Chromium --app) so the GUI
 * looks like a desktop application; falls back to the default browser.
 */
export async function openAppWindow(url: string): Promise<void> {
  const app = `--app=${url}`;
  const candidates: [string, string[]][] =
    process.platform === 'win32'
      ? [
          ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [app]],
          ['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', [app]],
          ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [app]],
        ]
      : process.platform === 'darwin'
        ? [
            ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [app]],
            ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', [app]],
            ['/Applications/Chromium.app/Contents/MacOS/Chromium', [app]],
          ]
        : [
            ['google-chrome', [app]],
            ['chromium', [app]],
            ['chromium-browser', [app]],
            ['microsoft-edge', [app]],
          ];
  for (const [cmd, args] of candidates) if (await launch(cmd, args)) return;
  await openBrowser(url);
}
