// CloudFront Function (viewer request, runtime cloudfront-js-2.0): what Vercel does for a static export, read off
// homecookd.app on Oct 31 (docs/build/WEB-MIGRATION.md). Plain ES5, because that's the runtime's guaranteed subset: no
// imports, timers, network or env. A function can't answer 404 itself and still get the error page, so a path that
// must be missing goes to a key that never exists, and S3's 404 brings the error page with it.
var MISSING = '/__not-a-page__';

function queryString(params) {
  var parts = [];
  Object.keys(params).forEach(function (key) {
    var entry = params[key];
    (entry.multiValue || [entry]).forEach(function (one) {
      parts.push(one.value === '' ? key : key + '=' + one.value);
    });
  });
  return parts.join('&');
}

function redirect(path, params) {
  var query = queryString(params);
  return {
    statusCode: 308,
    statusDescription: 'Permanent Redirect',
    headers: {
      location: { value: path.replace(/\\/g, '%5C') + (query ? '?' + query : '') },
      'cache-control': { value: 'public, max-age=0, must-revalidate' },
      'content-type': { value: 'text/plain' },
    },
  };
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === '/') {
    request.uri = '/index.html';
    return request;
  }

  // Collapsing first also means //example.com/ can never become a redirect to another site.
  if (uri.indexOf('//') !== -1) return redirect(uri.replace(/\/+/g, '/'), request.querystring);
  if (uri.slice(-1) === '/') return redirect(uri.slice(0, -1), request.querystring);

  // Exact files with no extension: the app's universal links depend on these staying untouched.
  if (uri.indexOf('/.well-known/') === 0) return request;

  var last = uri.slice(uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') !== -1) {
    // A page is only reachable by its clean URL. /r.html is a 404 on Vercel too.
    if (/\.html$/.test(last)) request.uri = MISSING;
    return request;
  }

  request.uri = uri === '/404' ? MISSING : uri + '.html';
  return request;
}
