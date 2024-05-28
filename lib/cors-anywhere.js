// © 2013 - 2016 Rob Wu <rob@robwu.nl>
// Released under the MIT license

'use strict';

var httpProxy = require('http-proxy');
var net = require('net');
const { URL } = require('url');
// const { parse: parseQuery } = require('querystring');
var regexp_tld = require('./regexp-top-level-domain');
var getProxyForUrl = require('proxy-from-env').getProxyForUrl;

function showUsage(headers, response) {
  headers['content-type'] = 'text/plain';
  response.writeHead(200, headers);
  response.end('See `cors-proxy-node` docs: https://github.com/catamphetamine/cors-proxy-node');
}

/**
 * Check whether the specified hostname is valid.
 *
 * @param hostname {string} Host name (excluding port) of requested resource.
 * @return {boolean} Whether the requested resource can be accessed.
 */
function isValidHostName(hostname) {
  return Boolean(
    regexp_tld.test(hostname) ||
    net.isIPv4(hostname) ||
    net.isIPv6(hostname)
  );
}

/**
 * Adds CORS headers to the response headers.
 *
 * @param headers {object} Response headers
 * @param request {ServerRequest}
 */
function setResponseHeaders(headers, request) {
  // if (corsAnywhere.credentials) {
  //   if (corsAnywhere.fromOriginWhitelist.length !== 1) {
  //     throw new Error('Only a single whitelisted origin is allowed when using credentials.')
  //   }
  //   headers['access-control-allow-origin'] = corsAnywhere.fromOriginWhitelist[0]
  //   headers['access-control-allow-credentials'] = true
  // } else {
  //   headers['access-control-allow-origin'] = '*'
  // }
  // headers['access-control-allow-origin'] = '*';
  // Only allow specific origins for security reasons.
  // https://github.com/Rob--W/cors-anywhere/issues/55

  // If cookies are to be forwarded, then access should only be allowed
  // for specific "source" origins, otherwise there'd be a security vulnerability.
  //
  // That's because all cookies for all proxied websites are stored in a user's
  // web browser as if they were set for the proxy server's website.
  // This means that whenever a user forwards an HTTP request to some website
  // using a given CORS proxy server, all cookies for all websites that the user
  // has been visiting through that CORS proxy server will be sent as part of that HTTP request.
  //
  // Effectively, this means that every website will see every other website's cookies
  // for that user. This means that all "source" websites using the CORS proxy server
  // to access some other websites should all trust each other to the point of sharing
  // each other's cookies.
  //
  // That's the reason why all "source" origins should be explicitly whitelisted.
  // Otherwise, if it would allow any website to use the CORS proxy server,
  // a hacker could create a website — https://hacker.com — and the lure people into
  // visiting that website through the CORS proxy server, disclosing any cookies
  // they have set for any other website they've previously visited through that CORS proxy server.
  //
  // I've posted the same description of the issue in `cors-anywhere` github repository:
  // https://github.com/Rob--W/cors-anywhere/issues/55

  var fromOriginWhitelist = request.corsAnywhereRequestState.fromOriginWhitelist;
  var iframe = request.corsAnywhereRequestState.iframe;

  if (request.corsAnywhereRequestState.useCookies) {
    if (fromOriginWhitelist.length === 0) {
      throw new Error('When cookies are enabled, an explict list of allowed source origins has to be set up, and all members of that list should be fine with disclosing their cookies to each other. To do that, set `fromOriginWhitelist` configuration parameter. See the readme for more details.');
    }
    headers['access-control-allow-credentials'] = true;
  }

  if (fromOriginWhitelist.length > 0) {
    headers['access-control-allow-origin'] = getWhitelistedFromOrigin(fromOriginWhitelist, request);
  } else {
    headers['access-control-allow-origin'] = '*';
  }

  var corsMaxAge = request.corsAnywhereRequestState.corsMaxAge;
  if (request.method === 'OPTIONS' && corsMaxAge) {
    headers['access-control-max-age'] = corsMaxAge;
  }

  if (request.headers['access-control-request-method']) {
    headers['access-control-allow-methods'] = request.headers['access-control-request-method'];
    delete request.headers['access-control-request-method'];
  }

  if (request.headers['access-control-request-headers']) {
    headers['access-control-allow-headers'] = request.headers['access-control-request-headers'];
    delete request.headers['access-control-request-headers'];
  }

  headers['access-control-expose-headers'] = Object.keys(headers).join(',');

  if (iframe) {
    // Allow the webpage to be embedded on any website.
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors
    if (request.headers['content-security-policy']) {
      headers['content-security-policy'] = 'frame-ancestors *;';
      delete request.headers['content-security-policy'];
    }
  }
}

