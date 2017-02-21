"use strict";

let app = {};
let c = require( 'env-friendly-config' )( require( 'path' ).join( __dirname, 'config.json' ) );
let _ = require( 'lodash' );
let async = require( 'async' );

app.config = c[ (process.env.NODE_ENV || 'default') ] || c[ 'default' ];

if ( ! app.config.logger ) {
  app.log = require( 'winston' );
}
else {
  if ( app.config.logger.type == 'winston' ) {
    app.log = require( 'winston' );
    app.log.configure( app.config.logger.options );
  }
  else if ( app.config.logger.type == 'docker-logger' ) {
    app.log = require( 'docker-logger' )( app.config.logger.options );
  }
  else {
    console.error( 'unsupported logger type:', app.config.logger.type );
    process.exit(1);
  }
}

let args = require( './lib/parseargs' )( app )( process.argv );

if ( args.snapshot ) {
  // create a snapshot
  let Convoy = require( 'node-convoy' );
  let convoy = new Convoy();

  let m = new Date();
  let dateSpec = m.getUTCFullYear()+("0" + (m.getUTCMonth()+1)).slice(-2)+("0" + m.getUTCDate()).slice(-2)+("0" + m.getUTCHours()).slice(-2)+("0" + m.getUTCMinutes()).slice(-2)+("0" + m.getUTCSeconds()).slice(-2);
  
  convoy.volumes( function( err, result ) {
    if ( err ) return exit( err );
    let volumes = Object.keys( result );
    if ( ! volumes.length ) return exit( 'no volumes found to take snapshots of' );
    if ( args.volume ) {
      if ( ! result[ args.volume ] ) return exit( 'volume ' + args.volume + ' does not exit' );
      volumes = [ args.volume ];
    }
    async.mapSeries( volumes, function( volumeName, cb ) {
      let snapshotName = "snap"+volumeName+dateSpec;
      app.log.debug( 'creating snapshot for', volumeName, ':', snapshotName );
      convoy.snapshotCreate({ Name: snapshotName, VolumeName: volumeName }, cb );
    }, function( err, snapshots ) {
      if ( err ) return exit( err );
      let snaps = snapshots.map( function( s ) { return s.Name; } ).join( ', ' );
      notify( 'info', 'snapshot(s) created: ' + snaps, exit );
    });
  });
}
else if ( args.backup ) {
  // create a backup
  let Convoy = require( 'node-convoy' );
  let convoy = new Convoy();

  function backup( volume, cb ) {
    // Get the most recent snapshot and back that up
    // snaps is most recent to least recent
    async.waterfall([
      function( cb ) {
	if ( ! args.createSnapshot ) {
	  let snaps = _.reverse( _.sortBy( _.values( volume.Snapshots ), function( item ) { return new Date( item.CreatedTime ).getTime(); } ) );
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
    if ( err ) return exit( err );
    let volumes = Object.keys( result );
    if ( ! volumes.length ) return exit( 'no volumes found to take backups of' );
    if ( args.volume ) {
      if ( ! result[ args.volume ] ) return exit( 'volume ' + args.volume + ' does not exit' );
      volumes = [ args.volume ];
    }
    async.mapSeries( volumes, function( volumeName, cb ) {
      app.log.debug( 'creating backup for', volumeName );
      backup( result[ volumeName ], cb );
    }, function( err, backups ) {
      if ( err ) return exit( err );
      let backs = backups.map( function( s ) { return s.URL; } ).join( ', ' );
      notify( 'info', 'backups(s) created: ' + backs, exit );
    });    
  });
}
else if ( args.list ) {
  let where = { URL: app.config.backupURL };
  if ( args.volume ) where.VolumeName = args.volume;
  let Convoy = require( 'node-convoy' );
  let convoy = new Convoy();
  convoy.backups( where, function( err, result ) {
    if ( err ) return exit( err );
    let backs = _.reverse( _.sortBy( _.values( result ), function( item ) { return new Date( item.CreatedTime ).getTime(); } ) );
    backs.forEach( function( b ) {
      console.log( b.VolumeName, b.CreatedTime );
      console.log( '  ', b.BackupURL );
    });
    exit();
  });
}
else if ( args.restore ) {
  if ( ! ( args.volume && args.backupurl ) )
    exit( 'must supply --volume and --backupurl to restore a backup' );
  let Convoy = require( 'node-convoy' );
  let convoy = new Convoy();
  convoy.volumeCreate({ Name: args.volume, BackupURL: args.backupurl }, function( err ) {
    if ( err ) return exit( err );
    console.log( 'volume', args.volume, 'created from', args.backupurl, 'is ready for use' );
    exit();
  });
}
else if ( args.create ) {
  if ( ! ( args.volume && args.size ) )
    exit( 'must supply --volume and --size to create a new volume' );
  let Convoy = require( 'node-convoy' );
  let convoy = new Convoy();
  let params = { Name: args.volume, Size: args.size };
  if ( args.type ) params.Type = args.type;
  if ( args.iops ) params.IOPS = args.iops;
  if ( args.prepareForVM ) params.prepareForVM = args.prepareForVM;
  convoy.volumeCreate( params, function( err ) {
    if ( err ) return exit( err );
    console.log( 'volume created:', args.volume );
    exit();
  });
}
else if ( args.remove ) {
  if ( ! args.volume )
    exit( 'must supply --volume to remove a volume' );
  let Convoy = require( 'node-convoy' );
  let convoy = new Convoy();
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
  ], function( err ) {
    if ( err ) return exit( err );
    console.log( 'volume', args.volume, 'removed!' );
    exit();
  });
}
else {
  notify( 'error', 'Unknown operation: must specify --snapshot or --backup', function() {
    process.exit(1);
  });
}

// -----------------------------------------------------------------------------------------

function exit( err ) {
  if ( ! err ) process.exit( 0 );
  notify( 'error', err, function() {
    process.exit(1);
  });
}

function notify( level, err, cb ) {
  app.log[ level ]( err );
  if ( ! app.config.emailer ) return process.nextTick( cb );
  if ( ! app.config.emailer.enabled ) return process.nextTick( cb );
  emailer( level, err, cb );
}

function emailer( level, err, cb ) {
  let message;
  if ( err instanceof Error ) message = err.message;
  else message = err;

  let nodemailer = require('nodemailer');
  let transporter = nodemailer.createTransport( app.config.emailer.transporter[ app.config.emailer.transportType ] );

  app.log.debug( 'sending email to:', app.config.emailer.to, 'message:', message );
  
  transporter.sendMail({
    to: app.config.emailer.to,
    from: app.config.emailer.from,
    subject: level + ': Backup notification from hostname ' + require( 'os' ).hostname(),
    text: level + ': ' + message
  }, function( err, result ) {
    if ( err ) app.log.error( err );
    app.log.debug( result );
    cb();
  });
}
