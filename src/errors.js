// Errors the API client throws, so screens can tell "no connection" from "the server said no".

/** No connection, or the backend couldn't be reached. Nothing was saved. */
export class OfflineError extends Error {
  constructor(message = "You're offline.") {
    super(message);
    this.name = 'OfflineError';
  }
}

/** The backend answered with an error. message is written for the user. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
