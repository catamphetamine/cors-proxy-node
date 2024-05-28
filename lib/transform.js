var streamReplace = require('stream-replace')
var httpProxy = require('./cors-anywhere')

// https://github.com/kaysond/http-proxy-interceptor/blob/master/examples/example-stream-replace.js
module.exports = function httpProxyInterceptorFactory(req, res) {
  var requestLocation = httpProxy.getRequestLocation(req)

  var transforms = requestLocation.searchParams.get('transforms')

  if (transforms) {
    try {
      transforms = JSON.parse(transforms)
      // Validate `transforms`.
      // Ignore any errors so that a single malformed HTTP request doesn't crash the whole proxy for other users.
      if (!Array.isArray(transforms)) {
        transforms = null
      }
    } catch (error) {
      // Ignore any errors so that a single malformed HTTP request doesn't crash the whole proxy for other users.
      transforms = null
    }
  }

  if (transforms) {
    return transforms.filter(_ => _.target === 'content').map((transform) => {
      const NO_OP_SUBSTRING = 'THIS_DUMMY_SUBSTRING_IS_JUST_A_PLACEHOLDER_FOR_NO_OP'
      // `stream-replace` seems to not work in all cases.
			// But I suppose that for smaller replacements it's fine.
      // https://github.com/lxe/stream-replace/issues/4
      // https://github.com/lxe/stream-replace/issues/2
			const searchFor = transform.searchFor || NO_OP_SUBSTRING
			const replaceWith = transform.replaceWith || NO_OP_SUBSTRING
      return streamReplace(transform.regExp ? new RegExp(searchFor, 'g') : searchFor, replaceWith)
    })
  }

  return []
}
