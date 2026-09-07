/**
 * MonthlyReport.gs
 * ------------------------------------------------------------
 * 「20日締め」の月次勤怠を、全社員分まとめた1つのPDFとして出力する機能。
 *
 * スプレッドシートを開いたときに追加される「勤怠帳票」メニューの
 * 「月次PDFを出力」から手動で実行する(自動実行やメール送信はしない。
 * その場で開いて印刷する運用を想定しており、データを長期保管する
 * 前提ではないため、同じ対象月を再出力すると古いファイルは自動で
 * 上書き<削除>される)。
 *
 * PDFの中身は「日付・区分(出勤/退勤)・時刻・位置情報(簡易)」の
 * 一覧のみ。出勤/退勤をペアにした実働時間の自動計算は行わない
 * (中抜け等の運用は無い前提のため、単純な打刻一覧で十分としている)。
 * 「(拒否)」の区分(位置情報拒否の記録)はPDFには含めない。
 *
 * 実装上のポイント:
 * 複数人分を1つのPDFにまとめるため、スプレッドシートではなく
 * 一時的なGoogleドキュメントに社員ごとの表をページ区切りしながら
 * 積み上げていき、最後にPDFへ変換している(Googleドキュメントは
 * ページ区切りの制御やPDF変換がスプレッドシートより素直にできるため)。
 * ------------------------------------------------------------
 */

var REPORT_FOLDER_NAME = '勤怠PDF';

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

  // 氏名の五十音(文字コード)順に並べる
  employeeKeys.sort(function (a, b) {
    return byEmployee[a].name < byEmployee[b].name ? -1 : byEmployee[a].name > byEmployee[b].name ? 1 : 0;
  });

  var fileName = year + '年' + pad2Report_(month) + '月分_出退勤記録.pdf';
  var pdfBlob = buildCombinedAttendancePdf_(year, month, periodStart, periodEnd, employeeKeys, byEmployee);
  pdfBlob.setName(fileName);

  var folder = getOrCreateReportFolder_();

  // その場で印刷して使い切る運用のため、長期保管はしない。
  // 同じ月を再出力した場合、前回分は自動的に削除して1件だけ残す。
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }

  var file = folder.createFile(pdfBlob);

  ui.alert(
    '完了しました。以下のリンクを開いて印刷してください。\n\n' +
      file.getUrl() +
      '\n\n※ 印刷し終わったら、このファイルはドライブから削除してもらって問題ありません' +
      '(同じ月をもう一度出力すると自動的に上書きされます)。'
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
 * 「勤怠PDF」フォルダ(無ければ作成)を用意する。
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getOrCreateReportFolder_() {
  var folders = DriveApp.getFoldersByName(REPORT_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(REPORT_FOLDER_NAME);
}

/**
 * 全社員分の出退勤一覧を、社員ごとにページを分けながら1つの
 * Googleドキュメントにまとめ、PDFのBlobとして返す。
 * (一時的に作成したドキュメントはPDF変換後に削除する)
 */
function buildCombinedAttendancePdf_(year, month, periodStart, periodEnd, employeeKeys, byEmployee) {
  var doc = DocumentApp.create('_tmp_勤怠帳票_' + new Date().getTime());
  var body = doc.getBody();
  // 既定で入っている空段落は後で使うので保持しておく

  var periodLabel =
    year + '年' + pad2Report_(month) + '月分(' +
    formatDateJa_(periodStart) + '〜' + formatDateJa_(periodEnd) + ')';

  employeeKeys.forEach(function (key, index) {
    var employee = byEmployee[key];

    // 日付→時刻の順で並べ替え
    var rows = employee.rows.slice().sort(function (a, b) {
      var aKey = a.date + ' ' + a.time;
      var bKey = b.date + ' ' + b.time;
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });

    if (index > 0) {
      body.appendPageBreak();
    }

    body.appendParagraph(employee.name + ' 様').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(periodLabel);
    body.appendParagraph(''); // 表との間の余白

    var tableData = [['日付', '区分', '時刻', '位置情報(簡易)']];
    rows.forEach(function (r) {
      tableData.push([r.date, r.type, r.time, r.address]);
    });
    var table = body.appendTable(tableData);
    // ヘッダー行を太字にする
    var headerRow = table.getRow(0);
    for (var c = 0; c < headerRow.getNumCells(); c++) {
      headerRow.getCell(c).setBold(true);
    }
  });

  doc.saveAndClose();

  var pdfBlob = DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF);

  // 一時ドキュメントはもう不要なのでゴミ箱に移動する。
  DriveApp.getFileById(doc.getId()).setTrashed(true);

  return pdfBlob;
}

function pad2Report_(n) {
  return n < 10 ? '0' + n : String(n);
}

function formatDateJa_(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd');
}
