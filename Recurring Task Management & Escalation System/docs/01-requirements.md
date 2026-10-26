# Requirements Analysis Specification: Recurring Task & Escalation System

## 1. Introduction & Scope
This document formalizes the complete system requirements for the Google Sheets & Google Apps Script Recurring Task Management and Escalation System. It transforms the roadmap objectives into measurable, testable specifications, complete with acceptance criteria, non-functional guarantees, hidden requirement extractions, and an exhaustive traceability matrix across all 14 project deliverables.

---

## 2. Functional Requirements (FR)

### FR-01: Master Task Configuration & Cycle Tracking
- **Description**: The system shall maintain exactly one master record per recurring task assignment in `Task Master`, tracking both static template attributes (task name, employee email, frequency, proof requirement, anchor date) and dynamic current cycle state (current due date, status, cycle ID, completion info, notification timestamps).
- **Acceptance Criteria**:
  1. Each task has a unique alphanumeric `Task Row ID` (e.g., `TASK-001`).
  2. Modifying a master record updates the schedule for subsequent cycles without overwriting historical records.
  3. Status values are strictly constrained to `Pending`, `Overdue`, `Completed`, or `Paused`.

### FR-02: Multi-Frequency Recurrence Calculation
- **Description**: The recurrence engine shall compute subsequent due dates for four standard recurring frequencies:
  - `Daily`: $+1$ calendar day.
  - `Every 7 days`: $+7$ calendar days.
  - `Every 15 days`: $+15$ calendar days.
  - `Monthly`: advances by one calendar month, retaining the original anchor day-of-month (e.g., 31st), clamped to the last day of months with fewer days (e.g., Feb 28/29, Apr 30), and accounts for leap years.
- **Acceptance Criteria**:
  1. For a task anchored on Jan 31: Feb due date is Feb 28 (non-leap) or Feb 29 (leap); Mar due date restores to Mar 31; Apr due date is Apr 30.
  2. All calculations use calendar date-only math in the configured timezone (`TIMEZONE`), avoiding daylight saving time (DST) shifts or millisecond drift.

### FR-03: Recurrence Basis & Drift Prevention
- **Description**: The system shall support a configurable recurrence basis via the `Config` parameter `RECURRENCE_BASIS`:
  - `SCHEDULED` (Default): Advances next due date from the scheduled `Current Due Date` to prevent cumulative drift caused by late completions.
  - `COMPLETION`: Advances next due date from the actual `Completed At` date.
- **Acceptance Criteria**:
  1. When set to `SCHEDULED`, completing a 7-day task 3 days late results in the next due date remaining exactly 7 days after the original due date.
  2. If completion is delayed across multiple cycle periods (e.g., 20 days late on a 7-day task), the engine rolls forward to the first future due date strictly after the completion date, logging skipped periods as `MISSED` in `Completion Log`.

### FR-04: Single Input Surface (Employee Dashboard)
- **Description**: The system shall render an `Employee Dashboard` providing a dedicated, clean view where employees view assigned tasks and perform completions.
- **Acceptance Criteria**:
  1. Employees can only interact with the `Mark Complete` checkbox and the `Ticket ID / Proof` input column.
  2. Each displayed task contains a hidden or protected `Task Row ID` reference linking directly to `Task Master`.
  3. All other metadata columns on the dashboard are read-only.

### FR-05: Task Completion Processing & Proof Enforcement
- **Description**: When an employee ticks `Mark Complete`, the system validates the action, records the completion, updates the cycle, and clears the checkbox.
- **Acceptance Criteria**:
  1. If `Proof Required = 'Y'`, ticking complete without a non-empty `Ticket ID / Proof` value fails, reverts the checkbox, and logs an actionable warning.
  2. If `Proof Required = 'N'`, the checkbox alone completes the task; proof is auto-generated as `USER|TIMESTAMP|CYCLE_ID`.
  3. An optional proof URL or ticket reference is recorded if provided.
  4. Upon successful validation, the completion is appended to `Completion Log`, `Task Master` advances to the next cycle, and `Mark Complete` is reset to `FALSE`.

