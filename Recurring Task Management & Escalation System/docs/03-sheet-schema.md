# Google Sheet Schema Specification: 7 Workbook Sheets

## 1. Overview
This document defines the schema, validations, protection settings, named ranges, and sample datasets for all seven sheets comprising the Recurring Task Management and Escalation System.

---

## 2. Sheet Definitions

### Sheet 1: `Task Master`
- **Purpose**: Master table defining all recurring task assignments and maintaining the mutable state of each task's active recurring cycle.
- **Protection Rules**: Restricted to Administrators. Automated scripts read and update this sheet. Employees and Managers have no direct edit permissions.
- **Header Row**: Row 1 (Frozen).
- **Columns Specification**:

| Col # | Header Text | Data Type | Validation Rule | Required? | Example Value | Description |
|---|---|---|---|---|---|---|
| A | `Task Row ID` | String | Regex: `^TASK-[0-9]{3,}$` | Yes | `TASK-001` | Unique primary key for the recurring task |
| B | `Task Name` | String | Text length 3-100 | Yes | `Daily Operations Standup Update` | Human-readable name of the task |
| C | `Description` | String | Text | No | `Post daily status report on project board` | Detailed operational instructions |
| D | `Employee Email` | String | Valid Email format | Yes | `employee1@example.com` | Email of assigned employee |
| E | `Employee Name` | String | Text | Yes | `Aarav Sharma` | Full name of assigned employee |
| F | `Frequency` | String | List: `Daily, Every 7 days, Every 15 days, Monthly` | Yes | `Daily` | Cadence interval |
| G | `Anchor Date` | Date (yyyy-MM-dd) | Date format | Yes | `2026-10-01` | Baseline anchor for calendar month/interval logic |
| H | `Current Due Date` | Date (yyyy-MM-dd) | Date format | Yes | `2026-10-26` | Current cycle due date |
| I | `Status` | String | List: `Pending, Overdue, Completed, Paused` | Yes | `Pending` | Active cycle status |
| J | `Proof Required` | String | List: `Y, N` | Yes | `N` | Whether Ticket ID/Proof is mandatory |
| K | `Last Completed At` | Timestamp | Date/Time or Empty | No | `2026-10-25 17:30:00` | Timestamp of last recorded completion |
| L | `Last Completed By` | String | Email or Empty | No | `employee1@example.com` | User who completed the last cycle |
| M | `Cycle ID` | String | Text | Yes | `TASK-001\|2026-10-26` | Composite idempotency key (`TaskRowID\|DueDate`) |
| N | `Reminder Sent At` | Timestamp | Date/Time or Empty | No | `2026-10-26 08:00:00` | Deduplication stamp for Day 0 reminder |
| O | `Manager Alert Sent At` | Timestamp | Date/Time or Empty | No | `2026-10-28 08:00:00` | Deduplication stamp for Day 2 manager alert |
| P | `Leadership Alert Sent At` | Timestamp | Date/Time or Empty | No | `2026-10-31 08:00:00` | Deduplication stamp for Day 5 leadership alert |
| Q | `Active` | String | List: `Y, N` | Yes | `Y` | Flag to enable/disable automated processing |

#### `Task Master` Sample Data (6 Comprehensive Rows)

