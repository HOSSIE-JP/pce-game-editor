# PCE Test Play Debugging

PC Engine / Super CD-ROM²のTest Play、VDC、System Card PSG、ADPCMを調査するときの現行手順です。

## 基本方針

- 描画、VDC、SATB、PSG、bank、IRQの原因特定にはGeargrafx MCPを優先します。
- EmulatorJS/WASMはユーザー向け再現とADPCM固有回帰の確認に使います。WASMだけの挙動で実機寄りruntimeを壊さないでください。
- CD VNは`targetMedia: "cd"`、`toolchain: "llvm-mos"`で、builderが`cd.systemCardProfile: "jp-v3"`へ自動的に正規化します。System Card ROMはビルド入力ではなく、Test PlayがSetupで指定されたユーザー所有の日本版Super System Card 3.0 ROMを検証します。
- BIOS、IPL、PSG driver、抽出fontをリポジトリへ保存しません。

## 起動

1. 通常buildで`.cue`を生成し、memory gateを確認します。
2. `load_media`後に`debug_continue`します。
3. System Card画面でRUNを`press_and_release`します。
4. CD bootは実時間で待ちます。`debug_step_frame`だけで進めるとboot/input edge/PSG timingを誤判定します。
5. `get_media_info`で`is_cdrom`、`loaded_bios`、`ready`を確認します。

`debug_reset`後はpausedのことがあります。`debug_get_status`を確認してから`debug_continue`してください。

## Codex tool一覧にMCPがない場合

Windowsでは次をstdio MCP serverとして直接起動できます。

```text
C:\homebrew\emulator\Geargrafx\Geargrafx.exe --headless --mcp-stdio
```

標準CD VNテンプレートのSprite Move回帰は、テンプレートをbuildした後に次で確認できます。同期45 frame移動、非同期90 frame移動、runtime座標とSATB座標の中間値・終点を自動検査します。

```powershell
node tools/dev/geargrafx-system-card-smoke.js --cue template/template_pce_vn_cd/out/MY_NEW_GAME.cue --inspect-sprite-move
```

Geargrafx 1.7.xはnewline-delimited JSON-RPCです。`Content-Length` framingではありません。

1. `initialize`
2. `tools/list`
3. schemaどおりに`tools/call`

既知の引数は`load_media: { file_path }`、`controller_button: { player, button, action }`です。必ず実行中versionの`tools/list`を正とします。

## System Card BIOS IRQ/PSG gate

CD VNはgraphics/full VBlank handlerを使わず、generic IRQ user vectorを使います。VBlank handlerの正しい流れは、VDC status ack→`PSG_DRIVE` 1回→frame epoch加算→`RTI`です。

6000 frame smokeで次を計測します。

```powershell
node tools\dev\geargrafx-system-card-smoke.js --cue template\template_pce_vn_cd\out\MY_NEW_GAME.cue
node tools\dev\geargrafx-system-card-smoke.js --cue template\template_pce_vn_cd\out\MY_NEW_GAME.cue --exercise
```

1本目は初期scene/typewriterを600 frame安定化してから6000 epochを測り、MPR、VDC、BAT、SATBを前後比較します。2本目は180入力でsampleの全4 sceneを巡回し、CD async、CD-DA、ADPCM、BIOS font/SpriteText、BGM+SFX同時再生をまとめて通します。どちらも`$E873`へbreakpointを置き、到達時点で失敗します。

| address | 期待 |
|---:|---|
| `$E86D` | 各VBlankに1回 |
| `$E6CF` | 各VBlankに1回 |
| `$E873` | 0回。full graphics handler禁止 |

addressは対象jp-v3 ROMの公開ABI/trace gateです。違うprofileへ流用しません。

同時に確認するもの:

- ISR入口/出口のMPR4/5/6が一致する。
- `$20F5`はuser-vector bitを維持し、SYNC/full-handler bitを立てない。
- R5/R7/R8/R13、SATB、BGがIRQで書き戻されない。
- `vn_irq_frame_epoch`がVBlankごとに1増える。
- HuC6280 TIMER/TIQ handlerへ入らない。
- package/CD async load中もepochとPSG channel状態が進む。

倍速なら`PSG_DRIVE`二重呼出し、遅延/停止ならIRQ欠落または長いIRQ lockを疑います。credit/catch-up定数を追加して回避しません。

## BGM/SFX package

`get_psg_status`とMPRを組み合わせて確認します。

