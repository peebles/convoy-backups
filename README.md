# Convoy Based Docker Volume Backups

This container can be launched into an enviroment that is employing [Convoy](https://github.com/rancher/convoy) for
persistent docker volumes, and makes taking snapshots, backups and restoring backups automated and easy.  It can
log information and errors to your logging system, and can optionally send email notifications using your SMTP
or SES email server settings.

## Background

Convoy is a docker volume plugin that provides the backend for data volumes.  Once it is running, you can launch
docker containers something like this:

    docker run --rm -it -v test_volume:/test --volume-driver=convoy ubuntu bash

The "test_volume" will be automatically created if it does not already exist and will be mounted inside the
container as "/test".  You can also manually create volumes before using them.

Volumes created by convoy can then be snapshotted and backed up.  Backups are incremental, and will be automatically
sent to an NFS partition on the host machine or to S3 if you have an AWS account.

This container takes care of creating snapshots and backups of volumes using a `crontab` that you define.  It
also supplies helpers for creating new volumes, or creating volumes from a previous backup.

## Installing Convoy

Convoy supports three physical mediums on which volumes are created and managed; AWS EBS, device mapper and NFS/VFS.
At the time of this writing, AWS EBS does not seem to work.  Device mapper involves attaching an unformatted block
device to the physical machine running the docker daemon, and then installing and running convoy on the physical
machine.  Convoy manages the block device at a low level, low enough that you cannot map /dev into a docker container
and run convoy that way.

If you choose NFS/VFS than you mount a formatted NFS partition onto the physical machine running the docker daemon
and convoy uses that to store its metadata.  Because /dev is not being manipulated, it should be possible to run
convoy in a docker container ... although you can also install it and run the convoy daemon on the physical machine.

### Device Mapper

Mount an unformatted block device onto the physical machine running the docker daemon.  In AWS you can create
EBS volumes and mount them onto EC2 instances.  I have tried using encrypted EBS volumes with convoy and found
that this does **not work**, probably because convoy is down too deep into the block device.

There are two utility scripts here: `scripts/create-vm.sh` to create a new machine in AWS and `scripts/create-and-attach-volume.sh`
to create an attach an EBS volume to an EC2 instance.  You can use them directly or as a reference for your own
purposes.  Use them at your own risk!

Once the block device is attached to your machine, ssh into the machine and install convoy:

```bash
wget https://github.com/peebles/convoy/releases/download/v0.5.0-peeb/convoy.tar.gz
tar xvzf convoy.tar.gz
sudo cp convoy/convoy convoy/convoy-pdata_tools /usr/local/bin/
rm -rf convoy*
wget https://raw.githubusercontent.com/rancher/convoy/master/tools/dm_dev_partition.sh
chmod +x dm_dev_partition.sh
sudo mkdir -p /etc/docker/plugins/
sudo bash -c 'echo "unix:///var/run/convoy/convoy.sock" > /etc/docker/plugins/convoy.spec'
```

Now find your attached block device.  You could use `lsblk` to find it.  On an EC2 instance, it is probably called
"/dev/xvdh", and I will use that as an example.  On your machine it may be called something different.

Now execute:

```bash
sudo ./dm_dev_partition.sh --write-to-disk /dev/xvdh
```

If that is successful, it will print out the line you should use to run the convoy daemon; something like this:

```bash
sudo convoy daemon --drivers devicemapper --driver-opts dm.datadev=/dev/xvdh1 --driver-opts dm.metadatadev=/dev/xvdh2
```

You can run that manually, but it is probably a safer bet to run it as a service so it will be run again if
your machine reboots.  There is a "convoy.init.d" script here I found [here](https://gist.github.com/colebrumley/6d9adff025e826772277)
that might be useful. You need to edit it and add the correct **CONVOY_OPTS**.

Then copy it to /etc/init.d/convoy on the host machine and:

```bash
sudo chmod +x /etc/init.d/convoy
sudo sudo update-rc.d convoy defaults
sudo /etc/init.d/convoy start
```

**If you are going to backup volumes to S3** then you need to make your AWS credentials available to the convoy daemon.
You can do this in a variety of ways.  See [this](https://github.com/aws/aws-sdk-go#configuring-credentials) for some
suggestions.  You could do it like this:

```bash
sudo AWS_ACCESS_KEY_ID=AKID1234567890 AWS_SECRET_ACCESS_KEY=MY-SECRET-KEY convoy daemon --drivers devicemapper --driver-opts dm.datadev=/dev/xvdh1 --driver-opts dm.metadatadev=/dev/xvdh2
```

### NFS/VFS

From the convoy documentation:

*First, mount the NFS share to the root directory used to store volumes. Substitute <vfs_path> to the appropriate directory of your choice:*

```bash
sudo mkdir <vfs_path>
sudo mount -t nfs <nfs_server>:/path <vfs_path>
```

*The NFS-based Convoy daemon can be started as follows:*

```bash
sudo convoy daemon --drivers vfs --driver-opts vfs.path=<vfs_path>
```

But because convoy is not managing /dev directly, I believe you could run convoy in a container.  The Dockerfile.nfs and docker-compose-nfs.yml here
might work.

Mount your NFS partition on /mnt on the physical machine and then:

```bash
docker-compose -f docker-compose-nfs.yml build
docker-compose -f docker-compose-nfs.yml up -d
```

## EBS

Run the convoy daemon something like this:

```bash
AWS_ACCESS_KEY_ID=XXXX \
AWS_SECRET_ACCESS_KEY=YYYY \
AWS_DEFAULT_REGION=us-west-2 \
convoy daemon --drivers ebs --driver-opts ebs.defaultkmskeyid=YOUR-KMS-KEY --driver-opts ebs.defaultvolumesize=10G --driver-opts ebs.fsfreeze=true
```

See [EBS.md](EBS.md) here for some more detail.

## Configuring and Running Backups

### Cron

Snapshots and backups are taken periodically using cron.  The file here called "crontab" is installed into /etc/crontab.  This file
is taking a snapshot of every volume once per hour, and then doing a backup of the most recent snapshot of every volume once per day.
If this is what you want, then you don't have to do anything special.  If you want to do something else, then edit this file before
building the container.  You can create snapshots and backups of individual volumes by name.  Like this:

    0 *	* * *	root    cd /deploy && node create.js --snapshot --volume vol1 # snapshot vol1 once per hour
    0 0	* * *	root	cd /deploy && node create.js --backup   --volume vol1 # backup vol1 once per day
    0 *	* * *	root    cd /deploy && node create.js --backup   --volume vol2 --createSnapshot # backup vol2 once per hour

### Backup Configuration

Backups are stored either on S3 or on a NFS partition (somewhere on the host system's filesystem).  You must supply an
environment variable to control this.  For S3, it looks like:

    BKUP_BACKUP_URL=s3://BUCKET-NAME@REGION/

and for NFS it should look like

    BKUP_BACKUP_URL=vfs://FULLPATH-TO-DIRECTORY

By default when a backup is made, it is made from the most recent snapshot.  The most recent snapshot should be saved so
that the next backup can be incremental.  But older snapshots can be removed, and are removed by default.  If for some reason
you want to keep all snapshots, you can set:

    BKUP_DELETE_OLD_SNAPSHOTS=false

### Logging

The logger supports writing log messages to console, file or syslog or any combination of the three ... including no logging.  This
is all controlled by environment variables.  The defaults are shown:

    BKUP_LOGGER_CONSOLE_ENABLED=true
    BKUP_LOGGER_CONSOLE_LEVEL=debug
    
    BKUP_LOGGER_FILE_ENABLED=false
    BKUP_LOGGER_FILE_LEVEL=debug
    BKUP_LOGGER_FILE_LOCATION=/tmp/backups.log
    
    BKUP_LOGGER_SYSLOG_ENABLED=false
    BKUP_LOGGER_SYSLOG_LEVEL=debug
    BKUP_LOGGER_SYSLOG_PORT=3030
    BKUP_LOGGER_SYSLOG_SERVER=10.10.10.10
    
### Email

You can have emails sent when errors occur.  You can employ your own SMTP server or use AWS SES to send emails.  Defaults are shown:

    BKUP_EMAIL_ENABLED=false
    BKUP_EMAIL_TRANSPORT=smtp  (or ses)
    BKUP_EMAIL_FROM=support@newco.co
    BKUP_EMAIL_TO=alert@newco.co
    
    BKUP_EMAIL_SMTP_PORT=465
    BKUP_EMAIL_SMTP_HOST=smtp.sendgrid.net
    BKUP_EMAIL_SMTP_USER=username
    BKUP_EMAIL_SMTP_PASS=password
    
    BKUP_EMAIL_SES_AWS_ACCESS_KEY_ID=AKID1234567890
    BKUP_EMAIL_SES_AWS_SECRET_ACCESS_KEY=MY-SECRET-KEY
    
## Maintanence Tasks

### Creating Volumes

Normally when you run a container with a volume mapping, convoy will create a volume for you if one does not
already exist.  But you can manually create a volume before launching a container that will use that volume.

```bash
docker exec -it backups node create.js --create --volume VOLUME-NAME --size 40G [--type ext4]
```

After that returns, you should now be able to run a docker container with that new volume.

### List of Volumes

```bash
docker exec -it backups node create.js --volumes
```

### Removing Volumes

You can delete a volume.  When a volume is deleted all of its snapshots will be deleted (usually only
one, the one used to make the last backup) and all of its backups but the last one.  You can have even
the last one deleted by supplying --all flag:

```bash
docker exec -it backups node create.js --remove --volume VOLUME-NAME [--all]
```

### Restoring from Backup

You can create a new volume initialized with a backup, and then use that volume to bring up a container.  That is
how you would restore from backup.  First, get a list of all the available backups for a volume:

```bash
docker exec -it backups node create.js --backups --volume VOLUME-NAME
```

That will produce a list that shows all the backups for that volume, most recent to least recent, along with the
backup urls for each backup.  Choose the one you are interested in and:

```bash
docker exec -it backups node create.js --restore --volume NEW-VOLUME-NAME --backupurl BACKUP-URL
```

When its done you can use the newly created volume, which should have the contents of the backup.

### Backup Now

Sometimes you just want to back it up now!

```bash
docker exec -it backups node create.js --backup --volume NEW-VOLUME-NAME --createSnapshot
```

## Web APIs

There is a small web server listening on port 3000 that you can use to invoke the management functions
via REST api.  The following endpoints are defined:

* /api/snapshot
* /api/backup
* /api/backups
* /api/volumes
* /api/restore
* /api/create
* /api/remove

They all are POSTs which can take `application/json` or `application/x-www-form-urlencoded` with the
same arguments as the docker commands shown above.  They all return the native json blobs that the
convoy driver returns.
