var streamReplace = require('stream-replace')
var httpProxy = require('./cors-anywhere')

// https://github.com/kaysond/http-proxy-interceptor/blob/master/examples/example-stream-replace.js
module.exports = function httpProxyInterceptorFactory(req, res) {
	var requestLocation = new URL(httpProxy.getFromOriginForHttpRequest(req) + req.originalUrl)

	var transforms = requestLocation.searchParams.get('transforms')

	if (transforms) {
		try {
			transforms = JSON.parse(transforms)
			// Validate `transforms`.
			// Ignore any errors so that a single malformed HTTP request doesn't crash the whole proxy for other users.
			if (!Array.isArray(transforms)) {
				console.error('`transforms` parameter is expected to be an array')
				transforms = null
			}
		} catch (error) {
			console.error('Error while parsing `transforms` parameter:')
			console.error(error)
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
			return streamReplace(
				// If it was just passing the `searchFor` string, it would only replace once,
				// so it creates a "global" `RegExp` here from `searchFor` string.
				new RegExp(transform.regExp ? searchFor : escapeRegExpString(searchFor), 'g'),
				replaceWith
			)
		})
	}

	return []
}

function escapeRegExpString(string) {
	const specials = new RegExp('[.*+?|()\\[\\]{}\\\\]', 'g')
	return string.replace(specials, '\\$&')
}