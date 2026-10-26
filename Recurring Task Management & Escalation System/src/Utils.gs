/**
 * @fileoverview Utils.gs - Shared Utility Module & Logging Framework
 * Core utilities including SCHEMA definitions, dynamic column resolution,
 * configuration management, date normalization, concurrency locks, and operational logging.
 */

/**
 * Global schema registry mapping logical keys to exact sheet header strings.
 * Ensures scripts are impervious to UI column reordering.
 */
var SCHEMA = {
  TASK_MASTER: {
    SHEET_NAME: "Task Master",
    FIELDS: {
      TASK_ROW_ID: "Task Row ID",
      TASK_NAME: "Task Name",
      DESCRIPTION: "Description",
      EMPLOYEE_EMAIL: "Employee Email",
      EMPLOYEE_NAME: "Employee Name",
      FREQUENCY: "Frequency",
      ANCHOR_DATE: "Anchor Date",
      CURRENT_DUE_DATE: "Current Due Date",
      STATUS: "Status",
      PROOF_REQUIRED: "Proof Required",
      LAST_COMPLETED_AT: "Last Completed At",
      LAST_COMPLETED_BY: "Last Completed By",
      CYCLE_ID: "Cycle ID",
      REMINDER_SENT_AT: "Reminder Sent At",
      MANAGER_ALERT_SENT_AT: "Manager Alert Sent At",
      LEADERSHIP_ALERT_SENT_AT: "Leadership Alert Sent At",
      ACTIVE: "Active"
    }
  },
  EMPLOYEE_DASHBOARD: {
    SHEET_NAME: "Employee Dashboard",
    FIELDS: {
      TASK_ROW_ID: "Task Row ID",
      EMPLOYEE_NAME: "Employee Name",
      TASK_NAME: "Task Name",
      FREQUENCY: "Frequency",
      DUE_DATE: "Due Date",
      STATUS: "Status",
      TICKET_ID: "Ticket ID / Proof",
      MARK_COMPLETE: "Mark Complete",
      LAST_COMPLETED_AT: "Last Completed At",
      PROOF_REQUIRED: "Proof Required?"
    }
  },
  COMPLETION_LOG: {
    SHEET_NAME: "Completion Log",
    FIELDS: {
      LOG_ID: "Log ID",
      CYCLE_ID: "Cycle ID",
      TASK_ROW_ID: "Task Row ID",
      TASK_NAME: "Task Name",
      EMPLOYEE_EMAIL: "Employee Email",
      COMPLETED_BY: "Completed By",
      COMPLETED_AT: "Completed At",
      SCHEDULED_DUE_DATE: "Scheduled Due Date",
      DAYS_LATE: "Days Late",
      PROOF_TICKET_ID: "Proof / Ticket ID",
      SOURCE: "Source"
    }
  },
  MANAGER_DASHBOARD: {
    SHEET_NAME: "Manager Dashboard",
    FIELDS: {
      CYCLE_ID: "Cycle ID",
      TASK_NAME: "Task Name",
      ASSIGNED_EMPLOYEE: "Assigned Employee",
      DUE_DATE: "Due Date",
      DAYS_OVERDUE: "Days Overdue",
      ACKNOWLEDGEMENT: "Acknowledgement",
      ACKNOWLEDGEMENT_TIMESTAMP: "Acknowledgement Timestamp",
      ESCALATION_TIER: "Escalation Tier"
    }
  },
  ESCALATION_DASHBOARD: {
    SHEET_NAME: "Escalation Dashboard",
    FIELDS: {
      SEVERITY_TIER: "Severity Tier",
      TASK_NAME: "Task Name",
      EMPLOYEE_NAME: "Employee Name",
      MANAGER_EMAIL: "Manager Email",
      DUE_DATE: "Due Date",
      DAYS_OVERDUE: "Days Overdue",
      REMINDER_SENT_AT: "Reminder Sent At",
      MANAGER_ALERT_SENT_AT: "Manager Alert Sent At",
      LEADERSHIP_ALERT_SENT_AT: "Leadership Alert Sent At"
    }
  },
  CONFIG: {
    SHEET_NAME: "Config"
  },
  ERROR_LOG: {
    SHEET_NAME: "Error Log",
    FIELDS: {
      TIMESTAMP: "Timestamp",
      LEVEL: "Level",
      FUNCTION: "Function",
      MESSAGE: "Message",
      STACK: "Stack",
      CONTEXT: "Context (JSON)",
      USER: "User",
      RESOLVED: "Resolved"
    }
  }
};

