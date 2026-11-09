# 実装の契約（全担当が参照する）

日本の人口ピラミッド（1920〜2025年、各歳・男女別）を、米国勢調査局の可視化
https://www.census.gov/dataviz/visualizations/055/ と同じ体験のアニメーションで見せる静的サイト。
ビルド工程なし。D3 は `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js`（SRI付き）。

## 1. 入力データ（data/raw/ に保存。gitignore 済み）

| source_id | 年 | 保存名 | URL | 単位 |
|---|---|---|---|---|
| lt1920 | 1920–1940, 1944–2000 | data/raw/lt1920.xlsx | https://www.e-stat.go.jp/stat-search/file-download?statInfId=000000090264&fileKind=0 | 千人 |
| lt2000 | 2000–2020 | data/raw/lt2000.xlsx | https://www.e-stat.go.jp/stat-search/file-download?statInfId=000013168604&fileKind=4 | 千人 |
| est2021〜est2024 | 各年 | data/raw/est{YYYY}.xlsx | https://www.stat.go.jp/data/jinsui/{YYYY}np/zuhyou/05k{YYYY}-1.xlsx | 千人 |
| census2025 | 2025 | data/raw/census2025.xlsx | https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040506653&fileKind=0 | 人 |

表の要点：
- lt1920（05k5-4.xlsx 第4表）：シート5枚（大正9年～昭和15年／昭和19年～29年／昭和30年～46年／昭和47年～54年／昭和55年～平成12年）。年見出しは0始まり5行目。年見出しの列＝男女計、+1＝男、+2＝女。年齢ラベル列がシートの途中にも挟まる（例：昭和19〜29年シートは列0,5,13,27,32,37）。各年は「自分より左で最も近いラベル列」の行ラベルを使う。11行目が「総数」。値の「－」は null。1979年までは「85 歳以上」、1980年以降は「90 歳以上」。ただし1951・1953・1954年は「80 歳以上」、1952年は「79 歳以上」（`year_meta()` に反映済み）。1944年は数え年で0歳が「－」、1945・1946年は数え年で1〜85歳と「86 歳以上」（ラベル列5）。
- lt2000：シート「総人口（2000年～2015年）」「総人口（2015年～2020年）」を使う（日本人人口シートは使わない）。2015年は後者を採用。0〜99歳と「100 歳以上」（ただし2000〜2004年は「90 歳以上」の合計が「95」の行に1つだけ入り、90〜94・96〜99・100歳以上は空欄。`year_meta()` で openAge=90）。年見出しは6行目、総数は12行目。
- est：シート「第1表」。2段組（左：年齢・男女計・男・女・性比・日本人…で0〜49歳、右：列9から年齢・男女計・男・女で50〜99歳と「100 歳以上」）。総数は12行目左側。
- census2025（wb02_01.xlsx）：行は 列0=「0_国籍総数」、列1=「1_男」/「2_女」、列3=「00000_全国」。7行目の項目名「001_0歳」〜「111_110歳以上」、「112_年齢「不詳」」。100歳以上は「101_100歳」〜「111_110歳以上」の合計。総数は「000_総数」。不詳は男565・女506。

## 2. Python 中間表現

`scripts/pyramid_data/model.py`（変更はオーケストレータ経由）。各パーサは `parse(path) -> list[YearTable]`。
年ごとのメタデータは `year_meta(year)` が唯一の正。パーサはこれを使い、表の実際のラベル（例「85 歳以上」）と食い違えば例外を出す。
lt1920 パーサは 2000 年も返してよい（merge で lt2000 を優先）。

## 3. Web用 JSON（data/pyramid.json）

インデントなし、UTF-8、`ensure_ascii=False`、キー順固定、タイムスタンプなし（毎回同じバイト列）。スキーマは `data/schema/pyramid.schema.json`。

