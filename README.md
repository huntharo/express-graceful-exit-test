# Overview

This application demonstrates an issue with `express-graceful-exit` which connections are abruptly terminated after receiving a request on an existing connection during the graceful exit period.  This abrupt termination looks the same as the application crashing and will generally be handled by HTTP-level load balancers as something that they should generate a 5xx-level error for (or close their incoming corresponding connection).

This application is also used to test that the fix for the issue works correctly.

# Impacted Versions of express-graceful-exit

* Through version 0.4.2, at least
* Through versions released up to, at least, 2019-09-10

# PR for Fix

* Issue Tracker
  * https://github.com/emostar/express-graceful-exit/issues/14
* Pull Request with Fix
  * https://github.com/emostar/express-graceful-exit/pull/15

# HTTP 1.1 Connection Headers

Connection close in a response header signalls to the caller that the connection will have been closed after the response bytes have been sent, meaning that the connection can no longer be used to send additional requests.  This is similar to the way that HTTP 1.0 worked by default.

https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.10

> HTTP/1.1 defines the "close" connection option for the sender to signal that the connection will be closed after completion of the response. For example,
>
>       Connection: close
> in either the request or the response header fields indicates that the connection SHOULD NOT be considered `persistent' (section 8.1) after the current request/response is complete.

# Problem Cases

* Single Connection Open @ Shutdown
  * One connection is open to the application
  * Shutdown of the application is initiated
  * Request received on the single connection
  * Observed:
    * Application immediately closes the connection
    * `express-graceful-exit` sees there are no more connections
    * `process.exit()` is called and the request effectively does not run
* Multiple Connections Open @ Shutdown
  * Two connections are open to the application
    * Both with ~60 seconds remaining before closed for idle
  * Shutdown of the application is initiated
  * Request received on the first connection
  * Second connection is left idle (the caller will close it in 60 seconds or `express-graceful-exit` will force-close it in around 60 seconds)
  * Observed:
    * Application receives and runs the request
    * Application closed the connection upon which it would send a response
    * Summary: Request runs but has no where to send a response to
      * Imagine a purchase transaction that does not check for exceptions on writing the response back to the caller: the transaction would remain committed in the database, the item was purchased, but the request looked as if it failed

# Environment Setup

* Confirm Node version
  * `node --version` - 10.x is confirmed to work with this application
* Checkout `express-graceful-exit`
  * `cd ..`
  * `git clone git@github.com:emostar/express-graceful-exit.git`
  * `cd express-graceful-exit`
  * `npm install`
* Install application Node modules
  * `cd express-graceful-exit-test`
  * `npm install`
* Link application to local `express-graceful-exit`
  * `cd express-graceful-exit-test`
  * `npm link ../express-graceful-exit`

# Send Test Request

* Use Telnet
  * Telnet is used as the state of the socket is very easy to determine
  * Telnet does not exit immediately after sending an HTTP request, such as `curl` would do by default
* Start the app
  * Note: Do not use `npm run start` to start the app as this changes signal handling behavior
  * `cd express-graceful-exit-test`
  * `node index.js`
* Send test request
  * Note: Use another terminal
  * `telnet localhost 3000`
  * Type: `GET /sleep HTTP/1.1`, press [enter] twice
  * Observe:
    * Application will print trace indicating that the request was received
    * Telnet will show nothing new for 10 seconds
    * Telnet will print the response
    * Application will indicate that a response was sent
    * After ~65 seconds telnet will indicate that the connection was closed

# Reproduce the Problem - Single Connection Case

* Checkout a version with the problem
  * `cd express-graceful-exit`
  * `git checkout 6eba1de`
* Start the app
  * Note: Do not use `npm run start` to start the app as this changes signal handling behavior
  * `cd express-graceful-exit-test`
  * `node index.js`
  * Copy the PID
* Send initial request - Leave connection open
  * Note: Use another terminal
  * `telnet localhost 3000`
  * Type: `GET /sleep HTTP/1.1`, press [enter] twice
  * Observe:
    * The connection should remain open after the request is sent
* Send SIGTERM or SIGINT to application
  * Either option works fine for this test
  * `kill -SIGTERM [PID]`
  * Press [Ctrl-C] in the window running `node`
  * Observe:
    * Application will print that SIGINT or SIGTERM was received
    * Application will continue running for up to 60 seconds
* Send second request on initial connection
  * Note: Use the terminal that has telnet already connected from above
  * Type: `GET /sleep HTTP/1.1`, press [enter] twice
  * Observe:
    * Application will *not* print trace that a request was received
    * Telnet will immediately report that the connection was closed
    * Application and telnet will both immediately exit
  * Expected:
    * Application should have printed that a request was received
    * Application should have run the request (waited 10 seconds)
    * Application should have returned a response
    * Telnet should receive a response with a `Connection: close` header value
    * Telnet should report that the connection was closed
    * Application and telnet should exit

# Reproduce the Problem - Multiple Connection Case

* Checkout a version with the problem
  * `cd express-graceful-exit`
  * `git checkout 6eba1de`
* Start the app
  * Note: Do not use `npm run start` to start the app as this changes signal handling behavior
  * `cd express-graceful-exit-test`
  * `node index.js`
  * Copy the PID
* Send initial request on first connection - Leave connection open
  * Note: Use another terminal
  * `telnet localhost 3000`
  * Type: `GET /sleep HTTP/1.1`, press [enter] twice
  * Observe:
    * The connection should remain open after the request is sent
* Open second connection
  * Note: Use another terminal
  * `telnet localhost 3000`
  * Note: There is no need to send a request, this serves as another idle connection that prevents immediate shutdown of the app when the first connection receives a request
* Send SIGTERM or SIGINT to application
  * Either option works fine for this test
  * `kill -SIGTERM [PID]`
  * Press [Ctrl-C] in the window running `node`
  * Observe:
    * Application will print that SIGINT or SIGTERM was received
    * Application will continue running for up to 60 seconds
* Send second request on first connection
  * Note: Use the terminal that has telnet already connected from above
  * Type: `GET /sleep HTTP/1.1`, press [enter] twice
  * Observe:
    * Application will print trace that a request was received
      * Note: this differs from the single connection test
    * Telnet will immediately report that the connection was closed
    * Telnet will immediately exit
      * It is unable to recieve any response as the connection has closed
    * Application will print trace after 10 seconds indicating that the request finished and that it thinks it is sending a response
      * Note: this differs from the single connection test in that the request has actually run but cannot communicate with the caller
  * Expected:
    * Application should have printed that a request was received
    * Application should have run the request (waited 10 seconds)
    * Application should have returned a response
    * Telnet should receive a response with a `Connection: close` header value
    * Telnet should report that the connection was closed
    * Application and telnet should exit

# Fix the Problem

* Locate the problem line
  * `cd express-graceful-exit`
  * Open `lib/graceful-exit.js`
  * Find the line `req.connection.setTimeout(1);`
* Comment out the original line
* Replace the line with `res.set('Connection', 'close');`

# Test the Fix

* Start the app
  * Note: Do not use `npm run start` to start the app as this changes signal handling behavior
  * `cd express-graceful-exit-test`
  * `node index.js`
  * Copy the PID
* Send initial request - Leave connection open
  * Note: Use another terminal
  * `telnet localhost 3000`
  * Type: `GET /sleep HTTP/1.1`, press [enter] twice
  * Observe: the connection should remain open after the request is sent
* Send SIGTERM or SIGINT to application
  * Either option works fine for this test
  * `kill -SIGTERM [PID]`
  * Press [Ctrl-C] in the window running `node`
  * Observe:
    * Application will print that SIGINT or SIGTERM was received
    * Application will continue running for up to 60 seconds
* Send second request on initial connection
  * Note: Use the terminal that has telnet already connected from above
  * Type: `GET /sleep HTTP/1.1`, press [enter] twice
  * Observe:
    * Application prints trace that a request was received
    * Application runs the request (waits 10 seconds)
    * Application prints trace that it returned a response
    * Telnet receives a response with a `Connection: close` header value
    * Telnet reports that the connection was closed
    * Application and telnet should exit
* Repeat the test with two connections
  * Observe that the response is correctly received in this case as well

# Conclusion

The `express-graceful-exit` library does a lot of the heavy lifting to setup to be able to gracefully close all connections.  However, setting the timeout on the connection to 1 ms after a request is received causes both the ability to run and finish requests without being able to tell the caller that they succeeded or failed *and* the dropping of received requests without running them.

Gracefully handling shutdown requires processing any last incoming requests and sending their responses, or responding to them, without running them, with an HTTP-level status code indicating that they can be retried (there is, unfortunately, no such code with 429 and 503 and Retry-After response header being the closest matches).

It is a very minor change to `express-graceful-exit` to allow it to correctly handle both scenarios reproduced above.
