# 地域別スモールマルティプルズの契約（全担当が参照する）

全国ページ（index.html）はそのまま残す。新ページ `regions.html` で、都道府県（47）または地方ブロック（8）ごとの小さな人口ピラミッドを並べ、1920〜2025年（5年ごと、22時点）を1本のスライダーで一斉に動かす。年齢は5歳階級。横軸は「その地域の総人口に占める割合」。

Git の手順は docs/PLAN.md §5 と同じ（ブランチ `claude/sharp-newton-grgdly`、所有パスだけを add、pull --rebase してから push、force push はしない）。

## 1. 入力データ（data/raw/ に保存。gitignore 済み）

| source_id | 保存名 | URL | 用途 |
|---|---|---|---|
| census_ts3 | data/raw/census_ts3.xlsx | https://www.e-stat.go.jp/stat-search/file-download?statInfId=000001085927&fileKind=0 | 国勢調査 時系列データ 第3表「年齢（5歳階級），男女別人口及び人口性比 － 都道府県（大正9年～令和2年）」。1920〜2020年 |
| census_ts2 | data/raw/census_ts2.xlsx | https://www.e-stat.go.jp/stat-search/file-download?statInfId=000001085926&fileKind=0 | 同 第2表（全国）。照合にだけ使う |
| census2025 | data/raw/census2025.xlsx | https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040506653&fileKind=0 | 令和7年国勢調査【不詳補完値】第2-1表。2025年（全国ページと共通のファイル） |

### census_ts3 の構造（確認済み）
- シート「da03」。0始まり10行目に年見出しがある（列2「1920年」、列9「1925年」…と7列おき）。
- 年ごとの7列は、総数・男・女・割合（総数・男・女）・人口性比の順。
- 2015年と2020年は2回ずつ出てくる。列135と列142が原数値、列149と列156が不詳補完値（※）。**不詳補完値を使う。**
- 行は、列0が地域（「01000_北海道」〜「47000_沖縄県」。全国の行はない）、列1が年齢区分。
  - 年齢区分は「総数」「0～4歳」…「75～79歳」「80～84歳（80歳以上）」「85歳以上」と、再掲の3行。
- 値は人数（整数）。データのない欄は「-」。
- 脚注で確認した扱い：
  - 1920・1930・1935・1950年は、「80～84歳」の欄に80歳以上が入っている。沖縄県は1920・1930・1935年が該当（1950年の沖縄県は下の70歳以上）。
  - 沖縄県の1950・1955年は、「70～74歳」の欄に70歳以上が入っている。
  - 1945年は人口調査（11月1日現在）で、年齢は数え年。区分は「1～5歳」「6～10歳」…で、「0～4歳」の行に「1～5歳」が入る。沖縄県の1945年は表に「沖縄群島要覧 1950年版」による12月末日現在の値があるが、使わない（下の「沖縄県の1945年」を参照）。
  - 総数には年齢「不詳」を含む年がある。**不詳 = 総数 − 各段の合計**として扱う。

### census2025
都道府県の行（列3が「01000_北海道」など、列0が「0_国籍総数」、列1が「1_男」「2_女」）について、各歳を5歳階級に合計する。85歳以上は「086_85歳」〜「111_110歳以上」の合計。年齢「不詳」は unknown に入れる。

## 2. data/regions.json

インデントなし、UTF-8、`ensure_ascii=False`、キー順を固定し、タイムスタンプは入れない（毎回同じバイト列にする）。スキーマは `data/schema/regions.schema.json`。

