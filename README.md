# LINE出退勤管理システム(Google Apps Script + LIFF)

LINEのLIFF(LINE内Webページ)から「出勤」「退勤」ボタンで打刻し、
Googleスプレッドシートに記録、打刻の都度メール通知を送るシステムです。

## 1. 全体構成

> **重要**: 画面(LIFF)とデータ処理(GAS)は**別々の場所でホスティング**します。
> Google Apps ScriptのHtmlServiceは、ページを内部で自動的にiframeへ入れて配信する
> 仕様になっており、これがLINEログインの内部処理(`access.line.me` への
> フレーム表示)とぶつかって動作しません(`X-Frame-Options: deny` で拒否される)。
> そのため、画面(`index.html`)は **GitHub Pages** などの静的ホスティングで公開し、
> GASは「打刻データを受け取ってスプレッドシートに記録するAPI」に専念させます。

```
[LINEアプリ]
   │ LIFF URL (liff.line.me/{LIFF_ID}) を開く
   ▼
GitHub Pages で公開した index.html (画面)
   │ 位置情報取得(毎回許可を要求。拒否時は打刻不可)
   │ fetch(POST) でGASの exec URL を呼び出す
   ▼
GAS Web App (doPost / Code.gs)  ※画面は返さず、API専用
      ├─ LiffAuth.gs      … LINEのIDトークンをLINEサーバーで検証
      ├─ Employees.gs     … 社員マスタから正式な氏名を取得
      ├─ Geocoding.gs     … 緯度経度 → 簡易住所(OSM Nominatim)
      ├─ AttendanceSheet.gs … スプレッドシートへ記録
      └─ Notify.gs        … 通知(現在はメール。差し替え・追加が容易)
```

## 2. ファイル一覧

| ファイル | どこに置く? | 役割 |
|---|---|---|
| `index.html` | **GitHub Pages**(静的ホスティング) | LIFF画面。上部の `LIFF_ID` / `SCRIPT_URL` を実際の値に書き換えて公開する |
| `appsscript.json` | Google Apps Script | マニフェスト |
| `Config.gs` | Google Apps Script | スクリプトプロパティの読み込み窓口 |
| `Code.gs` | Google Apps Script | `doGet`(案内文のみ)/`doPost`(打刻API) エントリーポイント |
| `LiffAuth.gs` | Google Apps Script | LIFF IDトークンの検証 |
| `Employees.gs` | Google Apps Script | 社員マスタの読み込み |
| `AttendanceSheet.gs` | Google Apps Script | 出退勤記録シートへの書き込み |
| `Geocoding.gs` | Google Apps Script | 緯度経度→簡易住所変換 |
| `Notify.gs` | Google Apps Script | 通知処理(独立関数。宛先追加・通知方法追加はここを触るだけでよい) |
| `Setup.gs` | Google Apps Script | 初回セットアップ用(シート・ヘッダー自動作成) |

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

### 3.2 GASをWebアプリとしてデプロイする(データ処理API側)

先にこちらを済ませておくと、後述のLIFF設定でエンドポイントURLがすぐ用意できます。

1. Apps Scriptエディタで [デプロイ] > [新しいデプロイ] を選択
2. 種類: 「ウェブアプリ」
3. 実行するユーザー: 「自分」
4. アクセスできるユーザー: 「全員」
5. デプロイして発行されたURL(`https://script.google.com/macros/s/.../exec`)を控えておく

コードを更新した場合は、既存のデプロイを「編集」して新しいバージョンで
更新してください(URLは変わりません)。

### 3.3 GitHub Pagesで画面(index.html)を公開する

1. このリポジトリの GitHub ページで [Settings] タブを開く
2. 左メニューの [Pages] を開く
3. 「Source」を **「Deploy from a branch」**、ブランチはこのコードがある
   ブランチ(例: `claude/line-attendance-system-o4r0kv`)、フォルダは **`/ (root)`** を選んで保存
4. 数分待つと、`https://(あなたのGitHubユーザー名).github.io/kintai-system/` のような
   URLが発行されます(Pages画面上部に表示されます)
5. GitHub上で `index.html` を開いて鉛筆マーク(編集)をクリックし、上の方にある

   ```js
   var LIFF_ID = 'YOUR_LIFF_ID_HERE';
   var SCRIPT_URL = 'YOUR_GAS_EXEC_URL_HERE';
   ```

   の2箇所を、実際の値(後述のLIFF IDと、3.2で控えたexec URL)に書き換えてコミットする
   (書き換え後、Pagesは自動で再公開されます)

