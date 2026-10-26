import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import errorMiddleware from '../src/middleware/errorMiddleware.js';

describe('API error logging', () => {
  it('handles database selection errors without logging connection secrets', () => {
    const error = Object.assign(
      new Error('mongodb://user:secret@example.test:27017/remindly'),
      { name: 'MongoServerSelectionError', code: 'ECONNREFUSED' }
    );
    const originalConsoleError = console.error;
    const logs = [];
    let responseBody;
    let responseStatus;
    const response = {
      headersSent: false,
      status(status) {
        responseStatus = status;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      },
    };

    console.error = (...values) => logs.push(values.join(' '));
    try {
      errorMiddleware(error, {}, response, (nextError) => {
        throw nextError;
      });
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(responseStatus, 500);
    assert.equal(responseBody.message, 'An unexpected error occurred.');
    assert.equal(logs.length, 1);
    assert.match(logs[0], /API request failed: MongoServerSelectionError \(code=ECONNREFUSED\)/);
    assert.doesNotMatch(logs[0], /secret|mongodb:\/\//);
  });
});
