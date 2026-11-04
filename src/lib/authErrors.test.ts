import assert from 'node:assert/strict';
import { AUTH_NETWORK_MESSAGE, isAuthNetworkError, mapAuthError } from './authErrors';

// REACT-NATIVE-N: auth-js's wrapper for a fetch that never reached the server.
assert.equal(isAuthNetworkError({ name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' }), true);
// The same failure seen as a plain object with only status 0 + the RN message.
assert.equal(isAuthNetworkError({ status: 0, message: 'Network request failed' }), true);
// Web's fetch wording.
assert.equal(isAuthNetworkError({ message: 'Failed to fetch' }), true);
// A real server answer is NOT a network error: it must still reach Sentry
// (e.g. "Unacceptable audience in id_token" is a provider config bug).
assert.equal(isAuthNetworkError({ name: 'AuthApiError', status: 400, message: 'Unacceptable audience in id_token' }), false);
assert.equal(isAuthNetworkError(null), false);
assert.equal(isAuthNetworkError('Network request failed'), false);

// Email sign-in and sign-up show friendly copy instead of the raw RN string.
assert.equal(mapAuthError('Network request failed').message, AUTH_NETWORK_MESSAGE);
assert.equal(mapAuthError('TypeError: Failed to fetch').message, AUTH_NETWORK_MESSAGE);
// Existing mappings are untouched.
assert.equal(mapAuthError('Invalid login credentials').message, 'Incorrect email or password.');
assert.equal(mapAuthError('Something else').message, 'Something else');

console.log('authErrors: all assertions passed');
