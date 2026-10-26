/**
 * @fileoverview ReminderService.gs - Day 0 Employee Reminder Engine
 * Identifies tasks due today (or within REMINDER_DAY threshold), groups them by employee,
 * sends consolidated HTML notifications, stamps deduplication timestamps, and enforces email quota limits.
 */

var ReminderService = {
  /**
   * Scans Task Master for due tasks, consolidates them by employee, and dispatches reminders.
   * Idempotent: Can be safely executed multiple times without generating duplicate emails.
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
   * @param {ConfigMap} [config]
   * @return {{considered: number, sent: number, tasksReminded: number, skipped: number, errors: string[]}}
   */
  sendDueReminders: function(spreadsheet, config) {
    return Utils.withErrorHandling("ReminderService.sendDueReminders", function() {
      var lock = Utils.acquireLock(20000);
      if (!lock) {
        AppLogger.warn("ReminderService.sendDueReminders", "Could not acquire script lock within 20s. Aborting reminder run.");
        return { considered: 0, sent: 0, tasksReminded: 0, skipped: 0, errors: ["LOCK_TIMEOUT"] };
      }

      try {
        var ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
        var cfg = config || Utils.getConfig();
        var today = Utils.getToday(cfg);

        var tmSheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
        if (!tmSheet || tmSheet.getLastRow() < 2) {
          return { considered: 0, sent: 0, tasksReminded: 0, skipped: 0, errors: [] };
        }

        var tmData = tmSheet.getDataRange().getValues();
        var map = Utils.getHeaderMap(tmSheet);

        var colTaskId = map[SCHEMA.TASK_MASTER.FIELDS.TASK_ROW_ID] - 1;
        var colTaskName = map[SCHEMA.TASK_MASTER.FIELDS.TASK_NAME] - 1;
        var colEmpEmail = map[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_EMAIL] - 1;
        var colEmpName = map[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_NAME] - 1;
        var colFreq = map[SCHEMA.TASK_MASTER.FIELDS.FREQUENCY] - 1;
        var colDueDate = map[SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE] - 1;
        var colStatus = map[SCHEMA.TASK_MASTER.FIELDS.STATUS] - 1;
        var colProofReq = map[SCHEMA.TASK_MASTER.FIELDS.PROOF_REQUIRED] - 1;
        var colActive = map[SCHEMA.TASK_MASTER.FIELDS.ACTIVE] - 1;
        var colRemSent = map[SCHEMA.TASK_MASTER.FIELDS.REMINDER_SENT_AT] - 1;

        // Group tasks by employee email
        var groupedTasks = {};
        var totalConsidered = 0;
        var skippedCount = 0;

        for (var r = 1; r < tmData.length; r++) {
          var row = tmData[r];
          var active = String(row[colActive]).toUpperCase();
          var status = String(row[colStatus]).trim();
          if (active !== "Y" || status === "Completed" || status === "Paused") {
            continue;
          }

          var dueDate = Utils.formatDateOnly(row[colDueDate], cfg.TIMEZONE);
          if (!dueDate) continue;

          totalConsidered++;

          // Day 0 Reminder criteria: Task due on or before (today - REMINDER_DAY)
          // Default REMINDER_DAY = 0 means task is due on or before today
          var daysDiff = Utils.daysBetween(today, dueDate); // 0 if due today, >0 if overdue
          var isDueForReminder = daysDiff >= cfg.REMINDER_DAY;
          var reminderAlreadySent = Boolean(row[colRemSent]);

          if (isDueForReminder && !reminderAlreadySent) {
            var empEmail = String(row[colEmpEmail]).trim().toLowerCase();
            if (!groupedTasks[empEmail]) {
              groupedTasks[empEmail] = {
                employeeName: String(row[colEmpName]).trim(),
                employeeEmail: empEmail,
                tasks: [],
                rowIndices: []
              };
            }
            groupedTasks[empEmail].tasks.push({
              taskRowId: row[colTaskId],
              taskName: row[colTaskName],
              frequency: row[colFreq],
              dueDate: dueDate,
              proofRequired: row[colProofReq]
            });
            groupedTasks[empEmail].rowIndices.push(r + 1); // 1-based row
          } else {
            skippedCount++;
          }
        }

        var emailsSent = 0;
        var tasksReminded = 0;
        var errors = [];
        var dashboardUrl = ss.getUrl();
        var timestampNow = Utilities.formatDate(new Date(), cfg.TIMEZONE, "yyyy-MM-dd HH:mm:ss");

        for (var email in groupedTasks) {
          var group = groupedTasks[email];

          // Check email quota
          var quota = 500;
          try {
            quota = MailApp.getRemainingDailyQuota();
          } catch (qe) {
            // Can occur in test mode
          }

          if (quota < 5) {
            var qMsg = "Daily MailApp quota nearly exhausted (" + quota + " remaining). Skipping email dispatch.";
            AppLogger.warn("ReminderService.sendDueReminders", qMsg);
            errors.push(qMsg);
            break;
          }

          var emailPayload = ReminderService.buildReminderEmail(group.employeeName, group.tasks, dashboardUrl);

          if (cfg.SEND_EMAILS) {
            try {
              MailApp.sendEmail({
                to: group.employeeEmail,
                subject: emailPayload.subject,
                body: emailPayload.body,
                htmlBody: emailPayload.htmlBody
              });
              emailsSent++;
            } catch (sendErr) {
              errors.push("Failed to send reminder to " + group.employeeEmail + ": " + sendErr.message);
              AppLogger.error("ReminderService.sendDueReminders", sendErr.message, { recipient: group.employeeEmail });
              continue; // Do not stamp if email send threw an exception
            }
          } else {
            // Simulated send: log payload metadata
            AppLogger.info("ReminderService.sendDueReminders", "[SIMULATED EMAIL] Reminder to " + group.employeeEmail, {
              tasksCount: group.tasks.length,
              subject: emailPayload.subject
            });
            emailsSent++;
          }

          // Stamp Reminder Sent At for each reminded row in Task Master
          for (var idx = 0; idx < group.rowIndices.length; idx++) {
            var targetRow = group.rowIndices[idx];
            tmSheet.getRange(targetRow, map[SCHEMA.TASK_MASTER.FIELDS.REMINDER_SENT_AT]).setValue(timestampNow);
            tasksReminded++;
          }
        }

        AppLogger.info("ReminderService.sendDueReminders", "Reminder run complete: " + emailsSent + " emails dispatched for " + tasksReminded + " tasks.");
        return {
          considered: totalConsidered,
          sent: emailsSent,
          tasksReminded: tasksReminded,
          skipped: skippedCount,
          errors: errors
        };
      } finally {
        lock.releaseLock();
      }
    }) || { considered: 0, sent: 0, tasksReminded: 0, skipped: 0, errors: ["EXECUTION_FAILED"] };
  },

  /**
   * Constructs consolidated plain text and HTML reminder bodies for an employee.
   *
   * @param {string} employeeName
   * @param {Array<{taskRowId: string, taskName: string, frequency: string, dueDate: string, proofRequired: string}>} tasks
   * @param {string} dashboardUrl
   * @return {{subject: string, body: string, htmlBody: string}}
   */
  buildReminderEmail: function(employeeName, tasks, dashboardUrl) {
    var subject = "[Action Required] You have " + tasks.length + " task(s) due today";

    var plainText = "Hello " + employeeName + ",\n\n" +
      "This is a reminder that you have " + tasks.length + " recurring task(s) due for completion:\n\n";

    var tableRows = "";
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      plainText += "- " + t.taskName + " (" + t.taskRowId + ") | Due: " + t.dueDate + " | Proof Required: " + t.proofRequired + "\n";
      tableRows += "<tr>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\"><b>" + t.taskRowId + "</b></td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">" + t.taskName + "</td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">" + t.frequency + "</td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">" + t.dueDate + "</td>" +
        "<td style=\"padding: 8px 12px; border: 1px solid #E0E0E0; text-align: center;\">" + (t.proofRequired === "Y" ? "<span style=\"color:#C5221F;font-weight:bold;\">Yes</span>" : "No") + "</td>" +
        "</tr>";
    }

    plainText += "\nPlease open the Employee Dashboard to mark these complete: " + dashboardUrl + "\n\n" +
      "Thank you,\nRecurring Task Management System";

    var htmlBody = "<div style=\"font-family: Arial, sans-serif; color: #202124; max-width: 650px; margin: 0 auto;\">" +
      "<div style=\"background-color: #1A73E8; padding: 16px 20px; border-radius: 6px 6px 0 0;\">" +
      "<h2 style=\"color: #FFFFFF; margin: 0; font-size: 18px;\">Recurring Task Reminder</h2>" +
      "</div>" +
      "<div style=\"padding: 20px; border: 1px solid #DADCE0; border-top: none; border-radius: 0 0 6px 6px; background-color: #FFFFFF;\">" +
      "<p style=\"font-size: 14px;\">Hello <b>" + employeeName + "</b>,</p>" +
      "<p style=\"font-size: 14px;\">You have <b>" + tasks.length + "</b> task(s) scheduled for completion today:</p>" +
      "<table style=\"width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px;\">" +
      "<thead><tr style=\"background-color: #F1F3F4; text-align: left;\">" +
      "<th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Task ID</th>" +
      "<th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Task Name</th>" +
      "<th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Frequency</th>" +
      "<th style=\"padding: 8px 12px; border: 1px solid #E0E0E0;\">Due Date</th>" +
      "<th style=\"padding: 8px 12px; border: 1px solid #E0E0E0; text-align: center;\">Proof Required?</th>" +
      "</tr></thead>" +
      "<tbody>" + tableRows + "</tbody>" +
      "</table>" +
      "<div style=\"margin-top: 24px; text-align: center;\">" +
      "<a href=\"" + dashboardUrl + "\" style=\"background-color: #1A73E8; color: #FFFFFF; padding: 10px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 14px; display: inline-block;\">Open Employee Dashboard</a>" +
      "</div>" +
      "<p style=\"font-size: 12px; color: #5F6368; margin-top: 24px;\">This is an automated notification generated by the Google Apps Script Recurring Task System.</p>" +
      "</div></div>";

    return { subject: subject, body: plainText, htmlBody: htmlBody };
  }
};
