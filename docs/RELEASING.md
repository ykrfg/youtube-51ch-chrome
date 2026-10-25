# GitHub公開と配布

## リポジトリに置くもの

公開用には、`source.zip` を展開したフォルダをリポジトリのルートにします。親フォルダや作業用ディレクトリ全体を公開しないでください。`.gitignore` はnpm依存、生成バンドル、WASM、実行ファイル、ローカル設定、配布ZIPを除外します。

GitHubのコード部分にはソースZIPの内容を置き、利用者向けの実行用ZIPはReleasesへ添付します。実行用ZIPには開発用ソースやテストを含めません。ブラウザで動作するJavaScriptは実行に必要なファイルとして含みます。

展開先のフォルダ名は、導入用が `youtube-original-5.1/`、ソース用が `youtube-original-5.1-source/` です。同じ場所へ展開しても混ざりません。リポジトリに置くのはソース用フォルダの中身です。

ソースZIPはスクリプトの許可リストから作成します。`native/jp.local.youtube_surround_audio.json` に含まれるPC固有パス、調査時の通信データ、Cookie、署名付きURL、利用者のブラウザプロファイルは含めません。`native/vendor/json.hpp` と `licenses/` の著作権表示は保持します。

公開先は [ykrfg/youtube-51ch-chrome](https://github.com/ykrfg/youtube-51ch-chrome) です。GitHubで空のリポジトリを作成してから、ソース用フォルダで初回コミットを作成してpushします。すでに初期化・コミット・originの設定が済んでいる場合は、対応するコマンドを省略してください。

```powershell
git init -b main
git add .
git commit -m "Initial release 2026-10-26"
git remote add origin https://github.com/ykrfg/youtube-51ch-chrome.git
git push -u origin main
```

Gitコマンドはコミットやpushに使います。GitHub上のリポジトリ作成やReleaseへのZIP添付にはGitHubの画面または認証済みのGitHub CLI等を使います。

## リリースの準備

1. `npm run build` でビルド日を生成します。同じ日付ですでに配布している場合は `BUILD_REVISION` を増やします。識別情報は自動で揃います。
2. README、CHANGELOG、TEST_RESULTSを更新します。公開する機能、実施した試験、確認範囲を記載します。
3. [ビルド手順](BUILDING.md) の全コマンドを実行します。
4. ソースZIPとWindows ZIPの内容、生成物のSHA-256を確認します。配布するZIPを実際に展開して、extensionフォルダを読み込めることも確認します。
5. 生成された `build-date.json` とpackage / manifestの更新も確認してコミットし、GitHub上の対象コミットにビルド日タグ（例：`2026-10-26`、同日再配布なら `2026-10-26-1`）を作成し、まずDraft Releaseを作成します。

GitHub Actionsの **Build and test** はLinux / Windowsでビルドとテストを行います。**Prepare release artifacts** はActions画面から手動実行でき、Windows補助プログラムをビルドします。導入用の `release-assets` とソース用の `source-assets` を別々のArtifactとして出力します。実行日の日本時間をビルド日に使い、同日再配布時は実行画面の `build_revision` を増やしてください。このワークフローはReleasesへの自動公開やタグ作成を行いません。GitHub上での初回実行は、リポジトリ公開後に確認してください。

## 添付するファイル

同じビルド日の次の5ファイルを、同じReleaseに添付します。`BUILD_DATE` は日付と必要なら同日再ビルド番号です。出力先は `dist/2026-10-26/` のような日付別フォルダです。

```text
dist/2026-10-26/
  release/   導入用ZIP、ビルド情報JSON
  source/    本体ソースZIP、FFmpeg等の対応ソースZIP
  SHA256SUMS.txt
```

| ファイル | 内容 |
|---|---|
| `release/youtube-original-5.1-BUILD_DATE-windows-x64.zip` | 利用者向け。ビルド済み拡張機能・補助プログラム、導入説明、ライセンス、ソース入手案内 |
| `source/youtube-original-5.1-BUILD_DATE-source.zip` | GitHubに置く本体ソース一式。生成バイナリは含まない |
| `source/youtube-original-5.1-BUILD_DATE-corresponding-source.zip` | 本体ソースZIPとFFmpeg・構成ライブラリ等の固定したソース19個 |
| `release/youtube-original-5.1-BUILD_DATE-build-info.json` | ビルド日、内部識別情報、ハッシュ、上流コミット、Windows自己テスト結果 |
| `SHA256SUMS.txt` | 上記4ファイルのSHA-256 |

GitHub Releasesの添付時は、フォルダではなく各ファイルを選びます。バイナリとソースは別ファイルとして同じReleaseから取得できる形にします。GitHubが自動生成する「Source code」だけでは、FFmpeg等の依存ソースは含まれません。対応ソースZIPの添付を省略しないでください。SHA256SUMS.txtのパスはローカルのrelease/source構成を基準にしているため、個別ダウンロード時は該当ファイル名のハッシュを照合してください。

タグのソースと添付バイナリは同じ内容からビルドします。公開後の同名ZIPの差し替えを避け、修正は新しいビルド日／同日再ビルド番号で配布します。SHA-256は破損やファイルの同一性を確認するもので、コード署名や安全性の保証とは異なります。

## ハッシュの確認（PowerShell）

```powershell
Get-FileHash .\youtube-original-5.1-2026-10-26-windows-x64.zip -Algorithm SHA256
```

表示された値を `SHA256SUMS.txt` の同じファイル名の行と照合します。

## 公開時の説明

実験版であること、Windows x64の補助プログラムが未署名であること、デベロッパーモードで読み込むこと、更新は手動であることを説明します。YouTube公式の5.1ch対応を追加するものとして認証された製品ではありません。取得方式に関するYouTube側の制限や変更は、配布先がGitHubになっても同じです。

不具合報告では拡張機能のビルド日・ブラウザ・OS・出力モード・表示エラーを集めます。Cookie、トークン、署名付き配信URLや未加工の通信ログは求めません。
