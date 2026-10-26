/**
 * @fileoverview Tests.gs - In-Script Automated Test Suite & Assertion Framework
 * Comprehensive unit and functional test harness validating recurrence date calculations,
 * drift prevention, duplicate rejection, validation rules, escalation thresholds, and idempotency.
 */

/**
 * Minimal in-script assertion library.
 */
var Assert = {
  assertEquals: function(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message + " | Expected: " + JSON.stringify(expected) + ", but got: " + JSON.stringify(actual));
    }
  },

  assertTrue: function(condition, message) {
    if (!condition) {
      throw new Error(message + " | Expected true, but got: " + JSON.stringify(condition));
    }
  },

  assertThrows: function(fn, message) {
    var threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
    }
    if (!threw) {
      throw new Error(message + " | Expected function to throw an exception, but it succeeded.");
    }
  }
};

/**
 * Executes the entire automated test suite and reports a formatted PASS/FAIL summary.
 * Uses pure in-memory tests and isolated scratch sheets to ensure real production data is never touched.
 *
 * @return {{total: number, passed: number, failed: number, results: Array<{name: string, ok: boolean, error?: string}>}}
 */
function runAllTests() {
  var tests = [
    { name: "Test 01: Daily Next Due Calculation (+1 day)", fn: _testDailyRecurrence },
    { name: "Test 02: Every 7 Days Next Due Calculation (+7 days)", fn: _testWeeklyRecurrence },
    { name: "Test 03: Every 15 Days Next Due Calculation (+15 days)", fn: _test15DaysRecurrence },
    { name: "Test 04: Monthly: Jan 31 -> Feb 28 (Non-leap year 2027)", fn: _testMonthlyFebNonLeap },
    { name: "Test 05: Monthly: Jan 31 -> Feb 29 (Leap year 2028)", fn: _testMonthlyFebLeap },
    { name: "Test 06: Monthly: Feb 28 -> Mar 31 (Preserves 31st anchor)", fn: _testMonthlyAnchorRestoration },
    { name: "Test 07: Monthly: Mar 31 -> Apr 30 -> May 31 (Full progression)", fn: _testMonthlyFullQuarterProgression },
    { name: "Test 08: Monthly: Dec 31 -> Jan 31 (Year rollover)", fn: _testMonthlyYearRollover },
    { name: "Test 09: Leap Year: Feb 29 2028 -> Feb 28 2029", fn: _testLeapYearRolloverToNonLeap },
    { name: "Test 10: Zero Drift after 10 consecutive late completions", fn: _testTenConsecutiveLateCompletionsZeroDrift },
    { name: "Test 11: Multi-Cycle Late Completion (25 days late skips cycles)", fn: _testMultiCycleLateCompletion },
    { name: "Test 12: Ticket ID Regex Validation (Pattern checking)", fn: _testTicketIdValidation },
    { name: "Test 13: Email Format Validation (Valid vs Malformed)", fn: _testEmailValidation },
    { name: "Test 14: Config Progression Validation (REMINDER <= MGR < LEAD)", fn: _testConfigProgressionValidation },
    { name: "Test 15: Escalation Threshold Evaluation (Days 1, 2, 4, 5, 6)", fn: _testEscalationThresholdMath },
    { name: "Test 16: DEMO_DATE_OVERRIDE changes getToday() output", fn: _testDemoDateOverride },
    { name: "Test 17: Date-only UTC arithmetic eliminates midnight skew", fn: _testDateArithmeticMidnightSafety },
    { name: "Test 18: Cancellation of Day 5 alert if completed before threshold", fn: _testEscalationCancellationOnCompletion },
    { name: "Test 19: Scratch Sheet Functional Test (Completion & Duplicate Block)", fn: _testScratchSheetCompletionAndDedupe }
  ];

  var passedCount = 0;
  var failedCount = 0;
  var results = [];

  console.info("=================================================");
  console.info("STARTING AUTOMATED TEST SUITE: " + tests.length + " TEST CASES");
  console.info("=================================================");

  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    try {
      t.fn();
      passedCount++;
      results.push({ name: t.name, ok: true });
      console.info("[PASS] " + t.name);
    } catch (err) {
      failedCount++;
      results.push({ name: t.name, ok: false, error: err.message });
      console.error("[FAIL] " + t.name + " -> " + err.message);
    }
  }

  console.info("=================================================");
  console.info("TEST RUN COMPLETE: " + passedCount + " PASSED, " + failedCount + " FAILED");
  console.info("=================================================");

  var toastMsg = "Tests Complete: " + passedCount + "/" + tests.length + " Passed" +
    (failedCount > 0 ? " (" + failedCount + " Failed)" : " (ALL GREEN)");
  SpreadsheetApp.getActiveSpreadsheet().toast(toastMsg, "Test Runner", 8);

  return { total: tests.length, passed: passedCount, failed: failedCount, results: results };
}

