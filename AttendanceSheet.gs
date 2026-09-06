/**
 * AttendanceSheet.gs
 * ------------------------------------------------------------
 * 「出退勤記録」シートへの書き込みを担当する。
 *
 * 列構成 (1行目はヘッダー):
 *   A: タイムスタンプ(記録処理時刻)
 *   B: 氏名
 *   C: 日付
 *   D: 区分(出勤 / 退勤)
 *   E: 時刻
 *   F: 緯度
 *   G: 経度
 *   H: 住所(簡易)
 *   I: LINE UserID
 *   J: 備考
 * ------------------------------------------------------------
 */

/**
 * 出退勤記録を1行追加する。
 *
 * @param {Object} record
 * @param {string} record.name 氏名
 * @param {string} record.type '出勤' or '退勤'
 * @param {number} record.lat 緯度
 * @param {number} record.lng 経度
 * @param {string} record.address 住所(簡易)
 * @param {string} record.lineUserId LINE UserID
 * @return {{date: string, time: string}} 記録した日付・時刻(通知メールで使う)
 */
function appendAttendanceRecord_(record) {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME_ATTENDANCE);
  if (!sheet) {
    throw new Error('シート "' + CONFIG.SHEET_NAME_ATTENDANCE + '" が見つかりません。');
  }

  var now = new Date();
  var dateStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  var timeStr = Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss');

  sheet.appendRow([
    now, // A: タイムスタンプ
    record.name, // B: 氏名
    dateStr, // C: 日付
    record.type, // D: 区分
    timeStr, // E: 時刻
    record.lat, // F: 緯度
    record.lng, // G: 経度
    record.address, // H: 住所(簡易)
    record.lineUserId, // I: LINE UserID
    '', // J: 備考
  ]);

  return { date: dateStr, time: timeStr };
}
