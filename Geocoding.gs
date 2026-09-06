/**
 * Geocoding.gs
 * ------------------------------------------------------------
 * 緯度・経度から「詳細すぎない程度の住所文字列」を作る処理。
 *
 * OpenStreetMapのNominatim(無料・APIキー不要)を利用する。
 * 都道府県・市区町村・町域レベルまでにとどめ、番地や建物名までは
 * 含めない(プライバシー配慮 + 要件の「詳細すぎない程度」に対応)。
 *
 * 利用ポリシー上、User-Agentに連絡先を含めることが推奨されているため、
 * NOMINATIM_USER_AGENT は運用者の情報に書き換えて使うこと。
 * ------------------------------------------------------------
 */

var NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
// 利用ポリシー(https://operations.osmfoundation.org/policies/nominatim/)に
// 従い、識別可能なUser-Agent/連絡先を設定すること。運用時に書き換える。
var NOMINATIM_USER_AGENT = 'KintaiLiffApp/1.0 (contact: your-address@example.com)';

/**
 * 緯度経度を「詳細すぎない住所」の文字列に変換する。
 * 外部サービス障害などで取得できない場合は例外を投げず、
 * その旨がわかる文字列を返す(打刻自体は失敗させない)。
 *
 * @param {number} lat
 * @param {number} lng
 * @return {string}
 */
function reverseGeocodeToAddress_(lat, lng) {
  try {
    var url =
      NOMINATIM_ENDPOINT +
      '?format=jsonv2&lat=' + encodeURIComponent(lat) +
      '&lon=' + encodeURIComponent(lng) +
      '&accept-language=ja&zoom=14';

    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'User-Agent': NOMINATIM_USER_AGENT },
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      // 原因調査用に、実際のステータスコードと返却内容を実行ログに残す。
      var bodySnippet = response.getContentText().substring(0, 300);
      console.log(
        '住所取得(Nominatim)に失敗しました。 status=' + response.getResponseCode() +
          ' body=' + bodySnippet
      );
      // 実行ログを探す手間を省くため、画面にもステータスコードを直接表示する。
      return '住所取得失敗(HTTP ' + response.getResponseCode() + ' / 緯度' + lat + ' 経度' + lng + ')';
    }

    var data = JSON.parse(response.getContentText());
    var address = data.address || {};

    // 詳細すぎない粒度(都道府県 / 市区町村 / 町域まで)だけを組み立てる。
    // road(番地・通り名)やhouse_numberはあえて使わない。
    var pref = address.state || '';
    var city =
      address.city || address.town || address.county || address.municipality || '';
    var district =
      address.suburb || address.neighbourhood || address.city_district || '';

    var parts = [pref, city, district].filter(function (s) {
      return s && s.length > 0;
    });

    if (parts.length === 0) {
      return data.display_name || '住所を特定できませんでした';
    }
    return parts.join('');
  } catch (e) {
    // ネットワークエラー等。打刻自体は継続させるため例外は投げない。
    var errMsg = e && e.message ? e.message : String(e);
    console.log('住所取得(Nominatim)で例外が発生しました: ' + errMsg);
    // 実行ログを探す手間を省くため、画面にも例外メッセージを直接表示する。
    return '住所取得失敗(' + errMsg + ')';
  }
}