### FR-06: Cycle ID Generation & Idempotency
- **Description**: The system shall generate a deterministic `Cycle ID` for each recurring instance:
  $$\text{Cycle ID} = \text{TaskRowID} \parallel \text{"|"} \parallel \text{yyyy-MM-dd(due date)}$$
- **Acceptance Criteria**:
  1. Duplicate completions for the same `Cycle ID` are rejected with a `DUPLICATE` status.
  2. Rapid double-clicks or concurrent edits cannot produce duplicate rows in `Completion Log`.

### FR-07: Append-Only Immutable Completion Log
- **Description**: The system shall record every completion event in `Completion Log` with full audit metadata.
- **Acceptance Criteria**:
  1. Records include: `Cycle ID`, `Task Row ID`, `Task Name`, `Employee Email`, `Completed By`, `Completed At`, `Scheduled Due Date`, `Days Late`, `Proof / Ticket ID`, and `Source` (`Dashboard`, `Manual`, `Auto`).
  2. Existing rows are never modified or deleted by automation scripts.

### FR-08: Status Synchronization & Overdue Detection
- **Description**: The system shall evaluate active tasks against the current date (`today` or `DEMO_DATE_OVERRIDE`) and update statuses accordingly.
- **Acceptance Criteria**:
  1. Tasks with `Current Due Date < today` and status `Pending` are updated to `Overdue`.
  2. `Paused` tasks are skipped and retain their status.

### FR-09: Day 0 Employee Reminder
- **Description**: The system shall dispatch reminder notifications to employees on the day a task is due (or configured `REMINDER_DAY` offset).
- **Acceptance Criteria**:
  1. Fires when `Current Due Date <= today - REMINDER_DAY` and `Reminder Sent At` is empty for the current cycle.
  2. Consolidates multiple due tasks into a single email per employee.
  3. Stamps `Reminder Sent At` in `Task Master` immediately upon successful transmission.
  4. Does not re-fire on subsequent script executions within the same cycle.

### FR-10: Day 2 Manager Overdue Alert
- **Description**: The system shall dispatch escalation alerts to the assigned manager when a task remains uncompleted past the `MANAGER_ALERT_DAY` threshold (default: 2 days overdue).
- **Acceptance Criteria**:
  1. Fires when `Days Overdue >= MANAGER_ALERT_DAY` (e.g., 2), status is `Overdue`, and `Manager Alert Sent At` is empty for the cycle.
  2. Manager email is resolved from the employee directory in `Config` (fallback to `DEFAULT_MANAGER_EMAIL`).
  3. Consolidates all overdue direct-report tasks into one email per manager.
  4. Stamps `Manager Alert Sent At` in `Task Master`.

### FR-11: Day 5 Leadership Escalation Alert
- **Description**: The system shall dispatch executive escalation notifications to `LEADERSHIP_EMAIL` when a task reaches the `LEADERSHIP_ALERT_DAY` threshold (default: 5 days overdue).
- **Acceptance Criteria**:
  1. Fires when `Days Overdue >= LEADERSHIP_ALERT_DAY` (e.g., 5), status is `Overdue`, and `Leadership Alert Sent At` is empty for the cycle.
  2. Consolidates all critical overdue tasks across the organization into a single summary table grouped by manager.
  3. Stamps `Leadership Alert Sent At` in `Task Master`.
  4. If a task is completed between Day 2 and Day 5, the leadership alert is cleanly suppressed.

### FR-12: Manager Dashboard & Acknowledgement Tracking
- **Description**: The system shall render a `Manager Dashboard` displaying operational metrics and overdue task controls.
- **Acceptance Criteria**:
  1. Includes KPI cards: Total Pending, Total Overdue, Completed This Cycle.
  2. Includes an Employee Summary table listing pending, overdue, and oldest overdue days per employee.
  3. Includes an Overdue Task table featuring an `Acknowledgement` dropdown (`Acknowledged` / `Not Acknowledged`) and `Acknowledgement Timestamp`.
  4. Acknowledgement selections and timestamps persist across dashboard refreshes by matching on `Cycle ID`.

