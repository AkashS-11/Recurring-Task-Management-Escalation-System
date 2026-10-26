# Deployment, Operation & Disaster Recovery Guide

## 1. Overview & Prerequisites
This step-by-step guide walks a system administrator or technical operator through deploying, configuring, authorizing, operating, and recovering the Google Sheets & Apps Script Recurring Task Management and Escalation System from scratch.

### Prerequisites:
- A standard Google Account or Google Workspace account.
- Web browser (Google Chrome recommended).
- Access to Google Drive to create a new Google Sheet.

---

## 2. Step-by-Step Initial Deployment

### Step 1: Create the Host Google Sheet
1. Navigate to [Google Sheets](https://sheets.new) and create a fresh spreadsheet.
2. Title the spreadsheet: `Enterprise Recurring Task & Escalation System`.

### Step 2: Open the Apps Script Editor
1. In the top menu, select **Extensions** $\rightarrow$ **Apps Script**.
2. A new tab will open containing the Apps Script development environment.
3. Name the script project: `TaskSystemEngine`.

### Step 3: Configure the Manifest (`appsscript.json`)
1. In the Apps Script left sidebar, click the **Gear icon** (Project Settings).
2. Check the box labeled: **"Show 'appsscript.json' manifest file in editor"**.
3. In the left file tree, click on `appsscript.json`.
4. Replace the entire content with the following manifest and click **Save** (Ctrl+S / Cmd+S):

```json
{
  "timeZone": "Asia/Kolkata",
  "dependencies": {
    "enabledAdvancedServices": []
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.send_mail",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```

### Step 4: Create Source Script Files
Delete the default empty `Code.gs` and create the following 11 script files (click **+** next to Files $\rightarrow$ **Script**) in the project, naming them exactly as shown:

1. `Utils.gs` $\leftarrow$ Copy content from `src/Utils.gs`
2. `ValidationService.gs` $\leftarrow$ Copy content from `src/ValidationService.gs`
3. `TaskService.gs` $\leftarrow$ Copy content from `src/TaskService.gs`
4. `DashboardService.gs` $\leftarrow$ Copy content from `src/DashboardService.gs`
5. `CompletionService.gs` $\leftarrow$ Copy content from `src/CompletionService.gs`
6. `ReminderService.gs` $\leftarrow$ Copy content from `src/ReminderService.gs`
7. `EscalationService.gs` $\leftarrow$ Copy content from `src/EscalationService.gs`
8. `Setup.gs` $\leftarrow$ Copy content from `src/Setup.gs`
9. `Triggers.gs` $\leftarrow$ Copy content from `src/Triggers.gs`
10. `Code.gs` $\leftarrow$ Copy content from `src/Code.gs`
11. `Tests.gs` $\leftarrow$ Copy content from `src/Tests.gs`

Click **Save all project files**.

---

## 3. First-Time Initialization & Authorization Flow

### Step 1: Run `setupAll`
1. In the Apps Script toolbar function dropdown, select `setupAll`.
2. Click **Run**.
3. **Authorization Screen 1**: A dialog appears: *"Authorization Required: This project requires your permission to access your data."* Click **Review permissions**.
4. **Authorization Screen 2**: Choose your Google Account.
5. **Authorization Screen 3 (Warning screen)**: If you see *"Google hasn’t verified this app"*, click **Advanced** (bottom left), then click **Go to TaskSystemEngine (unsafe)**.
6. **Authorization Screen 4 (Permission Grant)**: Review requested permissions:
   - *See, edit, create, and delete all your Google Sheets spreadsheets*
   - *Send email on your behalf*
   - *Allow this application to run when you are not present*
   - *See your primary Google Account email address*
   Click **Allow**.
7. The execution will start and finish in ~5 seconds. Return to the Google Sheet tab. All 7 sheets (`Task Master`, `Employee Dashboard`, `Completion Log`, `Manager Dashboard`, `Escalation Dashboard`, `Config`, `Error Log`) are now created, formatted, and seeded with sample data!

### Step 2: Configure Settings in the `Config` Sheet
1. Open the `Config` tab.
2. In Columns A & B, adjust your configuration:
   - `TIMEZONE`: Ensure it matches your local region (e.g. `Asia/Kolkata` or `America/New_York`).
   - `LEADERSHIP_EMAIL`: Set your executive team email.
   - `DEFAULT_MANAGER_EMAIL`: Set fallback manager email.
   - `ADMIN_EMAILS`: Enter your email.
   - `SEND_EMAILS`: Keep as `FALSE` for initial testing (simulates email in logs) or change to `TRUE` for live emails.
3. In Columns D-F (Employee Directory), enter your real test accounts and managers.

### Step 3: Install Automation Triggers
1. Refresh the Google Sheet tab in your browser.
2. You will see a custom menu appear in the top toolbar: **Task System**.
3. Click **Task System** $\rightarrow$ **Install Triggers**.
4. A toast message will confirm: *"Successfully installed 3 triggers: handleEdit, dailyJob, refreshDashboardsHourly"*.

---

## 4. Verification & Go-Live Checklist

- [ ] Run **Task System** $\rightarrow$ **Run All Tests**: Confirm toast displays *"Tests Complete: 19/19 Passed (ALL GREEN)"*.
- [ ] Run **Task System** $\rightarrow$ **Run Recurrence Self-Check**: Confirm all 20 date cases pass.
- [ ] Run **Task System** $\rightarrow$ **Run System Health Check**: Confirm *"ALL SYSTEMS HEALTHY"*.
- [ ] Test Employee Dashboard:
  - Check the checkbox on `TASK-001`. Confirm toast indicates completion and next due date advances.
  - Verify that `Completion Log` has recorded 1 new row.
- [ ] Test Manager Dashboard:
  - Select "Acknowledged" on an overdue task; verify the timestamp appears in Column G.
  - Click **Task System** $\rightarrow$ **Refresh Dashboards**; verify acknowledgement and timestamp remain intact.

---

## 5. Troubleshooting Guide

| Symptom | Likely Cause | Solution |
|---|---|---|
| **Checkbox does nothing when clicked** | Simple `onEdit` installed instead of installable trigger, or trigger missing | Run **Task System** $\rightarrow$ **Install Triggers** from the menu to bind the installable `handleEdit` event. |
| **No emails are received** | `SEND_EMAILS` is set to `FALSE` in `Config` sheet, or MailApp quota reached | Check `Config` sheet cell `B11`. If set to `FALSE`, the system safely simulates emails to `Error Log`/Logger without sending. Set to `TRUE` for live delivery. |
| **Duplicate emails received** | Triggers were installed multiple times under different handler names | Run **Task System** $\rightarrow$ **Install Triggers**; this automatically purges all duplicate triggers before reinstalling. |
| **Active user email is blank** | Personal consumer `@gmail.com` accounts lack domain delegation | The system automatically falls back to `Session.getEffectiveUser()` and logs a warning. |
| **Formula / Column mismatch error** | Sheet columns were renamed or reordered | Check `Utils.SCHEMA` mappings; ensure header text in Row 1 matches schema constants. |
| **Script execution timeout** | Processing large volume of tasks with cell-by-cell calls | All services use batch `getValues()` / `setValues()`. Check `Error Log` for stack traces. |

---

## 6. Disaster Recovery & Operational Maintenance

### 1. Accidentally Deleted a Sheet Tab
- If any operational sheet is accidentally deleted, simply run **Task System** $\rightarrow$ **Run Setup**. `setupAll()` is idempotent: it will recreate the missing sheet and apply headers and validation without overwriting data in remaining sheets.

### 2. Safeguarding `Completion Log`
- The `Completion Log` is the system's permanent legal audit trail.
- Recommendation: Perform a weekly Google Sheets version snapshot (File $\rightarrow$ Version History $\rightarrow$ Name current version) or use Google Drive automated backups.

### 3. Re-Running a Missed Daily Batch
- If Google servers experienced a transient outage during the 8:00 AM daily trigger, simply click **Task System** $\rightarrow$ **Run Daily Job Now**. The job is 100% idempotent and can be triggered manually at any time without duplicating reminders or alerts.

### 4. Rotating System Ownership
- To transfer ownership to a new administrator:
  1. Share the Google Sheet as Owner with the new administrator account.
  2. The new administrator opens Apps Script and runs `installTriggers()`.
  3. This transfers trigger execution context and OAuth authorization to the new owner's credentials.
