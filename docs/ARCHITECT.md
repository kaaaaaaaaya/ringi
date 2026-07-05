# Ringi アーキテクチャ

このドキュメントはRingiの技術アーキテクチャを、**現在実装済みの部分**と**設計のみ確定した将来部分**に分けて記録する。実装の詳細な経緯・前提・レビュー記録は docs/office-hours/ を参照。UI/デザインの決定は DESIGN.md を参照。

---

## 1. 全体像

[AI Agent 実行]
      │
      ▼
┌─────────────────────────────────────────────┐
│  Ringi（私たちのインフラ）                     │
│                                               │
│  ① Charter評価（実装済み）                     │
│     tool-call + Charter(ルール) → Verdict     │
│                                               │
│  ② Charter準備（設計のみ、未実装）              │
│     Notion / ダッシュボード → MD/CSV → Charter │
└─────────────────────────────────────────────┘
      │
      ▼ output = Verdict + Receipt
[Agent が受け取る]

---

## 2. 実装済み: Verdict API（判定コア）

### コンポーネント

| コンポーネント | ファイル | 役割 |
|---|---|---|
| Charter評価 | src/lib/charter.ts | tool-call を Charter ルール群と照合し、APPROVE/BLOCK を決定論的に判定する（LLM不使用） |
| Verdict API | src/lib/verdict-api.ts | Charter評価を実行し、失敗時はfail-closed（BLOCK）、Receiptを生成して返す |
| Receipt | src/lib/receipt.ts | 自己完結型の判定証跡。Agentへは直接返却、DBにも別途保存する（後述） |
| Agent hook | src/lib/mcp-hook.ts | 任意のツール実行関数をラップし、実行前にVerdictを取得する |
| HTTPエンドポイント | src/app/api/verdict/route.ts | POST /api/verdict |

### データフロー

POST /api/verdict { tool_name, params }
        │
        ▼
evaluateCharter(toolCall, rules)
        │
   ┌────┴────┐
   ▼         ▼
 不一致        一致
APPROVE(デフォルト)   BLOCK
（どのルールにも   （配列順で最初に一致した
 一致しない）      ルールのactionに従う。
                 BLOCKともAPPROVEともなり得る）
   │         │
   └────┬────┘
        ▼
createReceipt(verdict)
        │
        ├─────────────────────────────┐
        ▼                             ▼
{ verdict, receipt,             DBへ保存（非同期・fire-and-forget）
  receipt_markdown, latency_ms }      │
        │                             ▼
        ▼                       人間が後から一覧・監査
[Agent が直接受け取る]           （ノウハウとして蓄積）
（DBを経由しない）

### 設計判断: ReceiptはDBにも保存する（Agentへの応答はDBを経由しない）

**決定:** Receiptは使い捨てではなく、Postgresにも保存する。ただし POST /api/verdict のレスポンスとしてAgentに返す経路はDB書き込みを経由しない直接返却で、DB保存は付随的な書き込み。

**理由:** 当初「Receiptはagentに渡すだけで使い捨てでよい」という方針でDB依存を排除したが、「人間が見返せる」「ノウハウとして蓄積される」という価値の方が優先されると判断し直した。Agent側のレスポンス経路にDBを挟まないのは、DB書き込みの遅延・障害がAgentへのVerdict返却をブロックしないようにするため（可用性はここで確保する）。

- Agentへの応答: createReceipt(verdict) → 直接レスポンス（DB未経由、これまで通り低レイテンシ）
- 人間向けの蓄積: 同じReceiptをDBにも書き込む（非同期。書き込み失敗してもAgentへの応答には影響しない）
- 失うものはなくなった: 「過去の判定ログを後から一覧・監査する」機能（Audit Console的な使い方）が復活する
- ハッシュチェーン（過去のReceiptとの連鎖による改竄検知）を採用するかは別問題（本ドキュメントでは未決定。単体hashのみで運用するか、チェーンに戻すかは今後の議論）

