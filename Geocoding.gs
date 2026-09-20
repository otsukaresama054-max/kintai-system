/**
 * Geocoding.gs
 * ------------------------------------------------------------
 * 緯度・経度から住所文字列を作る処理。
 *
 * OpenStreetMapのNominatim(無料・APIキー不要)を利用する。
 * 都道府県・市区町村・町域に加えて、取得できる場合は
 * 丁目/道路名・番地・建物名まで、できる限り詳しく組み立てる
 * (Nominatimが持っているデータの粒度に依存するため、
 * 都市部ほど詳細に、山間部・郊外などデータが粗い地域では
 * 町域までにとどまることがある)。
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
 * 緯度経度を、できる限り詳しい住所の文字列に変換する。
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
      // zoom=18: 建物レベルまでの詳細な住所を要求する(データがなければ
      // Nominatim側が取得できる範囲までを返してくれる)。
      '&accept-language=ja&zoom=18&addressdetails=1';

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

    // 【調査用ログ】Nominatimが実際にどんな情報を返してきているかを
    // 実行ログに残す(表示される住所が思ったより詳しくならない場合、
    // このログを見れば「road/house_number/buildingがそもそも
    // データにあるのか無いのか」を確認できる。原因が分かったら、
    // このconsole.logの行は削除してよい)。
    console.log('Nominatim address breakdown: ' + JSON.stringify(address));
    console.log('Nominatim display_name: ' + data.display_name);

    // できる限り詳しい粒度で組み立てる。
    // 都道府県 → 市区町村 → 町域 → 丁目/道路名 → 番地 → 建物名、の順。
    // Nominatim側にデータがない項目は自動的に飛ばされる(=取得できる
    // 範囲で最大限詳しくなる。都市部ほど詳しく、山間部・郊外など
    // データが粗い地域では途中の粒度までになることがある)。
    var pref = address.state || '';
    var city =
      address.city || address.town || address.county || address.municipality || '';
    var district =
      address.suburb || address.neighbourhood || address.city_district || '';
    var road = address.road || address.hamlet || '';
    var houseNumber = address.house_number || '';
    var building = address.building || '';

    var parts = [pref, city, district, road, houseNumber, building].filter(function (s) {
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

/**
 * 【調査用・一時的な関数】実際にテストした座標(大阪市淀川区付近)で
 * reverseGeocodeToAddress_ を1回だけ実行し、結果を実行ログに出す。
 * 関数選択のプルダウンからこの関数を選んで▶実行すること。
 * 原因が分かったら、この関数ごと削除してよい。
 */
function debugGeocodeTest_() {
  var result = reverseGeocodeToAddress_(34.71456515898639, 135.4874020520385);
  Logger.log('組み立てた住所: ' + result);
}
