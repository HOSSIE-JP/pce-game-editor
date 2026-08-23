# PCE Game Editor User Guide

このガイドは、PCE Game Editor で PC Engine / Super CD-ROM2 project を作成、ビルド、Test Play するユーザー向けのメモです。

## セットアップ

`SetUp` 画面で、使用する機能に応じて次の外部ファイルを設定します。

- `llvm-mos-sdk`: HuCard / CD-ROM2 のビルドに使います。
- IPL: Super CD-ROM2 のビルドに使います。所有するCDイメージからSetUpで抽出するか、所有するファイルを指定します。
- System Card: Super CD-ROM2 の Test Play に使います。CD VNは日本版Super System Card 3.0 profile `jp-v3`専用で、Test Play前にROM内容を検証します。ビルド自体には使いません。
- EmulatorJS runtime: 標準エミュレーターで Test Play する場合に使います。

IPL / System Cardはユーザー所有ファイルとして扱い、リポジトリやゲーム生成物には同梱しません。外部エミュレーターをTest Play roleに選ぶ場合、その実行ファイルもユーザーが指定します。機能別の正確な組み合わせは[公開時の外部依存・ライセンス監査](release-dependencies-and-licenses.md)を参照してください。

標準Test Playでは、EmulatorJSのbrowser loopとcore内VSyncが二重に待たないよう、内側VSyncを無効にしてPC Engine本来のframe rateを維持します。負荷が少し増えただけで約30fpsへ段落ちし、PSGを含む音声も遅くなる現象を防ぐための既定設定です。外部エミュレーターのVSync設定には影響しません。

Windows で `llvm-mos linker を起動できません` または `Application Control policy has blocked this file` が出る場合は、プロジェクトや C ソースではなく Windows Application Control / Smart App Control / WDAC が `llvm-mos-sdk` の `ld.lld.exe` を拒否しています。`data/tools/llvm-mos-sdk/llvm-mos/bin/ld.lld.exe --version` が単体で起動できる状態にする必要があります。Windows 側でこのファイルを許可するか、SetUp で実行可能な `llvm-mos-sdk` を指定してください。

Windows CD-ROM2 Build の `pce-mkcd.exe` は `libstdc++-6.dll` / `libgcc_s_seh-1.dll` / `libwinpthread-1.dll` を必要とします。SDK の隣に無い場合、Build は Git for Windows / MSYS2 / MinGW / PATH から3点が揃った同一セットを探して `pce-mkcd.exe` の隣へコピーします。コピー元も無い場合は、その旨をBuild Logへ表示して停止します。HuCard Buildには不要です。PCE Game Editorは`git`コマンド自体を実行しないため、DLLが別経路で揃っていればGit for Windowsの導入も不要です。

Windows 標準の `tar.exe` は ZIP / 7z 展開に利用でき、Windows PowerShell / System.Drawing はHuCard VN font描画に利用するOS機能なので、SetUpに個別の成功行は表示しません。`pwsh.exe`（PowerShell 7）の追加導入は不要です。Windows以外では、archive展開手段やPython 3 + Pillowが不足している場合だけ任意/要確認の診断を表示します。font rendererが無い場合も内蔵fallback bitmapで生成でき、VNフォント生成はFFmpegへ依存しません。各ツールカードの手動パス欄には、既に別の場所へ入れてある `mos-pce-clang` や EmulatorJS runtime フォルダを指定できます。

## 新規プロジェクト

起動時のプロジェクト選択画面では、最近開いたプロジェクトに加えて、既定の `projects` フォルダ直下とそのサブディレクトリにある `project.json` 付きプロジェクトを選択できます。プロジェクト選択画面の `新規プロジェクト` では、作成場所、プロジェクトフォルダ名、ゲームタイプを指定します。PCE project は PC Engine 専用として扱うため、対象コアの選択は表示しません。

Mega Drive ROM ヘッダー向けだったタイトル、作者名、シリアルの入力は PCE 新規作成では使用しません。作成直後の内部表示名はプロジェクトフォルダ名から初期化されます。

### 現行データ形式

現行テンプレートとエディターが書き出すデータを正とします。

- project core は `project.json` の `coreId: "pc-engine"` 固定です。
- asset の正本は `assets/pce-assets.json` の `version: 2` です。BG / sprite / palette / PSG / ADPCM / CD-DA を同じ document で管理します。Track 1警告音声は専用type `cdda-warning`、固定ID `cdda_warning`の1件だけで、通常の`cdda-track`やNovelの音声選択肢には出ません。
- VN scene の正本は `assets/pce-vn-scenes.json` の `version: 2` です。scene の実行順は `commands`、scene pack の生成順は `scenes` 配列順です。
- build plugin と Test Play plugin の選択は `project.json.pluginRoles.builder` / `pluginRoles.testplay` です。
- HuCard は `targetMedia: "hucard"`、Super CD-ROM2 は `targetMedia: "cd"` と `toolchain: "llvm-mos"` を使います。CD VNの`cd.systemCardProfile`はbuilderが固定値`"jp-v3"`へ正規化する生成契約で、ユーザーが設定する項目ではありません。System Card ROM本体はビルドには不要で、Setupで指定したユーザー所有ROMを CD-ROM2 Test Play 時だけ検証・使用します。

現行 visual asset は raw の `tiles.bin` / `map_vram.bin` / `patterns.bin` だけを使い、圧縮オプションや `.rle` sidecar は保存しません。ADPCM divider/encoder と一部の VN command field には、既存データを安全に読み込むための値補正が残っていますが、UI で複数バージョンを選ぶ機能ではありません。詳細は [Implementation Audit](implementation-audit-2026-07-10.md) を参照してください。

Settings の `プロジェクト表示名` は、アプリ内表示に加えてビルド出力のファイル名に使う project metadata です。HuCARD は `out/<表示名>.pce`、CD-ROM2 は `out/<表示名>.cue`（対応する `.iso` も同じ名前）になります。ファイル名に使えない文字は `_` に置き換えます。PCE ROM ヘッダー情報ではないため、作者名やシリアルの編集欄は表示しません。

### Plugins とユーザーコードの信頼

Settings > Plugins は、有効なプラグインに加えて、不正な manifest と不足 dependency を「プラグイン診断」に表示します。診断にはplugin ID、組み込み/ユーザーの区分、エラー理由、manifest pathが出るため、読み込まれないpluginをフォルダ探索だけで調査する必要はありません。

Plugins 画面上部の `Build / Emulator プラグイン（単一選択）` は既定で展開され、現在の Build plugin と Test Play plugin をすぐ確認・変更できます。見出しをクリックすると必要に応じて折りたためます。

ユーザープラグインフォルダへ新しく置いたpluginは未信頼・無効状態です。有効化すると、rendererとmain process codeがアプリと同じ権限で動くことを確認するダイアログが表示されます。内容と入手元を確認できる場合だけ信頼してください。「信頼を解除」を押すと、そのpluginを無効化して実行許可を取り消します。現在の信頼モデルは明示確認方式で、user pluginを別processへ隔離するsandboxではありません。

標準の HuCard サンプルは `llvm-mos-sdk` の `mos-pce-clang` でビルドするスライドショーテンプレートです。builder は `pce-slideshow-builder` で、CD-ROM2 VN 用の `pce-visual-novel-builder` とは分離されています。`Image` に登録した BG 画像のうち、ID が `slide_001` または `slide_001_title` の形式に一致するものだけを番号順に表示し、最後の画像の後は先頭へ戻ります。番号は `001` から連番にしてください。スライド画像は PNG として保存され、8px 単位かつ 256x224px 以下である必要があります。ビルド時に形式、サイズ、生成済みデータ、HuCard の ROM bank 使用量を検査し、容量を超える場合は何枚目で超えたかを示すエラーで停止します。コントローラーの `←` は前の画像、`→` またはその他のボタンは次の画像へ進みます。入力がない場合も一定時間で次の画像へ自動遷移します。テンプレートには `slideshow_bgm` の PSG song が含まれ、HuCard 上でループ再生されます。スライドショーテンプレートから作成したプロジェクトでは、既定で `Sound` と `Novel` の sidebar plugin は無効です。

HuCARD ノベルテンプレートは `template_pce_vn_hucard` / builder `pce-visual-novel-hucard-builder` を使います。Novel のシーン編集 UI と script command は CD-ROM2 VN と同じですが、ビルド結果は `.pce` のみで、IPL / System Card / `pce-mkcd` / CD data file は使いません。BG、Sprite、Message、Choice、Variable、IF/Switch/GOTO、InputCheck、Effect、SpriteText、PSG は HuCARD runtime で処理します。ADPCM、CD-DA、`message.voiceAssetId`、ADPCM cache load は HuCARD では無音の no-op になり、ADPCM / CD-DA asset metadata も ROM に出力されません。PSG song / SFX は HuCARD 用の ROM bank data として入り、song はループ、SFX はワンショットで再生されます。BGM と SFX は別々に管理され、SFX が使う channel だけを一時的に優先し、終了後はその channel の BGM を復元します。MIDIのwave IDも保持しますが、System Cardを持たないHuCARDでは内蔵波形をそのまま使えないため、sine / saw / triangle / square の32-sample波形へ近似します。font mask、scene pack、spritetext font、PSG pattern、画像/sprite payload は同じ HuCARD ROM bank allocator を共有し、小さいpayloadは同じ8KB data bankの空き領域へpackされます。banks 5..127 の実容量（123 banks）を超える場合は、割り当て前の総必要量とBG / Sprite / scene pack / font / PSG別の内訳を示してビルドを停止します。Test Play は通常の HuCARD ROM と同じく標準エミュレーターまたは外部エミュレーターへ `.pce` を渡します。

