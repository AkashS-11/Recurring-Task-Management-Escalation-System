# Testing Strategy & Test Scenarios Specification

## 1. Overview
This document outlines the testing strategy, automated test suite architecture, manual functional scenarios, and edge-case validation matrices for the Recurring Task Management and Escalation System.

---

## 2. Testing Strategy Tiers

The system is tested across three complementary tiers:
1. **Unit Tier (Pure Algorithmic Logic)**:
   - Tests `TaskService.calculateNextDueDate()`, date-only UTC math, leap-year checks, anchor-day month-end clamping, and validation regexes.
   - Zero sheet reads or API calls; instant execution with guaranteed determinism.
2. **Functional Tier (Sheet & Workflow State)**:
   - Exercises end-to-end task completions, duplicate cycle blocking, manager acknowledgements preservation, and status transitions using temporary scratch sheets (`__TEST_SCRATCH__`).
3. **Simulation & Time-Travel Tier**:
   - Uses `Config.DEMO_DATE_OVERRIDE` to simulate time passage across Day 0, Day 2, and Day 5 escalation milestones without requiring real elapsed days.

---

## 3. Automated Test Suite (`src/Tests.gs`)

The test suite is executable via `runAllTests()` from the Apps Script editor or through the `Task System > Run All Tests` custom menu.

| Test ID | Test Scenario | Category | Expected Result | Pass Criteria |
|---|---|---|---|---|
| **T-01** | Daily next due date (+1 day) | Recurrence | Advanced by exactly 1 calendar day | Date is $+1$ day |
| **T-02** | Weekly next due date (+7 days) | Recurrence | Advanced by exactly 7 calendar days | Date is $+7$ days |
| **T-03** | 15-Day next due date (+15 days) | Recurrence | Advanced by exactly 15 calendar days | Date is $+15$ days |
| **T-04** | Monthly Jan 31 -> Feb 28 (Non-leap 2027) | Recurrence | Clamped to last day of February (28) | Returns `2027-02-28` |
| **T-05** | Monthly Jan 31 -> Feb 29 (Leap year 2028) | Recurrence | Clamped to leap day (29) | Returns `2028-02-29` |
| **T-06** | Monthly Feb 28 -> Mar 31 (Anchor 31 preserved) | Recurrence | Restores original 31st anchor day | Returns `2027-03-31` |
| **T-07** | Monthly Mar 31 -> Apr 30 -> May 31 | Recurrence | Full quarter clamp and restore | Returns `2027-04-30` and `2027-05-31` |
| **T-08** | Monthly Dec 31 -> Jan 31 (Year rollover) | Recurrence | Advances year and retains 31st | Returns `2027-01-31` |
| **T-09** | Leap Year Feb 29 2028 -> Feb 28 2029 | Recurrence | Clamps to Feb 28 in non-leap year | Returns `2029-02-28` |
| **T-10** | 10 Consecutive late completions zero drift | Recurrence | Final due date equals Anchor $+ 70$ days | Zero cumulative drift |
| **T-11** | Multi-cycle late completion (25 days late) | Recurrence | Rolls forward to future cycle and reports missed count | Future date + 2 skipped cycles |
| **T-12** | Ticket ID regex pattern validation | Validation | Passes valid JIRA tickets; rejects invalid | Pattern verified |
| **T-13** | Email format validation | Validation | Validates standard and placeholder emails | Valid email verified |
| **T-14** | Config threshold hierarchy validation | Validation | Rejects if `REMINDER > MANAGER` or `MANAGER >= LEAD` | Hierarchy enforced |
| **T-15** | Escalation threshold evaluation math | Escalation | Accurate day counts for D+1, D+2, D+4, D+5, D+6 | Exact day count match |
| **T-16** | `DEMO_DATE_OVERRIDE` date simulation | Simulation | `Utils.getToday()` reflects simulated date | Simulated date match |
| **T-17** | UTC midnight date arithmetic safety | Date Math | Date arithmetic unaffected by DST or time of day | Normalized date strings |
| **T-18** | Escalation cancellation upon completion | Escalation | Completed task excluded from leadership alert | Status check suppression |
| **T-19** | Scratch sheet completion & dedupe check | Functional | Append completion row; reject duplicate Cycle ID | Returns `DUPLICATE` |

---

