// 3D モックの静止画を書き出す。
// 使い方: リポジトリのルートで `node docs/mocks/3d/shoot.js [view ...]`
// （内部で http サーバを立てて、各 ?view= を 1280x800 / deviceScaleFactor 2 で撮影する）
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = __dirname;
const VIEWS = [
  ['terrain-overview', '01-terrain-overview.png'],
  ['terrain-dankai', '02-terrain-dankai.png'],
  ['terrain-war', '03-terrain-war.png'],
  ['terrain-cut-2025', '04-terrain-cut-2025.png'],
  ['pyramid-oblique', '05-pyramid-oblique.png'],
  ['pyramid-front', '06-pyramid-front.png'],
  ['color-height', '07-color-height.png'],
  ['mobile', '08-mobile.png'],
];
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const only = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [view, file] of VIEWS) {
    if (only.length && !only.includes(view)) continue;
    const mobile = view === 'mobile';
    const ctx = await browser.newContext({
      viewport: mobile ? { width: 375, height: 812 } : { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text()); });
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    await page.goto(`http://localhost:${port}/docs/mocks/3d/mock.html?view=${view}`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, file) });
    console.log('saved', file);
    await ctx.close();
  }
  await browser.close(); server.close();
})();
