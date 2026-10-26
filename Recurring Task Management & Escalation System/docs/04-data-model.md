# Data Model Specification: Data Contracts, State Machine & Schemas

## 1. Overview
This document specifies the software data contracts, the dynamic schema resolver, JSDoc object shapes, the finite state machine, idempotency algorithms, and configuration contracts for the Recurring Task Management and Escalation System.

---

## 2. Dynamic Schema Map (`Utils.SCHEMA`)

To ensure resilience against manual column reordering in Google Sheets, scripts must **never** reference column numbers directly. All sheet indices are dynamically resolved at runtime by mapping logical keys to exact header strings:

```javascript
/**
 * Global schema registry mapping logical keys to actual sheet header strings.
 */
var SCHEMA = {
  TASK_MASTER: {
    SHEET_NAME: "Task Master",
    FIELDS: {
      TASK_ROW_ID: "Task Row ID",
      TASK_NAME: "Task Name",
      DESCRIPTION: "Description",
      EMPLOYEE_EMAIL: "Employee Email",
      EMPLOYEE_NAME: "Employee Name",
      FREQUENCY: "Frequency",
      ANCHOR_DATE: "Anchor Date",
      CURRENT_DUE_DATE: "Current Due Date",
      STATUS: "Status",
      PROOF_REQUIRED: "Proof Required",
      LAST_COMPLETED_AT: "Last Completed At",
      LAST_COMPLETED_BY: "Last Completed By",
      CYCLE_ID: "Cycle ID",
      REMINDER_SENT_AT: "Reminder Sent At",
      MANAGER_ALERT_SENT_AT: "Manager Alert Sent At",
      LEADERSHIP_ALERT_SENT_AT: "Leadership Alert Sent At",
      ACTIVE: "Active"
    }
  },
  EMPLOYEE_DASHBOARD: {
    SHEET_NAME: "Employee Dashboard",
    FIELDS: {
      TASK_ROW_ID: "Task Row ID",
      EMPLOYEE_NAME: "Employee Name",
      TASK_NAME: "Task Name",
      FREQUENCY: "Frequency",
      DUE_DATE: "Due Date",
      STATUS: "Status",
      TICKET_ID: "Ticket ID / Proof",
      MARK_COMPLETE: "Mark Complete",
      LAST_COMPLETED_AT: "Last Completed At",
      PROOF_REQUIRED: "Proof Required?"
    }
  },
  COMPLETION_LOG: {
    SHEET_NAME: "Completion Log",
    FIELDS: {
      LOG_ID: "Log ID",
      CYCLE_ID: "Cycle ID",
      TASK_ROW_ID: "Task Row ID",
      TASK_NAME: "Task Name",
      EMPLOYEE_EMAIL: "Employee Email",
      COMPLETED_BY: "Completed By",
      COMPLETED_AT: "Completed At",
      SCHEDULED_DUE_DATE: "Scheduled Due Date",
      DAYS_LATE: "Days Late",
      PROOF_TICKET_ID: "Proof / Ticket ID",
      SOURCE: "Source"
    }
  },
  MANAGER_DASHBOARD: {
    SHEET_NAME: "Manager Dashboard",
    FIELDS: {
      CYCLE_ID: "Cycle ID",
      TASK_NAME: "Task Name",
      ASSIGNED_EMPLOYEE: "Assigned Employee",
      DUE_DATE: "Due Date",
      DAYS_OVERDUE: "Days Overdue",
      ACKNOWLEDGEMENT: "Acknowledgement",
      ACKNOWLEDGEMENT_TIMESTAMP: "Acknowledgement Timestamp",
      ESCALATION_TIER: "Escalation Tier"
    }
  },
  ESCALATION_DASHBOARD: {
    SHEET_NAME: "Escalation Dashboard",
    FIELDS: {
      SEVERITY_TIER: "Severity Tier",
      TASK_NAME: "Task Name",
      EMPLOYEE_NAME: "Employee Name",
      MANAGER_EMAIL: "Manager Email",
      DUE_DATE: "Due Date",
      DAYS_OVERDUE: "Days Overdue",
      REMINDER_SENT_AT: "Reminder Sent At",
      MANAGER_ALERT_SENT_AT: "Manager Alert Sent At",
      LEADERSHIP_ALERT_SENT_AT: "Leadership Alert Sent At"
    }
  },
  ERROR_LOG: {
    SHEET_NAME: "Error Log",
    FIELDS: {
      TIMESTAMP: "Timestamp",
      LEVEL: "Level",
      FUNCTION: "Function",
      MESSAGE: "Message",
      STACK: "Stack",
      CONTEXT: "Context (JSON)",
      USER: "User",
      RESOLVED: "Resolved"
    }
  }
};
```

