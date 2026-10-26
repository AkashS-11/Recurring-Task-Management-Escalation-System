# Security Model & Access Governance Specification

## 1. Executive Summary
This document defines the security architecture, role-based access model, data privacy trade-offs, and OAuth permission scopes for the Recurring Task Management and Escalation System. It provides an honest appraisal of the inherent security boundaries of Google Sheets and establishes administrative guidelines for production deployments.

---

## 2. Fundamental Security Reality: Why Filter Views are NOT Security

> [!CAUTION]
> **Filter Views & Hidden Columns Offer Zero Security**
> In Google Sheets, hiding a column, hiding a sheet, or applying a Filter View is purely a client-side presentation preference. It does **not** restrict data access.

### Technical Analysis:
1. **Any Collaborator with View Access**:
   - Can inspect hidden columns, create duplicate filter views, export the workbook to CSV/XLSX, copy the spreadsheet to their personal Google Drive, or read raw cell ranges via Google Apps Script and Google Sheets REST API.
2. **Any Collaborator with Edit Access**:
   - Can unhide protected sheets, duplicate tabs, examine underlying formulas, and read all rows in `Task Master` or `Completion Log` regardless of range protection.
3. **Range Protections Caveat**:
   - Protected ranges in Google Sheets restrict **writing**, but never restrict **reading**. A user who is prevented from editing Column A can still select the cells, copy their contents, and read every row in the file.
4. **Architectural Truth**:
   - Within a single shared Google Spreadsheet, true row-level confidentiality between employees cannot be enforced by Google Sheets access control. Claiming that a filter view or protected range provides employee data isolation is a false claim.

---

## 3. Recommended Sharing & Governance Model

To balance usability and data integrity within the constraints of a single-workbook prototype, the following role matrix is established:

| Role | Target Persona | Workbook Access Level | Allowed Interactions |
|---|---|---|---|
| **System Admin** | Project Lead / IT Admin | **Editor (Owner)** | Full access to all 7 sheets, scripts, triggers, and configurations. |
| **Manager** | Direct Supervisors | **Viewer / Protected Editor** | View access to `Manager Dashboard` and `Escalation Dashboard`. Edit permission restricted to Column F (`Acknowledgement`) on `Manager Dashboard`. |
| **Employee** | Operational Staff | **Protected Editor** | Access restricted to `Employee Dashboard`. Range protection prevents edits to Columns A-F, I, and J. Can only edit Column G (`Ticket ID / Proof`) and Column H (`Mark Complete`). |
| **Executive Leadership** | Directors / VP | **Viewer** | View-only access to `Escalation Dashboard` and `Manager Dashboard`. |

---

## 4. Multi-Sheet Per-Employee Architecture (Enterprise Production Path)

In enterprise environments where employees must strictly never see each other's task assignments, the recommended production pattern is the **Hub-and-Spoke Architecture**:

```
                              +---------------------------------------+
                              |         CENTRAL ADMIN HUB             |
                              |  (Task Master, Completion Log,        |
                              |   Manager & Escalation Dashboards)    |
                              +---+---------------+---------------+---+
                                  |               |               |
                  Script Push/Pull|               |               |
                                  v               v               v
                        +-------------+    +-------------+    +-------------+
                        | Employee A  |    | Employee B  |    | Employee C  |
                        | Private     |    | Private     |    | Private     |
                        | Spreadsheet |    | Spreadsheet |    | Spreadsheet |
                        +-------------+    +-------------+    +-------------+
```

1. **Isolation**: Each employee possesses a separate Google Spreadsheet accessible only to themselves and the System Admin.
2. **Synchronization**: An automated Apps Script in the central hub periodically pushes assigned tasks to the employee's private sheet and reads completed checkboxes into the central `Completion Log`.
3. **Trade-off**: Increases script API calls and management complexity, but achieves true row-level privacy. (For this assignment, the single-workbook architecture with enforced range protection is implemented as the prototype baseline).

---

## 5. Script Permission Scopes (OAuth 2.0)

The Apps Script project requests only the minimal necessary OAuth scopes declared in `appsscript.json`:

```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.send_mail",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```

### Scope Justification:
- `spreadsheets`: Required to read task states, update due dates, render dashboards, and append completion/error logs.
- `script.send_mail`: Required by `MailApp` to dispatch Day 0 employee reminders, Day 2 manager alerts, and Day 5 leadership escalations.
- `script.scriptapp`: Required by `Triggers.gs` to inspect, install, and prune time-driven and edit triggers programmatically.
- `userinfo.email`: Required by `handleEdit(e)` and `completeTask()` to retrieve the verified identity of the employee marking a task complete.

---

## 6. Audit Trail & Data Integrity

1. **Append-Only Completion Log**:
   - `Completion Log` is permanently locked against manual user modification.
   - Every completion record includes: `Cycle ID`, `Task Row ID`, `Task Name`, `Employee Email`, `Completed By`, `Completed At`, `Scheduled Due Date`, `Days Late`, `Proof / Ticket ID`, and `Source`.
   - Modifying or deleting log entries via the UI is blocked by range protection.
2. **Operational Error Log**:
   - Captures runtime faults, user identity, stack traces, and serialized parameters.
   - Sensitive email text is automatically redacted by `AppLogger` prior to logging.
3. **Email Safety**:
   - Automated notification emails never expose customer PII or sensitive operational payload content; emails contain only Task ID, Task Title, Assigned Person, Due Date, and internal workbook links.
