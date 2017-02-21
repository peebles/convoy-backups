#!/bin/bash
#
# Usage: $0 -p aws_profile_name -h hostname [-s size] [-v vpcid] [-t type] [-e (encrypted)] [-k (kms-key-id)]
#
# where -s is an integer number of Gb
#
# type is by default "stadard", but can be one of:
#
# standard: magnetic
# io1: provisioned IOPS SSD
# gp2: general purpose SSD
#

size=100
while getopts ":p:h:s:v:t:k:e" opt; do
    case $opt in
        p)
            profile_name=$OPTARG
            ;;
        h)
            hostname=$OPTARG
            ;;
        s)
            size=$OPTARG
            ;;
        t)
            type=$OPTARG
            ;;
	v)
            vpcid=$OPTARG
            ;;
	e)
	    encrypted="true"
	    ;;
	k)
	    key=$OPTARG
	    ;;
        \?)
            echo "Usage: $0 -p aws_profile_name -h hostname -s size [-v vpcid] [-t type] [-e (encrypted)] [-k (kms-key-id)]"
            ;;
    esac
done

if [[ ("$profile_name" = "") || ("$hostname" = "") || ("$size" = "") ]]; then
    echo "Usage: $0 -p aws_profile_name -h hostname -s size [-v vpcid] [-t type] [-e (encrypted)] [-k (kms-key-id)]"
    exit 1
fi

if [ -z "$type" ]; then
    type="standard"
fi

echo "Creating and attaching EBS of ${size}Gb to host \"$hostname\" ..."

# parse the $HOME/.aws/config file.
function parse_aws {
    cat $1 | awk -F' ' '{
if ( $1 == "[default]" ) { profile="default"; }
else if ( substr($1,0,8) == "[profile" ) { profile=$2; gsub(/[\[\]]/,"",profile); }
else if ( substr($1,0,1) == "[" ) { profile=$1; gsub(/[\[\]]/,"",profile); }
else { printf("%s_%s=\"%s\"\n", profile, $1, $3); }
}'
}

# given a profile and an attribute, return
# the correct value from the $HOME/.aws/config.
function aws_value {
    local profile=$1
    local attr=$2
    pv=${profile}_${attr}
    eval "V=\$$pv"
    echo $V
}

eval $(parse_aws $HOME/.aws/config)
eval $(parse_aws $HOME/.aws/credentials)

# Get the instance id for the hostname specified

instanceid=$(aws --profile $profile_name ec2 describe-instances --filters "Name=tag-value,Values=$hostname" --output text --query "Reservations[0].Instances[0].InstanceId")

if [ -z "$instanceid" ]; then
    echo "Cannot find the InstanceId for $hostname"
    exit 1
fi

if [ -z "$vpcid" ]; then
    VpcId=$(aws ec2 --profile $profile_name describe-vpcs --query 'Vpcs[].[VpcId,IsDefault]' --output text|grep True|awk '{print $1}')
else
    VpcId=$vpcid
fi

azone=$(aws ec2 --profile $profile_name  describe-subnets --filters "Name=vpc-id,Values=$VpcId" --output text --query 'Subnets[0].AvailabilityZone')
Region=$(aws_value $profile_name "region")
Zone=${azone#$Region}

Key=$(aws_value $profile_name 'aws_access_key_id')
Secret=$(aws_value $profile_name 'aws_secret_access_key')

echo "Hostname     = $hostname"
echo "InstanceID   = $instanceid"
echo "Access Key   = $Key"
echo "Secret       = $Secret"
echo "VPC ID       = $VpcId"
echo "Zone         = $Zone"
echo "AZone        = $azone"
echo "Region       = $Region"
echo "Size         = $size"
echo "Type         = $type"

if [ ! -z "$encrypted" ]; then
    eargs="--encrypted"
    if [ ! -z "$key" ]; then
	eargs="-encrypted --kms-key-id $key"
    fi
fi
if [ ! -z "$eargs" ]; then
    echo "Encryption   = $eargs"
fi

volumeid=$(aws --profile $profile_name ec2 create-volume --availability-zone $azone --size $size --volume-type $type $eargs --output text --query "VolumeId")

state=""
echo "Waiting for volume to become available ..."
while [ "$state" != "available" ]; do
    sleep 1
    state=$(aws --profile $profile_name ec2 describe-volumes --volume-ids $volumeid --output text --query 'Volumes[0].State')
    echo "  state = $state"
done

aws --profile $profile_name ec2 attach-volume --volume-id $volumeid --instance-id $instanceid --device /dev/sdh && \
    aws --profile $profile_name ec2 create-tags --resources $volumeid --tags "Key=Name,Value=$hostname"

