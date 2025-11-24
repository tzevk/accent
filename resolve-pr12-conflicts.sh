#!/bin/bash
# Script to help resolve PR #12 conflicts
# This script should be run by the fork owner (@deven065) in their fork

set -e

echo "=========================================="
echo "PR #12 Conflict Resolution Helper Script"
echo "=========================================="
echo ""
echo "This script will help resolve the unrelated history conflicts in PR #12"
echo ""

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "Error: Not in a git repository"
    exit 1
fi

# Check if upstream remote exists
if ! git remote | grep -q "^upstream$"; then
    echo "Adding upstream remote..."
    git remote add upstream https://github.com/tzevk/accent.git
else
    echo "Upstream remote already exists"
fi

# Fetch upstream
echo "Fetching upstream..."
git fetch upstream

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
echo "Current branch: $CURRENT_BRANCH"

# List commits to cherry-pick
echo ""
echo "Commits to preserve from current branch:"
echo "==========================================="
git log --oneline --no-merges origin/$CURRENT_BRANCH ^upstream/main 2>/dev/null || \
    git log --oneline --no-merges $CURRENT_BRANCH -5

echo ""
echo "==========================================="
echo ""

# Create backup branch
BACKUP_BRANCH="${CURRENT_BRANCH}-backup-$(date +%Y%m%d-%H%M%S)"
echo "Creating backup branch: $BACKUP_BRANCH"
git branch $BACKUP_BRANCH

# Create new branch from upstream
NEW_BRANCH="ui-ux-changes-rebased"
echo "Creating new branch from upstream/main: $NEW_BRANCH"
git checkout -b $NEW_BRANCH upstream/main

echo ""
echo "==========================================="
echo "Manual steps required:"
echo "==========================================="
echo ""
echo "1. Cherry-pick your commits from the backup branch:"
echo "   git cherry-pick <commit-sha>"
echo ""
echo "2. For each commit, you can find the SHAs by running:"
echo "   git log --oneline $BACKUP_BRANCH -10"
echo ""
echo "3. After cherry-picking all commits, push the new branch:"
echo "   git push origin $NEW_BRANCH"
echo ""
echo "4. Update PR #12 on GitHub to use the new branch '$NEW_BRANCH'"
echo ""
echo "5. If everything works, you can delete the backup:"
echo "   git branch -D $BACKUP_BRANCH"
echo ""
echo "==========================================="
echo ""

# Show the commits that need to be cherry-picked
echo "Commits to cherry-pick (in order, oldest first):"
echo "=================================================="
git log --oneline --no-merges --reverse $BACKUP_BRANCH ^upstream/main 2>/dev/null || \
    git log --oneline --no-merges --reverse $BACKUP_BRANCH -5

echo ""
echo "Script completed. You are now on branch: $NEW_BRANCH"
echo "Backup of your work is in branch: $BACKUP_BRANCH"
