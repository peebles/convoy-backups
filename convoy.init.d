#!/bin/sh
set -e

### BEGIN INIT INFO
# Provides:           convoy
# Required-Start:     $syslog $remote_fs
# Required-Stop:      $syslog $remote_fs
# Should-Start:       cgroupfs-mount cgroup-lite
# Should-Stop:        cgroupfs-mount cgroup-lite
# Default-Start:      2 3 4 5
# Default-Stop:       0 1 6
# Short-Description:  Manage container volumes
### END INIT INFO

export PATH=/sbin:/bin:/usr/sbin:/usr/bin:/usr/local/sbin:/usr/local/bin

BASE=convoy

# modify these in /etc/default/$BASE (/etc/default/docker)
CONVOY=/usr/local/bin/$BASE
# This is the pid file managed by docker itself
CONVOY_PIDFILE=/var/run/$BASE.pid
# This is the pid file created/managed by start-stop-daemon
CONVOY_SSD_PIDFILE=/var/run/$BASE-ssd.pid
CONVOY_LOGFILE=/var/log/$BASE.log
CONVOY_DESC="Convoy"
CONVOY_SOCKETFILE=/var/run/convoy/convoy.sock
plugin_spec_file=/etc/docker/plugins/convoy.spec

##########################################################
### CHANGE THESE AS APPROPRIATE
##########################################################

## FOR STORING BACKUPS TO S3 and for using EBS DRIVER
export AWS_ACCESS_KEY_ID="AKID1234567890"
export AWS_SECRET_ACCESS_KEY="MY-SECRET-KEY"
export AWS_DEFAULT_REGION="us-west-2"

## DEVICE MAPPER DRIVER
export BLOCK_DEVICE="xvhd"
CONVOY_OPTS="--drivers devicemapper --driver-opts dm.datadev=/dev/${BLOCK_DEVICE}1 --driver-opts dm.metadatadev=/dev/${BLOCK_DEVICE}2"

## VFS DRIVER
# export VFS_PATH="PATH-TO-MOUNTED-NFS-PARTITION"
# CONVOY_OPTS="--drivers vfs --driver-opts vfs.path=$VFS_PATH"

## EBS DRIVER
# export AWS_KMS_KEY_ID="YOUR-KMS-KEY-ID"
# export AWS_DEFAULT_EBS_VOLUME_SIZE="10G"
# CONVOY_OPTS="--drivers ebs --driver-opts ebs.defaultencrypted=true --driver-opts ebs.defaultkmskeyid=$AWS_KMS_KEY_ID --driver-opts ebs.defaultvolumesize=$AWS_DEFAULT_EBS_VOLUME_SIZE"

##########################################################
##########################################################
##########################################################

# Get lsb functions
. /lib/lsb/init-functions

if [ -f /etc/default/$BASE ]; then
    . /etc/default/$BASE
fi

# Check docker is present
if [ ! -x $CONVOY ]; then
    log_failure_msg "$CONVOY not present or not executable"
    exit 1
fi

fail_unless_root() {
    if [ "$(id -u)" != '0' ]; then
	log_failure_msg "$CONVOY_DESC must be run as root"
	exit 1
    fi
}

case "$1" in
    start)

	fail_unless_root

	touch "$CONVOY_LOGFILE"
	mkdir -p /var/run/$BASE

	ulimit -n 1048576
	if [ "$BASH" ]; then
	    ulimit -u 1048576
	else
	    ulimit -p 1048576
	fi

	echo "unix://${CONVOY_SOCKETFILE}" > $plugin_spec_file

	log_begin_msg "Starting $CONVOY_DESC: $BASE"
	start-stop-daemon --start --background \
			  --no-close \
			  --exec "$CONVOY" \
			  --pidfile "$CONVOY_SSD_PIDFILE" \
			  --make-pidfile \
			  --start -- \
			  --socket="$CONVOY_SOCKETFILE" daemon $CONVOY_OPTS \
			  >> "$CONVOY_LOGFILE" 2>&1
	log_end_msg $?
	while [ ! -e "$CONVOY_SOCKETFILE" ]; do
	    sleep 2
	done
	if [ "$(stat --format="%a" $CONVOY_SOCKETFILE)" != "660" ]; then
	    chmod 0660 $CONVOY_SOCKETFILE 2> /dev/null
	    ok=$?
	fi
	;;

    stop)
	fail_unless_root
	log_begin_msg "Stopping $CONVOY_DESC: $BASE"
	rm -f $plugin_spec_file
	start-stop-daemon --stop --pidfile "$CONVOY_SSD_PIDFILE" --retry 10
	log_end_msg $?
	;;

    restart)
	fail_unless_root
	convoy_pid=`cat "$CONVOY_SSD_PIDFILE" 2>/dev/null`
	[ -n "$convoy_pid" ] \
	    && ps -p $convoy_pid > /dev/null 2>&1 \
	    && $0 stop
	$0 start
	;;

    force-reload)
	fail_unless_root
	$0 restart
	;;

    status)
	status_of_proc -p "$CONVOY_SSD_PIDFILE" "$CONVOY" "$CONVOY_DESC"
	;;

    *)
	echo "Usage: service $BASE {start|stop|restart|status}"
	exit 1
	;;
esac