```
Row 2:
  Task Row ID: TASK-001
  Task Name: Daily Operations Standup Update
  Description: WhatsApp-style daily checkin; submit standup notes
  Employee Email: employee1@example.com
  Employee Name: Aarav Sharma
  Frequency: Daily
  Anchor Date: 2026-10-01
  Current Due Date: 2026-10-26
  Status: Pending
  Proof Required: N
  Last Completed At: 2026-10-25 18:15:00
  Last Completed By: employee1@example.com
  Cycle ID: TASK-001|2026-10-26
  Reminder Sent At: 
  Manager Alert Sent At: 
  Leadership Alert Sent At: 
  Active: Y

Row 3:
  Task Row ID: TASK-002
  Task Name: Portal Task A: Weekly Security Log Audit
  Description: Review IAM logs, attach audit ticket ID
  Employee Email: employee2@example.com
  Employee Name: Priya Patel
  Frequency: Every 7 days
  Anchor Date: 2026-10-05
  Current Due Date: 2026-10-24
  Status: Overdue
  Proof Required: Y
  Last Completed At: 2026-10-17 11:20:00
  Last Completed By: employee2@example.com
  Cycle ID: TASK-002|2026-10-24
  Reminder Sent At: 2026-10-24 08:00:00
  Manager Alert Sent At: 2026-10-26 08:00:00
  Leadership Alert Sent At: 
  Active: Y
  (Note: Due 2026-10-24 -> Exactly 2 days overdue on 2026-10-26; Manager Alert dispatched)

Row 4:
  Task Row ID: TASK-003
  Task Name: Portal Task B: Bi-Weekly Server Patching
  Description: Patch test environments and attach change approval URL
  Employee Email: employee3@example.com
  Employee Name: Rohan Mehta
  Frequency: Every 15 days
  Anchor Date: 2026-10-01
  Current Due Date: 2026-10-21
  Status: Overdue
  Proof Required: Y
  Last Completed At: 2026-10-06 14:10:00
  Last Completed By: employee3@example.com
  Cycle ID: TASK-003|2026-10-21
  Reminder Sent At: 2026-10-21 08:00:00
  Manager Alert Sent At: 2026-10-23 08:00:00
  Leadership Alert Sent At: 2026-10-26 08:00:00
  Active: Y
  (Note: Due 2026-10-21 -> Exactly 5 days overdue on 2026-10-26; Leadership Escalation dispatched)

Row 5:
  Task Row ID: TASK-004
  Task Name: Monthly Financial Reconciliation
  Description: Close monthly vendor invoices; anchored on month end
  Employee Email: employee1@example.com
  Employee Name: Aarav Sharma
  Frequency: Monthly
  Anchor Date: 2026-08-31
  Current Due Date: 2026-10-31
  Status: Pending
  Proof Required: Y
  Last Completed At: 2026-09-30 16:45:00
  Last Completed By: employee1@example.com
  Cycle ID: TASK-004|2026-10-31
  Reminder Sent At: 
  Manager Alert Sent At: 
  Leadership Alert Sent At: 
  Active: Y
  (Note: Preserves anchor 31; advanced Aug 31 -> Sep 30 -> Oct 31)

Row 6:
  Task Row ID: TASK-005
  Task Name: Portal Task C: Database Index Maintenance
  Description: Run re-index script on analytics database
  Employee Email: employee2@example.com
  Employee Name: Priya Patel
  Frequency: Every 7 days
  Anchor Date: 2026-10-12
  Current Due Date: 2026-10-26
  Status: Completed
  Proof Required: Y
  Last Completed At: 2026-10-26 08:15:00
  Last Completed By: employee2@example.com
  Cycle ID: TASK-005|2026-10-26
  Reminder Sent At: 2026-10-26 08:00:00
  Manager Alert Sent At: 
  Leadership Alert Sent At: 
  Active: Y
  (Note: Completed with proof; ready to transition to next cycle 2026-11-02)

Row 7:
  Task Row ID: TASK-006
  Task Name: Quarterly Disaster Recovery Drill
  Description: Suspended pending infrastructure migration
  Employee Email: employee3@example.com
  Employee Name: Rohan Mehta
  Frequency: Monthly
  Anchor Date: 2026-07-15
  Current Due Date: 2026-10-15
  Status: Paused
  Proof Required: N
  Last Completed At: 2026-07-15 10:00:00
  Last Completed By: employee3@example.com
  Cycle ID: TASK-006|2026-10-15
  Reminder Sent At: 
  Manager Alert Sent At: 
  Leadership Alert Sent At: 
  Active: N
```

---

### Sheet 2: `Employee Dashboard`
- **Purpose**: Dedicated single-location interaction surface for employees.
- **Protection Rules**: Columns A through F, I, and J are protected (View-only for employees). Only Column G (`Ticket ID / Proof`) and Column H (`Mark Complete`) are editable by employees.
- **Header Row**: Row 1 (Frozen).
- **Columns Specification**:

