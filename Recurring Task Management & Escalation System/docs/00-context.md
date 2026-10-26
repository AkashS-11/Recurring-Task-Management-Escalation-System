# Master Context: Recurring Task & Escalation System

## 1. Project Overview & Role
- **Role**: Senior Google Apps Script Architect.
- **Objective**: Build a production-grade prototype of a recurring task management and escalation system implemented strictly using **Google Sheets** as the primary user interface / data store and **Google Apps Script** as the backend automation engine.
- **Strict Constraints**: 
  - Strictly forbidden: React, custom HTML/web apps, external databases (Firebase, Supabase, Cloud SQL), third-party automation tools (Zapier, Make).
  - All interactions, visualizations, inputs, and logs reside inside a single Google Sheets workbook.
- **Core Frequencies Supported**:
  1. `Daily` (+1 day)
  2. `Every 7 days` (+7 days)
  3. `Every 15 days` (+15 days)
  4. `Monthly` (true calendar-month logic: preserves original anchor day-of-month, clamps to month-end, handles leap years).
- **Core End-to-End Workflow**:
  $$\text{Task Due} \longrightarrow \text{Employee Completes} \longrightarrow \text{Completion Recorded} \longrightarrow \text{Pending Detected} \longrightarrow \text{Reminder (Day 0)} \longrightarrow \text{Manager Alert (Day 2 Overdue)} \longrightarrow \text{Leadership Escalation (Day 5 Overdue)}$$
- **Workbook Sheets (7 total)**:
  1. `Task Master`: Master recurring definitions & current cycle state.
  2. `Employee Dashboard`: Single input UI for employees (checkboxes & proof entry).
  3. `Completion Log`: Immutable, append-only historical audit trail.
  4. `Manager Dashboard`: Operational oversight, KPIs, employee summary, overdue list with acknowledgements.
  5. `Escalation Dashboard`: Incident queue showing tasks breaching Manager (Day 2) and Leadership (Day 5) thresholds.
  6. `Config`: Key-value system parameters, threshold settings, and employee directory.
  7. `Error Log`: Centralized operational failure log with stack traces and JSON context.
- **Source Files (10 core + 1 test file)**:
  - `Code.gs`, `Setup.gs`, `Triggers.gs`, `TaskService.gs`, `CompletionService.gs`, `ReminderService.gs`, `EscalationService.gs`, `ValidationService.gs`, `DashboardService.gs`, `Utils.gs`, plus `Tests.gs`.

---

## 2. Locked Decisions (Verbatim & Binding)

1. **Data Model Structure**: Exactly one row in `Task Master` per recurring task assignment representing template configuration plus active cycle state. Historical completions live solely in the append-only `Completion Log`.
2. **Cycle Identification & Idempotency Key**:
   $$\text{Cycle ID} = \text{TaskRowID} \parallel \text{"|"} \parallel \text{yyyy-MM-dd(due date)}$$
   All state-mutating writes must acquire an exclusive `LockService.getScriptLock()` (with timeout handling) prior to mutation.
3. **Task Status State Machine**: Four discrete states only:
   - `Pending`: Awaiting completion for current cycle, due date $\ge \text{today}$.
   - `Overdue`: Uncompleted and due date $< \text{today}$.
   - `Completed`: Marked complete for current cycle; transitioned immediately to next cycle.
   - `Paused`: Inactive / temporarily frozen task; excluded from reminder, escalation, and overdue transitions.
4. **Single Employee Input Surface**: Employees interact exclusively via the `Employee Dashboard`. Interaction consists solely of ticking a "Mark Complete" checkbox and/or entering a "Ticket ID / Proof". The `Proof Required` flag (`Y`/`N`) on `Task Master` dictates whether proof is mandatory.
5. **Recurrence Drift Prevention**: The next due date is derived from the **SCHEDULED** due date (anchor-based calculation) rather than the completion timestamp to prevent cumulative drift over time. Controlled by the `Config` parameter `RECURRENCE_BASIS` (`SCHEDULED` | `COMPLETION`). Monthly recurrence always derives from the original anchor day-of-month and clamps to the target month's last day, never chaining from an already-clamped date.
6. **Notification Deduplication & Re-execution Safety**: Each notification tier (Day 0 Reminder, Day 2 Manager Alert, Day 5 Leadership Escalation) fires at most once per cycle. Sent timestamps (`Reminder Sent At`, `Manager Alert Sent At`, `Leadership Alert Sent At`) are committed to `Task Master`. All automation jobs (`dailyJob()`, `sendDueReminders()`, `runEscalations()`) must be strictly idempotent.
7. **Installable Triggers & Schema Resilience**: 
   - Uses an installable `onEdit` trigger (`handleEdit`) rather than a simple `onEdit` (which lacks email sending permissions and cannot reliably retrieve user identity across domains).
   - Columns are resolved dynamically by header name via a unified schema dictionary (`Utils.SCHEMA`), never by hard-coded numerical indices.
   - Explicit timezone is loaded from `Config` (`TIMEZONE`), and date comparisons use normalized date-only arithmetic (midnight-to-midnight) to avoid midnight edge-case skew.
