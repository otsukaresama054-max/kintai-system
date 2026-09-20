/**
 * Geocoding.gs
 * ------------------------------------------------------------
 * 緯度・経度から住所文字列を作る処理。
 *
 * OpenStreetMapのNominatim(無料・APIキー不要)を利用する。
 * 都道府県・市区町村・区・丁目・道路名・番地・建物名まで、
 * 取得できる範囲でできる限り詳しく組み立てる
 * (Nominatimが持っているデータの粒度に依存するため、
 * 都市部ほど詳細に、山間部・郊外などデータが粗い地域では
 * 途中の粒度までにとどまることがある)。
 *
 * 大阪市のような政令指定都市では、「区」(suburb/city_district)と
 * 「丁目」(neighbourhood)が両方とも別々の項目として存在するため、
 * どちらか一方だけでなく両方を組み立てに使う。
 * また、都道府県は "state" ではなく "province" という項目名で
 * 返ってくる場合があるため、両方を見るようにしている。
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
 * 外部サービス障害などで住所への変換ができない場合は例外を投げず、
 * 代わりに緯度・経度をそのまま文字列で返す(打刻自体は失敗させない)。
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
      // 詳しい原因(ステータスコード等)は実行ログにだけ残す。
      // 画面(打刻した本人)に「失敗」という言葉やエラーコードを見せると、
      // 打刻自体は成功しているのに「失敗した」と誤解して何度も打刻
      // ボタンを押し直されてしまうため、画面には代わりに緯度・経度の
      // 数値をそのまま見せる(位置情報自体は取得できていることが
      // 一目でわかるようにするため)。
      var bodySnippet = response.getContentText().substring(0, 300);
      console.log(
        '住所取得(Nominatim)に失敗しました。 status=' + response.getResponseCode() +
          ' body=' + bodySnippet + ' / 緯度' + lat + ' 経度' + lng
      );
      return formatLatLng_(lat, lng);
    }

    var data = JSON.parse(response.getContentText());
    var address = data.address || {};

    // できる限り詳しい粒度で組み立てる。
    // 都道府県 → 市区町村 → 区 → 丁目 → 道路名 → 番地 → 建物名、の順。
    // 「区」と「丁目」は片方だけでなく、両方存在すれば両方使う
    // (政令指定都市では両方とも別々の項目としてデータが存在するため)。
    // Nominatim側にデータがない項目は自動的に飛ばされる(=取得できる
    // 範囲で最大限詳しくなる。都市部ほど詳しく、山間部・郊外など
    // データが粗い地域では途中の粒度までになることがある)。
    var pref = address.state || address.province || '';
    var city =
      address.city || address.town || address.county || address.municipality || '';
    var ward = address.suburb || address.city_district || ''; // 例: 淀川区
    var neighbourhood = address.neighbourhood || address.quarter || ''; // 例: 新北野一丁目
    var road = address.road || address.hamlet || '';
    var houseNumber = address.house_number || '';
    var building = address.building || '';

    var parts = [pref, city, ward, neighbourhood, road, houseNumber, building].filter(
      function (s) {
        return s && s.length > 0;
      }
    );

    if (parts.length === 0) {
      return data.display_name || formatLatLng_(lat, lng);
    }
    return parts.join('');
  } catch (e) {
    // ネットワークエラー等。打刻自体は継続させるため例外は投げない。
    var errMsg = e && e.message ? e.message : String(e);
    console.log('住所取得(Nominatim)で例外が発生しました: ' + errMsg);
    // 詳しい例外メッセージは実行ログで確認できる。
    return formatLatLng_(lat, lng);
  }
}

/**
 * 住所への変換ができなかった場合の代わりの表示。
 * 「取得できませんでした」のような曖昧な文言だと、位置情報自体が
 * 取得できているのかどうか本人に伝わりにくいため、実際に届いている
 * 緯度・経度をそのまま数値で見せることで「位置情報自体は正しく
 * 取得できている」ことが一目でわかるようにする。
 * @param {number} lat
 * @param {number} lng
 * @return {string}
 */
function formatLatLng_(lat, lng) {
  return '緯度' + lat.toFixed(6) + ' 経度' + lng.toFixed(6);
}