function callProxyResponseListener(proxy, proxyReq, proxyRes, req, res, listener) {
  const result = onProxyResponse(proxy, proxyReq, proxyRes, req, res);
  if (result) {
    if (result === true) {
      try {
        listener(proxyRes);
      } catch (error) {
        // Wrap in try-catch because an error could occur:
        // "RangeError: Invalid status code: 0"
        // https://github.com/Rob--W/cors-anywhere/issues/95
        // https://github.com/nodejitsu/node-http-proxy/issues/1080

        // Forward error (will ultimately emit the 'error' event on our proxy object):
        // https://github.com/nodejitsu/node-http-proxy/blob/v1.11.1/lib/http-proxy/passes/web-incoming.js#L134
        proxyReq.emit('error', error);
      }
    } else if (result.redirect) {
      let { statusCode } = result
      for (const key in result.headers) {
        // `set-cookie` header value can be an array,
        // but `.setHeader()` method supports that case.`
        res.setHeader(key, result.headers[key]);
      }
      res.writeHead(statusCode);
      res.end();
    }
  }
}

/**
 * Performs the actual proxy request.
 *
 * @param req {ServerRequest} Incoming http request
 * @param res {ServerResponse} Outgoing (proxied) http request
 * @param proxy {HttpProxy}
 */
function proxyRequest(req, res, proxy) {
  var location = req.corsAnywhereRequestState.location;

  req.url = location.pathname + location.search + location.hash;

  var proxyOptions = {
    changeOrigin: false,
    prependPath: false,
    target: location,
    headers: {
      host: location.host
    },
    // HACK: Get hold of the proxyReq object, because we need it later.
    // https://github.com/nodejitsu/node-http-proxy/blob/v1.11.1/lib/http-proxy/passes/web-incoming.js#L144
    buffer: {
      pipe: function(proxyReq) {
        var proxyReqOn = proxyReq.on;
        // Intercepts the handler that connects proxyRes to res.
        // https://github.com/nodejitsu/node-http-proxy/blob/v1.11.1/lib/http-proxy/passes/web-incoming.js#L146-L158
        proxyReq.on = function(eventName, listener) {
          if (eventName == 'response') {
            return proxyReqOn.call(this, eventName, function(proxyRes) {
              callProxyResponseListener(proxy, proxyReq, proxyRes, req, res, listener)
            });
          } else {
            return proxyReqOn.call(this, eventName, listener);
          }
        };
        return req.pipe(proxyReq);
      }
    }
  };

  var proxyThroughUrl = req.corsAnywhereRequestState.getProxyForUrl(location.href);
  if (proxyThroughUrl) {
    proxyOptions.target = proxyThroughUrl;
    proxyOptions.toProxy = true;
    // If a proxy URL was set, req.url must be an absolute URL. Then the request will not be sent
    // directly to the proxied URL, but through another proxy.
    req.url = location.href;
  }

  // Start proxying the request
  try {
    proxy.web(req, res, proxyOptions);
  } catch (error) {
    proxy.emit('error', error, req, res);
  }
}

