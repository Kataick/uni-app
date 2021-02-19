import {
  hasOwn
} from 'uni-shared'

import {
  publish,
  requireNativePlugin,
  base64ToArrayBuffer
} from '../../bridge'

let requestTaskId = 0
const requestTasks = {}

const publishStateChange = res => {
  publish('onRequestTaskStateChange', res)
  delete requestTasks[requestTaskId]
}

const cookiesPrase = header => {
  let cookiesStr = header['Set-Cookie'] || header['set-cookie']
  let cookiesArr = []
  if (!cookiesStr) {
    return []
  }
  if (cookiesStr[0] === '[' && cookiesStr[cookiesStr.length - 1] === ']') {
    cookiesStr = cookiesStr.slice(1, -1)
  }
  const handleCookiesArr = cookiesStr.split(';')
  for (let i = 0; i < handleCookiesArr.length; i++) {
    if (handleCookiesArr[i].indexOf('Expires=') !== -1) {
      cookiesArr.push(handleCookiesArr[i].replace(',', ''))
    } else {
      cookiesArr.push(handleCookiesArr[i])
    }
  }
  cookiesArr = cookiesArr.join(';').split(',')

  return cookiesArr
}

export function createRequestTaskById (requestTaskId, {
  url,
  data,
  header,
  method = 'GET',
  responseType,
  sslVerify = true,
  firstIpv4 = false,
  timeout = (__uniConfig.networkTimeout && __uniConfig.networkTimeout.request) || 60 * 1000
} = {}) {
  const stream = requireNativePlugin('stream')
  const headers = {}

  let abortTimeout
  let aborted
  let hasContentType = false
  for (const name in header) {
    if (!hasContentType && name.toLowerCase() === 'content-type') {
      hasContentType = true
      headers['Content-Type'] = header[name]
      // TODO 需要重构
      if (method !== 'GET' && header[name].indexOf('application/x-www-form-urlencoded') === 0 && typeof data !==
        'string' && !(data instanceof ArrayBuffer)) {
        const bodyArray = []
        for (const key in data) {
          if (hasOwn(data, key)) {
            bodyArray.push(encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
          }
        }
        data = bodyArray.join('&')
      }
    } else {
      headers[name] = header[name]
    }
  }

  if (!hasContentType && method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
  }

  if (timeout) {
    abortTimeout = setTimeout(() => {
      aborted = true
      publishStateChange({
        requestTaskId,
        state: 'fail',
        statusCode: 0,
        errMsg: 'timeout'
      })
    }, (timeout + 200)) // TODO +200 发消息到原生层有时间开销，以后考虑由原生层回调超时
  }
  const options = {
    method,
    url: url.trim(),
    // weex 官方文档有误，headers 类型实际 object，用 string 类型会无响应
    headers,
    type: responseType === 'arraybuffer' ? 'base64' : 'text',
    // weex 官方文档未说明实际支持 timeout，单位：ms
    timeout: timeout || 6e5,
    // 配置和weex模块内相反
    sslVerify: !sslVerify,
    firstIpv4: firstIpv4
  }
  if (method !== 'GET') {
    options.body = typeof data === 'string' ? data : JSON.stringify(data)
  }
  try {
    stream.fetch(options, ({
      ok,
      status,
      data,
      headers,
      errorMsg
    }) => {
      if (aborted) {
        return
      }
      if (abortTimeout) {
        clearTimeout(abortTimeout)
      }
      const statusCode = status
      if (statusCode > 0) {
        publishStateChange({
          requestTaskId,
          state: 'success',
          data: ok && responseType === 'arraybuffer' ? base64ToArrayBuffer(data) : data,
          statusCode,
          header: headers,
          cookies: cookiesPrase(headers)
        })
      } else {
        let errMsg = 'abort statusCode:' + statusCode
        if (errorMsg) {
          errMsg = errMsg + ' ' + errorMsg
        }
        publishStateChange({
          requestTaskId,
          state: 'fail',
          statusCode,
          errMsg
        })
      }
    })
    requestTasks[requestTaskId] = {
      abort () {
        aborted = true
        if (abortTimeout) {
          clearTimeout(abortTimeout)
        }
        publishStateChange({
          requestTaskId,
          state: 'fail',
          statusCode: 0,
          errMsg: 'abort'
        })
      }
    }
  } catch (e) {
    return {
      requestTaskId,
      errMsg: 'createRequestTask:fail'
    }
  }
  return {
    requestTaskId,
    errMsg: 'createRequestTask:ok'
  }
}

export function createRequestTask (args) {
  return createRequestTaskById(++requestTaskId, args)
}

export function operateRequestTask ({
  requestTaskId,
  operationType
} = {}) {
  const requestTask = requestTasks[requestTaskId]
  if (requestTask && operationType === 'abort') {
    requestTask.abort()
    return {
      errMsg: 'operateRequestTask:ok'
    }
  }
  return {
    errMsg: 'operateRequestTask:fail'
  }
}