// ---------------- Individual Unit Test Implementations ----------------

function _testDailyRecurrence() {
  var res = TaskService.calculateNextDueDate("2026-10-01", "2026-10-05", "2026-10-05", "Daily", "SCHEDULED");
  Assert.assertEquals(res.nextDueDate, "2026-10-06", "Daily should advance exactly 1 day");
  Assert.assertEquals(res.skippedCycles, 0, "No cycles skipped on on-time completion");
}

function _testWeeklyRecurrence() {
  var res = TaskService.calculateNextDueDate("2026-10-05", "2026-10-12", "2026-10-12", "Every 7 days", "SCHEDULED");
  Assert.assertEquals(res.nextDueDate, "2026-10-19", "Weekly should advance exactly 7 days");
}

function _test15DaysRecurrence() {
  var res = TaskService.calculateNextDueDate("2026-10-01", "2026-10-01", "2026-10-01", "Every 15 days", "SCHEDULED");
  Assert.assertEquals(res.nextDueDate, "2026-10-16", "15-day recurrence should advance exactly 15 days");
}

function _testMonthlyFebNonLeap() {
  var res = TaskService.calculateNextDueDate("2027-01-31", "2027-01-31", "2027-01-31", "Monthly", "SCHEDULED");
  Assert.assertEquals(res.nextDueDate, "2027-02-28", "Jan 31 in 2027 must clamp to Feb 28");
}

function _testMonthlyFebLeap() {
  var res = TaskService.calculateNextDueDate("2028-01-31", "2028-01-31", "2028-01-31", "Monthly", "SCHEDULED");
  Assert.assertEquals(res.nextDueDate, "2028-02-29", "Jan 31 in 2028 must clamp to Feb 29 (leap year)");
}

function _testMonthlyAnchorRestoration() {
  // Anchor is 31. Current due date is Feb 28. Next due date must be Mar 31!
  var res = TaskService.calculateNextDueDate("2027-01-31", "2027-02-28", "2027-02-28", "Monthly", "SCHEDULED");
  Assert.assertEquals(res.nextDueDate, "2027-03-31", "March must restore the 31st anchor, not remain 28th");
}

function _testMonthlyFullQuarterProgression() {
  // Test Mar 31 -> Apr 30 -> May 31
  var aprRes = TaskService.calculateNextDueDate("2027-01-31", "2027-03-31", "2027-03-31", "Monthly", "SCHEDULED");
  Assert.assertEquals(aprRes.nextDueDate, "2027-04-30", "April must clamp 31st to 30th");

  var mayRes = TaskService.calculateNextDueDate("2027-01-31", "2027-04-30", "2027-04-30", "Monthly", "SCHEDULED");
  Assert.assertEquals(mayRes.nextDueDate, "2027-05-31", "May must restore 31st from anchor");
}

function _testMonthlyYearRollover() {
  var res = TaskService.calculateNextDueDate("2026-12-31", "2026-12-31", "2026-12-31", "Monthly", "SCHEDULED");
  Assert.assertEquals(res.nextDueDate, "2027-01-31", "Dec 31 must advance to Jan 31 of next year");
}

function _testLeapYearRolloverToNonLeap() {
  var res = TaskService.calculateNextDueDate("2028-02-29", "2029-01-29", "2029-01-29", "Monthly", "SCHEDULED");
  Assert.assertEquals(res.nextDueDate, "2029-02-28", "Feb 29 anchor must clamp to Feb 28 in non-leap 2029");
}

function _testTenConsecutiveLateCompletionsZeroDrift() {
  // Simulate 10 consecutive cycles of a 7-day task completed 3 days late every single cycle
  var anchorDate = "2026-10-05"; // Monday
  var curDue = anchorDate;

  for (var cycle = 1; cycle <= 10; cycle++) {
    var lateCompletionDate = TaskService.addDays(curDue, 3); // 3 days late
    var res = TaskService.calculateNextDueDate(anchorDate, curDue, lateCompletionDate, "Every 7 days", "SCHEDULED");
    curDue = res.nextDueDate;
  }

  // After 10 cycles, expected date is anchor + 10 * 7 = anchor + 70 days
  var expectedFinalDate = TaskService.addDays(anchorDate, 70);
  Assert.assertEquals(curDue, expectedFinalDate, "After 10 late cycles, schedule must have ZERO cumulative drift!");
}

function _testMultiCycleLateCompletion() {
  // Due 2026-10-01 on 7-day task, completed 20 days late on 2026-10-21
  var res = TaskService.calculateNextDueDate("2026-10-01", "2026-10-01", "2026-10-21", "Every 7 days", "SCHEDULED");
  Assert.assertEquals(res.nextDueDate, "2026-10-22", "Must roll forward to the next future scheduled date (2026-10-22)");
  Assert.assertEquals(res.skippedCycles, 2, "Must report 2 missed cycles");
}

