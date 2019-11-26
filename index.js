const express = require('express');
const app = express();
const gracefulExit = require('express-graceful-exit');
const gracefulExitHandler = gracefulExit.gracefulExitHandler;
const gracefulExitMiddleware = gracefulExit.middleware;
const gracefulExitTrackConnections = gracefulExit.init;
//import { gracefulExitHandler, middleware as gracefulExitMiddleware, init as gracefulExitTrackConnections } from 'express-graceful-exit';

console.info(`PID: ${process.pid}`);

app.use(gracefulExitMiddleware(app));

// Track connection open/closing so we can gracefully close them on shutdown
gracefulExitTrackConnections(app);

// Helper to make setTimeout await-able
async function sleepAsync(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function handlerSleepAsync(req, res) {
  console.info('Got sleep request');
  // Wait 10 seconds before returning, to simulate handling a request that takes some time
  await sleepAsync(10000);
  res.json({
    message: 'done sleeping',
  });
  console.info('Sent sleep response');
}

// Setup app routes
app.get('/sleep', handlerSleepAsync);
app.get('/fail', () => { res.status(500).send('NOT OK'); });

// Time to listen
const port = 3000;
const server = app.listen(port, (err) => {
  if (err) {
    console.error('Listening error', err);
    return;
  }

  console.info(`Listening on port: ${port}`);
})

// headersTimeout defauls to 40 seconds while server.timeout defaults to 120 seconds.
// This causes requests sent after 40 seconds of idle to
// immediately fail as Node closes the socket when it receives the request.
// Load balancers, including an HTTP ELB, would generally send a 5xx response to the caller
// when that happens.
// https://nodejs.org/api/http.html#http_server_timeout
server.headersTimeout = server.timeout;

// keepaliveTimeout is the time a connection will remain open after sending a response
// This needs to be greater than the idle connection timeout of any load balancer handling
// connections for the application.  HTTP ELBs default to a 60 second idle timeout, so this needs
// to be increased from the default of 5000 ms to 65000ms
// https://nodejs.org/api/http.html#http_server_keepalivetimeout
server.keepAliveTimeout = 65000;

function errorCodeDuringShutdown() {
  const err = new Error('Server is shutting down');
  err.status = 502;
  return err;
}

const shutdownConfig = {
  // delay (in ms) before process.exit is called after graceful cleanup has finished (if enabled)
  exitDelay: 1000,
  force: true, // because were tracking open connections, we can force them to close
  log: true,
  // We want the last request to run and return a Connection: close
  performLastRequest: true,
  errorDuringExit: false,
  getRejectionError: errorCodeDuringShutdown,
  // time (in ms) to allow connections to be gracefully closed
  // if there are no connections open then this timeout has no effect
  // if all connections are closed before this timeout then shutdown proceeds to the next step
  // prior to expiration of this timeout
  // Note: when an ELB idle connection timeout is set to 60 seconds, this must be set to
  // at least 60 seconds + max possible response time (as a connection may receive a request at 59.9 seconds
  // and would then need time to allow the response to be generated and sent, else this response will be lost)
  suicideTimeout: 70000,
};

// Signal handler
function shutdownSignalHandler(message) {
  console.info(`Recieved process event: ${message}`);
  gracefulExitHandler(app, server, shutdownConfig);
}

// Connect signal handler for graceful shutdown signals
process.on('SIGTERM', shutdownSignalHandler);
process.on('SIGINT', shutdownSignalHandler);
process.on('SIGHUP', shutdownSignalHandler);
