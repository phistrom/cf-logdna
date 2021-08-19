import {
  CFObject,
  RequestObject,
  ResponseObject,
  LogDNALines,
  Severity,
} from "./types"

import './types'

import { ConsoleLine } from "./console-line"
import { Context } from "./context"
import { convertErrorToObject, getLogDNAURL, timeout } from "./utils"
import { DELAY_BEFORE_LOGGING_CONTEXT, DELAY_LOGGING_WAITUNTIL_EXCEPTION } from "./constants"


/**
 * Preserve the original console for internal use.
 */
const $console = self.console
self.$console = self.console

// mapping of console.<method> to a log level
// i.e. console.warn maps to "WARN"
const consoleMethods: Record<string, Severity> = {
  debug: "DEBUG",
  info: "INFO",
  log: "INFO",
  warn: "WARN",
  error: "ERROR",
  critical: "CRITICAL",  // doesn't exist on the regular console object
}


const SCRIPT_NAME = "LogDNA"


/**
 * Put this as the Authorization header when POSTing logs to
 * LogDNA's ingest endpoint. The format is
 * `Basic base64encode(LOGDNA_KEY + ":")`
 *
 */
const LOGDNA_AUTH_HEADER = `Basic ${btoa(`${self.LOGDNA_KEY}:`)}`


/**
 * Return a `Proxy` that behaves just like the regular console. It intercepts
 * the logging functions to send them off to LogDNA in addition to the default
 * behavior.
 *
 * @param timestamp Should be undefined for the global console object. For
 *                  `event.console`, should be equal to `event.timeStamp`
 */
function wrapConsole(timestamp?: number): Console {
  const handler: ProxyHandler<Console> = {
    get: (target, prop: string, receiver?: any): any => {
      // Severity only has a value if it's one of the logging functions
      // we're intersted in.
      const severity: Severity | undefined = consoleMethods[prop]

      // do special behavior for this property (it's one of
      // the logging functions)
      if (severity) {
        prop === "critical" ? prop = "error" : prop
        const consoleFunction = target[prop]
        return (...data: any[]) => {
          // perform the original console.<function>
          Reflect.apply(consoleFunction, target, data)

          const line = new ConsoleLine(timestamp, severity, data)
          // add this log line to the list to be sent to LogDNA later
          line.push()
        }
      }
      else {
        // do normal behavior for this property
        return Reflect.get(target, prop, receiver)
      }
    },
  }

  // behaves just like the real console, except for the logging functions
  // (debug, info, log, warn, error...) which also send their parameters LogDNA
  return new Proxy($console, handler)
}

/**
 * Modify the incoming event to help log it to LogDNA.
 * @param event
 */
function modifyEvent(event: FetchEvent): void {
  // Cloudflare Workers does not seem to implement the event.timeStamp field
  // so we'll do it for them.
  const ts = Date.now()
  event.timeStamp = ts

  // Add a special console for the user so that logs can be associated with
  // request/response rays
  event.console = wrapConsole(ts)
  interceptWaitUntil(event)
  interceptRespondWith(event)
}

/**
 * Wraps an event listener function in a try/catch so that unhandled exceptions
 * can be sent to LogDNA.
 *
 * @param listener
 */
function wrapEventListener(listener: EventListener): EventListener {
  const newListener: EventListener = async (evt: Event) => {
    try {
      return listener(evt)
    }
    catch (err) {
      // an error here means the exception happened in the addEventListener
      // function itself. That is, it didn't happen in any waitUntil or
      // respondWith promises.
      console.critical({ unhandledException: convertErrorToObject(err), context: "addEventListener" })
      // get the logs sent before raising the exception
      await logEvent(<FetchEvent>evt)

      throw err
    }
  }
  return newListener
}

/**
 * Wrap addEventListener so we can catch exceptions that happen in it. This
 * catches errors that happen in the event handler itself, before (or maybe
 * even after) a call to respondWith. It does not catch errors that occur in
 * promises/functions given to `event.respondWith` or `event.waitUntil`. Those
 * are caught elsewhere.
 */
