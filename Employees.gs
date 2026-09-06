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