/**
 * This method modifies the response headers of the proxied response.
 * If a redirect is detected, the response is not sent to the client,
 * and a new request is initiated.
 *
 * client (req) -> CORS Anywhere -> (proxyReq) -> other server
 * client (res) <- CORS Anywhere <- (proxyRes) <- other server
 *
 * @param proxy {HttpProxy}
 * @param proxyReq {ClientRequest} The outgoing request to the other server.
 * @param proxyRes {ServerResponse} The response from the other server.
 * @param req {IncomingMessage} Incoming HTTP request, augmented with property corsAnywhereRequestState
 * @param req.corsAnywhereRequestState {object}
 * @param req.corsAnywhereRequestState.location {object} See parseURL
 * @param req.corsAnywhereRequestState.getProxyForUrl {function} See proxyRequest
 * @param req.corsAnywhereRequestState.proxyBaseUrl {string} Base URL of the CORS API endpoint
 * @param req.corsAnywhereRequestState.maxRedirects {number} Maximum number of redirects
 * @param req.corsAnywhereRequestState.redirectCount_ {number} Internally used to count redirects
 * @param res {ServerResponse} Outgoing response to the client that wanted to proxy the HTTP request.
 *
 * @returns {boolean} true if http-proxy should continue to pipe proxyRes to res.
 */
