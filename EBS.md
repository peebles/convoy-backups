# Using the Convoy EBS Driver

I was able to get the EBS driver working.  I did this with a forked copy of the Convoy repo, using the master
branch and compiling it myself.  In the mean time I added "sync" and "fsfreeze" functionality to try to
make snapshots more consistent in a running system.  I added this functionality to the EBS and VFS drivers.
The Device Mapper driver does not seem to need it (it does some sort of "suspend" using native docker magic).

## Building Convoy

Do a "git clone" of `https://github.com/peebles/convoy`.  Create a docker-machine that you can mount your host file system into.  Then

```bash
docker build -t convoy -f Dockerfile.dapper .
```

### Build

```bash
docker run --rm -v $(pwd):/go/src/github.com/rancher/convoy -it convoy build
```

### Test

```bash
docker run --rm -v $(pwd):/go/src/github.com/rancher/convoy -it convoy test
```

### Package

```bash
docker run --rm -v $(pwd):/go/src/github.com/rancher/convoy -it convoy package
```

After running `package`, you will have "dist/artifacts/convoy.tar.gz" which you can install
by following the directions in the main README.md.

## EBS

The nice thing about the EBS driver is that you can take advantage of AWS EBS "encryption at rest" support.
When you run the convoy daemon, run it something like this:

```bash
AWS_ACCESS_KEY_ID=XXXX \
AWS_SECRET_ACCESS_KEY=YYYY \
AWS_DEFAULT_REGION=us-west-2 \
convoy daemon --drivers ebs --driver-opts ebs.defaultkmskeyid=YOUR-KMS-KEY --driver-opts ebs.defaultvolumesize=10G --driver-opts ebs.fsfreeze=true
```

You can use the default AWS KMS key for your account.  You can find this by going to the EC2:Volumes page, "create a volume",
select the "encryption" checkbox, and you will see a dialog that shows the default KMS key.  Or you can create custom ones
by visiting the IAM screen and proceeding from there.
