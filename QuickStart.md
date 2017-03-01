# Quick Start

## Install Convoy

Install Convoy on the physical machine, the machine running the docker daemon:

```bash
wget https://github.com/rancher/convoy/releases/download/v0.5.0/convoy.tar.gz
tar xvzf convoy.tar.gz
sudo cp convoy/convoy convoy/convoy-pdata_tools /usr/local/bin/
sudo mkdir -p /etc/docker/plugins/
sudo bash -c 'echo "unix:///var/run/convoy/convoy.sock" > /etc/docker/plugins/convoy.spec'
```

## Driver Dependent Setup

### Device Mapper

Attach a block device to the machine.  It should not be formatted.  If its EBS, it cannot be encrypted.
Figure out what the block device name is (`lsblk`) and:

```bash
wget https://raw.githubusercontent.com/rancher/convoy/master/tools/dm_dev_partition.sh
chmod +x dm_dev_partition.sh
sudo ./dm_dev_partition.sh --write-to-disk /dev/BLOCK-DEVICE
```

### VFS

Mount an NFS file system onto something like "/nfs".  Make sure it re-mounts on startup by adding
it to /etc/fstab or whatever.  If you're using AWS, check out "EFS".

### EBS

No special set up is required.

## Install init.d Script

Install "convoy.init.d" to /etc/init.d/convoy.  Edit that startup script and change the convoy related
section appropriately.  It'll be obvious what to change.  Then:

```bash
sudo chmod +x /etc/init.d/convoy
sudo sudo update-rc.d convoy defaults
sudo /etc/init.d/convoy start
```

## Build and/or Run This Image

```bash
docker-compose build
docker-compose up -d
```