8. **Logging & Code Quality Standards**: Every public function is wrapped in `try/catch` using a centralized logging wrapper (`Utils.withErrorHandling`). Operational errors log to `Error Log` via `AppLogger`. Complete JSDoc annotations on all functions. No pseudocode, no placeholder `TODO`s, and no unverified/hallucinated Apps Script APIs.
9. **Evaluator Demo Mode**: A global override switch (`Config` key `DEMO_DATE_OVERRIDE`) enables reviewers and automated tests to simulate arbitrary dates without waiting days in real time.

---

## 3. Analysis of Contradictions & Ambiguities

### 3.1 Contradiction: `nextDue = completedDate + N` vs. Recurrence Drift
- **Issue**: Standard prompt descriptions often casually suggest `nextDue = completedDate + N`. However, if an employee completes a 7-day task 4 days late, setting `nextDue = completedDate + 7` shifts the schedule forward by 4 days, causing permanent calendar slippage.
- **Resolution**: We strictly adhere to Locked Decision 5. By default, `RECURRENCE_BASIS = SCHEDULED`. The formula is:
  $$\text{nextDue} = \text{currentDueDate} + N$$
  If a task is completed multiple cycles late (e.g., 20 days late on a 7-day task), the engine rolls the due date forward to the first future cycle relative to the completion date, logging skipped cycles as `MISSED` in `Completion Log` to maintain schedule integrity. If `RECURRENCE_BASIS = COMPLETION` is explicitly chosen in `Config`, the alternative formula is respected.

### 3.2 Ambiguity: Employee Identity Retrieval in Google Sheets
- **Issue**: `Session.getActiveUser().getEmail()` often returns an empty string if users belong to consumer `@gmail.com` accounts or if execution contexts lack domain delegation.
- **Resolution**: We implement a fallback cascade:
  1. Primary: `Session.getActiveUser().getEmail()`
  2. Fallback: `Session.getEffectiveUser().getEmail()` (the script owner/installer) with a warning logged.
  3. Guardrail: In single-dashboard shared setups, the user email is matched against the assigned task's `Employee Email` or an authorized administrator list in `Config`.

### 3.3 Ambiguity: Multi-Cell Edits and Pastes
- **Issue**: Standard `onEdit(e)` triggers assume `e.range` is a single cell (`e.value`). If an employee pastes or drags across multiple cells, `e.value` is `undefined`, and `e.range` spans multiple rows/columns.
- **Resolution**: `handleEdit(e)` processes `e.range` defensively by inspecting row and column coordinates, iterating row-by-row, verifying each target column, and passing individual cell updates through the completion engine.

### 3.4 Ambiguity: Filter Views vs. True Data Security
- **Issue**: Some requirements ask for employees to see only their own tasks. In Google Sheets, client-side Filter Views or hidden rows do not provide security against collaborators with Editor access.
- **Resolution**: The architecture explicitly clarifies this limitation in `14-security.md`. Within a single spreadsheet, protected ranges prevent employees from altering formulas, schemas, or other rows, but cannot prevent read access to visible sheets. We implement enforced protected ranges and document the multi-sheet per-employee production architecture as the enterprise path.

---

## 4. Verification Self-Check
- [x] Only Google Sheets and Google Apps Script are used.
- [x] Verbatim locked decisions 1 through 9 are captured without modification.
- [x] Drift vs. completion-date trade-off is formally resolved.
- [x] All 7 sheets and 11 code files are accounted for.
- [x] No external dependencies or forbidden frameworks are introduced.