function onProxyResponse(proxy, proxyReq, proxyRes, req, res) {
  var requestState = req.corsAnywhereRequestState;

  var statusCode = proxyRes.statusCode;

  const storeResponseHeaders = (headerName, key) => {
    const { headers } = proxyRes;
    if (headers[headerName]) {
      const headerValue = headers[headerName];
      req[key] = (req[key] || []).concat(toArray(headerValue || []));
    }
  };

  if (!requestState.redirectCount_) {
    res.setHeader('x-request-url', requestState.location.href);
  }

  // Handle redirects
  const isRedirect = statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
  const isRedirectThatCanBeProxied = statusCode === 301 || statusCode === 302 || statusCode === 303;
  if (isRedirect) {
    if (req.shouldFollowRedirects) {
      var locationHeader = proxyRes.headers.location;
      if (locationHeader) {
        // "Location" header value is a relative URL.
        // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Location
        // Convert it into an absolute URL.
        locationHeader = new URL(locationHeader, requestState.location.href).href;

        if (isRedirectThatCanBeProxied) {
          // Exclude 307 & 308, because they are rare, and require preserving the method + request body
          requestState.redirectCount_ = requestState.redirectCount_ + 1 || 1;
          if (requestState.redirectCount_ <= requestState.maxRedirects) {
            // Handle redirects within the server, because some clients (e.g. Android Stock Browser)
            // cancel redirects.
            // Set header for debugging purposes. Do not try to parse it!
            res.setHeader('x-redirect-' + requestState.redirectCount_, statusCode + ' ' + locationHeader);

            req.method = 'GET';
            req.headers['content-length'] = '0';
            delete req.headers['content-type'];
            requestState.location = parseURL(locationHeader);

            // Remove all listeners (=reset events to initial state)
            req.removeAllListeners();

            // It will redirect to the "redirect to" URL now,
            // and all response headers will be overwritten, including "set-cookie" ones.
            // For that reason, see if there're any "set-cookie" headers
            // in the current response. If there are, include them
            // in the final response later.
            //
            storeResponseHeaders('set-cookie', 'setCookieHeadersBeforeFinalRedirect')
            // "Set-Cookie2" HTTP header is deprecated as of RFC6265 and should not be used.
            // https://stackoverflow.com/questions/9462180/difference-between-set-cookie2-and-set-cookie
            storeResponseHeaders('set-cookie2', 'setCookie2HeadersBeforeFinalRedirect')

            // Remove the error listener so that the ECONNRESET "error" that
            // may occur after aborting a request does not propagate to res.
            // https://github.com/nodejitsu/node-http-proxy/blob/v1.11.1/lib/http-proxy/passes/web-incoming.js#L134
            proxyReq.removeAllListeners('error');
            proxyReq.once('error', function catchAndIgnoreError() {});
            proxyReq.abort();

            // Initiate a new proxy request.
            proxyRequest(req, res, proxy);
            return false;
          }
        }

        // Overwrite the "Location" header value.
        // Example: "/path" → "https://proxy.com/https://website.com/path".
        proxyRes.headers.location = requestState.proxyBaseUrl + '/' + locationHeader;
      }
    }
  }

  // Adds headers to the proxied response.
  const addResponseHeaders = (headerName, headerValues) => {
    proxyRes.headers[headerName] = toArray(proxyRes.headers[headerName] || []).concat(headerValues);
  };

  // Add `Set-Cookie` headers from previous responses in the redirection chain.
  if (req.canUseNativeCookies) {
    if (req['setCookieHeadersBeforeFinalRedirect']) {
      addResponseHeaders('set-cookie', req['setCookieHeadersBeforeFinalRedirect']);
    }
    // "Set-Cookie2" HTTP header is deprecated as of RFC6265 and should not be used.
    // https://stackoverflow.com/questions/9462180/difference-between-set-cookie2-and-set-cookie
    if (req['setCookie2HeadersBeforeFinalRedirect']) {
      addResponseHeaders('set-cookie2', req['setCookie2HeadersBeforeFinalRedirect']);
    }
  }

  const setCookieHeadersPrev = req['setCookieHeadersBeforeFinalRedirect'];
  const setCookieHeadersLatest = toArray(proxyRes.headers['set-cookie'] || []);
  const setCookieHeaders = (setCookieHeadersPrev || setCookieHeadersLatest) && (setCookieHeadersPrev || []).concat(setCookieHeadersLatest || []);

  // "Set-Cookie2" HTTP header is deprecated as of RFC6265 and should not be used.
  // https://stackoverflow.com/questions/9462180/difference-between-set-cookie2-and-set-cookie
  // const setCookie2HeadersPrev = req['setCookie2HeadersBeforeFinalRedirect'];
  // const setCookie2HeadersLatest = toArray(proxyRes.headers['set-cookie2'] || []);
  // const setCookie2Headers = (setCookie2HeadersPrev || setCookie2HeadersLatest) && (setCookie2HeadersPrev || []).concat(setCookie2HeadersLatest || []);

  // Rewrites `SameSite` setting of any `Set-Cookie` headers to be `SameSite=None`.
  // The reason is that, for example, if `SameSite` wasn't specified at all by the server
  // when it was setting those cookies, Chrome would assign the default value of `SameSite=Lax`
  // meaning that those new cookies wouldn't be sent when sending HTTP requests from other websites
  // which is obviously the case when people start using a CORS proxy.
  //
  const setSameSiteNone = (setCookieHeaderName) => {
    const setSameSiteNoneInHeaderValue = (value) => {
      if (/; SameSite=/.test(value)) {
        return value.replace(/; SameSite=([^;]*)/, '; SameSite=None');
      } else {
        return value + '; SameSite=None';
      }
    }
    // const addHttpOnlyToHeaderValue = (value) => {
    //   if (/; HttpOnly$/.test(value) || /; HttpOnly;/.test(value)) {
    //     return value;
    //   } else {
    //     return value + '; HttpOnly';
    //   }
    // }
    // `Secure` is required to be set when setting `SameSite: None`.
    const addSecureToHeaderValue = (value) => {
      if (/; Secure$/.test(value) || /; Secure;/.test(value)) {
        return value;
      } else {
        return value + '; Secure';
      }
    }
    // const removeSecureFromHeaderValue = (value) => {
    //   if (/; Secure$/.test(value)) {
    //     return value.replace(/; Secure$/, '');
    //   } else {
    //     if (/; Secure;/.test(value)) {
    //       return value.replace(/; Secure;/, ';');
    //     } else {
    //       return value;
    //     }
    //   }
    // }
    const modifyHeaderValue = (value) => {
      return addSecureToHeaderValue(setSameSiteNoneInHeaderValue(value));
    }
    if (proxyRes.headers[setCookieHeaderName]) {
      if (Array.isArray(proxyRes.headers[setCookieHeaderName])) {
        proxyRes.headers[setCookieHeaderName] = proxyRes.headers[setCookieHeaderName].map(modifyHeaderValue);
      } else {
        proxyRes.headers[setCookieHeaderName] = modifyHeaderValue(proxyRes.headers[setCookieHeaderName]);
      }
    }
  }

  /*
  if (...) {
    if (req.headers['x-set-cookie-same-site-none'] === 'true') {
      setSameSiteNone('set-cookie')
      // "Set-Cookie2" HTTP header is deprecated as of RFC6265 and should not be used.
      // https://stackoverflow.com/questions/9462180/difference-between-set-cookie2-and-set-cookie
      setSameSiteNone('set-cookie2')
    }
  }
  */

  // if (...) {
  //   if (req.headers['x-set-cookie-httponly'] === 'true') {
  //     ... value = addHttpOnlyToHeaderValue(value) ...
  //   }
  // }

  // `Set-Cookie` headers can't be read from `fetch()` response in a web browser:
  //
  // https://developer.mozilla.org/en-US/docs/Web/API/Headers/getSetCookie
  //
  // "Browsers block frontend JavaScript code from accessing the Set-Cookie header,
  //  as required by the Fetch spec, which defines Set-Cookie as a forbidden response
  //  header name that must be filtered out from any response exposed to frontend code."
  //
  // The workaround was simple: just put the values of `Set-Cookie` headers
  // to some other header when sending the response.
  //
  // Setting `x-set-cookies` header to `true`
  // instructs `cors-proxy-node` to put the values of `Set-Cookie` headers
  // to `x-set-cookies` header.
  //
  if (req.headers['x-set-cookies'] === 'true') {
    if (setCookieHeaders && setCookieHeaders.length > 0) {
      proxyRes.headers['x-set-cookies'] = JSON.stringify(setCookieHeaders);
    }
  }

  // Strip cookies when the origin is not whitelisted.
  if (!req.canUseNativeCookies) {
    delete proxyRes.headers['set-cookie'];
    // "Set-Cookie2" HTTP header is deprecated as of RFC6265 and should not be used.
    // https://stackoverflow.com/questions/9462180/difference-between-set-cookie2-and-set-cookie
    delete proxyRes.headers['set-cookie2'];
  }

  // // Add `x-cookie` header that could be used to debug
  // // the actual cookies being sent to the server.
  // if (req.canUseNativeCookies) {
  //   if (req.headers['cookie']) {
  //     proxyRes.headers['x-cookie'] = req.headers['cookie'];
  //   }
  // }

  proxyRes.headers['x-final-url'] = requestState.location.href;

  if (isRedirect && !req.shouldFollowRedirects) {
    if (req.headers['x-redirect-status']) {
      const newStatusCode = Number(req.headers['x-redirect-status']);
      if (!isNaN(newStatusCode)) {
        proxyRes.headers['x-redirect-status'] = String(statusCode);
        statusCode = newStatusCode;
      }
    }
  }

  setResponseHeaders(proxyRes.headers, req);

  if (isRedirect && !req.shouldFollowRedirects) {
    return {
      redirect: true,
      statusCode,
      headers: proxyRes.headers
    };
  }

  return true;
}


