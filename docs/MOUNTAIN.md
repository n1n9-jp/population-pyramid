# 3Dページ「人口の山脈とコホートの糸」の契約（全担当が参照する）

公開の入口は、この3Dページ（`index.html`）にする。全国ページ（national.html）と地域別ページ（regions.html）は残すが、3Dページからはリンクせず、noindex にして、URLを直接開いた人だけが見られるようにする。旧 `mountain.html` は `/` への転送ページにする。この3Dページで、全国の各歳別人口を3Dで見せる。見た目の基準は、docs/mocks/3d/ の静止画モック（01〜08）と、その元になった mock.html。色は男女の色（モック01）を使う。

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
    - `resetView({animate})`：視点を今の段の既定に戻す。free では、今の形を見るための既定の視点（地形型は overview、ピラミッド型は斜めから全体）へ移す。ボタンはページ側が付ける。
    - `getState()`：`{form, camera, cutYear, highlight, flight}` を返す。`flight` は飛行中なら `{cohort, progress, year, age, clearance}`（`clearance` はカメラの高さと、その位置の面の高さの差。確認用）、それ以外は `null`
    - `fly(cohortId, {duration, onProgress, onEnd})`：世代の尾根に沿って飛ぶ（下の「尾根沿いのフライト」）。`duration` の既定は 12000ms。`onProgress({cohort, progress, birthYear, year, age, value, kazoe})` を毎フレーム、`onEnd({reason, cohort})` を終わりに1回呼ぶ。reason は `end`（最後まで飛んだ）、`user`（canvas を触った）、`stop`（stopFlight・setCamera・ピラミッド型への setForm）、`reduced`（reduced motion）
    - `stopFlight()`：飛行中なら止める。その場で元の画角に戻す
    - `onPick(cb)`：`cb(result|null, {type:'hover'|'tap', x, y})`。ホバー（マウス）で出したものは、ポインタが canvas から出ると `null` で消す。タップで出したものは、次のタップまで残す（何もない所をタップすると `cb(null, {type:'tap'})`）。タッチの pointerleave では消さない。
    - `dispose()`
  - カメラのプリセット：`overview`、`war`、`dankai`、`hinoeuma`、`dankai-jr`、`cut2025`、`pyramid-front`、`free`。
    - free の段で `setForm` を呼ぶと、その形を見るための既定の視点へなめらかに移る（`resetView` と同じ行き先）。free で canvas を触ると、移動をやめて操作に従う。
    - 断面より奥の年を淡くする処理と、奥の年を通る糸を隠す処理は、カメラの名前ではなく「form が pyramid で、正面（z 軸の向き）に近い視線」のときに掛ける。free で正面から見た場合も同じ。
    - 世代を追う段（war・dankai・hinoeuma・dankai-jr）では、主役の糸が谷の底で手前の尾根に隠れないよう、強調の糸を面より手前に描く。
    - **尾根沿いのフライト**（`fly`）
      - 経路は、その世代の糸（男性の面。生まれ年が複数ある世代は中央の年）に沿う。生まれた年から2025年まで。1941〜43年のすき間は両隣の年の点を結んで止まらずに飛び越え、数え年の年（1944〜46年）は糸と同じく a = y − b + 1 の点を通る。
      - カメラは、同じ年のまま若い年齢の側（手前）へ少し離れ、尾根（糸）より少し高く、かつ近くの面の高さの最大値より上を飛ぶ。視線は少し先の経路の点を糸の側へ寄せた点に向ける。位置・高さ・視線は移動平均でなめらかにし、高さは「最大値で膨らませてから平均」して、必要な高さを下回らないようにする。
      - 飛行中は形を terrain に固定し（ピラミッド型なら地形型に戻す）、オービット操作を切る。その世代の糸（男性の面）を面より手前に太く描き、ほかの強調の糸は隠す。透視投影の画角は広め（58°）にし、終わったら元の画角に戻す。
      - 最後まで飛んだら、尾根を振り返って全体が見える位置へなめらかに移って止まる。
      - 飛行中に canvas をドラッグ・タップ（またはホイール）すると止まり、その段のオービット操作（free なら有効）に戻る。
      - reducedMotion のときは飛ばない。経路の中ほどの視点を表示し、onEnd をすぐ呼ぶ。
    - 各プリセットは、見せる範囲と、その近くの目盛りの文字がキャンバスに収まる距離に置く。文字はキャンバスの端で切れるときと、優先度の高い文字に重なるときは出さない。
  - js/mountain/geometry.js など、補助のファイルは自由に分けてよい。
- **js/mountain/{main,tour,ui,inset}.js、index.html、css/mountain.css**（M2）
  - scene の API だけを使う。scene の中には手を入れない。
