# Third-party notices

本プロジェクト独自部分はGPL-3.0-or-laterです。以下の構成要素には各権利者の著作権表示とライセンスが適用されます。LICENSEの追加によって第三者のコードを再許諾するものではありません。

| 構成要素 | 固定バージョン | ライセンス | 由来 |
|---|---|---|---|
| YouTube.js | 18.3.0 | MIT | https://github.com/LuanRT/YouTube.js |
| meriyah | 7.4.0 | ISC | https://github.com/meriyah/meriyah |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| @bufbuild/protobuf | 2.16.0 | Apache-2.0 AND BSD-3-Clause | https://github.com/bufbuild/protobuf-es |
| @ffmpeg/core | 0.12.10 | GPL-2.0-or-later、および構成ライブラリの各ライセンス | https://github.com/ffmpegwasm/ffmpeg.wasm |
| nlohmann/json | 3.11.3 | MIT | https://github.com/nlohmann/json/tree/v3.11.3 |
| esbuild（ビルド用） | 0.28.2 | MIT | https://github.com/evanw/esbuild |

`processor.js` はYouTube.jsと依存ライブラリをバンドルした生成物です。`ffmpeg-core.js` と `ffmpeg-core.wasm` はnpmの `@ffmpeg/core@0.12.10/dist/esm/` の未改変コピーです。`native/vendor/json.hpp` はヘッダー内にもMIT著作権表示を含みます。npm依存はpackage-lock.jsonに固定しています。

ライセンス本文を `licenses/` に収録しています。FFmpeg等の対応ソースZIPには、上流の著作権表示・ライセンス・ビルド定義も元のまま収録します。

## FFmpeg構成要素

上流のcore v0.12.10リリースは、ffmpeg.wasmリポジトリのコミット `71aa99d37c02a7b4c435275ca9ef50e612f6efa1`（タグv12.15）です。Dockerfileは `--enable-gpl` を指定しています。FFmpeg本体と下記依存に関する個々の条件は、各ソースに同梱されたライセンス表示を参照してください。

対応ソースにはFFmpeg、ffmpeg.wasmのバインディングとビルドスクリプト、x264、x265、libvpx、LAME、Ogg、Theora、Opus、Vorbis、zlib、libwebp、FreeType、FriBidi、HarfBuzz、libass、zimg、Emscripten、SDLを収録します。各固定コミットとチェックサムは `third_party/ffmpeg-sources.lock.json` に記載しています。

これらのFFmpeg依存を一律にGPLと表記するものではありません。ライブラリごとのMIT、BSD、ISC、zlib、FreeType、LGPL、GPL等の表示と条件を保持しています。ビルドツールやそのテスト用submoduleは通常の配布バイナリにそのまま同梱されるものではありません。

バイナリを配布する際には、同じReleaseへ `corresponding-source.zip` を添付します。ソースの取得・再ビルド・変更版を配布する際の更新箇所は [docs/BUILDING.md](docs/BUILDING.md) と [docs/RELEASING.md](docs/RELEASING.md) を参照してください。
