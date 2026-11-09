'use strict';
// 人口ピラミッドの E2E スモークテスト。仕様は docs/PLAN.md §4, §6。
// 使い方: node tests/e2e/smoke.cjs --base http://localhost:8000 [--fixture] [--out DIR]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

function parseArgs(argv) {
  const a = { base: 'http://localhost:8000', fixture: false, out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--base') a.base = argv[++i];
    else if (argv[i] === '--fixture') a.fixture = true;
    else if (argv[i] === '--out') a.out = argv[++i];
    else throw new Error('不明な引数: ' + argv[i]);
  }
  a.base = a.base.replace(/\/+$/, '');
  return a;
}
const args = parseArgs(process.argv);

const KEY_YEARS = [1920, 1940, 1945, 1950, 1966, 1972, 1980, 2000, 2025];
const DESKTOP = { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' };
const DESKTOP_MOTION = { viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' };
const MOBILE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const problems = []; // 全ページ共通の console error 等

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('PASS  ' + name);
  } catch (e) {
    results.push({ name, ok: false, msg: e.message });
    console.log('FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        '));
  }
}

async function openPage(browser, opts, label, extra) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const mine = [];
  const rec = (kind, text) => { const p = `[${label}] ${kind}: ${text}`; mine.push(p); problems.push(p); };
  page.on('console', (m) => { if (m.type() === 'error') rec('console.error', m.text()); });
  page.on('pageerror', (e) => rec('pageerror', e.message));
  page.on('requestfailed', (r) => rec('requestfailed', `${r.url()} ${r.failure() && r.failure().errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) rec('http' + r.status(), r.url()); });
  const q = [];
  if (args.fixture) q.push('fixture=1');
  if (extra) q.push(extra);
  await page.goto(`${args.base}/${q.length ? '?' + q.join('&') : ''}`, { waitUntil: 'load' });
  await page.waitForSelector('body[data-ready="true"]', { timeout: 20000 });
  return { ctx, page, mine };
}

const waitYear = (page, y, timeout = 5000) =>
  page.waitForFunction((yy) => document.body.dataset.year === String(yy), y, { timeout });
async function setYear(page, y, wait = true) {
  await page.evaluate((yy) => window.__app.store.setYear(yy, {}), y);
  if (wait) await waitYear(page, y);
}
const getData = (page) => page.evaluate(() => window.__app.data);
const yearRec = (data, y) => data.years.find((r) => r.year === y);

const readBars = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('rect.bar')].map((r) => ({
      sex: r.dataset.sex, age: +r.dataset.age, value: r.dataset.value, w: r.getBoundingClientRect().width,
    })));

function estimateHalfWidth(bars, xMax) {
  let best = null;
  for (const b of bars) if (b.value !== '' && +b.value > 0 && (!best || +b.value > +best.value)) best = b;
  assert(best, '値が正の棒がありません');
  return (best.w * xMax) / +best.value;
}
function verifyBars(bars, rec, xMax, hw, tol = 0.5) {
  const bad = [];
  for (const b of bars) {
    const arr = b.sex === 'male' ? rec.male : rec.female;
    const v = arr[b.age];
    const expDv = v === null ? '' : String(v);
    if (b.value !== expDv) bad.push(`${b.sex}/${b.age}: data-value=${JSON.stringify(b.value)} 期待=${JSON.stringify(expDv)}`);
    const expW = v === null ? 0 : (v / xMax) * hw;
    if (Math.abs(b.w - expW) > tol) bad.push(`${b.sex}/${b.age}: width=${b.w.toFixed(2)} 期待=${expW.toFixed(2)}`);
  }
  assert(bad.length === 0, `${rec.year}年 ${bad.length}本が不一致:\n` + bad.slice(0, 8).join('\n'));
}

// ---- ツールチップの期待値（PLAN §4）----
function fmtPeople(v, precision) {
  if (precision === 1) return v.toLocaleString('en-US') + '人';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万人';
  return v.toLocaleString('en-US') + '人';
}
function fmtTotal(v) {
  const m = Math.round(v / 1e4);
  const oku = Math.floor(m / 1e4), rest = m % 1e4;
  return (oku > 0 ? `${oku}億` : '') + `${rest.toLocaleString('en-US')}万人`;
}

const visibleTooltip = (page) =>
  page.evaluate(() => {
    const t = document.getElementById('tooltip');
    if (!t || t.hasAttribute('hidden')) return null;
    const cs = getComputedStyle(t);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    return t.textContent;
  });

async function barCenter(page, sex, age) {
  const loc = page.locator(`rect.bar[data-sex="${sex}"][data-age="${age}"]`);
  await loc.scrollIntoViewIfNeeded();
  const bb = await loc.boundingBox();
  assert(bb, `棒 ${sex}/${age} の位置を取得できません`);
  return { x: bb.x + Math.max(bb.width / 2, 0.5), y: bb.y + bb.height / 2 };
}

async function calloutInfo(page) {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('.callout[data-note]')].filter(
      (e) => !e.hasAttribute('hidden') && getComputedStyle(e).display !== 'none');
    if (all.length !== 1) return { count: all.length };
    const el = all[0];
    const parts = [...el.querySelectorAll('*')].filter((n) => !/^(line|path|polyline|tspan|title|desc)$/i.test(n.tagName));
    const rects = (parts.length ? parts : [el]).map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) rects.push(el.getBoundingClientRect());
    const l = Math.min(...rects.map((r) => r.left)), t = Math.min(...rects.map((r) => r.top));
    const r = Math.max(...rects.map((x) => x.right)), b = Math.max(...rects.map((x) => x.bottom));
    const bars = [...document.querySelectorAll('rect.bar')].map((x) => {
      const q = x.getBoundingClientRect();
      return { sex: x.dataset.sex, age: x.dataset.age, l: q.left, t: q.top, r: q.right, b: q.bottom };
    }).filter((q) => q.r - q.l > 0);
    return { count: 1, note: el.dataset.note, box: { l, t, r, b }, bars };
  });
}

const accName = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const lb = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
    return (el.getAttribute('aria-label') || lb ||
      [...(el.labels || [])].map((l) => l.textContent).join(' ').trim() ||
      (el.textContent || '').trim() || el.getAttribute('title') || '').trim();
  }, sel);

async function main() {
  const browser = await chromium.launch();
  let data = null;

  try {
    // ---- 1. エラー0件 ----
    const d = await openPage(browser, DESKTOP, 'desktop');
    const dp = d.page;
    data = await getData(dp);
    await check('1. 初回ロードで console error / pageerror / 失敗リクエスト / HTTP>=400 が0件', async () => {
      await sleep(300);
      assert(d.mine.length === 0, d.mine.join('\n'));
    });
    const xMax = data.xMaxPerSex;

    // ---- 2. 棒 ----
    await check('2. rect.bar が202本', async () => {
      assert((await dp.locator('rect.bar').count()) === 202, `本数=${await dp.locator('rect.bar').count()}`);
    });
    let hw = null;
    await check('2. 1950年の棒の幅 = value/xMaxPerSex×halfWidth（±0.5px、nullは0）', async () => {
      await setYear(dp, 1950);
      await sleep(150);
      const bars = await readBars(dp);
      hw = estimateHalfWidth(bars, xMax);
      assert(hw > 50 && hw <= 640, `推定 halfWidth が不自然: ${hw}`);
      verifyBars(bars, yearRec(data, 1950), xMax, hw);
    });

    // ---- 年表示 ----
    await check('年表示: #year-display に「1950年」、#total-display に総人口の書式', async () => {
      await setYear(dp, 1950);
      const yd = await dp.locator('#year-display').textContent();
      assert(yd.includes('1950年'), `year-display=${yd}`);
      const td = await dp.locator('#total-display').textContent();
      const exp = fmtTotal(yearRec(data, 1950).total.both);
      assert(td.includes(exp), `total-display=${td} 期待を含む=${exp}`);
    });

    // ---- 3. スライダーのキー操作 ----
    await check('3. 1940年で ArrowRight → 1944、ArrowLeft → 1940', async () => {
      await setYear(dp, 1940);
      await dp.focus('#year-slider');
      await dp.keyboard.press('ArrowRight');
      await waitYear(dp, 1944, 2000);
      assert((await dp.inputValue('#year-slider')) === '1944', 'スライダー値が1944でない');
      await dp.keyboard.press('ArrowLeft');
      await waitYear(dp, 1940, 2000);
      assert((await dp.inputValue('#year-slider')) === '1940', 'スライダー値が1940でない');
    });
    await check('3. ?year=1942 で開くと 1940', async () => {
      const p = await openPage(browser, DESKTOP, 'year1942', 'year=1942');
      try {
        const y = await p.page.evaluate(() => document.body.dataset.year);
        const v = await p.page.inputValue('#year-slider');
        assert(y === '1940' && v === '1940', `data-year=${y}, slider=${v}`);
      } finally { await p.ctx.close(); }
    });

    // ---- 4. 再生 ----
    await check('4. 再生2秒後に2年以上進み aria-label が「一時停止」', async () => {
      const p = await openPage(browser, DESKTOP_MOTION, 'play');
      try {
        const pg = p.page;
        await setYear(pg, 1920);
        await pg.click('#btn-play');
        await sleep(2000);
        const y = +(await pg.evaluate(() => document.body.dataset.year));
        const lb = await pg.getAttribute('#btn-play', 'aria-label');
        assert(y >= 1922, `2秒後の年=${y}`);
        assert(lb === '一時停止', `aria-label=${lb}`);
        await pg.click('#btn-play');
        assert((await pg.getAttribute('#btn-play', 'aria-label')) === '再生', '一時停止後に「再生」へ戻らない');
      } finally { await p.ctx.close(); }
    });
    await check('4. 1939年から再生すると 1941〜43年を経由しない', async () => {
      const p = await openPage(browser, DESKTOP_MOTION, 'play-gap');
      try {
        const pg = p.page;
        await setYear(pg, 1939);
        await pg.evaluate(() => {
          window.__yrs = [document.body.dataset.year];
          new MutationObserver(() => window.__yrs.push(document.body.dataset.year))
            .observe(document.body, { attributes: true, attributeFilter: ['data-year'] });
        });
        await pg.click('#btn-play');
        await sleep(2000);
        await pg.click('#btn-play');
        const yrs = (await pg.evaluate(() => window.__yrs)).map(Number);
        assert(!yrs.some((y) => y >= 1941 && y <= 1943), `記録した年: ${yrs.join(',')}`);
        assert(yrs.includes(1940) && yrs.includes(1944), `1940→1944 に進んでいない: ${yrs.join(',')}`);
      } finally { await p.ctx.close(); }
    });
    await check('4. 2024年から再生すると2025年で停止し aria-label が「再生」に戻る', async () => {
      const p = await openPage(browser, DESKTOP_MOTION, 'play-end');
      try {
        const pg = p.page;
        await setYear(pg, 2024);
        await pg.click('#btn-play');
        await pg.waitForFunction(() => document.getElementById('btn-play').getAttribute('aria-label') === '再生', null, { timeout: 5000 });
        assert((await pg.evaluate(() => document.body.dataset.year)) === '2025', '2025年で止まっていない');
        assert((await pg.evaluate(() => window.__app.store.getState().playing)) === false, 'playing が false でない');
        await sleep(900);
        assert((await pg.evaluate(() => document.body.dataset.year)) === '2025', '停止後に年が変わった');
      } finally { await p.ctx.close(); }
    });
    await check('4. #btn-rewind で1920へ戻り停止する', async () => {
      const p = await openPage(browser, DESKTOP_MOTION, 'rewind');
      try {
        const pg = p.page;
        await setYear(pg, 1950);
        await pg.click('#btn-rewind');
        await waitYear(pg, 1920, 2000);
        await pg.click('#btn-play');
        await sleep(600);
        await pg.click('#btn-rewind');
        await sleep(900);
        assert((await pg.evaluate(() => document.body.dataset.year)) === '1920', '再生中の巻き戻し後に1920でない');
        assert((await pg.evaluate(() => window.__app.store.getState().playing)) === false, '巻き戻し後に再生が止まっていない');
        assert((await pg.getAttribute('#btn-play', 'aria-label')) === '再生', 'aria-label が「再生」でない');
        assert((await pg.getAttribute('#btn-rewind', 'aria-label')) === '最初に戻る', 'rewind の aria-label が「最初に戻る」でない');
      } finally { await p.ctx.close(); }
    });

    // ---- 5. ツールチップ ----
    const tooltipExpect = (rec) => {
      const need = ['30歳', '1969年10月〜1970年9月生まれ',
        fmtPeople(rec.male[30], rec.precision), fmtPeople(rec.female[30], rec.precision)];
      return need;
    };
    await check('5. 2000年 男性30歳の棒にホバー → ツールチップに年齢・出生年・男女の人数', async () => {
      await setYear(dp, 2000);
      await sleep(150);
      await dp.mouse.move(5, 5);
      const c = await barCenter(dp, 'male', 30);
      await dp.mouse.move(c.x, c.y);
      await dp.waitForFunction(() => { const t = document.getElementById('tooltip'); return t && !t.hasAttribute('hidden'); }, null, { timeout: 2000 });
      const txt = await visibleTooltip(dp);
      assert(txt !== null, '#tooltip が表示されない');
      const miss = tooltipExpect(yearRec(data, 2000)).filter((s) => !txt.includes(s));
      assert(miss.length === 0, `欠けている文字列: ${miss.join(' | ')}\n実際: ${txt}`);
    });

    // ---- 6. コホート ----
    const cohort = (page, id) =>
      page.evaluate((i) => {
        const el = document.querySelector(`.cohort[data-cohort="${i}"]`);
        if (!el) return null;
        return { hidden: el.hasAttribute('hidden'), min: el.getAttribute('data-age-min'), max: el.getAttribute('data-age-max') };
      }, id);
    await check('6. 1950年 団塊: data-age-min=1, data-age-max=3', async () => {
      await setYear(dp, 1950);
      const c = await cohort(dp, 'dankai');
      assert(c && !c.hidden && c.min === '1' && c.max === '3', JSON.stringify(c));
    });
    await check('6. 1965年 丙午は hidden / 1966年は age 0', async () => {
      await setYear(dp, 1965);
      const c1 = await cohort(dp, 'hinoeuma');
      assert(c1 && c1.hidden, `1965: ${JSON.stringify(c1)}`);
      await setYear(dp, 1966);
      const c2 = await cohort(dp, 'hinoeuma');
      assert(c2 && !c2.hidden && c2.min === '0' && c2.max === '0', `1966: ${JSON.stringify(c2)}`);
    });

    // ---- 7. 注記 ----
    await check('7. 1945年: 数え年・沖縄バッジがあり、0歳の棒の幅が0', async () => {
      await setYear(dp, 1945);
      await sleep(150);
      assert((await dp.locator('.badge[data-note="kazoe"]').count()) >= 1, 'kazoe バッジなし');
      assert((await dp.locator('.badge[data-note="no-okinawa"]').count()) >= 1, 'no-okinawa バッジなし');
      const bars = await readBars(dp);
      const z = bars.filter((b) => b.age === 0);
      assert(z.length === 2 && z.every((b) => b.w === 0 || b.w < 0.01), `0歳の棒: ${JSON.stringify(z)}`);
    });
    await check('7. 1972年に no-okinawa バッジが無い', async () => {
      await setYear(dp, 1972);
      assert((await dp.locator('.badge[data-note="no-okinawa"]').count()) === 0, 'バッジが残っている');
    });
    await check('7. 2025年に #notes-list li[data-note=unknown-age]', async () => {
      await setYear(dp, 2025);
      assert((await dp.locator('#notes-list li[data-note="unknown-age"]').count()) === 1, 'li が無い');
    });

    // ---- 8. 吹き出し（デスクトップ・モバイル）----
    const overlapCheck = (page, label) => check(`8. 吹き出しがどの棒とも重ならない（${label}、主要年）`, async () => {
      const bad = [];
      for (const y of KEY_YEARS) {
        await setYear(page, y);
        await sleep(120);
        const info = await calloutInfo(page);
        if (info.count !== 1) { bad.push(`${y}年: 表示中の .callout が ${info.count} 個`); continue; }
        const o = info.box;
        const hit = info.bars.find((b) => Math.min(o.r, b.r) - Math.max(o.l, b.l) > 0.5 && Math.min(o.b, b.b) - Math.max(o.t, b.t) > 0.5);
        if (hit) bad.push(`${y}年: ${info.note} が棒 ${hit.sex}/${hit.age} と重なる`);
      }
      assert(bad.length === 0, bad.join('\n'));
    });
    await overlapCheck(dp, '1280px');

    // ---- 10. reducedMotion ----
    await check('10. reducedMotion: 年変更50ms後に最終の幅になっている', async () => {
      await setYear(dp, 2000);
      await sleep(300);
      const settled = estimateHalfWidth(await readBars(dp), xMax);
      await dp.evaluate(() => window.__app.store.setYear(1950, {}));
      await sleep(50);
      verifyBars(await readBars(dp), yearRec(data, 1950), xMax, settled);
    });

    // ---- 11. アクセシビリティ ----
    await check('11. ボタン・スライダーに名前、スライダーに aria-valuetext、SVG に aria-label', async () => {
      await setYear(dp, 1945);
      const bad = [];
      const names = await dp.evaluate(() => [...document.querySelectorAll('button')].map((b) => ({
        id: b.id, name: (b.getAttribute('aria-label') || b.textContent || b.title || '').trim() })));
      assert(names.length >= 2, 'ボタンが2個未満');
      for (const n of names) if (!n.name) bad.push(`名前なしボタン: #${n.id}`);
      for (const id of ['btn-play', 'btn-rewind'])
        if (!(await accName(dp, '#' + id))) bad.push(`#${id} に名前なし`);
      if (!(await accName(dp, '#year-slider'))) bad.push('スライダーに名前なし');
      const vt = await dp.getAttribute('#year-slider', 'aria-valuetext');
      const rec = yearRec(data, 1945);
      const [, m, dd] = rec.refDate.split('-').map(Number);
      const expVt = `1945年（数え年・${m}月${dd}日現在）`;
      if (vt !== expVt) bad.push(`aria-valuetext=${JSON.stringify(vt)} 期待=${JSON.stringify(expVt)}`);
      const svgs = await dp.evaluate(() => [...document.querySelectorAll('svg[role="img"]')]
        .map((s) => (s.getAttribute('aria-label') || '').trim()));
      if (!svgs.length || svgs.some((l) => !l)) bad.push(`role=img の SVG の aria-label: ${JSON.stringify(svgs)}`);
      else if (!svgs.some((l) => l.includes('1945'))) bad.push(`aria-label に年が含まれない: ${JSON.stringify(svgs)}`);
      assert(bad.length === 0, bad.join('\n'));
    });
    await d.ctx.close();

    // ---- 5(モバイル)・8・9: 375px ----
    const m = await openPage(browser, MOBILE, 'mobile');
    const mp = m.page;
    await check('5. 375px: 2000年 男性30歳の棒をタップするとツールチップが表示される', async () => {
      await setYear(mp, 2000);
      await sleep(150);
      const c = await barCenter(mp, 'male', 30);
      await mp.touchscreen.tap(c.x, c.y);
      await mp.waitForFunction(() => { const t = document.getElementById('tooltip'); return t && !t.hasAttribute('hidden'); }, null, { timeout: 2000 });
      const txt = await visibleTooltip(mp);
      assert(txt !== null, '#tooltip が表示されない');
      const miss = tooltipExpect(yearRec(data, 2000)).filter((s) => !txt.includes(s));
      assert(miss.length === 0, `欠けている文字列: ${miss.join(' | ')}\n実際: ${txt}`);
    });
    await check('9. 375px: 横スクロールなし、ボタンが画面内', async () => {
      const bad = [];
      for (const y of [1920, 1945, 2025]) {
        await setYear(mp, y);
        await sleep(100);
        const r = await mp.evaluate(() => ({
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, iw: window.innerWidth,
          btns: ['btn-play', 'btn-rewind'].map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return { id, l: b.left, r: b.right, w: b.width }; }),
        }));
        if (r.sw > r.cw) bad.push(`${y}年: scrollWidth=${r.sw} > clientWidth=${r.cw}`);
        for (const b of r.btns) if (b.w <= 0 || b.l < 0 || b.r > r.iw) bad.push(`${y}年: #${b.id} が画面外 (left=${b.l}, right=${b.r})`);
      }
      assert(bad.length === 0, bad.join('\n'));
    });
    await overlapCheck(mp, '375px');
    await m.ctx.close();

    // ---- スクリーンショット ----
    if (args.out) {
      fs.mkdirSync(args.out, { recursive: true });
      for (const [vp, opts] of [['1280', DESKTOP], ['375', MOBILE]]) {
        const s = await openPage(browser, opts, 'shot-' + vp);
        try {
          for (const y of KEY_YEARS) {
            await setYear(s.page, y);
            await sleep(200);
            await s.page.screenshot({ path: path.join(args.out, `${y}-${vp}.png`), fullPage: true });
          }
        } finally { await s.ctx.close(); }
      }
      console.log(`スクリーンショットを ${args.out} に保存しました`);
    }

    await check('1. 全シナリオを通して console error / pageerror / 失敗リクエスト / HTTP>=400 が0件', async () => {
      assert(problems.length === 0, problems.slice(0, 15).join('\n'));
    });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log('FAIL 一覧:');
    for (const f of failed) console.log(' - ' + f.name);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL  ' + (e && e.stack || e));
  process.exit(1);
});
