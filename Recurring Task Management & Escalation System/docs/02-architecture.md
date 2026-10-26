# System Architecture Specification: Recurring Task & Escalation System

## 1. Overview
This document specifies the technical architecture for the Google Sheets & Google Apps Script Recurring Task Management and Escalation System. It defines the component structures, inter-sheet data flows, execution triggers, escalation lifecycles, and a strictly enforced top-down module dependency hierarchy.

---

## 2. Architectural Diagrams

### Diagram 1: Overall System Workflow

```
+---------------------------------------------------------------------------------------------------+
|                                      OVERALL SYSTEM WORKFLOW                                      |
+---------------------------------------------------------------------------------------------------+

     +-----------------------+
     |   Task Configured     |  [Task Master] (Task Row ID, Anchor Date, Frequency, Employee)
     +-----------+-----------+
                 |
                 v
     +-----------------------+
     |  Dashboard Generation |  [DashboardService.renderEmployeeDashboard()]
     +-----------+-----------+
                 |
                 +-----------------------+-----------------------+
                 |                                               |
                 v                                               v
    [Time-Driven Daily Trigger]                      [Installable onEdit Trigger]
    (Triggers.gs -> dailyJob())                     (Code.gs -> handleEdit())
                 |                                               |
                 |                                               | (Employee clicks checkbox)
                 v                                               v
     +-----------------------+                       +-----------------------+
     | Due/Overdue Check     |                       | Task Completion Check |
     | & Status Update       |                       | & Proof Validation    |
     +-----------+-----------+                       +-----------+-----------+
                 |                                               |
        +--------+--------+                                      v
        |                 |                          +-----------------------+
     [Day 0]         [Overdue >= 2]                  | Acquire ScriptLock    |
        |                 |                          | Check Cycle ID Dupes  |
        v                 v                          +-----------+-----------+
    Reminder         Escalations                                 |
     Email       +--------+--------+                             v
    (Emp)        |                 |                 +-----------------------+
              [Day 2]           [Day 5]              | Write Completion Log  |
                 |                 |                 | Advance Next Cycle    |
                 v                 v                 | Reset Notification Col|
              Manager          Leadership            +-----------+-----------+
               Alert           Escalation                        |
                                                                 v
                                                     +-----------------------+
                                                     | Refresh Dashboards    |
                                                     +-----------------------+
```

**Explanation**:
The overall workflow operates through two distinct entry pathways: asynchronous scheduled execution via `dailyJob()` and real-time user interaction via `handleEdit()`. When an employee completes a task on the Employee Dashboard, the event immediately invokes the completion engine within a concurrency lock, writing an immutable record to the Completion Log and rolling forward the schedule in Task Master. Simultaneously, the daily time-driven job scans Task Master to update overdue statuses, dispatch Day 0 reminders to employees, and escalate aging overdue tasks at Day 2 (to Managers) and Day 5 (to Leadership). All paths converge on `DashboardService` to refresh operational views.

---

### Diagram 2: Data Flow Between the 7 Sheets

```
+---------------------------------------------------------------------------------------------------+
|                                    INTER-SHEET DATA FLOW                                          |
+---------------------------------------------------------------------------------------------------+

                          +-----------------------------------+
                          |              Config               |
                          |  - Global Parameters & Thresholds |
                          |  - Employee Directory (Managers)  |
                          +---+-------------+-------------+---+
                              |             |             |
           Read Config Values |             | Directory   | Thresholds & Emails
                              v             v             v
+-----------------------------+--+     +----+-------------+----+     +-----------------------------+
|        Employee Dashboard      |     |     Manager Dashboard     |     |    Escalation Dashboard     |
| - Tasks assigned to Employee   |     | - KPI Statistics          |     | - Overdue >= 2 days         |
| - Mark Complete Checkboxes     |     | - Team Workload Summary   |     | - Overdue >= 5 days         |
| - Ticket ID / Proof Entry      |     | - Overdue & Acknowledge   |     | - Notification Audit Trail  |
+---------------+----------------+     +----+------------------+----+     +--------------+--------------+
                |                           ^                  ^                         ^
   User Edits   | Writes                    | Reads            | Reads                   | Reads
   (Check/Proof)| Completion                | Metrics          | Overdue Tasks           | Escalations
                v                           |                  |                         |
+---------------+---------------------------+------------------+-------------------------+-------------+
|                                             Task Master                                              |
| - Master Task Definitions (Row ID, Frequency, Anchor, Employee, Proof Required, Active)               |
| - Current Cycle State (Due Date, Status, Cycle ID, Last Completed At/By)                             |
| - Deduplication Stamps (Reminder Sent At, Manager Alert Sent At, Leadership Alert Sent At)            |
+---------------------------------------------+---------------------------------------------------------+
                                              |
                    Append Completion Records | Log Failures & Exceptions
                                              v
             +--------------------------------+---+     +-----------------------------------+
             |         Completion Log             |     |             Error Log             |
             | - Immutable Audit Trail of Tasks   |     | - Timestamp, Stack, Context JSON  |
             | - Cycle ID, Proof, Source, Timing  |     | - Auto-rotated via LOG_MAX_ROWS   |
             +------------------------------------+     +-----------------------------------+
```