```json
{
  "schemaVersion": 1,
  "fixture": false,
  "unit": "person",
  "ageMax": 100,
  "yearMin": 1920,
  "yearMax": 2025,
  "xMaxPerSex": 1500000,
  "gaps": [{"start": 1941, "end": 1943, "noteId": "gap-1941-1943"}],
  "basisLabels": {"census": "国勢調査", "survey": "人口調査", "intercensal": "補間補正人口", "estimate": "推計人口"},
  "attribution": "出典：総務省統計局「人口推計」「令和7年国勢調査」（e-Stat）を加工して作成",
  "sources": {
    "lt1920": {"title": "人口推計 長期時系列データ 我が国の推計人口（大正9年～平成12年）", "table": "第4表 年齢（各歳），男女別人口", "url": "…", "unitInSource": "千人", "sha256": "…", "retrieved": "2026-11-09"}
  },
  "notes": {"open-85": {"kind": "callout", "short": "85歳以上", "text": "…", "appliesTo": [[1920, 1940], [1944, 1944], [1947, 1979]]}},
  "years": [
    {"year": 1920, "refDate": "1920-10-01", "kazoe": false, "minAge": 0, "openAge": 85,
     "excludesOkinawa": false, "basis": "census", "sourceId": "lt1920", "precision": 1000,
     "total": {"male": 28044000, "female": 27919000, "both": 55963000},
     "unknownAge": {"male": 0, "female": 0},
     "noteIds": ["open-85"],
     "male": [945000, 700000, "… 長さ101。[85]=85歳以上の合計、[86..100]=null"],
     "female": ["…"]}
  ]
}
```

規則：
- `years` は昇順で 1920–1940, 1944–2025 の 103 件。属性は `year_meta()` と一致。
- `openAge` は 79、80、85、86、90、100 のいずれか（1951・1953・1954年=80、1952年=79、1945・1946年=86、1980〜2004年=90、2005年以降=100、それ以外は85）。
- `male`/`female` は長さ101、0以上の整数か null。null は `age < minAge` または `age > openAge` のときだけ。
- `xMaxPerSex = ceil(全値の最大 / 250000) * 250000`。
- `total` は表の「総数」（千人表は×1000）。2025年の total は不詳を含む公表値。
- `noteIds` は、`appliesTo` にその年を含む note の id を、kind が callout, badge, footnote の順（同 kind 内は下表の順）に並べる。timeline の note は含めない。
- sources のキーは lt1920, lt2000, est2021, est2022, est2023, est2024, census2025。

### notes（文言はこのとおり）

| id | kind | short | text | appliesTo |
|---|---|---|---|---|
| open-85 | callout | 85歳以上 | 1920〜1944年、1947〜1950年、1955〜1979年は、85歳以上の人口をまとめて「85」の行に表示しています。 | [1920,1940],[1944,1944],[1947,1950],[1955,1979] |
| open-80 | callout | 80歳以上 | 1951年、1953年、1954年は、80歳以上の人口をまとめて「80」の行に表示しています。 | [1951,1951],[1953,1954] |
| open-79 | callout | 79歳以上 | 1952年は、79歳以上の人口をまとめて「79」の行に表示しています。 | [1952,1952] |
| open-86 | callout | 86歳以上 | 1945・1946年は、数え年86歳以上の人口をまとめて「86」の行に表示しています。 | [1945,1946] |
| open-90 | callout | 90歳以上 | 1980〜2004年は、90歳以上の人口をまとめて「90」の行に表示しています。 | [1980,2004] |
| open-100 | callout | 100歳以上 | 2005年以降は、100歳以上の人口をまとめて「100」の行に表示しています。 | [2005,2025] |
| kazoe | badge | 数え年 | 1944〜1946年の年齢は数え年（生まれた年を1歳とし、正月ごとに1歳を加える数え方）です。0歳の区分がなく、満年齢より1〜2歳高く表示されます。調査日も1944年2月22日、1945年11月1日、1946年4月26日と異なります。 | [1944,1946] |
| no-okinawa | badge | 沖縄県を含まない | 1945〜1971年の人口は沖縄県を含みません。 | [1945,1971] |
| no-overseas-military | footnote | 外地の軍人・軍属を含まない | 1936〜1940年は、外地にいた軍人・軍属を含みません（1940年国勢調査から内地外の軍人・軍属等を除いた補正人口が基準）。そのため20〜30代の男性が少なく見えます。 | [1936,1940] |
| est-base-2020 | footnote | 2020年国勢調査基準 | 2021〜2024年は令和2年国勢調査を基準とする推計人口で、2025年国勢調査による補正前の値です。 | [2021,2024] |
| unknown-age | footnote | 年齢不詳を除く | 2025年は年齢「不詳」の男565人・女506人を図に含めていません（総人口には含みます）。 | [2025,2025] |
| gap-1941-1943 | timeline | 推計なし | 1941〜1943年は年齢別の人口推計が行われていないため、表示していません。 | [1941,1943] |