function interceptAddEventListener() {
  const $addEventListener = self.addEventListener
  self.$addEventListener = $addEventListener
  self.addEventListener = (...args) => {
    const type: string = args[0]  // 'fetch', 'scheduled', etc.
    const listener: EventListener | EventListenerObject = args[1]
    // we are only interested in modifying the behavior if this is a FetchEvent
    if (listener !== null && type === "fetch") {
      // we need to determine if the listener is an EventListenerObject
      // or just a function (an EventListener).
      if ((<EventListenerObject>listener)?.handleEvent) {
        // it's an object with a "handleEvent" function
        const obj = (<EventListenerObject>listener)
        obj.handleEvent = wrapEventListener(obj.handleEvent)
      }
      else {
        // it's just a function
        args[1] = wrapEventListener(<EventListener>listener)
      }
    }
    // do the original addEventListener logic
    Reflect.apply($addEventListener, self, args)
  }
}

/**
 * Wrap the `event.respondWith` so that we can log the Response object that was
 * given to it or log unhandled exceptions that arise from promises given to it.
 *
 * @param event the `event` object to monkey-patch
 */
function interceptRespondWith(event: FetchEvent): void {
  const $respondWith = event.respondWith  // the original respondWith
  event.respondWith = (r) => {

    // push the request/context into a queue to be logged
    // `event.$waitUntil` is the original waitUntil function.
    // If we used `waitUntil` instead of `$waitUntil` here, an uncaught
    // exception would be logged twice.
    event.$waitUntil(logEvent(event, r))

    // wrap whatever the user gave to respondWith so that we catch any uncaught
    // exceptions and send them to LogDNA before allowing the exception to
    // terminate the worker
    const newResponsePromise = async (): Promise<Response> => {
      try {
        return await r
      }
      catch (err) {
        console.critical({ unhandledException: convertErrorToObject(err), context: "respondWith" })
        await logEvent(event)
        throw err
      }
    }
    return Reflect.apply($respondWith, event, [newResponsePromise()])
  }
}


function interceptWaitUntil(event: FetchEvent) {
  const $waitUntil = event.waitUntil
  event.$waitUntil = $waitUntil

  // waitUntil seems to accept at least functions and promises
  // typescript just says `any` for the `f` parameter.
  // Hopefully I've covered all the bases here.
  event.waitUntil = (f: any) => {

    // a new Promise to wrap the user-provided function/promise in a try/catch
    const newPromise = async () => {
      try {
        $console.log("Doing a waitUntil", typeof f)
        if (typeof f === "function") {
          return await f()
        }
        else {
          return await f
        }
      }
      catch (err) {
        console.critical({ unhandledException: convertErrorToObject(err), context: "waitUntil" })
        $console.debug("Since this is a `waitUntil` `Promise`, we're going to " +
          "give the `respondWith` or other `waitUntil` promises a chance to " +
          "finish resolving before sending logs and raising the exception.")
        // give other promises a chance to resolve first
        await timeout(DELAY_LOGGING_WAITUNTIL_EXCEPTION)

        // a response may already have been returned at this point and
        // there's a chance we might get it by timestamp
        const context = Context.getByTimestamp(event.timeStamp)

        try {
          await logEvent(event, context?.response)
        }
        catch (loggingErr) {  // catch this logging error so the real bug can still rise
          const errObj = convertErrorToObject(loggingErr)
          $console.error(`${SCRIPT_NAME}: An additional error occurred trying to log an uncaught exception to LogDNA:`, errObj)
        }

        throw err
      }
    }

    return Reflect.apply($waitUntil, event, [newPromise()])
  }
}

function getRequestObject(request: Request): RequestObject {
  // request = await request;
  const reqHeaders: Record<string, string> = Object.fromEntries(request.headers)

  // this header appears to be a JSON string
  // so lets log it as an actual object so it's more readable
  try {
    reqHeaders["cf-visitor"] = JSON.parse(reqHeaders["cf-visitor"])
  }
  catch (err) {
    // ok cf-visitor was probably an empty string or something
  }

  // This value can be found in the Cookie header if you turn on LOG_COOKIES.
  // Also it's sensitive information.
  delete reqHeaders["cf-access-jwt-assertion"]

  if (self.LOG_COOKIES !== undefined) {
    delete reqHeaders["cookie"]
  }


  const requestObj: RequestObject = {
    headers: reqHeaders,
    method: request.method,
    redirect: request.redirect,
    url: request.url,
  }

  return requestObj
}


