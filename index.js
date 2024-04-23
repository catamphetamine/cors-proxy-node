// var proxy = require('cors-anywhere')
var proxy = require('./lib/cors-anywhere')

module.exports = function(config) {
  // Heroku: Listen on a specific host passed as the `HOST` environment variable.
  var host = process.env.HOST || config.host
  // Heroku: Listen on a specific port passed as the `PORT` environment variable.
  var port = process.env.PORT || config.port

  proxy.createServer({
    originWhitelist: config.allowedRequestOrigins || [],
    useCookies: config.cookies,
    shareCookiesBetweenAllowedRequestOrigins: config.shareCookiesBetweenAllowedRequestOrigins,
    requiredHeadersInRequest: ['origin', 'x-requested-with'] // The HTTP request must come from a web browser.
  }).listen(port, host, function() {
    console.log(
      'CORS proxy is running at http(s)://' + (host === '0.0.0.0' ? '<this-host>' : host) + ':' + port + '\n' + '\n' +
      'Usage example: http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port + '?url=https%3A%2F%2Fgoogle.com'
    )
  })
}