```json
{
  "schemaVersion": 1,
  "fixture": false,
  "unit": "person",
  "ageGroups": ["0-4","5-9","10-14","15-19","20-24","25-29","30-34","35-39","40-44","45-49","50-54","55-59","60-64","65-69","70-74","75-79","80-84","85+"],
  "years": [1920,1925,1930,1935,1940,1945,1950,1955,1960,1965,1970,1975,1980,1985,1990,1995,2000,2005,2010,2015,2020,2025],
  "xMaxShare": 0.075,
  "yearMeta": {
    "1920": {"refDate": "1920-10-01", "kazoe": false, "basis": "国勢調査", "noteIds": ["open-80", "unknown-excluded"]},
    "1945": {"refDate": "1945-11-01", "kazoe": true, "basis": "人口調査", "noteIds": ["kazoe-1945", "okinawa-missing-1945", "unknown-excluded"]}
  },
  "areas": [
    {"code": "01", "name": "北海道", "short": "北海道", "block": "hokkaido", "tile": {"x": 12, "y": 0}}
  ],
  "blocks": [
    {"id": "hokkaido", "name": "北海道", "prefs": ["01"], "tile": {"x": 3, "y": 0}}
  ],
  "series": {
    "national": {"1920": {"male": [0], "female": [0], "unknown": {"male": 0, "female": 0}, "total": 0, "openIndex": 16, "missing": false}},
    "01": {},
    "hokkaido": {}
  },
  "attribution": "出典：総務省統計局「国勢調査」（e-Stat）を加工して作成",
  "sources": {"census_ts3": {"title": "…", "table": "…", "url": "…", "sha256": "…", "retrieved": "YYYY-MM-DD"}},
  "notes": {"open-80": {"kind": "badge", "short": "80歳以上を一括", "text": "…", "appliesTo": [[1920,1920]]}}
}
```

規則：
- `series` のキーは `"national"`、都道府県コード `"01"`〜`"47"`、ブロック id の8つ。全部で56件。各キーの下に、`years` の22年分がそろう。
- `male`・`female` は長さ18。値は0以上の整数か null。
  - `openIndex` は上位区分の段の添字。通常は17（85歳以上）、80歳以上の年は16、沖縄県の70歳以上の年は14。
  - `openIndex` より上の段は null。`[openIndex]` には「その年齢以上」の合計を入れる。
- 沖縄県の1945年（「沖縄県の1945年」）は、census_ts3 に「沖縄群島要覧 1950年版」による12月末日現在の値があるが、全国表（census_ts2）も除いているため使わない（missing とする）。
- `missing: true` のとき（沖縄県の1945年）は、`male`・`female` を18個すべて null にし、`total` は 0 にする。
- `total` は表の総数（不詳を含む）。`unknown` は年齢不詳。割合の分母は `total − unknown.male − unknown.female`（＝各段の男女合計）。
- ブロックと national は、構成する都道府県の合計。
  - ある年に `openIndex` が都道府県ごとに違う場合（1950年の九州沖縄など）は、いちばん小さい `openIndex` にそろえ、それより上の段を足し込む。
  - `missing` の都道府県は合計から除く。
- `xMaxShare` は、全 series・全年・男女の「段の値 / 分母」の最大を、0.005 単位で切り上げた値。

### notes（文言はこのとおり）

| id | kind | short | text | appliesTo |
|---|---|---|---|---|
| open-80 | badge | 80歳以上を一括 | 1920・1930・1935・1950年は、80歳以上の人口をまとめて「80〜84」の段に表示しています。 | [1920,1920],[1930,1935],[1950,1950] |
| okinawa-70 | footnote | 沖縄県は70歳以上を一括 | 沖縄県の1950・1955年は、70歳以上の人口をまとめて「70〜74」の段に表示しています。九州・沖縄ブロックと全国は、この年、70歳以上をまとめた形で集計しています。 | [1950,1955] |
| kazoe-1945 | badge | 数え年 | 1945年は人口調査（11月1日現在）によるもので、年齢は数え年です（「0〜4」の段は数え年1〜5歳）。 | [1945,1945] |
| okinawa-missing-1945 | footnote | 沖縄県のデータなし | 1945年は沖縄県のデータがありません。九州・沖縄ブロックと全国は沖縄県を除いて集計しています。 | [1945,1945] |
| unknown-excluded | footnote | 年齢不詳を除く割合 | 割合は年齢不詳を除いて計算しています。2015・2020・2025年は不詳補完値を使っています。 | [1920,2025] |

