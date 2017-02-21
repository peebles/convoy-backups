#!/bin/bash
set -x -e

mkdir -p /etc/docker/plugins/
echo "unix:///var/run/convoy/convoy.sock" > /etc/docker/plugins/convoy.spec

exec convoy daemon --drivers vfs --driver-opts vfs.path=${VOLUMES}
