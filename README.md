# LINE出退勤管理システム(Google Apps Script + LIFF)

LINEのLIFF(LINE内Webページ)から「出勤」「退勤」ボタンで打刻し、
Googleスプレッドシートに記録、打刻の都度メール通知を送るシステムです。

## 1. 全体構成

```
[LINEアプリ] → LIFF画面(Index.html)
                  │ 位置情報取得(毎回許可を要求。拒否時は打刻不可)
                  ▼
        GAS Web App (doPost / Code.gs)
              ├─ LiffAuth.gs      … LINEのIDトークンをLINEサーバーで検証
              ├─ Employees.gs     … 社員マスタから正式な氏名を取得
              ├─ Geocoding.gs     … 緯度経度 → 簡易住所(OSM Nominatim)
              ├─ AttendanceSheet.gs … スプレッドシートへ記録
              └─ Notify.gs        … 通知(現在はメール。差し替え・追加が容易)
```

## 2. ファイル一覧

| ファイル | 役割 |
|---|---|
| `appsscript.json` | マニフェスト |
| `Config.gs` | スクリプトプロパティの読み込み窓口 |
| `Code.gs` | `doGet`/`doPost` エントリーポイント |
| `LiffAuth.gs` | LIFF IDトークンの検証 |
| `Employees.gs` | 社員マスタの読み込み |
| `AttendanceSheet.gs` | 出退勤記録シートへの書き込み |
| `Geocoding.gs` | 緯度経度→簡易住所変換 |
| `Notify.gs` | 通知処理(独立関数。宛先追加・通知方法追加はここを触るだけでよい) |
| `Setup.gs` | 初回セットアップ用(シート・ヘッダー自動作成) |
| `Index.html` | LIFF画面 |

## 3. 事前準備

### 3.1 スプレッドシートを用意する

1. 新しいGoogleスプレッドシートを作成し、そのIDを控えておく
   (URLの `https://docs.google.com/spreadsheets/d/【ここ】/edit` の部分)。
2. 後述のスクリプトプロパティ `SPREADSHEET_ID` に設定後、スクリプトエディタで
   `setupSheets` 関数を1回実行すると、以下の2シートとヘッダー行が自動生成されます。

**Records シート(出退勤記録)**

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| タイムスタンプ | 氏名 | 日付 | 区分 | 時刻 | 緯度 | 経度 | 住所(簡易) | LINE UserID | 備考 |

**Employees シート(社員マスタ)**

| A | B | C | D |
|---|---|---|---|
| LINE UserID | 氏名 | 通知先メール(任意) | 有効/無効 |

> 位置情報の利用を拒否された(または取得失敗した)場合は、実際の出退勤としては
> 記録されませんが、「誰が・いつ・どのボタンで拒否したか」を区分に
> **「出勤(拒否)」「退勤(拒否)」** として同じ `Records` シートに1行残します
> (緯度・経度・住所は空欄、備考欄に拒否/失敗の理由を記録)。
> 集計時はこの「(拒否)」の区分を除外してください。

> `Employees` シートには、打刻を許可する人ごとに行を追加してください。
> - **LINE UserID**: 本人が一度LIFFにアクセスしてエラーになった際、
>   `Records` シートや実行ログに出力される値を控えて転記するか、
>   LINE公式アカウントの友だち一覧(Messaging API)から確認してください。
> - **有効/無効**: 「有効」という文字列でないと打刻できません(退職者の無効化などに利用)。

### 3.2 LINE Developersでの設定

1. 既存のMessaging API用チャネル(Channel ID / Channel Secret取得済み)に、
   LIFFアプリを追加します(LINE Developersコンソール > 該当チャネル > LIFF > 追加)。
   - **Size**: Full を推奨(位置情報許可ダイアログが見やすいため)
   - **Endpoint URL**: 後述のWebアプリ公開URL(`.../exec`)を設定
   - **Scope**: `profile`, `openid` にチェック
2. 発行された **LIFF ID**(例: `1234567890-AbCdEfGh`)を控えておきます。

### 3.3 スクリプトプロパティの設定

Apps Scriptエディタの [プロジェクトの設定] > [スクリプト プロパティ] で以下を設定します。

| キー | 値 |
|---|---|
| `LINE_CHANNEL_ID` | LIFFが属するチャネルのChannel ID |
| `LINE_CHANNEL_SECRET` | 上記チャネルのChannel Secret |
| `LIFF_ID` | 3.2で発行されたLIFF ID |
| `SPREADSHEET_ID` | 3.1で作成したスプレッドシートのID |
| `NOTIFY_EMAILS` | 通知先メールアドレス(複数はカンマ区切り。例: `a@example.com,b@example.com`) |

### 3.4 Geocoding.gs の User-Agent 設定

`Geocoding.gs` 内の `NOMINATIM_USER_AGENT` は、利用しているサービス
(OpenStreetMap Nominatim)の利用ポリシー上、連絡先が分かる文字列に
書き換えることを推奨します。

## 4. デプロイ

1. Apps Scriptエディタで [デプロイ] > [新しいデプロイ] を選択
2. 種類: 「ウェブアプリ」
3. 実行するユーザー: 「自分」
4. アクセスできるユーザー: 「全員」(LINEアプリ内ブラウザからアクセスするため)
5. デプロイして発行されたURL(`https://script.google.com/macros/s/.../exec`)を
   3.2のLIFF Endpoint URLに設定する

コードを更新した場合は、既存のデプロイを「編集」して新しいバージョンで
更新してください(URLは変わりません)。

## 5. 動作確認の流れ

1. LINEアプリでLIFF URL(`https://liff.line.me/【LIFF ID】`)を開く
2. LINEログイン → 画面に「ログイン中: 表示名」が出る
3. 「出勤」を押す → 位置情報の利用許可ダイアログが出る
   - 「許可」→ 打刻され、結果(氏名・区分・日時・簡易住所)が画面に表示される
   - 「拒否」→ 打刻はされないが、エラーメッセージと「拒否した記録の日時」が画面に表示される
4. `Records` シートに1行追加されていることを確認
   (拒否した場合は区分が「出勤(拒否)」/「退勤(拒否)」の行が追加される)
5. `NOTIFY_EMAILS` 宛にメールが届いていることを確認(拒否時はメール通知なし)

## 6. 通知方法の拡張について

`Notify.gs` の `notifyAttendance_()` が唯一の呼び出し口です。

- **宛先を増やす**: `NOTIFY_EMAILS` にカンマ区切りで追加、または
  `Employees` シートのC列に個人ごとの通知先を設定する。
- **メール以外の通知に切り替える/追加する**: `notifyViaLineMessagingApi_()`
  のような新しい関数を実装し、`notifyAttendance_()` 内から呼び出すだけで
  よい構成にしています(既存のメール通知処理には影響しません)。

## 7. セキュリティ上の注意点

- フロントエンド(LIFF画面)から送られてくる氏名やUserIDは信用せず、
  サーバー側で毎回LINEのIDトークンをLINEサーバーに問い合わせて検証しています
  (`LiffAuth.gs`)。
- 記録される氏名は、LINEの表示名(変更可能)ではなく `Employees` シートに
  事前登録した正式な氏名を使用します。マスタ未登録のアカウントからの打刻は
  拒否されます。
- 位置情報は「毎回許可ダイアログを出す」実装にしており(`maximumAge: 0`)、
  取得を拒否・失敗した場合は出退勤としては記録せず打刻を成立させません。
  ただし「誰が・いつ拒否したか」は監査目的で `Records` シートに残します
  (区分「出勤(拒否)」「退勤(拒否)」、位置情報自体は記録しません)。
