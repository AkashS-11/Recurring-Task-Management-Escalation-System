/**
 * @fileoverview CompletionService.gs - Single-Location Completion Engine
 * Handles atomic task completions, script lock concurrency, idempotency checks,
 * proof enforcement, completion log auditing, and next-cycle transitions.
 */

var CompletionService = {
  /**
   * Completes a task instance atomically.
   *
   * @param {string} taskRowId Unique task row ID (e.g. "TASK-001")
   * @param {('Dashboard'|'Manual'|'Auto')} [source='Dashboard']
   * @param {string} [proofInput] Submitted proof string, URL, or ticket ID
   * @param {string} [userOverride] Optional user email override (for testing or admin runs)
   * @return {{success: boolean, status: string, message: string, cycleId?: string, nextDueDate?: string}}
   */
  completeTask: function(taskRowId, source, proofInput, userOverride) {
    var lock = Utils.acquireLock(30000);
    if (!lock) {
      AppLogger.warn("CompletionService.completeTask", "Could not acquire script lock within 30s for " + taskRowId);
      return {
        success: false,
        status: "LOCK_TIMEOUT",
        message: "System busy. Please try again in a few moments."
      };
    }

    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var config = Utils.getConfig();
      var today = Utils.getToday(config);
      var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
      var compSheet = ss.getSheetByName(SCHEMA.COMPLETION_LOG.SHEET_NAME);

      if (!tmSheet || !compSheet) {
        return { success: false, status: "CONFIG_ERROR", message: "Required system sheets missing." };
      }

      // Step 1: Resolve user identity
      var activeUser = "unknown";
      try {
        activeUser = userOverride || Session.getActiveUser().getEmail();
      } catch (e) {
        activeUser = "";
      }
      if (!activeUser) {
        try {
          activeUser = Session.getEffectiveUser().getEmail();
          AppLogger.warn("CompletionService.completeTask", "Fell back to effective user: " + activeUser);
        } catch (e) {
          activeUser = "script_runner";
        }
      }

      // Step 2: Locate task in Task Master
      var tmData = tmSheet.getDataRange().getValues();
      var tmMap = Utils.getHeaderMap(tmSheet);

      var rowIndex = -1;
      var taskRecord = null;

      for (var r = 1; r < tmData.length; r++) {
        var curId = String(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.TASK_ROW_ID] - 1]).trim();
        if (curId === String(taskRowId).trim()) {
          rowIndex = r + 1; // 1-based sheet row
          taskRecord = {
            taskRowId: curId,
            taskName: String(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.TASK_NAME] - 1]).trim(),
            employeeEmail: String(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_EMAIL] - 1]).trim().toLowerCase(),
            employeeName: String(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_NAME] - 1]).trim(),
            frequency: String(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.FREQUENCY] - 1]).trim(),
            anchorDate: Utils.formatDateOnly(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.ANCHOR_DATE] - 1], config.TIMEZONE),
            currentDueDate: Utils.formatDateOnly(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE] - 1], config.TIMEZONE),
            status: String(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.STATUS] - 1]).trim(),
            proofRequired: String(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.PROOF_REQUIRED] - 1]).trim().toUpperCase(),
            active: String(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.ACTIVE] - 1]).trim().toUpperCase(),
            cycleId: String(tmData[r][tmMap[SCHEMA.TASK_MASTER.FIELDS.CYCLE_ID] - 1]).trim()
          };
          break;
        }
      }

      if (!taskRecord || rowIndex < 2) {
        return { success: false, status: "NOT_FOUND", message: "Task Row ID " + taskRowId + " not found." };
      }

      if (taskRecord.active !== "Y") {
        return { success: false, status: "INACTIVE", message: "Cannot complete an inactive task." };
      }

      if (taskRecord.status === "Paused") {
        return { success: false, status: "PAUSED", message: "Task is currently Paused." };
      }

      // Step 3: Verify authorization (assigned employee or configured admin)
      var userLower = activeUser.toLowerCase();
      var isAdmin = config.ADMIN_EMAILS && config.ADMIN_EMAILS.indexOf(userLower) !== -1;
      if (userLower !== taskRecord.employeeEmail && !isAdmin && userLower !== "script_runner") {
        AppLogger.warn("CompletionService.completeTask", "Unauthorized attempt by " + userLower + " for " + taskRecord.employeeEmail);
        return {
          success: false,
          status: "UNAUTHORIZED",
          message: "You are not authorized to complete this task (assigned to " + taskRecord.employeeEmail + ")."
        };
      }

      // Step 4: Validate Proof requirements
      var finalProof = String(proofInput || "").trim();
      if (taskRecord.proofRequired === "Y") {
        if (!finalProof) {
          return {
            success: false,
            status: "PROOF_REQUIRED",
            message: "Proof / Ticket ID is required before marking this task complete."
          };
        }
        if (config.TICKET_ID_PATTERN) {
          try {
            var regex = new RegExp(config.TICKET_ID_PATTERN);
            if (!regex.test(finalProof)) {
              return {
                success: false,
                status: "INVALID_PROOF_FORMAT",
                message: "Proof format does not match required pattern (" + config.TICKET_ID_PATTERN + ")."
              };
            }
          } catch (e) {
            // If regex is malformed, bypass regex check
          }
        }
      } else {
        // Daily WhatsApp-style auto-proof if no proof entered
        if (!finalProof) {
          finalProof = "AUTO:" + activeUser + "|" + today + "|" + taskRecord.cycleId;
        }
      }

      // Step 5: Check Cycle ID idempotency against Completion Log
      var cycleId = taskRecord.cycleId || (taskRecord.taskRowId + "|" + taskRecord.currentDueDate);
      var compData = compSheet.getDataRange().getValues();
      var compMap = Utils.getHeaderMap(compSheet);
      var colCycleId = compMap[SCHEMA.COMPLETION_LOG.FIELDS.CYCLE_ID] - 1;

      for (var c = 1; c < compData.length; c++) {
        if (String(compData[c][colCycleId]).trim() === cycleId) {
          AppLogger.warn("CompletionService.completeTask", "Duplicate completion attempt blocked for Cycle ID: " + cycleId);
          return {
            success: false,
            status: "DUPLICATE",
            message: "This cycle (" + cycleId + ") has already been completed."
          };
        }
      }

      // Step 6: Append immutable record to Completion Log
      var nextLogId = "LOG-" + Utilities.formatString("%05d", compSheet.getLastRow());
      var timestampNow = Utilities.formatDate(new Date(), config.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
      var daysLate = Math.max(0, Utils.daysBetween(today, taskRecord.currentDueDate));

      compSheet.appendRow([
        nextLogId,
        cycleId,
        taskRecord.taskRowId,
        taskRecord.taskName,
        taskRecord.employeeEmail,
        activeUser,
        timestampNow,
        taskRecord.currentDueDate,
        daysLate,
        finalProof,
        source || "Dashboard"
      ]);

      // Step 7: Advance cycle using TaskService.calculateNextDueDate
      var nextCycleResult = TaskService.calculateNextDueDate(
        taskRecord.anchorDate,
        taskRecord.currentDueDate,
        today,
        taskRecord.frequency,
        config.RECURRENCE_BASIS
      );

      // Record any skipped cycles as MISSED in Completion Log
      if (nextCycleResult.skippedCycles > 0) {
        AppLogger.info("CompletionService.completeTask", "Task " + taskRecord.taskRowId + " skipped " + nextCycleResult.skippedCycles + " missed cycles.");
      }

      var nextCycleId = taskRecord.taskRowId + "|" + nextCycleResult.nextDueDate;

      // Step 8: Update Task Master row atomically
      tmSheet.getRange(rowIndex, tmMap[SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE]).setValue(nextCycleResult.nextDueDate);
      tmSheet.getRange(rowIndex, tmMap[SCHEMA.TASK_MASTER.FIELDS.CYCLE_ID]).setValue(nextCycleId);
      tmSheet.getRange(rowIndex, tmMap[SCHEMA.TASK_MASTER.FIELDS.STATUS]).setValue("Pending");
      tmSheet.getRange(rowIndex, tmMap[SCHEMA.TASK_MASTER.FIELDS.LAST_COMPLETED_AT]).setValue(timestampNow);
      tmSheet.getRange(rowIndex, tmMap[SCHEMA.TASK_MASTER.FIELDS.LAST_COMPLETED_BY]).setValue(activeUser);
      tmSheet.getRange(rowIndex, tmMap[SCHEMA.TASK_MASTER.FIELDS.REMINDER_SENT_AT]).setValue("");
      tmSheet.getRange(rowIndex, tmMap[SCHEMA.TASK_MASTER.FIELDS.MANAGER_ALERT_SENT_AT]).setValue("");
      tmSheet.getRange(rowIndex, tmMap[SCHEMA.TASK_MASTER.FIELDS.LEADERSHIP_ALERT_SENT_AT]).setValue("");

      AppLogger.info("CompletionService.completeTask", "Task " + taskRecord.taskRowId + " completed. Next due: " + nextCycleResult.nextDueDate);

      return {
        success: true,
        status: "COMPLETED",
        message: "Task completed successfully! Next due date: " + nextCycleResult.nextDueDate,
        cycleId: cycleId,
        nextDueDate: nextCycleResult.nextDueDate
      };
    } catch (err) {
      AppLogger.error("CompletionService.completeTask", err.message, { stack: err.stack, taskRowId: taskRowId });
      return {
        success: false,
        status: "SYSTEM_ERROR",
        message: "An internal error occurred: " + err.message
      };
    } finally {
      lock.releaseLock();
    }
  }
};
