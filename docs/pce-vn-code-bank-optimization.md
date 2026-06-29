# VN コードバンク最適化プレイブック（Codex 向け）

CD-ROM2 VN runtime（`template/template_pce_vn_cd/src/pce_vn_runtime.c`）が「スクリプトコマンドを増やすと常駐コードバンクが溢れて `ld.lld: section '.ram_bankN' will not fit ... overflowed` でビルド失敗する」問題を、**エンジンに全コマンドを載せたまま正常ビルドさせる**ための実務手順をまとめた再利用可能なプレイブックです。

> **このファイルを読むタイミング**: bank128/129/130 が溢れた／overlay(bank133)・visual-code(bank121) へコードを退避する／退避候補を選ぶとき。
>
> **前提ドキュメント**:
> - 機構（Path B overlay の link/抽出/dispatch）= [pce-vn-overlay-pathb.md](pce-vn-overlay-pathb.md)
> - バンク全体方針 = [pce-memory-bank-strategy.md](pce-memory-bank-strategy.md)
> - 旧 [pce-cd-bank-overflow-codex-handoff.md](pce-cd-bank-overflow-codex-handoff.md) は 2026-06-13 当時の記録で、**「bank130/131 をコード用に空けて使う」助言は現在 stale**（bank130 は満杯、bank131 はコード不可）。本ファイルを優先。

---

## 0. 結論（最短ルート）

1. **測定**（§2）して、どの bank が何バイト超過か、各 bank の大物関数を把握する。
2. 超過分を **slot4 退避リザーバ（overlay=bank133 8KB ／ visual-code=bank121 8KB）** へ逃がす。退避できるのは **§3 の co-residency 条件を満たす純粋関数だけ**。
3. 退避は **op-dispatch レシピ**（§4）で行う。overlay 内だけで呼ばれる関数は **retag のみ（dispatcher 不要）**。
4. 各退避後に **再測定＋reloc ベースの co-residency 検証**（§5）。緑になるまで反復。
5. dispatcher は退避先の bank ではなく **bank128/129（slot2/3）** に置く。**dispatcher のコストが、退避で空けたいバンクを食う**点に注意（§6）。

---

## 1. 現在のメモリ実態（2026-06、Phase 3 後）

CD-ROM2 VN は HuC6280 の MPR 窓に以下を割り当てる。**コードを置けるのは常駐 3 枚 + slot4 退避 2 枚**。

| 物理bank | MPR slot | 役割 | コード可否 |
|---:|---:|---|---|
| 128 | 2 | 常駐 `.text`/`.rodata`/`.data`/`.zp.data`（`VN_RESIDENT_CODE` / untagged） | ◎ 常駐 |
| 129 | 3 | banked code `VN_BANKED_CODE` | ◎ 常駐 |
| 130 | 4 | banked code 2 `VN_BANKED_CODE2` | ◎ 常駐（128/129/130 は co-resident） |
| 133 | 4 | **overlay `VN_OVERLAY_CODE`（bank130 と時分割、8KB フル）** | ○ 退避先①（op-dispatch 経由） |
| 121 | 4 | **visual-code `VN_VISUAL_CACHE_CODE`（bank130 と時分割、8KB）** | ○ 退避先②（visual_cache_call 経由） |
| 131 | 5 | — | ✗ System Card が slot5 で実行するため**コード不可（毒）** |
| 132 | 6 | VN generated data + CD scratch | ✗ data 専用（MPR6 はトグル） |
| 134/135 | 6 | 再生中 PSG パターン（bank132 と時分割） | ✗ data |
| 104-119 | 6 | visual payload cache page | ✗ data |

