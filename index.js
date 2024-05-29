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

  // `transforms` don't seem to work. Passing `transforms` when requesting a CloudFlare CAPTCHA page
  // somehow "breaks" it for some weird reason. For example, this URL outputs a normal CloudFlare page:
  // http://localhost:8080/?url=https%3A%2F%2Fsys.4chan.org%2Fcaptcha%3Fboard%3Db%26thread_id%3D919075007%26framed%3D1
  // However, appending a "dummy" "no op" transform to it results in it outputting "Access to localhost was denied" in Chrome:
  // &transforms=%5B%7B%22target%22%3A%22content%22%2C%22searchFor%22%3A%22c%22%2C%22replaceWith%22%3A%22c%22%7D%5D
  // The bug is weird so I disabled `transforms` at all.
  // app.use(httpProxyInterceptor(httpProxyInterceptorFactory))

  app.use(proxyHandler)

  http.createServer(app).listen(port, host, function() {
    console.log(
      'CORS proxy is running at http(s)://' + (host === '0.0.0.0' ? '<this-host>' : host) + ':' + port + '\n' + '\n' +
      'Usage example: http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port + '?url=https%3A%2F%2Fgoogle.com'
    )
  })
}
