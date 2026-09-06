/**
 * LiffAuth.gs
 * ------------------------------------------------------------
 * LIFF(フロントエンド)から送られてきた IDトークン を LINEのサーバーに
 * 問い合わせて検証し、本当にLINEでログイン済みの本人かどうかを確認する。
 *
 * フロントから送られてくる displayName や userId はクライアント側で
 * 改ざん可能なため、絶対に信用しない。必ずここで検証した結果だけを使う。
 * ------------------------------------------------------------
 */

var LINE_VERIFY_ENDPOINT = 'https://api.line.me/oauth2/v2.1/verify';

/**
 * LIFFのIDトークンを検証し、LINEのuserIdと表示名を取得する。
 * 検証に失敗した場合は例外を投げる。
 *
 * @param {string} idToken LIFFのliff.getIDToken()で取得したトークン
 * @return {{userId: string, displayName: string}}
 */
function verifyLiffIdToken_(idToken) {
  if (!idToken) {
    throw new Error('IDトークンがありません。LINEアプリからアクセスしてください。');
  }

  var response = UrlFetchApp.fetch(LINE_VERIFY_ENDPOINT, {
    method: 'post',
    payload: {
      id_token: idToken,
      client_id: getLineChannelId_(),
    },
    muteHttpExceptions: true,
  });

  var status = response.getResponseCode();
  var body = JSON.parse(response.getContentText());

  if (status !== 200) {
    // 例: トークン期限切れ、client_id不一致など
    throw new Error(
      'LINEログインの検証に失敗しました: ' + (body.error_description || body.error || status)
    );
  }

  return {
    userId: body.sub, // LINEのユーザーID
    displayName: body.name || '', // LINEの表示名(参考情報。氏名はEmployeesマスタを正とする)
  };
}
