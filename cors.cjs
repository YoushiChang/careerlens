const GITHUB_PAGES_ORIGIN = 'https://youshichang.github.io';

function queryHeaders(requestUrl, origin) {
  const ownOrigin = new URL(requestUrl).origin;
  if (origin && origin !== ownOrigin && origin !== GITHUB_PAGES_ORIGIN) return null;
  const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}
module.exports = { queryHeaders, GITHUB_PAGES_ORIGIN };
