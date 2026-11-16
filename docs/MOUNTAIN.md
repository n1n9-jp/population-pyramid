# 3Dページ「人口の山脈とコホートの糸」の契約（全担当が参照する）

全国ページ（index.html）と地域別ページ（regions.html）は残す。新しく `mountain.html` を作り、全国の各歳別人口を3Dで見せる。見た目の基準は、docs/mocks/3d/ の静止画モック（01〜08）と、その元になった mock.html。色は男女の色（モック01）を使う。

Git の手順は docs/PLAN.md §5 と同じ。ブランチは `claude/sharp-newton-grgdly`。所有パスだけを add し、pull --rebase してから push する。force push はしない。

## 1. データ
- `data/pyramid.json`（docs/PLAN.md §3）。各歳0〜100歳 × 男女 × 103年。
- `?fixture=1` のときは `tests/fixtures/pyramid.fixture.json` を読み、「サンプルデータ」の帯を出す。
- データの扱い：
  - 1941〜43年はデータがない。面はすき間にし、補間しない。
  - 1944〜46年は数え年。その帯は淡く描き、糸は破線にする。
  - 各年の `openAge` の段（上位年齢の一括区分）は面に含めない。面の上端の外に小さな印で示す。
  - 注記の文言は、data/pyramid.json の notes を使う。

## 2. 空間と形
- 軸は3本：年（1920→2025）、年齢（0→100）、人数。人数の尺度は `xMaxPerSex` に固定する。
- **地形型（terrain）**
  - x＝年、z＝年齢、y＝人数。
  - 男性は手前、女性は奥に置き、100歳の側で鏡写しにする（モック01）。
- **立体ピラミッド型（pyramid）**
  - y＝年齢、x＝人数（男性は左にマイナス、女性は右にプラス）、z＝年（新しい年ほど手前）。
  - 正面から見るときは正射影のカメラを使い、断面の年より奥は淡く描く。過去の年の厚みが2Dの形をはみ出して見える問題（モック06）は、これで避ける。
- 2つの形は同じ頂点を使い、座標を補間して変形させる（700ms）。

## 3. コホートの糸
- 生まれ年 b の糸は、各年 y で年齢 a = y − b の点を通る。数え年の年は a = y − b + 1。男女の面に1本ずつ引く。
- 基本は5年おきの生まれ年を、細く淡く描く。
- 強調する世代（id：生まれ年）
  - `dankai`：1947〜1949
  - `hinoeuma`：1966
  - `dankai-jr`：1971〜1974
  - `postwar`：1945〜1946。破線で描く。
- 強調の色：男性は #3e6593、女性は #8a5a12。
- ピッキング：糸か面にホバーまたはタップすると、`{sex, birthYear, year, age, value}` を返す。

## 4. モジュールの境界
- **js/mountain/scene.js**（M1）
  - `createMountain({canvas, data, reducedMotion})` で作る。返す API は次のとおり。
    - `setForm(form, {animate})`：form は `"terrain"` か `"pyramid"`
    - `setCamera(preset, {animate})`
    - `setCutYear(year|null)`
    - `setHighlight(ids[])`
    - `setOrbit(enabled)`
    - `resize(w, h)`
    - `getState()`：`{form, camera, cutYear, highlight}` を返す
    - `onPick(cb)`
    - `dispose()`
  - カメラのプリセット：`overview`、`war`、`dankai`、`hinoeuma`、`dankai-jr`、`cut2025`、`pyramid-front`、`free`。
  - js/mountain/geometry.js など、補助のファイルは自由に分けてよい。
- **js/mountain/{main,tour,ui,inset}.js、mountain.html、css/mountain.css**（M2）
  - scene の API だけを使う。scene の中には手を入れない。
- three.js は `three@0.160.0`。jsdelivr から importmap で読み込む（mock.html と同じ書き方）。
- ビルド工程は持たない。

