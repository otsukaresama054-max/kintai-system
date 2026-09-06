/**
 * Notify.gs
 * ------------------------------------------------------------
 * 打刻が行われるたびに呼ばれる「通知」の窓口。
 *
 * 設計方針:
 *   - notifyAttendance_() が唯一の呼び出し口。呼び出し側(Code.gs)は
 *     この関数を呼ぶだけでよく、通知の中身(メールかLINEか等)を
 *     意識しなくてよい。
 *   - 実際の送信処理は「チャネル」ごとに関数を分けてあるので、
 *       ・宛先を増やしたい   → getNotifyEmails_() の戻り値(配列)を増やす、
 *                              またはEmployeesシートのC列に個別宛先を追加
 *       ・LINE通知を追加したい → notifyViaLineMessagingApi_() を実装して
 *                              notifyAttendance_() 内で呼び出すだけでよい
 *     という形で、送信手段の追加・変更がしやすいようにしている。
 * ------------------------------------------------------------
 */

/**
 * 打刻イベントの通知を送る(唯一のエントリーポイント)。
 *
 * @param {Object} record
 * @param {string} record.name 氏名
 * @param {string} record.type '出勤' or '退勤'
 * @param {string} record.date 日付 (yyyy-MM-dd)
 * @param {string} record.time 時刻 (HH:mm:ss)
 * @param {string} record.address 住所(簡易)
 * @param {string} [record.employeeEmail] 社員マスタに登録された個別通知先(任意)
 */
function notifyAttendance_(record) {
  // 現状はメール通知のみ。将来チャネルを追加する場合はここに1行足すだけでよい。
  notifyViaEmail_(record);
  // notifyViaLineMessagingApi_(record); // 例: LINE通知を有効化する場合はコメントを外す
}

/**
 * メールでの通知(実際の送信処理その1)。
 * @param {Object} record notifyAttendance_ と同じ形式
 */
function notifyViaEmail_(record) {
  var recipients = getNotifyEmails_(); // スクリプトプロパティ NOTIFY_EMAILS (カンマ区切り)

  if (record.employeeEmail) {
    // 社員マスタに個別の通知先が設定されていれば追加する(重複は除く)
    if (recipients.indexOf(record.employeeEmail) === -1) {
      recipients.push(record.employeeEmail);
    }
  }

  if (recipients.length === 0) {
    // 通知先が1件も設定されていない場合はログにだけ残して終える。
    console.warn('通知先メールアドレスが設定されていないため、メール通知をスキップしました。');
    return;
  }

  var subject = '【出退勤】' + record.name + ' さんが' + record.type + '打刻しました';
  var body = [
    '出退勤の打刻がありました。',
    '',
    '氏名  : ' + record.name,
    '区分  : ' + record.type,
    '日付  : ' + record.date,
    '時刻  : ' + record.time,
    '位置  : ' + record.address,
    '',
    '※このメールは出退勤管理システムから自動送信されています。',
  ].join('\n');

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: subject,
    body: body,
  });
}

/**
 * LINE Messaging APIでの通知(将来の拡張用の雛形)。
 * 実装する場合は、通知したいLINE UserID(このシステムの打刻者本人にする
 * のか、管理者用のグループ/UserIDにするのかは運用に合わせて決める)に
 * push メッセージを送る形になる。
 *
 * 有効化する場合は notifyAttendance_() 内の呼び出しコメントを外すこと。
 *
 * @param {Object} record notifyAttendance_ と同じ形式
 */
function notifyViaLineMessagingApi_(record) {
  // 例:
  // var channelAccessToken = getScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN');
  // var targetUserId = getScriptProperty_('LINE_NOTIFY_TARGET_USER_ID');
  // UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
  //   method: 'post',
  //   contentType: 'application/json',
  //   headers: { Authorization: 'Bearer ' + channelAccessToken },
  //   payload: JSON.stringify({
  //     to: targetUserId,
  //     messages: [{
  //       type: 'text',
  //       text: record.name + 'さんが' + record.type + '打刻しました\n' +
  //             record.date + ' ' + record.time + '\n' + record.address,
  //     }],
  //   }),
  // });
  throw new Error('notifyViaLineMessagingApi_ は未実装です。必要になったら実装してください。');
}