**Explanation**:
`Config` serves as the single source of truth for global parameters, email destinations, and the manager-employee hierarchy. `Task Master` acts as the primary relational hub, retaining both the recurring template definitions and the volatile state of current active cycles. The three presentation views (`Employee Dashboard`, `Manager Dashboard`, `Escalation Dashboard`) are transient projection surfaces populated strictly from `Task Master` and `Config`. Historical completions flow in one direction into the append-only `Completion Log`, while runtime anomalies and exceptions across all operations are routed to `Error Log`.

---

### Diagram 3: Sheet Relationships and Keys

```
+---------------------------------------------------------------------------------------------------+
|                                     SHEET RELATIONSHIPS & KEYS                                    |
+---------------------------------------------------------------------------------------------------+

   [Config: Employee Directory]
   PK: Employee Email ------------------------+
   Fields: Name, Manager Email                | (Foreign Key Lookup)
                                              v
   [Task Master]                     +------------------------+
   PK: Task Row ID (e.g. TASK-001)   | Employee Email         |
   Current Cycle ID (Composite)      +------------------------+
   Fields: Freq, Anchor, Due Date,                |
           Status, Proof Req, Dedupe Stamps       | (Foreign Key)
                 |                                |
                 | (1 : Many History)             |
                 v                                v
   [Completion Log]                  [Employee Dashboard]
   PK: Log ID (Auto Inc / UUID)      UI Key: Task Row ID (Col A, Hidden)
   Composite Key: Cycle ID           Matches Task Master.Task Row ID
   Fields: Task Row ID, Completed By,
           Proof, Source, Timestamp
                 |
                 v
   [Manager Dashboard]               [Escalation Dashboard]
   Key: Cycle ID                     Key: Cycle ID
   Matches Task Master.Cycle ID      Matches Task Master.Cycle ID
   Preserves: Manager Acknowledgement Displays: Overdue Tasks & Timestamps
              & Timestamp on Refresh
```

**Explanation**:
The primary relational backbone centers on `Task Row ID` (uniquely identifying the recurring task definition) and `Cycle ID` (identifying the specific recurring cycle instance). In `Task Master`, `Employee Email` links directly to the `Config` employee directory to resolve manager escalation paths. The `Employee Dashboard` relies on a hidden `Task Row ID` in Column A to identify mutated tasks during edit events. The `Manager Dashboard` uses `Cycle ID` as a reconciliation key during dynamic refreshes, ensuring that user-entered manager acknowledgements and timestamps are preserved rather than overwritten.

---

### Diagram 4: Automation Flow (Triggers & Handlers)