HuCARD ノベルの ROM 配置は固定です。runtime code は `rom_bank1..4` を予約し、font mask / scene pack / spritetext font / PSG pattern / 画像 payload は `rom_bank5..127` の data bank に置かれます。BG / Sprite の generated visual payload は、小さい palette / map も含めて data bank に置かれ、bank0 `.rodata` には置きません。異なるassetのdata refは同じbankへ同居でき、bank境界をまたぐpayloadだけが複数chunkへ分割されます。message font は 12x12 mask、1 glyph = 24 bytes で、使用グリフ数に応じて data bank を消費します。マスクは描画時にROMから直接読まれるためVRAMに常駐せず、VRAMは文字種数にかかわらずメッセージ表示帯208タイルとblank 1タイルだけを予約します。scene packも4KB RAM cacheへコピーせずbanked ROMから直接読み、1 sceneの上限は8192 bytesです。詳細は [HuCARD VN bank layout](pce-vn-hucard-bank-layout.md) を参照してください。

## Image / Sprites

`Image` の `BG` では PCE 背景画像を、`Sprites` では PCE sprite sheet を編集します。BG 追加時に指定する変換条件は出力幅/高さで、既定値は標準 BG サイズの 224×136px です。BG の `Palette bank` と `Transparent index` は実用上個別指定する場面が少ないため UI には表示せず、内部既定値 `0` で変換します。`Sprites` の追加時も通常表示は出力幅/高さだけにし、変換時だけ有効な `Cell size` は `アドバンス` に隠します。`Palette bank` / `Transparent index` は表示せず、`paletteBank: 0`、`transparentIndex: 0` で登録します。`tileBase`、`x`、`y` は低レベル既定値として `Properties` の `アドバンス` に隠し、通常は変更しません。追加直後の animation は `Frame W: 16`、`Frame H: 16`、`Frames: 1`、`Speed: 1` です。frame size、ROW ごとの frame 数、time は Sprites タブのエディタ本体で調整してください。変換後に生成済み tile / pattern と metadata がずれないよう、`Cell size` は詳細フォームでは直接編集しません。

PC Engine の色は各チャンネル3bitの512色マスターパレットから選ばれ、1つのsprite paletteは透明色を含む16エントリです。Novelのスクリプトプレビューは保存されたPNGをそのまま描くため、実機表示ではマスターパレットへの変換による色差が残ります。ただし、透明＋15色以内のspriteは、元の別色が同じ9-bit色へ単純に丸め込まれないよう、内蔵変換が512色から重複しない色の組合せを選んで階調を維持します。元色への近さと色の区別を両立するため、実機色はPNGからわずかにずれることがあります。旧変換で生成済みのspriteも次回build時に一度だけ自動再生成され、登録し直す必要はありません。

`Sprites` は sprite asset tree、Frame Preview、Sprite Sheet、Animation Rows、Properties を持つ編集画面です。フレーム幅・高さと ROW ごとの名前・有効 frame 数・time を編集すると、PCE VN runtime が参照する `options.animations` と、エディタ再表示用の `options.spriteEditor` metadata に保存されます。ROW名は日本語を含む任意の文字列を48文字まで入力できます。表示名だけが変わり、sceneから参照する内部ID（`default` / `row_N`）は変わりません。Time は 60fps 基準の frame 数で、有効範囲は `1..65535` です。各フレームごとの値をそのままプレビューと CD-ROM2 / HuCARD runtime の再生速度に使い、`1000` は約16.67秒、最大 `65535` は約18分12.25秒です。Frame Preview と Sprite Sheet の境界、および Sprite Sheet と Animation Rows の境界は上下にドラッグして高さを変更でき、設定したレイアウトは次回表示時も維持されます。Frame Preview と Sprite Sheet のプレビュー領域はスクロールでき、マウスホイールで 10-500% の倍率を調整できます。中ボタンドラッグでは表示位置を移動できます。Sprite Sheet のセルをクリックすると、その ROW / Frame が Frame Preview（画面上部）に反映され、Animation Rows の対応 ROW がハイライトされます。Sprite Sheet の各フレーム右上には、その frame の Time（既定 time）が表示されます。保存される sprite metadata は frame / animation と PCE 変換に必要な現行フィールドだけです。

`Palette` では手動 palette を追加、保存、削除できます。削除時は確認 modal が表示されます。

## Novel（スクリプト編集）

北へ。PMで大量SCRを取り込む場合、Mappingは40件ずつ、診断結果は200件ずつページ表示します。画面外の大量なasset選択肢や診断DOMを同時生成しないため、ページ内のMapping設定とスクロール位置を保ったまま診断プレビューへ進めます。Previewでは適用を止めるエラーを警告より上へ固定表示し、エラーがある場合は詳細一覧もERRORだけを既定表示します。大量の警告はcode別の件数へ集約して確認でき、すべて／ERROR／WARN／INFOで絞り込めます。

`Novel` プラグインの `スクリプト` タブは VN シーンをコマンド単位で編集します。Scenes 一覧はドラッグ＆ドロップで順番を入れ替えられます。シーン名はヘッダの Name で編集でき、`chapter/opening` のように `/` で区切ると Scenes 一覧ではグループ見出しと leaf 名に分けて表示します。シーンの ID はヘッダの `ID` で変更できます。**開始シーン（runtime が最初に表示するシーン）は Scenes 一覧の各シーン右側にある ★ ボタンで選びます**。開始シーンの ★ は金色で点灯し、別シーンの ☆ をクリックするとそのシーンが開始シーンになり、以前の指定は自動で解除されます（開始シーンは常に 1 つ必要なため、点灯中の ★ をクリックして解除することはできません）。ID 変更時は `Jump` / `Choice` / `nextSceneId` / `startScene` の参照もエディタ側で更新します。グループ見出しはアコーディオンとして開閉でき、折りたたんだ階層のシーンは一覧から一時的に隠せます。Commands パネルも Commands ヘッダ行のクリックで折りたため、閉じると Scenes 一覧が縦に広がります。`Jump` などの参照は安定した scene `id` を使うため、名前を変えても遷移先は壊れません。中央のコマンド一覧では、各コマンド行の右側にアイコンボタンが並びます。

CD VN runtime は `nextSceneId` を入力待ちではなく自動遷移として扱います。コマンドを持たない中継シーンや `Jump` だけのシーンが連続していても、`Message` / `Choice` / `Wait` / 同期待機命令へ到達するまで同じ送り操作の中で継続するため、暗転用の中継シーンごとに追加のボタン入力は必要ありません。

ヘッダの `GUI` / `JSON` 切り替えで、同じシーンデータをフォーム編集または JSON テキスト編集で扱えます。`JSON` モードでは `assets/pce-vn-scenes.json` と同じ `version` / `settings` / `startScene` / `scenes` 構造を直接編集します。保存、プレビュー、GUI へ戻る操作では JSON を読み込んで既存ルールで正規化するため、未登録 asset 参照、範囲外の数値、存在しない scene / label 参照は GUI と同じ扱いで補正されます。JSON として読めない場合は保存せず、エラー位置を表示します。

ChatGPT などでシナリオ、スクリプト JSON、画像・音声アセット案を作る場合は、`docs/pce-vn-chatgpt-authoring-guide.md` の制作ルールとプロンプト例を使ってください。

北へ。PM取込の主人公名は「ハドソン」が既定です。同じSCR集合・entryの再取込では保存名を復元します。`【主人公】` / `主人公`などは元SCRの`NAME`で「こあら」「真人」などへ再定義されていても指定した主人公名を優先し、本文とMENU選択肢の両方へ反映します。空欄を明示した場合だけ元SCRの`NAME`定義を使います。

SCR選択では、resource rootを指定した直後にSCRIPT配下で検出した全ファイルがチェックONになります。個別のチェックを変更してもSCR一覧のスクロール位置は維持されます。チェックONのSCRはentryからGOTOで接続されていなくても各ファイルの先頭から変換対象になり、entry SCRは取込entry sceneを決めるために使われます。同じSCR内の細かな分岐blockは、1 sceneあたりbuild時command見積り220件／pack見積り7000 bytesを目安にまとめます。同一scene内のGOTOとChoice分岐はlocal labelへ変換されるため、元SCRの分岐を保ったままscene数を抑えます。初回検査は独立SCR rootだけで明らかに255 sceneを超える場合を検出し、Mapping後のpreviewでpacking済みscene数と実8192-byte packを確定します。上限を超える場合も一部だけを黙って取り込みません。

CD-ROM2 projectでは、組み込みプラグイン **北へ。PhotoMemories 取込** が有効な場合だけスクリプト画面上部に **北へ。PM取込** が表示され、解析済みSCRをsceneへ変換できます。resource rootを選び、変換対象のSCR、entry、主人公名、到達可能な画像・音声参照の対応先を順に指定します。話者の対応設定はなく、取り込むMessageはすべてナレーションになります。`COLOR WIN_MSG, GCOLOR`などの16-bit ARGB4444値はRGBを本文色へ変換し、PCE表示色へ丸めて反映します。解決できないCOLOR値はwarningを表示して既定の白を使います。sourceの拡張子を除いたpathと登録済みPCE asset名が一致する参照は自動選択され、複数画像は `_A` / `_B` など一致しない末尾を除いた共通名で事前結合assetへ照合されます。カード右上のチェックをOFFにするとカードの色が変わり、その参照を明示的に省略します。Mapping設定を変えてもスクロール位置は維持されます。過去の手動asset対応が残っている場合は **アセット対応をリセットして自動照合** を押すと、最新の登録済みassetから全画像・音声対応を作り直し、一致しない参照を省略へ戻せます。sidecarは変換適用に成功した時だけ更新され、保存済みmappingは同じ選択SCR集合とentryにだけ復元され、別の取込へ流用されません。画像の結合・crop・減色、P04/MIDI/GD-DA自体の変換は行いません。取込本文・選択肢にSystem Card jp-v3非対応文字がある場合は、Unicode code pointごとに`□`へ置換し、元SCR行と文字位置をwarningへ表示します。HuCARD projectではプラグインが有効でもボタンを表示しません。