## 4. Manual Functional Test Scenarios

### Scenario FS-01: WhatsApp-Style Daily Task One-Click Completion
1. **Pre-condition**: Task `TASK-001` (Daily, `Proof Required = N`) is listed on `Employee Dashboard`.
2. **Action**: Employee checks the `Mark Complete` checkbox in Column H.
3. **Expected Behavior**:
   - Checkbox briefly shows checked, then reverts to unchecked.
   - Toast displays: `"Task completed successfully! Next due date: [Tomorrow]"`.
   - `Completion Log` appends one row with auto-generated proof (`AUTO:user|today|cycleId`).
   - `Task Master` advances `Current Due Date` by $+1$ day, resets status to `Pending`.

### Scenario FS-02: Mandatory Proof Required Task
1. **Pre-condition**: Task `TASK-002` (Weekly, `Proof Required = Y`) is listed on `Employee Dashboard`.
2. **Action**: Employee checks `Mark Complete` while Column G (`Ticket ID / Proof`) is blank.
3. **Expected Behavior**:
   - Checkbox is immediately unchecked.
   - Toast alerts: `"Error: Proof / Ticket ID is required before marking this task complete."`.
   - `Error Log` records a validation warning.
   - No rows are appended to `Completion Log`.
4. **Follow-up Action**: Employee enters `https://jira.corp/SEC-101` in Column G and ticks `Mark Complete`.
5. **Expected Behavior**: Completion succeeds, proof URL is recorded in `Completion Log`, and Column G is cleared.

### Scenario FS-03: Rapid Double-Click & Idempotency Gating
1. **Action**: Quickly double-click or spam the checkbox on a pending task.
2. **Expected Behavior**:
   - First click acquires `LockService` lock and processes completion.
   - Second click enters after lock is released, matches existing `Cycle ID` in `Completion Log`, returns `{status: 'DUPLICATE'}`, and reverts checkbox without writing duplicate rows.

### Scenario FS-04: Manager Acknowledgement Persistence Across Refresh
1. **Pre-condition**: `Manager Dashboard` displays an overdue task at row 15.
2. **Action**: Manager selects `"Acknowledged"` from the dropdown in Column F.
3. **Expected Behavior**: Column G auto-populates with the current timestamp.
4. **Action**: Trigger `Task System > Refresh Dashboards`.
5. **Expected Behavior**: The dashboard re-renders; the `"Acknowledged"` status and timestamp remain intact because the renderer reconciles by `Cycle ID`.

---

## 5. Edge-Case Scenarios & Resilience Matrix

| Edge Case ID | Scenario | System Behavior & Mitigation |
|---|---|---|
| **EC-01** | **Spreadsheet Column Reordered** | `Utils.getHeaderMap()` resolves column coordinates by exact header text at runtime; scripts function without error. |
| **EC-02** | **Multi-Cell Range Paste** | `handleEdit(e)` loops through every row in `e.range` and evaluates completion independently for each row. |
| **EC-03** | **Consumer Gmail Blank Active User** | `Session.getActiveUser()` returns empty; falls back to `Session.getEffectiveUser()` with warning logged to `Error Log`. |
| **EC-04** | **MailApp Daily Quota Exhausted** | `ReminderService` and `EscalationService` check `MailApp.getRemainingDailyQuota()`. If $< 5$, email dispatch halts gracefully with a logged warning, allowing dashboard updates to continue. |
| **EC-05** | **Task Paused by Admin** | Task marked `Status = 'Paused'` is skipped by daily jobs; zero reminder or escalation emails are dispatched. |
| **EC-06** | **Concurrent Edits by Two Users** | `LockService.getScriptLock()` serializes updates; the second transaction cleanly awaits lock or times out without data corruption. |
| **EC-07** | **Log Bloat Over Time** | When `Error Log` exceeds `Config.LOG_MAX_ROWS`, `AppLogger.flush()` deletes the oldest rows to maintain spreadsheet speed. |

---

## 6. Verification Self-Check
- [x] All 19 unit test cases defined and implemented in `src/Tests.gs`.
- [x] Recurrence, leap years, month-end clamping, and zero-drift proofs covered.
- [x] Manual functional test scenarios and edge-case handling documented.
- [x] Isolated temporary scratch sheet testing guarantees zero mutation of production data.