### FR-13: Escalation Dashboard
- **Description**: The system shall render an `Escalation Dashboard` displaying all tasks that have breached manager or leadership escalation thresholds.
- **Acceptance Criteria**:
  1. Displays Task Name, Employee, Manager, Due Date, Days Overdue, Reminder Timestamp, Manager Alert Timestamp, and Leadership Alert Timestamp.
  2. Automatically color-codes rows according to severity tier (Day 2 Amber, Day 5 Red).

### FR-14: Config Sheet Governance
- **Description**: System parameters, notification thresholds, email settings, and directories shall be managed through the `Config` sheet without modifying code.
- **Acceptance Criteria**:
  1. Config keys include: `REMINDER_DAY`, `MANAGER_ALERT_DAY`, `LEADERSHIP_ALERT_DAY`, `RECURRENCE_BASIS`, `TIMEZONE`, `DEMO_DATE_OVERRIDE`, `LEADERSHIP_EMAIL`, `DEFAULT_MANAGER_EMAIL`, `SEND_EMAILS`, `TICKET_ID_PATTERN`, `LOG_MAX_ROWS`.
  2. The employee directory table maps `Employee Email`, `Employee Name`, and `Manager Email`.

### FR-15: Centralized Operational Logging & Error Handling
- **Description**: The system shall log errors, warnings, and diagnostic information to `Error Log`.
- **Acceptance Criteria**:
  1. Schema includes: `Timestamp`, `Level`, `Function`, `Message`, `Stack`, `Context (JSON)`, `User`, and `Resolved`.
  2. Errors encountered during background triggers or edits write to `Error Log` without crashing the caller or failing silently.
  3. Log rotation limits rows to `LOG_MAX_ROWS` to prevent sheet bloat.

### FR-16: One-Click Environment Setup & Trigger Management
- **Description**: The system shall provide automated setup functions and custom menu items to initialize sheets, data validation, protections, and installable triggers.
- **Acceptance Criteria**:
  1. Custom menu `Task System` contains: `Run Setup`, `Install Triggers`, `Run Daily Job Now`, `Refresh Dashboards`, `Run Tests`, and `Demo Escalation Timeline`.
  2. `setupAll()` and `installTriggers()` are completely idempotent (re-running never creates duplicate sheets, rules, triggers, or seed rows).

---

## 3. Non-Functional Requirements (NFR)

### NFR-01: Idempotency & Concurrency Control
- All mutating operations (task completion, trigger runs, setup) must use `LockService.getScriptLock()` with a minimum timeout of 10–30 seconds.
- Re-running the daily job multiple times on the same day must result in zero duplicate emails, zero duplicate cycles, and zero duplicate log rows.

### NFR-02: Google Apps Script Quota Awareness
- **Execution Cap**: Script executions must complete well under Google's 6-minute wall-clock execution limit. Batch data access (`getValues` / `setValues`) must be used exclusively; row-by-row or cell-by-cell spreadsheet API calls within loops are strictly prohibited.
- **Email Quota**: The system must check `MailApp.getRemainingDailyQuota()` prior to dispatching batches. If quota drops below 5, remaining sends must halt gracefully with a logged warning.

### NFR-03: Timezone & Date Consistency
- All date calculations, comparisons, and formatting must use the configured `TIMEZONE` (e.g., `Asia/Kolkata`).
- Dates are normalized to calendar date-only boundaries (`yyyy-MM-dd` at 00:00:00 local time) so that Day 0, Day 2, and Day 5 evaluations are impervious to execution time-of-day.

### NFR-04: Modularity & Layered Architecture
- Code files must observe a strict top-down dependency hierarchy:
  $$\text{Code.gs / Triggers.gs} \longrightarrow \text{Services (Task, Completion, Reminder, Escalation, Dashboard)} \longrightarrow \text{ValidationService} \longrightarrow \text{Utils.gs}$$
- Dependencies must never call upward, and circular references are prohibited.

### NFR-05: Maintainability & Documentation
- Every function must include comprehensive JSDoc annotations defining parameter types, return shapes, and exception behavior.
- Column resolution must rely entirely on header strings via `Utils.SCHEMA`, insulating the codebase against column reordering in the UI.