北へ。PMの連続する`MSG WIN_MSG`は`WAIT WIN_MSG`まで連結し、元SCRの改行とその前後の空白を除去して詰めます。PCE側では17文字ごとのruntime折り返しに任せ、ページ送りcursor用の1文字を除いた67 glyphごとにページ化するため、元の行幅による改行とPCEの折り返しが重なって余分な空行になることはありません。Spriteは各`ICG`のXを、PCE BGの幅・表示位置と素材packageに保存した元source crop Xを使う`BG表示X + round((ICG X + 元source crop X) * BG幅 / 640)`で取込時にPCE座標へ変換します。通常のPCE BGは224px幅・tile X=2（表示X=16px）です。変換後はSpriteの出力幅を含めてBGの左右内側へ補正し、補正時はwarningを残します。Yは一律`17`で、MappingではSlotとAnimationだけを指定します。BG commandはFade out / Fade inを速度3（30/30）にし、切替演出をPCEノベルエンジンへ任せます。変換元のalpha形式の`FADE`がSprite mapping対象なら、段階的な透明度ではなく同じSlotの`Visible: false/true`へ近似し、`ICG`の初期opacity 0も非表示で生成します。BG対象のalpha `FADE`、9引数の明度系`FADE`、その他のフェードはwarning付きで省略し、`SCREEN`の全画面fade / flash / blank近似だけを維持します。
北へ。PMの元SCRにある`CLEARCG`、`DCG <slot>, OFF`、`UNLOADCG` / `UNLOAD` / `UNL`は、対応するSprite slotの`Visible: false`へ変換されます。`UNLOADCG` / `UNLOAD` / `UNL`後も元SCRと同様に同じLCG slotを再度`ICG`で表示でき、後続の`LCG`または`CLEARCG`までsource対応を保持します。通常のscene切替はSprite状態を保持するため、元SCRに消去命令がない場合は表示を引き継ぎます。`IF`はruntime variableが比較の右辺にある表記も自動的に左右と比較演算子を正規化して取り込みます。引数なしの`ONTG`はタイマーリセットとしてwarning付きで省略し、自己GOTOやscene jumpへ変換しません。

素材を先に登録する場合は、Kitahe PhotoMemories Asset Viewerの **ツール > PCE Game Editor向けアセット一括出力** でSCRを複数選択し、P04/WAV、MIDI/MID、crop・連結済みPVR/PNGと`kitahe-pm-assets.csv`を1つのfolderへ出力します。選択したSCRもCP932の元byte列のまま`SCRIPT/...`へ同梱されるため、同じfolderを **北へ。PM素材** と **北へ。PM取込** のsource rootに使えます。画像のBG/Sprite分類とcropはViewer側で確定します。

ADV連番は外部GOTOの順序で解析し、選択範囲より前のSCRはCGDIR・slotなどを引き継ぐためのcontextとして自動的に読み込みます。contextだけで参照されたassetは出力対象になりません。

結合後の論理画像が640×480ならBG、512×480ならSpriteを既定にし、一覧で個別に変更できます。PVRのLCG cropとLINK結合後、代表画像上でBG／Spriteごとの共通切り出し枠を指定します。切り出し枠は1px単位で移動・拡縮でき、最終出力サイズのアスペクト比を維持します。切り出した後にbilinearで最終サイズへリサイズします。既定出力はBGが224×136、Spriteが224×128（Cell 32×64）です。
LCGの表示幅・高さがPVR実寸を超える場合だけ、Quick Playと同様に各軸を実寸へclampします。共通切り出し枠は暗黙にclampせず、別画像で範囲外ならViewerでerrorになります。BGの8px境界とSpriteのCell境界は最終出力サイズだけに適用し、元画像上の切り出し座標・寸法には適用しません。

PCE Game EditorのCD-ROM2 projectで **Assets > 北へ。PM素材** を押し、その`kitahe-pm-assets.csv`を選択します。確認一覧にはPNG thumbnail、WAV/MIDI変換情報、Viewerで確定したBG/Sprite種別、寸法、新規/更新、警告、エラーが表示されます。PCE側では画像種別を変更しません。warningがある場合は確認checkboxが必要で、errorがあるpackageは開始できません。実行直前にもmanifest・素材・asset catalogを再検査します。

登録開始後は行単位で確定するため、途中の変換失敗後も残りを続行します。**残りをキャンセル** は現在行の完了後に止まり、それまでの成功assetを保持します。同じ`sourceKey`で前回登録したassetはIDを維持して更新し、無関係な同一IDや型違いは保護します。P04は容量超過時に自動分割せずerror、MIDIはPSG Song、PNGは内蔵16色変換でBG/Spriteになります。HuCARDでは **北へ。PM素材** を無効化します。既存の **AD CSV** 一括取込は変更ありません。
画像行の`sourceSize` / `sourceCrop` / `outputSize`は、絶対pathを含まない`kitahePm.imageTransform` provenanceとしてassetへ保存されます。北へ。PM取込はこの元source cropをSprite X変換に使うため、Viewer packageを更新した場合は **北へ。PM素材** を再登録してからSCRを再取込してください。


変換前の診断には元SCRの相対pathと行番号、未対応演出の省略・近似、scene予算が表示されます。warningは確認後に適用できます。jp-v3非対応文字は`□`へ置換するwarningとして続行しますが、壊れた分岐、未解決label、未設定asset mapping、asset型違い、不正なCP932 byte列、scene/command/変数/8192-byte pack上限の超過がある場合は適用されません。**置換** は現在のVN settingsを維持して取込entryを開始sceneにし、**追加** は既存開始sceneを既定で維持します。適用前のsceneは `assets/pce-vn-scenes.kitahe-backup.json`、再取込用設定と詳細reportは `assets/kitahe-pm-conversion*.json` へ保存されます。詳しい変換規則と制約は [pce-kitahe-pm-converter.md](pce-kitahe-pm-converter.md) を参照してください。

スクリプト画面上部の **音声バッチ出力** は、全シーンの有効な `Message` を走査し、Irodori-TTS Batch Clientへ読み込める話者別CSVをZIPで保存します。GUI / JSONの未保存編集も出力へ含み、ZIP保存が成功すると、その出力に使った同じscene snapshotを `assets/pce-vn-scenes.json` へ自動保存します。この時点では新しく採番した `voiceAssetId` はMessageへ設定しません。スキップ指定または本文が空のMessageは除外し、話者が空のMessageは `narrator` バッチへ入ります。出力前にVoice IDプレフィクスを入力でき、既定値は `voice` です。

ZIPの `batches/speaker_001.csv`、`speaker_002.csv` などは話者ごとに分かれ、ナレーションは `batches/narrator.csv` です。各CSVはUTF-8 BOM付きの `id,text,output_dir` 形式で、`output_dir` は `/output/<プレフィクス>/<話者名>`（ナレーションは `/output/<プレフィクス>/narrator`）になります。`manifest.csv` には各Messageのscene ID、1始まりのcommand index、話者、本文、音声ID、出力WAVパスが記録されます。`output/adpcm-import.csv` は同じ音声IDを共有するMessageを1ジョブへまとめたADPCM一括取込リストで、`source` も `<プレフィクス>/<話者フォルダー>/<id>.wav` の相対パスになります。8000Hz・loopなし・自動分割を既定にします。

出力の成功・エラーは画面のメッセージ欄に表示され、成功・キャンセル・エラーの全結果は Plugin Log / Build Log にも記録されます。キャンセルはエラー表示を残しません。エラー時はログに表示された scene ID や command index を確認して修正してください。

推奨ワークフローは次のとおりです。

1. Novel > スクリプトで **音声バッチ出力** を実行し、ダイアログでプレフィクス（既定 `voice`）を指定してZIPを展開します。
2. Irodori-TTSで `batches/*.csv` を話者ごとに処理します。Irodori-TTSの `/output` は、展開した `output` folderへ割り当てると後工程がそのまま通ります。
3. Sound > ADPCMの **CSV一括** で `output/adpcm-import.csv` を選びます。WAVを別folderへ生成した場合は、確認画面の **WAVルート（任意）** で実際の出力folderを選び直します。
4. 取込完了後、Novel > スクリプトの **音声バッチ反映** で展開した `manifest.csv` を選びます。一覧を確認して有効行を反映すると、対応するMessageの `voiceAssetId` が設定され、scene fileも自動保存されます。

既存の `voiceAssetId` があるMessageはそのIDをWAV名に使い、未指定なら指定したプレフィクスに連番を付けた `<プレフィクス>_0001` 形式のIDを、既存asset IDと衝突しないように割り当てます。既存の `voiceAssetId` 自体はプレフィクス指定で変更されません。同じID・同じ話者・同じ本文を複数Messageが参照する場合、TTS/ADPCM生成ジョブは1件ですが、manifestには各Messageが残るため全箇所へ同じADPCMを設定できます。プレフィクスと音声IDは `[A-Za-z0-9_-]{1,48}` に一致する必要があります。

**音声バッチ反映** はscene ID、command位置、話者、本文が出力時と一致し、同じIDの単一ADPCMが登録されている行だけを対象にします。既存の異なる `voiceAssetId` は確認一覧で置換として表示されます。WAVが上限を超えて `<id>_part01` などへ分割された場合、partは自動連結されないため元IDのMessage voiceには設定せずスキップします。欠落assetや出力後に編集・移動されたMessageも理由付きでスキップし、他の有効行は反映できます。

Irodori-TTSは1回のバッチで参照話者が共通なので、キャラクターごとのCSVを個別に読み込み、対応するSpeaker EmbeddingまたはReference WAVを選んで生成してください。HuCARDプロジェクトでもリスト作成・ADPCM登録・Messageへの設定保存には利用できますが、設定したMessage voiceを実機再生できるのはCD-ROM2 VNだけです。