- **常駐コード総枠 = 128+129+130 ＝ 約24KB（不変）**。機能追加で増えるのは常にエンジンコード（素材は CD data file なので予算を食わない）。
- **slot4 退避リザーバ = overlay(8KB) + visual-code(8KB)**。両方とも bank130 と MPR slot4 を**時分割**するので、退避関数の実行中は bank130 が見えない（§3）。
- **`console_ram`（低位作業 RAM、`.bss`/`.data`/`.zp` の VMA 側）は常に逼迫**（実測 99.9%、空き数 B）。退避で新しい低位 RAM グローバルを増やさないこと（§6）。

---

## 2. 測定ワークフロー

### 2-1. ビルドして `--print-memory-usage`

エディタ本体は main の worktree から data dir を解決するが、**worktree のソースで main-repo のプロジェクトをビルド**したいときは、`app.getPath('userData')` を main-repo の `data` に、`require` を worktree の `pce-build-system.js` に向けた薄い wrapper を使う（本 PR の `scratchpad/build-ishi.js` が雛形）。リンカに `-Wl,--print-memory-usage` を足すと、リンク失敗時でも各 region の使用率が出る:

```
ram_bank128: 8345 B / 8 KB  101.87%   ← +153B 超過
ram_bank129: 8389 B / 8 KB  102.40%   ← +197B
ram_bank130: 9747 B / 8 KB  118.98%   ← +1555B（最優先）
ram_bank133: 6707 B / 8 KB   81.87%   ← overlay 空き ~1.4KB
ram_bank121: 6707 B / 8 KB   81.87%   ← visual-code 空き
console_ram: 7467 B / 7472   99.91%   ← 低位 RAM ほぼ満杯
```

`overflowed by N` の各 section 値は**累積**（前 section の末尾から積み上がる）なので、**実超過量は region 合計 − 8192** で見る。

### 2-2. `-Wl,-Map` で大物関数を特定

リンク失敗でも `-Wl,-Map,out/x.map` でマップは出る。各 bank section の symbol をサイズ降順に並べ、**大きく・呼び出し頻度が低く・自己完結な関数**を退避候補にする:

```sh
awk -v S=.ram_bank130 '$0 ~ S"$"{f=1;next} /\.[a-z]/{if(f && /ram_bank|\.text|\.rodata/)f=0}
  f && $5 ~ /^[A-Za-z_]/{printf "%d %s\n",strtonum("0x"$3),$5}' out/x.map | sort -rn | head
```

---

## 3. co-residency 判定（退避できる／できない）

overlay/visual-code の関数は **slot4 を bank130 と時分割**するので、実行中 bank130 は不可視。退避関数が呼んでよいのは:

- ✅ slot2(bank128 = `.text`/常駐)・slot3(bank129 = `VN_BANKED_CODE`)
- ✅ `always_inline`/inline ヘルパ、`map_vn_data()`（**slot6 のみ**触る）、console_ram(zp)、CD BIOS(MPR7)
- ✅ 同じ overlay 内の別 overlay 関数

**退避できないもの（呼ぶと slot4 が bank130 等に化けて暴走）**:

- ❌ `VN_BANKED_CODE2`(bank130) の関数を直接呼ぶ
- ❌ `delay_frame()` ＝ **内部で `pce_ram_bank130_map()` を呼び slot4 を bank130 へ戻す**。→ フレーム待ちを伴う関数（fade/effect/`flash_screen_color`）は全滅。
- ❌ `service_psg_during_blocking_work()` / `VN_MAP_BANK130_FOR_CODE()` を呼ぶ関数。
- ❌ CD on-demand accessor `vn_get_*_asset()`（sprite/bg/adpcm 等）→ CD read の wait が `service_psg`(bank130 map) を経由する。→ `plan_scene_sprite_layout` / `refresh_scene_sprite_slot_upload` は退避不可。
- ❌ visual_cache_*（slot4 の bank121 を張る）を呼ぶ関数 ＝ slot4 のネスト切替になる（例: `cd_bg_map_ref_to_vram` は `visual_cache_bg_map_to_vram` を呼ぶので退避不可）。