## 5. ページとツアー（mountain.html）
- 左（狭い画面では上）に固定の canvas、右（狭い画面では下）にスクロールで進む解説の段落を置く（モック08）。
- 段落 `.scene-step[data-step]` が画面に入ると、IntersectionObserver でカメラと形を切り替える。各段の設定は次のとおり。

| data-step | 形 | カメラ | 強調 | 断面 |
|---|---|---|---|---|
| overview | terrain | overview | すべて | なし |
| war | terrain | war | postwar | なし |
| dankai | terrain | dankai | dankai | なし |
| hinoeuma | terrain | hinoeuma | hinoeuma | なし |
| dankai-jr | terrain | dankai-jr | dankai-jr | なし |
| cut2025 | terrain → pyramid | cut2025 → pyramid-front | すべて | 2025 |
| free | 現状のまま | free（オービット操作を有効にする） | 選択に従う | スライダー |

- 解説文は短く書く（各段2〜4文）。数値は data/pyramid.json から計算できる値と、全国ページの解説文に出典付きで載っている値だけを使う。
- **free で使う UI**
  - 形の切り替え：`#form-toggle button[data-form]`（aria-pressed）
  - 断面のスライダー：`#cut-slider`。値は年で、1920〜2025。データのない年は全国ページと同じく、移動の向きで解決する。
  - 強調する世代の選択：`#cohort-select input[data-cohort]`
  - 断面の2D小窓：`#inset`。中は SVG で、棒は `rect.inset-bar[data-sex][data-age][data-value]`。
    - 小窓は全国ページと同じく、各年の `openAge` の段も棒（`.inset-open`、淡く描く）で出す。面（3D）には含めない。E2E は「openAge の段は `.inset-open` であること」を確かめる。
    - 小窓の年齢の目盛りは、棒より後に描き、隠れないようにする。
- **注記**：文言は `data.notes` から描く。解説文中の `[data-note-text]`、free の `#year-notes`（断面の年の `noteIds` に当てはまる注記）、「見方の注意」の `#notes-list`（全注記）。
- **free の canvas**：free の段では `#mountain-canvas[data-free="true"]` にし、スマホで回転とピンチができるよう `touch-action: none` にする。
- **ツールチップ**：`#pick-tooltip`。hidden 属性で出し入れする。内容は、世代（「1949年生まれ」）、その年、年齢、人数。人数の書式は js/format.js の formatPersons に合わせる。
- **代わりの表示**：WebGL が使えないときは `#webgl-fallback` に静止画 `assets/mountain-fallback.png`（モック01と同じ構図）を出し、案内文を添える。
- **reduced motion**：変形もカメラの移動もしない。各段では最終の状態をそのまま表示する。
- **補助**
  - データ表を `<details>` に入れる。中身は、断面の年の各歳と男女の人数。全国ページと同じ形式（年齢は `th scope=row`、値のない所は「—」、全行を表示し、閉じている間は描かない）。
  - 全国ページと地域別ページへのリンクを置く。
  - index.html と regions.html の `.page-nav` に「3Dで見る →」を1行ずつ足す。ほかの部分は変えない。
- **URL**：`?step=<data-step>` を付けて開くと、その段にスクロールした状態で始まる。

## 6. E2E との約束
- `canvas#mountain-canvas`
- `body[data-ready="true"]`、`body[data-step]`、`body[data-form]`
- `window.__mountain = { scene, data }`。`scene.getState()` は §4 のとおり。
- §5 に出てくる id とクラス。

## 7. 実行コマンド
- `python3 -m http.server 8000` を起動して `http://localhost:8000/mountain.html` を開く。
- E2E：`node tests/e2e/mountain.cjs --base http://localhost:8000 [--fixture] [--stub] [--out DIR]`（`--stub` は `?stub=1` の仮実装で開く）。WebGL が要るので、chromium は `--use-gl=swiftshader --enable-unsafe-swiftshader` を付けて起動する（docs/mocks/3d/shoot.js を参照）。
- smoke.cjs と regions.cjs も合格のままにすること。