Visual Novel CD テンプレートには、`BG` / `Sprite` / `Sprite Move` / `Message` / `Audio` / `Variable` / `Choice` / `IF` / `Switch` / `Label` / `GOTO` / `Input` / `Jump` / `Wait` / `Effect` / `SpriteText` を使うコマンド仕様サンプルシナリオが入っています。エディタではこれらに加えて `Cache` コマンドも追加できます。Akari / Mika の立ち絵は `default`（通常）/ `mouth`（口パク）/ `blink` の順でROWを持つスプライトシートになっており、`Message` の Mouth slotによる「現在ROW→次ROW」と自動復帰を確認できます。テンプレートの `assets/pce-font.json` は既定でビットマップフォント `JF-Dot-ShinonomeMin12`（`assets/fonts/JF-Dot-ShinonomeMin12.ttf` 同梱、fontSize 12 / threshold 80 / xOffset・yOffset 各1 / tileBase 540）を選択済みです。`fontPath` を空のままにするとOS側の標準日本語フォント（Windowsではmeiryo.ttc等）へフォールバックしますが、アンチエイリアス前提の可変幅フォントを12x12へ強制的に閾値化するため文字が潰れやすく、特にHuCARD向けにはビットマップフォントの使用を推奨します。

組み込みプラグイン **NVプロジェクトのGodotエクスポート** が有効な場合だけ、Novel画面上部に`Godot出力`を表示します。現在のGUI/JSON編集状態からGodotネイティブプレイヤーへ取り込む`*.pcevn.zip`を作成し、ZIP保存が成功した後、その出力に使った同じscene snapshotを`assets/pce-vn-scenes.json`へ保存します。CD-ROM2 / HuCARD VNの両方で利用でき、Sceneと参照中のアセットだけを収録します。画像はPNG/JPEG/WebP、CD-DA/ADPCMはWAV/OGG/MP3の再生可能source（CD-DAは生成WAVを優先）、PSGはpattern metadataを使います。WAVはZIP作成時にOgg Vorbis（VBR quality 4、元のsample rate/channel数を維持）へ変換し、package内の`asset.file`も`.ogg`を指します。既にOGG/MP3のsourceは音質劣化を避けるためbytesをそのまま収録します。manifestは`pce-vn-godot-package` version 2で、`audio.wavTranscode: "ogg-vorbis"`と圧縮前後の統計を持ちます。出力完了ログでもWAVの合計サイズ変化を確認できます。Novelの`フォント`タブで選択中のproject font（`assets/pce-font.json`の`fontPath`）がTTF/OTF/WOFF/WOFF2なら同梱し、Godot側の本文・SpriteText・選択肢・再生UIで優先します。未選択のfont libraryから別のfontを勝手に選ぶことはありません。System Card、IPL、ROM/CUE/ISO、PCE向けtiles/map/pattern/ADPCM binaryは含みません。同じeditor projectから再出力したpackageはGodot側で更新として扱われ、別projectはライブラリに併存します。プラグインをOFFにするとボタンも非表示になります。

Godot Playerのワイド画面余白へ枠を表示する場合は、Player配布側の`package/library.json`へトップレベル`border`を追加し、`package`内の画像を相対パスで指定します。例: "border": "assets/player-border.png"。画像assetへの登録やScene Commandからの参照は不要です。推奨サイズは`1280×720`で、Playerは縦横比を維持したcover配置の上へ中央ゲーム画面を重ねます。未指定、存在しない、または読み込めない場合は暗色の余白になります。

`システム設定` タブでは、ノベルエンジン全体のメッセージ速度と Advance の初期値を設定します。メッセージ速度は `速度1(速い)：0`、`速度2：10`、`速度3：20`、`速度4：30`、`速度5：40`、`速度6(遅い)：50` から選びます。Advance は既定が `button` で、`auto` にすると Auto wait のフレーム数を使います。これらは全 `Message` command 共通で、Message のプロパティには表示されません。Auto wait はAdvanceの初期値がbuttonでも編集できます。

CD-ROM2 / HuCARD 共通の予約変数として `AUTO_ENABLE` と `MSG_SPEED` を使用できます。`AUTO_ENABLE` は `0=OFF`、`1=ON` で、初期値はAdvanceから決まります。SELECTを押すたびにON/OFFが切り替わり、SELECTはこの切り替え専用です。Message右下の表示は、手動モードでは本文完了後に点滅する `▼`、AUTOモードでは文字送り中から常時点灯する `◆` になり、SELECTでの切り替えにも即座に追従します。この表示はCD-ROM2、HuCARD、エディター内プレビューで共通です。`MSG_SPEED` の初期値は0で、`0`はシステム設定（CDの音声付きMessageでは音声同期速度）、`1..6`は速度1〜6（`0 / 10 / 20 / 30 / 40 / 50` frame/文字）を指定します。Variable / Choiceで書き込み、IF / Switchで参照でき、範囲外の値はそれぞれ`0..1`、`0..6`へ丸められます。速度はMessage開始時に確定するため、表示中に変更しても次のMessageから反映されます。

AUTOがONの音声なしMessageは、本文表示完了後にAuto waitを経て進みます。CDのone-shot Message voiceは本文表示とADPCM自然終了の両方が完了した時点で進み、追加のAuto waitは入りません。音声開始に失敗した場合とloop音声はAuto waitを使い、loop音声は遷移時に停止します。HuCARDのPSGと独立したAudioコマンドはAUTO待機の対象ではありません。
CDの`voiceAssetId`付きMessageは、generatorが直前へ内部`Cache Load ADPCM`を挿入して先読みを完了させます。runtimeはMessage開始時、メッセージ窓のVBlank更新・消去・glyph mask準備より先にbuffered ADPCM再生を開始します。ここに追加のVBlank待ちは入れません。独立したADPCM Audioは後続のMessage／Wait／Effectへ保留せず、元スクリプトのAudio命令位置で直ちに再生します。

BG / Sprite / ADPCM / PSGなどの読み込みはruntimeがscene入場時と各表示・再生命令で管理します。CD scene pack v3は最大8192 bytesでbank123へ読み込み、message開始時に最大68 glyphをconsole RAMへ切り離します。BG / Spriteは`Cache Load`でvisual cacheへ、PSGは`(assetId, channel)`単位のSystem Card packageをBGM=bank134、SFX=bank135へ先読みできます。実際のVRAM / BAT / SATB反映は`background` / `sprite` command実行時だけです。

`Cache`コマンドはruntime cacheを制御します。`Clear`は読み込み済み判定だけを落とし、現在表示/再生中のVRAM、SATB、ADPCM、CD-DA、PSG、変数、scene packを破壊しません。`Load PSG`は参照するchannel variantを対象busへ先読みします。同じbusで別packageを再生中にpreloadするsceneはbuild errorになるため、先に`Audio stop`で`BGM`または`SFX`を停止してください。`All`はmessageのBIOS glyph cacheも無効化します。

`Load` は `ADPCM`、`BG`、`Sprite` の asset を明示して先読みできます。ADPCM load は再生中のADPCMがある場合は何もせず、停止中だけADPCM RAMへ読み込みます。BG load は BG tiles と map を、Sprite load は sprite pattern payload を visual RAM cache へ読み込みます。どちらも VRAM / BAT / SATB / 現在の表示を変更しません。

`BG` コマンドの切替は Fade 前提です。`cut` の設定項目は表示されず、Fade out / Fade in は `速度1(即時)：1`、`速度2：20`、`速度3：30`、`速度4：40`、`速度5：50`、`速度6(遅い)：60` のリストから選びます。速度1の値`1`はCD-ROM2 / HuCARD runtimeの両方で0-frame fadeとして扱い、paletteを段階変更せず即座にBGを入れ替えます。既定値は `速度3：30` です。通常 BG の新規コマンドと座標未指定時の既定位置は `x: 2`, `y: 1` です。保存済みの旧 `cut` 指定は読み込み時に Fade へ正規化されます。

- **コピー（⧉）**: 選択中のコマンドをクリップボードに複製します。
- **前にペースト（⤒）/ 後にペースト（⤓）**: コピーしたコマンドをその行の前 / 後ろに挿入します。クリップボードが空のときは無効です。
- **削除（×）**: その行を削除します。

シーン右上の **Full BG** を有効にすると、そのシーンでは 256×224 の全画面背景とhardware spriteを表示できます。背景は 256×224px の BG asset を `x: 0`, `y: 0` に置いてください。`Sprite` / `Sprite Move` / `SpriteText` は使用できますが、前シーンのspriteとSpriteTextは引き継がれないため、Full BGシーン内で表示してください。ビルド時はFull BG上で実際に使うSpriteText fontまたはsprite patternをFull BG tileと重ならない位置へ自動packし、SATBまでに収まらない場合はエラーになります。通常シーンの `BG` コマンドへ切り替わるときは、Full BGをそのコマンドの **Fade out** フレーム数で暗転してから、Full BGが上書きした message / blank 用 VRAMを復元し、新しいBGの転送とFade inを行います。このモードのシーンに `Message` / `Choice` がある場合、または同じ BG asset を通常シーンでも使う場合はビルドエラーになります。

Asset一覧に未使用の大きなBG / Sprite / ADPCM / PSGが残っていても、VN buildのruntime metadataとVRAM予約はsceneから参照されるassetだけを対象にします。CD-DAだけは例外で、CUEの物理track配置を維持するため、未参照でも登録済みの全CD-DA assetをtrack数・連番検査とディスク出力の対象にします。

Sound > CD-DAには通常アセットと分離した固定Track 1 **Warning Audio**、固定Track 2 **Game Data**、Track 3以降のゲーム音声を表示します。Warning AudioはWAV/MP3をインポート・差し替え・削除・プレビューできますが、Track番号とLoopは変更できません。標準警告音声は同梱しないため、新規CDプロジェクトもユーザー自身の音声を設定するまでビルドできません。旧プロジェクトのTrack 2始まりや欠番は赤字で表示されます。画面を開いただけでは書き換えず、「Track 3から再採番」を押したときだけTrack 3〜99へ欠番なしで保存します。自動移行は行いません。

