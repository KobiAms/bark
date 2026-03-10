#!/bin/bash
# Bark startup script — automatically restarts on /restart command.
# Ctrl+C cleanly stops everything.

echo "🐕 Starting Bark..."

# Trap Ctrl+C and SIGTERM — kill the child process and exit the loop
cleanup() {
    echo ""
    echo "👋 Stopping Bark..."
    if [ -n "$CHILD_PID" ]; then
        kill "$CHILD_PID" 2>/dev/null
        wait "$CHILD_PID" 2>/dev/null
        sleep 0.1  # let stdout pipe drain before shell reclaims the terminal
    fi
    exit 0
}
trap cleanup INT TERM

while true; do
    node --env-file=.env examples/full-stack.js &
    CHILD_PID=$!
    wait "$CHILD_PID"
    EXIT_CODE=$?

    # If killed by signal (Ctrl+C triggers cleanup before we get here), stop
    if [ $EXIT_CODE -eq 130 ] || [ $EXIT_CODE -eq 143 ]; then
        exit 0
    fi

    if [ $EXIT_CODE -eq 0 ]; then
        echo "🔄 Bark exited cleanly. Restarting in 2s..."
    else
        echo "💥 Bark crashed (code $EXIT_CODE). Restarting in 3s..."
    fi

    # Give Chromium/WhatsApp time to fully release the auth dir lock
    sleep 2
done
