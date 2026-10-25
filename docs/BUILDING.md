# ビルド手順

## 通常のビルド

Node.js 22以降とnpmを用意し、このリポジトリのルートで実行します。利用者がWindows用配布ZIPを使うだけなら、これらのツールは不要です。

```powershell
npm ci
npm test
npm run build
```

`package-lock.json` で依存バージョンとnpmパッケージのintegrityを固定しています。更新目的でない限り `npm install` でロックファイルを作り直さず、`npm ci` を使います。

`build.mjs` は `src/processor.js` とYouTube.jsを `extension/processor.js` にバンドルし、npmパッケージの `@ffmpeg/core` から未改変のESM版JS/WASMを `extension/vendor/` にコピーします。生成物はGit管理しません。生成後のextensionフォルダをChrome / Edgeへ読み込めます。

ビルド時はnpm等への通信が必要です。拡張機能を利用するときにnpmやGitHubへコードを取得しに行く方式ではありません。

## ビルド日の扱い

`npm run build` は実行日の日本時間（Asia/Tokyo）を取得し、`build-date.json`、package.json / package-lock.json、拡張機能manifestの識別情報を揃えます。表示は `2026-10-26`、Chrome内部の必須versionは `2026.10.26` です。月・日の内部値に先頭ゼロは付けません。表示と配布ファイル名にはビルド日を使用します。

同じ日に配布物を更新する場合は、再ビルド番号を増やします。通常の開発ビルドでは、同日なら既存の番号を保持し、日付が変われば0に戻ります。毎回のビルドで勝手に増える方式ではありません。

```powershell
$env:BUILD_REVISION = '1'
npm run build
Remove-Item Env:BUILD_REVISION
```

この場合、表示とファイル名は `2026-10-26-1`、Chrome内部は `2026.10.26.1` になります。npmは4桁の版番号を使えないため、内部では `2026.10.26-build.1` として保持します。これらはスクリプトが自動生成する値です。

過去の配布物を同じ識別情報で再ビルドする場合は、`BUILD_DATE=2026-10-26` と必要なら `BUILD_REVISION` を指定します。PowerShellでは `$env:BUILD_DATE = '2026-10-26'` と設定してからbuildを実行し、終了後に環境変数を解除してください。日付は実在する `YYYY-MM-DD`、番号は0～65535に制限します。

## Windows補助プログラム

Windows x64にVisual Studio 2022 Build ToolsまたはVisual Studioを導入し、「C++によるデスクトップ開発」とWindows 10/11 SDKを選びます。

```powershell
npm run build:native
```

`vswhere.exe` でMSVCを検出して `native/build.cmd` を実行します。C++17、x64、最適化、静的CRT、`/Brepro`を指定します。`native/vendor/json.hpp` はリポジトリに含まれます。

生成した `native/youtube-surround-host.exe --self-test` を自動実行し、ビルドに使ったソースと実行ファイルのSHA-256を `native/build-info.json` に保存します。**ビルドや自己テストではインストール・レジストリ変更・音声再生を行いません。**

Native Messaging登録は、利用者が明示的に `native/Install.cmd` を実行したときに行います。`jp.local.youtube_surround_audio.json` はそのPCで生成するため、ソースやリリースには含めません。拡張機能のmanifestの公開鍵と `native/extension-id.txt` はIDを一致させるために固定しています。公開鍵は秘密鍵ではありません。拡張機能のCRX署名用秘密鍵は同梱しません。

## FFmpeg対応ソース

通常のビルドはnpmの未改変バイナリを使います。上流の対応関係は次のとおりです。

| 項目 | 固定値 |
|---|---|
| npmパッケージ | `@ffmpeg/core@0.12.10`、シングルスレッドESM版 |
| 上流リリース | `ffmpegwasm/ffmpeg.wasm` の `v12.15` |
| 上流コミット | `71aa99d37c02a7b4c435275ca9ef50e612f6efa1` |
| FFmpeg | `n5.1.4` |
| Emscripten | `3.1.40` |
| SDLポート | `release-2.24.2` |

各構成ライブラリのコミット・ダウンロードURL・サイズ・SHA-256は `third_party/ffmpeg-sources.lock.json` にあります。上流Dockerfileで `master` / `4-cores` を参照する2箇所は、npm公開日時（2025-01-07T10:13:14Z）以前の最終コミットに固定しています。上流が公開した全ビルド環境の証明書ではなく、公開されたリリースとビルド定義から対応ソースを整理したものです。

```powershell
npm run sources
```

19個のソースアーカイブ（約127MB）を `.cache/ffmpeg-sources/` に取得し、固定したSHA-256を検証します。既存ファイルが不一致なら処理を停止します。リリースの `corresponding-source.zip` にも同じアーカイブを収録します。リポジトリの通常のGit履歴には大きなアーカイブを入れません。

対応ソースZIPから利用する場合は `project-sources.zip` を展開してプロジェクトを取り出し、`upstream/` 内のZIPをそのプロジェクトの `.cache/ffmpeg-sources/` へコピーします。`npm run sources` は既存アーカイブを検証し、再ダウンロードしません。

## FFmpeg自体の再ビルド

Docker 23以降（buildx対応）とmakeを使えるLinux / WSL環境を用意します。

```sh
npm ci
npm run prepare:ffmpeg
cd .cache/ffmpeg-build
make prd
```

`prepare:ffmpeg` は取得したソースを展開し、上流Dockerfileのコーデック等のGit取得を、同梱ソースのローカルCOPYへ置き換えます。元のビルドスクリプトはソースZIPにそのまま含まれます。テストデータ用のGit submoduleは通常ビルドに使用せず、収録していません。

この手順でもコンテナイメージ、aptパッケージ、EmscriptenのSDLポート取得にはネットワークが必要です。SDLとEmscriptenのソース自体は対応ソースZIPに収録しています。生成先は `.cache/ffmpeg-build/packages/core/dist/esm/` です。

FFmpeg自体のコンパイルは検証対象外です。通常のnpmバイナリを使う拡張機能のビルドとは区別してください。MSVC / SDK / Dockerのシステムパッケージ等の違いにより、バイナリがビット単位で一致することは保証しません。

FFmpegを改変して配布する場合は、改変内容、ソース、ロック情報、ライセンス表示を更新し、npmバイナリとの一致を前提にするpackageスクリプトも合わせて変更してください。

## 配布ファイルの作成

Windows上で次を順番に実行します。

```powershell
npm ci
npm test
npm run build
npm run build:native
npm run sources
npm run package
```

`dist/ビルド日/` 内の `release/` に導入用Windows x64 ZIPとビルド情報JSON、`source/` にプロジェクトソースZIPとFFmpeg等の対応ソースZIPを出力します。両方を照合する `SHA256SUMS.txt` はその親フォルダに出力します。導入用ZIPには開発用ソース・テスト・ビルドスクリプトを収録しません。package処理はネイティブのソース/実行ファイルハッシュ、FFmpegの未改変コピー、拡張機能ID、ビルド日、対応ソースのチェックサムを照合します。

`npm test` は通信を行わない自動テストです。テスト用HTMLは従来の手動ブラウザ検証用で、合成メディア等の外部フィクスチャは配布していません。Windows自己テストは音声機器やDolbyライセンスを必要としません。
