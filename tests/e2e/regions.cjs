'use strict';
// 地域別ページ（regions.html）の E2E テスト。仕様は docs/REGIONS.md §3, §4。
// 使い方: node tests/e2e/regions.cjs --base http://localhost:8000 [--fixture] [--out DIR]
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

const DESKTOP = { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' };
const DESKTOP_MOTION = { viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' };
const MOBILE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const problems = [];

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
  await page.goto(`${args.base}/regions.html${q.length ? '?' + q.join('&') : ''}`, { waitUntil: 'load' });
  await page.waitForSelector('body[data-ready="true"]', { timeout: 20000 });
  return { ctx, page, mine };
}

const waitYear = (page, y, timeout = 5000) =>
  page.waitForFunction((yy) => document.body.dataset.year === String(yy), y, { timeout });
async function setYear(page, y) {
  await page.evaluate((yy) => window.__regions.store.setYear(yy), y);
  await waitYear(page, y);
}
async function setFacet(page, f) {
  await page.click(`#facet-toggle button[data-facet="${f}"]`);
  await page.waitForFunction((ff) => document.body.dataset.facet === ff, f, { timeout: 5000 });
  await page.waitForFunction((ff) => document.querySelector(`#facet-toggle button[data-facet="${ff}"]`).getAttribute('aria-pressed') === 'true', f, { timeout: 5000 });
}
const getData = (page) => page.evaluate(() => window.__regions.data);
const bodyYear = (page) => page.evaluate(() => document.body.dataset.year);
const stateOf = (page) => page.evaluate(() => window.__regions.store.getState());
const labelOf = (page, sel) => page.getAttribute(sel, 'aria-label');

// 期待値（JSON から計算）
function shares(data, area, year) {
  const r = data.series[area][String(year)];
  const den = r.total - r.unknown.male - r.unknown.female;
  const f = (arr) => arr.map((v) => (v === null || r.missing || !(den > 0) ? null : v / den));
  return { male: f(r.male), female: f(r.female), rec: r };
}
function fmtTotal(v) {
  const m = Math.round(v / 1e4);
  const oku = Math.floor(m / 1e4), rest = m % 1e4;
  if (oku > 0) return rest === 0 ? `${oku}億人` : `${oku}億${rest.toLocaleString('en-US')}万人`;
  return `${rest.toLocaleString('en-US')}万人`;
}

const readTileBars = (page, area) =>
  page.evaluate((a) => {
    const tile = document.querySelector(`.tile[data-area="${a}"]`);
    if (!tile) return null;
    return {
      hw: parseFloat(tile.dataset.halfWidth),
      bars: [...tile.querySelectorAll('rect.bar')].map((r) => ({
        sex: r.dataset.sex, group: +r.dataset.group, value: r.dataset.value, w: r.getBoundingClientRect().width,
      })),
    };
  }, area);

function verifyTile(info, exp, xMax, label, tol = 0.5) {
  assert(info, `${label}: タイルが見つかりません`);
  assert(info.hw > 0, `${label}: data-half-width が不正 (${info.hw})`);
  assert(info.bars.length === 36, `${label}: rect.bar が ${info.bars.length} 本（期待36）`);
  const bad = [];
  for (const b of info.bars) {
    const v = (b.sex === 'male' ? exp.male : exp.female)[b.group];
    if (v === null) {
      if (b.value !== '') bad.push(`${b.sex}/${b.group}: data-value=${JSON.stringify(b.value)} 期待=""`);
    } else if (b.value === '' || Math.abs(parseFloat(b.value) - v) > 1e-6) {
      bad.push(`${b.sex}/${b.group}: data-value=${JSON.stringify(b.value)} 期待=${v}`);
    }
    const expW = v === null ? 0 : (v / xMax) * info.hw;
    if (Math.abs(b.w - expW) > tol) bad.push(`${b.sex}/${b.group}: width=${b.w.toFixed(2)} 期待=${expW.toFixed(2)}`);
  }
  assert(bad.length === 0, `${label}: ${bad.length}本が不一致:\n` + bad.slice(0, 8).join('\n'));
}

const visibleTooltip = (page) =>
  page.evaluate(() => {
    const t = document.getElementById('tooltip');
    if (!t || t.hasAttribute('hidden')) return null;
    const cs = getComputedStyle(t);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    return t.textContent;
  });
const waitTooltip = (page) =>
  page.waitForFunction(() => { const t = document.getElementById('tooltip'); return t && !t.hasAttribute('hidden'); }, null, { timeout: 2000 });

async function tileCenter(page, area) {
  const loc = page.locator(`.tile[data-area="${area}"]`);
  await loc.scrollIntoViewIfNeeded();
  const bb = await loc.boundingBox();
  assert(bb, `タイル ${area} の位置を取得できません`);
  return { x: bb.x + bb.width / 2, y: bb.y + bb.height * 0.6 };
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
    const xMax = data.xMaxShare;
    await check('1. 初回ロードで console error / pageerror / 失敗リクエスト / HTTP>=400 が0件', async () => {
      await sleep(300);
      assert(d.mine.length === 0, d.mine.join('\n'));
    });

    // ---- 2. タイル数・切り替え ----
    await check('2. 既定の facet で .tile[data-area] が47、都道府県ボタンが aria-pressed=true', async () => {
      assert((await dp.locator('.tile[data-area]').count()) === 47, `タイル数=${await dp.locator('.tile[data-area]').count()}`);
      assert((await dp.getAttribute('#facet-toggle button[data-facet="prefecture"]', 'aria-pressed')) === 'true', '都道府県が選択中でない');
      assert((await dp.getAttribute('#facet-toggle button[data-facet="block"]', 'aria-pressed')) === 'false', '地方が選択中のまま');
    });
    await check('2. 地方に切り替えるとタイルが8、aria-pressed が入れ替わり、都道府県に戻すと47', async () => {
      await setFacet(dp, 'block');
      assert((await dp.locator('.tile[data-area]').count()) === 8, `タイル数=${await dp.locator('.tile[data-area]').count()}`);
      assert((await dp.getAttribute('#facet-toggle button[data-facet="prefecture"]', 'aria-pressed')) === 'false', '都道府県が選択中のまま');
      assert((await dp.getAttribute('#facet-toggle button[data-facet="block"]', 'aria-pressed')) === 'true', '地方が選択中でない');
      await setFacet(dp, 'prefecture');
      assert((await dp.locator('.tile[data-area]').count()) === 47, `タイル数=${await dp.locator('.tile[data-area]').count()}`);
    });
    await check('2. ?facet=block で開くとタイルが8', async () => {
      const p = await openPage(browser, DESKTOP, 'facet-block', 'facet=block');
      try {
        assert((await p.page.locator('.tile[data-area]').count()) === 8, `タイル数=${await p.page.locator('.tile[data-area]').count()}`);
        assert((await p.page.evaluate(() => document.body.dataset.facet)) === 'block', 'data-facet が block でない');
      } finally { await p.ctx.close(); }
    });

    // ---- 3. 年の保持 ----
    await check('3. 1980年で facet を切り替えても body[data-year] が1980のまま', async () => {
      await setYear(dp, 1980);
      await setFacet(dp, 'block');
      assert((await bodyYear(dp)) === '1980', `block 後の年=${await bodyYear(dp)}`);
      await setFacet(dp, 'prefecture');
      assert((await bodyYear(dp)) === '1980', `prefecture 後の年=${await bodyYear(dp)}`);
    });

    // ---- 4. 棒の幅 ----
    await check('4. 1980年 東京（13）の棒の幅 = value/xMaxShare×halfWidth（±0.5px）で data-value が割合と一致', async () => {
      await setYear(dp, 1980);
      await sleep(150);
      verifyTile(await readTileBars(dp, '13'), shares(data, '13', 1980), xMax, '東京1980');
    });
    await check('4. 1980年 ブロック kanto の棒の幅と data-value', async () => {
      await setFacet(dp, 'block');
      await sleep(150);
      verifyTile(await readTileBars(dp, 'kanto'), shares(data, 'kanto', 1980), xMax, '関東1980');
      await setFacet(dp, 'prefecture');
    });

    // ---- 5. 再生（モーション有効）----
    await check('5. 再生すると年が進み aria-label が「一時停止」、止めると「再生」へ戻る', async () => {
      const p = await openPage(browser, DESKTOP_MOTION, 'play');
      try {
        const pg = p.page;
        await setYear(pg, 1920);
        await pg.click('#btn-play');
        await sleep(2000);
        const y = +(await bodyYear(pg));
        assert(y > 1920, `2秒後の年=${y}`);
        assert((await labelOf(pg, '#btn-play')) === '一時停止', `aria-label=${await labelOf(pg, '#btn-play')}`);
        await pg.click('#btn-play');
        assert((await labelOf(pg, '#btn-play')) === '再生', '一時停止後に「再生」へ戻らない');
      } finally { await p.ctx.close(); }
    });
    await check('5. 2020年から再生すると2025年で止まり、aria-label が「再生」に戻る', async () => {
      const p = await openPage(browser, DESKTOP_MOTION, 'play-end');
      try {
        const pg = p.page;
        await setYear(pg, 2020);
        await pg.click('#btn-play');
        await pg.waitForFunction(() => document.getElementById('btn-play').getAttribute('aria-label') === '再生', null, { timeout: 5000 });
        assert((await bodyYear(pg)) === '2025', `停止した年=${await bodyYear(pg)}`);
        assert((await stateOf(pg)).playing === false, 'playing が false でない');
        await sleep(900);
        assert((await bodyYear(pg)) === '2025', '停止後に年が変わった');
      } finally { await p.ctx.close(); }
    });
    await check('5. #btn-rewind で1920年に戻る', async () => {
      const p = await openPage(browser, DESKTOP_MOTION, 'rewind');
      try {
        const pg = p.page;
        await setYear(pg, 1950);
        assert((await labelOf(pg, '#btn-rewind')) === '最初に戻る', `rewind aria-label=${await labelOf(pg, '#btn-rewind')}`);
        await pg.click('#btn-rewind');
        await waitYear(pg, 1920, 2000);
      } finally { await p.ctx.close(); }
    });

    // ---- 6. スライダー ----
    await check('6. 1940年で ArrowRight → 1945年、aria-valuetext に年が入る', async () => {
      await setYear(dp, 1940);
      await dp.focus('#year-slider');
      await dp.keyboard.press('ArrowRight');
      await waitYear(dp, 1945, 2000);
      const vt = await dp.getAttribute('#year-slider', 'aria-valuetext');
      assert(vt && vt.includes('1945年'), `aria-valuetext=${JSON.stringify(vt)}`);
    });
    await check('6. ?year=1945 で開くと data-year が 1945', async () => {
      const p = await openPage(browser, DESKTOP, 'year1945', 'year=1945');
      try {
        assert((await bodyYear(p.page)) === '1945', `data-year=${await bodyYear(p.page)}`);
      } finally { await p.ctx.close(); }
    });

    // ---- 7. 1945年・1950年の注記 ----
    await check('7. 1945年: kazoe-1945 バッジがあり、沖縄（47）に .tile-missing、棒の幅が全部0', async () => {
      await setYear(dp, 1945);
      await sleep(150);
      assert((await dp.locator('.badge[data-note="kazoe-1945"]').count()) >= 1, 'kazoe-1945 バッジなし');
      assert((await dp.locator('.tile[data-area="47"] .tile-missing').count()) >= 1, '沖縄に .tile-missing なし');
      const info = await readTileBars(dp, '47');
      assert(info, '沖縄タイルがない');
      const nz = info.bars.filter((b) => b.w > 0.01);
      assert(nz.length === 0, `幅が0でない棒: ${nz.length}本`);
    });
    await check('7. 1950年: #notes-list li[data-note=okinawa-70] がある', async () => {
      await setYear(dp, 1950);
      assert((await dp.locator('#notes-list li[data-note="okinawa-70"]').count()) === 1, 'li が無い');
    });

    // ---- 8. 参照線 ----
    await check('8. 各タイルに path.national が男女2本ずつある（都道府県・地方）', async () => {
      await setYear(dp, 1980);
      for (const f of ['prefecture', 'block']) {
        await setFacet(dp, f);
        const bad = await dp.evaluate(() => [...document.querySelectorAll('.tile[data-area]')].map((t) => ({
          a: t.dataset.area,
          m: t.querySelectorAll('path.national[data-sex="male"]').length,
          f: t.querySelectorAll('path.national[data-sex="female"]').length,
        })).filter((x) => x.m !== 1 || x.f !== 1));
        assert(bad.length === 0, `${f}: 参照線が男女1本ずつでないタイル: ${JSON.stringify(bad.slice(0, 5))}`);
      }
      await setFacet(dp, 'prefecture');
    });

    // ---- 9. ツールチップ（デスクトップ）----
    await check('9. 1280px: 1980年の東京にホバー → ツールチップに「東京」と総人口の書式', async () => {
      await setYear(dp, 1980);
      await sleep(150);
      await dp.mouse.move(2, 2);
      const c = await tileCenter(dp, '13');
      await dp.mouse.move(c.x, c.y);
      await waitTooltip(dp);
      const txt = await visibleTooltip(dp);
      assert(txt !== null, '#tooltip が表示されない');
      const exp = fmtTotal(data.series['13']['1980'].total);
      const miss = ['東京', exp].filter((s) => !txt.includes(s));
      assert(miss.length === 0, `欠けている文字列: ${miss.join(' | ')}\n実際: ${txt}`);
    });
    await dp.mouse.move(2, 2);

    // ---- 12. URL ----
    await check('12. 停止中に年や facet を変えると ?year= と ?facet= が更新される', async () => {
      await setYear(dp, 1960);
      await sleep(100);
      let u = new URL(dp.url());
      assert(u.searchParams.get('year') === '1960', `url=${dp.url()}`);
      await setYear(dp, 2010);
      await sleep(100);
      u = new URL(dp.url());
      assert(u.searchParams.get('year') === '2010', `url=${dp.url()}`);
      await setFacet(dp, 'block');
      await sleep(100);
      u = new URL(dp.url());
      assert(u.searchParams.get('facet') === 'block', `url=${dp.url()}`);
      assert(u.searchParams.get('year') === '2010', `facet 変更後に year が失われた: ${dp.url()}`);
      await setFacet(dp, 'prefecture');
      await sleep(100);
      u = new URL(dp.url());
      assert(u.searchParams.get('facet') === 'prefecture', `url=${dp.url()}`);
    });

    // ---- 11. reducedMotion ----
    await check('11. reducedMotion: 年変更50ms後に最終の幅になっている', async () => {
      await setYear(dp, 2000);
      await sleep(300);
      await dp.evaluate(() => window.__regions.store.setYear(1950));
      await sleep(50);
      verifyTile(await readTileBars(dp, '13'), shares(data, '13', 1950), xMax, '東京1950(50ms後)');
    });

    // ---- 13. アクセシビリティ ----
    await check('13. ボタン・スライダー・切り替えに名前がある', async () => {
      const bad = [];
      const names = await dp.evaluate(() => [...document.querySelectorAll('button')].map((b) => ({
        id: b.id, facet: b.dataset.facet, name: (b.getAttribute('aria-label') || b.textContent || b.title || '').trim() })));
      assert(names.length >= 4, `ボタンが4個未満 (${names.length})`);
      for (const n of names) if (!n.name) bad.push(`名前なしボタン: #${n.id || n.facet}`);
      for (const id of ['btn-play', 'btn-rewind'])
        if (!(await accName(dp, '#' + id))) bad.push(`#${id} に名前なし`);
      if (!(await accName(dp, '#year-slider'))) bad.push('スライダーに名前なし');
      if (!(await accName(dp, '#facet-toggle'))) bad.push('#facet-toggle にグループ名なし');
      for (const f of ['prefecture', 'block'])
        if (!(await accName(dp, `#facet-toggle button[data-facet="${f}"]`))) bad.push(`facet ${f} に名前なし`);
      assert(bad.length === 0, bad.join('\n'));
    });

    // ---- 10. レスポンシブ（デスクトップ配置）----
    await check('10. 1280px: 都道府県タイルが地図配置（北海道は沖縄より右・上）', async () => {
      await setFacet(dp, 'prefecture');
      await setYear(dp, 1980);
      const r = await dp.evaluate(() => {
        const g = (a) => { const b = document.querySelector(`.tile[data-area="${a}"]`).getBoundingClientRect(); return { x: b.left + window.scrollX, y: b.top + window.scrollY }; };
        return { hok: g('01'), oki: g('47') };
      });
      assert(r.hok.x > r.oki.x, `北海道x=${r.hok.x} 沖縄x=${r.oki.x}`);
      assert(r.hok.y < r.oki.y, `北海道y=${r.hok.y} 沖縄y=${r.oki.y}`);
    });
    await d.ctx.close();

    // ---- 9・10: 375px ----
    const m = await openPage(browser, MOBILE, 'mobile');
    const mp = m.page;
    await check('9. 375px: 1980年の東京のタイルをタップするとツールチップが表示される', async () => {
      await setYear(mp, 1980);
      await sleep(150);
      const c = await tileCenter(mp, '13');
      await mp.touchscreen.tap(c.x, c.y);
      await waitTooltip(mp);
      const txt = await visibleTooltip(mp);
      assert(txt !== null, '#tooltip が表示されない');
      const exp = fmtTotal(data.series['13']['1980'].total);
      const miss = ['東京', exp].filter((s) => !txt.includes(s));
      assert(miss.length === 0, `欠けている文字列: ${miss.join(' | ')}\n実際: ${txt}`);
    });
    await check('10. 375px: 横スクロールなし（都道府県・地方）', async () => {
      const bad = [];
      for (const f of ['prefecture', 'block']) {
        await setFacet(mp, f);
        for (const y of [1920, 1945, 2025]) {
          await setYear(mp, y);
          await sleep(100);
          const r = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
          if (r.sw > r.cw) bad.push(`${f}/${y}年: scrollWidth=${r.sw} > clientWidth=${r.cw}`);
        }
      }
      await setFacet(mp, 'prefecture');
      assert(bad.length === 0, bad.join('\n'));
    });
    await check('10. 375px: SVG 内の text の実寸が10px以上', async () => {
      const bad = [];
      for (const f of ['prefecture', 'block']) {
        await setFacet(mp, f);
        const out = await mp.evaluate(() => {
          const o = [];
          for (const t of document.querySelectorAll('svg text')) {
            const cs = getComputedStyle(t);
            if (cs.display === 'none' || cs.visibility === 'hidden' || !(t.textContent || '').trim()) continue;
            if (t.closest('[hidden]')) continue;
            const mm = t.getScreenCTM();
            const scale = mm ? Math.sqrt(Math.abs(mm.a * mm.d - mm.b * mm.c)) : 1;
            const px = parseFloat(cs.fontSize) * scale;
            if (px < 10 - 0.01) o.push(`"${t.textContent.trim().slice(0, 12)}" ${px.toFixed(2)}px`);
          }
          return o;
        });
        for (const x of out) bad.push(`${f}: ${x}`);
      }
      await setFacet(mp, 'prefecture');
      assert(bad.length === 0, `10px 未満: ${bad.slice(0, 8).join(', ')}`);
    });
    await m.ctx.close();

    // ---- スクリーンショット ----
    if (args.out) {
      fs.mkdirSync(args.out, { recursive: true });
      for (const [vp, opts] of [['1280', DESKTOP], ['375', MOBILE]]) {
        const s = await openPage(browser, opts, 'shot-' + vp);
        try {
          for (const f of ['prefecture', 'block']) {
            await setFacet(s.page, f);
            for (const y of [1950, 1980, 2025]) {
              await setYear(s.page, y);
              await sleep(200);
              await s.page.screenshot({ path: path.join(args.out, `${f}-${y}-${vp}.png`), fullPage: true });
            }
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