年ごとの `noteIds` は、appliesTo にその年を含む note を、badge → footnote の順（同じ kind の中では上の表の順）に並べる。

※ okinawa-70 の扱いの補足：1950・1955年の九州・沖縄ブロックと national は、`openIndex` を14にそろえる（70歳以上で一括）。これを避けたい場合は、統合担当がオーケストレータに相談する。

### yearMeta
- `refDate` は1945年だけ "1945-11-01"、それ以外は "YYYY-10-01"。
- `kazoe` は1945年だけ true。
- `basis` は1945年が「人口調査」、それ以外は「国勢調査」。

### areas（コード順47件）と tile 座標
- `name` は表の地域名（「青森県」など）。`short` は都道府県の接尾辞を取ったもの（北海道はそのまま。例：「青森」「東京」「京都」「大阪」）。
- block は、hokkaido=01、tohoku=02〜07、kanto=08〜14、chubu=15〜23、kinki=24〜30、chugoku=31〜35、shikoku=36〜39、kyushu=40〜47。

都道府県タイル（13列×10行、x, y。y は下向き）

| y | 都道府県と x |
|---|---|
| 0 | 北海道12 |
| 1 | 青森11 |
| 2 | 秋田10、岩手11 |
| 3 | 石川8、山形10、宮城11 |
| 4 | 島根3、鳥取4、福井7、富山8、新潟9、福島11 |
| 5 | 長崎0、佐賀1、山口2、広島3、岡山4、兵庫5、京都6、滋賀7、岐阜8、長野9、群馬10、栃木11、茨城12 |
| 6 | 福岡1、大分2、愛媛3、香川4、大阪5、奈良6、三重7、愛知8、山梨9、埼玉10、東京11、千葉12 |
| 7 | 熊本1、宮崎2、高知3、徳島4、和歌山6、静岡8、神奈川11 |
| 8 | 鹿児島1 |
| 9 | 沖縄0 |

ブロック（名前と位置。4列×4行）

| id | name | x, y |
|---|---|---|
| hokkaido | 北海道 | 3, 0 |
| tohoku | 東北 | 3, 1 |
| kanto | 関東 | 3, 2 |
| chubu | 中部 | 2, 1 |
| kinki | 近畿 | 1, 2 |
| chugoku | 中国 | 0, 2 |
| shikoku | 四国 | 1, 3 |
| kyushu | 九州・沖縄 | 0, 3 |

### data/regions_by_age.csv
列は `year,area_id,area_name,age_group,is_open,sex,population`。null の行は出さない。上位区分（`is_open` が真）の `age_group` は、段の下限に「+」を付けた「85+」「80+」「70+」と書く（それ以外は「0-4」など）。UTF-8（BOMなし）、改行は LF。

## 3. フロントエンド（regions.html）

ファイルは `regions.html`、`css/regions.css`、`js/regions/*.js`（ES modules）。共通の見た目は `css/style.css` を読み込んで流用する。D3 は全国ページと同じ（d3@7.9.0、SRI付き）。データは `data/regions.json`。`?fixture=1` なら `tests/fixtures/regions.fixture.json` を読み、「サンプルデータ」の帯を出す。

表示仕様：
- **ページ構成**：見出し「都道府県・地方別の人口ピラミッド 1920–2025」、全国ページへのリンク（「← 全国の各歳別ピラミッド」）、切り替え、年表示（大きな年、和暦、調査日と種別、バッジ）、タイル群、操作部（巻き戻し・再生・スライダー）、凡例、注記リスト、解説（`<section id="about">`。初期は見出しと空段落でよい）、出典。
- **配色**：白背景。男性 #9db9d9、女性 #ffc56e、強調 #3e6593 / #8a5a12、補助文字 #5b5346、グリッド #ddd3bd。全国の参照線は #2a2620、1px。
- **タイル**：
  - 1つのタイルに、地域名（都道府県は short）と、65歳以上の割合（例「29.4%」。上位区分が70歳以上の年は「70歳以上」の割合にせず、65〜69歳の段と70歳以上を足した値でよい）を小さく表示する。
  - その下に18段のピラミッドを描く。男性が左、女性が右で、中央の年齢欄はなし（中央線だけ）。
  - 横軸は全タイル・全年で共通の `xMaxShare` に固定する。目盛りは凡例に1つだけ描く。
  - 同じ年の national の形を、各タイルに階段状の折れ線 `path.national`（男女それぞれ）で重ねる。
  - `missing` のタイルは棒を描かず、「データなし」と表示する。
