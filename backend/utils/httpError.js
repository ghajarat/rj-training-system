// Throw one of these from any route and the error handler in app.js turns it
// into a clean JSON response: { error: { code, message } }.
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = HttpError;