**Receiptのフィールド構成（確定）:**

| フィールド | 必要か | 理由 |
|---|---|---|
| ts | 必要 | いつ判定されたか |
| rule_id | 必要 | どのルールが適用されたか |
| action | 必要 | APPROVE / BLOCK |
| reason | 必要 | agentが次の行動を決める材料 |
| hash | 必要 | 自己改竄検知の最低限の裏付け（チェーンはないが、Receipt単体の改竄は検知できる） |
| `id`（UUID） | **要再検討** | 「使い捨て」前提では不要だったが、DB保存する以上は人間が個々のReceiptを参照するためのキーが必要になる可能性がある（DBの自動採番PKで代替できるなら引き続き不要） |

**返却形式（確定）:** JSON主体 + Markdown併記。

json
{
  "verdict": { "action": "BLOCK", "rule_id": "R001", "reason": "..." },
  "receipt": { "ts": "...", "rule_id": "R001", "action": "BLOCK", "reason": "...", "hash": "..." },
  "receipt_markdown": "## Receipt\n\n- **Timestamp:** ...\n- **Action:** BLOCK\n...",
  "latency_ms": 4.2
}

理由: 呼び出し元コード（`interceptToolCall`等）はJSONのフィールドで`action === "BLOCK"`を分岐する必要があるため、JSONが主。同時に、agent自身がこの判定結果を自分のコンテキスト（ログ・会話履歴）に渡す場合はMarkdownの方が自然文として読みやすいため、両方を返す。

---

## 3. 設計のみ確定（未実装）: Charter準備パイプライン

ユーザーの手書き図（2026-07-05）をもとに整理。**実装はせず、設計として記録する。**

### パイプライン概要

① Discovery（全探索）
   Notion / ダッシュボードAPIに接続し、全ページ・全データソースを列挙する

② Extract（構造化）
   各ページ・各データソースを個別にAIフレンドリーな中間形式に変換する
     - Notionページ → Markdown（1ページ = 1MDファイル）
     - ダッシュボードAPI → JSON → CSV

③ Consolidate（統合）
   複数ページ・複数データソースの中間形式を1つにまとめる

④ MD化（最終出力）
   統合結果をCharter評価に使えるMarkdownにする

### Notion抽出MDフォーマット（確定）

1ページ = 1MDファイル。

markdown
---
source: notion
document_id: <notion-page-id>
document_title: <ページタイトル>
extracted_at: <ISO8601>
---

# <ページタイトル>

## Facts

- <構造化された事実/ルール1>（出典: "<元の一文をそのまま引用>"）
- <構造化された事実/ルール2>（出典: "<元の一文をそのまま引用>"）

**含める（絶対に必要）:**
- frontmatterでの出典情報（`document_id` / document_title / `extracted_at`）— 誤抽出を元の文章まで追跡できるようにするため
- 各Factに元の一文を引用として添える（トレーサビリティ）

**含めない（agentには無駄と判断）:**
- Notionの装飾（絵文字コールアウト、色付けなど）
- 目次・パンくずなどのナビゲーション要素（agentは画面遷移しないので不要）
- ページ全文の逐語コピー（トークンの無駄。構造化されたFactsだけで十分）

### ダッシュボード抽出CSVフォーマット（確定）

csv
metric_name,value,unit,as_of_date
quarterly_spend_usd,482000,USD,2026-07-01

理由: 数値主体のデータはJSONよりCSVの方がLLMのトークン効率が良く、そのままテーブルとして読める。

### この先の判定への接続（未確定）

Consolidate後のMDが、実装済みのCharter評価（`evaluateCharter`）にどう接続されるかは未設計。候補:
- MDをLLMに渡してCharter JSON（`rule_id` / condition / action / `reason_template`）に変換する（旧設計にあった`charter-extraction.ts`に近い）
- MDをそのままLLMのコンテキストに含め、tool-callと合わせて都度LLMに判定させる（決定論的評価からLLM評価への転換になるため、要議論）