/**
 * @param url {string} The requested URL
 * @return {object} Parsed URL
 */
function parseURL(url) {
  // url = new URL(url);
  // // // Parse the URL query. The leading '?' has to be removed before this.
  // // const query = parseQuery(url.search.slice(1));
  // const query = url.searchParams
  // return {
  //   protocol: url.protocol,
  //   origin: url.origin,
  //   host: url.host,
  //   port: url.port,
  //   hostname: url.hostname,
  //   pathname: url.pathname,
  //   search: url.search,
  //   hash: url.hash,
  //   href: url.href,
  //   query
  // };
  return new URL(url);
}

// Creates an instance of `http-proxy`.
function createProxy(options) {
  // Default options:
  var httpProxyOptions = {
    xfwd: true            // Append X-Forwarded-* headers
  };

  // Allow user to override defaults and add own options
  if (options) {
    Object.keys(options).forEach(function(option) {
      httpProxyOptions[option] = options[option];
    });
  }

  var proxy = httpProxy.createServer(httpProxyOptions);

  // When the server fails, just show a 404 instead of Internal server error
  proxy.on('error', function(error, req, res) {
    if (res.headersSent) {
      // This could happen when a protocol error occurs when an error occurs
      // after the headers have been received (and forwarded). Do not write
      // the headers because it would generate an error.
      return;
    }

    // When the error occurs after setting headers but before writing the response,
    // then any previously set headers must be removed.
    var headerNames = res.getHeaderNames ? res.getHeaderNames() : Object.keys(res._headers || {});
    headerNames.forEach(function(name) {
      res.removeHeader(name);
    });

    res.writeHead(404, {'Access-Control-Allow-Origin': '*'});
    res.end('Not found because of proxy error: ' + error);
  });

  return proxy;
}

