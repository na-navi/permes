# permes 運用指針

## プロジェクト概要

pi-coding-agent 用の Hermes CLI 拡張。`hermes` CLI を経由して任意のモデルに接続し、`/permes` コマンドと `permes-review` レビューループを提供する。

- **リポジトリ**: `na-navi/permes` (private)
- **ローカルパス**: `projects/permes/`
- **拡張の実稼働先**: `~/.pi/agent/extensions/`（permes.ts と permes-bin/）

## アーキテクチャ

### 非同期サブエージェント方式（hermes CLI 直叩き）

`/permes` はバックグラウンドタスクとして動作し、pi の TUI をブロックしない。**Hermes TUI や tmux に依存しない。**

```
/permes <message>
  │
  ├─ 1. バックグラウンドタスク生成（タスクID発行）→ pi即座に制御を返す
  │
  ├─ 2. バックグラウンド: hermes chat -q "msg" -m model --provider provider
  │
  ├─ 3. CLI出力からセッションID + 応答テキストをパース（╭─...╰─枠内）
  │
  ├─ 4. 完了後: sendUserMessage で pi に結果を注入（レビュー指示付き）
  │
  ├─ 5. pi 自律レビュー:
  │   ├─ OK → 最終出力（ユーザーへの報告は不要）
  │   ├─ エラー → permes-review ツールで差し戻し（最大3回）
  │   └─ 判断不能 → 詳細をユーザーに報告
  │
  └─ レビュー時: hermes -z "feedback" --resume <session_id> でセッション継続
```

### 主要ファイル

| ファイル | 役割 |
|---|---|
| `permes.ts` | pi 拡張本体。`/permes` コマンド + `permes-review` ツール |
| `README.md` | 英語のインストール手順と使い方 |

### 通信の流れ

```
初回: hermes chat -q "message" -m model --provider provider
      → セッションID + 応答テキストを抽出

レビュー: hermes -z "feedback" -m model --resume <session_id>
         → 生テキストのみ（セッションID不要）
```

## /permes コマンド

### 基本使い方

```
/permes <message>              # 前回と同じモデルで質問
/permes -m grok-4.3 <message>  # モデル指定
/permes -p xai-oauth <message> # プロバイダ指定
/permes --status               # 実行中タスク一覧
/permes --result <id>          # 完了タスクの結果取得
/permes --cancel <id>          # タスクをキャンセル
/permes --reset-model          # モデルキャッシュをクリア
```

### モデルキャッシュ

- 初回: `grok-4.3` をデフォルトとして使用
- `~/.pi/agent/extensions/permes-bin/.default-model` に `model|provider` 形式でキャッシュ
- `-m` / `-p` 指定時はキャッシュを更新
- 指定なし時はキャッシュされた前回モデルを使用

### レビューループ

- `permes-review` ツールは `/permes` セッション内でのみ使用
- pi がエラーを発見した場合のみ呼ばれる（単独では呼ばない）
- 最大3回のラウンド。解決しない場合はユーザーに報告
- **piは自律的に完了判定を行う**。ユーザーに報告するのは異常・判断不能の時だけ
- レビューは `hermes -z --resume <session_id>` でセッション文脈を維持

## 開発・デプロイ

### ビルド・テスト

- TypeScript のまま動く（pi 拡張は ts-node 等不要）
- `hermes -z "test"` で CLI が動くか確認可能
- テストは実際の hermes CLI 環境が必要

### デプロイ手順

```bash
# 拡張を pi に反映
cp permes.ts ~/.pi/agent/extensions/permes.ts
# pi で /reload
```

### コミット方針

- コミット形式: 命令形、スコープ付き
  - 例: `refactor: async sub-agent architecture for /permes`
  - 例: `fix: reduce sendToGrok timeout to prevent Pi freezing`
  - 例: `docs: READMEを日本語化`
- PR は小さく。応急処置と根本解決は分ける

## 除外設定

### .gitignore（共有）

OS、エディタ、`node_modules/`、`.env` など全員が無視すべきもの。

### .git/info/exclude（ローカル専用）

個人ツール（`.pi/`、`.codex/`）、個人のメモ（`NOTES.md` など）。

**AGENTS.md は除外しない** — プロジェクトの運用ルールとして共有すべき。

## 設計上の知見（過去のイシューから）

### Issue #1: 同期ブロックによる pi フリーズ（解決済み）

- **原因**: `sendToGrok()` が `execFileAsync` で Hermes TUI の応答を同期待ちし、Node.js のイベントループを占有
- **応急処置**: タイムアウトを24時間→3分に短縮（PR #2）
- **根本解決**: サブエージェント（非同期タスク）に分離（Issue #3 → PR #4）

### Issue #6→#11: tmux 依存の除去（解決済み）

- **原因**: `hermes-send.sh` が tmux capture-pane で画面をポーリング。スクロール位置に依存、TUI 起動が前提
- **解決**: `hermes chat -q` / `hermes -z` CLI に直接通信。TUI 不要、構造化レスポンス

### レビューの自律完了判定

- `/permes` のレビュー指示で「エラーがあれば permes-review、なければユーザーに回答」と書くと、pi が何でもユーザーに報告するようになる
- **本来**: pi がゴール達成を自己判定して完結させる。ユーザーへの報告は異常・判断不能のみ
- **教訓**: レビュー指示のプロンプト設計で「どうしますか？」を排除し、pi に判断させる

### Grok への依頼のコツ

- 最初の `/permes` 呼び出しで**ゴールと TODO を明確に**してから渡すと、精度が上がる
- 設計段階で明確な条件を列挙しておけば、pi のレビュー判断も容易になる

### Hermes TUI の自動スクロール

- Hermes TUI はスクロール中は自動スクロールしない（読んでいる時に勝手に動かない正しい設計）
- 下キーで最新に戻る。hermes 拡張に自動スクロールは仕込まない

## コミット・PR の文法ルール

- URL と Issue/PR 番号の間に**半角スペース**を入れる。くっつくとリンクが切れる
  - ✅ `https://github.com/na-navi/permes/issues/8`
  - ✅ `PR #22` の後にスペース
  - ❌ `https://...#22この後ろに何か`（リンクが壊れる）

## 注意事項

### pi の作業中にディレクトリを mv してはいけない

pi のセッションはカレントディレクトリのパスがキー。ディレクトリを mv すると bash が全部死ぬ（`Working directory does not exist`）。復旧には pi の再起動とセッション選択が必要。

## 関連リソース

- **デフォルトモデル**: `grok-4.3`
- **スキル**: `gitignore-setup`（このプロジェクトから生まれた）