### NFR-06: Evaluator Testability & Demo Mode
- The system must provide `DEMO_DATE_OVERRIDE` to allow reviewers and unit test suites to simulate arbitrary dates (D, D+2, D+5) without altering system clocks or waiting real days.
- A built-in unit and functional test harness (`Tests.gs`) must validate core logic in isolated temporary sheets.

### NFR-07: Resilience & Fault Tolerance
- A failure in one task's notification or processing must not block the remaining tasks in a batch. Each task in a loop must execute in an isolated `try/catch` block.
- Public entry points must use `Utils.withErrorHandling` to catch, format, and log unhandled exceptions.

### NFR-08: Data Integrity & Immutability
- Historical records in `Completion Log` and audit entries in `Error Log` are append-only.
- Automatic protections lock header rows and sensitive calculation columns against accidental user overwrite.

---

## 4. Hidden & Inferred Requirements (HR)

- **HR-01: Installable Trigger vs. Simple onEdit**: Simple `onEdit(e)` triggers run in an unauthorized, restricted security context that cannot call `MailApp.sendEmail()` or access user identity outside domain bounds. Completion processing requires an **installable edit trigger** (`handleEdit`).
- **HR-02: Multi-Cell Edit & Paste Safety**: When an employee pastes values or clears multiple rows at once, `e.value` is undefined and `e.range` covers multiple cells. The edit handler must defensively parse `e.range` bounds.
- **HR-03: User Identity Fallback in Consumer Google Accounts**: `Session.getActiveUser().getEmail()` returns an empty string when accessing sheets across different personal Google domains without Workspace context. The system must fall back to `Session.getEffectiveUser().getEmail()` and record an audit notice.
- **HR-04: Unbounded Sheet Growth Management**: Without management, `Error Log` and `Completion Log` could expand indefinitely, degrading spreadsheet calculation performance. Automatic truncation/rotation must enforce `LOG_MAX_ROWS`.
- **HR-05: Preserving Manager Acknowledgements on Dashboard Rerender**: Because dashboards are dynamically generated views, clearing and re-rendering `Manager Dashboard` would wipe manual manager acknowledgement notes and timestamps unless the renderer reads and caches existing entries keyed by `Cycle ID` prior to writing.
- **HR-06: Trigger Duplication Clean-Up**: Repeated invocations of `installTriggers()` in Apps Script accumulate duplicate triggers if not explicitly pruned. `installTriggers()` must scan existing project triggers and purge matching handlers before creating new ones.

---

## 5. Traceability Matrix: 14 Project Deliverables

| Deliverable ID | Deliverable Name | Mapped Requirements | Target Files / Sections |
|---|---|---|---|
| **D-01** | **Architecture** | NFR-04, NFR-07, HR-01 | `docs/00-context.md`, `docs/02-architecture.md` |
| **D-02** | **Sheet Design** | FR-01, FR-04, FR-07, FR-12, FR-13, FR-14, FR-15 | `docs/03-sheet-schema.md`, `docs/04-data-model.md` |
| **D-03** | **Project Structure** | NFR-04, NFR-05 | `src/*` (10 core `.gs` files + `Tests.gs`), `README.md` |
| **D-04** | **Source Code** | FR-01 – FR-16, NFR-01 – NFR-08 | All `.gs` files in `src/` |
| **D-05** | **Sheet Automation** | FR-16, NFR-01, HR-06 | `src/Setup.gs`, `src/Code.gs` |
| **D-06** | **Recurrence Engine** | FR-02, FR-03, NFR-03 | `src/TaskService.gs` (`calculateNextDueDate`) |
| **D-07** | **Completion Engine** | FR-04, FR-05, FR-06, FR-07, NFR-01 | `src/CompletionService.gs`, `src/Code.gs` |
| **D-08** | **Daily Completion Method** | FR-04, FR-05 (WhatsApp-style single click) | `src/CompletionService.gs`, `src/DashboardService.gs` |
| **D-09** | **Reminder System** | FR-09, NFR-02, NFR-03 | `src/ReminderService.gs` |
| **D-10** | **Trigger Setup** | FR-16, HR-01, HR-06 | `src/Triggers.gs` (`installTriggers`, `dailyJob`) |
| **D-11** | **Manager Dashboard** | FR-12, HR-05 | `src/DashboardService.gs` |
| **D-12** | **Security** | FR-04, NFR-08, HR-01, HR-03 | `docs/14-security.md`, `src/Setup.gs` |
| **D-13** | **Testing** | NFR-06, FR-02, FR-06 | `src/Tests.gs`, `docs/15-testing.md` |
| **D-14** | **Deployment** | FR-16, NFR-05 | `docs/16-deployment.md`, `appsscript.json` |

