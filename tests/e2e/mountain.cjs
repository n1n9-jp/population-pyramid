'use strict';
// 3Dページ「人口の山脈とコホートの糸」（mountain.html）の E2E テスト。仕様は docs/MOUNTAIN.md §4〜§7。
// 使い方: node tests/e2e/mountain.cjs --base http://localhost:8000 [--fixture] [--stub] [--out DIR]
// --stub は ?stub=1（scene-stub.js）で開く。3D 描画は検査せず、状態・UI・ツールチップだけを検査する。
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

function parseArgs(argv) {
  const a = { base: 'http://localhost:8000', fixture: false, stub: false, out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--base') a.base = argv[++i];
    else if (argv[i] === '--fixture') a.fixture = true;
    else if (argv[i] === '--stub') a.stub = true;
    else if (argv[i] === '--out') a.out = argv[++i];
    else throw new Error('不明な引数: ' + argv[i]);
  }
  a.base = a.base.replace(/\/+$/, '');
  return a;
}
const args = parseArgs(process.argv);

const LAUNCH = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
const DESKTOP = { viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' };
const DESKTOP_REDUCED = { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' };
const MOBILE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' };

const STEPS = ['overview', 'war', 'dankai', 'hinoeuma', 'dankai-jr', 'cut2025', 'free'];
const ALL_IDS = ['dankai', 'hinoeuma', 'dankai-jr', 'postwar'];
// MOUNTAIN.md §5 の表。hl: 'all' は「すべて」＝4世代すべて、null は検査しない。
const EXPECT = {
  overview: { form: 'terrain', camera: 'overview', hl: 'all', cut: null },
  war: { form: 'terrain', camera: 'war', hl: ['postwar'], cut: null },
  dankai: { form: 'terrain', camera: 'dankai', hl: ['dankai'], cut: null },
  hinoeuma: { form: 'terrain', camera: 'hinoeuma', hl: ['hinoeuma'], cut: null },
  'dankai-jr': { form: 'terrain', camera: 'dankai-jr', hl: ['dankai-jr'], cut: null },
  cut2025: { form: 'pyramid', camera: 'pyramid-front', hl: 'all', cut: 2025 },
};

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

function url(q, noStub) {
  const parts = [];
  if (args.fixture) parts.push('fixture=1');
  if (args.stub && !noStub) parts.push('stub=1');
  if (q) parts.push(q);
  return `${args.base}/mountain.html${parts.length ? '?' + parts.join('&') : ''}`;
}

async function openPage(browser, opts, label, extra, { record = true, init, waitReady = true, noStub = false } = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  const mine = [];
  const rec = (kind, text) => {
    const p = `[${label}] ${kind}: ${text}`;
    mine.push(p);
    if (record) problems.push(p);
  };
  page.on('console', (m) => { if (m.type() === 'error') rec('console.error', m.text()); });
  page.on('pageerror', (e) => rec('pageerror', e.message));
  page.on('requestfailed', (r) => rec('requestfailed', `${r.url()} ${r.failure() && r.failure().errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) rec('http' + r.status(), r.url()); });
  await page.goto(url(extra, noStub), { waitUntil: 'load' });
  if (waitReady) await page.waitForSelector('body[data-ready="true"]', { timeout: 90000 });
  return { ctx, page, mine };
}

const getData = (page) => page.evaluate(() => window.__mountain.data);
const getState = (page) => page.evaluate(() => window.__mountain.scene.getState());

function hlMatches(actual, want) {
  if (want === null) return true;
  const a = [...(actual || [])].sort();
  if (want === 'all') return a.length === ALL_IDS.length && ALL_IDS.every((id) => a.includes(id));
  return a.length === want.length && want.every((id) => a.includes(id));
}
function stateMatches(s, e) {
  return s.form === e.form && s.camera === e.camera && hlMatches(s.highlight, e.hl) &&
    (e.cut === undefined || s.cutYear === e.cut);
}
const fmtState = (s) => JSON.stringify(s);
const fmtExp = (e) => JSON.stringify({ form: e.form, camera: e.camera, highlight: e.hl, cutYear: e.cut });

async function waitState(page, e, timeout = 6000) {
  const t0 = Date.now();
  for (;;) {
    const s = await getState(page);
    if (stateMatches(s, e)) return s;
    if (Date.now() - t0 > timeout) throw new Error(`状態が一致しません\n  実際: ${fmtState(s)}\n  期待: ${fmtExp(e)}`);
    await sleep(80);
  }
}
async function scrollToStep(page, step) {
  await page.evaluate((s) => {
    const el = document.querySelector(`.scene-step[data-step="${s}"]`);
    if (!el) throw new Error('段が見つかりません: ' + s);
    el.scrollIntoView({ block: 'center' });
  }, step);
}
const waitBodyStep = (page, step, timeout = 6000) =>
  page.waitForFunction((s) => document.body.dataset.step === s, step, { timeout });

const yearRec = (data, y) => data.years.find((r) => r.year === y);

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

// canvas のスクリーンショットから、白でない画素の割合を数える
async function nonWhiteRatio(page, selector) {
  const buf = await page.locator(selector).screenshot();
  const b64 = buf.toString('base64');
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0 && (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245)) n++;
    }
    return { ratio: n / (c.width * c.height), w: c.width, h: c.height };
  }, b64);
}

async function main() {
  const browser = await chromium.launch(LAUNCH);
  let data = null;

  try {
    // ---- 1・2・3・4: 通常（モーションあり）----
    const d = await openPage(browser, DESKTOP, 'desktop');
    const dp = d.page;
    data = await getData(dp);

    await check('1. 初回ロードで console error / pageerror / 失敗リクエスト / HTTP>=400 が0件、body[data-ready="true"]', async () => {
      await sleep(500);
      assert(await dp.getAttribute('body', 'data-ready') === 'true', 'data-ready が true でない');
      assert(d.mine.length === 0, d.mine.join('\n'));
    });

    await check('2. canvas#mountain-canvas に描画がある（白でない画素が3%以上）', async () => {
      assert(await dp.locator('canvas#mountain-canvas').count() === 1, 'canvas#mountain-canvas が1つでない');
      let r = null;
      for (let i = 0; i < 5; i++) {
        r = await nonWhiteRatio(dp, 'canvas#mountain-canvas');
        if (r.ratio >= 0.03) break;
        await sleep(300);
      }
      assert(r.w > 0 && r.h > 0, `canvas の大きさが0 (${r.w}x${r.h})`);
      assert(r.ratio >= 0.03, `白でない画素の割合=${(r.ratio * 100).toFixed(2)}% (${r.w}x${r.h})`);
    });

    await check('3. ツアー：7段を順にスクロールすると body[data-step] と getState() が §5 の表に一致する', async () => {
      const steps = await dp.$$eval('.scene-step[data-step]', (els) => els.map((e) => e.dataset.step));
      assert(JSON.stringify(steps) === JSON.stringify(STEPS), `段の並び=${JSON.stringify(steps)} 期待=${JSON.stringify(STEPS)}`);
      const bad = [];
      let prev = null;
      for (const step of STEPS) {
        await scrollToStep(dp, step);
        try {
          await waitBodyStep(dp, step);
        } catch (e) {
          bad.push(`${step}: body[data-step]=${await dp.getAttribute('body', 'data-step')}`);
          continue;
        }
        if (step === 'free') {
          const s = await getState(dp);
          const sv = Number(await dp.inputValue('#cut-slider'));
          if (s.camera !== 'free') bad.push(`free: camera=${s.camera}`);
          if (prev && s.form !== prev.form) bad.push(`free: 形が現状のままでない (${prev.form} → ${s.form})`);
          if (s.cutYear !== sv) bad.push(`free: cutYear=${s.cutYear} スライダー=${sv}`);
        } else {
          try { prev = await waitState(dp, EXPECT[step]); }
          catch (e) { bad.push(`${step}: ${e.message}`); prev = await getState(dp); }
          if (await dp.getAttribute('body', 'data-form') !== EXPECT[step].form)
            bad.push(`${step}: body[data-form]=${await dp.getAttribute('body', 'data-form')}`);
        }
      }
      assert(bad.length === 0, bad.join('\n'));
    });

    // ---- 4: ?step=free ----
    const f = await openPage(browser, DESKTOP, 'free', 'step=free');
    const fp = f.page;
    await check('4a. ?step=free：#form-toggle で形が切り替わる（aria-pressed と getState().form）', async () => {
      await waitBodyStep(fp, 'free');
      const bad = [];
      for (const form of ['pyramid', 'terrain', 'pyramid']) {
        await fp.click(`#form-toggle button[data-form="${form}"]`);
        try {
          await fp.waitForFunction((x) => window.__mountain.scene.getState().form === x, form, { timeout: 4000 });
        } catch (e) { bad.push(`${form}: getState().form=${(await getState(fp)).form}`); }
        const pressed = await fp.$$eval('#form-toggle button[data-form]', (bs) => bs.map((b) => [b.dataset.form, b.getAttribute('aria-pressed')]));
        for (const [k, v] of pressed) {
          if (v !== (k === form ? 'true' : 'false')) bad.push(`${form}を選択後: ${k} の aria-pressed=${v}`);
        }
      }
      assert(bad.length === 0, bad.join('\n'));
    });

    await check('4b. #cut-slider で断面の年が変わる。1940年から ArrowRight で1944年（データのない年を飛ばす）', async () => {
      await fp.locator('#cut-slider').fill('1960');
      await fp.waitForFunction(() => window.__mountain.scene.getState().cutYear === 1960, null, { timeout: 4000 });
      await fp.locator('#cut-slider').fill('1940');
      await fp.waitForFunction(() => window.__mountain.scene.getState().cutYear === 1940, null, { timeout: 4000 });
      await fp.focus('#cut-slider');
      await fp.keyboard.press('ArrowRight');
      await fp.waitForFunction(() => window.__mountain.scene.getState().cutYear === 1944, null, { timeout: 4000 });
      assert(await fp.inputValue('#cut-slider') === '1944', `スライダー値=${await fp.inputValue('#cut-slider')} 期待=1944`);
    });

    await check('4c. #inset の rect.inset-bar の data-value が断面の年の data と一致し、openAge の段は .inset-open である', async () => {
      const bad = [];
      for (const y of [1960, 1944, 2025]) {
        await fp.locator('#cut-slider').fill(String(y));
        await fp.waitForFunction((yy) => window.__mountain.scene.getState().cutYear === yy, y, { timeout: 4000 });
        await sleep(150);
        const rec = yearRec(data, y);
        const bars = await fp.$$eval('#inset rect.inset-bar', (rs) => rs.map((r) => ({ sex: r.dataset.sex, age: Number(r.dataset.age), value: r.dataset.value })));
        if (!bars.length) { bad.push(`${y}: rect.inset-bar が0本`); continue; }
        const key = (s, a) => `${s}/${a}`;
        const got = new Map(bars.map((b) => [key(b.sex, b.age), b.value]));
        let miss = 0, diff = [];
        for (const sex of ['male', 'female']) {
          for (let a = 0; a < rec.openAge; a++) {
            const exp = rec[sex][a];
            if (exp === null) continue;
            const v = got.get(key(sex, a));
            if (v === undefined) { miss++; continue; }
            if (Number(v) !== exp) diff.push(`${sex}/${a}: data-value=${v} 期待=${exp}`);
          }
        }
        if (miss) bad.push(`${y}: 棒が見つからない年齢が${miss}件（0〜${rec.openAge - 1}歳×男女）`);
        if (diff.length) bad.push(`${y}: ${diff.slice(0, 5).join(' / ')}`);
        // openAge の段は面（3D）には含めないが、小窓は全国ページと同じく .inset-open の棒で描く
        const open = await fp.$$eval('#inset rect.inset-bar', (rs) => rs.filter((r) => r.classList.contains('inset-open')).map((r) => Number(r.dataset.age)));
        const wrong = open.filter((a) => a !== rec.openAge);
        if (wrong.length) bad.push(`${y}: openAge(${rec.openAge}歳)以外に .inset-open がある: ${wrong.join(',')}`);
        const openBars = bars.filter((b) => b.age === rec.openAge);
        if (openBars.length && open.length !== openBars.length) bad.push(`${y}: openAge の棒${openBars.length}本のうち .inset-open は${open.length}本`);
        if (openBars.length === 0) bad.push(`${y}: openAge(${rec.openAge}歳)の段の棒がない（.inset-open で描く）`);
      }
      assert(bad.length === 0, bad.join('\n'));
    });

    await check('4d. #cohort-select：クリックの前後で、checked と getState().highlight の中身が一致する', async () => {
      const bad = [];
      const checkedIds = () => fp.$$eval('#cohort-select input[data-cohort]', (is) => is.filter((i) => i.checked).map((i) => i.dataset.cohort).sort());
      const sameAsChecked = async (label) => {
        const want = await checkedIds();
        try {
          await fp.waitForFunction((w) => JSON.stringify([...(window.__mountain.scene.getState().highlight || [])].sort()) === JSON.stringify(w), want, { timeout: 4000 });
        } catch (e) { bad.push(`${label}: checked=${JSON.stringify(want)} highlight=${JSON.stringify((await getState(fp)).highlight)}`); }
        return want;
      };
      const before = await sameAsChecked('クリック前');
      for (const id of ['hinoeuma', 'postwar', 'hinoeuma']) {
        const sel = `#cohort-select input[data-cohort="${id}"]`;
        if (await fp.locator(sel).count() !== 1) { bad.push(`${sel} が1つでない`); continue; }
        const was = (await checkedIds()).includes(id);
        await fp.locator(sel).click();
        const now = await sameAsChecked(`${id}をクリック後`);
        if (now.includes(id) === was) bad.push(`${id}: クリックで checked が切り替わらない`);
      }
      const after = await sameAsChecked('最後');
      if (JSON.stringify(before) === JSON.stringify(after)) bad.push(`3回のクリックで状態が変わらない: ${JSON.stringify(after)}`);
      assert(bad.length === 0, bad.join('\n'));
    });

    await check('4e. 断面スライダーをドラッグして推計のない年をまたいでも、向きどおりに進み、行き来しない', async () => {
      const g = data.gaps[0];
      assert(g, 'data.gaps が空');
      const s0 = g.start - 1, e0 = g.end + 1;
      // input は requestAnimationFrame で間引かれるので、1フレーム進めてから読む
      const drag = (v) => fp.evaluate(async (val) => {
        const el = document.getElementById('cut-slider');
        el.value = String(val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return window.__mountain.scene.getState().cutYear;
      }, v);
      const got = [];
      const up = [s0]; for (let v = g.start; v <= g.end; v++) up.push(v); up.push(e0, e0 + 1);
      const down = [e0 + 1, e0]; for (let v = g.end; v >= g.start; v--) down.push(v); down.push(s0, s0 - 1);
      await fp.locator('#cut-slider').fill(String(s0));
      await fp.waitForFunction((x) => window.__mountain.scene.getState().cutYear === x, s0, { timeout: 4000 });
      for (const v of up) got.push(['↑', v, await drag(v)]);
      await fp.locator('#cut-slider').fill(String(e0 + 1));
      for (const v of down) got.push(['↓', v, await drag(v)]);
      const bad = [];
      for (const [d, raw, cut] of got) {
        const exp = raw >= g.start && raw <= g.end ? (d === '↑' ? e0 : s0) : raw;
        if (cut !== exp) bad.push(`${d} 生の値${raw} → 断面${cut}（期待${exp}）`);
      }
      assert(bad.length === 0, bad.join('\n'));
    });

    await check('4f. データ表：開くと全行（0〜ageMax歳）が出て、年齢は th scope=row、値のない所は「—」。閉じている間は描かない', async () => {
      await fp.locator('#cut-slider').fill('2025');
      await fp.waitForFunction(() => window.__mountain.scene.getState().cutYear === 2025, null, { timeout: 4000 });
      assert(await fp.locator('#data-table tbody tr').count() === 0, '閉じている間に表の行が描かれている');
      await fp.click('#data-details > summary');
      await fp.waitForFunction(() => document.querySelectorAll('#data-table tbody tr').length > 0, null, { timeout: 4000 });
      const rec = yearRec(data, 2025);
      const rows = await fp.$$eval('#data-table tbody tr', (trs) => trs.map((tr) => ({ th: tr.querySelector('th') && tr.querySelector('th').getAttribute('scope'), thText: tr.querySelector('th') && tr.querySelector('th').textContent, tds: [...tr.querySelectorAll('td')].map((t) => t.textContent) })));
      const bad = [];
      if (rows.length !== data.ageMax + 1) bad.push(`行数=${rows.length} 期待=${data.ageMax + 1}`);
      rows.forEach((r, a) => {
        if (r.th !== 'row') bad.push(`${a}歳: th scope=${r.th}`);
        const m = rec.male[a], f = rec.female[a];
        const exp = [m == null ? '—' : m.toLocaleString('en-US'), f == null ? '—' : f.toLocaleString('en-US'), m == null || f == null ? '—' : (m + f).toLocaleString('en-US')];
        if (JSON.stringify(r.tds) !== JSON.stringify(exp)) bad.push(`${a}歳: ${JSON.stringify(r.tds)} 期待=${JSON.stringify(exp)}`);
      });
      const head = await fp.$$eval('#data-table thead th', (ths) => ths.map((t) => t.getAttribute('scope')));
      if (head.some((h) => h !== 'col')) bad.push(`見出しの scope=${JSON.stringify(head)}`);
      await fp.click('#data-details > summary');
      assert(bad.slice(0, 8).length === 0, bad.slice(0, 8).join('\n'));
    });

    await check('4g. ツールチップ：糸か面をクリックすると #pick-tooltip に「N年生まれ」・年と年齢・男女と人数が、全国ページの書式で出る', async () => {
      await fp.locator('#form-toggle button[data-form="terrain"]').click();
      await fp.locator('#cut-slider').fill('2025');
      const box = await fp.locator('canvas#mountain-canvas').boundingBox();
      let text = null, parts = null;
      for (let gy = 0.3; gy <= 0.9 && !parts; gy += 0.05) {
        for (let gx = 0.2; gx <= 0.9 && !parts; gx += 0.05) {
          await fp.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
          await sleep(60);
          parts = await fp.evaluate(() => {
            const t = document.getElementById('pick-tooltip');
            if (!t || t.hidden) return null;
            return { head: (t.querySelector('.tip-head') || {}).textContent, sub: (t.querySelector('.tip-sub') || {}).textContent, val: (t.querySelector('.tip-val') || {}).textContent };
          });
        }
      }
      assert(parts, 'canvas をクリックしてもツールチップが出ない');
      const bad = [];
      const m1 = /^(\d{4})年生まれ$/.exec(parts.head || '');
      const m2 = /^(\d{4})年・(数え年)?(\d+)歳(以上)?$/.exec(parts.sub || '');
      const m3 = /^(男性|女性) ([\d,]+人|[\d.]+万人)$/.exec(parts.val || '');
      if (!m1) bad.push(`世代の書式: ${JSON.stringify(parts.head)}`);
      if (!m2) bad.push(`年・年齢の書式: ${JSON.stringify(parts.sub)}`);
      if (!m3) bad.push(`人数の書式: ${JSON.stringify(parts.val)}`);
      if (!bad.length) {
        const rec = yearRec(data, Number(m2[1]));
        const sex = m3[1] === '男性' ? 'male' : 'female';
        const v = rec && rec[sex][Number(m2[3])];
        const num = (x) => Math.round(x).toLocaleString('en-US');
        const exp = v == null ? null : rec.precision === 1 ? `${num(v)}人` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万人` : `${num(v)}人`;
        if (exp !== m3[2]) bad.push(`人数が data と違う: 表示=${m3[2]} 期待=${exp}（${m2[1]}年${m3[1]}${m2[3]}歳）`);
      }
      assert(bad.length === 0, bad.join('\n'));
    });

    await check('4h. 注記：断面の年に応じて #year-notes に data.notes の文言が出る', async () => {
      const bad = [];
      for (const y of [1940, 2025, 1960]) {
        await fp.locator('#cut-slider').fill(String(y));
        await fp.waitForFunction((x) => window.__mountain.scene.getState().cutYear === x, y, { timeout: 4000 });
        const got = await fp.$$eval('#year-notes li', (ls) => ls.map((l) => l.textContent));
        const want = (yearRec(data, y).noteIds || []).filter((id) => data.notes[id]).map((id) => data.notes[id].text);
        if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${y}: ${JSON.stringify(got)} 期待=${JSON.stringify(want)}`);
      }
      const list = await fp.$$eval('#notes-list li', (ls) => ls.length);
      if (list !== Object.keys(data.notes).length) bad.push(`#notes-list の数=${list} 期待=${Object.keys(data.notes).length}`);
      assert(bad.length === 0, bad.join('\n'));
    });

    await check(args.fixture ? '4i. --fixture：「サンプルデータ」の帯が出る' : '4i. 実データ：「サンプルデータ」の帯は出ない', async () => {
      const vis = await fp.locator('#fixture-banner').isVisible();
      assert(vis === args.fixture, `帯の表示=${vis} 期待=${args.fixture}`);
      if (args.fixture) assert(/サンプルデータ/.test(await fp.textContent('#fixture-banner')), '帯に「サンプルデータ」がない');
    });
    await f.ctx.close();

    // ---- 5: ?step=war ----
    const w = await openPage(browser, DESKTOP, 'war', 'step=war');
    await check('5. ?step=war で開くと、その段から始まる', async () => {
      await waitBodyStep(w.page, 'war');
      await waitState(w.page, EXPECT.war);
      const top = await w.page.evaluate(() => {
        const r = document.querySelector('.scene-step[data-step="war"]').getBoundingClientRect();
        return { t: r.top, b: r.bottom, h: window.innerHeight };
      });
      assert(top.b > 0 && top.t < top.h, `war の段が画面内にない (top=${top.t}, bottom=${top.b})`);
    });
    await w.ctx.close();

    // ---- 6: reduced motion ----
    const r = await openPage(browser, DESKTOP_REDUCED, 'reduced');
    await check('6. reduced motion：段を切り替えて50ms後に最終の状態（形・カメラ・断面）になっている', async () => {
      const bad = [];
      for (const step of ['dankai', 'cut2025', 'war']) {
        await scrollToStep(r.page, step);
        await sleep(50);
        const s = await getState(r.page);
        if (!stateMatches(s, EXPECT[step])) bad.push(`${step}: 実際=${fmtState(s)} 期待=${fmtExp(EXPECT[step])}`);
      }
      // 形の切り替え（free）も即時
      await scrollToStep(r.page, 'free');
      await waitBodyStep(r.page, 'free');
      await r.page.click('#form-toggle button[data-form="pyramid"]');
      await sleep(50);
      const s2 = await getState(r.page);
      if (s2.form !== 'pyramid') bad.push(`free: 形の切り替え50ms後 form=${s2.form}`);
      assert(bad.length === 0, bad.join('\n'));
    });
    await r.ctx.close();

    // ---- 7: WebGL なし ----
    const nw = await openPage(browser, DESKTOP, 'no-webgl', null, {
      record: false,
      waitReady: false,
      noStub: true, // WebGL なしの経路は本物の scene.js 側にあるので、stub は使わない
      init: () => {
        const orig = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
          return orig.call(this, type, ...rest);
        };
      },
    });
    await check('7. WebGL が使えないとき #webgl-fallback が表示され、ページが落ちない（pageerror 0、段落は残る）', async () => {
      await nw.page.waitForSelector('#webgl-fallback', { state: 'visible', timeout: 15000 });
      const txt = ((await nw.page.textContent('#webgl-fallback')) || '').trim();
      assert(txt.length > 0, '#webgl-fallback に案内文がない');
      const errs = nw.mine.filter((m) => m.includes('pageerror'));
      assert(errs.length === 0, errs.join('\n'));
      assert(await nw.page.locator('.scene-step[data-step]').count() === STEPS.length, '段落が7つ残っていない');
      const vis = await nw.page.evaluate(() => {
        const v = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; };
        return { lede: v('.lede .d3-only'), form: v('#form-toggle'), cohort: v('#cohort-select'), reset: v('#btn-reset-view'), slider: v('#cut-slider'), inset: v('#inset'), table: v('#data-details'), legend: v('#legend') };
      });
      const bad = [];
      if (vis.lede) bad.push('「スクロールすると…」が残っている');
      if (vis.form) bad.push('形の切り替えが残っている');
      if (vis.cohort) bad.push('強調する世代が残っている');
      if (vis.reset) bad.push('視点を戻すが残っている');
      if (!vis.slider || !vis.inset || !vis.table) bad.push(`断面スライダー・小窓・データ表が消えている: ${JSON.stringify(vis)}`);
      assert(bad.length === 0, bad.join('\n'));
    });
    await nw.ctx.close();

    // ---- 8・9: 375px ----
    const m = await openPage(browser, MOBILE, 'mobile');
    const mp = m.page;
    await check('8. 375×812：横スクロールがなく、canvas の上端が画面内にある', async () => {
      await sleep(300);
      const v = await mp.evaluate(() => {
        const c = document.querySelector('canvas#mountain-canvas').getBoundingClientRect();
        return {
          sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth,
          top: c.top, bottom: c.bottom, w: c.width, h: c.height, ih: window.innerHeight,
        };
      });
      assert(v.sw <= v.iw && v.bw <= v.iw, `横スクロールあり: scrollWidth=${v.sw}/${v.bw} innerWidth=${v.iw}`);
      assert(v.top >= 0 && v.top < v.ih, `canvas 上端が画面外: top=${v.top}`);
      assert(v.w > 0 && v.h > 0, `canvas の大きさが0: ${v.w}x${v.h}`);
    });

    await check('9. ボタン・スライダー・チェックボックスに名前があり、全国ページと地域別ページへのリンクがある', async () => {
      const bad = [];
      const ids = await dp.evaluate(() => {
        const out = [];
        document.querySelectorAll('button, input[type="range"], input[type="checkbox"], input[type="radio"]').forEach((el, i) => {
          if (!el.id) el.setAttribute('data-e2e-name', 'n' + i);
          out.push(el.id ? '#' + CSS.escape(el.id) : `[data-e2e-name="n${i}"]`);
        });
        return out;
      });
      assert(ids.length > 0, 'ボタン・スライダー・チェックボックスが見つからない');
      for (const sel of ids) {
        if (!(await accName(dp, sel))) bad.push(`名前なし: ${sel}`);
      }
      for (const sel of ['#cut-slider', '#form-toggle button[data-form]', '#cohort-select input[data-cohort]']) {
        if (await dp.locator(sel).count() === 0) bad.push(`${sel} が見つからない`);
      }
      const links = await dp.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
      if (!links.some((h) => /(^|\/)index\.html(\?|#|$)/.test(h))) bad.push(`全国ページ(index.html)へのリンクなし: ${JSON.stringify(links)}`);
      if (!links.some((h) => /(^|\/)regions\.html(\?|#|$)/.test(h))) bad.push(`地域別ページ(regions.html)へのリンクなし: ${JSON.stringify(links)}`);
      assert(bad.length === 0, bad.join('\n'));
    });

    await check('11a. 375px でタップしたあと、ツールチップが見えたまま残る', async () => {
      await scrollToStep(mp, 'free');
      await waitBodyStep(mp, 'free');
      await mp.evaluate(() => window.scrollTo(0, 0));
      await sleep(300);
      const box = await mp.locator('canvas#mountain-canvas').boundingBox();
      let shown = false;
      for (let gy = 0.3; gy <= 0.9 && !shown; gy += 0.05) {
        for (let gx = 0.2; gx <= 0.9 && !shown; gx += 0.05) {
          await mp.touchscreen.tap(box.x + box.width * gx, box.y + box.height * gy);
          await sleep(80);
          shown = await mp.evaluate(() => { const t = document.getElementById('pick-tooltip'); return !!t && !t.hidden; });
        }
      }
      assert(shown, 'タップしてもツールチップが出ない');
      await sleep(700);
      const still = await mp.evaluate(() => { const t = document.getElementById('pick-tooltip'); return !!t && !t.hidden; });
      assert(still, 'タップの後、ツールチップがすぐ消える');
    });

    await check('11b. 凡例：375px では折りたたまれ、段の強調する世代の名前が出る。1280px では開いている', async () => {
      const bad = [];
      const open375 = await mp.evaluate(() => document.getElementById('legend-details').open);
      if (open375) bad.push('375px で凡例が開いたまま');
      const rect = await mp.evaluate(() => { const r = document.getElementById('legend').getBoundingClientRect(); const c = document.getElementById('mountain-canvas').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cl: c.left, cr: c.right, ct: c.top, cb: c.bottom }; });
      if (rect.l < rect.cl - 1 || rect.r > rect.cr + 1 || rect.t < rect.ct - 1 || rect.b > rect.cb + 1) bad.push(`凡例が canvas からはみ出す: ${JSON.stringify(rect)}`);
      await mp.evaluate(() => document.getElementById('legend-details').setAttribute('open', ''));
      const items = await mp.$$eval('#legend-details .legend-list li', (l) => l.map((x) => x.textContent.trim()));
      for (const w of ['男性', '女性', '強調する世代の糸', '破線', '数え年', '推計なし']) {
        if (!items.some((t) => t.includes(w))) bad.push(`凡例に「${w}」がない: ${JSON.stringify(items)}`);
      }
      const want = { dankai: '団塊の世代 1947〜49年生まれ', hinoeuma: '丙午 1966年生まれ', 'dankai-jr': '団塊ジュニア 1971〜74年生まれ', war: '終戦前後 1945〜46年生まれ' };
      for (const [step, text] of Object.entries(want)) {
        await scrollToStep(dp, step === 'war' ? 'war' : step);
        await waitBodyStep(dp, step === 'war' ? 'war' : step);
        const got = await dp.evaluate(() => document.getElementById('legend').textContent.replace(/\s+/g, ' '));
        if (!got.includes(text)) bad.push(`${step} 段の凡例に「${text}」がない: ${got}`);
      }
      const open1280 = await dp.evaluate(() => document.getElementById('legend-details').open);
      if (!open1280) bad.push('1280px で凡例が閉じている');
      assert(bad.length === 0, bad.join('\n'));
    });

    await check('11c. 読んでいない段落の文字は #5b5346（opacity で薄めない）、「↓ スクロールして読む」は overview のときだけ', async () => {
      const bad = [];
      await scrollToStep(dp, 'overview');
      await waitBodyStep(dp, 'overview');
      const v = await dp.evaluate(() => {
        const el = document.querySelector('.scene-step[data-step="dankai"]');
        const cs = getComputedStyle(el);
        return { op: cs.opacity, color: cs.color, hint: getComputedStyle(document.querySelector('.scroll-hint')).display };
      });
      if (v.op !== '1') bad.push(`opacity=${v.op}`);
      if (v.color !== 'rgb(91, 83, 70)') bad.push(`読んでいない段落の color=${v.color}`);
      if (v.hint === 'none') bad.push('overview で「スクロールして読む」が出ない');
      await scrollToStep(dp, 'war');
      await waitBodyStep(dp, 'war');
      const h2 = await dp.evaluate(() => getComputedStyle(document.querySelector('.scroll-hint')).display);
      if (h2 !== 'none') bad.push('overview 以外で「スクロールして読む」が出ている');
      assert(bad.length === 0, bad.join('\n'));
    });

    await check('11d. canvas の aria-label は段で変わり、free のときだけ tabindex=0', async () => {
      const bad = [];
      const labels = new Set();
      for (const step of STEPS) {
        await scrollToStep(dp, step);
        await waitBodyStep(dp, step);
        const v = await dp.evaluate(() => { const c = document.getElementById('mountain-canvas'); return { l: c.getAttribute('aria-label'), t: c.getAttribute('tabindex') }; });
        labels.add(v.l);
        if (!v.l) bad.push(`${step}: aria-label なし`);
        if (step === 'free' ? v.t !== '0' : v.t !== null) bad.push(`${step}: tabindex=${v.t}`);
      }
      if (labels.size < STEPS.length) bad.push(`段ごとに aria-label が違わない（${labels.size}種）`);
      assert(bad.length === 0, bad.join('\n'));
    });

    await check('11e. free：「視点を戻す」ボタンがあり、押しても落ちず free のカメラのまま', async () => {
      await scrollToStep(dp, 'free');
      await waitBodyStep(dp, 'free');
      assert(await dp.locator('#btn-reset-view').count() === 1, '#btn-reset-view がない');
      assert(await accName(dp, '#btn-reset-view'), 'ボタンに名前がない');
      await dp.click('#btn-reset-view');
      await sleep(200);
      assert((await getState(dp)).camera === 'free', 'camera が free でない');
    });

    await check('11f. 375px：.page-nav のリンクが折り返しても「→」だけが落ちない（nowrap）', async () => {
      const ws = await mp.$$eval('.page-nav a', (as) => as.map((a) => getComputedStyle(a).whiteSpace));
      assert(ws.length >= 2 && ws.every((w) => w === 'nowrap'), `white-space=${JSON.stringify(ws)}`);
    });

    await m.ctx.close();
    await d.ctx.close();

    // ---- 10: 他ページからのリンク ----
    await check('10. index.html と regions.html の .page-nav に mountain.html へのリンクがある', async () => {
      const ctx = await browser.newContext(DESKTOP_REDUCED);
      const pg = await ctx.newPage();
      const bad = [];
      try {
        for (const file of ['index.html', 'regions.html']) {
          await pg.goto(`${args.base}/${file}`, { waitUntil: 'load' });
          const hrefs = await pg.$$eval('.page-nav a[href]', (as) => as.map((a) => [a.getAttribute('href'), (a.textContent || '').trim()]));
          const hit = hrefs.find(([h]) => /(^|\/)mountain\.html(\?|#|$)/.test(h));
          if (!hit) bad.push(`${file}: .page-nav に mountain.html へのリンクなし ${JSON.stringify(hrefs)}`);
          else if (!hit[1].includes('3D')) bad.push(`${file}: リンク文言=${JSON.stringify(hit[1])}（「3Dで見る →」を期待）`);
        }
      } finally { await ctx.close(); }
      assert(bad.length === 0, bad.join('\n'));
    });

    // ---- スクリーンショット ----
    if (args.out) {
      fs.mkdirSync(args.out, { recursive: true });
      for (const [vp, opts] of [['1280', DESKTOP_REDUCED], ['375', MOBILE]]) {
        for (const step of STEPS) {
          const s = await openPage(browser, opts, `shot-${vp}-${step}`, `step=${step}`, { record: false });
          try {
            await waitBodyStep(s.page, step);
            if (EXPECT[step]) await waitState(s.page, EXPECT[step]).catch(() => {});
            await sleep(400);
            await s.page.screenshot({ path: path.join(args.out, `mountain-${step}-${vp}.png`) });
          } catch (e) {
            console.log(`スクリーンショット失敗 ${step}/${vp}: ${e.message}`);
          } finally { await s.ctx.close(); }
        }
      }
      console.log(`スクリーンショットを ${args.out} に保存しました`);
    }

    await check('1b. 全シナリオを通して console error / pageerror / 失敗リクエスト / HTTP>=400 が0件', async () => {
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