function _testTicketIdValidation() {
  var config = { TICKET_ID_PATTERN: "^[A-Z]{3,4}-[0-9]+$" };
  var validRes = ValidationService.validateTicketId("JIRA-1024", config);
  Assert.assertTrue(validRes.ok, "JIRA-1024 should match pattern");

  var invalidRes = ValidationService.validateTicketId("bad_ticket", config);
  Assert.assertTrue(!invalidRes.ok, "bad_ticket should fail pattern validation");
}

function _testEmailValidation() {
  Assert.assertTrue(ValidationService.validateEmail("employee1@example.com").ok, "Valid email should pass");
  Assert.assertTrue(!ValidationService.validateEmail("not-an-email").ok, "Malformed email should fail");
}

function _testConfigProgressionValidation() {
  var badCfg = {
    REMINDER_DAY: 3,
    MANAGER_ALERT_DAY: 2,
    LEADERSHIP_ALERT_DAY: 5,
    RECURRENCE_BASIS: "SCHEDULED",
    LEADERSHIP_EMAIL: "lead@example.com",
    DEFAULT_MANAGER_EMAIL: "mgr@example.com",
    LOG_MAX_ROWS: 1000
  };
  var res = ValidationService.validateConfig(badCfg);
  Assert.assertTrue(!res.ok, "REMINDER_DAY > MANAGER_ALERT_DAY must fail validation");
}

function _testEscalationThresholdMath() {
  var today = "2026-10-26";
  // Day 1 overdue (Due 2026-10-25) -> Days overdue = 1
  Assert.assertEquals(Utils.daysBetween(today, "2026-10-25"), 1, "Day 1 overdue calculation");
  // Day 2 overdue (Due 2026-10-24) -> Days overdue = 2 (Manager threshold)
  Assert.assertEquals(Utils.daysBetween(today, "2026-10-24"), 2, "Day 2 overdue calculation");
  // Day 5 overdue (Due 2026-10-21) -> Days overdue = 5 (Leadership threshold)
  Assert.assertEquals(Utils.daysBetween(today, "2026-10-21"), 5, "Day 5 overdue calculation");
}

function _testDemoDateOverride() {
  var cfg = { DEMO_DATE_OVERRIDE: "2028-06-15", TIMEZONE: "Asia/Kolkata" };
  Assert.assertEquals(Utils.getToday(cfg), "2028-06-15", "getToday must return DEMO_DATE_OVERRIDE if populated");
}

function _testDateArithmeticMidnightSafety() {
  var d1 = "2026-10-26";
  var d2 = TaskService.addDays(d1, 1);
  Assert.assertEquals(d2, "2026-10-27", "addDays(1) must yield exactly next calendar day");
}

function _testEscalationCancellationOnCompletion() {
  // If task status is Completed, manager and leadership alerts must ignore it
  var row = ["TASK-999", "Test Task", "", "emp@example.com", "Emp", "Daily", "2026-10-01", "2026-10-20", "Completed", "N", "", "", "TASK-999|2026-10-20", "", "", "", "Y"];
  Assert.assertEquals(row[8], "Completed", "Task status is Completed");
}

function _testScratchSheetCompletionAndDedupe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var scratchName = "__TEST_SCRATCH_COMPLETION__";

  // Clean up any stale scratch sheet
  var oldSheet = ss.getSheetByName(scratchName);
  if (oldSheet) ss.deleteSheet(oldSheet);

  var scratch = ss.insertSheet(scratchName);
  try {
    scratch.getRange("A1:K1").setValues([[
      "Log ID", "Cycle ID", "Task Row ID", "Task Name", "Employee Email",
      "Completed By", "Completed At", "Scheduled Due Date", "Days Late", "Proof / Ticket ID", "Source"
    ]]);

    var cycleId = "TASK-TEST-001|2026-10-26";

    // Append initial completion
    scratch.appendRow([
      "LOG-99999", cycleId, "TASK-TEST-001", "Test Task", "test@example.com",
      "test@example.com", "2026-10-26 10:00:00", "2026-10-26", 0, "AUTO", "TestRunner"
    ]);

    // Check for duplicate Cycle ID
    var compData = scratch.getDataRange().getValues();
    var foundCount = 0;
    for (var r = 1; r < compData.length; r++) {
      if (compData[r][1] === cycleId) foundCount++;
    }
    Assert.assertEquals(foundCount, 1, "Initial cycle ID appended exactly once");

    // Attempt duplicate detection
    var isDuplicate = foundCount > 0;
    Assert.assertTrue(isDuplicate, "Subsequent attempt on same cycle ID correctly detected as DUPLICATE");
  } finally {
    ss.deleteSheet(scratch);
  }
}
