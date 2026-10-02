# MyMelter PWA 1.0 COMPLETE

**完全0円ルートを優先した、自分用のチャンネル型Webコンテンツ閲覧PWAです。**

- App Store公開: 不要
- Apple Developer Program: 不要
- GitHub Pages: 無料で利用可能（公開リポジトリ）
- iPhone: Safari → 共有 →「ホーム画面に追加」でアプリ風に起動
- データ: 原則この端末の `localStorage` に保存

## 今回統合した機能

### 採用UI
- チャンネル中心の白＋ブルーのダッシュボード
- ホーム / チャンネル / 履歴 / 保存済み / 設定
- 最近見たもの、保存済み、自動検出候補をホームに表示

### チャンネル
- 追加 / 編集 / 削除
- 動画 / 画像 / 記事 / RSS・Atom / 混在
- CSS selectorの高度な指定
- チャンネル内検索URL
- JSONバックアップ / 復元

### 自動チャンネル発見
サイトURLを1個入力して、以下を候補化します。
- ページ本体
- HTML内で公開されているRSS / Atom
- ナビゲーション内のカテゴリ / タグ / 動画 / 画像 / 記事系リンク
- よくあるFeed URLの検出（`/feed`, `/rss.xml` など）
- `sitemap.xml` が利用できる場合は更新一覧候補
- 候補を1件ずつ追加 / まとめて追加

### メディア閲覧
- 一覧表示
- メディアグリッド
- 直接動画URLを検出できた項目は縦スワイプ動画フィード
- 上スワイプ → 次の動画
- 表示中動画のみ自動再生を試行
- 元ページを開く

### 保存
- 「保存済み」＝MyMelter内ブックマーク
- 端末保存ボタン
- Appleショートカット連携をONにすると、メディアURLを指定ショートカットへ1タップで渡す
- ショートカット未設定時はiOS共有シート等へフォールバック

> 注意: PWAだけではiPhoneの写真ライブラリへ無確認で直接書き込めません。ワンタップに近い運用はAppleショートカット連携を使います。

## GitHub Pagesへ載せる

1. GitHubで公開リポジトリを作成します（例: `mymelter`）。
2. このフォルダの**中身**をリポジトリ直下へアップロードします。
   - `index.html` がリポジトリ直下にある状態にしてください。
3. GitHubの `Settings` → `Pages`。
4. `Deploy from a branch` → `main` → `/(root)` → `Save`。
5. 表示された `https://ユーザー名.github.io/mymelter/` をiPhoneのSafariで開きます。
6. Safariの共有 → `ホーム画面に追加`。

## CORSでサイト解析できない場合

ブラウザにはCORS制限があります。GitHub Pagesから直接読めないサイトを自動解析したい場合は、`worker/worker.js` をCloudflare Workers無料枠へ配置できます。

推奨設定:
1. Cloudflare WorkersでWorkerを1個作成。
2. `worker/worker.js` を配置。
3. Workerの環境変数 `MYMELTER_KEY` に長いランダム文字列を設定。
4. MyMelter → 設定 → Cloudflare Worker URL にWorker URLを入力。
5. MyMelter → 設定 → Workerキー に同じキーを入力。
6. 取得モードを「自動（直接 → Worker）」にします。

WorkerはGETのみで、Cookieを転送せず、ローカル/プライベート宛先を基本的に拒否します。

## Appleショートカット保存

MyMelter → 設定 →「Appleショートカットを使う」をONにすると、端末保存ボタンから `MyMelter保存` ショートカットへURLを渡せます。

ショートカット側は概ね以下の構成です。
1. ショートカット入力を受け取る
2. URLの内容を取得
3. 写真アルバムに保存

DRM、アクセス制限、認証回避は対象外です。自分に保存権限がある通常のメディアで使ってください。

## 対応範囲について

MyMelterは公開HTML、RSS/Atom、通常の画像/動画URLを中心に扱います。以下はサイトごとに制限される場合があります。
- ログイン必須コンテンツ
- JavaScriptを実行しないとHTMLに現れない一覧
- 強いBot対策
- DRM動画
- Cookie/認証トークンが必要なメディア

この場合でも、チャンネルを元サイトへのランチャーとして登録できます。

## バージョン

`MyMelter PWA 1.0 COMPLETE`