function getCFObject(request: Request): CFObject {
  // request = await request;

  // clone the request.cf object, omitting a couple properties
  const { tlsClientAuth, tlsExportedAuthenticator, ...cf }: any = { ...request.cf }

  const clientAcceptEncoding: string[] = cf.clientAcceptEncoding ?
    cf.clientAcceptEncoding.split(/, ?/) : []

  const cfObj: CFObject = {
    ...cf,
    clientAcceptEncoding: clientAcceptEncoding,
  }

  return cfObj
}


async function getResponseObject(response?: Response | Promise<Response> | ResponseObject): Promise<ResponseObject | undefined> {
  if (response === undefined) {
    return undefined
  }

  response = await response

  if (!(response instanceof Response)) {
    return <ResponseObject>response
  }

  const responseObj = {
    headers: Object.fromEntries(response.headers),
    ok: response.ok,
    redirected: response.redirected,
    status: response.status,
    statusText: response.statusText,
    // type: response.type,  // not implemented by Cloudflare Workers
    url: response.url,
  }

  return responseObj
}


/**
 * Push this particular request/response context onto the contexts array
 * to be sent to LogDNA.
 *
 * @param event the FetchEvent for this Request/Response context
 * @param response the Response that was given to event.respondWith
 */
async function logEvent(event: FetchEvent, response?: Response | Promise<Response> | ResponseObject) {
  // Convert the event.request, event.request.cf, and the response
  // object given to event.respondWith into simpler objects that can be
  // passed into JSON.stringify and sent to LogDNA

  const [requestObj, cf, respObj] = await Promise.all([
    getRequestObject(event.request),
    getCFObject(event.request),
    getResponseObject(response),
  ])

  // We have to check this because if an uncaught exception happens, this may
  // be the second time logEvent was called.
  if (!Context.getByTimestamp(event.timeStamp)) {
    const context = new Context(requestObj, cf, respObj, event.timeStamp)
    context.push()  // queue up for logging later
  }

  if (DELAY_BEFORE_LOGGING_CONTEXT > 0) {
    await timeout(DELAY_BEFORE_LOGGING_CONTEXT)
  }

  await sendToLogDNA(event.timeStamp)
}


async function sendToLogDNA(timestamp: number): Promise<void> {
  const logData: LogDNALines = {
    lines: [],
  }
  logData.lines.push(...Context.claimAll(timestamp))
  logData.lines.push(...ConsoleLine.claimAll(timestamp))

  if (logData.lines.length < 1) {
    $console.debug(`${SCRIPT_NAME}:sendToLogDNA(): Nothing to send.`)
    return
  }

  logData.lines.sort((a, b) => {
    // if there is a cf object in meta, this is a Context log
    // otherwise it is a Console log
    const aConsole = a.meta.cf ? 0 : 1
    const bConsole = b.meta.cf ? 0 : 1

    // if both are the same type, then sort by timestamp
    // otherwise, a Context will be ordered BEFORE a ConsoleLine
    return aConsole - bConsole || a.timestamp - b.timestamp
  })

  const logJson = JSON.stringify(logData)

  const tags = ["cf-worker"]
  const ingestUrl = getLogDNAURL({ tags: tags })

  // $console.log("Submitting to LogDNA:", logJson)

  const response = await fetch(ingestUrl, {
    body: logJson,
    headers: {
      "Authorization": LOGDNA_AUTH_HEADER,
      "Content-Type": "application/json;charset=UTF-8",
    },
    method: "POST",
  })

  $console.debug("LogDNA Response:", response)
  const respHeaders = Object.fromEntries(response.headers)
  $console.debug("LogDNA Headers:", respHeaders)
  $console.debug("LogDNA Body:", await response.json())
  if (response.ok) {
    ConsoleLine.confirmAll(timestamp)
    await Context.confirmAll(timestamp)
  }
}

// before first run, we'll set up console logging to LogDNA
self.console = wrapConsole()
// before first run, we'll change the addEventListener too
interceptAddEventListener()

addEventListener("fetch", (event: FetchEvent) => {
  // event.request;
  $console.log(`I'm the logging event listener.`)
  modifyEvent(event)
})