exports.createProxy = createProxy;

// Creates a "handler" function: a function of arguments: `req`, `res`.
// A "handler" function could be passed to:
// * `connect`'s `.use(handler)`
// * Node.js's `require('http').createServer(handler)` or `require('https').createServer(httpsOptions, requestHandler)`.
exports.createHandler = function createHandler(options) {
  // Create an instance of `http-proxy`.
  var proxy = createProxy(options && options.httpProxyOptions)

  // If `useCookies` option is set to `true`, then check that
  // `shareCookiesBetweenOriginsInFromOriginWhitelist` option is also `true`.
  if (options.useCookies) {
    if (!options.shareCookiesBetweenOriginsInFromOriginWhitelist) {
      throw new Error('When cookies are enabled, and an explict list of allowed source origins is set up, all members of that list should be fine with disclosing their cookies to each other. To opt into that, set `shareCookiesBetweenOriginsInFromOriginWhitelist` configuration parameter to `true`. See the readme for more details.');
    }
  }

  var corsAnywhere = {
    getProxyForUrl: getProxyForUrl, // Function that specifies the proxy to use
    maxRedirects: 5,                // Maximum number of redirects to be followed.
    fromOriginBlacklist: [],        // Requests from these origins will be blocked.
    fromOriginWhitelist: [],        // If non-empty, requests not from an origin in this list will be blocked.
    toOriginWhitelist: [],          // If non-empty, requests to this origin will be allowed regardless of `fromOriginWhitelist`.
    checkRateLimit: null,           // Function that may enforce a rate-limit by returning a non-empty string.
    redirectSameOrigin: false,      // Redirect the client to the requested URL for same-origin requests.
    requireHeader: null,            // Require a header to be set?
    removeHeaders: [],              // Strip these request headers.
    setHeaders: {},                 // Set these request headers.
    corsMaxAge: 0,                  // If set, an Access-Control-Max-Age header with this value (in seconds) will be added.
    useCookies: false
  };

  Object.keys(options).forEach(function(key) {
    if (
      options[key] !== undefined &&
      options[key] !== null
    ) {
      corsAnywhere[key] = options[key];
    }
  });

  if (corsAnywhere.requiredHeadersInRequest) {
    corsAnywhere.requiredHeadersInRequest = corsAnywhere.requiredHeadersInRequest.map(function(headerName) {
      return headerName.toLowerCase();
    });
  }

  var getMissingRequiredHeadersInRequest = function(headers) {
    if (!corsAnywhere.requiredHeadersInRequest) {
      return [];
    }
    return corsAnywhere.requiredHeadersInRequest.some(function(headerName) {
      return Object.hasOwnProperty.call(headers, headerName);
    });
  };

  var latestRequests = [];
  var MAX_LATEST_REQUESTS = 5000;

  return function(req, res) {
    // "Host" HTTP header is always present.
    // "Origin" HTTP header might not be present.
    var requestLocation = getRequestLocation(req)

    var targetUrl = requestLocation.searchParams.get('url') || requestLocation.pathname.slice(1) + requestLocation.search + requestLocation.hash;
    var iframe = requestLocation.searchParams.get('url') ? requestLocation.searchParams.get('iframe') : undefined;

    req.corsAnywhereRequestState = {
      useCookies: corsAnywhere.useCookies,
      fromOriginWhitelist: corsAnywhere.fromOriginWhitelist,
      iframe,
      getProxyForUrl: corsAnywhere.getProxyForUrl,
      maxRedirects: corsAnywhere.maxRedirects,
      corsMaxAge: corsAnywhere.corsMaxAge,
    };

    var cors_headers = {};
    setResponseHeaders(cors_headers, req);

    // Responds to an `OPTIONS` "preflight" request.
    if (req.method === 'OPTIONS') {
      // Pre-flight request. Reply successfully:
      res.writeHead(200, cors_headers);
      res.end();
      return;
    }

    // Serves stats page under "/stats" URL.
    if (req.url === '/stats') {
      res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end(randomizeIps(latestRequests).map(({ time, ip, location }) => {
        return `${formatDate(new Date(time))} · ${ip} · ${location.host}${location.pathname}`
      }).join('\n'));
      return;
    }

    // If no "url" query parameter was passed, and no proxied URL is present in the "pathname",
    // then show the usage instructions.
    if (!targetUrl) {
      // Invalid API call. Show how to correctly use the API
      showUsage(cors_headers, res);
      return;
    }

    // Target `location`.
    var location;

    // Parse target URL into a `location` object.
    try {
      location = parseURL(targetUrl);
    } catch (error) {
      // Invalid URL provided.
      res.writeHead(404, 'Invalid URL', cors_headers);
      res.end('Invalid URL: ' + targetUrl);
      return;
    }

    // Validate port number.
    if (location.port > 65535) {
      // Port is higher than 65535
      res.writeHead(400, 'Invalid port', cors_headers);
      res.end('Port number too large: ' + location.port);
      return;
    }

    // Only allows proxying "http://" and "https://" protocols.
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      res.writeHead(404, 'Invalid protocol', cors_headers);
      res.end('Invalid protocol: ' + location.protocol);
      return;
    }

    // Validate "hostname".
    if (!isValidHostName(location.hostname)) {
      res.writeHead(404, 'Invalid host', cors_headers);
      res.end('Invalid host: ' + location.hostname);
      return;
    }

    // Check if all required HTTP headers are present in the request.
    if (getMissingRequiredHeadersInRequest(req.headers).length > 0) {
      res.writeHead(400, 'Headers required', cors_headers);
      res.end('Missing required request headers: ' + getMissingRequiredHeadersInRequest(req.headers).join(', '));
      return;
    }

    // Get the "origin" of the incoming HTTP request.
    // Example: "https://proxy.com".
    //
    // "Origin" header might not be present.
    // "Host" header is always present.
    //
    var fromOrigin = getFromOriginForHttpRequest(req);
    var toOrigin = location.origin;

    // Check if the "origin" is blacklisted.
    if (corsAnywhere.fromOriginBlacklist.indexOf(fromOrigin) >= 0) {
      res.writeHead(403, 'Forbidden', cors_headers);
      res.end('"From" origin "' + fromOrigin + '" was blacklisted by the operator of this proxy.');
      return;
    }

    // Check if the from "origin" is whitelisted.
    if (corsAnywhere.fromOriginWhitelist.indexOf(fromOrigin) < 0) {
      if (corsAnywhere.toOriginWhitelist.indexOf(toOrigin) < 0) {
        res.writeHead(403, 'Forbidden', cors_headers);
        res.end('"From" origin "' + fromOrigin + '" was not whitelisted by the operator of this proxy.');
        return;
      }
    }

    // Check if the rate limit has been exceeded for this "origin".
    var rateLimitMessage = corsAnywhere.checkRateLimit && corsAnywhere.checkRateLimit(fromOrigin);
    if (rateLimitMessage) {
      res.writeHead(429, 'Too Many Requests', cors_headers);
      res.end('"From" origin "' + fromOrigin + '" has sent too many requests.\n' + rateLimitMessage);
      return;
    }

    // If a request for proxying an HTTP request is made for the same "origin",
    // then consider that an incorrect usage scenario.
    // Example: "https://proxy.com/https://proxy.com/path".
    if (
        corsAnywhere.redirectSameOrigin &&
        fromOrigin &&
        location.href[fromOrigin.length] === '/' &&
        location.href.lastIndexOf(fromOrigin, 0) === 0
      ) {
      // Send a permanent redirect to offload the server. Badly coded clients should not waste our resources.
      cors_headers.vary = 'origin';
      cors_headers['cache-control'] = 'private';
      cors_headers.location = location.href;
      res.writeHead(301, 'Please use a direct request', cors_headers);
      res.end();
      return;
    }

    if (latestRequests.length === MAX_LATEST_REQUESTS) {
      latestRequests.shift()
    }

    latestRequests.push({
      // IP addresses could be hashed, but that wouldn't actually hide them,
      // because a potential attacker could hash all possible IPs
      // with the same hashing algorithm and then simply compare to identify them.
      // Therefore, IP addresses are simply randomized on each render.
      ip: req.connection.remoteAddress,
      time: Date.now(),
      location
    })

    var proxyBaseUrl = (isRequestedOverHttps(req) ? 'https://' : 'http://') + req.headers.host;

    req.canUseNativeCookies = corsAnywhere.fromOriginWhitelist.indexOf(fromOrigin) >= 0;
    req.shouldFollowRedirects = req.headers['x-follow-redirect'] !== 'false';

    // Only allows forwarding cookies when the HTTP request
    // comes from an explicitly whitelisted HTTP origin.
    if (!req.canUseNativeCookies) {
      // "Cookie2" HTTP header is deprecated.
      // https://www.geeksforgeeks.org/http-headers-cookie2/
      ['cookie', 'cookie2'].forEach(function(header) {
        delete req.headers[header];
      });
    }

    // Optionally remove any unwanted HTTP headers.
    corsAnywhere.removeHeaders.forEach(function(header) {
      delete req.headers[header];
    });

    // Optionally set any additional HTTP headers.
    Object.keys(corsAnywhere.setHeaders).forEach(function(header) {
      req.headers[header] = corsAnywhere.setHeaders[header];
    });

    // If `x-cookie` request header is specified,
    // it replaces the `cookie` request header value.
    if (req.headers['x-cookie']) {
      // if (req.headers['cookie']) {
      //   req.headers['cookie'] = req.headers['cookie'] + '; ' + req.headers['x-cookie'];
      // } else {
      req.headers['cookie'] = req.headers['x-cookie'];
      // }
    }

    req.corsAnywhereRequestState.location = location;
    req.corsAnywhereRequestState.proxyBaseUrl = proxyBaseUrl;

    proxyRequest(req, res, proxy);
  };
}

