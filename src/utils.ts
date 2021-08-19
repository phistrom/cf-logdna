import { ErrorObject, getLogDNAURLParameters } from "./types"
import { LOGDNA_INGEST_URL } from "./constants"

export function convertErrorToObject(err: Error): ErrorObject {
  const errObj: ErrorObject = Object.getOwnPropertyNames(err).reduce((obj, x) => {
    obj[x] = err[x]
    return obj
  }, {})
  errObj.name = err.name
  return errObj
}

export function getCommonLogFormatTimestamp(d: Date | null = null): string {
  if (!d) {
    d = new Date()
  }

  let offset = d.getTimezoneOffset()
  let sign = "+"
  if (offset < 0) {
    sign = "-"
    offset = Math.abs(offset)
  }

  // getTimezoneOffset returns minutes offset.
  // UTC-5 becomes '300'. We want '-0500'.
  // Bitwise OR with 0 removes the decimal. So 5.5 | 0 becomes 5.
  const offsetHour = zeroPad((offset / 60) | 0)
  const offsetMinutes = zeroPad((offset % 60))
  const offsetStr = `${sign}${offsetHour}${offsetMinutes}`

  // month as Jan, Feb, Mar...
  const shortMonth = d.toLocaleString("en-us", { month: "short" })

  // https://en.wikipedia.org/wiki/Common_Log_Format
  // desired date format example: [10/Oct/2000:13:55:36 -0700]
  const timestamp =
    `${zeroPad(d.getDate())}/` + // day
    `${shortMonth}` + // month
    `/${d.getFullYear()}` + // year
    ` ${zeroPad(d.getHours())}` + // hour
    `:${zeroPad(d.getMinutes())}` + // minute
    `:${zeroPad(d.getSeconds())}` +  // second
    ` ${offsetStr}` // offset as -0500

  return timestamp
}

export function getLogDNAURL({ hostname = "CF-Worker", ip, tags }: getLogDNAURLParameters): string {
  const url = new URL(LOGDNA_INGEST_URL)

  if (hostname) {
    url.searchParams.set("hostname", hostname)
  }

  // Cloudflare Workers do not tell us their IP.
  // Maybe this could have a fetch to some external service to get its own IP
  // but I doubt that's really important.
  if (ip) {
    url.searchParams.set("ip", ip)
  }

  if (tags) {
    const tagStr = tags.map(tag => tag.trim()).join()
    url.searchParams.set("tags", tagStr)
  }

  // Date.now() isn't accurate in a CLoudflare Worker.
  // this may lead to inaccuracies with the logs sent to LogDNA.

  // Unix timestamp in milliseconds
  // url.searchParams.set('now', Date.now().toString())

  return url.toString()
}

export function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function zeroPad(number: number, length = 2): string {
  return `${("0" + number).slice(-length)}`
}
