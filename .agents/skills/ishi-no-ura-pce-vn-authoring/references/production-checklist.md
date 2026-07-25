# 話数制作チェックリスト

## 正本

- [ ] シリーズバイブルを読んだ
- [ ] asset台帳を読んだ
- [ ] authoring workflowを読んだ
- [ ] 現在の`pce-vn-scenes.json`と`pce-assets.json`を読んだ
- [ ] 承認済み設計を確認した

## シナリオ

- [ ] 220〜280 message
- [ ] choiceは2回、各2択
- [ ] 選択肢はチカの反応または行動
- [ ] 分岐は短く共通sceneへ合流
- [ ] 部長とレンの双方に正しい点と滑稽な点
- [ ] チカは観察と日常例でまとめる
- [ ] 現物または行動による因果応報
- [ ] 短いタグのオチ
- [ ] 恋愛、いじめ、企業攻撃なし

## イベントスチル

- [ ] 最低3枚
- [ ] 題材提示、クライマックス、タグの役割がある
- [ ] 原則として全ルートから閲覧可能
- [ ] 224×136 PNG
- [ ] 太い輪郭、ベタ塗り、少ない影段階
- [ ] 文字、ロゴ、UIなし
- [ ] キャラクター参照画像と一致
- [ ] 16色化後も顔と重要物が読める
- [ ] `pce-assets.json`へbackground imageとして登録

## JSON

- [ ] version 2
- [ ] startSceneとsettingsを維持
- [ ] logo、title、eye_catchを維持
- [ ] GAME_START jumpだけ新話冒頭へ変更
- [ ] 前話sceneを新話sceneへ置換
- [ ] 新話末尾からeye_catchへjump
- [ ] scene IDとnameが話数形式
- [ ] nextSceneIdと末尾jumpを重複しない
- [ ] episode sceneは許可commandだけ
- [ ] 話者あり3行、ナレーション4行
- [ ] 各行17文字以内
- [ ] voiceAssetIdは空
- [ ] 部長0、チカ1、レン2、ナレーションnull
- [ ] asset IDとtypeが登録済み
- [ ] すべてのjumpとchoice targetが存在
- [ ] 全分岐からeye_catchへ到達
- [ ] scene budget概算4096 bytes以内

## 実機相当確認

- [ ] PCE preview
- [ ] HuCARD build
- [ ] CD-ROM2 build
- [ ] 全選択肢をTest Play
- [ ] HuCARDでADPCM/CD-DA無音でも進行する
