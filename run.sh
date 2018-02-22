#!/bin/bash

CRON_ENV=$(env)
CRON_SPEC="$BKUP_CRON"
CRON_CMD="cd /deploy && node create.js --backup --createSnapshot --nomail"

echo -e "$CRON_ENV\n$CRON_SPEC $CRON_CMD >/dev/null 2>&1" | crontab -
crontab -l
cron

# run the web service
forever --spinSleepTime 5000 --fifo app.js
