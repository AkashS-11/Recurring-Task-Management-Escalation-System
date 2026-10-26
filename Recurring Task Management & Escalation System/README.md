# Google Sheets Recurring Task Management & Multi-Tier Escalation System

A production-grade, enterprise-ready prototype for recurring task management, automated completion auditing, and multi-tier escalation built **strictly using Google Sheets (UI & Data Store) and Google Apps Script (Backend Automation Engine)**.

---

## 1. System Architecture & End-to-End Workflow

The system provides an unbroken operational lifecycle: task due $\rightarrow$ employee completion $\rightarrow$ immutable audit log $\rightarrow$ schedule advancement $\rightarrow$ overdue detection $\rightarrow$ Day 0 employee reminder $\rightarrow$ Day 2 manager alert $\rightarrow$ Day 5 executive escalation.

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

---

## 2. Key Architectural Innovations

### 2.1 Drift-Proof Recurrence Engine (`src/TaskService.gs`)
- **Cumulative Drift Prevention**: The next due date is derived from the **scheduled due date (anchor basis)**, preventing calendar slippage when employees complete tasks late. Controlled by `Config!RECURRENCE_BASIS` (`SCHEDULED` vs. `COMPLETION`).
- **Month-End Clamping**: Retains the original anchor day-of-month. For an anchor of Jan 31:
  $$\text{Jan 31} \longrightarrow \text{Feb 28 (or Feb 29 in 2028)} \longrightarrow \text{Mar 31} \longrightarrow \text{Apr 30} \longrightarrow \text{May 31}$$
  Calculations never chain from an already-clamped month-end date.
- **Multi-Cycle Roll-Forward**: If an assignment is completed multiple cycles late (e.g. 20 days late on a 7-day task), the engine rolls forward to the first future cycle relative to completion date, recording skipped cycles as `MISSED` in `Completion Log`.

### 2.2 Concurrency & Idempotency Gating (`src/CompletionService.gs`)
- **Deterministic Cycle ID**:
  $$\text{Cycle ID} = \text{TaskRowID} \parallel \text{"|"} \parallel \text{yyyy-MM-dd(due date)}$$
- **Atomic Locking**: All mutations acquire `LockService.getScriptLock()` with a 30-second timeout.
- **Deduplication Gating**: Checks `Completion Log` for `Cycle ID` before writing. Rapid double-clicks or concurrent edits return `{status: 'DUPLICATE'}` and are rejected safely.

### 2.3 Single Employee Input Surface (`src/DashboardService.gs`)
- Employees interact exclusively via the `Employee Dashboard`.
- **WhatsApp-Style Tasks**: Single-click completion with auto-generated proof (`AUTO:user|date|cycleId`).
- **Portal Tasks**: Ticking complete requires a non-empty `Ticket ID / Proof` matching `Config!TICKET_ID_PATTERN` when `Proof Required = 'Y'`.

### 2.4 Multi-Tier Escalations (`src/EscalationService.gs`)
- **Day 0**: Consolidated reminder email sent to employee on due date.
- **Day 2**: Consolidated alert dispatched to assigned direct manager (resolved from `Config` directory).
- **Day 5**: Critical executive escalation table dispatched to `Config!LEADERSHIP_EMAIL`.
- **Cancellation**: Completing an overdue task between Day 2 and Day 5 immediately advances the cycle, resetting notification stamps and suppressing the Day 5 escalation.

### 2.5 Resilient Dynamic Schema (`src/Utils.gs`)
- Columns are resolved dynamically at runtime by header name via `Utils.SCHEMA`. Reordering columns in the Google Sheets UI will never break backend scripts.

---

## 3. Repository Structure & File Manifest

```
assignment_rec/
├── appsscript.json                      # Apps Script manifest (V8, Asia/Kolkata, OAuth scopes)
├── README.md                            # Complete architecture, setup & test report
├── docs/
│   ├── 00-context.md                    # Prompt 0: Master context & locked design decisions
│   ├── 01-requirements.md               # Phase 1: Numbered FRs/NFRs & 14-deliverable traceability
│   ├── 02-architecture.md               # Phase 2: 6 ASCII system architecture diagrams
│   ├── 03-sheet-schema.md               # Phase 3: Exact schema of all 7 sheets with sample data
│   ├── 04-data-model.md                 # Phase 4: JSDoc typedefs, state machine, Cycle ID logic
│   ├── 14-security.md                   # Phase 14: Security model, sharing rules, honest limits
│   ├── 15-testing.md                    # Phase 15: Functional test scenarios & edge cases
│   ├── 16-deployment.md                 # Phase 16: Step-by-step deployment & recovery guide
│   ├── 17-integration-report.md         # Phase 17: Full dependency and signature audit
│   └── 18-production-review.md          # Phase 18: Adversarial production review & scorecard
└── src/
    ├── Code.gs                          # Custom menu (onOpen) & installable handleEdit trigger
    ├── Setup.gs                         # setupAll() idempotent sheet/rule/seed builder
    ├── Triggers.gs                      # installTriggers(), dailyJob(), listTriggers()
    ├── TaskService.gs                   # Pure recurrence engine & overdue status updater
    ├── CompletionService.gs             # completeTask(), cycle idempotency, lock handling
    ├── ReminderService.gs               # Day 0 consolidated reminder engine
    ├── EscalationService.gs             # Day 2 Manager alert & Day 5 Leadership escalation
    ├── ValidationService.gs             # Centralized schema, email, ticket, health validators
    ├── DashboardService.gs              # Employee, Manager, and Escalation dashboard renderers
    ├── Utils.gs                         # Schema resolver, Config reader, AppLogger, Lock & Date helpers
    └── Tests.gs                         # In-sheet test suite & demoEscalationTimeline()
```

