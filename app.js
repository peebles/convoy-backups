"use strict";
let express = require( 'express' );
let bodyParser = require( 'body-parser' );

let app = express();

let c = require( 'env-friendly-config' )( require( 'path' ).join( __dirname, 'config.json' ) );
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

require( 'consign' )().include( 'lib' ).into( app );

app.use(bodyParser.json({limit: "50mb"}));
app.use(bodyParser.urlencoded({
  limit: "50mb",
  extended: true,
  parameterLimit:50000
}));

[ 'snapshot', 'backup', 'backups', 'volumes', 'restore', 'create', 'remove' ].forEach( function( endpoint ) {
  
  app.post( '/api/'+endpoint, function( req, res, next ) {
    app.lib.functions[ endpoint ]( req.body, function( err, result ) {
      if ( err ) return next( err );
      res.json( result );
    });
  });

});

let port = process.env.PORT || 3000;
var server = app.listen( port, function() {
  console.log( 'listening on:', port );
  app.log.info( 'listening on:', port );
});
server.timeout = ( 5 * 60 * 60 * 1000 );


