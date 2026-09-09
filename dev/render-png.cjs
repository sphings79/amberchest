/**
 * Renders an SVG to PNG using the Chromium that ships with Electron.
 *
 * GitHub only accepts PNG/JPG for the social preview and this repository has no
 * other image tooling. CommonJS on purpose: Electron loads a .cjs entry point
 * without the ESM caveats.
 *
 *   npx electron dev/render-png.cjs assets/social-preview.svg assets/social-preview.png 1280 640
 */
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');

const [, , input, output, widthArg, heightArg] = process.argv;
const width = Number(widthArg || 1280);
const height = Number(heightArg || 640);

if (!input || !output) {
  console.error('usage: electron dev/render-png.cjs <input.svg> <output.png> [width] [height]');
  app.exit(1);
}

app.whenReady().then(async () => {
  try {
    const svg = readFileSync(resolve(input), 'utf8');
    const page = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style>
${svg}`;

    const tmpPage = join(tmpdir(), `amberchest-render-${process.pid}.html`);
    writeFileSync(tmpPage, page, 'utf8');

    const win = new BrowserWindow({
      width,
      height,
      show: false,
      useContentSize: true,
      backgroundColor: '#00000000',
    });

    await win.loadFile(tmpPage);
    // Give the renderer a moment to lay out fonts before capturing.
    await new Promise((done) => setTimeout(done, 800));

    const image = await win.webContents.capturePage();
    writeFileSync(resolve(output), image.toPNG());
    unlinkSync(tmpPage);
    console.log(`wrote ${output} (${image.getSize().width}x${image.getSize().height})`);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
  app.quit();
});
