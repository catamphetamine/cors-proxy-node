# CORS Proxy

This is a simple CORS proxy that was originally developed for [anychan](https://gitlab.com/catamphetamine/anychan) web application.

Based on [`cors-anywhere`](https://github.com/Rob--W/cors-anywhere) with some changes.

## Use

Create a new folder. Go into it. Initialize a new Node.js project in it:

```
npm init
```

Call your project any name. Answer the questions it asks.

After it finishes setting up the project, install `cors-proxy-node` dependency:

```
npm install cors-proxy-node --save
```

Create a new file `index.js`:

```js
import corsProxy from 'cors-proxy-node'

corsProxy({
  host: '0.0.0.0',
  port: 8080
})
```

In `package.json`, add a new `script` called `start`:

```js
"scripts": {
  "start": "node index.js"
}
```

Start the proxy using the command:

```
npm start
```

To proxy a URL through the CORS proxy, one could send an HTTP request to:

* `/<url>`
* `/?url=<encodeURIComponent(url)>`

For example, if `host` is set to `"0.0.0.0"` and `port` is set to `8080`, then to proxy `https://google.com` URL through the CORS proxy, one could send an HTTP request to:

* `http://my-cors-proxy.com:8080/https://google.com`
* `http://my-cors-proxy.com:8080/?url=https%3A%2F%2Fgoogle.com`

## Configuration

Configuration is very simple and should be specified in `config.json` file.

* `host: string` — The hostname to listen on. The simplest value that always works is [`"0.0.0.0"`](https://www.howtogeek.com/225487/what-is-the-difference-between-127.0.0.1-and-0.0.0.0/) which means "listen on all possible host names for this host". This parameter is ignored when `HOST` environment variable is set.

* `port: number` — The port to listen on. Example: `8080`. This parameter is ignored when `PORT` environment variable is set.

* `fromOriginWhitelist?: string[]` — An explicit "whitelist" of allowed HTTP origins to accept proxy requests from. If this configuration parameter is specified then only those HTTP origins will be allowed to send HTTP requests to this proxy server. Otherwise, all incoming HTTP requests are allowed, regardless of the HTTP origin they came from.

* `toOriginWhitelist?: string[]` — An explicit "whitelist" of allowed HTTP origins to accept proxy requests towards. If this configuration parameter is specified then any incoming HTTP requests towards those destination origins are allowed, regardless of the `fromOriginWhitelist` setting.

* `cookies?: boolean` — Set to `true` to enable cookies. Cookies are disabled by default. Enabling cookies requires setting both `fromOriginWhitelist` and `shareCookiesBetweenOriginsInFromOriginWhitelist` parameters. Enabling cookies is required when calling [`fetch()`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) with `credentials: "include"` parameter.

* `shareCookiesBetweenOriginsInFromOriginWhitelist?: boolean` — An explicit "opt-in" flag that is required to be set to `true` when enabling cookies. The only purpose of this flag is to make it explicit that, when enabled, cookies are shared between all originas in `fromOriginWhitelist` because not everyone realizes that. I myself didn't realize it.

<!--
## Cookies

In order to enable cookies, one would also have to specify an explicit "whitelist" of allowed HTTP request origins. The reason why cookies can't just be enabled for any HTTP request origin is that due to the inherent limitations of CORS proxying, all cookies are shared between all HTTP request origins because from the user's web browser's point of view, all of them are just the same CORS proxy website all the time, because what CORS proxy does is it tricks the web browser into thinking that it always communicates with the permissive CORS proxy website rather than the non-permissive target website.

To see how allowing any HTTP request origin would be a security vulnerability in this case, consider a hacker luring people into visiting their `https://hacker.com` website via the CORS proxy by providing a "phishing" link `https://proxy.com/https://hacker.com/steal-cookies` somewhere for an unsuspecting casual user to click it, resulting in stealing all their cookies for all other websites that the user has been visiting through `https://proxy.com` because their web browser would've associated all those cookies to the same `https://proxy.com` website.

For that reason, enabling `cookies: true` flag also requires setting up `fromOriginWhitelist` and also explicitly enabling the `shareCookiesBetweenOriginsInFromOriginWhitelist: true` flag.
-->

### Request Headers

#### `x-cookie`

Web browsers [don't allow](https://developer.mozilla.org/en-US/docs/Web/API/Headers/getSetCookie) client-side javascript code to set the value of the `cookie` header of an HTTP request. To work around that, there's an `x-cookie` header: if specified, the contents of `x-cookie` request header will be appended to the `cookie` request header using `"; "` as a separator. This is a way to add any additional cookies to a proxied HTTP request.

#### `x-set-cookies`

Web browsers [don't expose](https://developer.mozilla.org/en-US/docs/Web/API/Headers/getSetCookie) `set-cookie` headers of an HTTP response to client-side javascript code. To work around that limitation and see what cookies exactly have been set by the server, one could pass an HTTP request header called `x-set-cookies` with value `true`. In that case, the HTTP response is gonna contain a header called `x-set-cookies` whose value is gonna be a stringified JSON array of all `set-cookies` headers' values, if there were any in the server's response.

Trivia: There can be several `set-cookie` headers in a given HTTP response: one for each cookie. That's how it's defined in the HTTP specification.

#### `x-redirect-status`

When specified, replaces status `30x` in HTTP response with the value of this header. This allows to bypass the weird behavior of the [`fetch()`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) function: otherwise, when it receives HTTP response status `302` in CORS mode, it doesn't allow the application to look into the response details and instead sets `response.status` to `0` and `response.headers` to empty headers. [Issue](https://github.com/denoland/deno/issues/4389). Replacing response status `302` with something else like `200` allows a developer to bypass that weird behavior and examine the status and headers of the response.

#### `x-follow-redirect`

Redirects are automatically followed unless the request header `x-follow-redirect` is explicitly set to `false`.

When automatically "following" a chain of redirects, it must concatenate all `set-cookie` response headers in the chain and output the result in `set-cookie` header of the final response.

### Respose Headers

<!--
#### `x-cookie`

The value of the `x-cookie` response header is gonna be the value of the `cookie` request header. So it could be used to debug exactly what cookies have been sent to the target URL.
-->

<!--
#### `x-cookies-enabled`

To check if cookies have been enabled, see the value of an HTTP response header called `x-cookies-enabled`: it's gonna be either `"true"` or `"false"`.
-->

<!--
### `SameSite=None`

If a website receives cookies from `https://proxy.com`, the web browser is gonna send those cookies only to `https://proxy.com` in subsequent HTTP requests. To lift that restriction, cookies could be configured with `SameSize=None` policy. To do that, pass `x-set-cookie-same-site-none` response header with value `"true"`.
-->

#### `x-set-cookies`

See the description of the `x-set-cookies` request header.

#### `x-redirect-status`

When passing `x-redirect-status` header in request to override a redirect status, in case of a redirect, it will add an `x-redirect-status` header in response with the value of the original response status (before the override).

#### `x-redirect-n`

For debugging purposes, each followed redirect results in the addition of an `x-redirect-n` response header, where `n` starts at `1`. The value of each such header is comprised of the redirect status code and the redirect URL separated by a whitespace.

After 5 redirects, redirects are not followed any more. The redirect response is sent back to the browser, which can choose to follow the redirect (handled automatically by the browser).

#### `x-request-url`

The requested URL.

#### `x-final-url`

The final URL, after following all redirects.

## Hosting

### An example of setting up a free CORS proxy at Vercel

[Original article](https://geshan.com.np/blog/2021/01/free-nodejs-hosting/)

* Create a repo on GitLab or GitHub with the contents of the proxy folder.
* Create `vercel.json` file in the repo. It sets up Vercel hosting for the repo:

```js
{
  "version": 2,
  "name": "nodejs-mysql",
  "builds": [
    { "src": "index.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "/index.js" }
  ]
}
```

* Push the changes to the repo.
* Login to [Vercel](https://vercel.com/) using your GitLab or GitHub account.
* Click "Add New" → "Project".
* Choose "GitLab" or "GitHub".
* Find the repo in the list and click the "Import" button next it.
* After the project has been deployed, it will show the website URL for it. Use it as a proxy server URL. Example: `https://my-cors-proxy.vercel.app?url={urlEncoded}`.

<!-- To debug possible errors, one could view the console logs by going to the "Logs" tab of the project in Vercel. -->

## Restrictions

To prevent the use of the proxy for casual browsing, the proxy requires one of the following request headers to be present:
* `origin`
* `x-requested-with`

## Stats

There's a basic "stats" page available at `/stats` URL. It displays a list of the most recent requests to the proxy: date, time, user subnet's IP address hash (in a form of a single unicode character) and the proxied URL.

When running in a containerized environment like Vercel, the proxy instance might be stopped when it doesn't receive incoming HTTP requests and then started again when an incoming HTTP request arrives. Any stats will be naturally cleared during such restart.

<!-- Commented out `<iframe/>` support because it won't really work without replacing relative URLs with absolute ones. -->

<!--
## `<iframe/>`

When proxying an `<iframe/>` contents, use the `url` query parameter apprach and also set `iframe` query parameter to a non-empty value:

`http://my-cors-proxy.com:8080/?url=https%3A%2F%2Fgoogle.com&iframe=✓`

This also requires adding the Proxy domain itself to `fromOriginWhitelist` configuration parameter. The reason is that when loading an `<iframe/>`, web browser will set `Origin` HTTP request header value to be the "origin" part of the URL specified in the `src` attribute of the `<iframe/>` which is a proxied URL, so the domain of it will be the Proxy domain.

An additional optional URL query parameter that can be specified in this case is `transforms`: an optional list of "transformations" that would be applied to the received HTML response content. When provided, the value should be a result of calling `JSON.stringify()` on a list of `transform` objects having shape:

```js
{
  target: "content",
  regExp?: boolean, // set to `true` to indicate that `searchFor` is a regular expression string.
  searchFor: string,
  replaceWith: string
}
```

Example for proxying CloudFlare CAPTCHA page:

```js
[
  {
    target: "content",
    searchFor: "cUPMDTk: \"\\/",
    replaceWith: "cUPMDTk: \"https://website.com/"
  },
  {
    target: "content",
    searchFor: "cpo.src = '/",
    replaceWith: "cpo.src = 'https://website.com/"
  }
]
```

Sidenote: When testing `transforms`, check the "Disable Cache (while DevTools are open)" checkbox in DevTools, otherwise it might return a previously-cached response.

In summary:
* It replaces [`Content-Security-Policy`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy) HTTP response header with `frame-ancestors *;` to allow the page to be embedded on any 3rd-party website.
* Applies any `transforms`, when provided, to the received HTML response content.
  * For example, such transforms should convert any relative URLs found in the HTTP response to absolute ones. Otherwise, when the `<iframe/>`d page sends additional HTTP requests for "resource" files at "relative" URLs (like `/scripts/some-script.js`), those "resources" won't be found because those "relative" URLs would be resolved against the domain of the proxy server itself rather than the domain of the website being proxied.
-->