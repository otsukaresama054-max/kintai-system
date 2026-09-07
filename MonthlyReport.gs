/**
 * MonthlyReport.gs
 * ------------------------------------------------------------
 * 「20日締め」の月次勤怠を、社員ごとに1枚のPDFとして出力する機能。
 *
 * スプレッドシートを開いたときに追加される「勤怠帳票」メニューの
 * 「月次PDFを出力」から手動で実行する(自動実行やメール送信はしない。
 * 実行するとGoogleドライブにPDFが保存され、そこで完結する)。
 *
 * PDFの中身は「日付・区分(出勤/退勤)・時刻・位置情報(簡易)」の
 * 一覧のみ。出勤/退勤をペアにした実働時間の自動計算は行わない
 * (中抜け等の運用は無い前提のため、単純な打刻一覧で十分としている)。
 * 「(拒否)」の区分(位置情報拒否の記録)はPDFには含めない。
 * ------------------------------------------------------------
 */

var REPORT_ROOT_FOLDER_NAME = '勤怠PDF';

/**
 * 【最初に1回だけ実行する】
 * このプロジェクトは「スプレッドシートに直接紐付いたスクリプト」ではなく
 * 単独のApps Scriptプロジェクトとして作っているため、onOpen(スプレッド
 * シートを開いたら自動で発火する仕組み)がそのままでは効かない。
 * その代わりに、ここで「installable trigger」という形でオープンイベントを
 * 明示的に登録する。実行後にスプレッドシートを開き直すと、上部メニューに
 * 「勤怠帳票」が表示されるようになる。
 *
 * 関数選択のプルダウンでこの関数(setupMenuTrigger)を選んで▶実行し、
 * 権限の承認を済ませればOK(以後この関数は再実行不要)。
 */
function setupMenuTrigger() {
  // 二重登録を防ぐため、既存の同名トリガーは一旦削除してから作り直す。
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onOpen') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('onOpen')
    .forSpreadsheet(getSpreadsheetId_())
    .onOpen()
    .create();

  Logger.log('「勤怠帳票」メニューを表示するトリガーを設定しました。スプレッドシートを開き直して確認してください。');
}

/**
 * スプレッドシートを開いたときに呼ばれる。
 * カスタムメニュー「勤怠帳票」を追加する。
 * (単独プロジェクトのため、上の setupMenuTrigger() を先に1回
 * 実行しておく必要がある)
 */
function onOpen(e) {
  SpreadsheetApp.getUi()
    .createMenu('勤怠帳票')
    .addItem('月次PDFを出力', 'generateMonthlyAttendancePdfs')
    .addToUi();
}

/**
 * 月次PDF出力のメイン処理。「勤怠帳票」メニューから呼ばれる。
 */
function generateMonthlyAttendancePdfs() {
  var ui = SpreadsheetApp.getUi();

  var response = ui.prompt(
    '月次PDFを出力',
    '対象の締め月を「年-月」の形式で入力してください(例: 2026-09)\n' +
      '※ 前月21日 〜 入力した月の20日 までが対象になります。',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var input = response.getResponseText().trim();
  var m = input.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) {
    ui.alert('入力形式が正しくありません。「2026-09」のように入力し直してください。');
    return;
  }
  var year = Number(m[1]);
  var month = Number(m[2]); // 1〜12

  // 対象期間: 前月21日 0:00:00 〜 入力月20日 23:59:59
  var periodStart = new Date(year, month - 2, 21, 0, 0, 0);
  var periodEnd = new Date(year, month - 1, 20, 23, 59, 59);

  var byEmployee = collectAttendanceByEmployee_(periodStart, periodEnd);
  var employeeKeys = Object.keys(byEmployee);

  if (employeeKeys.length === 0) {
    ui.alert(
      '指定期間(' + formatDateJa_(periodStart) + ' 〜 ' + formatDateJa_(periodEnd) + ')の' +
        '打刻記録が見つかりませんでした。'
    );
    return;
  }

  var folder = getOrCreateReportFolder_(year, month);
  var count = 0;

  employeeKeys.forEach(function (key) {
    var employee = byEmployee[key];
    // 日付→時刻の順で並べ替え(文字列比較でOKな形式にしてある)
    employee.rows.sort(function (a, b) {
      var aKey = a.date + ' ' + a.time;
      var bKey = b.date + ' ' + b.time;
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });

    var pdfBlob = buildAttendancePdf_(employee.name, year, month, periodStart, periodEnd, employee.rows);
    folder.createFile(pdfBlob).setName(employee.name + '.pdf');
    count++;
  });

  ui.alert(
    '完了しました。' + count + '名分のPDFを出力しました。\n\n' +
      '保存先フォルダ: ' + folder.getName() + '\n' +
      folder.getUrl()
  );
}

