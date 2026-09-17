/**
 * Reminder.gs
 * ------------------------------------------------------------
 * 「始業・終業リマインド」機能。
 *
 * 会社の勤務時間(8:30〜17:15)に合わせて、平日の
 *   ・8:25 … まだ出勤の打刻をしていない社員に「まもなく始業です」
 *   ・17:30 … まだ退勤の打刻をしていない社員に「就業時間が過ぎています」
 * というリマインドメッセージをLINE Messaging APIでpush送信する。
 *
 * スキップ条件:
 *   ・土曜・日曜
 *   ・「会社休日」シートに日付が登録されている日
 *     (祝日・年末年始・夏季休暇など、会社の休みを自由に追加できる。
 *      A列に日付を1行ずつ入力するだけでよい)
 * 送信対象:
 *   ・Employeesシートで「有効」かつ「リマインド対象」(E列に"対象"と入力)に
 *     なっている社員のうち、その日まだ該当区分(出勤/退勤)の打刻がない人だけ
 *     (すでに打刻済みの人には送らない)
 *     ※ E列が空欄の人には送られない。最初は一部の社員だけ"対象"にしておき、
 *       運用を広げるタイミングでE列を埋めていく、という使い方を想定している。
 *
 * 送信には、Messaging API用チャネルの「チャネルアクセストークン(長期)」
 * が必要。LINE Developers > 対象チャネル > Messaging API設定 タブで発行し、
 * スクリプトプロパティ LINE_CHANNEL_ACCESS_TOKEN に設定しておくこと。
 *
 * 初回だけの準備:
 *   スクリプトエディタで setupReminderTriggers を1回実行すると、
 *   毎日8:25/17:30に自動実行されるトリガーが登録される
 *   (以後はこのトリガーが自動で動き続けるので、再実行は不要)。
 * ------------------------------------------------------------
 */

var REMINDER_CHECKIN_MESSAGE =
  'まもなく始業の時間です。勤務前の打刻忘れがないよう、ご注意ください。';
var REMINDER_CHECKOUT_MESSAGE =
  '就業時間が過ぎています。勤務終了の打刻忘れがないよう、ご注意ください。';

// LINE Messaging APIのmulticastは1回のリクエストで最大500人まで指定できる。
var LINE_MULTICAST_CHUNK_SIZE = 500;

/**
 * 始業リマインド(8:25想定)。トリガーから呼ばれるエントリーポイント。
 */
function sendCheckinReminder() {
  sendAttendanceReminder_('出勤', REMINDER_CHECKIN_MESSAGE);
}

/**
 * 終業リマインド(17:30想定)。トリガーから呼ばれるエントリーポイント。
 */
function sendCheckoutReminder() {
  sendAttendanceReminder_('退勤', REMINDER_CHECKOUT_MESSAGE);
}

/**
 * リマインド送信の本体。
 * @param {string} type '出勤' または '退勤'(すでに打刻済みかどうかの判定に使う)
 * @param {string} message 送信するメッセージ本文
 */
function sendAttendanceReminder_(type, message) {
  if (isReminderSkipDay_()) {
    console.log('本日は休日(土日または会社休日)のため、' + type + 'リマインドをスキップしました。');
    return;
  }

  var employees = getReminderTargetEmployees_();
  if (employees.length === 0) {
    console.log('リマインド対象の社員が登録されていないため、' + type + 'リマインドは送信しませんでした。');
    return;
  }

  var punchedUserIds = getTodaysPunchedUserIds_(type);
  var targetUserIds = [];
  employees.forEach(function (emp) {
    if (!punchedUserIds[emp.lineUserId]) {
      targetUserIds.push(emp.lineUserId);
    }
  });

  if (targetUserIds.length === 0) {
    console.log('対象者全員が打刻済みのため、' + type + 'リマインドは送信しませんでした。');
    return;
  }

  pushLineMessageToUsers_(targetUserIds, message);
  console.log(type + 'リマインドを' + targetUserIds.length + '名に送信しました。');
}

/**
 * 今日が「リマインドを送らない日」かどうかを判定する。
 * ・土曜(6)・日曜(0)
 * ・「会社休日」シートに登録されている日付
 * @return {boolean}
 */