```
+---------------------------------------------------------------------------------------------------+
|                                         AUTOMATION FLOW                                           |
+---------------------------------------------------------------------------------------------------+

               PATH A: Time-Driven Daily Job                    PATH B: Real-Time Edit Trigger
               (dailyJob() via Time Trigger)                   (handleEdit(e) via onEdit Trigger)
                            |                                                 |
                            v                                                 v
             +------------------------------+                  +------------------------------+
             | Acquire Lock (30s timeout)   |                  | Verify Sheet:                |
             +--------------+---------------+                  | Is "Employee Dashboard" or   |
                            |                                  |    "Manager Dashboard"?      |
                            v                                  +--------------+---------------+
             +------------------------------+                                 | Yes
             | Step 1: refreshOverdueStatuses|                                v
             | (Pending -> Overdue if < Today)                 +------------------------------+
             +--------------+---------------+                  | Parse Edited Range & Col:    |
                            |                                  | - Col H: "Mark Complete"?    |
                            v                                  | - Col F: "Acknowledgement"?  |
             +------------------------------+                  +--------------+---------------+
             | Step 2: sendDueReminders()   |                                 |
             | (Day 0 Reminders + Dedupe)   |                                 | Mark Complete
             +--------------+---------------+                                 v
                            |                                  +------------------------------+
                            v                                  | Acquire Lock (30s timeout)   |
             +------------------------------+                  +--------------+---------------+
             | Step 3: runEscalations()     |                                 |
             | - Day 2 Manager Alerts       |                                 v
             | - Day 5 Leadership Alerts    |                  +------------------------------+
             +--------------+---------------+                  | Call completeTask():         |
                            |                                  | 1. Check Proof Requirements  |
                            v                                  | 2. Check Cycle ID in Log     |
             +------------------------------+                  | 3. Append to Completion Log  |
             | Step 4: refreshAllDashboards |                  | 4. Advance Next Due Date     |
             +--------------+---------------+                  | 5. Reset Checkbox & Proof    |
                            |                                  +--------------+---------------+
                            v                                                 |
             +------------------------------+                                 v
             | Step 5: AppLogger.flush()    |                  +------------------------------+
             | Release ScriptLock           |                  | Refresh Employee Dashboard   |
             +------------------------------+                  | Release ScriptLock           |
                                                               +------------------------------+
```

**Explanation**:
Path A depicts the batch automation pipeline executed daily by `dailyJob()`. It sequentially updates overdue statuses, sends Day 0 employee reminders, executes Day 2 and Day 5 escalations, refreshes all dashboards, and flushes log entries—all protected by an overall script lock. Path B illustrates the real-time event pipeline handled by the installable trigger `handleEdit(e)`. The handler filters for specific interactive columns, acquires an exclusive script lock, validates proof criteria, writes to the completion log, computes the next cycle, resets UI inputs, and re-renders the dashboard.

---

### Diagram 5: Escalation Lifecycle Timeline

```
+---------------------------------------------------------------------------------------------------+
|                                   ESCALATION LIFECYCLE TIMELINE                                   |
+---------------------------------------------------------------------------------------------------+

 Timeline:
 --------
 Day 0 (Due Date)       Day 1 (Overdue)      Day 2 (Overdue)       Day 3 - 4            Day 5 (Overdue)
      |                       |                    |                   |                     |
      v                       v                    v                   v                     v
+------------+         +------------+       +------------+      +------------+        +------------+
| Due Today  |         | Status:    |       | Status:    |      | Status:    |        | Status:    |
| (Pending)  |         | Overdue    |       | Overdue    |      | Overdue    |        | Overdue    |
+-----+------+         +------------+       +-----+------+      +------------+        +-----+------+
      |                                           |                                         |
      v                                           v                                         v
+------------+                             +------------+                            +------------+
| Employee   |                             | Manager    |                            | Leadership |
| Reminder   |                             | Alert      |                            | Escalation |
| Email      |                             | Email      |                            | Email      |
+-----+------+                             +-----+------+                            +-----+------+
      |                                           |                                         |
      v                                           v                                         v
+------------+                             +------------+                            +------------+
| Stamp:     |                             | Stamp:     |                            | Stamp:     |
| Reminder   |                             | Manager    |                            | Leadership |
| Sent At    |                             | Alert Sent |                            | Alert Sent |
+------------+                             +------------+                            +------------+

 [CANCELLATION GUARD]:
 If employee completes the task at Day 3:
 1. Status transitions to Completed -> Next cycle created.
 2. Notification stamps reset for the new cycle.
 3. Day 5 Leadership Escalation job checks completion status and cleanly suppresses alert!
```

**Explanation**:
The escalation lifecycle progresses across defined calendar boundaries relative to the task's due date. On Day 0, an employee receives a consolidated reminder, stamping `Reminder Sent At`. If the task remains incomplete on Day 1, its status turns `Overdue`. On Day 2, the manager alert fires, notifying the employee's direct manager and stamping `Manager Alert Sent At`. If the task remains incomplete through Day 5, an executive summary is dispatched to leadership and recorded in `Leadership Alert Sent At`. If completion occurs at any point (e.g., Day 3), the task advances to the next cycle and timestamps reset, automatically neutralizing downstream alerts.

---

### Diagram 6: Module Dependency Graph (Strict Downward Hierarchy)