---

## 3. JSDoc Type Definitions

```javascript
/**
 * @typedef {Object} TaskRecord
 * @property {string} taskRowId Unique alphanumeric task identifier (e.g. "TASK-001")
 * @property {string} taskName Display name of the recurring task
 * @property {string} description Operating instructions or checklist details
 * @property {string} employeeEmail Assigned employee's email address
 * @property {string} employeeName Assigned employee's display name
 * @property {('Daily'|'Every 7 days'|'Every 15 days'|'Monthly')} frequency Recurrence pattern
 * @property {string} anchorDate Baseline anchor date formatted as yyyy-MM-dd
 * @property {string} currentDueDate Scheduled due date for active cycle as yyyy-MM-dd
 * @property {('Pending'|'Overdue'|'Completed'|'Paused')} status Current lifecycle state
 * @property {('Y'|'N')} proofRequired Whether a valid Ticket ID / proof is mandatory
 * @property {string} [lastCompletedAt] ISO/formatted timestamp of last completion
 * @property {string} [lastCompletedBy] User who marked the prior cycle complete
 * @property {string} cycleId Current cycle composite idempotency key
 * @property {string} [reminderSentAt] Timestamp when Day 0 reminder was dispatched
 * @property {string} [managerAlertSentAt] Timestamp when Day 2 manager alert was sent
 * @property {string} [leadershipAlertSentAt] Timestamp when Day 5 escalation was sent
 * @property {('Y'|'N')} active Whether task is actively evaluated by automation
 * @property {number} [rowIndex] 1-based row index in Task Master sheet
 */

/**
 * @typedef {Object} CompletionRecord
 * @property {string} logId Unique auto-generated log ID (e.g. "LOG-00001")
 * @property {string} cycleId Idempotency key (TaskRowID|Due_Date)
 * @property {string} taskRowId Foreign key to Task Master
 * @property {string} taskName Name of completed task
 * @property {string} employeeEmail Assigned employee email
 * @property {string} completedBy User email who triggered the completion
 * @property {string} completedAt Timestamp formatted in configured timezone
 * @property {string} scheduledDueDate Target due date for the completed cycle
 * @property {number} daysLate Elapsed days between due date and completion date
 * @property {string} proofTicketId Submitted proof link, ticket ID, or auto-signature
 * @property {('Dashboard'|'Manual'|'Missed')} source Submission mechanism
 */

/**
 * @typedef {Object} ConfigMap
 * @property {number} REMINDER_DAY Offset days relative to due date for employee reminder (default 0)
 * @property {number} MANAGER_ALERT_DAY Overdue days threshold for manager alert (default 2)
 * @property {number} LEADERSHIP_ALERT_DAY Overdue days threshold for leadership escalation (default 5)
 * @property {('SCHEDULED'|'COMPLETION')} RECURRENCE_BASIS Algorithm for advancing cycle
 * @property {string} TIMEZONE Standard timezone string (e.g. "Asia/Kolkata")
 * @property {string} [DEMO_DATE_OVERRIDE] Evaluator simulated date as yyyy-MM-dd
 * @property {string} LEADERSHIP_EMAIL Email address for executive escalations
 * @property {string} DEFAULT_MANAGER_EMAIL Fallback manager email
 * @property {string[]} ADMIN_EMAILS Array of authorized administrator emails
 * @property {boolean} SEND_EMAILS If true, dispatches MailApp; if false, logs only
 * @property {string} TICKET_ID_PATTERN Regex string for proof validation
 * @property {number} LOG_MAX_ROWS Max row capacity for Error Log
 */

/**
 * @typedef {Object} EmployeeDirectoryEntry
 * @property {string} employeeEmail
 * @property {string} employeeName
 * @property {string} managerEmail
 */

/**
 * @typedef {Object} DashboardRow
 * @property {string} taskRowId
 * @property {string} employeeName
 * @property {string} taskName
 * @property {string} frequency
 * @property {string} dueDate
 * @property {string} status
 * @property {string} ticketId
 * @property {boolean} markComplete
 * @property {string} lastCompletedAt
 * @property {string} proofRequired
 */
```

