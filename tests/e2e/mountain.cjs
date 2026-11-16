'use strict';
// 3Dページ「人口の山脈をたどる：世代の100年」（/ = index.html）の E2E テスト。仕様は docs/MOUNTAIN.md §4〜§7。
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

const STEPS = ['overview', 'war', 'dankai', 'hinoeuma', 'dankai-jr', 'flight', 'cut2025', 'free'];
const ALL_IDS = ['dankai', 'hinoeuma', 'dankai-jr', 'postwar'];
// MOUNTAIN.md §5 の表。hl: 'all' は「すべて」＝4世代すべて、null は検査しない。
const EXPECT = {
  overview: { form: 'terrain', camera: 'overview', hl: 'all', cut: null },
  war: { form: 'terrain', camera: 'war', hl: ['postwar'], cut: null },
  dankai: { form: 'terrain', camera: 'dankai', hl: ['dankai'], cut: null },
  hinoeuma: { form: 'terrain', camera: 'hinoeuma', hl: ['hinoeuma'], cut: null },
  'dankai-jr': { form: 'terrain', camera: 'dankai-jr', hl: ['dankai-jr'], cut: null },
  flight: { form: 'terrain', camera: 'dankai', hl: ['dankai'], cut: null },
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
  return `${args.base}/${parts.length ? '?' + parts.join('&') : ''}`;
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

    await check('3. ツアー：8段を順にスクロールすると body[data-step] と getState() が §5 の表に一致する', async () => {
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

    await check('4g. ツールチップ：世代の線か面をクリックすると #pick-tooltip に「N年生まれ」・年と年齢・男女と人数が、全国ページの書式で出る', async () => {
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

    // ---- 4j〜: 再生・巻き戻し・単年スライダー ----
    // scene.setCutYear を包んで、再生中に scene へ渡った年を記録する
    const hookYears = () => fp.evaluate(() => {
      const sc = window.__mountain.scene;
      window.__cutLog = [];
      if (!sc.__wrapped) {
        const orig = sc.setCutYear.bind(sc);
        sc.setCutYear = (y) => { window.__cutLog.push(y); return orig(y); };
        sc.__wrapped = true;
      }
    });
    const playLabel = () => fp.getAttribute('#btn-cut-play', 'aria-label');
    const setYear = async (y) => {
      await fp.locator('#cut-slider').fill(String(y));
      await fp.waitForFunction((yy) => window.__mountain.scene.getState().cutYear === yy, y, { timeout: 4000 });
      await sleep(100);
    };
    await check('4j. #btn-cut-play：2秒後に年が2年以上進み、aria-label が「一時停止」になる。もう一度押すと止まる', async () => {
      await setYear(1960);
      assert(await playLabel() === '再生', `開始前の aria-label=${await playLabel()}`);
      await fp.click('#btn-cut-play');
      await sleep(2000);
      const mid = Number(await fp.inputValue('#cut-slider'));
      assert(mid - 1960 >= 2, `2秒後の年=${mid}（2年以上進むはず）`);
      assert(await playLabel() === '一時停止', `再生中の aria-label=${await playLabel()}`);
      assert(await fp.getAttribute('#cut-year-out', 'aria-live') === 'off', '再生中の aria-live が off でない');
      await fp.click('#btn-cut-play');
      assert(await playLabel() === '再生', '一時停止後の aria-label が「再生」でない');
      assert(await fp.getAttribute('#cut-year-out', 'aria-live') === 'polite', '停止後の aria-live が polite でない');
      const stopped = Number(await fp.inputValue('#cut-slider'));
      assert((await getState(fp)).cutYear === stopped, 'scene の cutYear がスライダーと違う');
      await sleep(900);
      assert(Number(await fp.inputValue('#cut-slider')) === stopped, '一時停止後も年が進んだ');
    });

    await check('4k. 1939年から再生すると、記録した年に1941〜43年が含まれず、1940の次は1944になる', async () => {
      await setYear(1939);
      await hookYears();
      await fp.click('#btn-cut-play');
      await fp.waitForFunction(() => window.__cutLog.length >= 3, null, { timeout: 5000 });
      await fp.click('#btn-cut-play');
      const log = await fp.evaluate(() => window.__cutLog);
      const bad = log.filter((y) => y >= 1941 && y <= 1943);
      assert(bad.length === 0, `データのない年を表示した: ${bad.join(',')}（記録=${log.join(',')}）`);
      assert(log[0] === 1940 && log[1] === 1944, `記録=${log.join(',')} 期待=1940,1944,…`);
    });

    await check('4l. 2024年から再生すると2025年で止まり、aria-label が「再生」に戻る。最終年で押すと1920年から始まる', async () => {
      await setYear(2024);
      await fp.click('#btn-cut-play');
      await fp.waitForFunction(() => document.getElementById('cut-slider').value === '2025', null, { timeout: 3000 });
      await sleep(300);
      assert(await playLabel() === '再生', `2025年到達後の aria-label=${await playLabel()}`);
      assert((await getState(fp)).cutYear === 2025, 'cutYear が2025でない');
      await sleep(900);
      assert(await fp.inputValue('#cut-slider') === '2025', '2025年のあとも動いた');
      await fp.click('#btn-cut-play');
      assert(await fp.inputValue('#cut-slider') === '1920', `最終年から再生した直後の年=${await fp.inputValue('#cut-slider')} 期待=1920`);
      assert(await playLabel() === '一時停止', '最終年から再生しても「一時停止」にならない');
      await fp.click('#btn-cut-play');
    });

    await check('4m. #btn-cut-rewind：再生を止めて1920年に戻す（aria-label「最初に戻る」）', async () => {
      assert(await fp.getAttribute('#btn-cut-rewind', 'aria-label') === '最初に戻る', 'aria-label が「最初に戻る」でない');
      await setYear(1980);
      await fp.click('#btn-cut-play');
      await sleep(600);
      await fp.click('#btn-cut-rewind');
      assert(await fp.inputValue('#cut-slider') === '1920', `巻き戻し後の年=${await fp.inputValue('#cut-slider')}`);
      assert(await playLabel() === '再生', '巻き戻し後の aria-label が「再生」でない');
      await fp.waitForFunction(() => window.__mountain.scene.getState().cutYear === 1920, null, { timeout: 3000 });
      await sleep(900);
      assert(await fp.inputValue('#cut-slider') === '1920', '巻き戻し後に年が進んだ');
    });

    await check('4n. 再生中にスライダーを操作すると再生が止まる', async () => {
      await setYear(1950);
      await fp.click('#btn-cut-play');
      await sleep(500);
      await fp.locator('#cut-slider').fill('1990');
      await sleep(100);
      assert(await playLabel() === '再生', 'スライダー操作後も再生中のまま');
      await sleep(900);
      assert(await fp.inputValue('#cut-slider') === '1990', `操作後に年が進んだ: ${await fp.inputValue('#cut-slider')}`);
    });

    await check('4o. 再生中に free 以外の段へスクロールすると再生が止まる', async () => {
      await setYear(1950);
      await fp.click('#btn-cut-play');
      await sleep(500);
      await scrollToStep(fp, 'hinoeuma');
      await waitBodyStep(fp, 'hinoeuma');
      assert(await playLabel() === '再生', `他の段に移ったあとの aria-label=${await playLabel()}`);
      await scrollToStep(fp, 'free');
      await waitBodyStep(fp, 'free');
    });

    await check('4p. スライダーのトラックは左から塗られていない（つまみの左右でレールの色が同じ）', async () => {
      await setYear(1966);
      await fp.evaluate(() => document.getElementById('cut-timeline').scrollIntoView({ block: 'center' }));
      await sleep(200);
      const box = await fp.locator('#cut-timeline').boundingBox();
      const thumbX = await fp.evaluate(() => {
        const s = document.getElementById('cut-slider');
        const r = s.getBoundingClientRect();
        return r.left + 8 + ((Number(s.value) - Number(s.min)) / (Number(s.max) - Number(s.min))) * (r.width - 16);
      });
      const railY = box.y + 34;
      const buf = await fp.screenshot({ clip: { x: 0, y: Math.floor(railY - 6), width: 1280, height: 12 } });
      const px = await fp.evaluate(async ({ src, xs }) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const sc = img.naturalWidth / 1280;
        // レールは y 方向に 2px。上下 12px の帯の中から、背景と違う行を探して色を取る
        const col = (x) => {
          const out = [];
          for (let yy = 0; yy < c.height; yy++) out.push([...g.getImageData(Math.round(x * sc), yy, 1, 1).data].slice(0, 3).join(','));
          return out.join('|');
        };
        return xs.map(col);
      }, { src: buf.toString('base64'), xs: [thumbX - 40, thumbX + 40] });
      assert(px[0] === px[1], `つまみの左右でトラックの画素列が違う\n左=${px[0]}\n右=${px[1]}`);
      const accent = await fp.evaluate(() => getComputedStyle(document.getElementById('cut-slider'), '::-webkit-slider-runnable-track').backgroundColor);
      assert(/rgba\(0, 0, 0, 0\)|transparent/.test(accent), `トラックの背景が透明でない: ${accent}`);
    });
    await f.ctx.close();

    // ---- 12: 尾根沿いのフライト ----
    const fl = await openPage(browser, DESKTOP, 'flight', 'step=flight');
    const flp = fl.page;
    const flightOf = () => flp.evaluate(() => window.__mountain.scene.getState().flight);
    const hudOf = () => flp.evaluate(() => { const h = document.getElementById('flight-hud'); return { shown: !!h && !h.hidden && h.getClientRects().length > 0, text: h ? h.textContent : '' }; });
    await check('12a. ?step=flight：フライトが始まり、progress が時間とともに増え、終わると null に戻る。#flight-hud が見え、年が進む', async () => {
      await waitBodyStep(flp, 'flight');
      await flp.waitForFunction(() => window.__mountain.scene.getState().flight !== null, null, { timeout: 5000 });
      const f0 = await flightOf();
      assert(f0.cohort === 'dankai', `cohort=${f0.cohort}`);
      const h0 = await hudOf();
      await sleep(2500);
      const f1 = await flightOf();
      const h1 = await hudOf();
      assert(f1 && f1.progress > f0.progress, `progress が増えない: ${f0.progress} → ${f1 && f1.progress}`);
      const bad = [];
      if (!h0.shown || !h1.shown) bad.push(`#flight-hud が見えない: ${JSON.stringify([h0, h1])}`);
      const yr = (t) => Number((/(\d{4})年/.exec(t) || [])[1]);
      if (!(yr(h1.text) > yr(h0.text))) bad.push(`#flight-hud の年が進まない: ${h0.text} → ${h1.text}`);
      if (!/^団塊の世代・\d{4}年・(数え年)?\d+(〜\d+)?歳$/.test(h1.text)) bad.push(`#flight-hud の書式: ${h1.text}`);
      if (await flp.getAttribute('#flight-hud', 'aria-live') !== 'off') bad.push('#flight-hud の aria-live が off でない');
      const legend = await flp.evaluate(() => document.getElementById('legend').textContent);
      if (!legend.includes('団塊の世代')) bad.push(`凡例が飛行中の世代に合っていない: ${legend}`);
      await flp.waitForFunction(() => window.__mountain.scene.getState().flight === null, null, { timeout: 16000 });
      await sleep(100);
      if ((await hudOf()).shown) bad.push('終わったあとも #flight-hud が出ている');
      assert(bad.length === 0, bad.join('\n'));
    });
    if (!args.stub) {
      await check('12b. フライト中、カメラは面にめり込まない（数点で、カメラの高さがその位置の面の高さより上）', async () => {
        await flp.click('#btn-fly-again');
        await flp.waitForFunction(() => window.__mountain.scene.getState().flight !== null, null, { timeout: 3000 });
        const bad = [];
        let n = 0;
        while (n < 12) {
          await sleep(700);
          const v = await flp.evaluate(() => {
            const sc = window.__mountain.scene, st = sc.getState();
            const [x, y, z] = sc._debug.cameraPosition();
            return { fl: st.flight, x, y, z, ground: sc._debug.surfaceHeight(x, z) };
          });
          if (!v.fl) break;
          n++;
          if (!(v.y > v.ground) || !(v.fl.clearance > 0)) bad.push(`progress=${v.fl.progress.toFixed(2)}: カメラ y=${v.y.toFixed(3)} 面=${v.ground.toFixed(3)} clearance=${v.fl.clearance}`);
        }
        if (n < 5) bad.push(`確かめた点が${n}点しかない`);
        assert(bad.length === 0, bad.join('\n'));
        await flp.waitForFunction(() => window.__mountain.scene.getState().flight === null, null, { timeout: 16000 });
      });
    }
    await check('12c. #btn-fly-again で再び始まる。段を離れると止まる', async () => {
      await flp.waitForFunction(() => window.__mountain.scene.getState().flight === null, null, { timeout: 16000 });
      await flp.click('#btn-fly-again');
      await flp.waitForFunction(() => { const f = window.__mountain.scene.getState().flight; return f && f.cohort === 'dankai'; }, null, { timeout: 3000 });
      await scrollToStep(flp, 'cut2025');
      await waitBodyStep(flp, 'cut2025');
      await flp.waitForFunction(() => window.__mountain.scene.getState().flight === null, null, { timeout: 3000 });
      assert(!(await hudOf()).shown, '段を離れたあとも #flight-hud が出ている');
    });
    await check('12d. free：#flight-cohort を hinoeuma にして #btn-fly を押すとその世代で始まり、もう一度押すと止まる', async () => {
      await scrollToStep(flp, 'free');
      await waitBodyStep(flp, 'free');
      await flp.click('#form-toggle button[data-form="pyramid"]');
      await flp.selectOption('#flight-cohort', 'hinoeuma');
      const label0 = (await flp.textContent('#btn-fly')).trim();
      await flp.click('#btn-fly');
      await flp.waitForFunction(() => { const f = window.__mountain.scene.getState().flight; return f && f.cohort === 'hinoeuma'; }, null, { timeout: 3000 });
      const bad = [];
      if (label0 !== '尾根に沿って飛ぶ') bad.push(`押す前のボタン=${label0}`);
      const label1 = (await flp.textContent('#btn-fly')).trim();
      if (label1 !== '止める') bad.push(`飛行中のボタン=${label1}`);
      const st = await getState(flp);
      if (st.form !== 'terrain') bad.push(`飛行中の形=${st.form}（地形型に固定するはず）`);
      if (await flp.getAttribute('body', 'data-form') !== 'terrain') bad.push('body[data-form] が terrain でない');
      if (await flp.getAttribute('#form-toggle button[data-form="terrain"]', 'aria-pressed') !== 'true') bad.push('形の切り替えの表示が地形型でない');
      const legend = await flp.evaluate(() => document.getElementById('legend').textContent);
      if (!legend.includes('丙午') || legend.includes('団塊ジュニア')) bad.push(`凡例が飛行中の世代に合っていない: ${legend.replace(/\s+/g, ' ')}`);
      await sleep(1200);
      if (!/^丙午・\d{4}年・(数え年)?\d+歳$/.test((await hudOf()).text)) bad.push(`#flight-hud=${(await hudOf()).text}`);
      await flp.click('#btn-fly');
      await flp.waitForFunction(() => window.__mountain.scene.getState().flight === null, null, { timeout: 3000 });
      const label2 = (await flp.textContent('#btn-fly')).trim();
      if (label2 !== '尾根に沿って飛ぶ') bad.push(`止めたあとのボタン=${label2}`);
      if ((await getState(flp)).camera !== 'free') bad.push('止めたあと camera が free でない');
      assert(bad.length === 0, bad.join('\n'));
    });
    await check('12e. 飛行中に canvas を触ると止まる', async () => {
      await flp.click('#btn-fly');
      await flp.waitForFunction(() => window.__mountain.scene.getState().flight !== null, null, { timeout: 3000 });
      await sleep(500);
      const box = await flp.locator('canvas#mountain-canvas').boundingBox();
      await flp.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await flp.mouse.down();
      await flp.mouse.move(box.x + box.width * 0.5 + 40, box.y + box.height * 0.5, { steps: 4 });
      await flp.mouse.up();
      await flp.waitForFunction(() => window.__mountain.scene.getState().flight === null, null, { timeout: 3000 });
      assert((await flp.textContent('#btn-fly')).trim() === '尾根に沿って飛ぶ', 'ボタンが元に戻らない');
    });
    await fl.ctx.close();

    const flr = await openPage(browser, DESKTOP_REDUCED, 'flight-reduced', 'step=flight');
    await check('12f. reduced motion：flight の段では飛ばず、すぐ終わる（getState().flight が null、#flight-hud は出ない）', async () => {
      await waitBodyStep(flr.page, 'flight');
      const bad = [];
      for (let i = 0; i < 4; i++) {
        const f = (await getState(flr.page)).flight;
        if (f !== null) bad.push(`${i * 150}ms: flight=${JSON.stringify(f)}`);
        await sleep(150);
      }
      await flr.page.click('#btn-fly-again');
      await sleep(50);
      if ((await getState(flr.page)).flight !== null) bad.push('もう一度飛ぶの後に flight が null でない');
      const hud = await flr.page.evaluate(() => !document.getElementById('flight-hud').hidden);
      if (hud) bad.push('#flight-hud が出ている');
      assert(bad.length === 0, bad.join('\n'));
    });
    await flr.ctx.close();

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
      assert(await nw.page.locator('.scene-step[data-step]').count() === STEPS.length, '段落が8つ残っていない');
      const vis = await nw.page.evaluate(() => {
        const v = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; };
        return { lede: v('.lede .d3-only'), form: v('#form-toggle'), cohort: v('#cohort-select'), reset: v('#btn-reset-view'), fly: v('#btn-fly'), flyAgain: v('#btn-fly-again'), flightFallback: v('.scene-step[data-step="flight"] .fallback-only'), slider: v('#cut-slider'), inset: v('#inset'), table: v('#data-details'), legend: v('#legend') };
      });
      const bad = [];
      if (vis.lede) bad.push('「スクロールすると…」が残っている');
      if (vis.form) bad.push('形の切り替えが残っている');
      if (vis.cohort) bad.push('強調する世代が残っている');
      if (vis.reset) bad.push('視点を戻すが残っている');
      if (vis.fly || vis.flyAgain) bad.push('フライトのボタンが残っている');
      if (!vis.flightFallback) bad.push('flight の段に「対応した環境では…」の文言が出ていない');
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
      const hidden = links.filter((h) => /(^|\/)(national|regions)\.html(\?|#|$)/.test(h));
      if (hidden.length) bad.push(`3Dページに national.html / regions.html へのリンクがある: ${JSON.stringify(hidden)}`);
      if (await dp.locator('.page-nav').count() !== 0) bad.push('3Dページに .page-nav が残っている');
      const robots = await dp.$$eval('meta[name="robots"]', (ms) => ms.map((m) => m.content));
      if (robots.some((c) => /noindex/i.test(c))) bad.push(`3Dページに noindex がある: ${JSON.stringify(robots)}`);
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

    await check('11a2. ページの本文（body の innerText）に「糸」と「コホート」が出てこない（用語は「世代の線」に統一）', async () => {
      const text = await dp.evaluate(() => document.body.innerText);
      const found = ['糸', 'コホート'].filter((w) => text.includes(w));
      assert(found.length === 0, `本文に旧用語が残っている: ${found.join('、')}`);
    });

    await check('11b. 凡例：375px では折りたたまれ、段の強調する世代の名前が出る。1280px では開いている', async () => {
      const bad = [];
      const open375 = await mp.evaluate(() => document.getElementById('legend-details').open);
      if (open375) bad.push('375px で凡例が開いたまま');
      const rect = await mp.evaluate(() => { const r = document.getElementById('legend').getBoundingClientRect(); const c = document.getElementById('mountain-canvas').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cl: c.left, cr: c.right, ct: c.top, cb: c.bottom }; });
      if (rect.l < rect.cl - 1 || rect.r > rect.cr + 1 || rect.t < rect.ct - 1 || rect.b > rect.cb + 1) bad.push(`凡例が canvas からはみ出す: ${JSON.stringify(rect)}`);
      await mp.evaluate(() => document.getElementById('legend-details').setAttribute('open', ''));
      const items = await mp.$$eval('#legend-details .legend-list li', (l) => l.map((x) => x.textContent.trim()));
      for (const w of ['男性', '女性', '強調する世代の線', '破線', '数え年', '推計なし']) {
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

    await m.ctx.close();
    await d.ctx.close();

    // ---- 10: 他ページからのリンク ----
    await check('10. 2Dの2ページは ./ へ戻るリンクだけを持ち、noindex。/mountain.html は / へ転送する', async () => {
      const ctx = await browser.newContext(DESKTOP_REDUCED);
      const pg = await ctx.newPage();
      const bad = [];
      try {
        for (const file of ['national.html', 'regions.html']) {
          await pg.goto(`${args.base}/${file}`, { waitUntil: 'load' });
          const hrefs = await pg.$$eval('.page-nav a[href]', (as) => as.map((a) => a.getAttribute('href')));
          if (hrefs.length !== 1 || hrefs[0] !== './') bad.push(`${file}: .page-nav が ["./"] だけではない ${JSON.stringify(hrefs)}`);
          const all = await pg.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
          const other = all.filter((h) => /(^|\/)(index|national|regions|mountain)\.html(\?|#|$)/.test(h));
          if (other.length) bad.push(`${file}: 他ページへのリンクがある ${JSON.stringify(other)}`);
          const robots = await pg.$$eval('meta[name="robots"]', (ms) => ms.map((m) => m.content));
          if (!robots.some((c) => /noindex/i.test(c))) bad.push(`${file}: noindex がない`);
        }
        await pg.goto(`${args.base}/`, { waitUntil: 'load' });
        const robots = await pg.$$eval('meta[name="robots"]', (ms) => ms.map((m) => m.content));
        if (robots.length) bad.push(`/: robots メタがある ${JSON.stringify(robots)}`);
        const canon = await pg.$$eval('link[rel="canonical"]', (ls) => ls.map((l) => l.href));
        if (canon.join() !== 'https://population-pyramid.structure-and-representation.com/') bad.push(`/: canonical=${JSON.stringify(canon)}`);
        await pg.goto(`${args.base}/mountain.html?step=free&fixture=1`, { waitUntil: 'load' });
        await pg.waitForURL((u) => !/mountain\.html/.test(u.pathname), { timeout: 10000 });
        const u = new URL(pg.url());
        if (u.pathname !== '/') bad.push(`/mountain.html の転送先 pathname=${u.pathname}`);
        if (u.searchParams.get('step') !== 'free' || u.searchParams.get('fixture') !== '1') bad.push(`クエリが引き継がれない: ${u.search}`);
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
