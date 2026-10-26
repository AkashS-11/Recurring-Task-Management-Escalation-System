/**
 * @fileoverview TaskService.gs - Recurrence Engine & Status Synchronizer
 * Contains pure date recurrence calculations, month-end clamping, leap-year logic,
 * late-completion roll-forward algorithms, and overdue status synchronizers.
 */

var TaskService = {
  /**
   * Checks if a given calendar year is a leap year.
   * @param {number} year
   * @return {boolean}
   */
  isLeapYear: function(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  },

  /**
   * Returns the exact number of days in a given calendar month.
   * @param {number} year Four-digit year
   * @param {number} month 1-based month (1 = Jan, 12 = Dec)
   * @return {number} Days in month (28, 29, 30, or 31)
   */
  daysInMonth: function(year, month) {
    if (month === 2) {
      return this.isLeapYear(year) ? 29 : 28;
    }
    if (month === 4 || month === 6 || month === 9 || month === 11) {
      return 30;
    }
    return 31;
  },

  /**
   * Parses a 'yyyy-MM-dd' string into integer components {year, month, day}.
   * @param {string} dateStr
   * @return {{year: number, month: number, day: number}}
   */
  parseDateParts: function(dateStr) {
    var str = String(dateStr).trim().substring(0, 10);
    var parts = str.split("-");
    return {
      year: parseInt(parts[0], 10),
      month: parseInt(parts[1], 10),
      day: parseInt(parts[2], 10)
    };
  },

  /**
   * Formats year, month, and day integers into a standardized 'yyyy-MM-dd' string.
   * @param {number} y
   * @param {number} m
   * @param {number} d
   * @return {string}
   */
  formatDateParts: function(y, m, d) {
    var mm = m < 10 ? "0" + m : String(m);
    var dd = d < 10 ? "0" + d : String(d);
    return y + "-" + mm + "-" + dd;
  },

  /**
   * Pure date arithmetic: adds N calendar days to a 'yyyy-MM-dd' date string.
   * Uses UTC date math to eliminate DST/timezone skew.
   * @param {string} dateStr
   * @param {number} daysToAdd
   * @return {string} Resulting date in 'yyyy-MM-dd'
   */
  addDays: function(dateStr, daysToAdd) {
    var p = this.parseDateParts(dateStr);
    var utc = Date.UTC(p.year, p.month - 1, p.day);
    var targetUtc = utc + (daysToAdd * 24 * 60 * 60 * 1000);
    var res = new Date(targetUtc);
    return this.formatDateParts(res.getUTCFullYear(), res.getUTCMonth() + 1, res.getUTCDate());
  },

  /**
   * Pure date arithmetic: advances calendar months while clamping to the original anchor day.
   * Never chains from an already-clamped month-end.
   * Example: Anchor 31, Jan 31 + 1 mo -> Feb 28; + 2 mo -> Mar 31.
   * @param {number} fromYear
   * @param {number} fromMonth 1-based month
   * @param {number} anchorDay Original day-of-month (e.g. 31)
   * @param {number} monthsToAdd
   * @return {string} Resulting date in 'yyyy-MM-dd'
   */
  addMonthsClamped: function(fromYear, fromMonth, anchorDay, monthsToAdd) {
    var targetYear = fromYear;
    var targetMonth = fromMonth + monthsToAdd;

    while (targetMonth > 12) {
      targetMonth -= 12;
      targetYear++;
    }
    while (targetMonth < 1) {
      targetMonth += 12;
      targetYear--;
    }

    var maxDays = this.daysInMonth(targetYear, targetMonth);
    var clampedDay = Math.min(anchorDay, maxDays);
    return this.formatDateParts(targetYear, targetMonth, clampedDay);
  },

  /**
   * Pure recurrence engine: computes the next cycle due date.
   * Strictly adheres to drift-prevention rules and month-end clamping.
   *
   * @param {string} anchorDateStr Initial anchor date ('yyyy-MM-dd')
   * @param {string} currentDueDateStr Current cycle due date ('yyyy-MM-dd')
   * @param {string} completedDateStr Actual completion date ('yyyy-MM-dd')
   * @param {('Daily'|'Every 7 days'|'Every 15 days'|'Monthly')} frequency
   * @param {('SCHEDULED'|'COMPLETION')} [basis='SCHEDULED']
   * @return {{nextDueDate: string, skippedCycles: number}}
   */
  calculateNextDueDate: function(anchorDateStr, currentDueDateStr, completedDateStr, frequency, basis) {
    var recurrenceBasis = basis || "SCHEDULED";
    var anchor = this.parseDateParts(anchorDateStr);
    var current = this.parseDateParts(currentDueDateStr);
    var completed = this.parseDateParts(completedDateStr);

    var advanceSingleCycle = function(baseDateStr) {
      var parts = TaskService.parseDateParts(baseDateStr);
      if (frequency === "Daily") {
        return TaskService.addDays(baseDateStr, 1);
      } else if (frequency === "Every 7 days") {
        return TaskService.addDays(baseDateStr, 7);
      } else if (frequency === "Every 15 days") {
        return TaskService.addDays(baseDateStr, 15);
      } else if (frequency === "Monthly") {
        // Advance 1 calendar month, clamping with the original anchor day
        return TaskService.addMonthsClamped(parts.year, parts.month, anchor.day, 1);
      }
      return TaskService.addDays(baseDateStr, 1);
    };

    if (recurrenceBasis === "COMPLETION") {
      // Completed Date + N basis
      var compDateStr = this.formatDateParts(completed.year, completed.month, completed.day);
      if (frequency === "Monthly") {
        var nextMonthly = this.addMonthsClamped(completed.year, completed.month, anchor.day, 1);
        return { nextDueDate: nextMonthly, skippedCycles: 0 };
      }
      return { nextDueDate: advanceSingleCycle(compDateStr), skippedCycles: 0 };
    }

    // SCHEDULED Basis (Default - Drift-Proof)
    var curDateStr = this.formatDateParts(current.year, current.month, current.day);
    var compDateStr = this.formatDateParts(completed.year, completed.month, completed.day);

    var nextDue = advanceSingleCycle(curDateStr);
    var skipped = 0;

    // Multi-cycle overdue roll-forward: If completion occurred multiple cycles late,
    // roll forward to the next future due date strictly after the completion date.
    while (nextDue <= compDateStr) {
      nextDue = advanceSingleCycle(nextDue);
      skipped++;
    }

    return {
      nextDueDate: nextDue,
      skippedCycles: skipped
    };
  },

  /**
   * Scans Task Master and updates tasks from 'Pending' to 'Overdue'
   * if current due date is strictly prior to today.
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
   * @param {ConfigMap} [config]
   * @return {number} Number of tasks marked Overdue
   */
  refreshOverdueStatuses: function(spreadsheet, config) {
    return Utils.withErrorHandling("TaskService.refreshOverdueStatuses", function() {
      var ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
      var cfg = config || Utils.getConfig();
      var today = Utils.getToday(cfg);

      var sheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
      if (!sheet || sheet.getLastRow() < 2) return 0;

      var data = sheet.getDataRange().getValues();
      var headerMap = Utils.getHeaderMap(sheet);

      var colDueDate = headerMap[SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE] - 1;
      var colStatus = headerMap[SCHEMA.TASK_MASTER.FIELDS.STATUS] - 1;
      var colActive = headerMap[SCHEMA.TASK_MASTER.FIELDS.ACTIVE] - 1;

      var updatedCount = 0;
      for (var r = 1; r < data.length; r++) {
        var active = String(data[r][colActive]).toUpperCase();
        var status = String(data[r][colStatus]).trim();
        var dueDate = Utils.formatDateOnly(data[r][colDueDate], cfg.TIMEZONE);

        if (active === "Y" && status === "Pending" && dueDate && dueDate < today) {
          data[r][colStatus] = "Overdue";
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        sheet.getDataRange().setValues(data);
        AppLogger.info("TaskService.refreshOverdueStatuses", "Updated " + updatedCount + " tasks to Overdue.");
      }
      return updatedCount;
    }) || 0;
  },

  /**
   * Retrieves active task records assigned to a specific employee email.
   * @param {string} employeeEmail
   * @return {TaskRecord[]}
   */
  getTasksForEmployee: function(employeeEmail) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SCHEMA.TASK_MASTER.SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return [];

    var data = sheet.getDataRange().getValues();
    var map = Utils.getHeaderMap(sheet);
    var cleanTarget = String(employeeEmail).trim().toLowerCase();

    var results = [];
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var emp = String(row[map[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_EMAIL] - 1]).trim().toLowerCase();
      var active = String(row[map[SCHEMA.TASK_MASTER.FIELDS.ACTIVE] - 1]).toUpperCase();

      if (emp === cleanTarget && active === "Y") {
        results.push({
          taskRowId: row[map[SCHEMA.TASK_MASTER.FIELDS.TASK_ROW_ID] - 1],
          taskName: row[map[SCHEMA.TASK_MASTER.FIELDS.TASK_NAME] - 1],
          description: row[map[SCHEMA.TASK_MASTER.FIELDS.DESCRIPTION] - 1],
          employeeEmail: emp,
          employeeName: row[map[SCHEMA.TASK_MASTER.FIELDS.EMPLOYEE_NAME] - 1],
          frequency: row[map[SCHEMA.TASK_MASTER.FIELDS.FREQUENCY] - 1],
          currentDueDate: Utils.formatDateOnly(row[map[SCHEMA.TASK_MASTER.FIELDS.CURRENT_DUE_DATE] - 1]),
          status: row[map[SCHEMA.TASK_MASTER.FIELDS.STATUS] - 1],
          proofRequired: row[map[SCHEMA.TASK_MASTER.FIELDS.PROOF_REQUIRED] - 1],
          cycleId: row[map[SCHEMA.TASK_MASTER.FIELDS.CYCLE_ID] - 1],
          rowIndex: r + 1
        });
      }
    }
    return results;
  },

  /**
   * Self-check harness exercising 20+ hard-coded recurrence and month-end scenarios.
   * Can be run via custom menu or unit test runner.
   * @return {{passed: number, failed: number, results: Array<{case: string, expected: string, actual: string, ok: boolean}>}}
   */
  runRecurrenceSelfCheck: function() {
    var testCases = [
      // 1. Daily basic (+1)
      { anchor: "2026-10-01", cur: "2026-10-05", comp: "2026-10-05", freq: "Daily", basis: "SCHEDULED", exp: "2026-10-06", expSkip: 0 },
      // 2. Daily month rollover (+1)
      { anchor: "2026-10-01", cur: "2026-10-31", comp: "2026-10-31", freq: "Daily", basis: "SCHEDULED", exp: "2026-11-01", expSkip: 0 },
      // 3. Every 7 days (+7)
      { anchor: "2026-10-05", cur: "2026-10-12", comp: "2026-10-12", freq: "Every 7 days", basis: "SCHEDULED", exp: "2026-10-19", expSkip: 0 },
      // 4. Every 7 days month rollover
      { anchor: "2026-10-05", cur: "2026-10-26", comp: "2026-10-26", freq: "Every 7 days", basis: "SCHEDULED", exp: "2026-11-02", expSkip: 0 },
      // 5. Every 15 days (+15)
      { anchor: "2026-10-01", cur: "2026-10-01", comp: "2026-10-01", freq: "Every 15 days", basis: "SCHEDULED", exp: "2026-10-16", expSkip: 0 },
      // 6. Every 15 days month rollover
      { anchor: "2026-10-01", cur: "2026-10-16", comp: "2026-10-16", freq: "Every 15 days", basis: "SCHEDULED", exp: "2026-10-31", expSkip: 0 },
      // 7. Monthly: Jan 31 -> Feb 28 (Non-leap year 2027)
      { anchor: "2027-01-31", cur: "2027-01-31", comp: "2027-01-31", freq: "Monthly", basis: "SCHEDULED", exp: "2027-02-28", expSkip: 0 },
      // 8. Monthly: Jan 31 -> Feb 29 (Leap year 2028)
      { anchor: "2028-01-31", cur: "2028-01-31", comp: "2028-01-31", freq: "Monthly", basis: "SCHEDULED", exp: "2028-02-29", expSkip: 0 },
      // 9. Monthly: Feb 28 -> Mar 31 (Anchor 31 preserved!)
      { anchor: "2027-01-31", cur: "2027-02-28", comp: "2027-02-28", freq: "Monthly", basis: "SCHEDULED", exp: "2027-03-31", expSkip: 0 },
      // 10. Monthly: Mar 31 -> Apr 30 (Anchor 31 clamped to 30)
      { anchor: "2027-01-31", cur: "2027-03-31", comp: "2027-03-31", freq: "Monthly", basis: "SCHEDULED", exp: "2027-04-30", expSkip: 0 },
      // 11. Monthly: Apr 30 -> May 31 (Anchor 31 restored!)
      { anchor: "2027-01-31", cur: "2027-04-30", comp: "2027-04-30", freq: "Monthly", basis: "SCHEDULED", exp: "2027-05-31", expSkip: 0 },
      // 12. Monthly: Dec 31 -> Jan 31 (Year rollover)
      { anchor: "2026-12-31", cur: "2026-12-31", comp: "2026-12-31", freq: "Monthly", basis: "SCHEDULED", exp: "2027-01-31", expSkip: 0 },
      // 13. Monthly mid-month anchor (15th) -> Feb 15
      { anchor: "2027-01-15", cur: "2027-01-15", comp: "2027-01-15", freq: "Monthly", basis: "SCHEDULED", exp: "2027-02-15", expSkip: 0 },
      // 14. Monthly mid-month anchor (15th) -> Mar 15
      { anchor: "2027-01-15", cur: "2027-02-15", comp: "2027-02-15", freq: "Monthly", basis: "SCHEDULED", exp: "2027-03-15", expSkip: 0 },
      // 15. Drift Test: Late completion 3 days late on 7-day task (SCHEDULED basis prevents drift)
      { anchor: "2026-10-05", cur: "2026-10-12", comp: "2026-10-15", freq: "Every 7 days", basis: "SCHEDULED", exp: "2026-10-19", expSkip: 0 },
      // 16. Drift Test: Late completion on COMPLETION basis (shifts schedule)
      { anchor: "2026-10-05", cur: "2026-10-12", comp: "2026-10-15", freq: "Every 7 days", basis: "COMPLETION", exp: "2026-10-22", expSkip: 0 },
      // 17. Multi-Cycle Late: 7-day task completed 20 days late (skips 2 cycles)
      { anchor: "2026-10-01", cur: "2026-10-01", comp: "2026-10-21", freq: "Every 7 days", basis: "SCHEDULED", exp: "2026-10-22", expSkip: 2 },
      // 18. Multi-Cycle Late: Daily task completed 5 days late (skips 4 cycles)
      { anchor: "2026-10-01", cur: "2026-10-01", comp: "2026-10-05", freq: "Daily", basis: "SCHEDULED", exp: "2026-10-06", expSkip: 4 },
      // 19. Leap Year check: 2028 is leap, 2029 is not
      { anchor: "2028-02-29", cur: "2028-02-29", comp: "2028-02-29", freq: "Monthly", basis: "SCHEDULED", exp: "2028-03-29", expSkip: 0 },
      // 20. Leap Year Feb 29 to next year Feb 28
      { anchor: "2028-02-29", cur: "2029-01-29", comp: "2029-01-29", freq: "Monthly", basis: "SCHEDULED", exp: "2029-02-28", expSkip: 0 }
    ];

    var passed = 0;
    var failed = 0;
    var results = [];

    for (var i = 0; i < testCases.length; i++) {
      var tc = testCases[i];
      var res = this.calculateNextDueDate(tc.anchor, tc.cur, tc.comp, tc.freq, tc.basis);
      var ok = (res.nextDueDate === tc.exp) && (res.skippedCycles === tc.expSkip);

      if (ok) {
        passed++;
      } else {
        failed++;
      }

      results.push({
        case: (i + 1) + ". " + tc.freq + " [" + tc.basis + "] cur:" + tc.cur + " comp:" + tc.comp,
        expected: tc.exp + " (skip: " + tc.expSkip + ")",
        actual: res.nextDueDate + " (skip: " + res.skippedCycles + ")",
        ok: ok
      });
    }

    console.info("TaskService.runRecurrenceSelfCheck results: " + passed + " passed, " + failed + " failed.");
    return { passed: passed, failed: failed, results: results };
  }
};
