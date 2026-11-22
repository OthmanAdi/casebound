// Prints the WebGL renderer string and frame cadence a browser gives us, on about:blank (no site traffic).
// usage: node gpu-check.mjs [--browser msedge|chrome|chromium] [--headed]
import { launch, gpuInfo, isSoftwareGpu, parseArgs } from './lib/browser.mjs';

const args = parseArgs(process.argv.slice(2), { browser: 'msedge' });
const modes = args.headed ? [false] : args.both ? [true, false] : [true];
for (const headless of modes) {
  const s = await launch({ channel: args.browser, headless });
  try {
    await s.page.goto('about:blank');
    const gpu = await gpuInfo(s.page);
    await s.page.waitForTimeout(1500);
    const cadence = await s.page.evaluate(() => window.__CAP__.cadence());
    console.log(JSON.stringify({ browser: args.browser, version: s.version, headless, userAgent: s.userAgent, gpu, software: isSoftwareGpu(gpu.renderer), cadence }, null, 1));
  } finally { await s.close(); }
}
