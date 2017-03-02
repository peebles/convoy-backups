#!/bin/bash

# capture the environment for the cron scripts
env >/etc/profile.d/backups.sh

# start up cron
/etc/init.d/cron start

# run the web service
forever --spinSleepTime 5000 --fifo app.js