// Returns a `location` object for a `req` HTTP request.
function getRequestLocation(req) {
  return parseURL(getFromOriginForHttpRequest(req) + req.url);
}

exports.getRequestLocation = getRequestLocation;

// http://jsfiddle.net/a_incarnati/kqo10jLb/4/
function formatDate(date) {
  var hours = date.getHours();
  var minutes = date.getMinutes();
  return getTwoCharacterNumber(date.getDate()) + '.' +
    getTwoCharacterNumber(date.getMonth() + 1) + '.' +
    date.getFullYear() + ' ' +
    getTwoCharacterNumber(hours) + ':' +
    getTwoCharacterNumber(minutes);
}

function getTwoCharacterNumber(number) {
  if (number < 10) {
    return '0' + number
  }
  return number
}

function randomizeIps(requests) {
  var IPS = {}
  return requests.map((request) => ({
    ...request,
    ip: IPS[request.ip] || (IPS[request.ip] = getNewCharacter(IPS))
  }))
}

// https://www.w3schools.com/charsets/ref_html_utf8.asp
var MIN_CHAR_CODE = 8352
function getNewCharacter(characters) {
  return String.fromCharCode(MIN_CHAR_CODE + Object.keys(characters).length)
  // var latest = MIN_CHAR_CODE
  // for (var key of Object.keys(characters)) {
  //   if (key >= latest.charCodeAt(0)) {
  //     latest++
  //   }
  // }
  // return String.fromCharCode(latest)
}

function isRequestedOverHttps(req) {
  // https://stackoverflow.com/questions/10348906/how-to-know-if-a-request-is-http-or-https-in-node-js
  return req.connection.encrypted || /^\s*https/.test(req.headers['x-forwarded-proto']);
}

function getFromOriginForHttpRequest(req) {
  // Get the "origin" of the incoming HTTP request.
  // Example: "https://proxy.com".
  //
  // "Origin" header might not be present.
  // "Host" header is always present.
  //
  return req.headers.origin || `http${isRequestedOverHttps(req) ? 's' : ''}://${req.headers.host}`;
}

function getWhitelistedFromOrigin(fromOriginWhitelist, request) {
  var actualOrigin = getFromOriginForHttpRequest(request);
  if (fromOriginWhitelist.indexOf(actualOrigin) >= 0) {
    return actualOrigin;
  }
  return fromOriginWhitelist[0];
}

function toArray(value) {
  if (value === undefined || value === null) {
    return value
  }
  return Array.isArray(value) ? value : [value];
}