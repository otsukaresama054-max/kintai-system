/**
 * Employees.gs
 * ------------------------------------------------------------
 * 「社員マスタ」シートの読み込みを担当する。
 * LINEの表示名は本人が自由に変更できてしまうため、正式な氏名は
 * このマスタシートに事前登録した値を正とする。
 *
 * シート構成 (1行目はヘッダー):
 *   A: LINE UserID
 *   B: 氏名
 *   C: 通知先メール(任意・個別追加用)
 *   D: 有効/無効 ("有効" のときだけ打刻を許可する)
 *   E: リマインド対象(任意。"対象" と入力した人だけ始業・終業リマインドが届く。
 *      空欄の人には送らない。Reminder.gs 参照。E列は後から追加した列のため、
 *      既存のスプレッドシートを使っている場合はE1セルに手動で
 *      「リマインド対象」と入力しておくこと)
 * ------------------------------------------------------------
 */

/**
 * LINE UserIDから社員情報を検索する。
 * 見つからない、または無効化されている場合は null を返す。
 *
 * @param {string} lineUserId
 * @return {{lineUserId: string, name: string, notifyEmail: string, active: boolean}|null}
 */
function findEmployeeByLineUserId_(lineUserId) {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME_EMPLOYEES);
  if (!sheet) {
    throw new Error('シート "' + CONFIG.SHEET_NAME_EMPLOYEES + '" が見つかりません。');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null; // ヘッダーのみ、データなし

  // A2:D(最終行) をまとめて取得(1行ずつgetRangeするより高速)
  var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var rowUserId = String(row[0]).trim();
    if (rowUserId === lineUserId) {
      var status = String(row[3]).trim();
      return {
        lineUserId: rowUserId,
        name: String(row[1]).trim(),
        notifyEmail: String(row[2]).trim(),
        active: status === '有効',
      };
    }
  }
  return null;
}

/**
 * 「有効」かつ「リマインド対象」になっている社員(LINE UserID・氏名)を
 * 一覧で返す。始業・終業リマインド(Reminder.gs)の送信対象の絞り込みに使う。
 *
 * E列(リマインド対象)は、"対象" と入力されている人だけが対象になる。
 * 空欄の人には送らない(段階的に対象を増やしていける運用を想定)。
 *
 * @return {Array<{lineUserId: string, name: string}>}
 */
function getReminderTargetEmployees_() {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME_EMPLOYEES);
  if (!sheet) {
    throw new Error('シート "' + CONFIG.SHEET_NAME_EMPLOYEES + '" が見つかりません。');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var result = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var lineUserId = String(row[0]).trim();
    var status = String(row[3]).trim();
    var reminderTarget = String(row[4]).trim();
    if (lineUserId && status === '有効' && reminderTarget === '対象') {
      result.push({ lineUserId: lineUserId, name: String(row[1]).trim() });
    }
  }
  return result;
}