---

## 4. Status Finite State Machine (FSM)

The lifecycle of each task cycle transitions deterministically according to the following state transition matrix:

| State From | State To | Trigger / Event | Guard Condition | State Action / Side Effects |
|---|---|---|---|---|
| *(Init)* | `Pending` | Task Creation | `Active == 'Y'` | Compute initial `Current Due Date` and `Cycle ID`. |
| `Pending` | `Overdue` | `dailyJob()` execution | `Current Due Date < today` | Update status to `Overdue`. Flag on dashboards. |
| `Pending` | `Completed` | `completeTask()` via Checkbox | Proof valid if required; not duplicate | Append `Completion Log`. Advance `Current Due Date` to next cycle. Reset notification stamps. Status resets to `Pending` for new cycle. |
| `Overdue` | `Completed` | `completeTask()` via Checkbox | Proof valid if required; not duplicate | Append `Completion Log` with `Days Late`. Compute next cycle. Suppress pending escalations. Status resets to `Pending` for new cycle. |
| Any | `Paused` | Admin sets `Status = 'Paused'` or `Active = 'N'` | Manual edit in `Task Master` | Task excluded from reminders, overdue checks, and escalations. |
| `Paused` | `Pending` | Admin sets `Status = 'Pending'` and `Active = 'Y'` | Manual edit in `Task Master` | Recalculate `Current Due Date` if in past, re-enable processing. |

---

## 5. Cycle ID & Concurrency / Duplicate Prevention Algorithm

### 5.1 Cycle ID Specification
$$\text{Cycle ID} = \text{taskRowId} + \text{"|"} + \text{dueDateFormatted}$$
Example: `TASK-001|2026-10-26`.

### 5.2 Step-by-Step Duplicate Prevention Algorithm
When an employee clicks the `Mark Complete` checkbox on the `Employee Dashboard`:

1. **Lock Acquisition**:
   - Call `LockService.getScriptLock()`. Attempt acquisition with a 30,000 ms timeout.
   - If timeout occurs: Abort, revert checkbox to `FALSE`, and log `LOCK_TIMEOUT` in `Error Log`.
2. **Identity Resolution**:
   - Retrieve `activeEmail = Session.getActiveUser().getEmail()`.
   - If empty (consumer Gmail), retrieve `effectiveEmail = Session.getEffectiveUser().getEmail()`.
   - Verify caller is either the assigned employee or in `Config.ADMIN_EMAILS`. If unauthorized, revert checkbox and log `UNAUTHORIZED_COMPLETION`.
3. **Proof Verification**:
   - Inspect `Task Master` for `Proof Required`.
   - If `Proof Required == 'Y'`: Verify `Ticket ID / Proof` cell matches `Config.TICKET_ID_PATTERN`. If empty or invalid, revert checkbox, alert user via toast or error, and exit.
