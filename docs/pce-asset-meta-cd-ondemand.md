# PCE-CD アセットメタ情報の CD オンデマンド化

VN プロジェクトで画像 / スプライト / ADPCM のアセット登録数を増やすと、各アセットの
**メタ情報**（パレット・ディスクリプタ構造体・`cd_data_ref`・スプライトの `cell_map`）が
常駐 RAM に積み上がり、`ld.lld` がバンク領域を溢れさせる。本ドキュメントはそのメタ情報を
CD データファイルへ逃がし、必要時にだけストリームする仕組みと、**いつ切り替えるか**の判断
ルールを説明する。

> 変更前に [pce-memory-bank-strategy.md](pce-memory-bank-strategy.md) と
> [PLUGIN.md](../PLUGIN.md) も参照すること。**未解決課題（meta モードの bank129 肥大）と
> 対応案は [pce-asset-meta-cd-ondemand-codex-handoff.md](pce-asset-meta-cd-ondemand-codex-handoff.md)。**

## バンク配置の前提（なぜメタ情報が溢れるのか）

pce-cd リンカスクリプト（`cd-ram-banked-sections.ld` / `cd-sections.ld`）では:

- 既定の `.text` / `.rodata` → **bank128**（`c_readonly = c_writeable = ram_bank128`）。
- `.bss` → **console_ram**。
- `.ram_bank129` / `.ram_bank130` → **明示的に `VN_BANKED_CODE` / `VN_BANKED_CODE2` を
  付けたコードだけ**。アセットを増やしても 129/130 は増えない（コード＝機能で増える）。
- `.ram_bank132` → `cd_data_ref`（`PCE_EDITOR_CD_REF_SECTION`）と VN 生成データ。

したがって**生成アセットのディスクリプタ配列 / パレット / `cell_map` は bank128 の `.rodata`**
に乗り、`cd_data_ref` は bank132 に乗る。アセットを増やすと **bank128 と bank132 が先に**
膨らむ。コード用 3 バンク（128/129/130, 約24KB）は co-resident で透過呼び出しできる
（[pce-memory-bank-strategy.md](pce-memory-bank-strategy.md) 参照）。

## レコード形式（asset_meta.bin）

CD ビルドでメタを CD に逃がす場合、ジェネレータは全アセットのメタを 1 ファイル
`assets/generated/meta/asset_meta.bin` に**固定長・セクタ整列のレコードスロット**として
直列化し、常駐側には**定数のディレクトリ（`pce_editor_*_meta`）だけ**を残す。

- BG / sprite レコード = **メモリ上ディスクリプタ構造体のパック画像**（ポインタ欄は 0）＋付録
  （パレット 32B、`cd_data_ref` 8B/件、スプライトは `cell_map` をインライン格納）。
- ADPCM レコードは同じ固定 offset だが、runtime は `data_size` / `sample_rate` / `adpcm_address` /
  `divider` / `loop` / `stream` / `cd_data_ref` を field-by-field に scalar decode する。llvm-mos が
  multi-byte struct copy を `tii $00xx,$00yy` に畳み、WRAM `$20xx` の高位アドレスを落とすことが
  あるため、ADPCM の struct image / CD ref は `memcpy` に戻さない。
- オフセットは生成ヘッダの `PCE_EDITOR_META_*` 定数と、ランタイム側 `_Static_assert` で固定
  （構造体ドリフト時はビルドエラー）。
- スロット長: BG=128B / Sprite=512B（`cell_map` インライン込み, 最大 384 cell）/ ADPCM=32B。
- レコード N の位置 = セクタ `region.sector + N / (2048/slot)`、オフセット
  `(N % (2048/slot)) * slot`。`asset_meta.bin` は `ensureAssetMetaReservation()` で**最終
  サイズを先に確保**してから CD レイアウトに渡す（`overlay.bin` と同じ「予約→上書き」）。

ランタイムの accessor `vn_get_bg_asset` / `vn_get_sprite_asset` / `vn_get_adpcm_asset` は
レコードセクタを `cd_transfer_scratch`（bank132）へ読み、小さな cache（BG 2 スロット /
Sprite 4 スロット、`cell_map` は console_ram）にデコードして、ランタイムが既に期待する
構造体ポインタを返す。cache ヒット時は CD を触らない（毎フレームのスプライト refresh が
ドライブを叩かない）。

### accessor は必ず bank128（VN_RESIDENT_CODE）に置く

accessor を `VN_BANKED_CODE`（129）等に付けると、CD ヘルパ（`map_vn_data` /
`prepare_cd_data_access` / `cd_sector_*`）のインラインコピーがそのバンクへ複製され、
**バンクが膨張**する。accessor は `VN_RESIDENT_CODE`（`noinline` + `.text` = bank128）で
**out-of-line・bank128 常駐**にすること。128/129/130 は co-resident なので、129/130 の
consumer（`refresh_scene_sprites` / `copy_adpcm_voice` 等）からの呼び出しは透過。

## いつ CD オンデマンドに切り替えるか（閾値）

メタを CD に逃がすのは、**固定の accessor コスト（accessor コード ~1KB が bank128、加えて
consumer 側のインライン定数畳み込みが効かなくなる分が banked code バンクへ ~1KB）**を、
**解放される常駐メタ rodata が上回るときだけ**。小規模プロジェクトでは逆に純損になる。

そこでジェネレータ `assetMetaShouldUseCd()` は:

```
CD ターゲット かつ estimateResidentMetaBytes(project) > 予算
```

のときだけ CD オンデマンドモードにし、生成ヘッダへ `#define PCE_EDITOR_ASSET_META_ON_CD 1`
を出す。それ未満は**従来どおり常駐配列**（`pce_editor_bg_assets[]` 等）を出し、ランタイムの
accessor は `#else` のマクロ（直接添字）に解決されて **DCE で丸ごと落ちる（コスト 0）**。
これにより:

- 小規模 / コードバンクが逼迫したプロジェクト（例: Kitahe）は**常駐のまま＝実証済み挙動・
  回帰なし**。
- アセット過多で bank128 rodata が溢れるプロジェクトだけ自動で O(1) 化。

予算の既定は `META_RESIDENT_BUDGET = 1536` バイト。環境変数 **`PCE_ASSET_META_BUDGET`**
（バイト）で上書き可能（0 = 常に CD オンデマンド、巨大値 = 常に常駐）。テストは
この変数で両モードを決定的に切り替える。

### 既知の制約

- CD オンデマンドモードでは、consumer 側の配列添字参照が accessor 戻りポインタ経由になり、
  そのままだと bank129 の code size が増えやすい。runtime では `vn_get_*_asset()` を hot path
  の入口で 1 回だけ呼び、必要 field（sprite draw meta / `cell_map` など）をローカルまたは
  runtime-owned snapshot に落としてから使う。Kitahe の meta 強制ビルドでは、過去に
  `refresh_scene_sprite_patterns_impl()` を Path B overlay（bank133）へ逃がしていたが、
  VBlank/SATB hardening 後は per-frame SATB 差分更新を VBlank へ寄せるため bank130 常駐に戻している。
  閾値を超えたのに 129/130 が溢れる場合は、まずこの consumer snapshot と bank129/130/133 の配置を確認する。
- ADPCM の runtime snapshot へ multi-byte field を移す時も、構造体同士の連続 field copy に
  見える書き方は避ける。`copy_adpcm_voice()` は local scalar へ受けてから snapshot へ書くことで、
  `tii` の高位アドレス落ちを避けている。
- スプライトの位置セル数（columns×rows）が **384 を超える**と `cell_map` インラインに
  収まらずビルドエラー。シートのセル数を減らすこと。