CD-ROM2 VN buildでは、同一ビルドから参照できる正式上限をADPCM 2048件、BG 1024件、Sprite 1024件、Sprite Animation合計1024件、System Card PSG package variant 512件、ゲーム用CD-DA 97本（Track 3〜99）とします。PSG variantは`assetId`と再生channelの組ごとに1件で、参照PSG source asset自体も512件までです。これはCD容量、1 assetのサイズ、Spriteの同時表示4 slotなどとは別の上限です。CD-DA以外の未参照assetは数えません。BG / Sprite / ADPCM / CD-DA metadata、Sprite Animation metadata、System Card PSG metadata/package、scene pack、BG/Sprite/ADPCM payloadは2048-byte境界で`vn_payload.bin`へ集約し、論理sector aliasで読み込みます。警告音声とゲーム用CD-DA音声trackはpack対象外です。詳しい数え方と個別制約は[pce-vn-large-project-limits.md](pce-vn-large-project-limits.md)を参照してください。

CD-ROM2 VNのビルドは、ランタイム常駐bank128/129/130とbank124 logic overlayにそれぞれ最低1024 bytesの更新余白を予約します。スクリプトや機能追加でこの余白を割る場合は、実際の8KB overflowを待たずにbank名・使用量・空き・必要空きを含むheadroom errorとして停止します。これは素材数の上限ではなく、エンジンコードの配置退行を早期検出するための安全ゲートです。

`Sprite`（立ち絵）コマンドの主なプロパティは次のとおりです。

すでに同じ最終表示状態にある `BG` / `Sprite` コマンドは、CD-ROM2・HuCARD runtime とスクリプト再生プレビューで no-op になります。BG は asset と tile 座標、Sprite は Slot・visible・asset・座標・反転・Animation がすべて一致すると、VRAM/SATB の再描画をせず、BG の fade-out / fade-in も行いません。座標・反転・Animation が違う場合や、Sprite Move 中、`blank` や Full BG の復帰などで実表示を再構築する必要がある場合は、従来どおりコマンドを実行します。

- **Slot（0〜3）**: 立ち絵を表示する 4 枚のスロットのどれを使うか。VN runtime は同時に最大 4 枚の立ち絵を持ち、スロットごとに 1 枚を保持します。同じスロットへ別の `Sprite` コマンドを置くと、その 1 枚を差し替え（`visible: false` なら非表示）します。別々のスロットを使えば複数の立ち絵を同時に出せます。通常シーン間では表示中のスロットを保持するため、消したい場合は同じスロットへ `visible: false` の `Sprite` コマンドを置いてください。複数表示するときは **Slot 0 から順に**使ってください。runtime は BG 直後にメッセージ用 VRAM を置き、その末尾から SATB 手前までを連続したスプライト pattern 領域として使います。表示中のSLOTは番号順に並べて、この連続領域と palette bank へ非重複配置します。`Message` の **Mouth slot** はここで表示したスロット番号を指すので、口パクさせたい立ち絵はあらかじめ目的のスロットへ出しておきます。`Sprite` コマンドの **Slot** は必須ですが、`Message` の **Mouth slot** は任意で、ナレーションでは **なし（ナレーション）** を選べます。
- **Animation**: その立ち絵アセットの `options.animations`（Sprite エディタの ROW 定義）から再生するアニメーションを選びます。`default` 以外を選ぶと、ゲーム実機と同じく該当 ROW のフレームを `frameDelays`（未指定時は `frameDelay`）間隔で巡回（ループ）します。

`Sprite Move` は、すでに表示中の Slot を Target X/Y へ指定フレーム数で直線移動します。既定は同期で、移動完了まで後続コマンドを実行しません。**async（同時移動）**を有効にすると後続へ直ちに進むため、別々の Slot に続けて指定して最大4枚を同時に動かせます。Animation は「変更しない」が既定で、指定した場合は移動開始時に同じsprite asset内のROWへ切り替えます。同じ Slot への新しい `Sprite Move` / `Sprite`、scene切替、`blank` は先行移動を中止します。座標は X=`0..319`、Y=`0..223`、Frames=`1..65535`です。Full BG sceneでも、そのscene内で表示したspriteに使用できます。

右列のプレビューは、`BG` / `Sprite` などの画像系コマンドを選ぶと **256×224 のゲーム画面**として表示し、その時点までの背景・立ち絵の配置（背景は tile 座標、立ち絵はピクセル座標）を実際のレイアウトで確認できます。`Sprite` コマンドで指定した **Animation** はプレビュー上でもゲーム実機と同じフレーム切り出し・コマ送りで再生されるので、ROW 定義どおりに動くかをその場で確認できます。選択中コマンドが置いた要素は枠線でハイライトされます。スクリプト再生プレビューでは `BG` の Fade 演出も再生し、右上の debug 表示で定義済み変数の現在値、visual RAM cache / ADPCM RAM / scene pack の使用量見積もりを確認できます。大量シーン・大量音声を含むプロジェクトでも全参照assetを開始時にData URLへ展開せず、実行する`BG` / `Sprite` / 音声commandに必要なassetだけをプレビューウィンドウへ遅延ロードします。

`Message` コマンドを選ぶと、同じゲーム画面上にメッセージ領域（17 文字 × 4 行、画面下部から 1 タイル上のゲーム実機と同じ位置）を重ねて表示します。ボタン送り待ちでは 4 行目の最後の 1 文字を `▼` の点滅カーソルとして使うため、本文として使える文字数は 1〜3 行目が 17 文字、4 行目が 16 文字です。話者を指定した場合は `話者：` を 1 行目に即時表示し、次の行から本文を表示します。**▶ 再生** ボタンで設定した表示速度（typewriter）で再生し、`ADPCM` ボイスがセットされていれば同時に再生して確認できます。本文に改行を入れると、ゲーム実機と同じく強制改行されます（1〜3 行目は 17 文字、4 行目は 16 文字での自動折り返しと併用）。

`Choice` の上下移動は、CD-ROM2版とHuCARD版のどちらも矢印カーソルだけを更新します。表示済みの選択肢文字列やメッセージ領域全体は描き直さないため、文字欠けや全体再描画のちらつきなしに選択できます。

`Message` コマンドには次の設定もあります。

- **文字色**: 「指定」チェックを入れると本文（と話者名）の色を変更できます。カラーピッカーまたは `#rrggbb` の hex で指定でき、入力した色は PCE で表示可能な色（各色 8 段階）へ自動的に丸められます。未指定のときは既定の白で表示します。
- **本文を空にする**: 本文を空欄にすると、メッセージ領域をクリアした空ページになります（先頭メッセージだけは新規作成時にサンプル文言が入りますが、消せば空のまま保持します）。
- **ADPCM 同期の文字送り**: `ADPCM` ボイスをセットし、`MSG_SPEED=0`のときは、文字送り速度がボイスの再生時間に合わせて自動計算され、本文を出し終わるタイミングと音声の終わりがほぼ揃います。`MSG_SPEED=1..6`では予約変数の速度を優先します。話者行は同期計算に含めず、本文部分の文字数だけを使います。
- **ボタンでのウェイトスキップ**: `Advance` が `button` のとき、表示途中にボタンを押すと、表示済みの文字は消さずに残りの本文だけを追加描画してページ送り待ちにできます。ページ送り待ち中は 4 行目末尾の `▼` が点滅します。さらにボタンを押して次ページへ送ると、まだ鳴っている ADPCM ボイスは停止します。

`Audio`コマンドの**Kind**には`CD-DA` / `ADPCM` / `PSG`を選べます。CD VNのPSGはSystem Card driverを使い、songはmain track/BGM、SFXはsub track/SFXとして同時再生できます。HuCARD VNもBGM/SFXを別busとして扱い、同じ物理channelではSFXを一時優先して、SFX終了後にBGMを復元します。**基準 ch**（0〜5）はbuild時にshift/clamp済みpackage variantへ変換されます。`stop`では**停止対象**を`all` / `BGM` / `SFX`から選べ、未指定は`all`です。新しい再生は同じbusだけを置換します。

CD VNはgeneric VSync user IRQを登録し、各VBlankでSystem Card `PSG_DRIVE`を正確に1回呼びます。System Cardのfull graphics/VBlank handler、HuC6280 TIMER、main-thread polling、credit/catch-upは使いません。長いCD転送はdirect async loaderで進めるため、BGM/SFXは転送中もIRQ駆動を継続します。

Message voice は buffered ADPCM 専用です。ADPCM は buffered 安全上限（既定 address では 32767 bytes、または `65536 - adpcmAddress` の小さい方）以内の asset / part だけを ADPCM RAM へ読み込んで再生します。安全上限を超える ADPCM を `message.voiceAssetId` に指定すると build error になります。長い音声は分割、sample rate 低下、または CD-DA を使ってください。ADPCM 再生中に次の BG / Sprite / cache / scene などの CD data read へ進む場合、runtime は残っている voice を先に明示停止してから CD access を開始します。CD-DA 再生中にシーン変更や背景・スプライトの CD ロードが入る場合、現行 runtime は再生を停止してから CD access を開始し、自動再開しません。BGMを維持するsceneでは、BG / SpriteなどのCDロードを行うcommandをCD-DA再生commandより前に置いてください。Loop 有効の CD-DA はgeneratedの開始sectorから次track先頭（またはlead-out）の直前までをSystem Cardへ範囲指定し、その範囲だけをrepeatします。Loop 無効は同じ範囲をone-shot再生します。

`Effect` コマンドでは `fadeOut` / `fadeIn` / `blank` / `shake` / `flash` を選べます。`fadeOut` と `flash` は **色** をカラーピッカーまたは `#rrggbb` で指定でき、入力した色は PCE 表示可能色へ自動的に丸められます。`fadeOut` は指定色へ画面をフェードアウトし、`flash` は指定色で一瞬画面をフラッシュして元のパレットへ戻します。未指定時は `fadeOut` が黒、`flash` が白です。

