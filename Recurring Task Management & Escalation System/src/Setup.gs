/**
 * @fileoverview Setup.gs - One-Click Automated Setup & Schema Provisioning
 * Orchestrates idempotent creation of sheets, headers, data validations,
 * conditional formatting rules, named ranges, protections, and seed data.
 */

/**
 * Master setup orchestrator. Can be run multiple times safely without duplicating
 * sheets, rules, triggers, or seed records.
 */
function setupAll() {
  Utils.withErrorHandling("setupAll", function() {
    AppLogger.info("setupAll", "Starting automated setup of Recurring Task System...");
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    setupSheets(ss);
    setupHeaders(ss);
    setupValidation(ss);
    setupConditionalFormatting(ss);
    setupNamedRanges(ss);
    setupProtections(ss);
    seedSampleData(ss);

    // Initial dashboard render if DashboardService is loaded
    if (typeof DashboardService !== "undefined" && DashboardService.refreshAllDashboards) {
      DashboardService.refreshAllDashboards();
    }

    AppLogger.info("setupAll", "Setup completed successfully!");
    AppLogger.flush();
    SpreadsheetApp.getActiveSpreadsheet().toast("Task System setup completed successfully!", "Setup Complete", 5);
  });
}

/**
 * Ensures all seven required system sheets exist in the active spreadsheet.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupSheets(ss) {
  var requiredSheets = [
    SCHEMA.TASK_MASTER.SHEET_NAME,
    SCHEMA.EMPLOYEE_DASHBOARD.SHEET_NAME,
    SCHEMA.COMPLETION_LOG.SHEET_NAME,
    SCHEMA.MANAGER_DASHBOARD.SHEET_NAME,
    SCHEMA.ESCALATION_DASHBOARD.SHEET_NAME,
    SCHEMA.CONFIG.SHEET_NAME,
    SCHEMA.ERROR_LOG.SHEET_NAME
  ];

  for (var i = 0; i < requiredSheets.length; i++) {
    var name = requiredSheets[i];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      ss.insertSheet(name);
      AppLogger.info("setupSheets", "Created missing sheet: " + name);
    }
  }

  // Remove default 'Sheet1' if present and our sheets are created
  var defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    try {
      ss.deleteSheet(defaultSheet);
    } catch (e) {
      // Ignored if cannot delete
    }
  }
}

/**
 * Populates header rows, freezes header panes, and sets styling.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupHeaders(ss) {
  var headerSpecs = {};

  headerSpecs[SCHEMA.TASK_MASTER.SHEET_NAME] = [
    SCHEMA.TASK_MASTER.FIELDS.TASK_ROW_ID,
    SCHEMA.TASK_MASTER.FIELDS.TASK_NAME,
    SCHEMA.TASK_MASTER.FIELDS.DESCRIPTION,
    SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_EMAIL,
    SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_NAME,
    SCHEMA.TASK_MASTER.FIELDS.FREQUENCY,
    SCHEMA.TASK_MASTER.FIELDS.ANCHOR_DATE,
    SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE,
    SCHEMA.TASK_MASTER.FIELDS.STATUS,
    SCHEMA.TASK_MASTER.FIELDS.PROOF_REQUIRED,
    SCHEMA.TASK_MASTER.FIELDS.LAST_COMPLETED_AT,
    SCHEMA.TASK_MASTER.FIELDS.LAST_COMPLETED_BY,
    SCHEMA.TASK_MASTER.FIELDS.CYCLE_ID,
    SCHEMA.TASK_MASTER.FIELDS.REMINDER_SENT_AT,
    SCHEMA.TASK_MASTER.FIELDS.MANAGER_ALERT_SENT_AT,
    SCHEMA.TASK_MASTER.FIELDS.LEADERSHIP_ALERT_SENT_AT,
    SCHEMA.TASK_MASTER.FIELDS.ACTIVE
  ];

  headerSpecs[SCHEMA.EMPLOYEE_DASHBOARD.SHEET_NAME] = [
    SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.TASK_ROW_ID,
    SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.EMPLOYEE_NAME,
    SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.TASK_NAME,
    SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.FREQUENCY,
    SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.DUE_DATE,
    SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.STATUS,
    SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.TICKET_ID,
    SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.MARK_COMPLETE,
    SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.LAST_COMPLETED_AT,
    SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.PROOF_REQUIRED
  ];

  headerSpecs[SCHEMA.COMPLETION_LOG.SHEET_NAME] = [
    SCHEMA.COMPLETION_LOG.FIELDS.LOG_ID,
    SCHEMA.COMPLETION_LOG.FIELDS.CYCLE_ID,
    SCHEMA.COMPLETION_LOG.FIELDS.TASK_ROW_ID,
    SCHEMA.COMPLETION_LOG.FIELDS.TASK_NAME,
    SCHEMA.COMPLETION_LOG.FIELDS.EMPLOYEE_EMAIL,
    SCHEMA.COMPLETION_LOG.FIELDS.COMPLETED_BY,
    SCHEMA.COMPLETION_LOG.FIELDS.COMPLETED_AT,
    SCHEMA.COMPLETION_LOG.FIELDS.SCHEDULED_DUE_DATE,
    SCHEMA.COMPLETION_LOG.FIELDS.DAYS_LATE,
    SCHEMA.COMPLETION_LOG.FIELDS.PROOF_TICKET_ID,
    SCHEMA.COMPLETION_LOG.FIELDS.SOURCE
  ];

  headerSpecs[SCHEMA.ESCALATION_DASHBOARD.SHEET_NAME] = [
    SCHEMA.ESCALATION_DASHBOARD.FIELDS.SEVERITY_TIER,
    SCHEMA.ESCALATION_DASHBOARD.FIELDS.TASK_NAME,
    SCHEMA.ESCALATION_DASHBOARD.FIELDS.EMPLOYEE_NAME,
    SCHEMA.ESCALATION_DASHBOARD.FIELDS.MANAGER_EMAIL,
    SCHEMA.ESCALATION_DASHBOARD.FIELDS.DUE_DATE,
    SCHEMA.ESCALATION_DASHBOARD.FIELDS.DAYS_OVERDUE,
    SCHEMA.ESCALATION_DASHBOARD.FIELDS.REMINDER_SENT_AT,
    SCHEMA.ESCALATION_DASHBOARD.FIELDS.MANAGER_ALERT_SENT_AT,
    SCHEMA.ESCALATION_DASHBOARD.FIELDS.LEADERSHIP_ALERT_SENT_AT
  ];

  headerSpecs[SCHEMA.ERROR_LOG.SHEET_NAME] = [
    SCHEMA.ERROR_LOG.FIELDS.TIMESTAMP,
    SCHEMA.ERROR_LOG.FIELDS.LEVEL,
    SCHEMA.ERROR_LOG.FIELDS.FUNCTION,
    SCHEMA.ERROR_LOG.FIELDS.MESSAGE,
    SCHEMA.ERROR_LOG.FIELDS.STACK,
    SCHEMA.ERROR_LOG.FIELDS.CONTEXT,
    SCHEMA.ERROR_LOG.FIELDS.USER,
    SCHEMA.ERROR_LOG.FIELDS.RESOLVED
  ];

  for (var sheetName in headerSpecs) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    var headers = headerSpecs[sheetName];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);

    // Apply clean header styling
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight("bold")
      .setBackground("#1A73E8")
      .setFontColor("#FFFFFF")
      .setFontFamily("Roboto")
      .setFontSize(10);
    sheet.setRowHeight(1, 32);
  }

  // Hide key column on Employee Dashboard (Column A: Task Row ID)
  var empDash = ss.getSheetByName(SCHEMA.EMPLOYEE_DASHBOARD.SHEET_NAME);
  if (empDash) {
    empDash.hideColumns(1);
  }
}

/**
 * Sets up data validation rules, dropdowns, and checkboxes.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupValidation(ss) {
  var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
  if (tmSheet) {
    var maxRows = Math.max(tmSheet.getMaxRows(), 100);

    // Frequencies dropdown (Col F)
    var freqCol = Utils.getHeaderIndex(tmSheet, SCHEMA.TASK_MASTER.FIELDS.FREQUENCY);
    if (freqCol > 0) {
      var freqRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Daily", "Every 7 days", "Every 15 days", "Monthly"], true)
        .setAllowInvalid(false)
        .build();
      tmSheet.getRange(2, freqCol, maxRows - 1, 1).setDataValidation(freqRule);
    }

    // Status dropdown (Col I)
    var statusCol = Utils.getHeaderIndex(tmSheet, SCHEMA.TASK_MASTER.FIELDS.STATUS);
    if (statusCol > 0) {
      var statusRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Pending", "Overdue", "Completed", "Paused"], true)
        .setAllowInvalid(false)
        .build();
      tmSheet.getRange(2, statusCol, maxRows - 1, 1).setDataValidation(statusRule);
    }

    // Proof Required dropdown (Col J)
    var proofCol = Utils.getHeaderIndex(tmSheet, SCHEMA.TASK_MASTER.FIELDS.PROOF_REQUIRED);
    if (proofCol > 0) {
      var ynRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Y", "N"], true)
        .setAllowInvalid(false)
        .build();
      tmSheet.getRange(2, proofCol, maxRows - 1, 1).setDataValidation(ynRule);
    }

    // Active dropdown (Col Q)
    var activeCol = Utils.getHeaderIndex(tmSheet, SCHEMA.TASK_MASTER.FIELDS.ACTIVE);
    if (activeCol > 0) {
      var ynRule2 = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Y", "N"], true)
        .setAllowInvalid(false)
        .build();
      tmSheet.getRange(2, activeCol, maxRows - 1, 1).setDataValidation(ynRule2);
    }
  }

  // Employee Dashboard: Mark Complete Checkboxes (Col H)
  var empSheet = ss.getSheetByName(SCHEMA.EMPLOYEE_DASHBOARD.SHEET_NAME);
  if (empSheet) {
    var maxEmpRows = Math.max(empSheet.getMaxRows(), 50);
    var checkCol = Utils.getHeaderIndex(empSheet, SCHEMA.EMPLOYEE_DASHBOARD.FIELDS.MARK_COMPLETE);
    if (checkCol > 0) {
      var checkRule = SpreadsheetApp.newDataValidation()
        .requireCheckbox()
        .setAllowInvalid(false)
        .build();
      empSheet.getRange(2, checkCol, maxEmpRows - 1, 1).setDataValidation(checkRule);
    }
  }
}

/**
 * Clears old formatting rules and applies clean conditional formatting.
 * Overdue: Red, Due Today: Amber, Completed: Green, Paused: Gray.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupConditionalFormatting(ss) {
  var sheetsToFormat = [
    SCHEMA.TASK_MASTER.SHEET_NAME,
    SCHEMA.EMPLOYEE_DASHBOARD.SHEET_NAME
  ];

  for (var s = 0; s < sheetsToFormat.length; s++) {
    var sheet = ss.getSheetByName(sheetsToFormat[s]);
    if (!sheet) continue;

    sheet.clearConditionalFormatRules();
    var lastRow = Math.max(sheet.getMaxRows(), 50);
    var statusCol = Utils.getHeaderIndex(sheet, "Status");
    if (statusCol < 1) continue;

    var range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn() || 10);
    var colLetter = String.fromCharCode(64 + statusCol);

    // Overdue -> Light Red
    var overdueRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=$" + colLetter + "2=\"Overdue\"")
      .setBackground("#FCE8E6")
      .setFontColor("#C5221F")
      .setRanges([range])
      .build();

    // Due Today / Pending -> Light Amber
    var pendingRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=$" + colLetter + "2=\"Pending\"")
      .setBackground("#FEF7E0")
      .setFontColor("#B06000")
      .setRanges([range])
      .build();

    // Completed -> Light Green
    var completedRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=$" + colLetter + "2=\"Completed\"")
      .setBackground("#E6F4EA")
      .setFontColor("#137333")
      .setRanges([range])
      .build();

    // Paused -> Light Gray
    var pausedRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=$" + colLetter + "2=\"Paused\"")
      .setBackground("#F1F3F4")
      .setFontColor("#5F6368")
      .setRanges([range])
      .build();

    sheet.setConditionalFormatRules([overdueRule, pendingRule, completedRule, pausedRule]);
  }
}

/**
 * Creates or resets standard named ranges.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupNamedRanges(ss) {
  var cfgSheet = ss.getSheetByName(SCHEMA.CONFIG.SHEET_NAME);
  if (cfgSheet) {
    _safeSetNamedRange(ss, "ConfigKeys", cfgSheet.getRange("A2:A20"));
    _safeSetNamedRange(ss, "ConfigValues", cfgSheet.getRange("B2:B20"));
    _safeSetNamedRange(ss, "EmployeeDirectory", cfgSheet.getRange("D2:F50"));
  }

  var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
  if (tmSheet) {
    _safeSetNamedRange(ss, "TaskMasterData", tmSheet.getRange("A2:Q100"));
  }
}

/**
 * Helper to remove existing named range and set fresh range.
 * @private
 */
