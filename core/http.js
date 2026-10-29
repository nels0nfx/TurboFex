// JSON from public web services (weather, dictionary, rates...). Only public addresses, short timeouts.
const safefetch = require('./safefetch');

async function getJson(url, { timeout = 6000, headers = {} } = {}) {
  let res;
  try {
    res = await safefetch.get(url, { timeout, maxBytes: 1024 * 1024, headers: { Accept: 'application/json', ...headers } });
  } catch (err) {
    throw Object.assign(new Error(err.code === 'TIMEOUT' ? 'The service took too long to answer.' : 'The service could not be reached.'), { code: err.code || 'NETWORK' });
  }
  if (res.status === 404) throw Object.assign(new Error('Nothing found.'), { code: 'NOT_FOUND' });
  if (res.status === 429) throw Object.assign(new Error('The service is busy right now. Try again in a minute.'), { code: 'LIMIT' });
  if (res.status >= 400) throw Object.assign(new Error(`The service answered with an error (${res.status}).`), { code: 'SERVICE' });
  try {
    return JSON.parse(res.body.toString('utf8'));
  } catch (err) {
    throw Object.assign(new Error('The service sent an answer I could not read.'), { code: 'PARSE' });
  }
}

module.exports = { getJson };
