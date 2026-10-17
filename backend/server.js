// Starts the HTTP server. The app itself is built in app.js.
const config = require('./config');
const app = require('./app');

// Express 5 hands startup errors (e.g. "port already in use") to this
// callback instead of throwing. Ignoring `err` made a failed start print
// "API on ..." and then exit quietly, so check it and fail loudly.
app.listen(config.port, (err) => {
  if (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use — another API server is probably still running.`);
      console.error('Stop it (or set a different PORT in .env) and start again.');
    } else {
      console.error('Could not start the API server:', err.message);
    }
    process.exit(1);
  }
  console.log(`API on http://localhost:${config.port}`);
});
