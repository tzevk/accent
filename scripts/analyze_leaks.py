import subprocess
import re

files_to_check = [
    "src/app/api/activity-logs/route.js",
    "src/app/api/admin/todos/route.js",
    "src/app/api/audit-logs/route.js",
    "src/app/api/employees/[id]/route.js",
    "src/app/api/login/route.js",
    "src/app/api/messages/[id]/route.js",
    "src/app/api/messages/conversation/[conversationId]/route.js",
    "src/app/api/messages/route.js",
    "src/app/api/messages/thread/[userId]/route.js",
    "src/app/api/messages/users/route.js",
    "src/app/api/todos/route.js",
    "src/app/api/users/[id]/activity-assignments/route.js",
    "src/app/api/users/[id]/projects/route.js",
    "src/app/api/users/[id]/route.js",
    "src/app/api/users/reset-password/route.js",
    "src/app/api/companies/import/route.js",
    "src/app/api/payroll/salary-profile/route.js",
    "src/app/api/projects/[id]/route.js",
    "src/app/api/attendance/monthly/route.js",
    "src/app/api/attendance/summary/route.js",
    "src/app/api/active-users/route.js",
    "src/app/api/activities/route.js",
    "src/app/api/user-status/route.js",
    "src/app/api/screen-time/route.js",
]

for f in files_to_check:
    print(f"\n{'='*80}")
    print(f"FILE: {f}")
    print("="*80)
    try:
        with open(f) as fh:
            lines = fh.readlines()
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if any(kw in stripped for kw in ['dbConnect', '.release()', '.end()', 'finally', 'export async']):
                print(f"  L{i}: {stripped}")
            elif re.search(r'\btry\b', stripped) and '{' in stripped:
                print(f"  L{i}: {stripped}")
            elif re.search(r'\bcatch\b', stripped):
                print(f"  L{i}: {stripped}")
            elif 'return' in stripped and 'Response' in stripped and 'NextResponse' not in stripped:
                pass  # skip noise
            elif 'return' in stripped and 'NextResponse' in stripped:
                print(f"  L{i}: {stripped}")
    except FileNotFoundError:
        print(f"  FILE NOT FOUND")