/**
 * Shared utility namespace.
 */
var Utils = {
  SCHEMA: SCHEMA,

  /**
   * Internal memory buffer for batched log writes.
   * @private
   */
  _logBuffer: [],

  /**
   * In-memory cache for admin critical error rate limiting (at most 1 notification per hour).
   * @private
   */
  _lastAdminAlertTimestamp: 0,

  /**
   * Retrieves a dynamic 1-based header column mapping for a given sheet.
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {number} [headerRow=1]
   * @return {Object.<string, number>} Map of header text to 1-based column index
   */
  getHeaderMap: function(sheet, headerRow) {
    var row = headerRow || 1;
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return {};
    var headers = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
    var map = {};
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c]).trim();
      if (h) {
        map[h] = c + 1;
      }
    }
    return map;
  },

  /**
   * Resolves the 1-based column index for a specific header name.
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {string} headerName
   * @param {number} [headerRow=1]
   * @return {number} 1-based column index, or -1 if not found
   */
  getHeaderIndex: function(sheet, headerName, headerRow) {
    var map = this.getHeaderMap(sheet, headerRow);
    return map[headerName] || -1;
  },

  /**
   * Reads all system configuration key-value pairs and the employee directory from the Config sheet.
   * @return {ConfigMap}
   */
  getConfig: function() {
    var defaults = {
      REMINDER_DAY: 0,
      MANAGER_ALERT_DAY: 2,
      LEADERSHIP_ALERT_DAY: 5,
      RECURRENCE_BASIS: "SCHEDULED",
      TIMEZONE: "Asia/Kolkata",
      DEMO_DATE_OVERRIDE: "",
      LEADERSHIP_EMAIL: "leadership@example.com",
      DEFAULT_MANAGER_EMAIL: "default.manager@example.com",
      ADMIN_EMAILS: ["admin@example.com"],
      SEND_EMAILS: false,
      TICKET_ID_PATTERN: "^.+$",
      LOG_MAX_ROWS: 1000,
      employeeDirectory: {}
    };

    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SCHEMA.CONFIG.SHEET_NAME);
      if (!sheet) return defaults;

      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return defaults;

      // Read Key-Value pairs in Columns A & B
      var kvData = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (var i = 0; i < kvData.length; i++) {
        var key = String(kvData[i][0]).trim();
        var val = kvData[i][1];
        if (!key) continue;

        if (key === "REMINDER_DAY" || key === "MANAGER_ALERT_DAY" || key === "LEADERSHIP_ALERT_DAY" || key === "LOG_MAX_ROWS") {
          var num = parseInt(val, 10);
          defaults[key] = isNaN(num) ? defaults[key] : num;
        } else if (key === "SEND_EMAILS") {
          defaults[key] = String(val).toUpperCase() === "TRUE";
        } else if (key === "ADMIN_EMAILS") {
          defaults[key] = String(val).split(",").map(function(e) { return e.trim(); }).filter(Boolean);
        } else if (key === "DEMO_DATE_OVERRIDE") {
          defaults[key] = val instanceof Date ? Utilities.formatDate(val, defaults.TIMEZONE, "yyyy-MM-dd") : String(val).trim();
        } else {
          defaults[key] = String(val).trim();
        }
      }

      // Read Employee Directory in Columns D, E, F
      if (sheet.getLastColumn() >= 6) {
        var dirData = sheet.getRange(2, 4, lastRow - 1, 3).getValues();
        for (var d = 0; d < dirData.length; d++) {
          var empEmail = String(dirData[d][0]).trim().toLowerCase();
          var empName = String(dirData[d][1]).trim();
          var mgrEmail = String(dirData[d][2]).trim().toLowerCase();
          if (empEmail) {
            defaults.employeeDirectory[empEmail] = {
              email: empEmail,
              name: empName,
              managerEmail: mgrEmail || defaults.DEFAULT_MANAGER_EMAIL
            };
          }
        }
      }
    } catch (err) {
      console.warn("Utils.getConfig fallback to defaults due to error: " + err.message);
    }

    return defaults;
  },

  /**
   * Resolves the direct manager email for an assigned employee.
   * @param {string} employeeEmail
   * @param {ConfigMap} [config]
   * @return {string} Manager email
   */
  getManagerEmail: function(employeeEmail, config) {
    var cfg = config || this.getConfig();
    var cleanEmail = String(employeeEmail).trim().toLowerCase();
    if (cfg.employeeDirectory && cfg.employeeDirectory[cleanEmail] && cfg.employeeDirectory[cleanEmail].managerEmail) {
      return cfg.employeeDirectory[cleanEmail].managerEmail;
    }
    return cfg.DEFAULT_MANAGER_EMAIL || "default.manager@example.com";
  },

  /**
   * Returns today's date formatted as 'yyyy-MM-dd' in the configured timezone.
   * Respects DEMO_DATE_OVERRIDE if configured.
   * @param {ConfigMap} [config]
   * @return {string} Date string in 'yyyy-MM-dd'
   */
  getToday: function(config) {
    var cfg = config || this.getConfig();
    if (cfg.DEMO_DATE_OVERRIDE && cfg.DEMO_DATE_OVERRIDE.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return cfg.DEMO_DATE_OVERRIDE;
    }
    var tz = cfg.TIMEZONE || "Asia/Kolkata";
    return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  },

  /**
   * Formats a Date object or date string to 'yyyy-MM-dd'.
   * @param {Date|string} dateVal
   * @param {string} [tz]
   * @return {string}
   */
  formatDateOnly: function(dateVal, tz) {
    if (!dateVal) return "";
    var targetTz = tz || this.getConfig().TIMEZONE || "Asia/Kolkata";
    if (dateVal instanceof Date) {
      return Utilities.formatDate(dateVal, targetTz, "yyyy-MM-dd");
    }
    var str = String(dateVal).trim();
    if (str.match(/^\d{4}-\d{2}-\d{2}/)) {
      return str.substring(0, 10);
    }
    var parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return Utilities.formatDate(parsed, targetTz, "yyyy-MM-dd");
    }
    return str;
  },

  /**
   * Computes calendar elapsed days between two 'yyyy-MM-dd' dates: (dateA - dateB).
   * @param {string|Date} dateA
   * @param {string|Date} dateB
   * @return {number} Integer days difference
   */
  daysBetween: function(dateA, dateB) {
    var strA = this.formatDateOnly(dateA);
    var strB = this.formatDateOnly(dateB);
    if (!strA || !strB) return 0;

    var partsA = strA.split("-").map(function(p) { return parseInt(p, 10); });
    var partsB = strB.split("-").map(function(p) { return parseInt(p, 10); });

    var utcA = Date.UTC(partsA[0], partsA[1] - 1, partsA[2]);
    var utcB = Date.UTC(partsB[0], partsB[1] - 1, partsB[2]);

    return Math.floor((utcA - utcB) / (24 * 60 * 60 * 1000));
  },

  /**
   * Standard execution wrapper providing centralized error handling and error logging.
   * @param {string} functionName
   * @param {Function} fn
   * @param {Object} [context]
   * @return {*} Result of fn() or null on failure
   */
  withErrorHandling: function(functionName, fn, context) {
    try {
      return fn();
    } catch (err) {
      AppLogger.error(functionName, err.message, {
        stack: err.stack,
        context: context || {}
      });
      return null;
    }
  },

  /**
   * Safely acquires an exclusive script lock with specified timeout.
   * @param {number} [timeoutMs=30000]
   * @return {GoogleAppsScript.Lock.Lock|null} Lock instance or null if timed out
   */
  acquireLock: function(timeoutMs) {
    var ms = timeoutMs || 30000;
    var lock = LockService.getScriptLock();
    try {
      var acquired = lock.tryLock(ms);
      return acquired ? lock : null;
    } catch (e) {
      console.warn("Utils.acquireLock exception: " + e.message);
      return null;
    }
  }
};