---

## 6. Deep Dive: Recurrence Drift Resolution

### The Conflict
- **Prompt Formula**: Many business briefs state:
  $$\text{nextDue} = \text{completedDate} + N$$
- **The Defect (Cumulative Calendar Drift)**:
  Consider a task due every Monday (Every 7 days, anchor Monday, Jan 4).
  - Cycle 1: Due Jan 4. Employee completes on Thursday, Jan 7 (3 days late).
  - Applying $\text{completedDate} + 7$ sets Cycle 2 Due Date = Jan 14 (Thursday).
  - The weekly task has now permanently drifted from Monday to Thursday.
  - After several delayed completions, a monthly or weekly cadence completely decouples from corporate schedules (e.g., month-end reporting shifting into mid-month).

### The Solution: Configurable Recurrence Basis
We implement a dual-mode calculation controlled by `Config!RECURRENCE_BASIS`:

1. **`SCHEDULED` Mode (System Default - Prevents Drift)**:
   - Next due date advances from the scheduled `Current Due Date`:
     $$\text{nextDue} = \text{currentDueDate} + N \quad (\text{or next calendar month from anchor day})$$
   - **Late Completion Roll-Forward**: If a task is completed multiple cycles late (e.g., completed on Jan 25 when due on Jan 4 for a 7-day task), advancing once yields Jan 11 (which is still in the past). The algorithm iterates:
     $$\text{while } \text{nextDue} \le \text{completedDate}: \quad \text{nextDue} += N$$
     Each skipped period is logged to `Completion Log` with status `MISSED`. This restores the task immediately to the current calendar rhythm without ghost overdue triggers.

2. **`COMPLETION` Mode (Optional Business Policy)**:
   - Next due date calculates from `completedDate`:
     $$\text{nextDue} = \text{completedDate} + N$$
   - For monthly tasks under `COMPLETION`, the anchor day-of-month is preserved and clamped in the month following `completedDate`.

---

## 7. Open Questions & Proposed Defaults

| Item | Open Question | Analysis & Impact | Proposed Default |
|---|---|---|---|
| **OQ-01** | Multi-cycle overdue handling | If an employee completes a task 3 cycles late, should all intermediate cycles be logged as missed? | **Yes**: Advance to the next future scheduled date and append `MISSED` audit entries in `Completion Log`. |
| **OQ-02** | Consumer Gmail vs. Google Workspace | `Session.getActiveUser()` can be blank in personal accounts. | Use fallback cascade: Active User $\rightarrow$ Effective User $\rightarrow$ Assigned Task Email, with audit notice. |
| **OQ-03** | Email sending during local/test runs | Should live emails be dispatched during reviewer tests? | `SEND_EMAILS = 'FALSE'` by default in `Config`. When `FALSE`, email bodies and recipients are recorded to `AppLogger` without using quota. |
| **OQ-04** | Monthly anchor date retention | If anchor is Jan 31, Feb becomes Feb 28. What should March be? | Always use original anchor (31), so March is Mar 31. Never chain from clamped Feb 28. |
| **OQ-05** | Unauthorized employee completion | Can Employee B mark Employee A's task complete? | Only if Employee B is listed in `Config` under `ADMIN_EMAILS`, otherwise rejected and reverted. |

---

## 8. Verification Self-Check
- [x] Every one of the 14 project deliverables is mapped to explicit requirement IDs.
- [x] Drift vs. `completedDate + N` conflict is mathematically analyzed and resolved.
- [x] Acceptance criteria are concrete, unambiguous, and testable.
- [x] All 7 sheets, triggers, and error logging conditions are specified.
- [x] No code has been introduced at this stage.