> ※ このリポジトリを非公開(Private)のままではGitHub Pagesの無料公開ができないため、
>   このリポジトリはPublic(公開)に変更する必要があります。
>   スクリプトプロパティ等の秘密情報はこのリポジトリには含まれていないため、
>   公開しても情報漏洩の心配はありません。

### 3.4 LINE Developersでの設定

> **注意**: 2019年以降、LIFFアプリは既存の **Messaging API用チャネルには直接追加できません**。
> LIFFを追加するには **「LINEログイン」チャネルを別途新規作成**し、そちらに追加する必要があります
> (Messaging API用のチャネルとは別物として、同じプロバイダーの中にもう1つ作る形になります)。

1. LINE Developersコンソールで、Messaging API用チャネルと同じプロバイダーの中に
   **新規チャネル作成 > チャネルの種類「LINEログイン」** で新しいチャネルを作成します。
2. 作成した**LINEログインチャネル**の中の「LIFF」タブ > 「追加」でLIFFアプリを追加します。
   - **Size**: Full を推奨(位置情報許可ダイアログが見やすいため)
   - **Endpoint URL**: **3.3で発行されたGitHub PagesのURL**を設定
     (GASの`.../exec`のURLではないので注意!)
   - **Scope**: `profile`, `openid` にチェック
3. 発行された **LIFF ID**(例: `1234567890-AbCdEfGh`)を控えて、
   3.3の `index.html` の `LIFF_ID` に書き込みます。
4. この**LINEログインチャネル**の「チャネル基本設定」タブにある **Channel ID** も控えておきます
   (次のスクリプトプロパティ設定で使います。Messaging API用チャネルのChannel IDとは別物です)。

### 3.5 スクリプトプロパティの設定(GAS側)

Apps Scriptエディタの [プロジェクトの設定] > [スクリプト プロパティ] で以下を設定します。

| キー | 値 |
|---|---|
| `LINE_CHANNEL_ID` | **LINEログインチャネル**(LIFFを追加した方)のChannel ID(3.4の4.) |
| `LINE_CHANNEL_SECRET` | Messaging API用チャネルのChannel Secret(現状は未使用だが将来のLINE通知拡張用に保持) |
| `SPREADSHEET_ID` | 3.1で作成したスプレッドシートのID |
| `NOTIFY_EMAILS` | 通知先メールアドレス(複数はカンマ区切り。例: `a@example.com,b@example.com`) |

### 3.6 Geocoding.gs の User-Agent 設定

`Geocoding.gs` 内の `NOMINATIM_USER_AGENT` は、利用しているサービス
(OpenStreetMap Nominatim)の利用ポリシー上、連絡先が分かる文字列に
書き換えることを推奨します。

## 4. 動作確認の流れ

1. LINEアプリでLIFF URL(`https://liff.line.me/【LIFF ID】`)を開く
2. LINEログイン → GitHub Pagesの画面が表示され「ログイン中: 表示名」が出る
3. 「出勤」を押す → 位置情報の利用許可ダイアログが出る
   - 「許可」→ 打刻され、結果(氏名・区分・日時・簡易住所)が画面に表示される
   - 「拒否」→ 打刻はされないが、エラーメッセージと「拒否した記録の日時」が画面に表示される
4. `Records` シートに1行追加されていることを確認
   (拒否した場合は区分が「出勤(拒否)」/「退勤(拒否)」の行が追加される)
5. `NOTIFY_EMAILS` 宛にメールが届いていることを確認(拒否時はメール通知なし)

## 5. 通知方法の拡張について

`Notify.gs` の `notifyAttendance_()` が唯一の呼び出し口です。

- **宛先を増やす**: `NOTIFY_EMAILS` にカンマ区切りで追加、または
  `Employees` シートのC列に個人ごとの通知先を設定する。
- **メール以外の通知に切り替える/追加する**: `notifyViaLineMessagingApi_()`
  のような新しい関数を実装し、`notifyAttendance_()` 内から呼び出すだけで
  よい構成にしています(既存のメール通知処理には影響しません)。

## 6. セキュリティ上の注意点

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
