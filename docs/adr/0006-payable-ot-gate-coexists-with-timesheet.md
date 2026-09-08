# Attendance OT gate (>2h) coexists with timesheet worked-hours OT

The timesheet report counts every minute past 8h (`max(0, logged − std)`); the attendance grid pays OT only when the daily excess exceeds 2h. We keep both: the gate is the payability filter, the report is the worked-hours truth, and the grid column is labeled "Payable OT (>2h)" so the two numbers stop looking like a bug.

Considered: removing the gate to mirror the report. Rejected because it silently inflates payroll — every 30-minute late stay would become payable.
