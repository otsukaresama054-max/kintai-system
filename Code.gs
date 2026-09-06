/**
 * Code.gs
 * ------------------------------------------------------------
 * Webアプリのエントリーポイント。
 *   doGet  : LIFF画面(HTML)を返す
 *   doPost : 打刻APIを処理し、結果をJSONで返す
 * ------------------------------------------------------------
 */

var ATTENDANCE_TYPES = ['出勤', '退勤'];

/**
 * LIFF画面を表示する。
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('liff/Index');
  template.liffId = getLiffId_();
  template.scriptUrl = ScriptApp.getService().getUrl();
  return template
    .evaluate()
    .setTitle('出退勤管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * liff/Index.html から他のHTML断片を読み込むためのヘルパー。
 * (今回は単一ファイル構成のため未使用だが、画面を分割したくなった
 * ときのために用意している)
 */
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 打刻APIの本体。
 * リクエストボディ(JSON)の形式:
 *   {
 *     "idToken": "LIFFのIDトークン",
 *     "type": "出勤" または "退勤",
 *     "lat": 34.6937,
 *     "lng": 135.5023
 *   }
 *
 * レスポンス(JSON):
 *   成功: { "ok": true, "name": "...", "type": "...", "date": "...", "time": "...", "address": "..." }
 *   失敗: { "ok": false, "message": "..." }
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
  var lat = Number(payload.lat);
  var lng = Number(payload.lng);

  if (ATTENDANCE_TYPES.indexOf(type) === -1) {
    throw new Error('区分は「出勤」または「退勤」のいずれかを指定してください。');
  }
  if (!isFinite(lat) || !isFinite(lng)) {
    // 位置情報が取得できていないリクエストは受け付けない
    // (フロント側でも取得失敗時は送信しない実装にしているが、念のためサーバー側でも弾く)
    throw new Error('位置情報が取得できていないため、打刻できません。');
  }

  // 1. LINEログインの検証(なりすまし防止。フロントの申告は信用しない)
  var lineProfile = verifyLiffIdToken_(payload.idToken);

  // 2. 社員マスタと突き合わせて正式な氏名を確定する
  var employee = findEmployeeByLineUserId_(lineProfile.userId);
  if (!employee) {
    throw new Error(
      '社員マスタに未登録のLINEアカウントです。管理者に「Employees」シートへの登録を依頼してください。'
    );
  }
  if (!employee.active) {
    throw new Error('このアカウントは無効化されています。管理者に確認してください。');
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