**良い退避候補の型**: 純粋デコーダ（`scene_pack_read_*` … console_ram のキャッシュを読むだけ）、純粋計算（`cdda_sector_from_remaining` … グローバルへの算術）、bank132 read のみ（`cache_sprite_animation` … `map_vn_data` で slot6 を張って読むだけ）、overlay 内だけで使うヘルパ（`message_glyph_cache_find`）。

**最終確認は静的解析（§5）で必ず取る**。「呼んでいそう」では判断しない。

---

## 4. op-dispatch 退避レシピ

overlay へ関数を移す手順（visual-code への退避は `visual_cache_entry`/`visual_cache_call` で同型）:

1. **retag**: 対象を `VN_BANKED_CODE/CODE2` → `VN_OVERLAY_CODE`。名前を `xxx_impl` にし、元名は dispatcher に使う（呼び出し元を変えない）。エントリ(`vn_overlay_entry`)より後ろに定義するなら forward 宣言。
2. **op を足してエントリに分岐**: `#define VN_OVERLAY_OP_xxx N`、`vn_overlay_entry(op,a0,a1,a2)` に `if(o==VN_OVERLAY_OP_xxx) return xxx_impl(...);`。ポインタ引数は `(uint16_t)(uintptr_t)` で 16bit 化して渡し、overlay 側で `(T*)(uintptr_t)` に戻す（HuC6280 アドレスは 16bit）。
3. **常駐 dispatcher を足す**（元名・元シグネチャ）: 純粋関数は `vn_overlay_dispatch(op,...)`、**VDC を触る関数は `vn_overlay_dispatch_locked(op,...)`**。`#else`(非CD) は `_impl` を直接呼ぶ。dispatcher は **bank128/129 に置く（bank130 不可）**。
4. **特例 — dispatcher 不要**: 退避関数が **overlay 内の関数からしか呼ばれない**なら、retag するだけでよい（呼び出し側も overlay 内なので intra-bank、§本セッションの `message_glyph_cache_find` / `scene_pack_u16` / `scene_pack_s16`）。

引数は通常呼出規約（zp 仮想レジスタ＋HW スタック、常時マップ）に乗るので **console_ram グローバルを増やさない**。`((fn)0x8000)(op,...)` は literal 間接呼びで **reloc を生まない**＝section を ELF から除去できる（これが full-8KB 化の肝、機構は [pce-vn-overlay-pathb.md](pce-vn-overlay-pathb.md)）。

---

## 5. 検証（必須）

### 5-1. co-residency（reloc ベース）
⚠️ **アドレスでの判別は不可**: overlay(VMA 0x1858xxx) も bank130(VMA 0x1828xxx) も `R_MOS_ADDR16` は低16bit=0x8xxx に解決される。`jsr $8xxx` だけでは内部/bank130 を区別できない。**reloc のターゲット symbol/section** で見る:

```sh
# build cmd に -Wl,--emit-relocs を足して dbg.elf を作る
llvm-objdump -dr --section=.vn_overlay dbg.elf | grep -iE "jsr|jmp|R_MOS"
```
- ✅ 許容: `.vn_overlay+...`(内部) / `.text+...`(bank128) / `__memset` 等 compiler-rt(.text) / `.ram_bank129+...`(bank129) / BIOS。
- ❌ 危険: `.ram_bank130+...` / `.ram_bank121+...`（slot4 を時分割する別バンク）。

### 5-2. ビルド緑化・回帰・実機
- `--print-memory-usage` で 128/129/130/`.vn_overlay`/`.vn_visual_code` が全て 100% 未満。
- `node --test tests/pce-vn-manager.test.js` と `npm test`。**overlay 予約 sector を変えると後続 CD data file の sector が一律ずれる**（§6）ので、テストの sector 期待値・dispatcher 形の assertion も同じ作業で更新する。
- Geargrafx でメッセージ送り/選択肢/sprite 口パク/ADPCM/PSG/CD-DA/effect が崩れず進み無ハングを確認（co-residency 回帰の最終確認）。