function _safeSetNamedRange(ss, name, range) {
  var existing = ss.getRangeByName(name);
  if (existing) {
    ss.removeNamedRange(name);
  }
  ss.setNamedRange(name, range);
}

/**
 * Establishes protected ranges and permissions across sheets.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupProtections(ss) {
  var protectedSheetNames = [
    SCHEMA.TASK_MASTER.SHEET_NAME,
    SCHEMA.COMPLETION_LOG.SHEET_NAME,
    SCHEMA.CONFIG.SHEET_NAME,
    SCHEMA.ERROR_LOG.SHEET_NAME,
    SCHEMA.ESCALATION_DASHBOARD.SHEET_NAME
  ];

  for (var p = 0; p < protectedSheetNames.length; p++) {
    var sheet = ss.getSheetByName(protectedSheetNames[p]);
    if (!sheet) continue;

    var existingProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (existingProtections.length === 0) {
      var protection = sheet.protect().setDescription(protectedSheetNames[p] + " System Protection");
      protection.setWarningOnly(true); // Default to warning-only for collaborative safety
    }
  }
}

/**
 * Seeds initial sample data idempotently. If data already exists, seeding is skipped.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function seedSampleData(ss) {
  var cfgSheet = ss.getSheetByName(SCHEMA.CONFIG.SHEET_NAME);
  if (cfgSheet && cfgSheet.getLastRow() < 2) {
    // Block 1: Config Key-Values
    var configHeaders = [["Parameter Key", "Parameter Value", "", "Employee Email", "Employee Name", "Manager Email"]];
    cfgSheet.getRange(1, 1, 1, 6).setValues(configHeaders)
      .setFontWeight("bold")
      .setBackground("#1A73E8")
      .setFontColor("#FFFFFF");

    var configRows = [
      ["REMINDER_DAY", "0"],
      ["MANAGER_ALERT_DAY", "2"],
      ["LEADERSHIP_ALERT_DAY", "5"],
      ["RECURRENCE_BASIS", "SCHEDULED"],
      ["TIMEZONE", "Asia/Kolkata"],
      ["DEMO_DATE_OVERRIDE", ""],
      ["LEADERSHIP_EMAIL", "leadership@example.com"],
      ["DEFAULT_MANAGER_EMAIL", "default.manager@example.com"],
      ["ADMIN_EMAILS", "admin@example.com"],
      ["SEND_EMAILS", "FALSE"],
      ["TICKET_ID_PATTERN", "^.+$"],
      ["LOG_MAX_ROWS", "1000"]
    ];
    cfgSheet.getRange(2, 1, configRows.length, 2).setValues(configRows);

    // Block 2: Employee Directory
    var dirRows = [
      ["employee1@example.com", "Aarav Sharma", "manager1@example.com"],
      ["employee2@example.com", "Priya Patel", "manager1@example.com"],
      ["employee3@example.com", "Rohan Mehta", "manager2@example.com"]
    ];
    cfgSheet.getRange(2, 4, dirRows.length, 3).setValues(dirRows);
    AppLogger.info("seedSampleData", "Config sheet seeded.");
  }

  var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
  if (tmSheet && tmSheet.getLastRow() < 2) {
    var todayStr = Utils.getToday();
    var sampleRows = [
      [
        "TASK-001",
        "Daily Operations Standup Update",
        "WhatsApp-style daily checkin; submit standup notes",
        "employee1@example.com",
        "Aarav Sharma",
        "Daily",
        "2026-10-01",
        todayStr,
        "Pending",
        "N",
        "",
        "",
        "TASK-001|" + todayStr,
        "",
        "",
        "",
        "Y"
      ],
      [
        "TASK-002",
        "Portal Task A: Weekly Security Log Audit",
        "Review IAM logs, attach audit ticket ID",
        "employee2@example.com",
        "Priya Patel",
        "Every 7 days",
        "2026-10-05",
        "2026-10-24",
        "Overdue",
        "Y",
        "",
        "",
        "TASK-002|2026-10-24",
        "2026-10-24 08:00:00",
        "",
        "",
        "Y"
      ],
      [
        "TASK-003",
        "Portal Task B: Bi-Weekly Server Patching",
        "Patch test environments and attach change approval URL",
        "employee3@example.com",
        "Rohan Mehta",
        "Every 15 days",
        "2026-10-01",
        "2026-10-21",
        "Overdue",
        "Y",
        "",
        "",
        "TASK-003|2026-10-21",
        "2026-10-21 08:00:00",
        "2026-10-23 08:00:00",
        "",
        "Y"
      ],
      [
        "TASK-004",
        "Monthly Financial Reconciliation",
        "Close monthly vendor invoices; anchored on month end",
        "employee1@example.com",
        "Aarav Sharma",
        "Monthly",
        "2026-08-31",
        "2026-10-31",
        "Pending",
        "Y",
        "",
        "",
        "TASK-004|2026-10-31",
        "",
        "",
        "",
        "Y"
      ],
      [
        "TASK-005",
        "Portal Task C: Database Index Maintenance",
        "Run re-index script on analytics database",
        "employee2@example.com",
        "Priya Patel",
        "Every 7 days",
        "2026-10-12",
        todayStr,
        "Completed",
        "Y",
        "2026-10-26 08:15:00",
        "employee2@example.com",
        "TASK-005|" + todayStr,
        "2026-10-26 08:00:00",
        "",
        "",
        "Y"
      ],
      [
        "TASK-006",
        "Quarterly Disaster Recovery Drill",
        "Suspended pending infrastructure migration",
        "employee3@example.com",
        "Rohan Mehta",
        "Monthly",
        "2026-07-15",
        "2026-10-15",
        "Paused",
        "N",
        "",
        "",
        "TASK-006|2026-10-15",
        "",
        "",
        "",
        "N"
      ]
    ];

    tmSheet.getRange(2, 1, sampleRows.length, sampleRows[0].length).setValues(sampleRows);
    AppLogger.info("seedSampleData", "Task Master seeded with 6 sample rows.");
  }
}