`Input` コマンドは、指定したコントローラー入力があったときに指定ラベルへ `GOTO` する分岐です。**ボタン**は 上下左右・RUN・I・II をトグルで複数選べ（OR 条件）、**Mode** で動作を選びます。SELECTはAUTO切り替え専用なのでInputでは選べません。旧データのSELECTのみのInputは読み込み時に既定のI入力へ正規化されます。

- **sync（同期待機）**: 条件の入力があるまでその場で待ち、入力されたらラベルへ移動します。遷移先ラベルを空にした場合は、入力後に次のコマンドへ進みます。
- **async（待機開始/次へ）**: 入力待ちを保持したまま次のコマンドへ進みます。async Inputは複数並べることができ、最大7つのボタン経路を同時に監視します。同じボタンを後のasync Inputへ指定した場合、そのボタンだけ後の移動先が優先され、他のボタン経路は維持されます。
- **cancel（待機終了）**: 保持中の async 入力待ちをすべて終了します。

たとえば、`async: RUN/I → ラベル1`、`async: → → ラベル2`、`sync: ← → ラベル3`の順に置くと、RUNまたはI、右、左の3分岐を同時に待てます。asyncまたはsyncのどれか1つが成立した時点で同じ入力待ちグループはすべて解除されるため、移動後に別経路の監視が残りません。同じボタンをasyncとsyncの両方へ指定した場合はasyncが優先されます。sceneを切り替えた場合も監視は解除されます。

`SpriteText`（スプライト文字）コマンドは、「PRESS RUN BUTTON」のような短い文字列を**ハードウェアスプライト**で背景・メッセージの上に重ねて表示する演出用コマンドです。本文メッセージ（BG タイル描画）とは別系統で、文字を浮かせたり点滅させたりできます。

- **文字 / Slot / X / Y**: 表示する文字列（最大 32 グリフ、`\n` で改行）と、4 つあるオーバーレイスロットのどれを使うか、左上の画面座標（ピクセル）です。同じスロットへ別の `SpriteText` を置くと差し替え、**visible のチェックを外すとそのスロットを消去**します。
- **文字色**: カラーピッカー / `#rrggbb` で指定（PCE 表示色へ自動丸め）。**同時表示するときは 1 色**（後から描いた色が優先）になります。
- **Blink**: `0` で常時表示、`1` 以上で指定フレームごとに点滅します。CD-ROM2 / HuCARDのどちらでも同じVBlank単位で動作します。

SpriteTextの見える字形は本文と同じ12×12pxで、横12px・縦16pxピッチです。PCEの最小スプライトセルは16×16なので、字形を2pxの透明余白で中央に置き、隣の文字を12px間隔で重ねて配置します。ハードウェアの制約として、スプライト文字は立ち絵と同じ **SATB（最大64個）/ 1走査線16個**を共有します。CD VNは表示時にSystem Card `EX_GETFNT`の12×12 glyphを取得して4bpp化し、必要なpatternだけをVRAMへuploadします。VRAMはシナリオ内のSpriteTextが実際に使う固有glyph数（最大64）だけを予約するため、未使用分が立ち絵pattern領域を圧迫しません。`font_sprite.bin`や起動時一括転送はありません。

`Message` コマンドの **Mouth slot** は、メッセージ表示中に立ち絵の口を動かす（口パク）ための設定です。messageごとの **Mouth animation** 指定はありません。使うには次の手順が必要です。

1. 立ち絵（Sprite）アセット側で、通常ROWの直後に口パクROWを置きます。例: `default`, `mouth`。口パクROWは複数フレームにし、口を回し続けたい場合はループを有効にします。
2. その `Message` より **前に** `Sprite` コマンドを置き、対象の立ち絵をいずれかのスロット（0〜3）へ表示（visible）しておきます。
3. `Message` コマンドの **Mouth slot** に手順 2 と同じスロット番号を指定します。ナレーションなど立ち絵と紐づかないmessageでは **なし（ナレーション）** を選びます。

メッセージ開始時に、指定slotの現在animation ROWから同一sprite asset内の次ROWへ切り替わります。本文表示が完了して入力待機へ入るか、CD one-shot ADPCM音声が自然終了すると、先に到達した時点で元ROWへ自動復帰します。スロットに立ち絵がない、現在ROWが最終ROW、または次ROWが別sprite assetに跨ぐ場合は無効（口パクなし）です。手動で通常ROWへ戻す`Sprite`コマンドは不要です。

CD VNの本文はlength付き16-bit Shift-JISでscene pack v3へ保存され、printable ASCIIは全角JISへ正規化されます。許可文字は日本版v3の非漢字領域とJIS第一水準だけです。第二水準、CP932拡張、半角カナ、絵文字、結合文字はscene/command位置付きbuild errorになります。runtimeは`EX_GETFNT`の12×12出力を24-byte maskへ変換し、68-glyph cacheで必要時に再利用します。`font.bin`は生成しません。

ノベル編集画面の**フォント**タブで管理するTTF/OTF設定はHuCard VNとエディタpreview用です。CD VNのゲーム生成物には反映せず、System Card内蔵glyphを正とします。BIOS由来glyph byteや画像をprojectへ保存する機能はありません。

### 1 シーンのメモリ（scene pack）インジケータ

ゲームは実行中、表示中の1シーン分をactive scene packとして参照します。上限はCD VN・HuCard VNともに**8192 bytes**です。CD VNはRAM cacheへ読み込み、HuCard VNはbanked ROMを直接参照します。Novel editorは`project.json`のtarget/builderを読み、対応するencoding（CDは16-bit Shift-JIS、HuCardはglyph index stream）でbyte数とゲージを表示します。

- 85% 以上になると黄色の警告（残りバイト数を表示）
- targetごとの上限を超えると赤いエラー（超過バイト数とシーン分割の案内）

を出します。Scenes 一覧でも、上限に近い／超過しているシーンに割合バッジ（`92%` や `⚠ 超過`）が付きます。超過したシーンは `Jump` コマンドで別シーンに分割すると解消できます（この表示はエディタ上の見積りで、最終的な判定はビルド時に行われます）。

コマンドを選択すると右側にプレビューが出ます。**`Cache` コマンドを選ぶと、対象に指定した画像（BG / スプライト）アセットのイメージがプレビュー表示**され、どの画像データを対象にしているか一目で確認できます（ADPCM 対象や対象未指定の場合は従来どおりテキスト表示）。

スクリプトコマンド一覧と左側の **Commands パレット**は、コマンドの**分類（表示 / テキスト / 変数 / 分岐 / 制御 / 音声 / 演出 / メモ）ごとの固定色**で色分けして表示します。一覧の各行はその分類色で塗られ（文字色は自動で読みやすい黒/白を選択）、パレットでは分類見出しと各コマンドの左端ストライプが同じ色になるので、目的のコマンド種別を一目で見つけられます。この色分けはエディタ表示専用で、ビルドやプレビュー実行・シーンメモリには影響しません。

スクリプトコマンド一覧の GUI ヘッダーには **シーン内コマンド検索**があります。コマンド種別名、参照しているアセット名 / ID、メッセージ本文や選択肢ラベルで現在のシーンのコマンドカードを部分一致で絞り込めます。検索は表示フィルタのみで、コマンドの順序や保存内容は変更しません。

各コマンドカード左端のチェックボックスは、デバッグ用の一時 **Skip** フラグです。チェックしたコマンドはカードがグレーアウトされ、VN スクリプト生成時の scene pack / フォント文字収集 / 参照アセット収集から除外されます。シーンプレビュー再生でも同じように実行されません。フラグはプロジェクトファイルに保存されますが、ランタイムには出力されないエディタ用の制御です。

**`Comment`（コメント）コマンド**は、スクリプトに**エディタ専用のメモ**を残すためのコマンドです。ビルドやプレビュー実行には一切含まれず（シーンメモリも消費しません）、プロジェクトファイルには保存されて次回も残ります。コメントには**メッセージ文**を設定でき、スクリプトコマンド一覧では「メモ」分類の**固定色**（文字色は自動で読みやすい黒/白を選択）で表示されるので、章の区切りや作業メモを視覚的に目立たせられます。以前は任意の背景色を指定できましたが、分類ごとの色分けに統一したため、背景色は固定になりました。

シーン編集画面右上の **▶ プレビュー** ボタンで、表示中のシーンを起点に疑似ゲーム画面を別ウィンドウで再生できます。キーボードは **方向＝↑↓←→、RUN＝SPACE / ENTER / S、SELECT＝Shift / A、I＝Z、II＝X** として使います。SELECTはAUTOのON/OFF専用です。`Input` のsync / async、メッセージ送り、選択肢、Wait、音声、演出、SpriteText、Skip済みcommandも簡易再生へ反映します。

メッセージは実機と同じ17文字×4行レイアウトで、**Text color**と**Mouth slot**も反映します。Mouth slot指定時は現在ROWの次ROWへ切り替え、本文表示完了またはADPCM終了で元ROWへ戻ります。下部バーの **早送り** は本文を即時表示しますが、この時も入力待機へ入る時点で通常ROWへ復帰します。DebugのVariables欄には`AUTO_ENABLE` / `MSG_SPEED`、Cache欄にはvisual RAM cache、ADPCM RAM、PSG pattern buffer、active scene packの見積りを表示します。Cache表示は実機RAMの読み返しではなく、generated metadataとcommand順に基づくシミュレーションです。

プレビュー内では実機ランタイムに合わせ、CD-DA と PSG BGM（`psg-song`）を排他再生します。PSG BGMを開始すると再生中のCD-DAを停止し、CD-DAを開始すると再生中のPSG BGMを停止します。PSG SFXはこのBGM排他の対象外で、PSG BGMと同時に発音できます。`Audio stop` の対象をBGMまたはSFXにした場合は、指定したPSGバスだけを停止します。