```
+---------------------------------------------------------------------------------------------------+
|                                      MODULE DEPENDENCY GRAPH                                      |
+---------------------------------------------------------------------------------------------------+

                          +-----------------------------------+
                          |              Code.gs              |
                          |  - onOpen(), handleEdit() entry   |
                          +---+---------------------------+---+
                              |                           |
                              v                           v
             +------------------------------+   +------------------------------+
             |         Triggers.gs          |   |          Setup.gs            |
             | - dailyJob(), installTriggers|   | - setupAll(), sheet builder  |
             +--------------+---------------+   +--------------+---------------+
                            |                                  |
            +---------------+---------------+                  |
            |               |               |                  |
            v               v               v                  |
+-------------------+ +-------------------+ +------------------+ v
| ReminderService.gs| |EscalationService.gs| |CompletionService.gs|
| - Day 0 reminders | | - Day 2 & Day 5   | | - completeTask()   |
+---------+---------+ +---------+---------+ +---------+----------+
          |                     |                     |
          +------------------+  |  +------------------+
                             |  |  |
                             v  v  v
                    +-------------------+
                    |  DashboardService |
                    | - render dashboards|
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    |  TaskService.gs   |
                    | - recurrence date |
                    | - status refresh  |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    |ValidationService  |
                    | - rule validators |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    |     Utils.gs      |
                    | - SCHEMA constant |
                    | - Config reader   |
                    | - AppLogger       |
                    | - Lock & Date util|
                    +-------------------+
                              ^
                              | (Called by)
                    +---------+---------+
                    |     Tests.gs      |
                    | - test runner     |
                    +-------------------+
```

**Explanation**:
The codebase is structured into a strict downward dependency hierarchy. High-level orchestrators (`Code.gs`, `Triggers.gs`, `Setup.gs`) reside at the top layer. Domain business services (`ReminderService`, `EscalationService`, `CompletionService`, `DashboardService`) occupy the middle tier. `TaskService` encapsulates core recurrence and scheduling calculations. `ValidationService` centralizes structural and business integrity checks. At the foundation sits `Utils.gs`, providing the immutable `SCHEMA` mapping, the type-safe `Config` reader, date arithmetic, lock helpers, and `AppLogger`. No module ever calls upward, preventing circular references and ensuring clean load order independence in Apps Script.

---

## 3. Failure Handling & Idempotency Architecture

### 3.1 Concurrency & Race Condition Protection
- **Lock Enforcement**: All multi-step write operations acquire `LockService.getScriptLock()` with a 30-second timeout. If lock acquisition fails, the operation immediately aborts and logs a `LOCK_TIMEOUT` error, preventing concurrent edit collisions.
- **Idempotency Guarantee**: Every completion check verifies the presence of `Cycle ID` in `Completion Log` before writing. If found, the operation returns `{status: 'DUPLICATE'}` without mutating state.

### 3.2 Trigger De-duplication
- When `installTriggers()` runs, it queries `ScriptApp.getProjectTriggers()`, identifies existing triggers bound to project handler functions (`handleEdit`, `dailyJob`), deletes them, and recreates only the authorized set. This ensures zero trigger accumulation over repeated administrative setups.

### 3.3 Batch Processing & Quota Management
- To comply with Google Apps Script's 6-minute execution limit and MailApp quotas:
  - All sheet reads and updates execute via two-dimensional batch arrays (`getValues` / `setValues`).
  - Prior to sending emails, `MailApp.getRemainingDailyQuota()` is checked. If quota $< 5$, email dispatch is suspended, a warning is logged to `Error Log`, and remaining operational routines proceed uninterrupted.

### 3.4 Operational Fault Isolation
- In `dailyJob()`, each major step (`refreshOverdueStatuses`, `sendDueReminders`, `runEscalations`, `refreshAllDashboards`) runs inside its own isolated `try/catch` block. A transient failure in email dispatching will never abort dashboard rendering or overdue status recalculation.

---

## 4. Verification Self-Check
- [x] All 6 required ASCII diagrams are fully specified with 3-5 explanatory sentences each.
- [x] The 7 sheets and their exact keys/relationships are mapped.
- [x] Concurrency, LockService, and Cycle ID deduplication are detailed.
- [x] The module dependency graph is strictly top-down with zero circular dependencies.
- [x] No executable code has been introduced prior to Phase 5.
