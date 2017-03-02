"use strict";

let async = require( 'async' );
let _ = require( 'lodash' );

module.exports = function( app ) {
  let Convoy = require( 'node-convoy' );
  let convoy = new Convoy();

  let lib = {};

  // args.volume is optional (can be null) which will snap all volumes.
  // If args.volume is given, then only that volume is snapshotted
  lib.snapshot = function( args, cb ) {
    let m = new Date();
    let dateSpec = m.getUTCFullYear()+("0" + (m.getUTCMonth()+1)).slice(-2)+("0" + m.getUTCDate()).slice(-2)+("0" + m.getUTCHours()).slice(-2)+("0" + m.getUTCMinutes()).slice(-2)+("0" + m.getUTCSeconds()).slice(-2);
    
    convoy.volumes( function( err, result ) {
      if ( err ) return cb( err );
      let volumes = Object.keys( result );
      if ( ! volumes.length ) return cb( new Error( 'no volumes found to take snapshots of' ) );
      if ( args.volume ) {
	if ( ! result[ args.volume ] ) return cb( new Error( 'volume ' + args.volume + ' does not exist' ) );
	volumes = [ args.volume ];
      }
      async.mapSeries( volumes, function( volumeName, cb ) {
	let snapshotName = "snap"+volumeName+dateSpec;
	app.log.debug( 'creating snapshot for', volumeName, ':', snapshotName );
	convoy.snapshotCreate({ Name: snapshotName, VolumeName: volumeName }, cb );
      }, cb );
    });
  }

  lib.backup = function( args, cb ) {
    
    function backup( volume, cb ) {
      // Get the most recent snapshot and back that up
      // snaps is most recent to least recent
      async.waterfall([
	function( cb ) {
	  if ( ! args.createSnapshot ) {
	    let snaps = _.reverse( _.sortBy( _.values( volume.Snapshots ), function( item ) { return new Date( item.CreatedTime ).getTime(); } ) );
	    snaps = _.filter( snaps, function( s ) { return s.DriverInfo.State != "removed"; } );
	    if ( snaps.length ) return cb( null, snaps );
	  }
	  // well, they are asking to back up, so create a snapshot!
	  let m = new Date();
	  let dateSpec = m.getUTCFullYear()+("0" + (m.getUTCMonth()+1)).slice(-2)+("0" + m.getUTCDate()).slice(-2)+("0" + m.getUTCHours()).slice(-2)+("0" + m.getUTCMinutes()).slice(-2)+("0" + m.getUTCSeconds()).slice(-2);
	  let volumeName = volume.Name;
	  let snapshotName = "snap"+volumeName+dateSpec;
	  app.log.debug( 'creating snapshot for', volumeName, ':', snapshotName );
	  convoy.snapshotCreate({ Name: snapshotName, VolumeName: volumeName }, function( err, snap ) {
	    cb( err, [ snap ] );
	  });
	},
	function( snaps, cb ) {
	  app.log.debug( 'backing up snapshot:', snaps[0].Name );
	  convoy.backupCreate({ SnapshotName: snaps[0].Name, URL: app.config.backupURL }, function( err, result ) {
	    if ( err ) return cb( err );
	    // Its backed up ... should we remove old snapshots now?
	    // MUST KEEP THE ONE WE JUST BACKED UP if we want to enable incrementals, which we do
	    if ( ! app.config.deleteOldSnapshots ) return cb();
	    snaps.shift();
	    if ( ! snaps.length ) return cb( null, result );  // no old snaps
	    async.eachSeries( snaps, function( snap, cb ) {
	      app.log.debug( 'deleting old snapshot:', snap.Name );
	      convoy.snapshotDelete({ SnapshotName: snap.Name }, cb );
	    }, function( err ) {
	      cb( err, result );
	    });
	  });
	}
      ], cb );
    }

    convoy.volumes( function( err, result ) {
      if ( err ) return cb( err );
      let volumes = Object.keys( result );
      if ( ! volumes.length ) return cb( new Error( 'no volumes found to take backups of' ) );
      if ( args.volume ) {
	if ( ! result[ args.volume ] ) return cb( new Error( 'volume ' + args.volume + ' does not exist' ) );
	volumes = [ args.volume ];
      }
      async.mapSeries( volumes, function( volumeName, cb ) {
	app.log.debug( 'creating backup for', volumeName );
	backup( result[ volumeName ], cb );
      }, cb );
    });

  }

  lib.volumes = function( args, cb ) {
    convoy.volumes( function( err, result ) {
      if ( err ) return cb( err );
      cb( null, _.values( result ) );
    });
  }
    
  lib.backups = function( args, cb ) {
    let where = { URL: app.config.backupURL };
    if ( args.volume ) where.VolumeName = args.volume;
    convoy.backups( where, function( err, result ) {
      if ( err ) return cb( err );
      let backs = _.reverse( _.sortBy( _.values( result ), function( item ) { return new Date( item.CreatedTime ).getTime(); } ) );
      cb( null, backs );
    });
  }

  lib.restore = function( args, cb ) {
    if ( ! ( args.volume && args.backupurl ) )
      return cb( new Error( 'must supply --volume and --backupurl to restore a backup' ) );
    convoy.volumeCreate({ Name: args.volume, BackupURL: args.backupurl }, cb );
  }

  lib.create = function( args, cb ) {
    if ( ! ( args.volume && args.size ) )
      return cb( new Error( 'must supply --volume and --size to create a new volume' ) );
    let params = { Name: args.volume, Size: args.size };
    if ( args.type ) params.Type = args.type;
    if ( args.iops ) params.IOPS = args.iops;
    if ( args.prepareForVM ) params.prepareForVM = args.prepareForVM;
    convoy.volumeCreate( params, cb );
  }

  lib.remove = function( args, cb ) {
    if ( ! args.volume )
      return cb( new Error( 'must supply --volume to remove a volume' ) );

    async.waterfall([
      function( cb ) {
	convoy.volumeInspect({ VolumeName: args.volume }, cb );
      },
      function( volumeData, cb ) {
	convoy.backups({ URL: app.config.backupURL, VolumeName: args.volume }, function( err, backupData ) {
	  cb( err, volumeData, backupData );
	});
      },
      function( volumeData, backupData, cb ) {
	let backs = _.reverse( _.sortBy( _.values( backupData ), function( item ) { return new Date( item.CreatedTime ).getTime(); } ) );
	if ( ! args.all ) backs.shift(); // keep the most recent
	async.eachSeries( backs, function( backup, cb ) {
	  app.log.debug( 'deleting backup created on:', backup.CreatedTime );
	  convoy.backupDelete({ URL: backup.BackupURL }, cb );
	}, function( err ) {
	  if ( err ) return cb( err );
	  // deal with snapshot(s)
	  let snaps = _.reverse( _.sortBy( _.values( volumeData.Snapshots ), function( item ) { return new Date( item.CreatedTime ).getTime(); } ) );
	  snaps = _.filter( snaps, function( s ) { return s.DriverInfo.State != "removed"; } );
	  if ( ! args.all ) snaps.shift();  // preserve the most recent
	  async.eachSeries( snaps, function( snap, cb ) {
	    app.log.debug( 'deleteing snapshot:', snap.Name );
	    convoy.snapshotDelete({ SnapshotName: snap.Name }, cb );
	  }, function( err ) {
	    if ( err ) return cb( err );
	    app.log.debug( 'deleting the volume' );
	    convoy.volumeDelete({ VolumeName: args.volume }, cb );
	  });
	});
      }
    ], cb );
  }

  lib.backupRemove = function( args, cb ) {
    let url = args.url || args.URL || args.BackupURL;
    convoy.backupDelete( { URL: url }, cb );
  }

  lib.email = function( envelope, cb ) {
    let nodemailer = require('nodemailer');
    let transporter = nodemailer.createTransport( app.config.emailer.transporter[ app.config.emailer.transportType ] );
    transporter.sendMail( envelope, cb );
  }

  return lib;
}