- `psg-song`はmain/BGM、`psg-sfx`はsub/SFXとして同時に鳴る。
- 新BGMはBGMだけ、新SFXはSFXだけを置換する。
- BGM loadはbank134、SFX loadはbank135だけを書き換える。
- 別busのload中も再生中busが止まらない。
- CD sector paddingではなく宣言byte数だけが転送される。
- `audio stop target:bgm|sfx|all`が指定busだけを停止する。

短いSFXは数百msで消えるため、ボタン直後から複数回sampleします。

## BIOS font/scene

- 起動probeがversion 3.0、代表glyph、12×12非ゼロ出力を通る。
- 失敗時は`SC3 ERR`で停止し、fallback fontを表示しない。
- message開始時にMPR6が短時間bank123になり、終了後に元bankへ戻る。
- typewriter/ADPCM/入力待ち中はbank123を参照しない。
- message glyphは12×12→24-byte mask cache、SpriteTextは12×12→透明余白付き16×16 hardware sprite patternへ4bpp化し、横12pxピッチでVRAM uploadされる。16×16 patternは2 pattern unitを使うため、`PCE_VN_FONT_SPRITE_PATTERN_BASE`は必ず偶数境界に置く（VDCはSATB pattern値の下位bitを無視する）。
- JIS第一水準以外はruntime化する前にbuild errorになる。

## VDC/SATB

VDCのselect/data interfaceは再入不可です。VDC書込、SATB DMA、overlay/bank switch、BIOS callのIRQ lock範囲を確認します。

- 通常表示のR5、scroll R7/R8、SATB start R13が安定する。
- R19 DMA startは表示期間ではなくVBlank側で行う。
- `VN_VDC_MEMORY_CONTROL`のsprite cycle bitを落とさない。
- BG `map_vram.bin`は32-tile source rowとして`width_tiles`分だけコピーし、余白のblank tileを残す。
- 未使用SATB entryはhidden Yへ逃がす。zero entryを無効spriteとみなさない。

## ADPCMと標準WASM

CDサンプルを標準EmulatorJS/WASMで自動起動し、System Card画面からVN開始後まで入力を進める回帰確認には次を使えます。

```powershell
.\node_modules\.bin\electron.cmd tools\dev\wasm-verify-branchlab.js template\template_pce_vn_cd\build\MY_NEW_GAME.cue
```

このツールはhidden windowでSystem Card起動、CD boot遷移、VN描画開始を順に確認してからI/RUN入力を注入し、途中画面を一時ディレクトリへ保存します。起動段階を通過できない場合は失敗終了します。

Geargrafxで正常でも標準`mednafen_pce-wasm.data`だけADPCM自然終了後に入力が戻らないことがあります。次を維持します。

- buffered one-shot開始後に`pce_cdb_adpcm_status()`を毎frame pollしない。
- 自然終了後に追加の`pce_cdb_adpcm_stop()`/`reset()`を投げない。
- 明示的なAudio stopだけdirect stopする。
- ADPCM開始後のjoypad edge baselineは現在押されているbutton。`last_pad=0`にしない。
- direct async ADPCM RAM load中もVSync user IRQを維持する。

比較手順:

1. 同じsceneのADPCMあり/なしbuildを作る。
2. Geargrafxで自然終了後のnext messageまで進む。
3. WASMでframe counterと`simulateInput()`直接注入を確認する。
4. 読み込まれたcore filenameを確認する。
5. WASMだけ止まる場合はcore差分として記録し、System Card PSG/IRQ runtimeを壊して回避しない。

## 組合せ受入

最低限、次を単独ではなく組み合わせて確認します。

- BGM + SFX、BGM中のSFX load
- async CD + BGM/SFX
- CD-DA開始/停止 + scene load
- ADPCM voice + typewriter + mouth animation
- BIOS message font + choice + SpriteText
- scene切替 + bank123復帰
- 明示PSG bus stop + 再play

異常が出たらframe、PC、MPR、IRQ count、VDC register、PSG channelを同じ時点で採取します。BIOS probeまたはIRQ一回性gateが成立しない場合はfallbackを追加せず、原因を報告して移行を止めます。

## 回帰

- 変更範囲のunit test
- `npm test`
- CD sample実buildとlink-map gate
- HuCard VN build
- Geargrafxの画面/IRQ/PSG/bank確認
- EmulatorJS/WASMのADPCM自然終了後入力