/**
 * Centralized logging framework. Buffers logs in memory and flushes in batch to Error Log sheet.
 */
var AppLogger = {
  /**
   * Logs an informational message.
   * @param {string} fn Function name
   * @param {string} msg Log message
   * @param {Object} [ctx] Context metadata
   */
  info: function(fn, msg, ctx) {
    console.info("[" + fn + "] " + msg, ctx || "");
    this._queue("INFO", fn, msg, null, ctx);
  },

  /**
   * Logs a warning message.
   * @param {string} fn Function name
   * @param {string} msg Log message
   * @param {Object} [ctx] Context metadata
   */
  warn: function(fn, msg, ctx) {
    console.warn("[" + fn + "] " + msg, ctx || "");
    this._queue("WARN", fn, msg, null, ctx);
  },

  /**
   * Logs an error message and stack trace. Automatically flushes and notifies admin if critical.
   * @param {string} fn Function name
   * @param {string} msg Error message
   * @param {Object} [ctx] Context metadata
   */
  error: function(fn, msg, ctx) {
    var stack = (ctx && ctx.stack) ? ctx.stack : "";
    console.error("[" + fn + "] " + msg + " Stack: " + stack, ctx || "");
    this._queue("ERROR", fn, msg, stack, ctx);
    this.flush(); // Flush immediately on error
    this._notifyAdminOnCriticalError(fn, msg, stack);
  },

  /**
   * Queues a log record into memory buffer with safety against serialization errors.
   * Redacts sensitive email bodies from context.
   * @private
   */
  _queue: function(level, fn, msg, stack, ctx) {
    var userEmail = "unknown";
    try {
      userEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || "script_runner";
    } catch (e) {
      userEmail = "system";
    }

    var timestamp = Utilities.formatDate(new Date(), Utils.getConfig().TIMEZONE || "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");

    // Redact sensitive text (e.g. email HTML bodies) before JSON stringification
    var safeCtx = {};
    if (ctx && typeof ctx === "object") {
      for (var key in ctx) {
        if (key.toLowerCase().indexOf("body") !== -1 || key.toLowerCase().indexOf("html") !== -1) {
          safeCtx[key] = "[REDACTED_BODY]";
        } else {
          safeCtx[key] = ctx[key];
        }
      }
    }

    var ctxStr = "";
    try {
      ctxStr = JSON.stringify(safeCtx);
    } catch (e) {
      ctxStr = "{\"serializationError\":\"" + e.message + "\"}";
    }

    Utils._logBuffer.push([
      timestamp,
      level,
      fn,
      String(msg),
      stack ? String(stack) : "",
      ctxStr,
      userEmail,
      "N"
    ]);
  },

  /**
   * Dispatches email notification to administrators on critical errors at most once per hour.
   * @private
   */
  _notifyAdminOnCriticalError: function(fn, msg, stack) {
    var now = new Date().getTime();
    if (now - Utils._lastAdminAlertTimestamp < 3600000) {
      return; // Throttled to once per hour
    }

    try {
      var config = Utils.getConfig();
      if (!config.SEND_EMAILS || !config.ADMIN_EMAILS || config.ADMIN_EMAILS.length === 0) {
        return;
      }

      var adminRecipient = config.ADMIN_EMAILS[0];
      var subject = "[CRITICAL ALERT] Task System Failure in " + fn;
      var body = "A critical system exception occurred in " + fn + ":\n\n" +
        "Message: " + msg + "\n" +
        "Stack: " + stack + "\n\n" +
        "Please check the Error Log sheet for full diagnostic context.";

      MailApp.sendEmail(adminRecipient, subject, body);
      Utils._lastAdminAlertTimestamp = now;
    } catch (e) {
      console.warn("Could not dispatch admin critical error email: " + e.message);
    }
  },

  /**
   * Flushes all queued log entries into the Error Log sheet in a single batch operation.
   */
  flush: function() {
    if (Utils._logBuffer.length === 0) return;
    var rowsToWrite = Utils._logBuffer.slice();
    Utils._logBuffer = [];

    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SCHEMA.ERROR_LOG.SHEET_NAME);
      if (!sheet) return;

      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rowsToWrite.length, 8).setValues(rowsToWrite);

      // Perform log rotation if total rows exceed LOG_MAX_ROWS
      var maxRows = Utils.getConfig().LOG_MAX_ROWS || 1000;
      var curRows = sheet.getLastRow();
      if (curRows > maxRows + 50) {
        var deleteCount = curRows - maxRows;
        sheet.deleteRows(2, deleteCount);
        console.info("Rotated " + deleteCount + " oldest rows from " + SCHEMA.ERROR_LOG.SHEET_NAME);
      }
    } catch (err) {
      console.warn("AppLogger.flush failed: " + err.message);
    }
  }
};
