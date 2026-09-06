/**
 * Setup.gs
 * ------------------------------------------------------------
 * 初期セットアップ用のユーティリティ。
 * スクリプトエディタから setupSheets() を1回手動実行すると、
 * SPREADSHEET_ID に設定したスプレッドシートに
 * 「Records」「Employees」シートとヘッダー行を用意する。
 * 既にシートが存在する場合は何もしない(ヘッダーの上書きはしない)。
 * ------------------------------------------------------------
 */

function setupSheets() {
  var ss = getSpreadsheet_();

  ensureSheetWithHeader_(ss, CONFIG.SHEET_NAME_ATTENDANCE, [
    'タイムスタンプ',
    '氏名',
    '日付',
    '区分',
    '時刻',
    '緯度',
    '経度',
    '住所(簡易)',
    'LINE UserID',
    '備考',
  ]);

  ensureSheetWithHeader_(ss, CONFIG.SHEET_NAME_EMPLOYEES, [
    'LINE UserID',
    '氏名',
    '通知先メール(任意)',
    '有効/無効',
  ]);

  Logger.log('セットアップが完了しました。');
}

/**
 * 指定名のシートが存在しなければ作成し、ヘッダー行を書き込む。
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} sheetName
 * @param {string[]} headers
 */
function ensureSheetWithHeader_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    Logger.log('シート "' + sheetName + '" は既に存在するためスキップしました。');
    return;
  }
  sheet = ss.insertSheet(sheetName);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
}
