/**
 * AttendanceSheet.gs
 * ------------------------------------------------------------
 * 「出退勤記録」シートへの書き込みを担当する。
 *
 * 列構成 (1行目はヘッダー):
 *   A: タイムスタンプ(記録処理時刻)
 *   B: 氏名
 *   C: 日付
 *   D: 区分(出勤 / 退勤 / 出勤(拒否) / 退勤(拒否))
 *   E: 時刻
 *   F: 緯度
 *   G: 経度
 *   H: 住所(簡易)
 *   I: LINE UserID
 *   J: 備考
 *
 * 位置情報の利用を拒否された(または取得に失敗した)場合は、実際の
 * 打刻は行わず、区分に「(拒否)」を付けた行として事実だけを記録する
 * (appendLocationDeniedRecord_)。集計時はこの区分を除外すればよい。
 * ------------------------------------------------------------
 */

/**
 * 「今日の日付」「現在時刻」の文字列を返す共通ヘルパー。
 * @return {{now: Date, date: string, time: string}}
 */
function nowForRecord_() {
  var now = new Date();
  return {
    now: now,
    date: Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd'),
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss'),
  };
}

function getAttendanceSheet_() {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME_ATTENDANCE);
  if (!sheet) {
    throw new Error('シート "' + CONFIG.SHEET_NAME_ATTENDANCE + '" が見つかりません。');
  }
  return sheet;
}

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
  var sheet = getAttendanceSheet_();
  var n = nowForRecord_();

  sheet.appendRow([
    n.now, // A: タイムスタンプ
    record.name, // B: 氏名
    n.date, // C: 日付
    record.type, // D: 区分
    n.time, // E: 時刻
    record.lat, // F: 緯度
    record.lng, // G: 経度
    record.address, // H: 住所(簡易)
    record.lineUserId, // I: LINE UserID
    '', // J: 備考
  ]);

  return { date: n.date, time: n.time };
}

/**
 * 位置情報の利用が拒否された(または取得に失敗した)ため打刻が
 * 行われなかった、という「事実」だけを1行記録する。
 * 出退勤の実績としてはカウントしない(区分に「(拒否)」を付けて区別する)。
 *
 * @param {Object} record
 * @param {string} record.name 氏名
 * @param {string} record.type '出勤' or '退勤' (押されたボタン)
 * @param {string} record.lineUserId LINE UserID
 * @param {string} [record.reason] 拒否・失敗の理由(任意、備考に記録)
 * @return {{date: string, time: string}}
 */
function appendLocationDeniedRecord_(record) {
  var sheet = getAttendanceSheet_();
  var n = nowForRecord_();

  sheet.appendRow([
    n.now, // A: タイムスタンプ
    record.name, // B: 氏名
    n.date, // C: 日付
    record.type + '(拒否)', // D: 区分 … 通常の出勤/退勤と区別する
    n.time, // E: 時刻
    '', // F: 緯度(取得できていない)
    '', // G: 経度(取得できていない)
    '位置情報の利用が拒否されたため打刻できませんでした', // H: 住所(簡易)
    record.lineUserId, // I: LINE UserID
    record.reason || '', // J: 備考(拒否・取得失敗の理由)
  ]);

  return { date: n.date, time: n.time };
}
