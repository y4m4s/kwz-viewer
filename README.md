# kwz viewer

PC内のKWZファイルを、サムネイル付きの一覧から探して音声付きで再生できるローカルビューアです。Windows向けデスクトップ版とブラウザ版があります。

## ダウンロード・インストール

Windows x64版は [最新リリース](https://github.com/y4m4s/kwz-viewer/releases/latest) からダウンロードできます。

1. 最新リリースの「Assets」から `*-setup.exe` をダウンロードします。
2. インストーラーを実行し、画面の案内に従ってインストールします。
3. スタートメニューから「kwz viewer」を起動します。

Node.jsやRustのインストールは不要です。WebView2が未導入の場合は、インストーラーが導入を案内します。配布物は未署名のため、Windowsの警告が表示される場合があります。

## 使い方

1. トップの「みる」を開き、「フォルダを開く」からKWZの保存先を選びます。
2. 作品を選び、「再生」を押します。シーク・音量調整・ループ再生に対応しています。
3. サムネイルをドラッグすると並べ替えられます。

選択したフォルダと並び順は保存され、次回起動時に復元されます。フォルダは右下のボタンから変更できます。原本への書き込みや外部アップロードは行いません。

現在使えるのは「みる」のみです。「かく」「ワールドkwzギャラリー」「こうかん」「設定」は未実装です。

また、PPMファイルには対応していません。

## 開発・ビルド

### Windowsデスクトップ版

Node.js 24.22.1（24系）、Rust stable（MSVC）、Visual StudioのC++ビルドツール、Windows SDKが必要です。

```powershell
npm ci
npm run desktop:dev

# 配布用インストーラーを生成
npm run desktop:build
```

インストーラーは `src-tauri/target/release/bundle/nsis/` に生成されます。利用者のPCにNode.jsやRustは不要です。WebView2が未導入の場合、インストーラーが導入を案内します。

### ブラウザ版

Node.js 24.22.1（24系）が必要です。開発用のバージョンは `.node-version` に記載しています。

```powershell
npm ci
npm run build
npm start
```

[http://127.0.0.1:4173](http://127.0.0.1:4173) を開いてください。開発時は `npm run dev` で起動し、ポート5173へアクセスします。ブラウザ版のフォルダ選択はWindowsのみ対応しています。

### テスト

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run desktop:test
npm run desktop:lint
```

E2Eテストは既定でMicrosoft Edgeを使用します。実作品のテストには `data/` にKWZを置くか、`KWZ_TEST_DIRECTORY` で保存先を指定してください。未提供時は実作品のテストをスキップします。

## 保存先

デスクトップ版はOSのアプリデータ・キャッシュ領域の `com.kwzviewer.desktop` 配下、ブラウザ版はプロジェクト内の `.app-data/` に設定やキャッシュを保存します。`.app-data/` 全体を削除すると、ブラウザ版の保存済み設定や並び順も消えます。

## 配布とライセンス

- Windows x64向けです。他のOS・アーキテクチャは未検証です。
- 配布物は未署名です。別PCでのインストールと異なるバージョンへの更新は未検証です。
- WebView2未導入時のランタイム取得にはネットワークが必要です。
- 依存ライセンスはビルド時に集約し、インストーラーに同梱します。単体exeで配布する場合も `apps/web/public/licenses/` の内容を同梱してください。
- プロジェクト自身のコード・図案の公開ライセンスは未設定です。

React / Vite / Tailwind CSS / flipnote.jsを使用しています。デスクトップ版はTauri / Rust / WebView2、ブラウザ版のサーバーはFastifyで動作します。
