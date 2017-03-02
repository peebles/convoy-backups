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
let api  = require( './lib/functions' )( app );

if ( args.snapshot ) {
  api.snapshot( args, function( err, snapshots ) {
    if ( err ) return exit( err );
    let snaps = snapshots.map( function( s ) { return s.Name; } ).join( ', ' );
    notify( 'info', 'snapshot(s) created: ' + snaps, exit );
  });
}
else if ( args.backup ) {
  api.backup( args, function( err, backups ) {
    if ( err ) return exit( err );
    let backs = backups.map( function( s ) { return s.URL; } ).join( ', ' );
    notify( 'info', 'backups(s) created: ' + backs, exit );
  });
}
else if ( args.backups ) {
  api.backups( args, function( err, backups ) {
    if ( err ) return exit( err );
    backups.forEach( function( b ) {
      console.log( b.VolumeName, b.CreatedTime );
      console.log( '  ', b.BackupURL );
    });
    exit();
  });
}
else if ( args.volumes ) {
  api.volumes( args, function( err, volumes ) {
    if ( err ) return exit( err );
    volumes.forEach( function( v ) {
      console.log( v.Name, v.CreatedTime, 'IN USE:', ( v.MountPoint == "" ? "NO" : "YES" ) );
    });
    exit();
  });
}
else if ( args.restore ) {
  api.restore( args, function( err ) {
    if ( err ) return exit( err );
    console.log( 'volume', args.volume, 'created from', args.backupurl, 'is ready for use' );
    exit();
  });    
}
else if ( args.create ) {
  api.create( args, function( err ) {
    if ( err ) return exit( err );
    console.log( 'volume created:', args.volume );
    exit();
  });    
}
else if ( args.remove ) {
  api.remove( args, function( err ) {
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
  if ( level != 'error' && args.nomail ) return process.nextTick( cb );
  emailer( level, err, cb );
}

function emailer( level, err, cb ) {
  let message;
  if ( err instanceof Error ) message = err.message;
  else message = err;
  app.log.debug( 'sending email to:', app.config.emailer.to, 'message:', message );
  api.email({
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
