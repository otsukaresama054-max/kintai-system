/**
 * Config.gs
 * ------------------------------------------------------------
 * スクリプトプロパティ(設定値)へのアクセスを一箇所に集約するファイル。
 * 「設定値の置き場所」を変えたくなったとき(例: PropertiesServiceから
 * 別の設定管理に切り替える等)は、このファイルだけ直せばよい。
 *
 * 事前に [プロジェクトの設定] > [スクリプト プロパティ] で
 * 以下のキーを設定しておくこと。
 *
 *   LINE_CHANNEL_ID      : LIFFが属するLINEチャネルのChannel ID
 *   LINE_CHANNEL_SECRET  : 上記チャネルのChannel Secret
 *   LIFF_ID              : LIFFアプリのID
 *   SPREADSHEET_ID       : 記録先スプレッドシートのID
 *   NOTIFY_EMAILS        : 通知先メールアドレス(カンマ区切りで複数可)
 * ------------------------------------------------------------
 */

// シート名や必須プロパティキーなど、コード全体で使う定数はここにまとめる。
var CONFIG = {
  SHEET_NAME_ATTENDANCE: 'Records', // 実際の出退勤記録シートのシート名
  SHEET_NAME_EMPLOYEES: 'Employees', // 実際の社員マスタシートのシート名
};

/**
 * スクリプトプロパティから値を取得する。
 * 未設定の場合はエラーを投げて早期に気づけるようにする。
 * @param {string} key
 * @param {boolean} [required=true]
 * @return {string}
 */
function getScriptProperty_(key, required) {
  if (required === undefined) required = true;
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (required && (!value || value === '')) {
    throw new Error(
      'スクリプトプロパティ "' + key + '" が設定されていません。' +
      '[プロジェクトの設定] > [スクリプト プロパティ] から設定してください。'
    );
  }
  return value;
}

function getLineChannelId_() {
  return getScriptProperty_('LINE_CHANNEL_ID');
}

/**
 * LIFFアプリのID (例: "1234567890-AbCdEfGh")。
 * LINE Developersコンソールで作成したLIFFアプリのIDを設定する。
 */
function getLiffId_() {
  return getScriptProperty_('LIFF_ID');
}

function getLineChannelSecret_() {
  // 現時点ではidToken検証には未使用だが、将来Messaging APIでの
  // 通知送信などに使う可能性があるため取得関数を用意しておく。
  return getScriptProperty_('LINE_CHANNEL_SECRET', false);
}

function getSpreadsheetId_() {
  return getScriptProperty_('SPREADSHEET_ID');
}

/**
 * 通知先メールアドレスの配列を返す。
 * NOTIFY_EMAILS はカンマ区切りで複数指定できる。
 * @return {string[]}
 */
function getNotifyEmails_() {
  var raw = getScriptProperty_('NOTIFY_EMAILS', false);
  if (!raw) return [];
  return raw
    .split(',')
    .map(function (s) {
      return s.trim();
    })
    .filter(function (s) {
      return s.length > 0;
    });
}

/**
 * 記録先スプレッドシートのSpreadsheetオブジェクトを返す。
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet_() {
  return SpreadsheetApp.openById(getSpreadsheetId_());
}
