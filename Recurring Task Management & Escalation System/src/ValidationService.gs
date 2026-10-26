/**
 * @fileoverview ValidationService.gs - Centralized Validation Framework
 * Centralizes all data structure, configuration, business rule, and system health checks.
 * Every validator returns {ok: boolean, errors: string[]} and never throws unhandled exceptions.
 */

var ValidationService = {
  /**
   * Validates an email string. Supports corporate domains and test placeholders.
   * @param {string} email
   * @return {{ok: boolean, errors: string[]}}
   */
  validateEmail: function(email) {
    var str = String(email || "").trim();
    var errors = [];
    if (!str) {
      errors.push("Email address cannot be empty.");
    } else {
      var emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
      if (!emailRegex.test(str)) {
        errors.push("Invalid email format: '" + str + "'.");
      }
    }
    return { ok: errors.length === 0, errors: errors };
  },

  /**
   * Validates a frequency value against supported cadences.
   * @param {string} frequency
   * @return {{ok: boolean, errors: string[]}}
   */
  validateFrequency: function(frequency) {
    var valid = ["Daily", "Every 7 days", "Every 15 days", "Monthly"];
    var str = String(frequency || "").trim();
    var errors = [];
    if (valid.indexOf(str) === -1) {
      errors.push("Invalid frequency '" + str + "'. Must be one of: " + valid.join(", "));
    }
    return { ok: errors.length === 0, errors: errors };
  },

  /**
   * Validates a date value (Date object or yyyy-MM-dd string).
   * @param {Date|string} dateVal
   * @return {{ok: boolean, errors: string[]}}
   */
  validateDateValue: function(dateVal) {
    var errors = [];
    if (!dateVal) {
      errors.push("Date value cannot be empty.");
      return { ok: false, errors: errors };
    }
    if (dateVal instanceof Date) {
      if (isNaN(dateVal.getTime())) {
        errors.push("Invalid Date object.");
      }
    } else {
      var str = String(dateVal).trim();
      if (!str.match(/^\d{4}-\d{2}-\d{2}$/)) {
        errors.push("Date must follow format 'yyyy-MM-dd' (received '" + str + "').");
      } else {
        var parts = str.split("-").map(function(p) { return parseInt(p, 10); });
        var d = new Date(parts[0], parts[1] - 1, parts[2]);
        if (d.getFullYear() !== parts[0] || d.getMonth() !== (parts[1] - 1) || d.getDate() !== parts[2]) {
          errors.push("Date string represents a non-existent calendar date ('" + str + "').");
        }
      }
    }
    return { ok: errors.length === 0, errors: errors };
  },

  /**
   * Validates a ticket ID or proof submission against configured regex.
   * @param {string} ticketId
   * @param {ConfigMap} [config]
   * @return {{ok: boolean, errors: string[]}}
   */
  validateTicketId: function(ticketId, config) {
    var cfg = config || Utils.getConfig();
    var str = String(ticketId || "").trim();
    var errors = [];

    if (!str) {
      errors.push("Ticket ID / Proof cannot be empty.");
      return { ok: false, errors: errors };
    }

    var pattern = cfg.TICKET_ID_PATTERN || "^.+$";
    try {
      var regex = new RegExp(pattern);
      if (!regex.test(str)) {
        errors.push("Proof '" + str + "' does not match required pattern: " + pattern);
      }
    } catch (e) {
      AppLogger.warn("ValidationService.validateTicketId", "Invalid regex pattern in Config: " + pattern);
    }

    return { ok: errors.length === 0, errors: errors };
  },

  /**
   * Validates a complete TaskRecord object before mutation.
   * @param {TaskRecord} task
   * @return {{ok: boolean, errors: string[]}}
   */
  validateTaskRow: function(task) {
    var errors = [];
    if (!task) {
      return { ok: false, errors: ["Task record is null or undefined."] };
    }

    if (!task.taskRowId || !String(task.taskRowId).match(/^TASK-[0-9]{3,}$/)) {
      errors.push("Task Row ID must match format 'TASK-xxx' (received '" + task.taskRowId + "').");
    }

    if (!task.taskName || String(task.taskName).trim().length < 3) {
      errors.push("Task Name must be at least 3 characters long.");
    }

    var emailCheck = this.validateEmail(task.employeeEmail);
    if (!emailCheck.ok) errors.push.apply(errors, emailCheck.errors);

    var freqCheck = this.validateFrequency(task.frequency);
    if (!freqCheck.ok) errors.push.apply(errors, freqCheck.errors);

    var anchorCheck = this.validateDateValue(task.anchorDate);
    if (!anchorCheck.ok) errors.push("Anchor Date invalid: " + anchorCheck.errors.join("; "));

    var dueCheck = this.validateDateValue(task.currentDueDate);
    if (!dueCheck.ok) errors.push("Current Due Date invalid: " + dueCheck.errors.join("; "));

    var validStatuses = ["Pending", "Overdue", "Completed", "Paused"];
    if (validStatuses.indexOf(task.status) === -1) {
      errors.push("Status '" + task.status + "' must be one of: " + validStatuses.join(", "));
    }

    return { ok: errors.length === 0, errors: errors };
  },

  /**
   * Validates the loaded system configuration map.
   * Verifies required keys, numeric bounds, and escalation hierarchy:
   * REMINDER_DAY <= MANAGER_ALERT_DAY < LEADERSHIP_ALERT_DAY.
   * @param {ConfigMap} config
   * @return {{ok: boolean, errors: string[]}}
   */
  validateConfig: function(config) {
    var cfg = config || Utils.getConfig();
    var errors = [];

    var requiredNumeric = ["REMINDER_DAY", "MANAGER_ALERT_DAY", "LEADERSHIP_ALERT_DAY", "LOG_MAX_ROWS"];
    for (var i = 0; i < requiredNumeric.length; i++) {
      var k = requiredNumeric[i];
      if (typeof cfg[k] !== "number" || isNaN(cfg[k])) {
        errors.push("Config key '" + k + "' must be a valid integer.");
      }
    }

    // Escalation progression rule
    if (typeof cfg.REMINDER_DAY === "number" && typeof cfg.MANAGER_ALERT_DAY === "number" && typeof cfg.LEADERSHIP_ALERT_DAY === "number") {
      if (cfg.REMINDER_DAY > cfg.MANAGER_ALERT_DAY) {
        errors.push("REMINDER_DAY (" + cfg.REMINDER_DAY + ") cannot exceed MANAGER_ALERT_DAY (" + cfg.MANAGER_ALERT_DAY + ").");
      }
      if (cfg.MANAGER_ALERT_DAY >= cfg.LEADERSHIP_ALERT_DAY) {
        errors.push("MANAGER_ALERT_DAY (" + cfg.MANAGER_ALERT_DAY + ") must be strictly less than LEADERSHIP_ALERT_DAY (" + cfg.LEADERSHIP_ALERT_DAY + ").");
      }
    }

    var validBases = ["SCHEDULED", "COMPLETION"];
    if (validBases.indexOf(cfg.RECURRENCE_BASIS) === -1) {
      errors.push("RECURRENCE_BASIS must be either 'SCHEDULED' or 'COMPLETION'.");
    }

    var leadEmailCheck = this.validateEmail(cfg.LEADERSHIP_EMAIL);
    if (!leadEmailCheck.ok) errors.push("LEADERSHIP_EMAIL invalid: " + leadEmailCheck.errors.join("; "));

    var defMgrCheck = this.validateEmail(cfg.DEFAULT_MANAGER_EMAIL);
    if (!defMgrCheck.ok) errors.push("DEFAULT_MANAGER_EMAIL invalid: " + defMgrCheck.errors.join("; "));

    return { ok: errors.length === 0, errors: errors };
  },

  /**
   * Audits the entire spreadsheet workbook for data integrity, schema compliance,
   * duplicate keys, and system readiness.
   * @return {{healthy: boolean, issues: string[], report: string}}
   */
  runSystemHealthCheck: function() {
    return Utils.withErrorHandling("ValidationService.runSystemHealthCheck", function() {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var config = Utils.getConfig();
      var issues = [];

      // 1. Audit sheet existence
      var requiredSheets = [
        SCHEMA.TASK_MASTER.SHEET_NAME,
        SCHEMA.EMPLOYEE_DASHBOARD.SHEET_NAME,
        SCHEMA.COMPLETION_LOG.SHEET_NAME,
        SCHEMA.MANAGER_DASHBOARD.SHEET_NAME,
        SCHEMA.ESCALATION_DASHBOARD.SHEET_NAME,
        SCHEMA.CONFIG.SHEET_NAME,
        SCHEMA.ERROR_LOG.SHEET_NAME
      ];

      for (var s = 0; s < requiredSheets.length; s++) {
        var sName = requiredSheets[s];
        if (!ss.getSheetByName(sName)) {
          issues.push("MISSING_SHEET: Sheet '" + sName + "' does not exist.");
        }
      }

      // 2. Audit Config integrity
      var cfgValidation = ValidationService.validateConfig(config);
      if (!cfgValidation.ok) {
        issues.push.apply(issues, cfgValidation.errors);
      }

      // 3. Audit Task Master headers & duplicate Task Row IDs
      var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
      if (tmSheet && tmSheet.getLastRow() > 1) {
        var tmMap = Utils.getHeaderMap(tmSheet);
        var expectedTmFields = [
          SCHEMA.TASK_MASTER.FIELDS.TASK_ROW_ID,
          SCHEMA.TASK_MASTER.FIELDS.TASK_NAME,
          SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_EMAIL,
          SCHEMA.TASK_MASTER.FIELDS.FREQUENCY,
          SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE,
          SCHEMA.TASK_MASTER.FIELDS.STATUS
        ];

        for (var f = 0; f < expectedTmFields.length; f++) {
          if (!tmMap[expectedTmFields[f]]) {
            issues.push("HEADER_MISSING in Task Master: '" + expectedTmFields[f] + "'");
          }
        }

        // Duplicate Task Row ID check
        var tmData = tmSheet.getDataRange().getValues();
        var idCol = tmMap[SCHEMA.TASK_MASTER.FIELDS.TASK_ROW_ID] - 1;
        var seenTaskIds = {};
        for (var r = 1; r < tmData.length; r++) {
          var tId = String(tmData[r][idCol]).trim();
          if (tId) {
            if (seenTaskIds[tId]) {
              issues.push("DUPLICATE_TASK_ID: Row " + (r + 1) + " duplicates Task Row ID '" + tId + "' (first seen at row " + seenTaskIds[tId] + ").");
            } else {
              seenTaskIds[tId] = r + 1;
            }
          }
        }
      }

      // 4. Audit Completion Log for duplicate Cycle IDs
      var compSheet = ss.getSheetByName(SCHEMA.COMPLETION_LOG.SHEET_NAME);
      if (compSheet && compSheet.getLastRow() > 1) {
        var compMap = Utils.getHeaderMap(compSheet);
        var cycleCol = compMap[SCHEMA.COMPLETION_LOG.FIELDS.CYCLE_ID] - 1;
        if (cycleCol >= 0) {
          var compData = compSheet.getDataRange().getValues();
          var seenCycleIds = {};
          for (var c = 1; c < compData.length; c++) {
            var cId = String(compData[c][cycleCol]).trim();
            if (cId) {
              if (seenCycleIds[cId]) {
                issues.push("DUPLICATE_CYCLE_ID in Completion Log: Cycle ID '" + cId + "' repeated at row " + (c + 1));
              } else {
                seenCycleIds[cId] = c + 1;
              }
            }
          }
        }
      }

      // 5. Audit Project Triggers
      try {
        var triggers = ScriptApp.getProjectTriggers();
        var handlerCounts = {};
        for (var t = 0; t < triggers.length; t++) {
          var fn = triggers[t].getHandlerFunction();
          handlerCounts[fn] = (handlerCounts[fn] || 0) + 1;
          if (handlerCounts[fn] > 1) {
            issues.push("DUPLICATE_TRIGGER: Trigger handler '" + fn + "' is installed " + handlerCounts[fn] + " times.");
          }
        }
      } catch (trigErr) {
        // Can happen in permissions preview
      }

      var isHealthy = issues.length === 0;
      var report = "=== SYSTEM HEALTH CHECK REPORT ===\n" +
        "Status: " + (isHealthy ? "HEALTHY (0 issues)" : "ATTENTION REQUIRED (" + issues.length + " issues)") + "\n" +
        "Timestamp: " + Utilities.formatDate(new Date(), config.TIMEZONE, "yyyy-MM-dd HH:mm:ss") + "\n" +
        (isHealthy ? "All system sheets, headers, configuration parameters, and uniqueness constraints verified." : issues.join("\n"));

      if (isHealthy) {
        AppLogger.info("ValidationService.runSystemHealthCheck", "System Health Check Passed: All clear.");
      } else {
        AppLogger.warn("ValidationService.runSystemHealthCheck", "Health Check found " + issues.length + " issues:\n" + issues.join("\n"));
      }
      AppLogger.flush();

      return { healthy: isHealthy, issues: issues, report: report };
    }) || { healthy: false, issues: ["Exception during health check"], report: "Error executing health check." };
  }
};