- **配置**：
  - 600px以上は、上の tile 座標の格子に置く（最大幅 1100px、セルは正方形に近い比率）。
  - 600px未満は、都道府県をコード順の3列、ブロックを2列の格子にする。
  - 375px 幅で横スクロールしない。SVG 内の文字は10px以上。
- **切り替え**：`#facet-toggle` の2つのボタン（都道府県／地方）。切り替えても年と再生状態は保つ。
- **アニメーション**：22時点を、1本のスライダー（`input[type=range]`。値は年の添字0〜21でよいが、`aria-valuetext` は「1945年（数え年・11月1日現在）」のように年で示す）で一斉に動かす。
  - 再生は1時点700msで、2025年で止まる。巻き戻しは1920年。
  - 棒の遷移は500ms。prefers-reduced-motion のときは遷移しない。
  - 再生中は `#year-display` の aria-live を off にする。
- **ツールチップ**：タイルにホバーかタップで表示する。内容は、地域名、総人口（「1億2,297万人」「55万人」の書式は全国ページの formatTotal と同じ）、65歳以上の割合、そしてポインタのある段の年齢階級と、男女それぞれの割合（%、小数1桁）。
- **URL**：停止中は `?year=` と `?facet=prefecture|block` を replaceState で書き換える。
- **全国ページ**：index.html のヘッダー（`.site-header` の lede の後）に、`<p class="page-nav"><a href="regions.html">都道府県・地方別に見る →</a></p>` を1行だけ足す。ほかは変えない。

### E2E との約束（DOM の目印）
- 切り替え：`#facet-toggle button[data-facet="prefecture"]` と `[data-facet="block"]`。選択中は `aria-pressed="true"`。
- タイル：`.tile[data-area]`（data-area は "01"〜"47" かブロック id）。表示中の facet のタイルだけが DOM にあり、hidden ではない。
  - 中身：`rect.bar[data-sex][data-group]`（data-group は 0〜17）と `[data-value]`（割合。小数、null は ""）。
  - 最終の width は `value / xMaxShare * halfWidth`。halfWidth はタイルの `data-half-width` 属性に入れる。
  - 参照線：`path.national[data-sex]`。データなし：`.tile-missing`。
- 操作：`#year-display`（「1950年」）、`#year-slider`、`#btn-play[aria-label=再生|一時停止]`、`#btn-rewind[aria-label=最初に戻る]`、`#tooltip`（hidden で開閉）、`.badge[data-note]`、`#notes-list li[data-note]`。
- 状態：描画完了後に `document.body.dataset.ready="true"`。年が変わるたびに `body.dataset.year="1950"`、facet が変わるたびに `body.dataset.facet="prefecture"|"block"` を更新する。
  - `window.__regions = { store, data }`。
  - `store.getState()` は `{yearIndex, year, facet, playing, reducedMotion}` を返す。
  - 操作は `store.setYear(year)`、`store.setFacet(f)`、`store.play()`、`store.pause()`。

## 4. 実行コマンド
- データ構築：`python3 -I scripts/build_regions.py`（`--offline` は data/raw だけを使う）。終了コードは 0=合格、1=検証FAIL、2=取得失敗。
- Python テスト：`python3 -m unittest discover -s tests/py -t .`
- E2E：`python3 -m http.server 8000` を起動し、`node tests/e2e/regions.cjs --base http://localhost:8000 [--fixture] [--out DIR]`。全国ページの `node tests/e2e/smoke.cjs` も合格のままにすること。
