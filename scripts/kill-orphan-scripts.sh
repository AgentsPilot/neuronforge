#!/usr/bin/env bash
# Kill leftover `tsx` script runs from earlier sessions, and report the swap freed.
#
# WHY THIS EXISTS
#
# This machine has 8 GB of RAM and a 15 GB swap file. Script runs launched by
# `npm exec tsx …` (chat-probe, chat-capability and friends) do not always exit
# when their caller goes away: 51 of them were found alive, the oldest 28 days
# old, all idle at 0% CPU and entirely paged out. They hold nothing but swap —
# which is exactly the resource an 8 GB machine cannot spare, and the reason the
# whole system starts thrashing.
#
# Only touches `tsx` processes whose elapsed time is measured in DAYS. Dev
# servers, editors and anything started today are left alone.
set -uo pipefail

before=$(sysctl -n vm.swapusage)
pids=$(ps -eo pid,etime,command | grep -E "[t]sx" | awk '$2 ~ /-/ {print $1}')
count=$(printf '%s' "$pids" | grep -c . || true)

if [ "$count" -eq 0 ]; then
  echo "No orphaned tsx processes."
  echo "swap: $before"
  exit 0
fi

echo "Killing $count orphaned tsx process(es) older than one day:"
ps -eo pid,etime,command | grep -E "[t]sx" | awk '$2 ~ /-/ {printf "  pid=%-7s age=%s\n", $1, $2}'
printf '%s\n' "$pids" | while read -r pid; do [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null; done
sleep 2

echo
echo "before: $before"
echo "after:  $(sysctl -n vm.swapusage)"
echo
echo "macOS does not shrink the swap FILE, only the pages inside it — the space"
echo "is now reusable even though the total stays the same. \`sudo purge\` forces"
echo "the rest back if the machine still feels slow."