| Col # | Header Text | Data Type | Validation Rule | Required? | Example Value | Description |
|---|---|---|---|---|---|---|
| A | `Task Row ID` | String | Protected / Hidden | System | `TASK-001` | Hidden reference key to Task Master |
| B | `Employee Name` | String | Read-only | System | `Aarav Sharma` | Assigned employee name |
| C | `Task Name` | String | Read-only | System | `Daily Operations Standup Update` | Task title |
| D | `Frequency` | String | Read-only | System | `Daily` | Recurrence interval |
| E | `Due Date` | Date | Read-only | System | `2026-10-26` | Current cycle due date |
| F | `Status` | String | Read-only | System | `Pending` | Status flag with conditional color |
| G | `Ticket ID / Proof` | String | Free text / URL | If Proof Req = Y | `https://jira.corp/TICK-492` | Proof link or reference |
| H | `Mark Complete` | Boolean | Checkbox (`TRUE`/`FALSE`) | Editable | `FALSE` | Checkbox toggled to trigger completion |
| I | `Last Completed At` | Timestamp | Read-only | System | `2026-10-25 18:15:00` | Historical context |
| J | `Proof Required?` | String | Read-only | System | `N` | Visual indicator for employee |

---

### Sheet 3: `Completion Log`
- **Purpose**: Append-only immutable historical audit trail of all task completions.
- **Protection Rules**: Fully protected. Only Apps Script execution context appends records. No user editing allowed.
- **Header Row**: Row 1 (Frozen).
- **Columns Specification**:

| Col # | Header Text | Data Type | Validation Rule | Required? | Example Value | Description |
|---|---|---|---|---|---|---|
| A | `Log ID` | String | `LOG-[0-9]{5,}` | Yes | `LOG-00010` | Auto-incrementing log record ID |
| B | `Cycle ID` | String | Text | Yes | `TASK-001\|2026-10-25` | Idempotency cycle key |
| C | `Task Row ID` | String | Text | Yes | `TASK-001` | Foreign key to Task Master |
| D | `Task Name` | String | Text | Yes | `Daily Operations Standup Update` | Snapshot of task name |
| E | `Employee Email` | String | Email | Yes | `employee1@example.com` | Assigned employee email |
| F | `Completed By` | String | Email | Yes | `employee1@example.com` | User who clicked complete |
| G | `Completed At` | Timestamp | Date/Time | Yes | `2026-10-25 18:15:22` | Exact system completion timestamp |
| H | `Scheduled Due Date`| Date | Date format | Yes | `2026-10-25` | Target due date for that cycle |
| I | `Days Late` | Integer | Integer $\ge 0$ | Yes | `0` | Number of overdue days at completion |
| J | `Proof / Ticket ID` | String | Text / URL | Conditional | `AUTO:employee1@example.com\|2026-10-25` | Captured proof or auto-signature |
| K | `Source` | String | List: `Dashboard, Manual, Missed` | Yes | `Dashboard` | Submission mechanism |

#### `Completion Log` Sample Data

```
Row 2:
  Log ID: LOG-00001
  Cycle ID: TASK-001|2026-10-25
  Task Row ID: TASK-001
  Task Name: Daily Operations Standup Update
  Employee Email: employee1@example.com
  Completed By: employee1@example.com
  Completed At: 2026-10-25 18:15:22
  Scheduled Due Date: 2026-10-25
  Days Late: 0
  Proof / Ticket ID: AUTO:employee1@example.com|2026-10-25
  Source: Dashboard

Row 3:
  Log ID: LOG-00002
  Cycle ID: TASK-002|2026-10-17
  Task Row ID: TASK-002
  Task Name: Portal Task A: Weekly Security Log Audit
  Employee Email: employee2@example.com
  Completed By: employee2@example.com
  Completed At: 2026-10-17 11:20:05
  Scheduled Due Date: 2026-10-17
  Days Late: 0
  Proof / Ticket ID: SEC-88910
  Source: Dashboard

Row 4:
  Log ID: LOG-00003
  Cycle ID: TASK-004|2026-09-30
  Task Row ID: TASK-004
  Task Name: Monthly Financial Reconciliation
  Employee Email: employee1@example.com
  Completed By: employee1@example.com
  Completed At: 2026-09-30 16:45:10
  Scheduled Due Date: 2026-09-30
  Days Late: 0
  Proof / Ticket ID: https://drive.corp/rec-sep-2026.pdf
  Source: Dashboard
```

---

### Sheet 4: `Manager Dashboard`
- **Purpose**: Operational management console presenting aggregate team KPIs, an employee workload breakdown, and an overdue task list with interactive manager acknowledgement tracking.
- **Protection Rules**: KPI and Employee summary blocks are protected. In the Overdue Tasks block, Column F (`Acknowledgement`) is editable by Managers; all other columns are script-maintained.
- **Layout Structure**:
  - Rows 1-4: KPI Summary Cards.
  - Rows 6-12: Team Employee Summary Table.
  - Rows 14+: Active Overdue Tasks with Acknowledgement controls.

