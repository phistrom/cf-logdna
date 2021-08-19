# LogDNA Logging on Cloudflare Workers

## Beta

Please use care when using in production environments.

## Requirements

* Your project needs to have either
    * [`type = "webpack"`] in its `wrangler.toml`
    * or some kind of [build configuration].
* An account with [LogDNA] (there's a free tier).
* An account with [Cloudflare] (there's a free tier).

## Install

From your Cloudflare Worker project, run:

```sh
npm install @phistrom/cf-logdna`
```

Specify your [LogDNA ingest API key] by adding a secret to your Worker:

```sh
wrangler secret put LOGDNA_KEY
# put in your API key from LogDNA here when prompted
```

Specify the [`APP_NAME`] in one of **two ways**:

Add the following to your `wrangler.toml` file as an [environment variable]:

```toml
vars = { WORKER_NAME = "cf-logdna-testing" }
```

Or you can add `self.WORKER_NAME` to your code directly like this:

```javascript
import "@phistrom/cf-logdna"

self.WORKER_NAME = "myworker"

addEventListener('fetch', event => {
  // ...
})
```

## How to Use

Just import `@phistrom/cf-logdna` as early in your code as possible to immediately benefit from the logging of incoming
requests, responses, unhandled errors, and objects/messages logged to the `console`.

```javascript
// as close to the top as possible of your entry script (i.e. index.js)
import "@phistrom/cf-logdna"

addEventListener('fetch', event => {
  // ...
})
```

### console vs event.console

`cf-logdna` attempts to associate log lines with the request/response context (event) they came from. Sometimes this
isn't possible (due to the way that [`Date.now()` works]). **To ensure that every log line can be associated with a
FetchEvent**, `cf-logdna` provides an `event.console`
object.

```javascript
import "@phistrom/cf-logdna"

addEventListener('fetch', event => {
  console.log("I get logged to LogDNA just fine.")
  event.console.log("I'm a better way of doing things, though.")
  event.console.error("I'm an error message!")
  console.critical("I'm a non-standard critical message! But I *may* not have the FetchEvent information.")
  event.console.critical("critical() behaves the same as console.error, but will log a CRITICAL level entry on LogDNA.")
  $console.log("I don't get sent to LogDNA. I act like the vanilla console object.")
  throw new Error("I'll see you in `wrangler tail` AND in your LogDNA viewer!")
})
```

`event.console` ensures that log lines sent to LogDNA have a `meta.eventTimestamp` field. Using the regular `console`
may still provide this field, but only until the first `fetch()`
call made (the `Date.now()` clock [only advances after I/O calls]).

**_Do not_** assign the `event.console` object to a global variable. You should pass it into the functions handling the
events. It can be a pain going through and changing all your code to say `event.console.log` instead of `console.log`,
but it's not a requirement.

## License

MIT

## Contributing

I'm not very skilled at Javascript. I'm getting better because Cloudflare Workers is such a great product, but I'm sure
there are optimizations that could be made or bugs to be squished. Pull requests are very welcome and very much
appreciated.


[`type = "webpack"`]: <https://developers.cloudflare.com/workers/cli-wrangler/configuration#keys>

[build configuration]: <https://developers.cloudflare.com/workers/cli-wrangler/configuration#build>

[LogDNA]: <https://www.logdna.com/sign-up>

[Cloudflare]: <https://dash.cloudflare.com/sign-up/workers>

[LogDNA ingest API key]: <https://docs.logdna.com/docs/ingestion-key>

[`APP_NAME`]: <https://docs.logdna.com/docs/ingestion#application-information>

[environment variable]: <https://developers.cloudflare.com/workers/cli-wrangler/configuration#vars>

[`Date.now()` works]: <https://developers.cloudflare.com/workers/runtime-apis/web-standards#javascript-standards>

[only advances after I/O calls]: <https://developers.cloudflare.com/workers/runtime-apis/web-standards#javascript-standards>