---

## 4. 拡張: APPROVE Receiptの企業向け詳細フィールド（設計のみ）

営業担当者・企業（バイヤー）視点で「1枚のAPPROVE Receiptだけで説明責任を果たせる」ことを目標に、答えるべき7つの問いを定義する。**現行実装（`src/lib/receipt.ts`）は最小フィールドセット（`ts`/`rule_id`/`action`/`reason`/`hash`）のままで、ここは企業向けビューのための拡張レイヤーとして設計する。**

| 問い | フィールド | 表示例 |
|---|---|---|
| 何が承認されたか | action_detail | MeetCoach AI 年間契約 $7,400 |
| 誰の代理で | agent_id + requester_id | procurement-agent-03 / 依頼者: T. Sato |
| いつ | timestamp | 2026-07-05 14:02:11 JST |
| どのルールで通ったか | rule_id + charter_excerpt_ref | pilot.vendor_cap.v2（上限 $10,000 以内） |
| どの判断基準の版か | charter_version | v2.0 |
| 予算への影響 | budget_snapshot | パイロット予算 $75,000 中 9.9% 使用 |
| この承認はいつまで有効か | expires_at + scope | 15分以内・本発注のみ有効 |

**現行の最小Receiptとの関係（未決事項）:**
- timestamp は現行の ts と同一。`rule_id` も現行フィールドと同一（`charter_excerpt_ref` を新たに紐付ける）
- action_detail / agent_id / requester_id / charter_version / budget_snapshot / expires_at / scope は現行の `Verdict`/`Receipt` 型には存在しない。追加するには ToolCall に依頼者情報を持たせる、Charterにバージョン管理を導入する、予算残高を参照する外部データソースが必要——など、Verdict API単体では完結しない依存が生じる
- expires_at / `scope`（この承認は何に対して・いつまで有効か）は、現行の「1回のtool-callに対する1回のVerdict」というステートレスな判定モデルに新しい概念（承認の有効期間・適用範囲）を持ち込む。これは今のCharter評価ロジック（`evaluateCharter`）が扱っていない領域で、設計の拡張が必要

### BLOCK版: Agentへの応答とDB保存の非対称性

**決定:** BLOCKの場合、Agentへの応答は最小限（`action: BLOCK` + 止めるべき理由のみ）。一方、DBには（APPROVEと同様に）詳細を保存する。**Agentへの応答の軽さと、DBに残す監査情報の厚みは別軸**という設計。

- **Agentへの応答（変更なし）:** { action: "BLOCK", reason: "..." } — Agentはこれだけ受け取ってツールの実行を止めればよい。詳細を読み解いて何か判断する必要はない
- **DBへの保存（新規）:** 何がブロックされたか、誰の代理で、いつ、どのルールでブロックされたかを、人間が後から監査できるように残す。`expires_at` / `scope`（承認の有効期間・適用範囲）はAPPROVE特有の概念なのでBLOCK版には含めない

| 問い | フィールド | 表示例（BLOCK） |
|---|---|---|
| 何がブロックされたか | action_detail | MeetCoach AI 年間契約 $12,000（申請） |
| 誰の代理で | agent_id + requester_id | procurement-agent-03 / 依頼者: T. Sato |
| いつ | timestamp | 2026-07-05 14:02:11 JST |
| どのルールでブロックされたか | rule_id + charter_excerpt_ref | pilot.vendor_cap.v2（上限 $10,000 超過） |
| どの判断基準の版か | charter_version | v2.0 |
| 予算への影響 | budget_snapshot | パイロット予算 $75,000 中 9.9% 使用（本件は未消化） |

- これらの詳細フィールドは全Receiptに必須ではなく、**APPROVE/BLOCKいずれもDB保存時には企業の承認者・監査者が読む場面**を想定した拡張と位置づける。Agentが直接受け取る応答の中身とは別物