## Build

`Build` は現在の project 設定と有効な builder plugin を使って ROM / CUE を生成します。Super CD-ROM2 project では `.cue` と `.iso`、必要に応じて CD-DA track WAV や Test Play 用 zip が `out/` に作られます。

CD-ROM2 buildは、Track 1 AUDIO（必須警告音声）、Track 2 MODE1/2048（Game Data、`PREGAP 00:03:00`）、Track 3以降 AUDIO（ゲーム音声、Track 3だけ`PREGAP 00:02:00`）の順でCUEを生成します。警告WAVの長さを`warningSectors`とし、Track 2の絶対開始LBAは常に`warningSectors + 225`です。scene pack、画像、sprite、ADPCM、PSG、asset metadata、overlayを含む全CD参照は同じ値だけシフトされます。警告音声とゲーム音声は44.1kHz・stereo・16-bit PCMへ変換し、PCM末尾を2352-byte CD audio sector境界まで無音で埋めます。

ゲーム用CD-DAが1本以上ある場合だけ、`pce-mkcd`がISO末尾へ付ける150個のzero sectorを安全確認後にISOから外し、Track 3の2秒pregapとしてCUEへ移します。期待した150 zero sectorが見つからない場合はnon-zero dataを削らずbuild errorで停止します。ゲーム用CD-DAがない場合はTrack 1/2だけを生成し、ISO末尾を変更しません。

CD-Rへ書き込むときは`.iso`単体ではなく、`out/`のCUEを入口にして、CUEが参照する`track01_cdda_warning.wav`、ISO、Track 3以降のWAVを同じ構成のままDisc-at-Once対応ソフトへ渡してください。書き込みソフト側でtrack順、pregap、data/audio種別を追加変更しないでください。最終的なCD-RとPCエンジン実機での再生確認はエミュレーター/Test Playとは別の外部確認項目です。

CD-ROM2 / HuCARD のVN builderを使う場合、`Build` と `Test Play` はNovel画面のGUI / JSON編集状態を先に `assets/pce-vn-scenes.json` へ保存し、その完了後にbuilderを起動します。AudioのAsset選択などを変更した直後でも、画面上の最新値がビルド対象になります。保存に失敗した場合は古いsceneで続行せず、ビルドを中止してエラーを表示します。

Build Log には `VN generation`、`asset source generation`、`compile/link ELF`、`VN overlay extraction`、`PCE-CD padding update`、`PCE-CD ISO assembly`、`PCE-CD disc layout normalization` の各段階の所要時間が表示されます。ビルドが長い場合は、この timing 行で VN スクリプト生成、画像/音声アセット生成、llvm-mos link、ISO 作成、mixed-mode track境界の正規化のどこが重いかを切り分けてください。

Test Play は直前の出力を残したままビルドします。VN シーン、アセット定義、フォント、runtime template、CD data file のサイズが前回から変わっていない場合は `assets/generated/vn/build-stamp.json` を使って VN スクリプト生成をスキップし、Build Log に `VN generation skipped: inputs unchanged` と表示します。さらに生成後の `src/`、CD data、ツール設定、ビルド引数、出力 ROM/CUE/ISO が `out/build-stamp.json` と一致する場合は clang/link/mkcd も起動せず、`Build skipped: inputs unchanged` と表示して既存出力をそのまま Test Play に渡します。通常の Build や入力変更後の Test Play は、スタンプを更新するためフル生成します。

## Export

`Export` は最後に成功した **HuCard** Build 出力だけを保存します。新しくビルドは実行しないため、内容を更新したい場合は先に `Build` を押してください。CD-ROM2 project は System Card / IPL を必要とする配布境界を避けるため、Export の対象外です。

- **HuCard ROM**: `.pce` を保存します。
- **itch.io HTML5 ZIP**: Setup 済みの EmulatorJS runtime、`mednafen_pce` legacy core、HuCard ROMを `index.html`、`data/`、`rom/`、`LICENSES/`、`SOURCE.md` として ZIP にまとめます。CD-ROM2 のゲームデータ、System Card、IPL は含めません。