### CSV（UTF-8、BOMなし、LF）
- `data/population_by_age.csv`：`year,ref_date,kazoe,age,is_open,age_label,sex,population,precision,excludes_okinawa,basis,source_id`（null 行は出さない。age_label は「0歳」「85歳以上」）
- `data/population_totals.csv`：`year,ref_date,sex,total,unknown_age,source_id`（sex は male/female/both）

## 4. フロントエンド

ファイル：`index.html`, `css/*.css`, `js/*.js`（ES modules、`<script type="module">`）。`data/pyramid.json` を fetch。URL に `?fixture=1` があれば `tests/fixtures/pyramid.fixture.json` を読む（このとき「サンプルデータ」の帯を出す）。

表示仕様：
- 101行（100歳が最上段）。男性左・女性右、中央に年齢欄。年齢ラベル・横グリッドは5歳ごと（狭い画面は10歳ごと）。横軸は片側 0〜xMaxPerSex 固定、ラベル「0, 50, 100, 150」、中央に「人口（万人）」。
- 色：背景 `#ffffff`、男性棒 `#9db9d9`、女性棒 `#ffc56e`、強調 `#3e6593`（男性）/ `#8a5a12`（女性）。出典・データ表・解説のリンクと再生ボタンの塗りも `#3e6593`、グリッド `#ddd3bd`、補助文字 `#5b5346`。男女の見出し「男性」「女性」を図中に置く。数字は tabular-nums。
- SVG は実際のコンテナ幅（最大880px）でレイアウトを計算し直す（ResizeObserver）。375px 幅で横スクロールなし、SVG 内の文字は10px以上。
- 棒は 202 本の rect を一度だけ作り、年が変わったら x/width を遷移させる（手動 300ms easeCubicOut、再生中 340ms linear）。null は幅0。`prefers-reduced-motion: reduce` なら遷移なし。
- 吹き出し：その年の callout note を1つ表示。広い画面は左上の空き領域に枠付きの text、引き出し線を男性の上位区分の棒の端へ。狭い画面は short だけを棒の左に。
- バッジ：その年の badge note を年表示の横に。注記リスト `#notes-list` にその年の noteIds 全部と gap note を text で列挙。
- 年表示：`#year-display` に「1950年」（和暦は別要素で「昭和25年」）、調査日と種別（例「10月1日現在・国勢調査」）、`#total-display` に総人口（「1億2,297万人」）と男女内訳。
- タイムライン：`<input type=range id=year-slider min=1920 max=2025 step=1>` を目盛りSVGに重ねる。目盛り毎年・ラベル5年ごと（狭い画面は20年ごと）。1941〜43年は斜線の網掛けと「推計なし」。gap 年に入ろうとしたら移動方向で次/前の有効年へ（1940→右→1944、1944→左→1940、`?year=1942`→1940）。`aria-valuetext` は「1945年（数え年・11月1日現在）」のように。
- 再生：`#btn-play`（aria-label「再生」/「一時停止」）、`#btn-rewind`（aria-label「最初に戻る」、1920へ戻して停止）。1年 400ms、gap 年は飛ばす、2025年で停止しボタンを「再生」に戻す。最終年で再生を押すと1920から。利用者がスライダーを操作したら停止。タブが隠れたら停止。
- URL：停止中に `history.replaceState` で `?year=` を更新。既定は1920年。
- ツールチップ `#tooltip`（非表示時は hidden 属性）：その行（男女の棒・年齢欄を含む行全体）にホバー/タップで表示。見出し「30歳」（上位区分の行は「85歳以上」、数え年の年は「数え年30歳」）、出生年、男性・女性の人数。
  - 出生年：満年齢の年は `{Y−a−1}年10月〜{Y−a}年9月生まれ`、上位区分の行は `{Y−openAge}年9月以前生まれ`。数え年の年は `{Y−k+1}年生まれ`、上位区分は `{Y−openAge+1}年以前生まれ`。
  - 人数：precision=1 なら `812,345人`。それ以外は1万以上で `(v/1e4).toFixed(1)+"万人"`（例 `123.4万人`）、1万未満は `3,000人`。null の行は「この年は{openAge}歳以上にまとめて表示」または「数え年のため0歳はありません」。
  - 総人口：`Math.round(v/1e4)` 万を億と万に分けて `1億2,297万人`／`5,596万人`。
