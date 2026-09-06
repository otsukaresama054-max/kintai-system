/**
 * Code.gs
 * ------------------------------------------------------------
 * Webアプリのエントリーポイント。
 *
 * LIFFの画面(HTML)はここでは配信しない。GASのHtmlServiceは
 * ページを内部でiframeに入れて配信する仕様になっており、これが
 * LINEログインの仕組みと相性が悪く正しく動作しないため、画面は
 * GitHub Pagesなど別の静的ホスティングで公開し、このGASは
 * 「打刻データを受け取ってスプレッドシートに記録する」 AI(API)専用に
 * している(詳しくはREADME参照)。
 *
 *   doGet  : このURLがAPI専用であることを知らせる簡単な案内を返す
 *   doPost : 打刻APIを処理し、結果をJSONで返す(画面側からfetchで呼ばれる)
 * ------------------------------------------------------------
 */

var ATTENDANCE_TYPES = ['出勤', '退勤'];

/**
 * ブラウザで直接このURLを開いてしまった人向けの案内。
 * (LIFF画面は別ホスティングにあるため、ここでは何も表示しない)
 */
function doGet(e) {
  return ContentService.createTextOutput(
    'このURLは出退勤管理システムのAPI用エンドポイントです。\n' +
      '打刻画面はこちらではなく、LIFFアプリ(LINE)から開いてください。'
  ).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * 打刻APIの本体。
 * リクエストボディ(JSON)の形式:
 *   通常の打刻:
 *     {
 *       "idToken": "LIFFのIDトークン",
 *       "type": "出勤" または "退勤",
 *       "lat": 34.6937,
 *       "lng": 135.5023
 *     }
 *   位置情報の利用を拒否/取得失敗した場合(打刻はされないが記録は残す):
 *     {
 *       "idToken": "LIFFのIDトークン",
 *       "type": "出勤" または "退勤",
 *       "locationDenied": true,
 *       "reason": "PERMISSION_DENIED" など(任意)
 *     }
 *
 * レスポンス(JSON):
 *   打刻成功: { "ok": true, "name": "...", "type": "...", "date": "...", "time": "...", "address": "..." }
 *   拒否記録: { "ok": false, "denied": true, "name": "...", "type": "...", "date": "...", "time": "...", "message": "..." }
 *   失敗    : { "ok": false, "message": "..." }
 */
function doPost(e) {
  var result;
  try {
    result = handlePunch_(e);
  } catch (err) {
    result = { ok: false, message: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * doPost の実処理。バリデーション → 認証 → 記録 → 通知、の順で行う。
 * @param {GoogleAppsScript.Events.DoPost} e
 */
function handlePunch_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('リクエストボディがありません。');
  }

  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    throw new Error('リクエストの形式が不正です。');
  }

  var type = payload.type;
  var locationDenied = payload.locationDenied === true;

  if (ATTENDANCE_TYPES.indexOf(type) === -1) {
    throw new Error('区分は「出勤」または「退勤」のいずれかを指定してください。');
  }

  // 1. LINEログインの検証(なりすまし防止。フロントの申告は信用しない)
  var lineProfile = verifyLiffIdToken_(payload.idToken);

  // 2. 社員マスタと突き合わせて正式な氏名を確定する
  var employee = findEmployeeByLineUserId_(lineProfile.userId);
  if (!employee) {
    // 初期セットアップ時、管理者がEmployeesシートに登録すべきLINE UserIDを
    // 確認できるよう、実行ログにも出力しておく(Apps Scriptエディタの
    // 「実行数」から確認できる)。
    console.log(
      '未登録のLINEアカウントからアクセスがありました。 LINE UserID: ' +
        lineProfile.userId +
        ' / LINE表示名: ' +
        lineProfile.displayName
    );
    // 実行ログを探すのが手間なので、画面にもLINE UserIDをそのまま表示する。
    // (本人が自分自身のUserIDを画面で確認できるだけで、他人に漏れるものではない)
    throw new Error(
      '社員マスタに未登録のLINEアカウントです。管理者にこのLINE UserIDを' +
        'Employeesシートに登録してもらってください。\n' +
        'LINE UserID: ' + lineProfile.userId
    );
  }
  if (!employee.active) {
    throw new Error('このアカウントは無効化されています。管理者に確認してください。');
  }

  // 位置情報の利用が拒否/取得失敗した場合は、打刻はさせず
  // 「拒否した事実」だけを時刻付きで記録して終える。
  if (locationDenied) {
    var deniedSaved = appendLocationDeniedRecord_({
      name: employee.name,
      type: type,
      lineUserId: employee.lineUserId,
      reason: payload.reason ? String(payload.reason) : '',
    });
    return {
      ok: false,
      denied: true,
      name: employee.name,
      type: type,
      date: deniedSaved.date,
      time: deniedSaved.time,
      message:
        '位置情報の利用が許可されなかったため、' + type + 'は記録されませんでした(拒否した事実は記録されました)。',
    };
  }

  var lat = Number(payload.lat);
  var lng = Number(payload.lng);
  if (!isFinite(lat) || !isFinite(lng)) {
    // 位置情報が取得できていないリクエストは受け付けない
    // (フロント側でも取得失敗時はlocationDenied扱いで送る実装にしているが、念のためサーバー側でも弾く)
    throw new Error('位置情報が取得できていないため、打刻できません。');
  }

  // 3. 緯度経度から簡易住所を取得
  var address = reverseGeocodeToAddress_(lat, lng);

  // 4. スプレッドシートに記録
  var saved = appendAttendanceRecord_({
    name: employee.name,
    type: type,
    lat: lat,
    lng: lng,
    address: address,
    lineUserId: employee.lineUserId,
  });

  // 5. 通知(メール等)を送信。通知処理の失敗で打刻自体は失敗させない。
  try {
    notifyAttendance_({
      name: employee.name,
      type: type,
      date: saved.date,
      time: saved.time,
      address: address,
      employeeEmail: employee.notifyEmail,
    });
  } catch (notifyErr) {
    console.error('通知送信に失敗しました: ' + (notifyErr.message || notifyErr));
  }

  return {
    ok: true,
    name: employee.name,
    type: type,
    date: saved.date,
    time: saved.time,
    address: address,
  };
}
