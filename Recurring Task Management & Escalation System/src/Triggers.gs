/**
 * @fileoverview Triggers.gs - Safe & Repeatable Trigger Management
 * Orchestrates installation, inspection, and idempotent cleanup of project triggers,
 * plus the dailyJob() batch automation pipeline with 6-minute execution cap protection.
 */

/**
 * Our managed handler function names.
 */
var MANAGED_TRIGGER_HANDLERS = ["handleEdit", "dailyJob", "refreshDashboardsHourly"];

/**
 * Installs project triggers idempotently.
 * Deletes any existing triggers for our handlers before creating fresh ones.
 * Prevents accumulating duplicate triggers across repeated setups.
 */
function installTriggers() {
  Utils.withErrorHandling("installTriggers", function() {
    AppLogger.info("installTriggers", "Starting trigger installation...");
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Step 1: Remove existing triggers for managed handlers
    removeAllProjectTriggers();

    // Step 2: Create Installable onEdit trigger for handleEdit
    ScriptApp.newTrigger("handleEdit")
      .forSpreadsheet(ss)
      .onEdit()
      .create();
    AppLogger.info("installTriggers", "Created installable onEdit trigger -> handleEdit");

    // Step 3: Create Time-Driven Daily Trigger for dailyJob
    // Runs every day at 8:00 AM (or configured DAILY_JOB_HOUR)
    var hour = 8;
    ScriptApp.newTrigger("dailyJob")
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .create();
    AppLogger.info("installTriggers", "Created daily time-driven trigger -> dailyJob (at " + hour + ":00)");

    // Step 4: Create Optional 6-Hour Refresh Trigger for Dashboards
    ScriptApp.newTrigger("refreshDashboardsHourly")
      .timeBased()
      .everyHours(6)
      .create();
    AppLogger.info("installTriggers", "Created 6-hour refresh trigger -> refreshDashboardsHourly");

    var triggers = listTriggers();
    var successMsg = "Successfully installed " + triggers.length + " triggers: " +
      triggers.map(function(t) { return t.handler; }).join(", ");

    AppLogger.info("installTriggers", successMsg);
    AppLogger.flush();
    SpreadsheetApp.getActiveSpreadsheet().toast(successMsg, "Triggers Installed", 5);
  });
}

/**
 * Deletes all project triggers pointing to our managed handlers.
 */
function removeAllProjectTriggers() {
  try {
    var existing = ScriptApp.getProjectTriggers();
    var deletedCount = 0;

    for (var i = 0; i < existing.length; i++) {
      var trigger = existing[i];
      var handler = trigger.getHandlerFunction();
      if (MANAGED_TRIGGER_HANDLERS.indexOf(handler) !== -1) {
        ScriptApp.deleteTrigger(trigger);
        deletedCount++;
      }
    }
    AppLogger.info("removeAllProjectTriggers", "Removed " + deletedCount + " existing project triggers.");
  } catch (err) {
    AppLogger.warn("removeAllProjectTriggers", "Exception during trigger cleanup: " + err.message);
  }
}

/**
 * Inspects and returns all currently installed project triggers.
 * @return {Array<{handler: string, type: string, eventType: string, id: string}>}
 */
function listTriggers() {
  var list = [];
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      var t = triggers[i];
      var info = {
        handler: t.getHandlerFunction(),
        type: String(t.getTriggerSource()),
        eventType: String(t.getEventType()),
        id: t.getUniqueId()
      };
      list.push(info);
      console.info("Trigger: " + info.handler + " | Source: " + info.type + " | Event: " + info.eventType);
    }
  } catch (err) {
    console.warn("listTriggers error: " + err.message);
  }
  return list;
}

/**
 * Hourly trigger target for periodic dashboard synchronizations.
 */
function refreshDashboardsHourly() {
  DashboardService.refreshAllDashboards();
}

/**
 * Master Daily Automation Pipeline.
 * Sequentially executes:
 * 1. refreshOverdueStatuses()
 * 2. sendDueReminders()
 * 3. runEscalations()
 * 4. refreshAllDashboards()
 * 5. AppLogger.flush()
 *
 * Implements fault isolation and execution timeout protection (< 6 minute quota).
 */
function dailyJob() {
  var startTime = new Date().getTime();
  var maxAllowedMs = 300000; // 5 minutes max (safety margin below Google's 6-minute cap)

  AppLogger.info("dailyJob", "=== Starting daily automation job ===");

  var lock = Utils.acquireLock(45000);
  if (!lock) {
    AppLogger.warn("dailyJob", "Could not acquire script lock within 45s. Skipping this dailyJob run.");
    return;
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var config = Utils.getConfig();

    // Check elapsed time helper
    var isTimeRemaining = function(stepName) {
      var elapsed = new Date().getTime() - startTime;
      if (elapsed > maxAllowedMs) {
        AppLogger.warn("dailyJob", "Approaching 5-minute threshold (" + elapsed + "ms). Skipping remaining step: " + stepName);
        return false;
      }
      return true;
    };

    // Step 1: Synchronize Overdue Statuses
    if (isTimeRemaining("refreshOverdueStatuses")) {
      try {
        var overdueUpdated = TaskService.refreshOverdueStatuses(ss, config);
        AppLogger.info("dailyJob", "Step 1 complete: " + overdueUpdated + " tasks updated to Overdue.");
      } catch (err1) {
        AppLogger.error("dailyJob.Step1", err1.message, { stack: err1.stack });
      }
    }

    // Step 2: Dispatch Day 0 Reminders
    if (isTimeRemaining("sendDueReminders")) {
      try {
        var reminderSummary = ReminderService.sendDueReminders(ss, config);
        AppLogger.info("dailyJob", "Step 2 complete: Reminders sent = " + reminderSummary.sent);
      } catch (err2) {
        AppLogger.error("dailyJob.Step2", err2.message, { stack: err2.stack });
      }
    }

    // Step 3: Run Multi-Tier Escalations (Day 2 Manager + Day 5 Leadership)
    if (isTimeRemaining("runEscalations")) {
      try {
        var escalationSummary = EscalationService.runEscalations(ss, config);
        AppLogger.info("dailyJob", "Step 3 complete: Mgr alerts = " + escalationSummary.managerAlerts +
          ", Leadership escalations = " + escalationSummary.leadershipAlerts);
      } catch (err3) {
        AppLogger.error("dailyJob.Step3", err3.message, { stack: err3.stack });
      }
    }

    // Step 4: Refresh All Dashboards
    if (isTimeRemaining("refreshAllDashboards")) {
      try {
        DashboardService.refreshAllDashboards();
        AppLogger.info("dailyJob", "Step 4 complete: Dashboards refreshed.");
      } catch (err4) {
        AppLogger.error("dailyJob.Step4", err4.message, { stack: err4.stack });
      }
    }

    var totalDuration = new Date().getTime() - startTime;
    AppLogger.info("dailyJob", "=== dailyJob finished successfully in " + (totalDuration / 1000).toFixed(2) + "s ===");
  } finally {
    AppLogger.flush();
    lock.releaseLock();
  }
}
