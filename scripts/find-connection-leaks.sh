#!/bin/bash
# find-connection-leaks.sh
# Identifies API routes that may have database connection leaks

echo "🔍 Scanning for potential connection leaks in API routes..."
echo ""

LEAKY_ROUTES=0
SAFE_ROUTES=0

for file in $(find src/app/api -name "route.js"); do
  # Check if file uses dbConnect
  if grep -q "dbConnect" "$file"; then
    # Check if it has proper try/finally pattern
    if grep -q "finally {" "$file" && grep -q "let db;" "$file"; then
      echo "✅ SAFE: $file"
      ((SAFE_ROUTES++))
    else
      echo "⚠️  NEEDS FIX: $file"
      ((LEAKY_ROUTES++))
      
      # Show which handlers need fixing
      grep -n "export async function" "$file" | while read line; do
        echo "   └─ $line"
      done
    fi
  fi
done

echo ""
echo "Summary:"
echo "  ✅ Safe routes: $SAFE_ROUTES"
echo "  ⚠️  Routes needing fix: $LEAKY_ROUTES"
echo ""

if [ $LEAKY_ROUTES -gt 0 ]; then
  echo "Run: chmod +x scripts/fix-route-leaks.sh && ./scripts/fix-route-leaks.sh <route-file>"
  exit 1
else
  echo "All routes look good! 🎉"
  exit 0
fi