---

## 4. Quickstart Deployment Guide

1. Create a fresh Google Sheet at [sheets.new](https://sheets.new).
2. Go to **Extensions** $\rightarrow$ **Apps Script**.
3. In Project Settings, enable **"Show 'appsscript.json' manifest file in editor"** and paste the contents of `appsscript.json`.
4. Create the 11 script files in `src/` inside the Apps Script editor.
5. In the toolbar function dropdown, select `setupAll` and click **Run**. Authorize Google permissions when prompted.
6. Refresh the Google Sheet. In the new **Task System** menu:
   - Click **Install Triggers** (configures installable onEdit and time-driven daily triggers).
   - Click **Run All Tests** (verifies that all 19 unit & functional test suites pass).
   - Click **Run Recurrence Self-Check** (verifies all 20 date edge cases pass).

---

## 5. Automated Test Suite Results

The test suite in `src/Tests.gs` covers unit date arithmetic, drift immunity, multi-cycle skips, regex validations, escalation math, and scratch sheet duplicate blocking:

```
=================================================
STARTING AUTOMATED TEST SUITE: 19 TEST CASES
=================================================
[PASS] Test 01: Daily Next Due Calculation (+1 day)
[PASS] Test 02: Every 7 Days Next Due Calculation (+7 days)
[PASS] Test 03: Every 15 Days Next Due Calculation (+15 days)
[PASS] Test 04: Monthly: Jan 31 -> Feb 28 (Non-leap year 2027)
[PASS] Test 05: Monthly: Jan 31 -> Feb 29 (Leap year 2028)
[PASS] Test 06: Monthly: Feb 28 -> Mar 31 (Preserves 31st anchor)
[PASS] Test 07: Monthly: Mar 31 -> Apr 30 -> May 31 (Full progression)
[PASS] Test 08: Monthly: Dec 31 -> Jan 31 (Year rollover)
[PASS] Test 09: Leap Year: Feb 29 2028 -> Feb 28 2029
[PASS] Test 10: Zero Drift after 10 consecutive late completions
[PASS] Test 11: Multi-Cycle Late Completion (25 days late skips cycles)
[PASS] Test 12: Ticket ID Regex Validation (Pattern checking)
[PASS] Test 13: Email Format Validation (Valid vs Malformed)
[PASS] Test 14: Config Progression Validation (REMINDER <= MGR < LEAD)
[PASS] Test 15: Escalation Threshold Evaluation (Days 1, 2, 4, 5, 6)
[PASS] Test 16: DEMO_DATE_OVERRIDE changes getToday() output
[PASS] Test 17: Date-only UTC arithmetic eliminates midnight skew
[PASS] Test 18: Cancellation of Day 5 alert if completed before threshold
[PASS] Test 19: Scratch Sheet Functional Test (Completion & Duplicate Block)
=================================================
TEST RUN COMPLETE: 19 PASSED, 0 FAILED (ALL GREEN)
=================================================
```

---

## 6. Known Limitations & Future Work

1. **Google Sheets Range Protection & Privacy**:
   - *Limitation*: In a shared spreadsheet, protected ranges prevent collaborators from **editing**, but do not prevent them from **reading** visible rows or copying the file. Filter views cannot hide data securely.
   - *Future Work*: For enterprise compliance requiring strict row-level isolation between employees, implement the **Hub-and-Spoke Multi-Spreadsheet Architecture** detailed in `docs/14-security.md`.
2. **Consumer Gmail Domain Delegation**:
   - *Limitation*: `Session.getActiveUser().getEmail()` returns an empty string when accessing sheets across personal `@gmail.com` accounts without Google Workspace domain delegation.
   - *Resolution*: The system implements an automatic fallback cascade to `Session.getEffectiveUser()` with an audit notice.
3. **Google Apps Script Quotas**:
   - *Limitation*: Consumer Google accounts have a daily limit of 100 email recipients (1,500 for Google Workspace) and a 6-minute execution cap.
   - *Mitigation*: The system checks remaining quota before sending batches, gracefully suspends email dispatch if quota drops below 5, and monitors elapsed execution time in `dailyJob()` to exit safely within 5 minutes.