4. **Idempotency Check**:
   - Query `Completion Log` column B (`Cycle ID`).
   - If `Cycle ID` already exists in `Completion Log`:
     - Revert checkbox to `FALSE`.
     - Return `{status: 'DUPLICATE', message: 'Cycle already completed'}`.
5. **State Mutation (Atomic Batch)**:
   - Append immutable row to `Completion Log`.
   - Calculate `nextDueDate` using `TaskService.calculateNextDueDate()`.
   - Update `Task Master` row:
     - `Current Due Date = nextDueDate`
     - `Cycle ID = taskRowId + '|' + nextDueDate`
     - `Status = 'Pending'`
     - `Last Completed At = now`
     - `Last Completed By = activeEmail`
     - `Reminder Sent At = ''`
     - `Manager Alert Sent At = ''`
     - `Leadership Alert Sent At = ''`
6. **UI Refresh & Lock Release**:
   - Reset checkbox in `Employee Dashboard` to `FALSE` and clear proof input.
   - Re-render affected dashboard views.
   - Call `lock.releaseLock()`.

---

## 6. Config Reader Contract

The configuration module exposes typed, validated accessors with safe fallback defaults:

```javascript
/**
 * Config reader contract specification.
 */
var ConfigService = {
  /**
   * Reads all config pairs from the 'Config' sheet into an in-memory dictionary.
   * @return {ConfigMap}
   */
  getConfig: function() {},

  /**
   * Resolves the manager email for an assigned employee email.
   * @param {string} employeeEmail
   * @param {ConfigMap} config
   * @return {string} Manager email or DEFAULT_MANAGER_EMAIL
   */
  getManagerEmail: function(employeeEmail, config) {},

  /**
   * Retrieves the current normalized date string ('yyyy-MM-dd').
   * If Config.DEMO_DATE_OVERRIDE is non-empty and valid, returns that override.
   * @param {ConfigMap} [config]
   * @return {string} Normalized date in yyyy-MM-dd
   */
  getEffectiveToday: function(config) {}
};
```

### Fallback Defaults:
- `REMINDER_DAY`: `0`
- `MANAGER_ALERT_DAY`: `2`
- `LEADERSHIP_ALERT_DAY`: `5`
- `RECURRENCE_BASIS`: `'SCHEDULED'`
- `TIMEZONE`: `'Asia/Kolkata'`
- `SEND_EMAILS`: `false`
- `LOG_MAX_ROWS`: `1000`

---

## 7. Date & Timezone Normalization Policy

- **Calendar Normalization**: All due dates, anchor dates, and simulated dates are stored and compared strictly as date-only ISO strings (`yyyy-MM-dd`).
- **Timezone Safety**: Dates are formatted using `Utilities.formatDate(date, config.TIMEZONE, "yyyy-MM-dd")`.
- **Date Comparison**: Comparing two dates is done by comparing their `yyyy-MM-dd` strings or by constructing date instances at midnight UTC:
  $$\text{daysOverdue} = \left\lfloor \frac{\text{Date}(\text{today}) - \text{Date}(\text{dueDate})}{86400000} \right\rfloor$$
- **Simulation Injection**: All automation services obtain "today" through `Utils.getToday()`. When `DEMO_DATE_OVERRIDE` is populated in `Config`, `Utils.getToday()` seamlessly substitutes the simulated date across all overdue checks, reminder dispatchers, and escalation algorithms.

---

## 8. Verification Self-Check
- [x] Every column from Phase 3 is represented in `Utils.SCHEMA`.
- [x] JSDoc typedefs cover `TaskRecord`, `CompletionRecord`, `ConfigMap`, and `DashboardRow`.
- [x] Finite state machine table includes triggers, guards, and transition side-effects.
- [x] Concurrency locking and 6-step idempotency check algorithm are fully defined.
- [x] No executable code files written in this design phase.