---

## 6. ハマりどころ（本セッションで実際に踏んだ）

- **`always_inline` で小ヘルパを畳むと退避先が膨張する**。`scene_pack_u16/s16` を `always_inline` にしたら reader 各所に展開されて **overlay が +2KB 膨張**（8106B でほぼ満杯）。→ **小ヘルパも overlay 関数（noinline）として置く**方が良い。overlay 内だけで呼ぶなら retag だけで済む。
- **dispatcher コストが、空けたいバンクを食う**。退避 1 件の正味削減 ≒ `関数サイズ − dispatcherサイズ`。小さい関数を個別 dispatcher で退避すると割に合わない。**複数の dispatcher は共有 helper に統合**（本セッションは message/sprite の lock+swap を `vn_overlay_dispatch_locked` 1 本に集約して bank128 を ~100B 削減）。
- **console_ram 満杯**。退避の引数渡しに新しい `.bss`/低位グローバルを足さない。`vn_overlay_entry(op,a0,a1,a2)` の通常引数（zp 仮想レジスタ）で渡す。8 引数の `show_character_sprite_frame` は **slot index 1 個だけ渡して overlay 側で slot 配列から 8 引数を再構築**した。
- **overlay 予約 sector を増やすと CD レイアウトがずれる**。`VN_OVERLAY_RESERVED_SECTORS` 2→4 で overlay 以降の CD data file が **一律 +2 sector**。`pce_vn_visual_code_data`/`pce_vn_scene_packs[]`/各 asset の埋め込み sector が全部ずれる（IPL padding が data 開始を sector 64 に保つので整合は取れる）。テストの sector 期待値も +2 する。
- **`scene_pack_command_count` を always_inline にできなかった**。`jump_to_command`（定義前）から呼ばれるため always_inline 不可 → **bank128 resident（untagged）**にして overlay からも bank130 からも呼べるようにした（+6B 程度は許容）。
- **dispatcher を bank130 に置くと自滅**。dispatcher が `pce_ram_bank133_map()` した瞬間、自分（bank130/slot4）が消える。必ず bank128/129。

---

## 7. 本セッションの実績（worked example: `ishi_no_ura` 全コマンド搭載）

| | before | after |
|---|---|---|
| bank128 | +26B 超過 | 99.84% |
| bank129 | +542B | 99.61% |
| bank130 | +1555B | 99.77% |
| `.vn_overlay` | 3964B/4096B（4KB上限・満杯） | **7552B/8192B（full bank133）** |

打ち手:
1. **overlay を op-dispatch 化して物理 8KB へ解放**（良性 LMA 窓の 4KB 上限を撤廃、[pce-vn-overlay-pathb.md](pce-vn-overlay-pathb.md) 残課題(A) 解消）。
2. 純粋関数を overlay へ退避: `scene_pack_read_*`(+`u16`/`s16`) / `cache_sprite_animation` / `cdda_sector_from_remaining` / `message_glyph_cache_find`。
3. message/sprite dispatcher を `vn_overlay_dispatch_locked` に統合して bank128 を削減。

co-residency 静的検証: overlay の全 228 JSR/JMP が `.vn_overlay`/`.text`/`__memset` のみ（bank130 ゼロ）を確認。`npm test` 163 件全パス。

---

## 8. それでも足りないとき

1. **bank121 visual-code（もう 1 枚の 8KB slot4 退避先）へ分散**。`VN_VISUAL_CACHE_CODE` + visual_cache op を足す。同じ co-residency 制約（§3）。
2. **追加 overlay**（別の未使用 bank）。bank134/135 は PSG 使用中なので避ける。詳細は [pce-vn-overlay-pathb.md](pce-vn-overlay-pathb.md) §7(B)。
3. **データ駆動化でコード自体を削減**（テーブル化して bank132/CD へ追い出す）。素材は予算を食わないので、増えるのは常にエンジンコード量。
