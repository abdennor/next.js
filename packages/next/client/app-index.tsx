/* global location */
import '../build/polyfills/polyfill-module'
// @ts-ignore react-dom/client exists when using React 18
import ReactDOMClient from 'react-dom/client'
import React from 'react'
import { createFromReadableStream } from 'next/dist/compiled/react-server-dom-webpack'

import measureWebVitals from './performance-relayer'

/// <reference types="react-dom/experimental" />

// Override chunk URL mapping in the webpack runtime
// https://github.com/webpack/webpack/blob/2738eebc7880835d88c727d364ad37f3ec557593/lib/RuntimeGlobals.js#L204

declare global {
  const __webpack_require__: any
}

// TODO-APP: change to React.use once it becomes stable
const use = (React as any).experimental_use

// eslint-disable-next-line no-undef
const getChunkScriptFilename = __webpack_require__.u
const chunkFilenameMap: any = {}

// eslint-disable-next-line no-undef
__webpack_require__.u = (chunkId: any) => {
  return chunkFilenameMap[chunkId] || getChunkScriptFilename(chunkId)
}

// Ignore the module ID transform in client.
// eslint-disable-next-line no-undef
// @ts-expect-error TODO: fix type
self.__next_require__ = __webpack_require__

// eslint-disable-next-line no-undef
;(self as any).__next_chunk_load__ = (chunk: string) => {
  if (!chunk) return Promise.resolve()
  const [chunkId, chunkFileName] = chunk.split(':')
  chunkFilenameMap[chunkId] = `static/chunks/${chunkFileName}.js`

  // @ts-ignore
  // eslint-disable-next-line no-undef
  return __webpack_chunk_load__(chunkId)
}

export const version = process.env.__NEXT_VERSION

const appElement: HTMLElement | Document | null = document

const getCacheKey = () => {
  const { pathname, search } = location
  return pathname + search
}

const encoder = new TextEncoder()

let initialServerDataBuffer: string[] | undefined = undefined
let initialServerDataWriter: ReadableStreamDefaultController | undefined =
  undefined
let initialServerDataLoaded = false
let initialServerDataFlushed = false

function nextServerDataCallback(
  seg: [isBootStrap: 0] | [isNotBootstrap: 1, responsePartial: string]
): void {
  if (seg[0] === 0) {
    initialServerDataBuffer = []
  } else {
    if (!initialServerDataBuffer)
      throw new Error('Unexpected server data: missing bootstrap script.')

    if (initialServerDataWriter) {
      initialServerDataWriter.enqueue(encoder.encode(seg[1]))
    } else {
      initialServerDataBuffer.push(seg[1])
    }
  }
}

// There might be race conditions between `nextServerDataRegisterWriter` and
// `DOMContentLoaded`. The former will be called when React starts to hydrate
// the root, the latter will be called when the DOM is fully loaded.
// For streaming, the former is called first due to partial hydration.
// For non-streaming, the latter can be called first.
// Hence, we use two variables `initialServerDataLoaded` and
// `initialServerDataFlushed` to make sure the writer will be closed and
// `initialServerDataBuffer` will be cleared in the right time.
function nextServerDataRegisterWriter(ctr: ReadableStreamDefaultController) {
  if (initialServerDataBuffer) {
    initialServerDataBuffer.forEach((val) => {
      ctr.enqueue(encoder.encode(val))
    })
    if (initialServerDataLoaded && !initialServerDataFlushed) {
      ctr.close()
      initialServerDataFlushed = true
      initialServerDataBuffer = undefined
    }
  }

  initialServerDataWriter = ctr
}

// When `DOMContentLoaded`, we can close all pending writers to finish hydration.
const DOMContentLoaded = function () {
  if (initialServerDataWriter && !initialServerDataFlushed) {
    initialServerDataWriter.close()
    initialServerDataFlushed = true
    initialServerDataBuffer = undefined
  }
  initialServerDataLoaded = true
}
// It's possible that the DOM is already loaded.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', DOMContentLoaded, false)
} else {
  DOMContentLoaded()
}

const nextServerDataLoadingGlobal = ((self as any).__next_s =
  (self as any).__next_s || [])
nextServerDataLoadingGlobal.forEach(nextServerDataCallback)
nextServerDataLoadingGlobal.push = nextServerDataCallback

function createResponseCache() {
  return new Map<string, any>()
}
const rscCache = createResponseCache()

function useInitialServerResponse(cacheKey: string) {
  const response = rscCache.get(cacheKey)
  if (response) return response

  const readable = new ReadableStream({
    start(controller) {
      nextServerDataRegisterWriter(controller)
    },
  })

  const newResponse = createFromReadableStream(readable)

  rscCache.set(cacheKey, newResponse)
  return newResponse
}

function ServerRoot({ cacheKey }: { cacheKey: string }) {
  React.useEffect(() => {
    rscCache.delete(cacheKey)
  })
  const response = useInitialServerResponse(cacheKey)
  const root = use(response)
  return root
}

function Root({ children }: React.PropsWithChildren<{}>): React.ReactElement {
  React.useEffect(() => {
    measureWebVitals()
  }, [])

  if (process.env.__NEXT_TEST_MODE) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useEffect(() => {
      window.__NEXT_HYDRATED = true

      if (window.__NEXT_HYDRATED_CB) {
        window.__NEXT_HYDRATED_CB()
      }
    }, [])
  }

  return children as React.ReactElement
}

function RSCComponent(props: any) {
  const cacheKey = getCacheKey()
  return <ServerRoot {...props} cacheKey={cacheKey} />
}

export function hydrate() {
  const reactEl = (
    <React.StrictMode>
      <Root>
        <RSCComponent />
      </Root>
    </React.StrictMode>
  )

  const isError = document.documentElement.id === '__next_error__'
  const reactRoot = isError
    ? (ReactDOMClient as any).createRoot(appElement)
    : (ReactDOMClient as any).hydrateRoot(appElement, reactEl)
  if (isError) {
    reactRoot.render(reactEl)
  }
}