- three.js は `three@0.160.0`。jsdelivr から importmap で読み込む（mock.html と同じ書き方）。
- ビルド工程は持たない。

## 5. ページとツアー（index.html）
- 左（狭い画面では上）に固定の canvas、右（狭い画面では下）にスクロールで進む解説の段落を置く（モック08）。
- 段落 `.scene-step[data-step]` が画面に入ると、IntersectionObserver でカメラと形を切り替える。各段の設定は次のとおり。

| data-step | 形 | カメラ | 強調 | 断面 |
|---|---|---|---|---|
| overview | terrain | overview | すべて | なし |
| war | terrain | war | postwar | なし |
| dankai | terrain | dankai | dankai | なし |
| hinoeuma | terrain | hinoeuma | hinoeuma | なし |
| dankai-jr | terrain | dankai-jr | dankai-jr | なし |
| flight | terrain | dankai（飛ぶ前と止めたとき） | dankai | なし |
| cut2025 | terrain → pyramid | cut2025 → pyramid-front | すべて | 2025 |
| free | 現状のまま | free（オービット操作を有効にする） | 選択に従う | スライダー |

- **flight の段**：段に入ったら、団塊の世代（`dankai`）のフライトを自動で1回始める。段の中に「もう一度飛ぶ」ボタン `#btn-fly-again` を置く。段を離れたら止める。
  - 飛行中は canvas の上に `#flight-hud`（aria-live="off"）を出す。文言は「団塊の世代・1975年・26〜28歳」の形（年と年齢は onProgress から。年齢はその世代の生まれ年の幅で、数え年の年は「数え年」を付ける）。終わったら隠す。
  - 凡例の「強調している世代」は、飛行中はその世代に合わせ、終わったら段（free では選択）の強調に戻す。
  - WebGL が使えないとき（body[data-fallback]）は、段の文言を「対応した環境では…」に変え、ボタンを隠す。
- 解説文は短く書く（各段2〜4文）。数値は data/pyramid.json から計算できる値と、全国ページの解説文に出典付きで載っている値だけを使う。
- **free で使う UI**
  - 形の切り替え：`#form-toggle button[data-form]`（aria-pressed）
  - 断面のスライダー：`#cut-slider`。値は年で、1920〜2025。データのない年は全国ページと同じく、移動の向きで解決する。
    - スライダーは「1つの年を指す針」に見せる。トラックは左から塗らない一様な線（accent-color や標準の塗りも使わない）にし、選んだ年はつまみと、その上の年のラベル（「1966年」）で示す。10年ごとの目盛り、端の年（1920・2025）、1941〜43年の網掛け（全国ページと同じ）を付ける。
  - 再生：`#btn-cut-play`（aria-label「再生」／「一時停止」）と `#btn-cut-rewind`（「最初に戻る」）。見た目は全国ページと同じ。
    - 再生中は1年400msで進め、データのない年は飛ばす。2025年で止めて「再生」に戻す。最終年で押したら1920年から始める。巻き戻しは1920年に戻して止める。
    - 年が変わるたびに、断面・2D小窓・データ表（開いているときだけ）・注記・年のラベルを更新する。
    - スライダーの操作、free 以外の段へのスクロール、タブが隠れたときに止める。再生中は年のラベルの aria-live を off にし、止めたら polite に戻す。
    - reduced motion でも再生できる（変形やカメラの遷移はしない）。
  - 強調する世代の選択：`#cohort-select input[data-cohort]`
  - 尾根沿いのフライト：世代を選ぶ `#flight-cohort`（select。4世代）と `#btn-fly`（「尾根に沿って飛ぶ」／飛行中は「止める」）。ピラミッド型のときは地形型に戻してから飛ぶ。
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
  - 全国ページと地域別ページへのリンクは置かない。
  - national.html と regions.html の `.page-nav` は「← 人口の山脈（3D）へ」（href="./"）の1本だけにする。
- **URL**：`?step=<data-step>` を付けて開くと、その段にスクロールした状態で始まる。

## 6. E2E との約束
- `canvas#mountain-canvas`
- `body[data-ready="true"]`、`body[data-step]`、`body[data-form]`
- `window.__mountain = { scene, data }`。`scene.getState()` は §4 のとおり。
- §5 に出てくる id とクラス。

## 7. 実行コマンド
- `python3 -m http.server 8000` を起動して `http://localhost:8000/` を開く。
- E2E：`node tests/e2e/mountain.cjs --base http://localhost:8000 [--fixture] [--stub] [--out DIR]`（`--stub` は `?stub=1` の仮実装で開く）。WebGL が要るので、chromium は `--use-gl=swiftshader --enable-unsafe-swiftshader` を付けて起動する（docs/mocks/3d/shoot.js を参照）。
- smoke.cjs と regions.cjs も合格のままにすること。