この ZIP は単一 HTML ではなく、itch.io が HTTP で配信する HTML5 game 用です。ZIP を展開せずに itch.io の HTML game としてアップロードしてください。`index.html` は ZIP のルートにあり、内部参照は同梱ファイルへの相対パスです。ローカルの `file://` ダブルクリック起動はサポート対象ではありません。itch.io の HTML5 upload では、ZIPのルートに `index.html` を置く必要があります。詳しくは [itch.io の HTML5 upload documentation](https://itch.io/docs/creators/html5) を参照してください。

生成 ZIP の `LICENSES/EmulatorJS-GPL-3.0.txt` には Setup 済み EmulatorJS の GPL-3.0 license text、`LICENSES/mednafen_pce-GPL-2.0-only.txt` にはcoreのGPL-2.0本文、`LICENSES/NOTICE.txt` には再配布時の注意を入れます。`SOURCE.md` は同梱 runtime/core の版、source repository、core dataのSHA-256、および公開すべき source archive の内容を記録します。**ライセンス本文、NOTICE、SOURCE.mdだけでは対応ソース提供義務を満たしません**。公開者は、同じ itch.io game pageで `ゲーム名-source.zip` を別ダウンロードとして公開し、同梱した正確な版に対応する完全なソース、ライセンス表示、必要な改変内容とビルド手順を GPL 条件に従って提供してください。PCE Game Editor 本体のリポジトリには EmulatorJS runtime/core のソースや System Card を同梱しません。

## Test Play

Test Play は Plugins 画面の `Test Play` role で選択した plugin が担当します。

### 標準エミュレーター

`標準エミュレーター (EmulatorJS)` は、Setup 済みの EmulatorJS `mednafen_pce` core でエディター内の Test Play window を開きます。HuCard と Super CD-ROM2 の通常確認に使えます。

Super CD-ROM2 / ADPCM を含む project では、Geargrafx などの外部エミュレーターでは正常でも、標準 EmulatorJS/WASM 側だけ ADPCM 再生後のメッセージ送りが止まることがあります。この場合は ROM 自体の不具合と決めつけず、外部エミュレーターでも確認してください。

### 外部エミュレーター

`外部エミュレーター` は、Project Settings に設定したアプリへ生成済み ROM / CUE パスを渡して起動します。Geargrafx など、実機寄りの確認に使うエミュレーターを直接起動したい場合に選択します。

使い方:

1. Plugins 画面で Test Play plugin を `外部エミュレーター` にします。
2. Settings 画面の `外部エミュレーター` で `起動パス` を設定します。
3. 必要なら `追加パラメータ` を設定します。
4. Build 後に `Test Play` を押します。

`起動パス` は macOS の `.app` bundle か実行ファイルを指定できます。macOS では既定値として `/Applications/Geargrafx.app/Contents/MacOS/geargrafx` が入ります。`.app` bundle を指定した場合も、起動時に `Contents/MacOS` の実行ファイルへ解決してから ROM / CUE パスを渡します。

`追加パラメータ` に `{rom}`、`{romPath}`、`{file}`、`%ROM%` のいずれかを書くと、その位置へ生成済み `.cue` / `.pce` のパスを挿入します。placeholder を書かなかった場合、ROM / CUE パスは末尾へ自動追加されます。

例:

```text
--fullscreen {rom}
```

外部エミュレーター側のキー設定、セーブステート、画面サイズなどはエディターではなく起動先エミュレーター側の管理になります。

## アセットの登録と整理

- **ADPCM は buffered playback 専用です。** Sound > ADPCM には Streaming 指定はありません。ADPCM asset は buffered 安全上限（既定 address では 32767 bytes）以下に収めてください。新規取り込みの標準 sample rate は 8000Hz で、16000Hz の約半分のサイズになり CD 読み込み負荷を抑えます。音質を優先する声だけ Sample rate を 10666Hz や 16000Hz へ上げてください。長いボイスは `splitPolicy: "auto"`、sample rate 低下、または CD-DA 化を検討してください。ADPCM address と divider は通常編集する必要がないため Sound > ADPCM には表示せず、address は既定値、divider は sample rate からの自動値を使います。大量の音声素材は ADPCM asset として管理し、CD-DA は曲や長尺 BGM など少数の物理 track 用に残すのが安全です。
- **多数の PCM WAV は CSV から一括登録できます。** `Sound > ADPCM > CSV一括` または統合 `Assets > AD CSV` を押し、UTF-8 の CSV を選びます。確認画面には行番号、ID、source、sample rate、予想 part 数、既存 ADPCM の置換対象、警告、エラーが表示されます。エラー行が混ざっていても有効行だけ実行でき、失敗した行の後も処理を続けます。キャンセルは現在処理中の1行を保存した後で残りを止め、それまでの成功を保持します。同じ ID の既存 ADPCM は置換されますが、画像・sprite・PSG・CD-DA など別種 asset は保護され、その行だけエラーになります。2048件を超える登録も可能ですが、CD VNから同一ビルドで参照できるADPCM上限は2048件です。自動分割されたpartも1件ずつ数えるため、確認画面の警告を確認してください。

  ```csv
  source,id,name,sampleRate,loop,splitPolicy
  voices/akari/line001.wav,akari_001,voice/chapter1/akari001,8000,false,auto
  "voices/mika/line,002.wav",mika_002,voice/chapter1/mika002,10666,0,error
  ```

  `source` と `id` は必須です。`source` は絶対パス、または CSV のある folder からの相対パスで、PCM WAV のみを指定します。`id` は英数字・`_`・`-` の1〜48文字です。`name` は省略時に WAV のファイル名になります。`sampleRate` は `4000, 4571, 5333, 6400, 8000, 10666, 16000, 32000` のいずれか（既定8000）、`loop` は `true/false/1/0`（既定false）、`splitPolicy` は `auto/error`（既定auto）です。`auto` は32767 bytesを超える音声を `<id>_part01`, `<id>_part02`, ... へ分割しますが、part は自動連続再生されません。MP3、trim、normalize、音量、fade は一括取込の対象外なので、必要な加工を事前に WAV へ焼き込んでください。
- **アセットの Name に `/` を含めると、アセット一覧がフォルダーのようにグループ化されて表示**されます。例えば `voice/akari` `voice/mika` は「voice」グループにまとまり、`voice/chapter1/intro` のように複数の `/` を使えば入れ子のグループになります。展開時はフォルダー見出しとアセット名が同じ Name のツリー軸に並び、子フォルダーと leaf 行が階層ごとに一段ずつインデントされます。グループ見出しをクリックすると開閉でき（親を閉じると配下のサブグループも畳まれます）、統合アセット一覧では検索中に一致が隠れないよう自動的に全展開します。`/` を含まない Name はそのまま一覧の最上位に並びます（グループ化は表示上の整理で、保存される Name やビルド結果は変わりません）。このグループ化と開閉は、統合アセット一覧だけでなく **背景（BG）/ スプライト / ADPCM / CD-DA の型別エディタの一覧でも同様**に使えます。
- **統合アセット一覧は Name → Type → Source の列順**で表示し、Name と Type の列見出しをクリックしてソートできます。クリックするたびに 昇順 → 降順 → 手動（ドラッグ並び）の順で切り替わります。ソート中もグループ化は維持され、フォルダー内のアセットが選んだキーで並びます。型別エディタの一覧も各列見出しでソートできます。
- **BG / Sprite の visual payload は raw で扱われます**。旧プロジェクトに残る圧縮メタは読み込み時に互換情報として扱われますが、現在の CD-ROM2 build は `tiles.bin` / `map_vram.bin` / `patterns.bin` を生成します。`Cache Load` の BG / Sprite は低位 System Card RAM の visual cache へ先読みし、表示 command 実行時に cache hit すれば CD read なしで VRAM / BAT へ転送します。cache miss または evict 済みの場合は、従来どおり CD から scratch buffer へ読みながら VRAM へ転送します。
- **PSG（Sound タブの PSG）は `新規` で効果音デザイナーを開いて音を作るほか、`取込` で `*.psg.json` / VGM / VGZ / MIDI ファイルを登録**できます（拡張子で自動判別）。PSG JSONは作曲済みstep patternを再量子化せず読み込み、VGM/MIDIはBPMから決まる16分音符グリッド（最大4096 steps / pattern最大2048 events）へ量子化します。取込画面では試聴、ID、Name、Song/SFX、master volume、BPM・小節・section・channel/event数を確認できます。同一IDがある場合は「置換」を明示的にチェックするまで保存しません。PSG 一覧には `PSG JSON取込` / `MIDI取込` / `VGM取込` / `エディタSFX` などのタグが付き、取込で追加したアセットか、エディタ上で作成した効果音かを見分けられます。PSG タブの **再生/停止** はトグル式の WebAudio プレビューで、音程・リズム・noise を確認するためのものです。ノイズは実機 PSG と同じ **LFSR（5bit ノイズ周波数で音程が決まり、値が大きいほど高く明るい）** で鳴らします。System Card内蔵tone waveはWebAudioのsine/saw/triangle/squareへ大まかに分類して試聴します。CD VNはSystem Cardの実波形を使い、HuCARD VNは同じ分類の32-sample波形をruntimeで生成するため、音程と音色差の確認には使えますが、最終的な波形とミキサー特性はGeargrafx/実機で確認してください。PSG 一覧の `×` で選択したアセットを削除できます。各 PSG アセットには **Volume（全体音量 0〜100%）** を設定でき、パターン全ステップの音量をまとめてスケールします（デザイナー製・取込済みの両方で有効。プレビューと実機ビルドの両方に反映されるので、ADPCM / CD-DA との音量バランス調整に使えます）。デザイナーの **音量 / 終了音量** スライダーが効果音内のエンベロープ（鳴り始め〜減衰）で、**Volume** はアセット全体の最終音量、という役割分担です。
  - **PSG JSON（`*.psg.json`）**: 正式形式は`version: 2`で`assets`が1件だけ、typeは`psg-song`または`psg-sfx`です。BPM 30〜300、steps 1〜4096、channel 0〜5、period 1〜4095、event volume 0〜31、wave 0〜45を範囲内で指定し、noise eventはch4/5だけに置きます。同一step/channelの重複、曲長以上のstep、pattern 2048 events超過、範囲外値は自動補正されず取込エラーになります。元JSONは`assets/psg/<id>.psg.json`へそのまま保存され、MIDI/VGM由来の量子化versionを持たない手作りPSGとしてHuCARDとSuper CD-ROM2の両方へ変換されます。
  - **効果音デザイナー（`新規`）**: PSG に詳しくなくても簡単な効果音を作れる画面です。**コイン / ジャンプ / レーザー / 爆発 / ヒット / パワーアップ / セレクト / 警告**などのプリセットから始め、**波形（トーン / ノイズ）**・**開始/終了ピッチ（またはノイズ）**・**長さ**・**速さ**・**音量 / 終了音量**・**減衰**・**ビブラート**をスライダーで調整します。**🎲 ランダム**で新しい音を引き当て、**少し変える**で今の音を微調整できます。スライダーを動かすたびに自動で試聴し、`保存` で psg-sfx アセットとして登録します。デザイナーで作った音は常に常駐（CD ストリーミング不要）になるよう **31 ステップ（pattern event 32 以下）に収まる長さ**で生成されるため、`Audio`(Kind: PSG) コマンドから即座に鳴らせます。保存後に同じアセットを選ぶと、同じスライダー値から続けて編集できます。デザイナー自身が生成するのはトーン（wave 45の矩形波）とノイズの2種類です。MIDI取込が生成するwave 0〜44は別途対応し、CD VNではSystem Card内蔵波形、HuCARD VNでは近似波形として再生します。
  - **VGM / VGZ**: PC Engine（HuC6280）PSG レジスタ書き込みをそのまま量子化します。Type「自動」はループ情報で song / SFX を判定。波形・LFO・ノイズ・DDA は音程として近似されます。取込済みアセットは内容が複雑なため、PSG タブでは読み取り専用のパターン概要として表示されます（デザイナー編集の対象外）。
  - **MIDI（.mid / .midi）**: 完全再現はできないため近似します。既定は聞き取り優先で、**tone は最大 4 voice**、**採用した発音はPSG最大振幅31**、**小さい velocity は無視**、過密時は bass と高音 melody を残します。元velocityは足切りとvoice優先順位に使い、通常のMIDI強弱を5bit振幅へ線形縮小しないため、低音量になりません。ドラム（10ch）は既定で **ch5 の PSG ノイズ**に変換します。Program Changeは発音開始時に読み取り、GM Programを16ファミリーへまとめてSystem Card内蔵waveへ割り当てます。取込ダイアログの **Timbre allocation** でこの方式と従来の矩形波（wave 45）を切り替え、詳細欄では各GMファミリーをwave 0〜45へ個別に割り当てられます。既定のファミリー順（Piano、Chromatic Percussion、Organ、Guitar、Bass、Strings、Ensemble、Brass、Reed、Pipe、Synth Lead、Synth Pad、Synth Effects、Ethnic、Percussive、Sound Effects）のwave番号は `[9, 22, 20, 5, 10, 8, 13, 14, 11, 1, 35, 6, 30, 24, 21, 28]` です。0〜44はSystem Card内蔵、45は従来の矩形波です。HuCARD VNでもwave番号は保持されますが、0〜44はSystem Card ROMの実波形ではなくsine / saw / triangle / squareへ近似されます。ほかにtone voice数、ドラム/noiseのOff/Soft/Full、tone/drum音量、最小velocity、voice優先順位（Melody+bass / High / Low / Loud）、Pattern detail（Auto / Full / 1/2 / 1/4 / 1/8）を調整でき、取込前に同じ設定で結果を試聴できます。Pattern detailのAutoはpattern eventが2048を超える場合だけ更新密度を落とし、曲の末尾まで残すことを優先します。**ピッチベンド／コントロールチェンジは再現されません**。BPMを空欄にするとMIDIのテンポを使います（テンポ変化が複数ある曲は最初のテンポでグリッドを固定し、警告を表示）。Type「自動」は曲（song・ループ）として登録します。保存済みMIDI assetはMIDI importer versionが古ければ次回buildでsource MIDIから現行の音量・音色割り当てへ再変換されます。

## ADPCM 確認時の注意

ADPCM の音質や再生後の進行確認では、次の順で切り分けると安全です。

1. Build し直して generated ADPCM が最新か確認します。
2. 標準エミュレーターと外部エミュレーターの両方で確認します。
3. 外部エミュレーターで正常、標準エミュレーターだけ停止する場合は、標準 WASM core 側の制約として扱い、外部エミュレーターでの動作を優先して確認します。

ADPCM は VN runtime / editor ともに buffered playback 専用です。Streaming 再生のチェック項目はありません。build は buffered 安全上限を超える ADPCM asset を拒否します。メッセージボイスは build が自動挿入した `Cache Load ADPCM` で事前に ADPCM RAM へ読み込み、可視 glyph を描く前にSystem Card BIOS再生を開始します。分岐やADPCM cache操作がないscene冒頭の最初のボイスは、message直前ではなくscene先頭へcache loadを前倒しします。以降のmessageで別ADPCMへ切り替える場合は、その時点でADPCM RAMを読み替えます。buffered playbackは実データ長と `ONE_SHOT` / `REPEAT` をBIOSへ渡し、one-shotの自然終了時にはstatus pollingや追加stop/resetを行いません。runtimeの実VBlank frame counterはmessage/口パク/AUTOの状態管理だけを行います。