/**
 * Recordsシートから指定期間内の出勤/退勤レコードを集め、
 * 社員(LINE UserID)ごとにまとめる。「(拒否)」の行は除外する。
 *
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @return {Object} { [lineUserIdまたは氏名]: { name: string, rows: Array } }
 */
function collectAttendanceByEmployee_(periodStart, periodEnd) {
  var sheet = getAttendanceSheet_();
  var lastRow = sheet.getLastRow();
  var byEmployee = {};
  if (lastRow < 2) return byEmployee;

  // A:タイムスタンプ B:氏名 C:日付 D:区分 E:時刻 F:緯度 G:経度 H:住所 I:LINE UserID J:備考
  var values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

  values.forEach(function (row) {
    var timestamp = row[0];
    var name = row[1];
    var dateStr = row[2];
    var type = row[3];
    var time = row[4];
    var address = row[7];
    var userId = row[8];

    if (type !== '出勤' && type !== '退勤') return; // 「(拒否)」等は除外
    if (!(timestamp instanceof Date)) return;
    if (timestamp < periodStart || timestamp > periodEnd) return;

    var key = userId || name;
    if (!byEmployee[key]) {
      byEmployee[key] = { name: name, rows: [] };
    }
    byEmployee[key].rows.push({
      date: dateStr,
      type: type,
      time: time,
      address: address,
    });
  });

  return byEmployee;
}

/**
 * 「勤怠PDF」フォルダ(無ければ作成)の下に、対象月のサブフォルダを用意する。
 * @param {number} year
 * @param {number} month
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getOrCreateReportFolder_(year, month) {
  var rootFolders = DriveApp.getFoldersByName(REPORT_ROOT_FOLDER_NAME);
  var root = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(REPORT_ROOT_FOLDER_NAME);

  var subName = year + '年' + pad2Report_(month) + '月分';
  var subFolders = root.getFoldersByName(subName);
  return subFolders.hasNext() ? subFolders.next() : root.createFolder(subName);
}

/**
 * 1人分の出退勤一覧を、見やすく整形したPDFのBlobとして生成する。
 * 実装としては「一時的なスプレッドシートに表を組んでPDFエクスポートし、
 * 一時スプレッドシートは削除する」という方法をとっている。
 */
function buildAttendancePdf_(name, year, month, periodStart, periodEnd, rows) {
  var tmpSs = SpreadsheetApp.create(
    '_tmp_勤怠帳票_' + name + '_' + new Date().getTime()
  );
  var sheet = tmpSs.getSheets()[0];

  var title =
    name + ' 様 出退勤記録(' + year + '年' + pad2Report_(month) + '月分・' +
    formatDateJa_(periodStart) + '〜' + formatDateJa_(periodEnd) + ')';

  sheet.getRange(1, 1, 1, 4).merge();
  sheet.getRange(1, 1).setValue(title).setFontWeight('bold').setFontSize(13);

  var header = ['日付', '区分', '時刻', '位置情報(簡易)'];
  sheet.getRange(3, 1, 1, header.length)
    .setValues([header])
    .setFontWeight('bold')
    .setBackground('#eef3fb');

  if (rows.length > 0) {
    var tableValues = rows.map(function (r) {
      return [r.date, r.type, r.time, r.address];
    });
    sheet.getRange(4, 1, tableValues.length, 4).setValues(tableValues);
  } else {
    sheet.getRange(4, 1).setValue('(対象期間内の記録はありません)');
  }

  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 70);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 280);
  SpreadsheetApp.flush();

  var pdfBlob = exportSheetAsPdf_(tmpSs.getId(), sheet.getSheetId());

  // 一時スプレッドシートはもう不要なのでゴミ箱に移動する。
  DriveApp.getFileById(tmpSs.getId()).setTrashed(true);

  return pdfBlob.setName(name + '.pdf');
}

/**
 * 指定スプレッドシート内の指定シートを、PDFのBlobとしてエクスポートする。
 */
function exportSheetAsPdf_(spreadsheetId, sheetId) {
  var url =
    'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export' +
    '?format=pdf&gid=' + sheetId +
    '&portrait=true&fitw=true&gridlines=false&printtitle=false' +
    '&sheetnames=false&pagenumbers=false' +
    '&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5';

  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
  });
  return response.getBlob();
}

function pad2Report_(n) {
  return n < 10 ? '0' + n : String(n);
}

function formatDateJa_(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd');
}
