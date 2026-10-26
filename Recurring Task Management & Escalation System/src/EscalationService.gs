/**
 * @fileoverview EscalationService.gs - Multi-Tier Escalation Engine
 * Manages Day 2 manager alerts and Day 5 leadership escalations with per-cycle deduplication,
 * real-time completion re-checking, executive summary formatting, and simulation timeline testing.
 */

var EscalationService = {
  /**
   * Orchestrates the complete escalation pipeline: Manager Alerts -> Leadership Escalations -> Dashboard Refresh.
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
   * @param {ConfigMap} [config]
   * @return {{managerAlerts: number, leadershipAlerts: number, skipped: number, errors: string[]}}
   */
  runEscalations: function(spreadsheet, config) {
    return Utils.withErrorHandling("EscalationService.runEscalations", function() {
      var ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
      var cfg = config || Utils.getConfig();

      AppLogger.info("EscalationService.runEscalations", "Starting escalation evaluation pipeline...");

      var mgrResult = EscalationService.sendManagerAlerts(ss, cfg);
      var leadResult = EscalationService.sendLeadershipEscalations(ss, cfg);

      // Refresh Escalation Dashboard with newly escalated states
      DashboardService.renderEscalationDashboard(ss, cfg);

      var combinedErrors = (mgrResult.errors || []).concat(leadResult.errors || []);
      var summary = {
        managerAlerts: mgrResult.sent || 0,
        leadershipAlerts: leadResult.sent || 0,
        skipped: (mgrResult.skipped || 0) + (leadResult.skipped || 0),
        errors: combinedErrors
      };

      AppLogger.info("EscalationService.runEscalations", "Escalation pipeline complete: " +
        summary.managerAlerts + " manager alerts, " + summary.leadershipAlerts + " leadership escalations.");
      return summary;
    }) || { managerAlerts: 0, leadershipAlerts: 0, skipped: 0, errors: ["ESCALATION_FAILED"] };
  },

  /**
   * Dispatches consolidated alerts to direct managers for tasks overdue >= MANAGER_ALERT_DAY (Day 2).
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {ConfigMap} cfg
   * @return {{sent: number, tasksEscalated: number, skipped: number, errors: string[]}}
   */
  sendManagerAlerts: function(ss, cfg) {
    var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
    if (!tmSheet || tmSheet.getLastRow() < 2) {
      return { sent: 0, tasksEscalated: 0, skipped: 0, errors: [] };
    }

    var today = Utils.getToday(cfg);
    var tmData = tmSheet.getDataRange().getValues();
    var map = Utils.getHeaderMap(tmSheet);

    var colTaskId = map[SCHEMA.TASK_MASTER.FIELDS.TASK_ROW_ID] - 1;
    var colTaskName = map[SCHEMA.TASK_MASTER.FIELDS.TASK_NAME] - 1;
    var colEmpEmail = map[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_EMAIL] - 1;
    var colEmpName = map[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_NAME] - 1;
    var colDueDate = map[SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE] - 1;
    var colStatus = map[SCHEMA.TASK_MASTER.FIELDS.STATUS] - 1;
    var colActive = map[SCHEMA.TASK_MASTER.FIELDS.ACTIVE] - 1;
    var colMgrSent = map[SCHEMA.TASK_MASTER.FIELDS.MANAGER_ALERT_SENT_AT] - 1;

    var managerGroups = {};
    var skipped = 0;

    for (var r = 1; r < tmData.length; r++) {
      var row = tmData[r];
      var active = String(row[colActive]).toUpperCase();
      var status = String(row[colStatus]).trim();

      if (active !== "Y" || status === "Completed" || status === "Paused") {
        continue;
      }

      var dueDate = Utils.formatDateOnly(row[colDueDate], cfg.TIMEZONE);
      var daysOverdue = Math.max(0, Utils.daysBetween(today, dueDate));
      var mgrAlertSent = Boolean(row[colMgrSent]);

      // Guard: Overdue threshold reached and alert not yet sent for this cycle
      if (daysOverdue >= cfg.MANAGER_ALERT_DAY && !mgrAlertSent) {
        var empEmail = String(row[colEmpEmail]).trim().toLowerCase();
        var mgrEmail = Utils.getManagerEmail(empEmail, cfg);

        if (!managerGroups[mgrEmail]) {
          managerGroups[mgrEmail] = {
            managerEmail: mgrEmail,
            tasks: [],
            rowIndices: []
          };
        }

        managerGroups[mgrEmail].tasks.push({
          taskRowId: row[colTaskId],
          taskName: row[colTaskName],
          employeeName: row[colEmpName],
          employeeEmail: empEmail,
          dueDate: dueDate,
          daysOverdue: daysOverdue
        });
        managerGroups[mgrEmail].rowIndices.push(r + 1);
      } else {
        skipped++;
      }
    }

    var sentCount = 0;
    var tasksEscalated = 0;
    var errors = [];
    var timestampNow = Utilities.formatDate(new Date(), cfg.TIMEZONE, "yyyy-MM-dd HH:mm:ss");

    for (var mgr in managerGroups) {
      var grp = managerGroups[mgr];
      var emailPayload = EscalationService.buildManagerAlertEmail(grp.managerEmail, grp.tasks, ss.getUrl());

      if (cfg.SEND_EMAILS) {
        try {
          MailApp.sendEmail({
            to: grp.managerEmail,
            subject: emailPayload.subject,
            body: emailPayload.body,
            htmlBody: emailPayload.htmlBody
          });
          sentCount++;
        } catch (err) {
          errors.push("Failed to send manager alert to " + grp.managerEmail + ": " + err.message);
          AppLogger.error("EscalationService.sendManagerAlerts", err.message, { recipient: grp.managerEmail });
          continue;
        }
      } else {
        AppLogger.info("EscalationService.sendManagerAlerts", "[SIMULATED EMAIL] Manager Alert to " + grp.managerEmail, {
          tasksCount: grp.tasks.length,
          subject: emailPayload.subject
        });
        sentCount++;
      }

      for (var k = 0; k < grp.rowIndices.length; k++) {
        tmSheet.getRange(grp.rowIndices[k], map[SCHEMA.TASK_MASTER.FIELDS.MANAGER_ALERT_SENT_AT]).setValue(timestampNow);
        tasksEscalated++;
      }
    }

    return { sent: sentCount, tasksEscalated: tasksEscalated, skipped: skipped, errors: errors };
  },

  /**
   * Dispatches executive escalation summary to LEADERSHIP_EMAIL for tasks overdue >= LEADERSHIP_ALERT_DAY (Day 5).
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {ConfigMap} cfg
   * @return {{sent: number, tasksEscalated: number, skipped: number, errors: string[]}}
   */
  sendLeadershipEscalations: function(ss, cfg) {
    var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
    if (!tmSheet || tmSheet.getLastRow() < 2) {
      return { sent: 0, tasksEscalated: 0, skipped: 0, errors: [] };
    }

    var today = Utils.getToday(cfg);
    var tmData = tmSheet.getDataRange().getValues();
    var map = Utils.getHeaderMap(tmSheet);

    var colTaskId = map[SCHEMA.TASK_MASTER.FIELDS.TASK_ROW_ID] - 1;
    var colTaskName = map[SCHEMA.TASK_MASTER.FIELDS.TASK_NAME] - 1;
    var colEmpEmail = map[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_EMAIL] - 1;
    var colEmpName = map[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_NAME] - 1;
    var colDueDate = map[SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE] - 1;
    var colStatus = map[SCHEMA.TASK_MASTER.FIELDS.STATUS] - 1;
    var colActive = map[SCHEMA.TASK_MASTER.FIELDS.ACTIVE] - 1;
    var colLeadSent = map[SCHEMA.TASK_MASTER.FIELDS.LEADERSHIP_ALERT_SENT_AT] - 1;

    var criticalTasks = [];
    var rowIndices = [];
    var skipped = 0;

    for (var r = 1; r < tmData.length; r++) {
      var row = tmData[r];
      var active = String(row[colActive]).toUpperCase();
      var status = String(row[colStatus]).trim();

      if (active !== "Y" || status === "Completed" || status === "Paused") {
        continue;
      }

      var dueDate = Utils.formatDateOnly(row[colDueDate], cfg.TIMEZONE);
      var daysOverdue = Math.max(0, Utils.daysBetween(today, dueDate));
      var leadAlertSent = Boolean(row[colLeadSent]);

      // Guard: Overdue threshold >= LEADERSHIP_ALERT_DAY (5) and not yet sent
      if (daysOverdue >= cfg.LEADERSHIP_ALERT_DAY && !leadAlertSent) {
        var empEmail = String(row[colEmpEmail]).trim().toLowerCase();
        criticalTasks.push({
          taskRowId: row[colTaskId],
          taskName: row[colTaskName],
          employeeName: row[colEmpName],
          employeeEmail: empEmail,
          managerEmail: Utils.getManagerEmail(empEmail, cfg),
          dueDate: dueDate,
          daysOverdue: daysOverdue
        });
        rowIndices.push(r + 1);
      } else {
        skipped++;
      }
    }

    if (criticalTasks.length === 0) {
      return { sent: 0, tasksEscalated: 0, skipped: skipped, errors: [] };
    }

    var emailPayload = EscalationService.buildLeadershipEmail(criticalTasks, ss.getUrl());
    var timestampNow = Utilities.formatDate(new Date(), cfg.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    var errors = [];
    var sent = 0;

    if (cfg.SEND_EMAILS) {
      try {
        MailApp.sendEmail({
          to: cfg.LEADERSHIP_EMAIL,
          subject: emailPayload.subject,
          body: emailPayload.body,
          htmlBody: emailPayload.htmlBody
        });
        sent = 1;
      } catch (err) {
        errors.push("Failed to send leadership escalation email: " + err.message);
        AppLogger.error("EscalationService.sendLeadershipEscalations", err.message, { recipient: cfg.LEADERSHIP_EMAIL });
      }
    } else {
      AppLogger.info("EscalationService.sendLeadershipEscalations", "[SIMULATED EMAIL] Leadership Escalation to " + cfg.LEADERSHIP_EMAIL, {
        criticalTasksCount: criticalTasks.length,
        subject: emailPayload.subject
      });
      sent = 1;
    }

    if (sent > 0) {
      for (var i = 0; i < rowIndices.length; i++) {
        tmSheet.getRange(rowIndices[i], map[SCHEMA.TASK_MASTER.FIELDS.LEADERSHIP_ALERT_SENT_AT]).setValue(timestampNow);
      }
    }

    return { sent: sent, tasksEscalated: criticalTasks.length, skipped: skipped, errors: errors };
  },

  /**
   * Builds manager alert email bodies.
   * @param {string} managerEmail
   * @param {Array<Object>} tasks
   * @param {string} dashboardUrl
   * @return {{subject: string, body: string, htmlBody: string}}
   */
  buildManagerAlertEmail: function(managerEmail, tasks, dashboardUrl) {
    var subject = "[OVERDUE ALERT] " + tasks.length + " task(s) overdue for your team";
    var plain = "Hello,\n\nThe following tasks assigned to your direct reports are overdue:\n\n";
    var rows = "";

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      plain += "- " + t.taskName + " (" + t.taskRowId + ") | Employee: " + t.employeeName + " | Overdue: " + t.daysOverdue + " days (Due: " + t.dueDate + ")\n";
      rows += "<tr>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\"><b>" + t.taskRowId + "</b></td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">" + t.taskName + "</td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">" + t.employeeName + "</td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">" + t.dueDate + "</td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0; text-align: center; color: #C5221F; font-weight: bold;\">" + t.daysOverdue + " days</td>" +
        "</tr>";
    }

    plain += "\nPlease review the Manager Dashboard: " + dashboardUrl + "\n";

    var html = "<div style=\"font-family: Arial, sans-serif; color: #202124; max-width: 650px;\">" +
      "<div style=\"background-color: #EA4335; padding: 14px 20px; border-radius: 6px 6px 0 0;\">" +
      "<h2 style=\"color: #FFFFFF; margin: 0; font-size: 18px;\">Overdue Task Alert - Direct Reports</h2>" +
      "</div>" +
      "<div style=\"padding: 20px; border: 1px solid #DADCE0; border-top: none; background-color: #FFFFFF;\">" +
      "<p>You have <b>" + tasks.length + "</b> task(s) that have reached or breached the 2-day overdue escalation threshold:</p>" +
      "<table style=\"width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px;\">" +
      "<thead><tr style=\"background-color: #F1F3F4;\"><th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Task ID</th><th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Task Name</th><th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Employee</th><th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Due Date</th><th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Days Late</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "</table>" +
      "<p style=\"text-align: center; margin-top: 20px;\"><a href=\"" + dashboardUrl + "\" style=\"background-color: #EA4335; color: #FFFFFF; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;\">Open Manager Dashboard</a></p>" +
      "</div></div>";

    return { subject: subject, body: plain, htmlBody: html };
  },

  /**
   * Builds executive leadership escalation email bodies.
   * @param {Array<Object>} tasks
   * @param {string} dashboardUrl
   * @return {{subject: string, body: string, htmlBody: string}}
   */
  buildLeadershipEmail: function(tasks, dashboardUrl) {
    var subject = "[CRITICAL ESCALATION] " + tasks.length + " task(s) severely overdue (Day 5+)";
    var plain = "EXECUTIVE ESCALATION REPORT\n\nThe following tasks are severely overdue (>= 5 days):\n\n";
    var rows = "";

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      plain += "- " + t.taskName + " (" + t.taskRowId + ") | Employee: " + t.employeeName + " | Manager: " + t.managerEmail + " | Overdue: " + t.daysOverdue + " days\n";
      rows += "<tr>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\"><b>" + t.taskRowId + "</b></td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">" + t.taskName + "</td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">" + t.employeeName + "</td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">" + t.managerEmail + "</td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0; text-align: center; color: #B31412; font-weight: bold; background-color: #FCE8E6;\">" + t.daysOverdue + " days</td>" +
        "</tr>";
    }

    plain += "\nReview Escalation Dashboard: " + dashboardUrl + "\n";

    var html = "<div style=\"font-family: Arial, sans-serif; color: #202124; max-width: 700px;\">" +
      "<div style=\"background-color: #B31412; padding: 16px 20px; border-radius: 6px 6px 0 0;\">" +
      "<h2 style=\"color: #FFFFFF; margin: 0; font-size: 18px;\">Leadership Escalation - Critical Overdue Tasks</h2>" +
      "</div>" +
      "<div style=\"padding: 20px; border: 1px solid #DADCE0; border-top: none; background-color: #FFFFFF;\">" +
      "<p style=\"font-size: 14px;\">This executive notification highlights <b>" + tasks.length + "</b> critical task(s) that have remained uncompleted for 5 or more days:</p>" +
      "<table style=\"width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px;\">" +
      "<thead><tr style=\"background-color: #F1F3F4;\"><th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Task ID</th><th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Task Name</th><th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Employee</th><th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Manager</th><th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Days Overdue</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "</table>" +
      "<p style=\"text-align: center; margin-top: 20px;\"><a href=\"" + dashboardUrl + "\" style=\"background-color: #B31412; color: #FFFFFF; padding: 10px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;\">Open Escalation Dashboard</a></p>" +
      "</div></div>";

    return { subject: subject, body: plain, htmlBody: html };
  },

  /**
   * Demonstration timeline simulation tool for reviewers.
   * Simulates the progression D (due date) -> D+2 (Day 2 manager alert) -> D+5 (Day 5 leadership escalation)
   * by sequentially setting DEMO_DATE_OVERRIDE and executing pipeline stages.
   *
   * @return {Array<{stage: string, simulatedDate: string, log: string}>}
   */
  demoEscalationTimeline: function() {
    return Utils.withErrorHandling("EscalationService.demoEscalationTimeline", function() {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var cfg = Utils.getConfig();
      var originalOverride = cfg.DEMO_DATE_OVERRIDE;
      var timelineLog = [];

      var baseDate = "2026-10-20"; // Simulated task due date D

      try {
        // Timeline Stage 1: Day D (Due Date)
        cfg.DEMO_DATE_OVERRIDE = baseDate;
        var r1 = ReminderService.sendDueReminders(ss, cfg);
        timelineLog.push({
          stage: "Stage 1: Day 0 (Task Due Date)",
          simulatedDate: baseDate,
          log: "Reminders dispatched: " + r1.sent + " emails (" + r1.tasksReminded + " tasks reminded)."
        });

        // Timeline Stage 2: Day D+2 (Manager Overdue Alert)
        var dateD2 = TaskService.addDays(baseDate, 2);
        cfg.DEMO_DATE_OVERRIDE = dateD2;
        TaskService.refreshOverdueStatuses(ss, cfg);
        var r2 = EscalationService.sendManagerAlerts(ss, cfg);
        timelineLog.push({
          stage: "Stage 2: Day D+2 (Manager Alert)",
          simulatedDate: dateD2,
          log: "Manager alerts dispatched: " + r2.sent + " emails (" + r2.tasksEscalated + " tasks escalated)."
        });

        // Timeline Stage 3: Day D+5 (Leadership Escalation)
        var dateD5 = TaskService.addDays(baseDate, 5);
        cfg.DEMO_DATE_OVERRIDE = dateD5;
        var r3 = EscalationService.sendLeadershipEscalations(ss, cfg);
        timelineLog.push({
          stage: "Stage 3: Day D+5 (Leadership Escalation)",
          simulatedDate: dateD5,
          log: "Leadership escalations dispatched: " + r3.sent + " emails (" + r3.tasksEscalated + " critical tasks)."
        });

        AppLogger.info("EscalationService.demoEscalationTimeline", "Escalation timeline demo finished successfully.", { timeline: timelineLog });
      } finally {
        // Restore original override
        cfg.DEMO_DATE_OVERRIDE = originalOverride;
      }

      var msg = timelineLog.map(function(t) { return t.stage + " [" + t.simulatedDate + "]: " + t.log; }).join("\n");
      SpreadsheetApp.getActiveSpreadsheet().toast(msg, "Demo Timeline Complete", 8);
      return timelineLog;
    }) || [];
  }
};
