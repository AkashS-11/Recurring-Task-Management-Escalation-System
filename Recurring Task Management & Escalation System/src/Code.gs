/**
 * @fileoverview Code.gs - Main Entry Points & Installable Event Handlers
 * Contains onOpen custom menu initialization and the installable handleEdit(e) trigger.
 */

/**
 * Custom menu creation hook on spreadsheet open.
 * @param {GoogleAppsScript.Events.SheetsOnOpen} e
 */
function onOpen(e) {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("Task System")
    .addItem("Run Setup", "setupAll")
    .addItem("Install Triggers", "installTriggers")
    .addItem("Run Daily Job Now", "runDailyJobNow")
    .addSeparator()
    .addItem("Refresh Dashboards", "refreshDashboardsAction")
    .addItem("Run Recurrence Self-Check", "runRecurrenceSelfCheckAction")
    .addItem("Run System Health Check", "runHealthCheckAction")
    .addItem("Run All Tests", "runAllTestsAction")
    .addItem("Demo Escalation Timeline", "demoEscalationTimelineAction")
    .addToUi();
}

/**
 * Installable edit trigger handler.
 * Dispatches task completions from Employee Dashboard and manager acknowledgements
 * from Manager Dashboard. Defensively processes multi-cell ranges.
 *
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 */
function handleEdit(e) {
  if (!e || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();
  var sheetName = sheet.getName();

  // Route 1: Employee Dashboard interactions
  if (sheetName === SCHEMA.EMPLOYEE_DASHBOARD.SHEET_NAME) {
    _handleEmployeeDashboardEdit(sheet, range);
    return;
  }

  // Route 2: Manager Dashboard interactions
  if (sheetName === SCHEMA.MANAGER_DASHBOARD.SHEET_NAME) {
    _handleManagerDashboardEdit(sheet, range);
    return;
  }
}

/**
 * Processes checkbox clicks on the Employee Dashboard.
 * Supports single-cell clicks and multi-cell paste events.
 * @private
 */
function _handleEmployeeDashboardEdit(sheet, range) {
  var startRow = range.getRow();
  var numRows = range.getNumRows();
  var startCol = range.getColumn();
  var numCols = range.getNumColumns();

  // Column H is Col 8 (Mark Complete)
  // Column G is Col 7 (Ticket ID / Proof)
  var checkCol = Utils.getHeaderIndex(sheet, SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.MARK_COMPLETE);
  var proofCol = Utils.getHeaderIndex(sheet, SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.TICKET_ID);
  var taskIdCol = Utils.getHeaderIndex(sheet, SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.TASK_ROW_ID);

  if (checkCol < 1 || startRow < 2) return;

  // Check if edited range overlaps the Mark Complete column
  var endCol = startCol + numCols - 1;
  if (startCol > checkCol || endCol < checkCol) {
    return; // Edit did not touch the checkbox column
  }

  for (var i = 0; i < numRows; i++) {
    var curRow = startRow + i;
    if (curRow < 2) continue;

    var isChecked = sheet.getRange(curRow, checkCol).getValue() === true;
    if (isChecked) {
      var taskRowId = String(sheet.getRange(curRow, taskIdCol).getValue()).trim();
      var proofVal = proofCol > 0 ? String(sheet.getRange(curRow, proofCol).getValue()).trim() : "";

      if (!taskRowId) {
        sheet.getRange(curRow, checkCol).setValue(false);
        continue;
      }

      var result = CompletionService.completeTask(taskRowId, "Dashboard", proofVal);

      if (result.success) {
        // Reset checkbox and clear proof cell
        sheet.getRange(curRow, checkCol).setValue(false);
        if (proofCol > 0) {
          sheet.getRange(curRow, proofCol).setValue("");
        }
        SpreadsheetApp.getActiveSpreadsheet().toast(result.message, "Task Complete", 4);

        // Refresh all dashboard views
        DashboardService.refreshAllDashboards();
      } else {
        // Revert checkbox on error and notify user
        sheet.getRange(curRow, checkCol).setValue(false);
        SpreadsheetApp.getActiveSpreadsheet().toast("Error: " + result.message, "Completion Failed", 6);
      }
    }
  }
}

/**
 * Processes manager acknowledgement changes on Manager Dashboard.
 * Automatically records the acknowledgement timestamp in Column G.
 * @private
 */
function _handleManagerDashboardEdit(sheet, range) {
  var startRow = range.getRow();
  var numRows = range.getNumRows();
  var startCol = range.getColumn();

  // Manager Overdue Table starts at Row 14, Acknowledgement is Column F (Col 6)
  var ackCol = Utils.getHeaderIndex(sheet, SCHEMA.MANAGER_DASHBOARD.FIELDS.ACKNOWLEDGEMENT, 14);
  var ackTsCol = Utils.getHeaderIndex(sheet, SCHEMA.MANAGER_DASHBOARD.FIELDS.ACKNOWLEDGEMENT_TIMESTAMP, 14);

  if (ackCol < 1 || startCol !== ackCol || startRow < 15) return;

  var config = Utils.getConfig();
  var timestampNow = Utilities.formatDate(new Date(), config.TIMEZONE, "yyyy-MM-dd HH:mm:ss");

  for (var i = 0; i < numRows; i++) {
    var curRow = startRow + i;
    var ackVal = String(sheet.getRange(curRow, ackCol).getValue()).trim();
    if (ackVal === "Acknowledged" && ackTsCol > 0) {
      sheet.getRange(curRow, ackTsCol).setValue(timestampNow);
    }
  }
}

// ---------------- Custom Menu Wrapper Actions ----------------

function refreshDashboardsAction() {
  DashboardService.refreshAllDashboards();
  SpreadsheetApp.getActiveSpreadsheet().toast("Dashboards refreshed successfully!", "Dashboard", 3);
}

function runDailyJobNow() {
  if (typeof dailyJob === "function") {
    dailyJob();
  } else {
    SpreadsheetApp.getActiveSpreadsheet().toast("Triggers module not yet loaded.", "Notice", 3);
  }
}

function runRecurrenceSelfCheckAction() {
  var res = TaskService.runRecurrenceSelfCheck();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Recurrence Self-Check: " + res.passed + " passed, " + res.failed + " failed.",
    "Self-Check Complete",
    5
  );
}

function runHealthCheckAction() {
  if (typeof ValidationService !== "undefined" && ValidationService.runSystemHealthCheck) {
    var res = ValidationService.runSystemHealthCheck();
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "Health Check: " + (res.healthy ? "ALL SYSTEMS HEALTHY" : res.errors.length + " ISSUES FOUND"),
      "Health Check",
      5
    );
  } else {
    SpreadsheetApp.getActiveSpreadsheet().toast("ValidationService not loaded yet.", "Notice", 3);
  }
}

function runAllTestsAction() {
  if (typeof runAllTests === "function") {
    runAllTests();
  } else {
    SpreadsheetApp.getActiveSpreadsheet().toast("Tests.gs module not yet loaded.", "Notice", 3);
  }
}

function demoEscalationTimelineAction() {
  if (typeof EscalationService !== "undefined" && EscalationService.demoEscalationTimeline) {
    EscalationService.demoEscalationTimeline();
  } else {
    SpreadsheetApp.getActiveSpreadsheet().toast("EscalationService module not yet loaded.", "Notice", 3);
  }
}