function isReminderSkipDay_() {
  var now = new Date();
  var day = now.getDay(); // 0:日曜 〜 6:土曜
  if (day === 0 || day === 6) return true;

  var todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  var sheet = getHolidaySheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (cellToDateString_(values[i][0]) === todayStr) {
      return true;
    }
  }
  return false;
}

/**
 * 「会社休日」シートを取得する。存在しない場合は自動作成する
 * (setupSheetsを再実行しなくても、初回のリマインド実行時に自動で用意される)。
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getHolidaySheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME_HOLIDAYS);
  if (!sheet) {
    ensureSheetWithHeader_(ss, CONFIG.SHEET_NAME_HOLIDAYS, ['日付', '備考(任意)']);
    sheet = ss.getSheetByName(CONFIG.SHEET_NAME_HOLIDAYS);
  }
  return sheet;
}

/**
 * 今日、指定した区分(出勤/退勤)で既に打刻済みのLINE UserIDを集める。
 * 「(拒否)」の記録(位置情報拒否で実際には打刻できていない)は
 * 打刻済みとして扱わない(リマインドを送って再度打刻を促すべきため)。
 *
 * @param {string} type '出勤' または '退勤'
 * @return {Object.<string, boolean>} lineUserId をキーにしたマップ
 */
function getTodaysPunchedUserIds_(type) {
  var sheet = getAttendanceSheet_();
  var lastRow = sheet.getLastRow();
  var punched = {};
  if (lastRow < 2) return punched;

  var todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var values = sheet.getRange(2, 1, lastRow - 1, 9).getValues(); // A〜I列まででよい

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var rowDate = cellToDateString_(row[2]); // C: 日付
    var rowType = row[3]; // D: 区分
    var lineUserId = String(row[8]); // I: LINE UserID
    if (rowDate === todayStr && rowType === type) {
      punched[lineUserId] = true;
    }
  }
  return punched;
}

/**
 * LINE Messaging APIのmulticastで、複数ユーザーに同じテキストメッセージを送る。
 * 500人を超える場合は自動で分割送信する。
 * @param {string[]} userIds
 * @param {string} text
 */
function pushLineMessageToUsers_(userIds, text) {
  var token = getLineChannelAccessToken_();
  if (!token) {
    console.error(
      'スクリプトプロパティ LINE_CHANNEL_ACCESS_TOKEN が未設定のため、リマインドを送信できませんでした。'
    );
    return;
  }

  for (var i = 0; i < userIds.length; i += LINE_MULTICAST_CHUNK_SIZE) {
    var chunk = userIds.slice(i, i + LINE_MULTICAST_CHUNK_SIZE);
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        to: chunk,
        messages: [{ type: 'text', text: text }],
      }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 300) {
      console.error(
        'LINEリマインドの送信に失敗しました(HTTP ' + res.getResponseCode() + '): ' + res.getContentText()
      );
    }
  }
}

/**
 * 【初回だけ実行】始業・終業リマインドの時限トリガーを登録する。
 * スクリプトエディタの関数選択プルダウンから setupReminderTriggers を選んで
 * 実行すること(実行後は毎日自動で動くので、再実行は不要)。
 *
 * 既に登録済みの同名トリガーがあれば、重複を避けるため一度削除してから
 * 作り直す(設定時刻を変えたい場合は、このスクリプトを直接書き換えて
 * もう一度 setupReminderTriggers を実行すればよい)。
 */
function setupReminderTriggers() {
  deleteTriggersByHandler_('sendCheckinReminder');
  deleteTriggersByHandler_('sendCheckoutReminder');

  ScriptApp.newTrigger('sendCheckinReminder')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .nearMinute(25)
    .create();

  ScriptApp.newTrigger('sendCheckoutReminder')
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .nearMinute(30)
    .create();

  Logger.log('リマインドのトリガーを登録しました(毎日8:25ごろ/17:30ごろに自動実行されます)。');
}

/**
 * 指定した関数名に紐づく時限トリガーを全て削除する(setupReminderTriggersの内部処理用)。
 * @param {string} handlerFunctionName
 */
function deleteTriggersByHandler_(handlerFunctionName) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handlerFunctionName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
