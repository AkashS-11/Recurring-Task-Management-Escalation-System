/**
 * @fileoverview DashboardService.gs - Interactive Presentation Engine
 * Renders and refreshes the Employee Dashboard, Manager Dashboard, and Escalation Dashboard
 * using batched operations while preserving interactive manager acknowledgements.
 */

var DashboardService = {
  /**
   * Refreshes all three presentation dashboards in batch.
   */
  refreshAllDashboards: function() {
    Utils.withErrorHandling("DashboardService.refreshAllDashboards", function() {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var config = Utils.getConfig();
      var todayStr = Utils.getToday(config);

      DashboardService.renderEmployeeDashboard(ss, config, todayStr);
      DashboardService.renderManagerDashboard(ss, config, todayStr);
      DashboardService.renderEscalationDashboard(ss, config, todayStr);

      AppLogger.info("DashboardService.refreshAllDashboards", "All dashboards successfully refreshed.");
    });
  },

  /**
   * Renders the Employee Dashboard - the single input surface for employees.
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
   * @param {ConfigMap} [config]
   * @param {string} [todayStr]
   */
  renderEmployeeDashboard: function(spreadsheet, config, todayStr) {
    var ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
    var cfg = config || Utils.getConfig();
    var today = todayStr || Utils.getToday(cfg);

    var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
    var empSheet = ss.getSheetByName(SCHEMA.EMPLOYEE_DASHBOARD.SHEET_NAME);
    if (!tmSheet || !empSheet) return;

    var tmData = tmSheet.getDataRange().getValues();
    if (tmData.length < 2) return;

    var tmMap = Utils.getHeaderMap(tmSheet);
    var colTaskId = tmMap[SCHEMA.TASK_MASTER.FIELDS.TASK_ROW_ID] - 1;
    var colTaskName = tmMap[SCHEMA.TASK_MASTER.FIELDS.TASK_NAME] - 1;
    var colEmpName = tmMap[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_NAME] - 1;
    var colFreq = tmMap[SCHEMA.TASK_MASTER.FIELDS.FREQUENCY] - 1;
    var colDueDate = tmMap[SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE] - 1;
    var colStatus = tmMap[SCHEMA.TASK_MASTER.FIELDS.STATUS] - 1;
    var colProofReq = tmMap[SCHEMA.TASK_MASTER.FIELDS.PROOF_REQUIRED] - 1;
    var colLastComp = tmMap[SCHEMA.TASK_MASTER.FIELDS.LAST_COMPLETED_AT] - 1;
    var colActive = tmMap[SCHEMA.TASK_MASTER.FIELDS.ACTIVE] - 1;

    // Cache any existing unsaved ticket IDs typed by employees
    var existingProofs = {};
    if (empSheet.getLastRow() > 1) {
      var existingEmpData = empSheet.getRange(2, 1, empSheet.getLastRow() - 1, 8).getValues();
      for (var e = 0; e < existingEmpData.length; e++) {
        var existingTaskId = String(existingEmpData[e][0]).trim();
        var existingProof = String(existingEmpData[e][6]).trim();
        if (existingTaskId && existingProof) {
          existingProofs[existingTaskId] = existingProof;
        }
      }
    }

    var outputRows = [];
    for (var r = 1; r < tmData.length; r++) {
      var row = tmData[r];
      var active = String(row[colActive]).toUpperCase();
      if (active !== "Y") continue;

      var taskId = String(row[colTaskId]).trim();
      var dueDate = Utils.formatDateOnly(row[colDueDate], cfg.TIMEZONE);
      var lastCompleted = row[colLastComp] ? Utils.formatDateOnly(row[colLastComp], cfg.TIMEZONE) : "";
      var preservedProof = existingProofs[taskId] || "";

      outputRows.push([
        taskId,                                   // Col A: Task Row ID (Hidden)
        String(row[colEmpName]).trim(),           // Col B: Employee Name
        String(row[colTaskName]).trim(),           // Col C: Task Name
        String(row[colFreq]).trim(),               // Col D: Frequency
        dueDate,                                  // Col E: Due Date
        String(row[colStatus]).trim(),             // Col F: Status
        preservedProof,                           // Col G: Ticket ID / Proof (Editable)
        false,                                    // Col H: Mark Complete (Checkbox)
        lastCompleted,                            // Col I: Last Completed At
        String(row[colProofReq]).trim()            // Col J: Proof Required?
      ]);
    }

    // Clear old data rows
    var currentLastRow = empSheet.getLastRow();
    if (currentLastRow > 1) {
      empSheet.getRange(2, 1, currentLastRow - 1, empSheet.getLastColumn()).clearContent();
    }

    if (outputRows.length > 0) {
      var targetRange = empSheet.getRange(2, 1, outputRows.length, 10);
      targetRange.setValues(outputRows);

      // Re-apply checkbox validation to Col H
      var checkRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
      empSheet.getRange(2, 8, outputRows.length, 1).setDataValidation(checkRule);
    }
  },

  /**
   * Renders the Manager Dashboard with KPIs, Employee Summary, and Overdue Tasks.
   * Crucially preserves manager acknowledgement notes and timestamps by matching on Cycle ID.
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
   * @param {ConfigMap} [config]
   * @param {string} [todayStr]
   */
  renderManagerDashboard: function(spreadsheet, config, todayStr) {
    var ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
    var cfg = config || Utils.getConfig();
    var today = todayStr || Utils.getToday(cfg);

    var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
    var mgrSheet = ss.getSheetByName(SCHEMA.MANAGER_DASHBOARD.SHEET_NAME);
    if (!tmSheet || !mgrSheet) return;

    // Step 1: Read and cache existing Manager Acknowledgements by Cycle ID
    var ackCache = {};
    if (mgrSheet.getLastRow() >= 15) {
      var numOverdueRows = mgrSheet.getLastRow() - 14;
      var existingOverdueData = mgrSheet.getRange(15, 1, numOverdueRows, 8).getValues();
      for (var a = 0; a < existingOverdueData.length; a++) {
        var cycleId = String(existingOverdueData[a][0]).trim();
        var ackVal = String(existingOverdueData[a][5]).trim();
        var ackTs = existingOverdueData[a][6];
        if (cycleId) {
          ackCache[cycleId] = {
            acknowledgement: ackVal || "Not Acknowledged",
            timestamp: ackTs || ""
          };
        }
      }
    }

    // Step 2: Calculate KPIs and aggregate Employee workloads
    var tmData = tmSheet.getDataRange().getValues();
    var tmMap = Utils.getHeaderMap(tmSheet);

    var totalPending = 0;
    var totalOverdue = 0;
    var totalCompleted = 0;
    var empWorkload = {};
    var overdueTasks = [];

    for (var r = 1; r < tmData.length; r++) {
      var row = tmData[r];
      if (String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.ACTIVE] - 1]).toUpperCase() !== "Y") continue;

      var empEmail = String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_EMAIL] - 1]).trim().toLowerCase();
      var empName = String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_NAME] - 1]).trim();
      var status = String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.STATUS] - 1]).trim();
      var dueDate = Utils.formatDateOnly(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE] - 1], cfg.TIMEZONE);
      var cycleId = String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.CYCLE_ID] - 1]).trim();
      var taskName = String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.TASK_NAME] - 1]).trim();

      if (!empWorkload[empEmail]) {
        empWorkload[empEmail] = { name: empName, pending: 0, overdue: 0, oldestOverdueDays: 0 };
      }

      if (status === "Pending") {
        totalPending++;
        empWorkload[empEmail].pending++;
      } else if (status === "Overdue") {
        totalOverdue++;
        empWorkload[empEmail].overdue++;
        var daysOverdue = Math.max(0, Utils.daysBetween(today, dueDate));
        if (daysOverdue > empWorkload[empEmail].oldestOverdueDays) {
          empWorkload[empEmail].oldestOverdueDays = daysOverdue;
        }

        var tier = daysOverdue >= cfg.LEADERSHIP_ALERT_DAY ? "Day 5 Leadership" : "Day 2 Manager";
        var cachedAck = ackCache[cycleId] || { acknowledgement: "Not Acknowledged", timestamp: "" };

        overdueTasks.push([
          cycleId,
          taskName,
          empName,
          dueDate,
          daysOverdue,
          cachedAck.acknowledgement,
          cachedAck.timestamp,
          tier
        ]);
      } else if (status === "Completed") {
        totalCompleted++;
      }
    }

    // Step 3: Render Manager Dashboard Layout
    mgrSheet.clear();

    // Render KPI Cards (Rows 1-3)
    mgrSheet.getRange("A1:C1").merge().setValue("MANAGER OPERATIONAL DASHBOARD")
      .setFontWeight("bold").setFontSize(14).setBackground("#1A73E8").setFontColor("#FFFFFF");

    mgrSheet.getRange("A2:B2").setValues([["Total Pending Tasks", totalPending]])
      .setFontWeight("bold").setBackground("#FEF7E0");
    mgrSheet.getRange("C2:D2").setValues([["Total Overdue Tasks", totalOverdue]])
      .setFontWeight("bold").setBackground("#FCE8E6");
    mgrSheet.getRange("E2:F2").setValues([["Completed This Cycle", totalCompleted]])
      .setFontWeight("bold").setBackground("#E6F4EA");

    // Render Employee Workload Summary (Rows 5-11)
    mgrSheet.getRange("A5:E5").setValues([[
      "Employee Name", "Employee Email", "Pending Tasks", "Overdue Tasks", "Oldest Overdue (Days)"
    ]]).setFontWeight("bold").setBackground("#34A853").setFontColor("#FFFFFF");

    var summaryRows = [];
    for (var email in empWorkload) {
      var item = empWorkload[email];
      summaryRows.push([item.name, email, item.pending, item.overdue, item.oldestOverdueDays]);
    }

    if (summaryRows.length > 0) {
      mgrSheet.getRange(6, 1, summaryRows.length, 5).setValues(summaryRows);
    }

    // Render Overdue Tasks Table (Rows 14+)
    var overdueHeaderRow = 14;
    mgrSheet.getRange(overdueHeaderRow, 1, 1, 8).setValues([[
      SCHEMA.MANAGER_DASHBOARD.FIELDS.CYCLE_ID,
      SCHEMA.MANAGER_DASHBOARD.FIELDS.TASK_NAME,
      SCHEMA.MANAGER_DASHBOARD.FIELDS.ASSIGNED_EMPLOYEE,
      SCHEMA.MANAGER_DASHBOARD.FIELDS.DUE_DATE,
      SCHEMA.MANAGER_DASHBOARD.FIELDS.DAYS_OVERDUE,
      SCHEMA.MANAGER_DASHBOARD.FIELDS.ACKNOWLEDGEMENT,
      SCHEMA.MANAGER_DASHBOARD.FIELDS.ACKNOWLEDGEMENT_TIMESTAMP,
      SCHEMA.MANAGER_DASHBOARD.FIELDS.ESCALATION_TIER
    ]]).setFontWeight("bold").setBackground("#C5221F").setFontColor("#FFFFFF");

    if (overdueTasks.length > 0) {
      mgrSheet.getRange(15, 1, overdueTasks.length, 8).setValues(overdueTasks);

      // Re-apply dropdown validation to Acknowledgement column (Col F)
      var ackRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Acknowledged", "Not Acknowledged"], true)
        .setAllowInvalid(false)
        .build();
      mgrSheet.getRange(15, 6, overdueTasks.length, 1).setDataValidation(ackRule);
    }

    // Hide Cycle ID column (Col A)
    mgrSheet.hideColumns(1);
  },

  /**
   * Renders the Escalation Dashboard for executive oversight.
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
   * @param {ConfigMap} [config]
   * @param {string} [todayStr]
   */
  renderEscalationDashboard: function(spreadsheet, config, todayStr) {
    var ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
    var cfg = config || Utils.getConfig();
    var today = todayStr || Utils.getToday(cfg);

    var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
    var escSheet = ss.getSheetByName(SCHEMA.ESCALATION_DASHBOARD.SHEET_NAME);
    if (!tmSheet || !escSheet) return;

    var tmData = tmSheet.getDataRange().getValues();
    var tmMap = Utils.getHeaderMap(tmSheet);

    var escalationRows = [];
    for (var r = 1; r < tmData.length; r++) {
      var row = tmData[r];
      if (String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.ACTIVE] - 1]).toUpperCase() !== "Y") continue;

      var status = String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.STATUS] - 1]).trim();
      var dueDate = Utils.formatDateOnly(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE] - 1], cfg.TIMEZONE);
      var daysOverdue = Math.max(0, Utils.daysBetween(today, dueDate));

      // Escalation dashboard includes tasks >= MANAGER_ALERT_DAY (e.g. 2 days overdue)
      if (status === "Overdue" && daysOverdue >= cfg.MANAGER_ALERT_DAY) {
        var empEmail = String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_EMAIL] - 1]).trim();
        var empName = String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_NAME] - 1]).trim();
        var taskName = String(row[tmMap[SCHEMA.TASK_MASTER.FIELDS.TASK_NAME] - 1]).trim();
        var mgrEmail = Utils.getManagerEmail(empEmail, cfg);
        var remSent = row[tmMap[SCHEMA.TASK_MASTER.FIELDS.REMINDER_SENT_AT] - 1] || "";
        var mgrSent = row[tmMap[SCHEMA.TASK_MASTER.FIELDS.MANAGER_ALERT_SENT_AT] - 1] || "";
        var leadSent = row[tmMap[SCHEMA.TASK_MASTER.FIELDS.LEADERSHIP_ALERT_SENT_AT] - 1] || "";

        var tier = daysOverdue >= cfg.LEADERSHIP_ALERT_DAY ? "CRITICAL (Day 5+)" : "WARNING (Day 2+)";

        escalationRows.push([
          tier,
          taskName,
          empName,
          mgrEmail,
          dueDate,
          daysOverdue,
          remSent,
          mgrSent,
          leadSent
        ]);
      }
    }

    // Clear old data rows
    if (escSheet.getLastRow() > 1) {
      escSheet.getRange(2, 1, escSheet.getLastRow() - 1, escSheet.getLastColumn()).clearContent();
    }

    if (escalationRows.length > 0) {
      escSheet.getRange(2, 1, escalationRows.length, 9).setValues(escalationRows);
    }
  }
};
