var http = require('http')
// var https = require('https')
var connect = require('connect')
var httpProxy = require('./lib/cors-anywhere')
var httpProxyInterceptor = require('http-proxy-interceptor')
var httpProxyInterceptorFactory = require('./lib/transform')

module.exports = function(config) {
  var proxyHandler = httpProxy.createHandler({
    fromOriginWhitelist: config.fromOriginWhitelist || [],
    toOriginWhitelist: config.toOriginWhitelist || [],
    useCookies: config.cookies,
    shareCookiesBetweenOriginsInFromOriginWhitelist: config.shareCookiesBetweenOriginsInFromOriginWhitelist,
    requiredHeadersInRequest: ['origin', 'x-requested-with'] // The HTTP request must come from a web browser.
  })

  // Heroku: Listen on a specific host passed as the `HOST` environment variable.
  var host = process.env.HOST || config.host
  // Heroku: Listen on a specific port passed as the `PORT` environment variable.
  var port = process.env.PORT || config.port

  var app = connect()
  app.use(httpProxyInterceptor(httpProxyInterceptorFactory))
  app.use(proxyHandler)
  http.createServer(app).listen(port, host, function() {
    console.log(
      'CORS proxy is running at http(s)://' + (host === '0.0.0.0' ? '<this-host>' : host) + ':' + port + '\n' + '\n' +
      'Usage example: http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port + '?url=https%3A%2F%2Fgoogle.com'
    )
  })
}