#### Layout Details:

**KPI Summary Cards (Rows 1-4)**:
- `Total Pending Tasks`: Formula `=COUNTIF('Task Master'!I2:I, "Pending")`
- `Total Overdue Tasks`: Formula `=COUNTIF('Task Master'!I2:I, "Overdue")`
- `Completed This Month`: Formula `=COUNTIF('Completion Log'!G2:G, ">=" & TEXT(EOMONTH(TODAY(),-1)+1,"yyyy-MM-dd"))`

**Team Employee Summary (Rows 6-12)**:

| Col | Header Text | Description |
|---|---|---|
| A | `Employee Name` | Full employee name |
| B | `Employee Email` | Employee email |
| C | `Pending Tasks` | Count of pending tasks |
| D | `Overdue Tasks` | Count of overdue tasks |
| E | `Oldest Overdue (Days)`| Maximum days overdue for that employee |

**Overdue Task Action Table (Rows 14+)**:

| Col # | Header Text | Data Type | Validation Rule | Description |
|---|---|---|---|---|
| A | `Cycle ID` | String | Read-only (Hidden key) | Match key for acknowledgement persistence |
| B | `Task Name` | String | Read-only | Name of overdue task |
| C | `Assigned Employee` | String | Read-only | Employee name |
| D | `Due Date` | Date | Read-only | Scheduled due date |
| E | `Days Overdue` | Integer | Read-only | Calculated overdue elapsed days |
| F | `Acknowledgement` | String | List: `Acknowledged, Not Acknowledged` | Manager interactive dropdown |
| G | `Acknowledgement Timestamp` | Timestamp | Read-only | Auto-stamped by script upon acknowledgement |
| H | `Escalation Tier` | String | Read-only | `Day 2 Manager` or `Day 5 Leadership` |

---

### Sheet 5: `Escalation Dashboard`
- **Purpose**: Executive escalation view listing critical tasks breaching Day 2 and Day 5 thresholds.
- **Protection Rules**: Read-only for all viewers. Populated and refreshed via `DashboardService`.
- **Header Row**: Row 1 (Frozen).
- **Columns Specification**:

| Col # | Header Text | Data Type | Example Value | Description |
|---|---|---|---|---|
| A | `Severity Tier` | String | `CRITICAL (Day 5+)` | Severity indicator (`WARNING (Day 2+)` or `CRITICAL (Day 5+)`) |
| B | `Task Name` | String | `Portal Task B: Bi-Weekly Server Patching` | Overdue task title |
| C | `Employee Name` | String | `Rohan Mehta` | Assigned employee |
| D | `Manager Email` | String | `manager1@example.com` | Responsible direct manager |
| E | `Due Date` | Date | `2026-10-21` | Original scheduled due date |
| F | `Days Overdue` | Integer | `5` | Elapsed days late |
| G | `Reminder Sent At` | Timestamp | `2026-10-21 08:00:00` | Audit timestamp of Day 0 reminder |
| H | `Manager Alert Sent At`| Timestamp | `2026-10-23 08:00:00` | Audit timestamp of Day 2 alert |
| I | `Leadership Alert Sent At`| Timestamp| `2026-10-26 08:00:00` | Audit timestamp of Day 5 escalation |

---

### Sheet 6: `Config`
- **Purpose**: System parameters, notification thresholds, email addresses, and employee directory.
- **Protection Rules**: Restricted to Administrators.
- **Layout**: Two distinct blocks:
  - **Block 1 (Columns A-B)**: System Configuration Key-Value Store.
  - **Block 2 (Columns D-F)**: Employee Directory Table.

#### System Configuration Keys (Columns A & B):

