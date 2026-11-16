# 日本の人口ピラミッド（1920〜2025年）

日本の人口を各歳・男女別に、1920年から2025年までアニメーションで見せる静的サイトです。米国勢調査局の可視化 [Population Pyramid of the United States（055）](https://www.census.gov/dataviz/visualizations/055/) と同じ体験を、日本のデータで再現しています。ビルド工程はなく、HTML・CSS・JavaScript（ES modules）と D3 v7.9.0（CDN）だけで動きます。

## 公開URLとページ構成

公開URLは <https://population-pyramid.structure-and-representation.com/>（GitHub Pages、`main` ブランチ）です。表に出すのは3Dページ（`index.html`）だけです。2Dの2ページは、他ページからリンクせず `noindex` にしていますが、URLを直接開けば見られます。

| ページ | ファイル | URL |
|---|---|---|
| 3D「人口の山脈をたどる：世代の100年」（公開の入口） | `index.html` | `/` |
| 全国の各歳別ピラミッド（2D） | `national.html` | `/national.html` |
| 都道府県・地方別（2D） | `regions.html` | `/regions.html` |
| 古いURLの転送 | `mountain.html` | `/mountain.html` → `/`（`?step=` などのクエリを引き継ぐ） |

2Dの2ページには、3Dページへ戻るリンク（「← 人口の山脈（3D）へ」）だけを置いています。

計測タグ（Google タグマネージャー、コンテナID `GTM-KGP7P7TR`）を `index.html`・`national.html`・`regions.html` の `<head>` に入れています（転送ページ `mountain.html` には入れていません）。E2E では GTM / GA への通信を止めて検査します。

## ローカルで見る

リポジトリ直下で次を実行し、<http://localhost:8000/>（3D）を開きます。全国の2Dは <http://localhost:8000/national.html> です。`file://` で直接開くと JSON を読み込めないため、必ずサーバー経由で開いてください。

```sh
python3 -m http.server 8000
```

全国の2Dページ（`national.html`）では、`?year=1950` のように URL で年を指定できます。`?fixture=1` を付けると、サンプルデータ（`tests/fixtures/pyramid.fixture.json`）で表示します。

GitHub Pages で公開する場合は、`main` にマージ後、Settings → Pages → Source: Deploy from a branch → Branch: `main` / (root) を選びます。

## データの出典と注意点

すべて総務省統計局の公表資料（e-Stat を含む）から取得し、`data/raw/`（gitignore 済み）に保存して加工しています。

| source_id | 年 | 資料 | 単位 |
|---|---|---|---|
| lt1920 | 1920–1940, 1944–2000 | 人口推計 長期時系列データ 第4表 年齢（各歳），男女別人口 | 千人 |
| lt2000 | 2000–2020 | 人口推計 長期時系列データ（総人口。2015年は後半のシートを採用） | 千人 |
| est2021〜est2024 | 各年 | 人口推計（各年10月1日現在）第1表 | 千人 |
| census2025 | 2025 | 令和7年国勢調査 人口等基本集計 | 人 |

取得元URLとSHA-256は `data/sources.lock.json` に記録しています。主な注意点は次のとおりです。

- 1941〜1943年は年齢別の推計が行われていないため、データがありません。
- 1944〜1946年の年齢は数え年で、調査日も年ごとに異なります。
- 1945〜1971年は沖縄県を含みません。
- いちばん上の年齢区分（上位年齢の一括区分）は年によって異なります（79・80・85・86・90・100歳以上）。
- 2021〜2024年は令和2年国勢調査を基準とする推計人口で、2025年国勢調査による補正前の値です。
- 2025年は年齢「不詳」（男565人・女506人）を図に含めていません（総人口には含みます）。

## データの再構築

```sh
python3 -I scripts/build_data.py            # 取得・整形・検証
python3 -I scripts/build_data.py --offline  # data/raw/ のみ使用
```

`data/pyramid.json`、`data/population_by_age.csv`、`data/population_totals.csv`、`data/build_report.json`、`data/sources.lock.json` が生成されます。終了コードは 0=合格、1=検証FAIL、2=取得失敗です。出力は毎回同じバイト列になります。

## テスト

```sh
python3 -m unittest discover -s tests/py -t .
python3 -m http.server 8000 &
node tests/e2e/smoke.cjs --base http://localhost:8000 --fixture
node tests/e2e/smoke.cjs --base http://localhost:8000 --out docs/screenshots
```

E2E は Playwright（`require('playwright')`）を使い、`--fixture` でサンプルデータ、指定なしで実データを検査します。`--out` を付けるとスクリーンショットを保存します。

## 地域別ページ（regions.html）

都道府県（47）または地方ブロック（8）ごとの小さな人口ピラミッドを並べ、1920〜2025年（5年ごと22時点）を1本のスライダーで一斉に動かします。<http://localhost:8000/regions.html> で開きます（`?year=1950`、`?facet=block`、`?fixture=1` が使えます）。

**見方**：年齢は5歳階級。横軸は「その地域の総人口に占める割合」で、全タイル・全年で共通です。黒い線は同じ年の全国の形、タイルの数字は65歳以上の割合です。仕様は [docs/REGIONS.md](docs/REGIONS.md) にあります。

**データ**（`data/raw/` に保存。取得元URLとSHA-256は `data/sources.lock.json`）：

| source_id | 年 | 資料 | URL |
|---|---|---|---|
| census_ts3 | 1920–2020 | 国勢調査 時系列データ 第3表 年齢（5歳階級），男女別人口－都道府県 | <https://www.e-stat.go.jp/stat-search/file-download?statInfId=000001085927&fileKind=0> |
| census_ts2 | 1920–2020 | 同 第2表（全国。照合にだけ使う） | <https://www.e-stat.go.jp/stat-search/file-download?statInfId=000001085926&fileKind=0> |
| census2025 | 2025 | 令和7年国勢調査 人口等基本集計（不詳補完値） 第2－1表 | <https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040506653&fileKind=0> |

```sh
python3 -I scripts/build_regions.py            # 取得・整形・検証（--offline は data/raw のみ）
python3 -m http.server 8000 &
node tests/e2e/regions.cjs --base http://localhost:8000 --fixture
node tests/e2e/regions.cjs --base http://localhost:8000
```

`data/regions.json`、`data/regions_by_age.csv`、`data/regions_build_report.json` が生成されます。終了コードは 0=合格、1=検証FAIL、2=取得失敗です。`build_data.py` と `build_regions.py` は `data/sources.lock.json` を共有し、互いのキーを消しません。

## 3Dページ（index.html）

全国の各歳別人口を、年・年齢・人数の3軸の「山脈」として立体で見せます。<http://localhost:8000/> で開きます（`?step=free` のように段を指定して開けます。`?fixture=1` はサンプルデータ、`?stub=1` は3D描画を使わない仮実装）。仕様は [docs/MOUNTAIN.md](docs/MOUNTAIN.md) にあります。

**見方**：横が年（1920→2025）、奥行きが年齢（0→100歳）、高さが人数です。手前の面が男性、奥の面が女性で、100歳の側を境に鏡写しに置いています。山を斜めに走る細い線は「世代の線」で、同じ年に生まれた人たちが年ごとに1歳ずつ年齢を重ねていく道すじです。強調の色は男性が青、女性が茶色で、終戦前後（1945〜46年生まれ）は破線です。1941〜43年は推計がないため面にすき間があり、1944〜46年は数え年なので淡く描きます。各年のいちばん上の段（85歳以上など）は面に含めません。

**操作**：右の解説をスクロールすると、見る場所が7段階で切り替わります。最後の「自分で動かして確かめる」では、ドラッグで回転、ホイールやピンチで拡大・縮小、地形型と立体ピラミッド型の切り替え、断面の年のスライダー（推計のない年は動かす向きに飛ばします）、強調する世代の選択ができます。山や世代の線にカーソルを合わせる（スマートフォンではタップする）と、その地点の世代・年・年齢・人数が出ます。断面の年の人数は、2Dの小窓と「データを表で見る」でも読めます。動きを減らす設定（reduced motion）のときは、変形やカメラの移動をせず、各段の最終の状態をそのまま表示します。

**WebGL が使えないとき**：3D表示の代わりに静止画（`assets/mountain-fallback.png`）と案内文を出します。解説文・データ表・全国ページと地域別ページへのリンクは、そのまま使えます。

**E2E**（chromium は swiftshader で動かすため、WebGL のない環境でも実行できます）：

```sh
python3 -m http.server 8000 &
node tests/e2e/mountain.cjs --base http://localhost:8000            # 本番の scene.js・実データ
node tests/e2e/mountain.cjs --base http://localhost:8000 --fixture  # サンプルデータ
node tests/e2e/mountain.cjs --base http://localhost:8000 --stub     # 仮実装（3D描画なし）
node tests/e2e/mountain.cjs --base http://localhost:8000 --out docs/screenshots   # 各段のスクリーンショットも保存
```

## ファイル構成

```
index.html            3Dページ本体（公開の入口）
national.html         全国の2Dページ（解説文は #about）
css/style.css         スタイル
js/                   フロントエンド（ES modules）
js/mountain/          3Dページ（scene.js が three.js の描画）
mountain.html         古いURL用の転送ページ（/ へ移る）
data/                 生成データ（pyramid.json, CSV, build_report.json, sources.lock.json）
data/schema/          pyramid.json のスキーマ
scripts/              データ構築（build_data.py と pyramid_data/）
tests/py/             Python のテスト
tests/e2e/            Playwright の E2E
tests/fixtures/       サンプルデータ
docs/PLAN.md          実装の契約（データ形式・表示仕様）
docs/screenshots/     動作確認のスクリーンショット
```

## アクセシビリティ

棒の淡い色（手本の配色）は背景とのコントラストが3:1に届きません。同じ値はデータ表とツールチップでも読めます。

## 利用条件

出典：総務省統計局「人口推計」「令和7年国勢調査」（e-Stat）を加工して作成

データの利用条件は取得元ごとに異なります。

- e-Stat から取得した表（lt1920、lt2000、census2025）：[e-Stat の利用規約](https://www.e-stat.go.jp/terms-of-use)（政府標準利用規約（第2.0版）に準拠）
- 統計局サイトから取得した表（2021〜2024年の人口推計）：[公共データ利用規約（第1.0版）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)

加工したデータであり、総務省統計局が作成・保証したものではありません。
