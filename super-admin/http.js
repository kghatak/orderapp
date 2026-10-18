export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      res.status(status).json({
        success: false,
        message: err.status ? err.message : 'Request failed',
      });
    });
  };
}

export function sendData(res, data, message, status = 200) {
  res.status(status).json({ success: true, message, data });
}