| Key (Column A) | Value (Column B) | Description |
|---|---|---|
| `REMINDER_DAY` | `0` | Offset days before/on due date for reminder (0 = day of due date) |
| `MANAGER_ALERT_DAY` | `2` | Overdue threshold (days) triggering manager alert |
| `LEADERSHIP_ALERT_DAY`| `5` | Overdue threshold (days) triggering leadership escalation |
| `RECURRENCE_BASIS` | `SCHEDULED` | Recurrence algorithm: `SCHEDULED` (prevents drift) or `COMPLETION` |
| `TIMEZONE` | `Asia/Kolkata` | Standard execution timezone |
| `DEMO_DATE_OVERRIDE` | *(Empty)* | Reviewer simulated date override (`yyyy-MM-dd`) |
| `LEADERSHIP_EMAIL` | `leadership@example.com` | Email address for Day 5 executive escalations |
| `DEFAULT_MANAGER_EMAIL`| `default.manager@example.com` | Fallback manager email if employee directory lookup fails |
| `ADMIN_EMAILS` | `admin@example.com,lead@example.com` | Comma-separated list of administrative users |
| `SEND_EMAILS` | `FALSE` | Safety switch: `TRUE` dispatches live email; `FALSE` logs to AppLogger |
| `TICKET_ID_PATTERN` | `^.+$` | Configurable regex validation for proof / ticket IDs |
| `LOG_MAX_ROWS` | `1000` | Maximum rows retained in `Error Log` before automatic rotation |

#### Employee Directory Table (Columns D, E, F):

| Col D: `Employee Email` | Col E: `Employee Name` | Col F: `Manager Email` |
|---|---|---|
| `employee1@example.com` | `Aarav Sharma` | `manager1@example.com` |
| `employee2@example.com` | `Priya Patel` | `manager1@example.com` |
| `employee3@example.com` | `Rohan Mehta` | `manager2@example.com` |

---

### Sheet 7: `Error Log`
- **Purpose**: Centralized operational failure log recording exceptions, stack traces, and JSON context.
- **Protection Rules**: Protected. Appended strictly via `Utils.AppLogger`.
- **Header Row**: Row 1 (Frozen).
- **Columns Specification**:

| Col # | Header Text | Data Type | Required? | Example Value | Description |
|---|---|---|---|---|---|
| A | `Timestamp` | Timestamp | Yes | `2026-10-26 08:24:12` | Time of error occurrence |
| B | `Level` | String | Yes | `ERROR` | `INFO`, `WARN`, or `ERROR` |
| C | `Function` | String | Yes | `completeTask` | Name of throwing function |
| D | `Message` | String | Yes | `Proof required for TASK-002 but ticket ID was missing` | Human-readable explanation |
| E | `Stack` | String | No | `Error at CompletionService.gs:42` | JavaScript error stack trace |
| F | `Context (JSON)` | String | No | `{"taskRowId":"TASK-002","user":"employee2@example.com"}` | Serialized diagnostic variables |
| G | `User` | String | Yes | `employee2@example.com` | Active or effective user context |
| H | `Resolved` | String | No | `N` | Operational resolution flag (`Y`/`N`) |

---

## 3. Named Ranges Specification

1. `ConfigKeys`: `Config!$A$2:$A$20`
2. `ConfigValues`: `Config!$B$2:$B$20`
3. `EmployeeDirectory`: `Config!$D$2:$F$50`
4. `TaskMasterData`: `'Task Master'!$A$2:$Q`
5. `EmployeeDashboardInput`: `'Employee Dashboard'!$G$2:$H`
6. `ManagerAcknowledgementRange`: `'Manager Dashboard'!$F$15:$G`

---

## 4. Conditional Formatting Rules

1. **`Task Master` & Dashboards Status Colors**:
   - Status = `Overdue`: Background Light Red (`#FCE8E6`), Text Dark Red (`#C5221F`).
   - Status = `Pending` (Due Today): Background Light Amber (`#FEF7E0`), Text Dark Amber (`#B06000`).
   - Status = `Completed`: Background Light Green (`#E6F4EA`), Text Dark Green (`#137333`).
   - Status = `Paused`: Background Light Gray (`#F1F3F4`), Text Dark Gray (`#5F6368`).
2. **`Escalation Dashboard` Severity Colors**:
   - `CRITICAL (Day 5+)`: Bold Dark Red text with `#FAD2CF` fill.
   - `WARNING (Day 2+)`: Bold Dark Orange text with `#FEEFC3` fill.

---

## 5. Verification Self-Check
- [x] All 7 required sheets are explicitly detailed.
- [x] All required columns from Prompt 0 and Phase 3 are present in `Task Master` (Col A through Q).
- [x] 6 realistic sample rows are provided for `Task Master` covering all frequencies (Daily, 7d, 15d, Monthly anchored on 31st), Day 2 overdue, Day 5 overdue, and Completed with proof.
- [x] Sample rows provided for `Completion Log` and `Error Log`.
- [x] Named ranges, protection rules, and conditional formatting rules are fully defined.