- コホートラベル `.cohort`：`js/config.js` に `{id:"dankai",label:"団塊の世代",short:"団塊",birthStart:1947,birthEnd:1949}`, `{id:"hinoeuma",label:"丙午",short:"丙午",birthStart:1966,birthEnd:1966}`, `{id:"dankai-jr",label:"団塊ジュニア",short:"団塊Jr",birthStart:1971,birthEnd:1974}`。満年齢の年だけ、年齢範囲 `[Y−birthEnd, Y−birthStart] ∩ [minAge, openAge−1]` の行に、男性側の左端から女性側の右端まで年齢欄も含めて横長の薄い帯（`.cohort-band`、中立色 #5b5346 の不透明度0.08、棒・グリッドより後ろ）を敷き、女性側の外側に名前を表示。範囲が空、または数え年の年は hidden。棒と同じ遷移で動く。
- データ表：`<details>` 内の `#data-table`（年齢・男性・女性・計の101行）と CSV へのリンク。
- 出典欄：`attribution` と各 source の title・table・リンク。
- 解説：`<section id="about">` に図の読み方の短い解説（後で事実を入れる。初期は見出しと空段落でよい）。
- アクセシビリティ：SVG は `role="img"` と年ごとの aria-label。ボタンは button 要素。フォーカス表示 2px。
- エラー：d3 / JSON が読めないときはチャート位置に文で知らせる（file:// なら `python3 -m http.server` を案内）。

### E2E との約束（DOM の目印）
- 棒：`rect.bar[data-sex="male"|"female"][data-age="0".."100"][data-value]`（null は `data-value=""`）。最終の width は `value / xMaxPerSex * halfWidth`。
- `#year-display`, `#total-display`, `#year-slider`, `#btn-play[aria-label]`, `#btn-rewind`
- `.callout[data-note]`（表示中のもの1つだけ DOM に存在し hidden でない）、`.badge[data-note]`、`#notes-list li[data-note]`
- `.cohort[data-cohort][data-age-min][data-age-max]`（非表示は hidden 属性）
- `#tooltip`（hidden 属性で開閉）、`#data-table`
- 描画完了後 `document.body.dataset.ready = "true"`、`document.body.dataset.year = "1950"`（年が変わるたび更新）。
- `window.__app = { store, data, layout }`。`store.getState()` は `{year, playing, focusAge, reducedMotion}`、`store.setYear(y, {direction})`、`store.play()`、`store.pause()`。

## 5. Git の手順（全 Claude Code セッション共通）

- ブランチは `claude/sharp-newton-grgdly` のみ。開始時に `git fetch origin claude/sharp-newton-grgdly && git checkout -B claude/sharp-newton-grgdly origin/claude/sharp-newton-grgdly`。
- 自分の所有パス以外は編集しない。必要な変更は報告に「要求」として書く。
- `git add <所有パス>` で明示的に追加（`-A` や `.` は使わない）。data/raw/ はコミットしない。
- push は `git pull --rebase origin claude/sharp-newton-grgdly && git push -u origin HEAD:claude/sharp-newton-grgdly`。拒否されたら繰り返す（最大5回）。force push はしない。rebase で衝突したら `git rebase --abort` して報告。
- コミットメッセージの末尾に指示された帰属行を付ける。モデル名はコミットに書かない。

## 6. 実行コマンド

- データ構築：`python3 -I scripts/build_data.py`（`--offline` は data/raw のみ使用）。終了コード 0=合格、1=検証FAIL、2=取得失敗。
- Python テスト：`python3 -m unittest discover -s tests/py -t .`
- ローカル表示：リポジトリ直下で `python3 -m http.server 8000`
- E2E：`node tests/e2e/smoke.cjs --base http://localhost:8000 [--fixture] [--out artifacts/screenshots]`（`require('playwright')`、`chromium.launch()` はオプション不要）
