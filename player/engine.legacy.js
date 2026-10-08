/* LumaSign legacy engine: esbuild(bundle,es2020) + swc(es5) + polyfills. DO NOT EDIT BY HAND. */
/* Regenerate with: node player/build-legacy.mjs */
/* mini URLSearchParams polyfill (ES5) for Chromium<49 */
(function () {
  if (typeof window.URLSearchParams === "function") return;
  function USP(search) {
    this._p = {};
    var s = String(search || "");
    if (s.charAt(0) === "?") s = s.slice(1);
    if (s.charAt(0) === "&") s = s.slice(1);
    var pairs = s ? s.split("&") : [];
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split("=");
      var k = decodeURIComponent(kv[0].split("+").join(" "));
      var v = kv.length > 1 ? decodeURIComponent(kv[1].split("+").join(" ")) : "";
      if (k) this.append(k, v);
    }
  }
  USP.prototype.append = function (k, v) { (this._p[k] = this._p[k] || []).push(String(v)); };
  USP.prototype.get = function (k) { return this.has(k) ? this._p[k][0] : null; };
  USP.prototype.getAll = function (k) { return this.has(k) ? this._p[k].slice() : []; };
  USP.prototype.has = function (k) { return Object.prototype.hasOwnProperty.call(this._p, k); };
  USP.prototype.set = function (k, v) { this._p[k] = [String(v)]; };
  USP.prototype.delete = function (k) { delete this._p[k]; };
  USP.prototype.forEach = function (cb, thisArg) {
    var p = this._p;
    Object.keys(p).forEach(function (k) { p[k].forEach(function (v) { cb.call(thisArg, v, k, this); }); });
  };
  USP.prototype.toString = function () {
    var out = [];
    this.forEach(function (v, k) { out.push(encodeURIComponent(k) + "=" + encodeURIComponent(v)); });
    return out.join("&");
  };
  window.URLSearchParams = USP;
})();

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (factory((global.WHATWGFetch = {})));
}(this, (function (exports) { 'use strict';

  /* eslint-disable no-prototype-builtins */
  var g =
    (typeof globalThis !== 'undefined' && globalThis) ||
    (typeof self !== 'undefined' && self) ||
    // eslint-disable-next-line no-undef
    (typeof global !== 'undefined' && global) ||
    {};

  var support = {
    searchParams: 'URLSearchParams' in g,
    iterable: 'Symbol' in g && 'iterator' in Symbol,
    blob:
      'FileReader' in g &&
      'Blob' in g &&
      (function() {
        try {
          new Blob();
          return true
        } catch (e) {
          return false
        }
      })(),
    formData: 'FormData' in g,
    arrayBuffer: 'ArrayBuffer' in g
  };

  function isDataView(obj) {
    return obj && DataView.prototype.isPrototypeOf(obj)
  }

  if (support.arrayBuffer) {
    var viewClasses = [
      '[object Int8Array]',
      '[object Uint8Array]',
      '[object Uint8ClampedArray]',
      '[object Int16Array]',
      '[object Uint16Array]',
      '[object Int32Array]',
      '[object Uint32Array]',
      '[object Float32Array]',
      '[object Float64Array]'
    ];

    var isArrayBufferView =
      ArrayBuffer.isView ||
      function(obj) {
        return obj && viewClasses.indexOf(Object.prototype.toString.call(obj)) > -1
      };
  }

  function normalizeName(name) {
    if (typeof name !== 'string') {
      name = String(name);
    }
    if (/[^a-z0-9\-#$%&'*+.^_`|~!]/i.test(name) || name === '') {
      throw new TypeError('Invalid character in header field name: "' + name + '"')
    }
    return name.toLowerCase()
  }

  function normalizeValue(value) {
    if (typeof value !== 'string') {
      value = String(value);
    }
    return value
  }

  // Build a destructive iterator for the value list
  function iteratorFor(items) {
    var iterator = {
      next: function() {
        var value = items.shift();
        return {done: value === undefined, value: value}
      }
    };

    if (support.iterable) {
      iterator[Symbol.iterator] = function() {
        return iterator
      };
    }

    return iterator
  }

  function Headers(headers) {
    this.map = {};

    if (headers instanceof Headers) {
      headers.forEach(function(value, name) {
        this.append(name, value);
      }, this);
    } else if (Array.isArray(headers)) {
      headers.forEach(function(header) {
        if (header.length != 2) {
          throw new TypeError('Headers constructor: expected name/value pair to be length 2, found' + header.length)
        }
        this.append(header[0], header[1]);
      }, this);
    } else if (headers) {
      Object.getOwnPropertyNames(headers).forEach(function(name) {
        this.append(name, headers[name]);
      }, this);
    }
  }

  Headers.prototype.append = function(name, value) {
    name = normalizeName(name);
    value = normalizeValue(value);
    var oldValue = this.map[name];
    this.map[name] = oldValue ? oldValue + ', ' + value : value;
  };

  Headers.prototype['delete'] = function(name) {
    delete this.map[normalizeName(name)];
  };

  Headers.prototype.get = function(name) {
    name = normalizeName(name);
    return this.has(name) ? this.map[name] : null
  };

  Headers.prototype.has = function(name) {
    return this.map.hasOwnProperty(normalizeName(name))
  };

  Headers.prototype.set = function(name, value) {
    this.map[normalizeName(name)] = normalizeValue(value);
  };

  Headers.prototype.forEach = function(callback, thisArg) {
    for (var name in this.map) {
      if (this.map.hasOwnProperty(name)) {
        callback.call(thisArg, this.map[name], name, this);
      }
    }
  };

  Headers.prototype.keys = function() {
    var items = [];
    this.forEach(function(value, name) {
      items.push(name);
    });
    return iteratorFor(items)
  };

  Headers.prototype.values = function() {
    var items = [];
    this.forEach(function(value) {
      items.push(value);
    });
    return iteratorFor(items)
  };

  Headers.prototype.entries = function() {
    var items = [];
    this.forEach(function(value, name) {
      items.push([name, value]);
    });
    return iteratorFor(items)
  };

  if (support.iterable) {
    Headers.prototype[Symbol.iterator] = Headers.prototype.entries;
  }

  function consumed(body) {
    if (body._noBody) return
    if (body.bodyUsed) {
      return Promise.reject(new TypeError('Already read'))
    }
    body.bodyUsed = true;
  }

  function fileReaderReady(reader) {
    return new Promise(function(resolve, reject) {
      reader.onload = function() {
        resolve(reader.result);
      };
      reader.onerror = function() {
        reject(reader.error);
      };
    })
  }

  function readBlobAsArrayBuffer(blob) {
    var reader = new FileReader();
    var promise = fileReaderReady(reader);
    reader.readAsArrayBuffer(blob);
    return promise
  }

  function readBlobAsText(blob) {
    var reader = new FileReader();
    var promise = fileReaderReady(reader);
    var match = /charset=([A-Za-z0-9_-]+)/.exec(blob.type);
    var encoding = match ? match[1] : 'utf-8';
    reader.readAsText(blob, encoding);
    return promise
  }

  function readArrayBufferAsText(buf) {
    var view = new Uint8Array(buf);
    var chars = new Array(view.length);

    for (var i = 0; i < view.length; i++) {
      chars[i] = String.fromCharCode(view[i]);
    }
    return chars.join('')
  }

  function bufferClone(buf) {
    if (buf.slice) {
      return buf.slice(0)
    } else {
      var view = new Uint8Array(buf.byteLength);
      view.set(new Uint8Array(buf));
      return view.buffer
    }
  }

  function Body() {
    this.bodyUsed = false;

    this._initBody = function(body) {
      /*
        fetch-mock wraps the Response object in an ES6 Proxy to
        provide useful test harness features such as flush. However, on
        ES5 browsers without fetch or Proxy support pollyfills must be used;
        the proxy-pollyfill is unable to proxy an attribute unless it exists
        on the object before the Proxy is created. This change ensures
        Response.bodyUsed exists on the instance, while maintaining the
        semantic of setting Request.bodyUsed in the constructor before
        _initBody is called.
      */
      // eslint-disable-next-line no-self-assign
      this.bodyUsed = this.bodyUsed;
      this._bodyInit = body;
      if (!body) {
        this._noBody = true;
        this._bodyText = '';
      } else if (typeof body === 'string') {
        this._bodyText = body;
      } else if (support.blob && Blob.prototype.isPrototypeOf(body)) {
        this._bodyBlob = body;
      } else if (support.formData && FormData.prototype.isPrototypeOf(body)) {
        this._bodyFormData = body;
      } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
        this._bodyText = body.toString();
      } else if (support.arrayBuffer && support.blob && isDataView(body)) {
        this._bodyArrayBuffer = bufferClone(body.buffer);
        // IE 10-11 can't handle a DataView body.
        this._bodyInit = new Blob([this._bodyArrayBuffer]);
      } else if (support.arrayBuffer && (ArrayBuffer.prototype.isPrototypeOf(body) || isArrayBufferView(body))) {
        this._bodyArrayBuffer = bufferClone(body);
      } else {
        this._bodyText = body = Object.prototype.toString.call(body);
      }

      if (!this.headers.get('content-type')) {
        if (typeof body === 'string') {
          this.headers.set('content-type', 'text/plain;charset=UTF-8');
        } else if (this._bodyBlob && this._bodyBlob.type) {
          this.headers.set('content-type', this._bodyBlob.type);
        } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
          this.headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
        }
      }
    };

    if (support.blob) {
      this.blob = function() {
        var rejected = consumed(this);
        if (rejected) {
          return rejected
        }

        if (this._bodyBlob) {
          return Promise.resolve(this._bodyBlob)
        } else if (this._bodyArrayBuffer) {
          return Promise.resolve(new Blob([this._bodyArrayBuffer]))
        } else if (this._bodyFormData) {
          throw new Error('could not read FormData body as blob')
        } else {
          return Promise.resolve(new Blob([this._bodyText]))
        }
      };
    }

    this.arrayBuffer = function() {
      if (this._bodyArrayBuffer) {
        var isConsumed = consumed(this);
        if (isConsumed) {
          return isConsumed
        } else if (ArrayBuffer.isView(this._bodyArrayBuffer)) {
          return Promise.resolve(
            this._bodyArrayBuffer.buffer.slice(
              this._bodyArrayBuffer.byteOffset,
              this._bodyArrayBuffer.byteOffset + this._bodyArrayBuffer.byteLength
            )
          )
        } else {
          return Promise.resolve(this._bodyArrayBuffer)
        }
      } else if (support.blob) {
        return this.blob().then(readBlobAsArrayBuffer)
      } else {
        throw new Error('could not read as ArrayBuffer')
      }
    };

    this.text = function() {
      var rejected = consumed(this);
      if (rejected) {
        return rejected
      }

      if (this._bodyBlob) {
        return readBlobAsText(this._bodyBlob)
      } else if (this._bodyArrayBuffer) {
        return Promise.resolve(readArrayBufferAsText(this._bodyArrayBuffer))
      } else if (this._bodyFormData) {
        throw new Error('could not read FormData body as text')
      } else {
        return Promise.resolve(this._bodyText)
      }
    };

    if (support.formData) {
      this.formData = function() {
        return this.text().then(decode)
      };
    }

    this.json = function() {
      return this.text().then(JSON.parse)
    };

    return this
  }

  // HTTP methods whose capitalization should be normalized
  var methods = ['CONNECT', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE'];

  function normalizeMethod(method) {
    var upcased = method.toUpperCase();
    return methods.indexOf(upcased) > -1 ? upcased : method
  }

  function Request(input, options) {
    if (!(this instanceof Request)) {
      throw new TypeError('Please use the "new" operator, this DOM object constructor cannot be called as a function.')
    }

    options = options || {};
    var body = options.body;

    if (input instanceof Request) {
      if (input.bodyUsed) {
        throw new TypeError('Already read')
      }
      this.url = input.url;
      this.credentials = input.credentials;
      if (!options.headers) {
        this.headers = new Headers(input.headers);
      }
      this.method = input.method;
      this.mode = input.mode;
      this.signal = input.signal;
      if (!body && input._bodyInit != null) {
        body = input._bodyInit;
        input.bodyUsed = true;
      }
    } else {
      this.url = String(input);
    }

    this.credentials = options.credentials || this.credentials || 'same-origin';
    if (options.headers || !this.headers) {
      this.headers = new Headers(options.headers);
    }
    this.method = normalizeMethod(options.method || this.method || 'GET');
    this.mode = options.mode || this.mode || null;
    this.signal = options.signal || this.signal || (function () {
      if ('AbortController' in g) {
        var ctrl = new AbortController();
        return ctrl.signal;
      }
    }());
    this.referrer = null;

    if ((this.method === 'GET' || this.method === 'HEAD') && body) {
      throw new TypeError('Body not allowed for GET or HEAD requests')
    }
    this._initBody(body);

    if (this.method === 'GET' || this.method === 'HEAD') {
      if (options.cache === 'no-store' || options.cache === 'no-cache') {
        // Search for a '_' parameter in the query string
        var reParamSearch = /([?&])_=[^&]*/;
        if (reParamSearch.test(this.url)) {
          // If it already exists then set the value with the current time
          this.url = this.url.replace(reParamSearch, '$1_=' + new Date().getTime());
        } else {
          // Otherwise add a new '_' parameter to the end with the current time
          var reQueryString = /\?/;
          this.url += (reQueryString.test(this.url) ? '&' : '?') + '_=' + new Date().getTime();
        }
      }
    }
  }

  Request.prototype.clone = function() {
    return new Request(this, {body: this._bodyInit})
  };

  function decode(body) {
    var form = new FormData();
    body
      .trim()
      .split('&')
      .forEach(function(bytes) {
        if (bytes) {
          var split = bytes.split('=');
          var name = split.shift().replace(/\+/g, ' ');
          var value = split.join('=').replace(/\+/g, ' ');
          form.append(decodeURIComponent(name), decodeURIComponent(value));
        }
      });
    return form
  }

  function parseHeaders(rawHeaders) {
    var headers = new Headers();
    // Replace instances of \r\n and \n followed by at least one space or horizontal tab with a space
    // https://tools.ietf.org/html/rfc7230#section-3.2
    var preProcessedHeaders = rawHeaders.replace(/\r?\n[\t ]+/g, ' ');
    // Avoiding split via regex to work around a common IE11 bug with the core-js 3.6.0 regex polyfill
    // https://github.com/github/fetch/issues/748
    // https://github.com/zloirock/core-js/issues/751
    preProcessedHeaders
      .split('\r')
      .map(function(header) {
        return header.indexOf('\n') === 0 ? header.substr(1, header.length) : header
      })
      .forEach(function(line) {
        var parts = line.split(':');
        var key = parts.shift().trim();
        if (key) {
          var value = parts.join(':').trim();
          try {
            headers.append(key, value);
          } catch (error) {
            console.warn('Response ' + error.message);
          }
        }
      });
    return headers
  }

  Body.call(Request.prototype);

  function Response(bodyInit, options) {
    if (!(this instanceof Response)) {
      throw new TypeError('Please use the "new" operator, this DOM object constructor cannot be called as a function.')
    }
    if (!options) {
      options = {};
    }

    this.type = 'default';
    this.status = options.status === undefined ? 200 : options.status;
    if (this.status < 200 || this.status > 599) {
      throw new RangeError("Failed to construct 'Response': The status provided (0) is outside the range [200, 599].")
    }
    this.ok = this.status >= 200 && this.status < 300;
    this.statusText = options.statusText === undefined ? '' : '' + options.statusText;
    this.headers = new Headers(options.headers);
    this.url = options.url || '';
    this._initBody(bodyInit);
  }

  Body.call(Response.prototype);

  Response.prototype.clone = function() {
    return new Response(this._bodyInit, {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers),
      url: this.url
    })
  };

  Response.error = function() {
    var response = new Response(null, {status: 200, statusText: ''});
    response.ok = false;
    response.status = 0;
    response.type = 'error';
    return response
  };

  var redirectStatuses = [301, 302, 303, 307, 308];

  Response.redirect = function(url, status) {
    if (redirectStatuses.indexOf(status) === -1) {
      throw new RangeError('Invalid status code')
    }

    return new Response(null, {status: status, headers: {location: url}})
  };

  exports.DOMException = g.DOMException;
  try {
    new exports.DOMException();
  } catch (err) {
    exports.DOMException = function(message, name) {
      this.message = message;
      this.name = name;
      var error = Error(message);
      this.stack = error.stack;
    };
    exports.DOMException.prototype = Object.create(Error.prototype);
    exports.DOMException.prototype.constructor = exports.DOMException;
  }

  function fetch(input, init) {
    return new Promise(function(resolve, reject) {
      var request = new Request(input, init);

      if (request.signal && request.signal.aborted) {
        return reject(new exports.DOMException('Aborted', 'AbortError'))
      }

      var xhr = new XMLHttpRequest();

      function abortXhr() {
        xhr.abort();
      }

      xhr.onload = function() {
        var options = {
          statusText: xhr.statusText,
          headers: parseHeaders(xhr.getAllResponseHeaders() || '')
        };
        // This check if specifically for when a user fetches a file locally from the file system
        // Only if the status is out of a normal range
        if (request.url.indexOf('file://') === 0 && (xhr.status < 200 || xhr.status > 599)) {
          options.status = 200;
        } else {
          options.status = xhr.status;
        }
        options.url = 'responseURL' in xhr ? xhr.responseURL : options.headers.get('X-Request-URL');
        var body = 'response' in xhr ? xhr.response : xhr.responseText;
        setTimeout(function() {
          resolve(new Response(body, options));
        }, 0);
      };

      xhr.onerror = function() {
        setTimeout(function() {
          reject(new TypeError('Network request failed'));
        }, 0);
      };

      xhr.ontimeout = function() {
        setTimeout(function() {
          reject(new TypeError('Network request timed out'));
        }, 0);
      };

      xhr.onabort = function() {
        setTimeout(function() {
          reject(new exports.DOMException('Aborted', 'AbortError'));
        }, 0);
      };

      function fixUrl(url) {
        try {
          return url === '' && g.location.href ? g.location.href : url
        } catch (e) {
          return url
        }
      }

      xhr.open(request.method, fixUrl(request.url), true);

      if (request.credentials === 'include') {
        xhr.withCredentials = true;
      } else if (request.credentials === 'omit') {
        xhr.withCredentials = false;
      }

      if ('responseType' in xhr) {
        if (support.blob) {
          xhr.responseType = 'blob';
        } else if (
          support.arrayBuffer
        ) {
          xhr.responseType = 'arraybuffer';
        }
      }

      if (init && typeof init.headers === 'object' && !(init.headers instanceof Headers || (g.Headers && init.headers instanceof g.Headers))) {
        var names = [];
        Object.getOwnPropertyNames(init.headers).forEach(function(name) {
          names.push(normalizeName(name));
          xhr.setRequestHeader(name, normalizeValue(init.headers[name]));
        });
        request.headers.forEach(function(value, name) {
          if (names.indexOf(name) === -1) {
            xhr.setRequestHeader(name, value);
          }
        });
      } else {
        request.headers.forEach(function(value, name) {
          xhr.setRequestHeader(name, value);
        });
      }

      if (request.signal) {
        request.signal.addEventListener('abort', abortXhr);

        xhr.onreadystatechange = function() {
          // DONE (success or failure)
          if (xhr.readyState === 4) {
            request.signal.removeEventListener('abort', abortXhr);
          }
        };
      }

      xhr.send(typeof request._bodyInit === 'undefined' ? null : request._bodyInit);
    })
  }

  fetch.polyfill = true;

  if (!g.fetch) {
    g.fetch = fetch;
    g.Headers = Headers;
    g.Request = Request;
    g.Response = Response;
  }

  exports.Headers = Headers;
  exports.Request = Request;
  exports.Response = Response;
  exports.fetch = fetch;

  Object.defineProperty(exports, '__esModule', { value: true });

})));


function _array_like_to_array(arr, len) {
    if (len == null || len > arr.length) len = arr.length;
    for(var i = 0, arr2 = new Array(len); i < len; i++)arr2[i] = arr[i];
    return arr2;
}
function _array_with_holes(arr) {
    if (Array.isArray(arr)) return arr;
}
function _array_without_holes(arr) {
    if (Array.isArray(arr)) return _array_like_to_array(arr);
}
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
    try {
        var info = gen[key](arg);
        var value = info.value;
    } catch (error) {
        reject(error);
        return;
    }
    if (info.done) resolve(value);
    else Promise.resolve(value).then(_next, _throw);
}
function _async_to_generator(fn) {
    return function() {
        var self = this, args = arguments;
        return new Promise(function(resolve, reject) {
            var gen = fn.apply(self, args);
            function _next(value) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
            }
            function _throw(err) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
            }
            _next(undefined);
        });
    };
}
function _class_call_check(instance, Constructor) {
    if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
function _defineProperties(target, props) {
    for(var i = 0; i < props.length; i++){
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
    }
}
function _create_class(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    return Constructor;
}
function _define_property(obj, key, value) {
    if (key in obj) {
        Object.defineProperty(obj, key, {
            value: value,
            enumerable: true,
            configurable: true,
            writable: true
        });
    } else obj[key] = value;
    return obj;
}
function _iterable_to_array(iter) {
    if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) {
        return Array.from(iter);
    }
}
function _iterable_to_array_limit(arr, i) {
    var _i = arr == null ? null : typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"];
    if (_i == null) return;
    var _arr = [];
    var _n = true;
    var _d = false;
    var _s, _e;
    try {
        for(_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true){
            _arr.push(_s.value);
            if (i && _arr.length === i) break;
        }
    } catch (err) {
        _d = true;
        _e = err;
    } finally{
        try {
            if (!_n && _i["return"] != null) _i["return"]();
        } finally{
            if (_d) throw _e;
        }
    }
    return _arr;
}
function _non_iterable_rest() {
    throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _non_iterable_spread() {
    throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _object_spread(target) {
    for(var i = 1; i < arguments.length; i++){
        var source = arguments[i] != null ? arguments[i] : {};
        var ownKeys = Object.keys(source);
        if (typeof Object.getOwnPropertySymbols === "function") {
            ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function(sym) {
                return Object.getOwnPropertyDescriptor(source, sym).enumerable;
            }));
        }
        ownKeys.forEach(function(key) {
            _define_property(target, key, source[key]);
        });
    }
    return target;
}
function _sliced_to_array(arr, i) {
    return _array_with_holes(arr) || _iterable_to_array_limit(arr, i) || _unsupported_iterable_to_array(arr, i) || _non_iterable_rest();
}
function _to_consumable_array(arr) {
    return _array_without_holes(arr) || _iterable_to_array(arr) || _unsupported_iterable_to_array(arr) || _non_iterable_spread();
}
function _ts_generator(thisArg, body) {
    var f, y, t, _ = {
        label: 0,
        sent: function() {
            if (t[0] & 1) throw t[1];
            return t[1];
        },
        trys: [],
        ops: []
    }, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype), d = Object.defineProperty;
    return d(g, "next", {
        value: verb(0)
    }), d(g, "throw", {
        value: verb(1)
    }), d(g, "return", {
        value: verb(2)
    }), typeof Symbol === "function" && d(g, Symbol.iterator, {
        value: function() {
            return this;
        }
    }), g;
    function verb(n) {
        return function(v) {
            return step([
                n,
                v
            ]);
        };
    }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while(g && (g = 0, op[0] && (_ = 0)), _)try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [
                op[0] & 2,
                t.value
            ];
            switch(op[0]){
                case 0:
                case 1:
                    t = op;
                    break;
                case 4:
                    _.label++;
                    return {
                        value: op[1],
                        done: false
                    };
                case 5:
                    _.label++;
                    y = op[1];
                    op = [
                        0
                    ];
                    continue;
                case 7:
                    op = _.ops.pop();
                    _.trys.pop();
                    continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                        _ = 0;
                        continue;
                    }
                    if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                        _.label = op[1];
                        break;
                    }
                    if (op[0] === 6 && _.label < t[1]) {
                        _.label = t[1];
                        t = op;
                        break;
                    }
                    if (t && _.label < t[2]) {
                        _.label = t[2];
                        _.ops.push(op);
                        break;
                    }
                    if (t[2]) _.ops.pop();
                    _.trys.pop();
                    continue;
            }
            op = body.call(thisArg, _);
        } catch (e) {
            op = [
                6,
                e
            ];
            y = 0;
        } finally{
            f = t = 0;
        }
        if (op[0] & 5) throw op[1];
        return {
            value: op[0] ? op[1] : void 0,
            done: true
        };
    }
}
function _ts_values(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) {
        return m.call(o);
    }
    if (o && typeof o.length === "number") {
        return {
            next: function() {
                if (o && i >= o.length) {
                    o = void 0;
                }
                return {
                    value: o && o[i++],
                    done: !o
                };
            }
        };
    }
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
}
function _unsupported_iterable_to_array(o, minLen) {
    if (!o) return;
    if (typeof o === "string") return _array_like_to_array(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor) n = o.constructor.name;
    if (n === "Map" || n === "Set") return Array.from(n);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _array_like_to_array(o, minLen);
}
(function() {
    // lumasign/player/widgets.js
    var esc = function esc(s) {
        return String(s !== null && s !== void 0 ? s : "").replace(/[&<>"]/g, function(c) {
            return ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;"
            })[c];
        });
    };
    function renderImage(holder, item, resolver) {
        var img = document.createElement("img");
        var url = item.mediaId ? resolver(item.mediaId) : item.url || "";
        img.src = url;
        img.className = "w-img " + (item.fit || "cover");
        img.alt = item.alt || "";
        img.onerror = function() {
            img.replaceWith(Object.assign(document.createElement("div"), {
                className: "w-img",
                textContent: "\u56FE\u7247\u7F3A\u5931"
            }));
        };
        holder.appendChild(img);
        return function() {};
    }
    function renderVideo(holder, item, resolver, onEnd) {
        var v = document.createElement("video");
        var url = item.mediaId ? resolver(item.mediaId) : item.url || "";
        v.src = url;
        v.autoplay = true;
        v.muted = true;
        v.playsInline = true;
        v.loop = !!item.loop && !(item.duration > 0);
        v.className = "w-video " + (item.fit || "cover");
        v.addEventListener("ended", function() {
            return onEnd && onEnd();
        });
        holder.appendChild(v);
        var p = v.play();
        if (p && p.catch) p.catch(function() {});
        return function() {
            try {
                v.pause();
            } catch (unused) {}
        };
    }
    function renderText(holder, item) {
        var d = document.createElement("div");
        d.className = "w-text " + (item.align || "center");
        var fs = item.fontSize ? "font-size:".concat(item.fontSize, "px;") : "";
        var color = item.color ? "color:".concat(item.color, ";") : "";
        var bg = item.bg ? "background:".concat(item.bg, ";") : "";
        d.style.cssText = fs + color + bg;
        d.innerHTML = item.html || esc(item.text) || "";
        holder.appendChild(d);
        return function() {};
    }
    function renderMarquee(holder, item) {
        var d = document.createElement("div");
        d.className = "w-marquee";
        var fs = item.fontSize ? "font-size:".concat(item.fontSize, "px;") : "font-size:36px;";
        var color = item.color ? "color:".concat(item.color, ";") : "";
        var bg = item.bg ? "background:".concat(item.bg, ";") : "";
        d.style.cssText = fs + color + bg;
        var text = esc(item.text || "");
        var inner = document.createElement("span");
        inner.textContent = text + "\u3000\u3000" + text;
        var speed = item.speed || 60;
        var dur = Math.max(8, Math.ceil(text.length * (item.fontSize || 36) / speed));
        inner.style.animationDuration = dur + "s";
        d.appendChild(inner);
        holder.appendChild(d);
        return function() {};
    }
    function renderClock(holder, item) {
        var d = document.createElement("div");
        d.className = "w-clock";
        var color = item.color ? "color:".concat(item.color, ";") : "";
        var fs = item.fontSize ? "font-size:".concat(item.fontSize, "px;") : "";
        d.style.cssText = color + fs;
        var timeEl = document.createElement("div");
        timeEl.className = "time";
        var dateEl = document.createElement("div");
        dateEl.className = "date";
        d.appendChild(timeEl);
        if (item.showDate) d.appendChild(dateEl);
        holder.appendChild(d);
        var pad = function pad(n) {
            return String(n).padStart(2, "0");
        };
        var tick = function tick() {
            var now = /* @__PURE__ */ new Date();
            if (item.format === "analog") {
                timeEl.textContent = "".concat(pad(now.getHours()), ":").concat(pad(now.getMinutes()));
            } else {
                timeEl.textContent = "".concat(pad(now.getHours()), ":").concat(pad(now.getMinutes()), ":").concat(pad(now.getSeconds()));
            }
            if (item.showDate) {
                var wd = [
                    "\u65E5",
                    "\u4E00",
                    "\u4E8C",
                    "\u4E09",
                    "\u56DB",
                    "\u4E94",
                    "\u516D"
                ][now.getDay()];
                dateEl.textContent = "".concat(now.getFullYear(), "年").concat(now.getMonth() + 1, "月").concat(now.getDate(), "日 星期").concat(wd);
            }
        };
        tick();
        var id = setInterval(tick, 1e3);
        return function() {
            return clearInterval(id);
        };
    }
    function renderQR(holder, item) {
        var content = item.content || item.text || "";
        var wrap = document.createElement("div");
        wrap.className = "w-qr-wrap";
        if (typeof window.LumaQRGen === "function") {
            var img = document.createElement("img");
            try {
                img.src = window.LumaQRGen(content);
            } catch (unused) {
                img.remove();
            }
            img.className = "w-qr";
            wrap.appendChild(img);
        } else {
            var box = document.createElement("div");
            box.className = "w-qr-fallback";
            box.innerHTML = '<div class="qr-glyph"></div><div class="qr-text">'.concat(esc(content), "</div>");
            wrap.appendChild(box);
        }
        if (item.showText !== false && content) {
            var cap = document.createElement("div");
            cap.className = "w-qr-caption";
            cap.textContent = content;
            wrap.appendChild(cap);
        }
        holder.appendChild(wrap);
        return function() {};
    }
    function renderMeeting(holder, item) {
        var d = document.createElement("div");
        d.className = "w-meeting";
        var fs = item.fontSize ? "font-size:".concat(item.fontSize, "px;") : "";
        d.style.cssText = fs;
        var room = esc(item.roomName || "\u4F1A\u8BAE\u5BA4");
        var status = item.busy ? "\u4F7F\u7528\u4E2D" : "\u7A7A\u95F2";
        d.innerHTML = '<div class="room">'.concat(room, '</div><div class="status">当前状态：').concat(status, "</div>") + (item.next ? '<div class="next">下一场：'.concat(esc(item.next), "</div>") : "");
        holder.appendChild(d);
        return function() {};
    }
    function renderHtml(holder, item) {
        var d = document.createElement("div");
        d.style.cssText = "width:100%;height:100%;";
        d.innerHTML = item.html || item.content || "";
        holder.appendChild(d);
        return function() {};
    }
    function pickPath(obj, path) {
        if (obj == null || !path) return obj;
        return String(path).split(".").reduce(function(o, k) {
            return o == null ? o : o[k];
        }, obj);
    }
    function renderTemplate(tpl, data) {
        if (!tpl) return "";
        return tpl.replace(/\{\{\s*data\.([^}]+?)\s*\}\}/g, function(m, p) {
            var v = pickPath(data, p.trim());
            return v == null ? "" : esc(v);
        });
    }
    function polar(cx, cy, r, deg) {
        var a = (deg - 90) * Math.PI / 180;
        return {
            x: cx + r * Math.cos(a),
            y: cy + r * Math.sin(a)
        };
    }
    function arcPath(cx, cy, r, a0, a1) {
        var s = polar(cx, cy, r, a1), e = polar(cx, cy, r, a0);
        var large = a1 - a0 <= 180 ? 0 : 1;
        return "M ".concat(s.x, " ").concat(s.y, " A ").concat(r, " ").concat(r, " 0 ").concat(large, " 0 ").concat(e.x, " ").concat(e.y, " Z");
    }
    function donutSeg(cx, cy, rO, rI, a0, a1) {
        var p0o = polar(cx, cy, rO, a0), p1o = polar(cx, cy, rO, a1);
        var p1i = polar(cx, cy, rI, a1), p0i = polar(cx, cy, rI, a0);
        var large = a1 - a0 <= 180 ? 0 : 1;
        return "M ".concat(p0o.x, " ").concat(p0o.y, " A ").concat(rO, " ").concat(rO, " 0 ").concat(large, " 1 ").concat(p1o.x, " ").concat(p1o.y, " L ").concat(p1i.x, " ").concat(p1i.y, " A ").concat(rI, " ").concat(rI, " 0 ").concat(large, " 0 ").concat(p0i.x, " ").concat(p0i.y, " Z");
    }
    function renderDataText(holder, item) {
        var d = document.createElement("div");
        d.className = "w-text " + (item.align || "center");
        var fs = item.fontSize ? "font-size:".concat(item.fontSize, "px;") : "";
        var color = item.color ? "color:".concat(item.color, ";") : "";
        var bg = item.bg ? "background:".concat(item.bg, ";") : "";
        d.style.cssText = fs + color + bg;
        holder.appendChild(d);
        var fallback2 = item.fallback || "\u6570\u636E\u52A0\u8F7D\u4E2D\u2026";
        var render = function render() {
            var data = item._getData ? item._getData(item.dataSourceId) : null;
            if (data == null) {
                d.textContent = fallback2;
                return;
            }
            d.innerHTML = renderTemplate(item.html || item.text || "", data);
        };
        render();
        var id = setInterval(render, 1e3);
        return function() {
            return clearInterval(id);
        };
    }
    function renderDataNumber(holder, item) {
        var wrap = document.createElement("div");
        wrap.className = "w-number " + (item.align || "center");
        wrap.style.cssText = item.color ? "color:".concat(item.color, ";") : "";
        var valEl = document.createElement("div");
        valEl.className = "num";
        var unitEl = document.createElement("div");
        unitEl.className = "unit";
        var labelEl = document.createElement("div");
        labelEl.className = "label";
        wrap.append(valEl, unitEl, labelEl);
        holder.appendChild(wrap);
        var render = function render() {
            var data = item._getData ? item._getData(item.dataSourceId) : null;
            if (data == null) {
                valEl.textContent = item.fallback || "\u2014";
                return;
            }
            var v = pickPath(data, item.valueField || "value");
            var num = Number(v);
            valEl.textContent = isNaN(num) ? v == null ? item.fallback || "\u2014" : String(v) : num.toLocaleString("zh-CN");
            unitEl.textContent = item.unit || "";
            labelEl.textContent = item.label || "";
        };
        render();
        var id = setInterval(render, 1e3);
        return function() {
            return clearInterval(id);
        };
    }
    function renderDataChart(holder, item) {
        var box = document.createElement("div");
        box.className = "w-chart";
        holder.appendChild(box);
        var W = 460, H = 260, palette = [
            "#2563EB",
            "#2DD4A7",
            "#F5B544",
            "#FF6B6E",
            "#8B5CF6",
            "#3B82F6",
            "#14B8A6",
            "#F97316"
        ];
        var render = function render() {
            var data = item._getData ? item._getData(item.dataSourceId) : null;
            var arr = Array.isArray(data) ? data : data ? [
                data
            ] : [];
            if (!arr.length) {
                box.innerHTML = '<div class="empty">'.concat(esc(item.fallback || "\u6682\u65E0\u6570\u636E"), "</div>");
                return;
            }
            var labelF = item.labelField || "label";
            var valueF = item.valueField || "value";
            var rows = arr.map(function(r) {
                var _r_labelF;
                return {
                    label: String((_r_labelF = r[labelF]) !== null && _r_labelF !== void 0 ? _r_labelF : ""),
                    value: Number(r[valueF]) || 0
                };
            });
            var type = item.chartType || "bar";
            var svg = "";
            if (type === "pie" || type === "donut") {
                var total = rows.reduce(function(s, r) {
                    return s + r.value;
                }, 0) || 1;
                var cx = W / 2, cy = H / 2, rO = Math.min(W, H) / 2 - 10, rI = type === "donut" ? rO * 0.55 : 0;
                var a0 = 0;
                svg = '<svg viewBox="0 0 '.concat(W, " ").concat(H, '" class="chart-svg" preserveAspectRatio="xMidYMid meet">');
                rows.forEach(function(r, i) {
                    var a1 = a0 + r.value / total * 360;
                    var color = palette[i % palette.length];
                    svg += type === "donut" ? '<path d="'.concat(donutSeg(cx, cy, rO, rI, a0, a1), '" fill="').concat(color, '"/>') : '<path d="'.concat(arcPath(cx, cy, rO, a0, a1), '" fill="').concat(color, '"/>');
                    a0 = a1;
                });
                svg += "</svg>";
            } else if (type === "line") {
                var _Math;
                var maxV = (_Math = Math).max.apply(_Math, [
                    1
                ].concat(_to_consumable_array(rows.map(function(r) {
                    return r.value;
                }))));
                var n = rows.length;
                var pad = 30;
                var bw = (W - pad * 2) / Math.max(1, n - 1);
                var pts = rows.map(function(r, i) {
                    return "".concat(pad + i * bw, ",").concat(H - pad - r.value / maxV * (H - pad * 2));
                });
                svg = '<svg viewBox="0 0 '.concat(W, " ").concat(H, '" class="chart-svg" preserveAspectRatio="xMidYMid meet"><polyline points="').concat(pts.join(" "), '" fill="none" stroke="').concat(palette[0], '" stroke-width="3"/>') + rows.map(function(r, i) {
                    return '<circle cx="'.concat(pad + i * bw, '" cy="').concat(H - pad - r.value / maxV * (H - pad * 2), '" r="4" fill="').concat(palette[0], '"/>');
                }).join("") + "</svg>";
            } else {
                var _Math1;
                var maxV1 = (_Math1 = Math).max.apply(_Math1, [
                    1
                ].concat(_to_consumable_array(rows.map(function(r) {
                    return r.value;
                }))));
                var n1 = rows.length;
                var padB = 28, padT = 10;
                var slot = W / n1;
                var bw1 = slot * 0.6;
                svg = '<svg viewBox="0 0 '.concat(W, " ").concat(H, '" class="chart-svg" preserveAspectRatio="xMidYMid meet">');
                rows.forEach(function(r, i) {
                    var h = r.value / maxV1 * (H - padB - padT);
                    var x = i * slot + (slot - bw1) / 2;
                    var y = H - padB - h;
                    var color = palette[i % palette.length];
                    svg += '<rect x="'.concat(x, '" y="').concat(y, '" width="').concat(bw1, '" height="').concat(h, '" rx="3" fill="').concat(color, '"/>');
                    svg += '<text x="'.concat(x + bw1 / 2, '" y="').concat(H - 8, '" text-anchor="middle" font-size="11" fill="currentColor">').concat(esc(r.label).slice(0, 8), "</text>");
                });
                svg += "</svg>";
            }
            box.innerHTML = svg;
        };
        render();
        var id = setInterval(render, 2e3);
        return function() {
            return clearInterval(id);
        };
    }
    function renderStars(container) {
        var _loop = function(i) {
            var s = document.createElement("span");
            s.textContent = "\u2605";
            s.style.cssText = "font-size:".concat(opts.size || 36, "px;color:").concat(i <= rating ? "#F5B544" : "rgba(255,255,255,.2)", ";cursor:pointer;transition:transform .15s,color .2s;line-height:1;");
            s.dataset.v = i;
            s.addEventListener("click", function() {
                rating = i;
                stars.forEach(function(st, idx) {
                    return st.style.color = idx < i ? "#F5B544" : "rgba(255,255,255,.2)";
                });
                if (opts.onChange) opts.onChange(i);
            });
            s.addEventListener("mouseenter", function() {
                stars.forEach(function(st, idx) {
                    return st.style.color = idx < i ? "#F5B544" : "rgba(255,255,255,.2)";
                });
            });
            s.addEventListener("mouseleave", function() {
                stars.forEach(function(st, idx) {
                    return st.style.color = idx < rating ? "#F5B544" : "rgba(255,255,255,.2)";
                });
            });
            stars.push(s);
            wrap.appendChild(s);
        };
        var opts = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
        var wrap = document.createElement("div");
        wrap.className = "form-stars";
        wrap.style.cssText = "display:flex;gap:8px;justify-content:center;";
        var rating = 0;
        var stars = [];
        for(var i = 1; i <= 5; i++)_loop(i);
        container.appendChild(wrap);
        return {
            getRating: function getRating() {
                return rating;
            }
        };
    }
    function renderForm(holder, item) {
        var d = document.createElement("div");
        d.className = "w-form";
        d.style.cssText = "width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;gap:16px;overflow:auto;";
        holder.appendChild(d);
        var formType = item.formType || "satisfaction";
        var title = item.formTitle || (formType === "satisfaction" ? "\u60A8\u5BF9\u6211\u4EEC\u7684\u670D\u52A1\u6EE1\u610F\u5417\uFF1F" : formType === "message" ? "\u7559\u8A00\u677F" : "\u7559\u4E0B\u8054\u7CFB\u65B9\u5F0F");
        var color = item.color || "#ffffff";
        var titleEl = document.createElement("div");
        titleEl.style.cssText = "font-size:".concat(item.titleSize || 28, "px;font-weight:600;color:").concat(color, ";text-align:center;");
        titleEl.textContent = title;
        d.appendChild(titleEl);
        var getValue;
        var statusEl = document.createElement("div");
        statusEl.style.cssText = "font-size:16px;opacity:0;height:0;overflow:hidden;transition:opacity .3s;";
        d.appendChild(statusEl);
        var showStatus = function showStatus(msg, ok) {
            statusEl.textContent = msg;
            statusEl.style.color = ok ? "#2DD4A7" : "#FF6B6E";
            statusEl.style.opacity = "1";
            statusEl.style.height = "auto";
            setTimeout(function() {
                statusEl.style.opacity = "0";
                statusEl.style.height = "0";
            }, 3e3);
        };
        var submitFeedback = function submitFeedback(payload) {
            return _async_to_generator(function() {
                var r, unused;
                return _ts_generator(this, function(_state) {
                    switch(_state.label){
                        case 0:
                            _state.trys.push([
                                0,
                                2,
                                ,
                                3
                            ]);
                            return [
                                4,
                                fetch("/api/t/form-feedback", {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json"
                                    },
                                    credentials: "same-origin",
                                    body: JSON.stringify(payload)
                                })
                            ];
                        case 1:
                            r = _state.sent();
                            if (r.ok) {
                                showStatus("\u63D0\u4EA4\u6210\u529F\uFF0C\u611F\u8C22\uFF01", true);
                                return [
                                    2,
                                    true
                                ];
                            }
                            showStatus("\u63D0\u4EA4\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", false);
                            return [
                                3,
                                3
                            ];
                        case 2:
                            unused = _state.sent();
                            showStatus("\u7F51\u7EDC\u5F02\u5E38", false);
                            return [
                                3,
                                3
                            ];
                        case 3:
                            return [
                                2,
                                false
                            ];
                    }
                });
            })();
        };
        if (formType === "satisfaction") {
            var getRating = renderStars(d, {
                size: item.starSize || 48
            }).getRating;
            getValue = function getValue() {
                return {
                    rating: getRating()
                };
            };
            var btn = document.createElement("button");
            btn.textContent = "\u63D0\u4EA4\u8BC4\u4EF7";
            btn.className = "form-btn";
            btn.style.cssText = "margin-top:8px;padding:12px 40px;font-size:20px;background:#2563EB;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;";
            btn.onclick = function() {
                return _async_to_generator(function() {
                    var v;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                v = getValue();
                                if (!v.rating) return [
                                    2,
                                    showStatus("\u8BF7\u5148\u9009\u62E9\u661F\u7EA7", false)
                                ];
                                return [
                                    4,
                                    submitFeedback(_object_spread({
                                        formType: formType,
                                        layoutId: item._layoutId,
                                        itemId: item.id
                                    }, v))
                                ];
                            case 1:
                                _state.sent();
                                return [
                                    2
                                ];
                        }
                    });
                })();
            };
            d.appendChild(btn);
        } else if (formType === "message") {
            var ta = document.createElement("textarea");
            ta.placeholder = item.placeholder || "\u8BF7\u8F93\u5165\u60A8\u7684\u610F\u89C1\u6216\u5EFA\u8BAE\u2026";
            ta.style.cssText = "width:min(480px,90%);height:120px;padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font-size:18px;resize:none;font-family:inherit;outline:none;";
            ta.addEventListener("focus", function() {
                ta.style.borderColor = "#2563EB";
            });
            ta.addEventListener("blur", function() {
                ta.style.borderColor = "rgba(255,255,255,.25)";
            });
            d.appendChild(ta);
            getValue = function getValue() {
                return {
                    message: ta.value.trim()
                };
            };
            var btn1 = document.createElement("button");
            btn1.textContent = "\u63D0\u4EA4\u7559\u8A00";
            btn1.className = "form-btn";
            btn1.style.cssText = "margin-top:8px;padding:12px 40px;font-size:20px;background:#2563EB;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;";
            btn1.onclick = function() {
                return _async_to_generator(function() {
                    var v, ok;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                v = getValue();
                                if (!v.message) return [
                                    2,
                                    showStatus("\u8BF7\u8F93\u5165\u5185\u5BB9", false)
                                ];
                                btn1.disabled = true;
                                btn1.textContent = "\u63D0\u4EA4\u4E2D\u2026";
                                return [
                                    4,
                                    submitFeedback(_object_spread({
                                        formType: formType,
                                        layoutId: item._layoutId,
                                        itemId: item.id
                                    }, v))
                                ];
                            case 1:
                                ok = _state.sent();
                                if (ok) {
                                    ta.value = "";
                                }
                                btn1.disabled = false;
                                btn1.textContent = "\u63D0\u4EA4\u7559\u8A00";
                                return [
                                    2
                                ];
                        }
                    });
                })();
            };
            d.appendChild(btn1);
        } else if (formType === "phone") {
            var row = function row(label, pholder) {
                var w = document.createElement("div");
                w.style.cssText = "display:flex;flex-direction:column;gap:4px;width:min(400px,90%);";
                var l = document.createElement("label");
                l.textContent = label;
                l.style.cssText = "font-size:15px;opacity:.7;";
                var i = document.createElement("input");
                i.type = pholder === "\u7535\u8BDD" ? "tel" : "text";
                i.placeholder = pholder;
                i.style.cssText = "padding:12px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font-size:18px;outline:none;";
                i.addEventListener("focus", function() {
                    i.style.borderColor = "#2563EB";
                });
                i.addEventListener("blur", function() {
                    i.style.borderColor = "rgba(255,255,255,.25)";
                });
                w.append(l, i);
                return {
                    wrap: w,
                    input: i
                };
            };
            var nameRow = row("\u59D3\u540D\uFF08\u9009\u586B\uFF09", "\u60A8\u7684\u59D3\u540D");
            var phoneRow = row("\u8054\u7CFB\u7535\u8BDD", "\u624B\u673A\u53F7\u7801");
            d.append(nameRow.wrap, phoneRow.wrap);
            getValue = function getValue() {
                return {
                    name: nameRow.input.value.trim(),
                    phone: phoneRow.input.value.trim()
                };
            };
            var btn2 = document.createElement("button");
            btn2.textContent = "\u63D0\u4EA4";
            btn2.className = "form-btn";
            btn2.style.cssText = "margin-top:8px;padding:12px 40px;font-size:20px;background:#2563EB;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;";
            btn2.onclick = function() {
                return _async_to_generator(function() {
                    var v;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                v = getValue();
                                if (!v.phone) return [
                                    2,
                                    showStatus("\u8BF7\u8F93\u5165\u8054\u7CFB\u7535\u8BDD", false)
                                ];
                                btn2.disabled = true;
                                btn2.textContent = "\u63D0\u4EA4\u4E2D\u2026";
                                return [
                                    4,
                                    submitFeedback(_object_spread({
                                        formType: formType,
                                        layoutId: item._layoutId,
                                        itemId: item.id
                                    }, v))
                                ];
                            case 1:
                                _state.sent();
                                btn2.disabled = false;
                                btn2.textContent = "\u63D0\u4EA4";
                                return [
                                    2
                                ];
                        }
                    });
                })();
            };
            d.appendChild(btn2);
        }
        return function() {};
    }
    var RENDERERS = {
        image: renderImage,
        video: renderVideo,
        text: renderText,
        marquee: renderMarquee,
        clock: renderClock,
        qrcode: renderQR,
        meeting: renderMeeting,
        html: renderHtml,
        "data-text": renderDataText,
        "data-number": renderDataNumber,
        "data-chart": renderDataChart,
        "form": renderForm
    };
    function renderWidget(holder, item, resolver, onEnd) {
        var fn = RENDERERS[item.widget] || renderText;
        return fn(holder, item, resolver, onEnd) || function() {};
    }
    // lumasign/player/engine.js
    var app = document.getElementById("app");
    var fallback = document.getElementById("fallback");
    var welcome = document.getElementById("welcome");
    var showFallback = function showFallback(msg) {
        fallback.innerHTML = '<div class="big">灵屏 LumaSign</div><div>'.concat(msg, "</div>");
        fallback.classList.remove("hidden");
    };
    var hideFallback = function hideFallback() {
        return fallback.classList.add("hidden");
    };
    var escapeHtml = function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function(c) {
            return ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            })[c];
        });
    };
    var native = function native(name) {
        return !!(window.LumaBridge && typeof window.LumaBridge[name] === "function");
    };
    var ymd = function ymd(d) {
        return "".concat(d.getFullYear(), "-").concat(String(d.getMonth() + 1).padStart(2, "0"), "-").concat(String(d.getDate()).padStart(2, "0"));
    };
    var toMin = function toMin(hhmm) {
        var _String_split_map = _sliced_to_array(String(hhmm).split(":").map(Number), 2), h = _String_split_map[0], m = _String_split_map[1];
        return h * 60 + (m || 0);
    };
    function inWindow(w) {
        var now = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : Date.now();
        if (!w) return true;
        if (w.from != null && now < w.from) return false;
        if (w.until != null && now > w.until) return false;
        return true;
    }
    function hits(sch) {
        var when = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : /* @__PURE__ */ new Date();
        if (sch.enabled === false) return false;
        var nowMs = when.getTime();
        if (!inWindow(sch.validity, nowMs)) return false;
        if (!inWindow(sch.layoutValidity, nowMs)) return false;
        var dk = ymd(when);
        if (sch.dateRange && sch.dateRange.length === 2) {
            var _sch_dateRange = _sliced_to_array(sch.dateRange, 2), from = _sch_dateRange[0], to = _sch_dateRange[1];
            if (from && dk < from) return false;
            if (to && dk > to) return false;
        }
        if (Array.isArray(sch.weekdays) && sch.weekdays.length && !sch.weekdays.includes(when.getDay())) return false;
        var slots = sch.timeSlots;
        if (Array.isArray(slots) && slots.length) {
            var cur = when.getHours() * 60 + when.getMinutes();
            var inSlot = slots.some(function(param) {
                var _param = _sliced_to_array(param, 2), a = _param[0], b = _param[1];
                var s = toMin(a), e = toMin(b);
                return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
            });
            if (!inSlot) return false;
        }
        if (sch.mode === "insert" && sch.expireAt && Date.now() > sch.expireAt) return false;
        return true;
    }
    function pickActiveSchedule(manifest) {
        var now = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : /* @__PURE__ */ new Date();
        var active = (manifest.schedules || []).filter(function(s) {
            return hits(s, now);
        });
        if (!active.length) return null;
        active.sort(function(a, b) {
            return b.priority - a.priority || (a.order || 0) - (b.order || 0);
        });
        return active[0];
    }
    var Player = /*#__PURE__*/ function() {
        "use strict";
        function Player() {
            _class_call_check(this, Player);
            this.ctl = {
                aborted: false
            };
            this.regionCtls = [];
            this.stage = null;
            this.layout = null;
            this.resolver = function(id) {
                return id;
            };
            this.mode = "preview";
            this.terminalId = null;
            this.token = null;
            this.pollTimer = null;
            this.hbTimer = null;
            this.es = null;
            this.currentScheduleId = null;
            this.lastManifest = null;
            this._cachedTried = false;
            this.navStack = [];
            this.navBar = null;
            this.navTimer = null;
        }
        _create_class(Player, [
            {
                key: "stop",
                value: function stop() {
                    this.ctl.aborted = true;
                    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                    try {
                        for(var _iterator = this.regionCtls[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
                            var c = _step.value;
                            c.aborted = true;
                        }
                    } catch (err) {
                        _didIteratorError = true;
                        _iteratorError = err;
                    } finally{
                        try {
                            if (!_iteratorNormalCompletion && _iterator.return != null) {
                                _iterator.return();
                            }
                        } finally{
                            if (_didIteratorError) {
                                throw _iteratorError;
                            }
                        }
                    }
                    if (this.pollTimer) {
                        clearInterval(this.pollTimer);
                        this.pollTimer = null;
                    }
                    if (this.hbTimer) {
                        clearInterval(this.hbTimer);
                        this.hbTimer = null;
                    }
                    if (this.es) {
                        try {
                            this.es.close();
                        } catch (unused) {}
                        this.es = null;
                    }
                    if (this._dsTimer) {
                        clearInterval(this._dsTimer);
                        this._dsTimer = null;
                    }
                    app.innerHTML = "";
                    this.stage = null;
                    this.regionCtls = [];
                    this.hotspotsLayer = null;
                    if (this.navBar && this.navBar.parentNode) this.navBar.remove();
                    this.navBar = null;
                    this.cancelNavTimer();
                }
            },
            {
                /* ---------------- 欢迎页（终端无展示任务时展示） ---------------- */ key: "hideWelcome",
                value: function hideWelcome() {
                    if (welcome) welcome.classList.add("hidden");
                }
            },
            {
                key: "showWelcome",
                value: function showWelcome() {
                    return _async_to_generator(function() {
                        var ip, r, hw, model;
                        return _ts_generator(this, function(_state) {
                            this.stop();
                            hideFallback();
                            if (!welcome) return [
                                2
                            ];
                            ip = "";
                            try {
                                if (native("getIpAddress")) {
                                    r = window.LumaBridge.getIpAddress();
                                    ip = typeof r === "string" ? r.trim() : "";
                                }
                            } catch (e) {}
                            hw = this._hwInfo || {};
                            model = hw.model || "";
                            welcome.innerHTML = '<div class="welcome-ip">\u672C\u673AIP\uFF1A' + (ip || "\u672A\u8FDE\u63A5") + '</div><div class="welcome-center"><div class="welcome-title">\u7075\u5C4F\u7535\u5B50\u5C4F\u7BA1\u7406\u7528\u7CFB\u7EDF</div><div class="welcome-sub">LumaSign \xB7 \u5C40\u57DF\u7F51\u6570\u5B57\u6807\u724C</div>' + (model ? '<div class="welcome-sub" style="font-size:16px;opacity:.4;margin-top:8px">' + escapeHtml(model) + "</div>" : "") + '<div class="welcome-pulse"></div></div>';
                            welcome.classList.remove("hidden");
                            return [
                                2
                            ];
                        });
                    }).call(this);
                }
            },
            {
                key: "load",
                value: /** opts.resolver: (mediaId)=>url; opts.fromNav=true 表示来自导航栈跳转（不清空栈） */ function load(_0) {
                    return _async_to_generator(function(layout) {
                        var _this, opts;
                        var _arguments = arguments;
                        return _ts_generator(this, function(_state) {
                            _this = this;
                            opts = _arguments.length > 1 && _arguments[1] !== void 0 ? _arguments[1] : {};
                            this.stop();
                            this.ctl = {
                                aborted: false
                            };
                            this.layout = layout;
                            this.resolver = opts.resolver || function(id) {
                                return id;
                            };
                            this.mode = opts.mode || "preview";
                            this.dsCache = {};
                            this._dsIds = [];
                            if (!opts.fromNav) {
                                this.navStack = [];
                                this.cancelNavTimer();
                            }
                            hideFallback();
                            this.buildStage(layout);
                            this.startRegions(layout);
                            this.primeDataSources().catch(function() {}).finally(function() {
                                return _this.startDataSourcePolling();
                            });
                            if (this._keepEditMode) this.setEditMode(true);
                            if (this.mode === "term") {
                                this.startPolling();
                                this.startCommands();
                                this.startHeartbeat();
                            }
                            return [
                                2
                            ];
                        });
                    }).apply(this, arguments);
                }
            },
            {
                key: "fetchDataSourceData",
                value: /* ---------------- P1 动态数据源：拉取与缓存 ---------------- */ function fetchDataSourceData(id) {
                    return _async_to_generator(function() {
                        var base, _d_data, r, d, unused;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    if (!id) return [
                                        2,
                                        null
                                    ];
                                    base = this.mode === "term" && this.terminalId ? "/api/t/datasource/".concat(id, "?terminalId=").concat(encodeURIComponent(this.terminalId), "&token=").concat(encodeURIComponent(this.token || "")) : "/api/admin/datasources/".concat(id, "/data");
                                    _state.label = 1;
                                case 1:
                                    _state.trys.push([
                                        1,
                                        4,
                                        ,
                                        5
                                    ]);
                                    return [
                                        4,
                                        fetch(base, {
                                            credentials: "same-origin"
                                        })
                                    ];
                                case 2:
                                    r = _state.sent();
                                    if (!r.ok) return [
                                        2,
                                        null
                                    ];
                                    return [
                                        4,
                                        r.json()
                                    ];
                                case 3:
                                    d = _state.sent();
                                    return [
                                        2,
                                        (_d_data = d.data) !== null && _d_data !== void 0 ? _d_data : null
                                    ];
                                case 4:
                                    unused = _state.sent();
                                    return [
                                        2,
                                        null
                                    ];
                                case 5:
                                    return [
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                key: "primeDataSources",
                value: function primeDataSources() {
                    return _async_to_generator(function() {
                        var _this, _this_layout, ids, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, r, _iteratorNormalCompletion1, _didIteratorError1, _iteratorError1, _iterator1, _step1, it;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _this = this;
                                    ids = /* @__PURE__ */ new Set();
                                    _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                                    try {
                                        for(_iterator = (((_this_layout = this.layout) === null || _this_layout === void 0 ? void 0 : _this_layout.regions) || [])[Symbol.iterator](); !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
                                            r = _step.value;
                                            _iteratorNormalCompletion1 = true, _didIteratorError1 = false, _iteratorError1 = undefined;
                                            try {
                                                for(_iterator1 = (r.items || [])[Symbol.iterator](); !(_iteratorNormalCompletion1 = (_step1 = _iterator1.next()).done); _iteratorNormalCompletion1 = true){
                                                    it = _step1.value;
                                                    if (it.dataSourceId) ids.add(it.dataSourceId);
                                                }
                                            } catch (err) {
                                                _didIteratorError1 = true;
                                                _iteratorError1 = err;
                                            } finally{
                                                try {
                                                    if (!_iteratorNormalCompletion1 && _iterator1.return != null) {
                                                        _iterator1.return();
                                                    }
                                                } finally{
                                                    if (_didIteratorError1) {
                                                        throw _iteratorError1;
                                                    }
                                                }
                                            }
                                        }
                                    } catch (err) {
                                        _didIteratorError = true;
                                        _iteratorError = err;
                                    } finally{
                                        try {
                                            if (!_iteratorNormalCompletion && _iterator.return != null) {
                                                _iterator.return();
                                            }
                                        } finally{
                                            if (_didIteratorError) {
                                                throw _iteratorError;
                                            }
                                        }
                                    }
                                    this._dsIds = _to_consumable_array(ids);
                                    if (!this._dsIds.length) return [
                                        2
                                    ];
                                    return [
                                        4,
                                        Promise.all(this._dsIds.map(function(id) {
                                            return _async_to_generator(function() {
                                                var _;
                                                return _ts_generator(this, function(_state) {
                                                    switch(_state.label){
                                                        case 0:
                                                            _ = this.dsCache;
                                                            return [
                                                                4,
                                                                this.fetchDataSourceData(id)
                                                            ];
                                                        case 1:
                                                            _[id] = _state.sent();
                                                            return [
                                                                2
                                                            ];
                                                    }
                                                });
                                            }).call(_this);
                                        }))
                                    ];
                                case 1:
                                    _state.sent();
                                    return [
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                key: "startDataSourcePolling",
                value: function startDataSourcePolling() {
                    var _this = this;
                    var _this__dsTimer_unref, _this__dsTimer;
                    if (this._dsTimer || !this._dsIds.length) return;
                    this._dsTimer = setInterval(function() {
                        return _async_to_generator(function() {
                            var _this_ctl, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, id, data, err;
                            return _ts_generator(this, function(_state) {
                                switch(_state.label){
                                    case 0:
                                        if (!this._dsIds.length || ((_this_ctl = this.ctl) === null || _this_ctl === void 0 ? void 0 : _this_ctl.aborted)) return [
                                            2
                                        ];
                                        _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                                        _state.label = 1;
                                    case 1:
                                        _state.trys.push([
                                            1,
                                            6,
                                            7,
                                            8
                                        ]);
                                        _iterator = this._dsIds[Symbol.iterator]();
                                        _state.label = 2;
                                    case 2:
                                        if (!!(_iteratorNormalCompletion = (_step = _iterator.next()).done)) return [
                                            3,
                                            5
                                        ];
                                        id = _step.value;
                                        return [
                                            4,
                                            this.fetchDataSourceData(id)
                                        ];
                                    case 3:
                                        data = _state.sent();
                                        if (data !== null) this.dsCache[id] = data;
                                        _state.label = 4;
                                    case 4:
                                        _iteratorNormalCompletion = true;
                                        return [
                                            3,
                                            2
                                        ];
                                    case 5:
                                        return [
                                            3,
                                            8
                                        ];
                                    case 6:
                                        err = _state.sent();
                                        _didIteratorError = true;
                                        _iteratorError = err;
                                        return [
                                            3,
                                            8
                                        ];
                                    case 7:
                                        try {
                                            if (!_iteratorNormalCompletion && _iterator.return != null) {
                                                _iterator.return();
                                            }
                                        } finally{
                                            if (_didIteratorError) {
                                                throw _iteratorError;
                                            }
                                        }
                                        return [
                                            7
                                        ];
                                    case 8:
                                        return [
                                            2
                                        ];
                                }
                            });
                        }).call(_this);
                    }, 3e4);
                    (_this__dsTimer_unref = (_this__dsTimer = this._dsTimer).unref) === null || _this__dsTimer_unref === void 0 ? void 0 : _this__dsTimer_unref.call(_this__dsTimer);
                }
            },
            {
                key: "buildStage",
                value: function buildStage(layout) {
                    var _this = this;
                    var stage = document.createElement("div");
                    stage.className = "stage";
                    stage.style.width = (layout.width || 1920) + "px";
                    stage.style.height = (layout.height || 1080) + "px";
                    var bg = layout.background || {};
                    if (bg.mediaId) {
                        var url = this.resolver(bg.mediaId);
                        var isVideo = /\.(mp4|webm|mov|m4v)$/i.test(url) || bg.mime && bg.mime.startsWith("video");
                        if (isVideo) {
                            var v = document.createElement("video");
                            v.src = url;
                            v.autoplay = true;
                            v.loop = true;
                            v.muted = true;
                            v.playsInline = true;
                            v.className = "bg-media";
                            stage.appendChild(v);
                        } else {
                            var img = document.createElement("img");
                            img.src = url;
                            img.className = "bg-media";
                            stage.appendChild(img);
                        }
                    } else {
                        stage.style.background = bg.color || "#000";
                    }
                    app.appendChild(stage);
                    this.stage = stage;
                    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                    try {
                        for(var _iterator = (layout.regions || [])[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
                            var r = _step.value;
                            var el2 = document.createElement("div");
                            el2.className = "region";
                            el2.dataset.transition = r.transition || "fade";
                            el2.style.left = (r.x || 0) + "px";
                            el2.style.top = (r.y || 0) + "px";
                            el2.style.width = (r.w || 0) + "px";
                            el2.style.height = (r.h || 0) + "px";
                            el2.style.zIndex = r.z || 1;
                            stage.appendChild(el2);
                            r._el = el2;
                        }
                    } catch (err) {
                        _didIteratorError = true;
                        _iteratorError = err;
                    } finally{
                        try {
                            if (!_iteratorNormalCompletion && _iterator.return != null) {
                                _iterator.return();
                            }
                        } finally{
                            if (_didIteratorError) {
                                throw _iteratorError;
                            }
                        }
                    }
                    this.hotspotsLayer = null;
                    this.renderHotspots();
                    this.renderNavBar();
                    this.rescale();
                    window.addEventListener("resize", this._onResize = function() {
                        return _this.rescale();
                    });
                }
            },
            {
                key: "rescale",
                value: function rescale() {
                    if (!this.stage || !this.layout) return;
                    var W = this.layout.width || 1920, H = this.layout.height || 1080;
                    var sw = window.innerWidth, sh = window.innerHeight;
                    var s = Math.min(sw / W, sh / H);
                    var ox = (sw - W * s) / 2, oy = (sh - H * s) / 2;
                    this.stage.style.transform = "translate(".concat(ox, "px, ").concat(oy, "px) scale(").concat(s, ")");
                }
            },
            {
                key: "startRegions",
                value: function startRegions(layout) {
                    var _this = this;
                    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                    try {
                        for(var _iterator = (layout.regions || [])[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
                            var r = _step.value;
                            var _iteratorNormalCompletion1 = true, _didIteratorError1 = false, _iteratorError1 = undefined;
                            try {
                                for(var _iterator1 = (r.items || [])[Symbol.iterator](), _step1; !(_iteratorNormalCompletion1 = (_step1 = _iterator1.next()).done); _iteratorNormalCompletion1 = true){
                                    var it = _step1.value;
                                    it._getData = function(id) {
                                        return _this.dsCache[id];
                                    };
                                }
                            } catch (err) {
                                _didIteratorError1 = true;
                                _iteratorError1 = err;
                            } finally{
                                try {
                                    if (!_iteratorNormalCompletion1 && _iterator1.return != null) {
                                        _iterator1.return();
                                    }
                                } finally{
                                    if (_didIteratorError1) {
                                        throw _iteratorError1;
                                    }
                                }
                            }
                            if (r._el) this.runRegion(r);
                        }
                    } catch (err) {
                        _didIteratorError = true;
                        _iteratorError = err;
                    } finally{
                        try {
                            if (!_iteratorNormalCompletion && _iterator.return != null) {
                                _iterator.return();
                            }
                        } finally{
                            if (_didIteratorError) {
                                throw _iteratorError;
                            }
                        }
                    }
                }
            },
            {
                /* ================= P1 交互式触摸热区 ================= */ /** 编辑器可挂载的回调：选中热区 / 热区变更（用于同步侧栏面板与持久化） */ key: "onHotspotSelect",
                value: function onHotspotSelect(hs) {
                    if (this._onSelect) this._onSelect(hs);
                }
            },
            {
                key: "onHotspotChange",
                value: function onHotspotChange() {
                    if (this._onChange) this._onChange();
                }
            },
            {
                key: "setHotspotHandlers",
                value: function setHotspotHandlers(param) {
                    var onSelect = param.onSelect, onChange = param.onChange;
                    this._onSelect = onSelect;
                    this._onChange = onChange;
                }
            },
            {
                key: "setEditMode",
                value: function setEditMode(on) {
                    this.editMode = !!on;
                    this._keepEditMode = !!on;
                    if (this.hotspotsLayer) {
                        this.hotspotsLayer.classList.toggle("editing", this.editMode);
                        this.renderHotspots();
                    }
                }
            },
            {
                key: "ensureHotspotLayer",
                value: function ensureHotspotLayer() {
                    var _this = this;
                    if (this.hotspotsLayer) return this.hotspotsLayer;
                    var layer = document.createElement("div");
                    layer.className = "hotspot-layer";
                    layer.classList.toggle("editing", this.editMode);
                    this.stage.appendChild(layer);
                    this.hotspotsLayer = layer;
                    layer.addEventListener("pointerdown", function(e) {
                        if (!_this.editMode || e.target !== layer) return;
                        e.preventDefault();
                        var rect = _this.stage.getBoundingClientRect();
                        var sx = _this.layout.width / rect.width, sy = _this.layout.height / rect.height;
                        var ox = (e.clientX - rect.left) * sx, oy = (e.clientY - rect.top) * sy;
                        var tmp = {
                            x: ox,
                            y: oy,
                            w: 0,
                            h: 0
                        };
                        var move = function move(ev) {
                            tmp.w = Math.max(0, (ev.clientX - rect.left) * sx - ox);
                            tmp.h = Math.max(0, (ev.clientY - rect.top) * sy - oy);
                            var el2 = layer.querySelector(".hs-draft");
                            if (el2) {
                                el2.style.width = tmp.w + "px";
                                el2.style.height = tmp.h + "px";
                            }
                        };
                        var up = function up1(ev) {
                            layer.removeEventListener("pointermove", move);
                            layer.removeEventListener("pointerup", up);
                            var draft2 = layer.querySelector(".hs-draft");
                            if (draft2) draft2.remove();
                            var w = Math.max(0, (ev.clientX - rect.left) * sx - ox);
                            var h = Math.max(0, (ev.clientY - rect.top) * sy - oy);
                            if (w < 20 || h < 20) return;
                            var hs = {
                                id: "hs_" + Math.random().toString(36).slice(2, 9),
                                x: Math.round(ox),
                                y: Math.round(oy),
                                w: Math.round(w),
                                h: Math.round(h),
                                shape: "rect",
                                action: {
                                    type: "popup",
                                    target: "",
                                    label: "",
                                    duration: 10
                                }
                            };
                            _this.layout.hotspots = _this.layout.hotspots || [];
                            _this.layout.hotspots.push(hs);
                            _this.renderHotspots();
                            _this.onHotspotSelect(hs);
                            _this.onHotspotChange();
                        };
                        var draft = document.createElement("div");
                        draft.className = "hotspot hs-draft";
                        draft.style.left = ox + "px";
                        draft.style.top = oy + "px";
                        layer.appendChild(draft);
                        layer.addEventListener("pointermove", move);
                        layer.addEventListener("pointerup", up);
                    });
                    return layer;
                }
            },
            {
                key: "renderHotspots",
                value: function renderHotspots() {
                    var _this = this;
                    if (!this.stage) return;
                    var layer = this.ensureHotspotLayer();
                    layer.innerHTML = "";
                    var interactive = this.editMode || this.mode === "term";
                    layer.style.pointerEvents = interactive ? "auto" : "none";
                    layer.classList.toggle("editing", this.editMode);
                    var list = this.layout && this.layout.hotspots || [];
                    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                    try {
                        var _this1, _loop = function() {
                            var hs = _step.value;
                            var el2 = document.createElement("div");
                            el2.className = "hotspot" + (hs.shape === "circle" ? " circle" : "");
                            el2.dataset.id = hs.id;
                            el2.style.left = hs.x + "px";
                            el2.style.top = hs.y + "px";
                            el2.style.width = hs.w + "px";
                            el2.style.height = hs.h + "px";
                            el2.style.pointerEvents = interactive ? "auto" : "none";
                            if (_this1.editMode) {
                                el2.classList.add("editing");
                                var lbl = document.createElement("span");
                                lbl.className = "hs-label";
                                lbl.textContent = hs.action && hs.action.label || hs.action && hs.action.type || "\u70ED\u533A";
                                el2.appendChild(lbl);
                                var handle = document.createElement("div");
                                handle.className = "hs-handle";
                                el2.appendChild(handle);
                                _this1._bindHotspotInteractions(el2, hs);
                            } else if (_this1.mode === "term") {
                                el2.addEventListener("click", function(e) {
                                    e.stopPropagation();
                                    _this.dispatchHotspot(hs);
                                });
                            }
                            layer.appendChild(el2);
                        };
                        for(var _iterator = list[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true)_this1 = this, _loop();
                    } catch (err) {
                        _didIteratorError = true;
                        _iteratorError = err;
                    } finally{
                        try {
                            if (!_iteratorNormalCompletion && _iterator.return != null) {
                                _iterator.return();
                            }
                        } finally{
                            if (_didIteratorError) {
                                throw _iteratorError;
                            }
                        }
                    }
                }
            },
            {
                key: "_bindHotspotInteractions",
                value: function _bindHotspotInteractions(el2, hs) {
                    var _this = this;
                    var startMove = function startMove(e) {
                        if (e.target.classList.contains("hs-handle")) return;
                        e.preventDefault();
                        e.stopPropagation();
                        _this.onHotspotSelect(hs);
                        var rect = _this.stage.getBoundingClientRect();
                        var sx = _this.layout.width / rect.width, sy = _this.layout.height / rect.height;
                        var ox = e.clientX, oy = e.clientY;
                        var orig = {
                            x: hs.x,
                            y: hs.y
                        };
                        var move = function move(ev) {
                            hs.x = Math.round(orig.x + (ev.clientX - ox) * sx);
                            hs.y = Math.round(orig.y + (ev.clientY - oy) * sy);
                            el2.style.left = hs.x + "px";
                            el2.style.top = hs.y + "px";
                        };
                        var up = function up() {
                            layer_unbind();
                            _this.onHotspotChange();
                        };
                        var layer_unbind = function layer_unbind() {
                            window.removeEventListener("pointermove", move);
                            window.removeEventListener("pointerup", up);
                        };
                        window.addEventListener("pointermove", move);
                        window.addEventListener("pointerup", up);
                    };
                    var handle = el2.querySelector(".hs-handle");
                    var startResize = function startResize(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var rect = _this.stage.getBoundingClientRect();
                        var sx = _this.layout.width / rect.width, sy = _this.layout.height / rect.height;
                        var ox = e.clientX, oy = e.clientY;
                        var orig = {
                            x: hs.x,
                            y: hs.y,
                            w: hs.w,
                            h: hs.h
                        };
                        var move = function move(ev) {
                            hs.w = Math.max(20, Math.round(orig.w + (ev.clientX - ox) * sx));
                            hs.h = Math.max(20, Math.round(orig.h + (ev.clientY - oy) * sy));
                            el2.style.width = hs.w + "px";
                            el2.style.height = hs.h + "px";
                        };
                        var up = function up1() {
                            window.removeEventListener("pointermove", move);
                            window.removeEventListener("pointerup", up);
                            _this.onHotspotChange();
                        };
                        window.addEventListener("pointermove", move);
                        window.addEventListener("pointerup", up);
                    };
                    el2.addEventListener("pointerdown", startMove);
                    if (handle) handle.addEventListener("pointerdown", startResize);
                }
            },
            {
                key: "renderNavBar",
                value: function renderNavBar() {
                    var _this = this;
                    var _this__pendingAutoReturn;
                    var _this_layout;
                    if (this.navBar && this.navBar.parentNode) this.navBar.remove();
                    if (this.navStack.length === 0) {
                        this.navBar = null;
                        return;
                    }
                    var bar = document.createElement("div");
                    bar.className = "hs-navbar";
                    var prev = this.navStack[this.navStack.length - 1];
                    var crumbs = [
                        el("span", {
                            text: "\uD83C\uDFE0 主界面"
                        })
                    ];
                    for(var i = 0; i < this.navStack.length; i++){
                        crumbs.push(el("span", {
                            class: "hs-nav-sep",
                            text: " \u203A "
                        }));
                        crumbs.push(el("span", {
                            text: this.navStack[i].name || "节目".concat(i + 1)
                        }));
                    }
                    var backBtn = document.createElement("button");
                    backBtn.className = "hs-nav-back";
                    backBtn.textContent = "\u2190 \u8FD4\u56DE";
                    backBtn.onclick = function() {
                        return _this.goBack();
                    };
                    bar.append(backBtn, el.apply(void 0, [
                        "div",
                        {
                            class: "hs-nav-crumbs"
                        }
                    ].concat(_to_consumable_array(crumbs))));
                    document.body.appendChild(bar);
                    this.navBar = bar;
                    var autoReturnSecs = (_this__pendingAutoReturn = this._pendingAutoReturn) !== null && _this__pendingAutoReturn !== void 0 ? _this__pendingAutoReturn : ((_this_layout = this.layout) === null || _this_layout === void 0 ? void 0 : _this_layout._autoReturnSeconds) || 0;
                    if (autoReturnSecs > 0) this.startAutoReturn(autoReturnSecs);
                }
            },
            {
                key: "addHotspot",
                value: function addHotspot(hs) {
                    this.layout.hotspots = this.layout.hotspots || [];
                    this.layout.hotspots.push(hs);
                    this.renderHotspots();
                    this.onHotspotChange();
                }
            },
            {
                key: "updateHotspot",
                value: function updateHotspot(id, patch) {
                    var hs = (this.layout.hotspots || []).find(function(x) {
                        return x.id === id;
                    });
                    if (!hs) return;
                    Object.assign(hs, patch);
                    this.renderHotspots();
                    this.onHotspotChange();
                }
            },
            {
                key: "removeHotspot",
                value: function removeHotspot(id) {
                    this.layout.hotspots = (this.layout.hotspots || []).filter(function(x) {
                        return x.id !== id;
                    });
                    this.renderHotspots();
                    this.onHotspotChange();
                }
            },
            {
                key: "addHotspotCenter",
                value: function addHotspotCenter() {
                    var W = this.layout.width || 1920, H = this.layout.height || 1080;
                    var w = Math.round(W * 0.3), h = Math.round(H * 0.2);
                    var hs = {
                        id: "hs_" + Math.random().toString(36).slice(2, 9),
                        x: Math.round((W - w) / 2),
                        y: Math.round((H - h) / 2),
                        w: w,
                        h: h,
                        shape: "rect",
                        action: {
                            type: "popup",
                            target: "",
                            label: "\u70ED\u533A",
                            duration: 10
                        }
                    };
                    this.addHotspot(hs);
                    this.onHotspotSelect(hs);
                }
            },
            {
                key: "dispatchHotspot",
                value: function dispatchHotspot(hs) {
                    var cooldown = hs.cooldownMs || 800;
                    if (this._hsCooldownMap == null) this._hsCooldownMap = /* @__PURE__ */ new Map();
                    var lastClick = this._hsCooldownMap.get(hs.id) || 0;
                    if (Date.now() - lastClick < cooldown) return;
                    this._hsCooldownMap.set(hs.id, Date.now());
                    this.spawnRipple(hs);
                    this.trackInteraction("hotspot_click", hs.id);
                    var a = hs.action || {
                        type: "none"
                    };
                    if (a.type === "url") {
                        var url = a.target || "";
                        if (!url) return;
                        if (window.LumaBridge && window.LumaBridge.openUrl) window.LumaBridge.openUrl(url);
                        else window.open(url, "_blank");
                    } else if (a.type === "layout") {
                        if (a.target) this.gotoLayout(a.target, a.autoReturnSeconds);
                    } else if (a.type === "popup") {
                        this.showPopup(a);
                    }
                }
            },
            {
                key: "gotoLayout",
                value: function gotoLayout(id, autoReturnSecs) {
                    return _async_to_generator(function() {
                        var base, r, d, item, e;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    if (this.layout && this.layout.id) {
                                        this.navStack.push({
                                            id: this.layout.id,
                                            name: this.layout.name || "\u4E3B\u754C\u9762"
                                        });
                                    }
                                    this.cancelNavTimer();
                                    if (typeof autoReturnSecs === "number" && autoReturnSecs > 0) {
                                        this._pendingAutoReturn = autoReturnSecs;
                                    } else {
                                        this._pendingAutoReturn = null;
                                    }
                                    base = this.mode === "term" && this.terminalId ? "/api/t/layout/".concat(encodeURIComponent(id), "?terminalId=").concat(encodeURIComponent(this.terminalId), "&token=").concat(encodeURIComponent(this.token || "")) : "/api/layouts/".concat(encodeURIComponent(id));
                                    _state.label = 1;
                                case 1:
                                    _state.trys.push([
                                        1,
                                        4,
                                        ,
                                        5
                                    ]);
                                    return [
                                        4,
                                        fetch(base, {
                                            credentials: "same-origin"
                                        })
                                    ];
                                case 2:
                                    r = _state.sent();
                                    if (!r.ok) {
                                        console.warn("gotoLayout failed", r.status);
                                        return [
                                            2
                                        ];
                                    }
                                    return [
                                        4,
                                        r.json()
                                    ];
                                case 3:
                                    d = _state.sent();
                                    item = d.item || d;
                                    if (item && item.regions) this.load(item, {
                                        resolver: this.resolver,
                                        mode: this.mode,
                                        fromNav: true
                                    });
                                    return [
                                        3,
                                        5
                                    ];
                                case 4:
                                    e = _state.sent();
                                    console.warn("gotoLayout error", e);
                                    return [
                                        3,
                                        5
                                    ];
                                case 5:
                                    return [
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                /* ---------------- 交互埋点（P1 交互式节目） ---------------- */ key: "trackInteraction",
                value: function trackInteraction(type, itemId) {
                    var _this = this;
                    if (this.mode !== "term") return;
                    var layoutId = this.layout && this.layout.id;
                    if (!layoutId) return;
                    this._iaQueue = this._iaQueue || [];
                    this._iaQueue.push({
                        layoutId: layoutId,
                        itemId: itemId || "",
                        type: type,
                        terminalId: this.terminalId || ""
                    });
                    if (this._iaTimer) return;
                    this._iaTimer = setTimeout(function() {
                        _this._iaTimer = null;
                        _this._flushInteractions();
                    }, 1200);
                }
            },
            {
                key: "_flushInteractions",
                value: function _flushInteractions() {
                    return _async_to_generator(function() {
                        var q, hdr, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, ev, e, err;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    q = this._iaQueue;
                                    if (!q || !q.length) return [
                                        2
                                    ];
                                    this._iaQueue = [];
                                    hdr = {
                                        "Content-Type": "application/json",
                                        "x-terminal-id": this.terminalId || ""
                                    };
                                    _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                                    _state.label = 1;
                                case 1:
                                    _state.trys.push([
                                        1,
                                        8,
                                        9,
                                        10
                                    ]);
                                    _iterator = q[Symbol.iterator]();
                                    _state.label = 2;
                                case 2:
                                    if (!!(_iteratorNormalCompletion = (_step = _iterator.next()).done)) return [
                                        3,
                                        7
                                    ];
                                    ev = _step.value;
                                    _state.label = 3;
                                case 3:
                                    _state.trys.push([
                                        3,
                                        5,
                                        ,
                                        6
                                    ]);
                                    return [
                                        4,
                                        fetch("/api/interaction", {
                                            method: "POST",
                                            headers: hdr,
                                            body: JSON.stringify(ev)
                                        })
                                    ];
                                case 4:
                                    _state.sent();
                                    return [
                                        3,
                                        6
                                    ];
                                case 5:
                                    e = _state.sent();
                                    return [
                                        3,
                                        6
                                    ];
                                case 6:
                                    _iteratorNormalCompletion = true;
                                    return [
                                        3,
                                        2
                                    ];
                                case 7:
                                    return [
                                        3,
                                        10
                                    ];
                                case 8:
                                    err = _state.sent();
                                    _didIteratorError = true;
                                    _iteratorError = err;
                                    return [
                                        3,
                                        10
                                    ];
                                case 9:
                                    try {
                                        if (!_iteratorNormalCompletion && _iterator.return != null) {
                                            _iterator.return();
                                        }
                                    } finally{
                                        if (_didIteratorError) {
                                            throw _iteratorError;
                                        }
                                    }
                                    return [
                                        7
                                    ];
                                case 10:
                                    return [
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                key: "goBack",
                value: function goBack() {
                    var _this = this;
                    if (this.navStack.length === 0) return;
                    this.cancelNavTimer();
                    var prev = this.navStack.pop();
                    var base = this.mode === "term" && this.terminalId ? "/api/t/layout/".concat(encodeURIComponent(prev.id), "?terminalId=").concat(encodeURIComponent(this.terminalId), "&token=").concat(encodeURIComponent(this.token || "")) : "/api/layouts/".concat(encodeURIComponent(prev.id));
                    fetch(base, {
                        credentials: "same-origin"
                    }).then(function(r) {
                        return r.ok ? r.json() : null;
                    }).then(function(d) {
                        var item = (d === null || d === void 0 ? void 0 : d.item) || d;
                        if (item === null || item === void 0 ? void 0 : item.regions) _this.load(item, {
                            resolver: _this.resolver,
                            mode: _this.mode,
                            fromNav: true
                        });
                    }).catch(function() {});
                }
            },
            {
                key: "cancelNavTimer",
                value: function cancelNavTimer() {
                    if (this.navTimer) {
                        clearTimeout(this.navTimer);
                        this.navTimer = null;
                    }
                }
            },
            {
                key: "startAutoReturn",
                value: function startAutoReturn(seconds) {
                    var _this = this;
                    this.cancelNavTimer();
                    if (!seconds || seconds <= 0) return;
                    this.navTimer = setTimeout(function() {
                        if (_this.navStack.length > 0) _this.goBack();
                        else _this.cancelNavTimer();
                    }, seconds * 1e3);
                }
            },
            {
                /** P1-3.4 热区点击涟漪动效（纯 CSS，零依赖） */ key: "spawnRipple",
                value: function spawnRipple(hs) {
                    if (!this.hotspotsLayer) return;
                    var el2 = this.hotspotsLayer.querySelector('[data-id="'.concat(hs.id, '"]'));
                    if (!el2) return;
                    var rect = el2.getBoundingClientRect();
                    var stageRect = this.stage.getBoundingClientRect();
                    var ripple = document.createElement("div");
                    ripple.className = "hs-ripple";
                    ripple.style.cssText = "\n      position:absolute;left:".concat(rect.left - stageRect.left + rect.width / 2, "px;top:").concat(rect.top - stageRect.top + rect.height / 2, "px;\n      width:10px;height:10px;margin-left:-5px;margin-top:-5px;\n      border-radius:50%;background:rgba(37,99,235,.5);\n      pointer-events:none;z-index:99999;\n      animation:hsRipple .5s ease-out forwards;");
                    this.stage.appendChild(ripple);
                    setTimeout(function() {
                        return ripple.remove();
                    }, 500);
                }
            },
            {
                key: "showPopup",
                value: function showPopup(a) {
                    if (!this.stage) return;
                    var overlay = document.createElement("div");
                    overlay.className = "hs-popup";
                    var box = document.createElement("div");
                    box.className = "hs-popup-box";
                    var close = function close() {
                        overlay.remove();
                    };
                    var mediaId = a.mediaId || a.target || "";
                    if (mediaId) {
                        var url = this.resolver ? this.resolver(mediaId) : "/api/media/".concat(mediaId, "/raw");
                        var m = document.createElement("img");
                        m.src = url;
                        m.className = "hs-popup-media";
                        box.appendChild(m);
                    } else if (a.text) {
                        var t = document.createElement("div");
                        t.className = "hs-popup-text";
                        t.textContent = a.text;
                        box.appendChild(t);
                    } else {
                        var t1 = document.createElement("div");
                        t1.className = "hs-popup-text";
                        t1.textContent = a.label || "\u63D0\u793A";
                        box.appendChild(t1);
                    }
                    overlay.appendChild(box);
                    overlay.addEventListener("click", function(e) {
                        if (e.target === overlay) close();
                    });
                    this.stage.appendChild(overlay);
                    var dur = Number(a.duration) || 0;
                    if (dur > 0) setTimeout(close, dur * 1e3);
                }
            },
            {
                key: "runRegion",
                value: function runRegion(region) {
                    var _this = this;
                    var ctl = {
                        aborted: false
                    };
                    this.regionCtls.push(ctl);
                    var loop = region.loop !== false;
                    var all = region.items || [];
                    if (!all.length) return;
                    var live = function live() {
                        var now = Date.now();
                        var f = all.filter(function(it) {
                            return inWindow(it.validity, now);
                        });
                        return f.length ? f : null;
                    };
                    var idx = 0;
                    var tick = function tick() {
                        return _async_to_generator(function() {
                            var _this, _loop, _ret;
                            return _ts_generator(this, function(_state) {
                                switch(_state.label){
                                    case 0:
                                        _loop = function() {
                                            var items, item, holder, ended, onEnd, stop, single, ms, startedAt, endedAt;
                                            return _ts_generator(this, function(_state) {
                                                switch(_state.label){
                                                    case 0:
                                                        items = live();
                                                        if (!!items) return [
                                                            3,
                                                            2
                                                        ];
                                                        region._el.innerHTML = "";
                                                        return [
                                                            4,
                                                            _this.wait(3e4, function() {
                                                                return false;
                                                            }, ctl)
                                                        ];
                                                    case 1:
                                                        _state.sent();
                                                        return [
                                                            2,
                                                            "continue"
                                                        ];
                                                    case 2:
                                                        item = items[idx % items.length];
                                                        holder = document.createElement("div");
                                                        holder.className = "widget-holder";
                                                        region._el.appendChild(holder);
                                                        ended = false;
                                                        onEnd = function onEnd() {
                                                            ended = true;
                                                        };
                                                        stop = function stop() {};
                                                        try {
                                                            stop = renderWidget(holder, item, _this.resolver, onEnd) || function() {};
                                                        } catch (e) {
                                                            console.error("widget render error", e);
                                                        }
                                                        requestAnimationFrame(function() {
                                                            return holder.classList.add("show");
                                                        });
                                                        single = items.length === 1;
                                                        ms = void 0;
                                                        if (item.widget === "video" && !(item.duration > 0)) ms = -1;
                                                        else if (item.duration > 0) ms = item.duration * 1e3;
                                                        else if (single) ms = -1;
                                                        else ms = 8e3;
                                                        startedAt = Date.now();
                                                        _this.reportPlay({
                                                            itemId: item.id,
                                                            mediaId: item.mediaId || null,
                                                            startedAt: startedAt,
                                                            endedAt: startedAt
                                                        });
                                                        return [
                                                            4,
                                                            _this.wait(ms, function() {
                                                                return ended;
                                                            }, ctl)
                                                        ];
                                                    case 3:
                                                        _state.sent();
                                                        endedAt = Date.now();
                                                        _this.reportPlay({
                                                            itemId: item.id,
                                                            mediaId: item.mediaId || null,
                                                            startedAt: startedAt,
                                                            endedAt: endedAt
                                                        });
                                                        holder.classList.remove("show");
                                                        holder.classList.add("hide");
                                                        return [
                                                            4,
                                                            _this.wait(region.transition === "none" ? 0 : 450, function() {
                                                                return true;
                                                            }, ctl)
                                                        ];
                                                    case 4:
                                                        _state.sent();
                                                        try {
                                                            stop();
                                                        } catch (unused) {}
                                                        holder.remove();
                                                        if (!loop && idx >= items.length - 1) return [
                                                            2,
                                                            "break"
                                                        ];
                                                        idx = (idx + 1) % Math.max(1, items.length);
                                                        return [
                                                            2
                                                        ];
                                                }
                                            });
                                        };
                                        _state.label = 1;
                                    case 1:
                                        if (!!ctl.aborted) return [
                                            3,
                                            3
                                        ];
                                        _this = this;
                                        return [
                                            5,
                                            _ts_values(_loop())
                                        ];
                                    case 2:
                                        _ret = _state.sent();
                                        if (_ret === "break") return [
                                            3,
                                            3
                                        ];
                                        return [
                                            3,
                                            1
                                        ];
                                    case 3:
                                        return [
                                            2
                                        ];
                                }
                            });
                        }).call(_this);
                    };
                    tick();
                }
            },
            {
                /** ms>=0 计时；ms<0 等 predicate 为真；ctl.aborted 立即结束 */ key: "wait",
                value: function wait(ms, predicate, ctl) {
                    return new Promise(function(resolve) {
                        if (ctl.aborted) return resolve();
                        if (ms >= 0) {
                            var id = setTimeout(function() {
                                return resolve();
                            }, ms);
                            return;
                        }
                        var iv = setInterval(function() {
                            if (ctl.aborted || predicate()) {
                                clearInterval(iv);
                                resolve();
                            }
                        }, 250);
                    });
                }
            },
            {
                key: "startPolling",
                value: function startPolling() {
                    var _this = this;
                    if (this.pollTimer) return;
                    this.pollTimer = setInterval(function() {
                        return _this.refreshTerm();
                    }, 3e4);
                }
            },
            {
                key: "refreshTerm",
                value: function refreshTerm() {
                    return _async_to_generator(function() {
                        var r, man2, e, man, sch, id;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _state.trys.push([
                                        0,
                                        6,
                                        ,
                                        7
                                    ]);
                                    if (!!this.terminalId) return [
                                        3,
                                        2
                                    ];
                                    return [
                                        4,
                                        this.ensureTerminal()
                                    ];
                                case 1:
                                    _state.sent();
                                    _state.label = 2;
                                case 2:
                                    return [
                                        4,
                                        fetch("/api/t/manifest?terminalId=".concat(encodeURIComponent(this.terminalId || ""), "&token=").concat(encodeURIComponent(this.token || "")))
                                    ];
                                case 3:
                                    r = _state.sent();
                                    if (!r.ok) return [
                                        3,
                                        5
                                    ];
                                    return [
                                        4,
                                        r.json()
                                    ];
                                case 4:
                                    man2 = _state.sent();
                                    this.lastManifest = man2;
                                    try {
                                        localStorage.setItem("luma_manifest", JSON.stringify(man2));
                                    } catch (unused) {}
                                    _state.label = 5;
                                case 5:
                                    return [
                                        3,
                                        7
                                    ];
                                case 6:
                                    e = _state.sent();
                                    return [
                                        3,
                                        7
                                    ];
                                case 7:
                                    man = this.lastManifest || this._loadCachedManifest();
                                    if (!man) return [
                                        2
                                    ];
                                    sch = pickActiveSchedule(man);
                                    id = sch ? sch.scheduleId : null;
                                    if (id !== this.currentScheduleId) {
                                        this.currentScheduleId = id;
                                        if (sch) {
                                            this.hideWelcome();
                                            this.load(sch.layout, {
                                                resolver: this.resolver,
                                                mode: "term"
                                            });
                                        } else {
                                            this.showWelcome();
                                            this.startPolling();
                                            this.startCommands();
                                            this.startHeartbeat();
                                        }
                                    }
                                    if (this.terminalId) {
                                        if (!this.es) this.startCommands();
                                        if (!this.hbTimer) this.startHeartbeat();
                                    }
                                    return [
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                key: "_loadCachedManifest",
                value: function _loadCachedManifest() {
                    if (this._cachedTried) return this.lastManifest || null;
                    this._cachedTried = true;
                    try {
                        var raw = localStorage.getItem("luma_manifest");
                        if (raw) this.lastManifest = JSON.parse(raw);
                    } catch (unused) {}
                    return this.lastManifest || null;
                }
            },
            {
                key: "ensureTerminal",
                value: /* ---------------- 终端能力：注册 / 心跳 / 指令 ---------------- */ function ensureTerminal() {
                    return _async_to_generator(function() {
                        var _this_layout, _this_layout1, serial, W, H, body, r, raw, _tmp, hw, unused, r1, d, unused1;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    if (this.terminalId) return [
                                        2
                                    ];
                                    ping("reg-start");
                                    serial = localStorage.getItem("luma_term_serial");
                                    if (!serial) {
                                        serial = crypto.randomUUID ? crypto.randomUUID() : "web-" + Math.random().toString(36).slice(2);
                                        try {
                                            localStorage.setItem("luma_term_serial", serial);
                                        } catch (unused) {}
                                    }
                                    W = ((_this_layout = this.layout) === null || _this_layout === void 0 ? void 0 : _this_layout.width) || window.screen.width || 1920;
                                    H = ((_this_layout1 = this.layout) === null || _this_layout1 === void 0 ? void 0 : _this_layout1.height) || window.screen.height || 1080;
                                    body = {
                                        serial: serial,
                                        name: "Web \u64AD\u653E\u5668",
                                        model: "Browser",
                                        resolution: "".concat(W, "x").concat(H),
                                        kind: "web",
                                        platform: "web"
                                    };
                                    if (!native("getHardwareInfo")) return [
                                        3,
                                        6
                                    ];
                                    _state.label = 1;
                                case 1:
                                    _state.trys.push([
                                        1,
                                        5,
                                        ,
                                        6
                                    ]);
                                    r = raceBridge(window.LumaBridge.getHardwareInfo());
                                    if (!(r && typeof r.then === "function")) return [
                                        3,
                                        3
                                    ];
                                    return [
                                        4,
                                        r
                                    ];
                                case 2:
                                    _tmp = _state.sent();
                                    return [
                                        3,
                                        4
                                    ];
                                case 3:
                                    _tmp = r;
                                    _state.label = 4;
                                case 4:
                                    raw = _tmp;
                                    hw = typeof raw === "string" ? JSON.parse(raw) : raw;
                                    if (hw) {
                                        this._hwInfo = hw;
                                        Object.assign(body, {
                                            mac: hw.mac || "",
                                            serial: hw.serial || serial,
                                            model: hw.model || "Android",
                                            androidVersion: hw.androidVersion || "",
                                            resolution: hw.resolution || "".concat(W, "x").concat(H),
                                            orientation: hw.orientation || "landscape",
                                            firmware: hw.firmware || "",
                                            storageTotal: hw.storageTotal || 0,
                                            storageFree: hw.storageFree || 0
                                        });
                                        body.kind = "device";
                                        body.platform = "android";
                                        this.native = true;
                                    }
                                    return [
                                        3,
                                        6
                                    ];
                                case 5:
                                    unused = _state.sent();
                                    return [
                                        3,
                                        6
                                    ];
                                case 6:
                                    _state.trys.push([
                                        6,
                                        10,
                                        ,
                                        11
                                    ]);
                                    ping("reg-fetch");
                                    return [
                                        4,
                                        fetch("/api/t/register", {
                                            method: "POST",
                                            headers: {
                                                "Content-Type": "application/json"
                                            },
                                            credentials: "same-origin",
                                            body: JSON.stringify(body)
                                        })
                                    ];
                                case 7:
                                    r1 = _state.sent();
                                    if (!r1.ok) return [
                                        3,
                                        9
                                    ];
                                    return [
                                        4,
                                        r1.json()
                                    ];
                                case 8:
                                    d = _state.sent();
                                    this.terminalId = sanId(d.terminalId);
                                    this.token = sanId(d.token);
                                    _state.label = 9;
                                case 9:
                                    ping("reg-done-ok=" + (r1.ok ? "1" : r1.status));
                                    return [
                                        3,
                                        11
                                    ];
                                case 10:
                                    unused1 = _state.sent();
                                    ping("reg-done-err");
                                    return [
                                        3,
                                        11
                                    ];
                                case 11:
                                    return [
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                /** 上报播放证明事件（P0-4）：item 开始/结束各记一次 */ key: "reportPlay",
                value: function reportPlay(ev) {
                    var _this_layout, _this_layout1;
                    if (!this.terminalId) return;
                    var body = {
                        terminalId: this.terminalId,
                        token: this.token || "",
                        events: [
                            {
                                layoutId: ((_this_layout = this.layout) === null || _this_layout === void 0 ? void 0 : _this_layout.id) || null,
                                itemId: ev.itemId || null,
                                mediaId: ev.mediaId || null,
                                customer: ((_this_layout1 = this.layout) === null || _this_layout1 === void 0 ? void 0 : _this_layout1.customer) || null,
                                startedAt: ev.startedAt,
                                endedAt: ev.endedAt
                            }
                        ]
                    };
                    try {
                        fetch("/api/t/playlog", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            credentials: "same-origin",
                            body: JSON.stringify(body)
                        }).catch(function() {});
                    } catch (unused) {}
                }
            },
            {
                key: "startHeartbeat",
                value: function startHeartbeat() {
                    var _this = this;
                    if (this.hbTimer) return;
                    var iv = 15;
                    this._hbLatency = null;
                    this.hbTimer = setInterval(function() {
                        return _async_to_generator(function() {
                            var _this_layout, body, st, raw, _tmp, info, unused, t0, dt, unused1;
                            return _ts_generator(this, function(_state) {
                                switch(_state.label){
                                    case 0:
                                        if (!this.terminalId) return [
                                            2
                                        ];
                                        _state.label = 1;
                                    case 1:
                                        _state.trys.push([
                                            1,
                                            11,
                                            ,
                                            12
                                        ]);
                                        body = {
                                            terminalId: this.terminalId,
                                            token: this.token,
                                            playing: ((_this_layout = this.layout) === null || _this_layout === void 0 ? void 0 : _this_layout.name) || null,
                                            latency: this._hbLatency || void 0
                                        };
                                        if (!native("getNativeStatus")) return [
                                            3,
                                            8
                                        ];
                                        _state.label = 2;
                                    case 2:
                                        _state.trys.push([
                                            2,
                                            6,
                                            ,
                                            7
                                        ]);
                                        st = raceBridge(window.LumaBridge.getNativeStatus());
                                        if (!(st && typeof st.then === "function")) return [
                                            3,
                                            4
                                        ];
                                        return [
                                            4,
                                            st
                                        ];
                                    case 3:
                                        _tmp = _state.sent();
                                        return [
                                            3,
                                            5
                                        ];
                                    case 4:
                                        _tmp = st;
                                        _state.label = 5;
                                    case 5:
                                        raw = _tmp;
                                        info = typeof raw === "string" ? JSON.parse(raw) : raw;
                                        if (info) {
                                            if (info.volume != null) body.volume = info.volume;
                                            if (info.storageFree != null) {
                                                body.storageFree = info.storageFree;
                                                body.storageTotal = info.storageTotal;
                                            }
                                            if (info.appVersion) body.appVersion = info.appVersion;
                                            if (info.cpuTemp != null) body.cpuTemp = info.cpuTemp;
                                            if (info.cpu != null) body.cpu = info.cpu;
                                            if (info.mem != null) body.mem = info.mem;
                                            if (info.uptime != null) body.uptime = info.uptime;
                                            if (info.crashCount != null) body.crashCount = info.crashCount;
                                        }
                                        return [
                                            3,
                                            7
                                        ];
                                    case 6:
                                        unused = _state.sent();
                                        return [
                                            3,
                                            7
                                        ];
                                    case 7:
                                        return [
                                            3,
                                            9
                                        ];
                                    case 8:
                                        if (typeof performance !== "undefined") {
                                            body.uptime = Math.floor(performance.now() / 1e3);
                                        }
                                        _state.label = 9;
                                    case 9:
                                        t0 = performance.now();
                                        return [
                                            4,
                                            fetch("/api/t/heartbeat", {
                                                method: "POST",
                                                headers: {
                                                    "Content-Type": "application/json"
                                                },
                                                credentials: "same-origin",
                                                body: JSON.stringify(body)
                                            })
                                        ];
                                    case 10:
                                        _state.sent();
                                        dt = Math.round(performance.now() - t0);
                                        if (dt > 0 && dt < 6e4) this._hbLatency = dt;
                                        return [
                                            3,
                                            12
                                        ];
                                    case 11:
                                        unused1 = _state.sent();
                                        return [
                                            3,
                                            12
                                        ];
                                    case 12:
                                        return [
                                            2
                                        ];
                                }
                            });
                        }).call(_this);
                    }, Math.max(10, iv) * 1e3);
                }
            },
            {
                key: "startCommands",
                value: function startCommands() {
                    var _this = this;
                    if (this.es) try {
                        this.es.close();
                    } catch (unused) {}
                    if (!this.terminalId) return;
                    var url = "/api/t/events?terminalId=".concat(encodeURIComponent(this.terminalId), "&token=").concat(encodeURIComponent(this.token || ""));
                    var es = new EventSource(url);
                    this.es = es;
                    es.addEventListener("command", function(ev) {
                        var cmd;
                        try {
                            cmd = JSON.parse(ev.data);
                        } catch (unused) {
                            return;
                        }
                        _this.handleCommand(cmd);
                    });
                    es.onerror = function() {};
                }
            },
            {
                key: "handleCommand",
                value: function handleCommand(cmd) {
                    return _async_to_generator(function() {
                        var ok, message, _, _ref, _ref1, _cmd_payload, _cmd_payload1, _ref2, _cmd_payload2, _cmd_payload3, _cmd_payload4, _cmd_payload5, _cmd_payload6, r, data, e;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    ok = true, message = "";
                                    _state.label = 1;
                                case 1:
                                    _state.trys.push([
                                        1,
                                        21,
                                        ,
                                        22
                                    ]);
                                    _ = cmd.type;
                                    switch(_){
                                        case "reload":
                                            return [
                                                3,
                                                2
                                            ];
                                        case "restart":
                                            return [
                                                3,
                                                4
                                            ];
                                        case "screenshot":
                                            return [
                                                3,
                                                5
                                            ];
                                        case "volume":
                                            return [
                                                3,
                                                7
                                            ];
                                        case "reboot":
                                            return [
                                                3,
                                                8
                                            ];
                                        case "screen_on":
                                            return [
                                                3,
                                                9
                                            ];
                                        case "screen_off":
                                            return [
                                                3,
                                                10
                                            ];
                                        case "set_brightness":
                                            return [
                                                3,
                                                11
                                            ];
                                        case "power_schedule":
                                            return [
                                                3,
                                                12
                                            ];
                                        case "upgrade_apk":
                                            return [
                                                3,
                                                13
                                            ];
                                        case "clear_cache":
                                            return [
                                                3,
                                                14
                                            ];
                                        case "show":
                                            return [
                                                3,
                                                15
                                            ];
                                        case "play":
                                            return [
                                                3,
                                                15
                                            ];
                                    }
                                    return [
                                        3,
                                        19
                                    ];
                                case 2:
                                    return [
                                        4,
                                        this.refreshTerm()
                                    ];
                                case 3:
                                    _state.sent();
                                    return [
                                        3,
                                        20
                                    ];
                                case 4:
                                    if (native("restartApp")) window.LumaBridge.restartApp();
                                    else location.reload();
                                    return [
                                        3,
                                        20
                                    ];
                                case 5:
                                    return [
                                        4,
                                        this.captureAndSend()
                                    ];
                                case 6:
                                    _state.sent();
                                    return [
                                        3,
                                        20
                                    ];
                                case 7:
                                    if (native("setVolume")) window.LumaBridge.setVolume((_ref = (_ref1 = (_cmd_payload = cmd.payload) === null || _cmd_payload === void 0 ? void 0 : _cmd_payload.volume) !== null && _ref1 !== void 0 ? _ref1 : this.volume) !== null && _ref !== void 0 ? _ref : 60);
                                    else this.volume = (_cmd_payload1 = cmd.payload) === null || _cmd_payload1 === void 0 ? void 0 : _cmd_payload1.volume;
                                    return [
                                        3,
                                        20
                                    ];
                                case 8:
                                    if (native("reboot")) window.LumaBridge.reboot();
                                    return [
                                        3,
                                        20
                                    ];
                                case 9:
                                    if (native("screenOn")) window.LumaBridge.screenOn();
                                    return [
                                        3,
                                        20
                                    ];
                                case 10:
                                    if (native("screenOff")) window.LumaBridge.screenOff();
                                    return [
                                        3,
                                        20
                                    ];
                                case 11:
                                    if (native("setBrightness")) window.LumaBridge.setBrightness((_ref2 = (_cmd_payload2 = cmd.payload) === null || _cmd_payload2 === void 0 ? void 0 : _cmd_payload2.level) !== null && _ref2 !== void 0 ? _ref2 : 100);
                                    return [
                                        3,
                                        20
                                    ];
                                case 12:
                                    if (native("setPowerSchedule")) window.LumaBridge.setPowerSchedule(JSON.stringify(((_cmd_payload3 = cmd.payload) === null || _cmd_payload3 === void 0 ? void 0 : _cmd_payload3.schedule) || []));
                                    return [
                                        3,
                                        20
                                    ];
                                case 13:
                                    if (native("downloadAndInstallApk") && ((_cmd_payload4 = cmd.payload) === null || _cmd_payload4 === void 0 ? void 0 : _cmd_payload4.url)) window.LumaBridge.downloadAndInstallApk(cmd.payload.url, ((_cmd_payload5 = cmd.payload) === null || _cmd_payload5 === void 0 ? void 0 : _cmd_payload5.sha256) || null);
                                    return [
                                        3,
                                        20
                                    ];
                                case 14:
                                    try {
                                        if (native("clearCache")) window.LumaBridge.clearCache();
                                    } catch (unused) {}
                                    try {
                                        localStorage.removeItem("luma_manifest");
                                    } catch (unused) {}
                                    return [
                                        3,
                                        20
                                    ];
                                case 15:
                                    if (!((_cmd_payload6 = cmd.payload) === null || _cmd_payload6 === void 0 ? void 0 : _cmd_payload6.layoutId)) return [
                                        3,
                                        18
                                    ];
                                    this.hideWelcome();
                                    return [
                                        4,
                                        fetch("/api/layouts/".concat(encodeURIComponent(cmd.payload.layoutId)))
                                    ];
                                case 16:
                                    r = _state.sent();
                                    if (!r.ok) return [
                                        3,
                                        18
                                    ];
                                    return [
                                        4,
                                        r.json()
                                    ];
                                case 17:
                                    data = _state.sent();
                                    this.load(data.item || data, {
                                        resolver: this.resolver,
                                        mode: "term"
                                    });
                                    _state.label = 18;
                                case 18:
                                    return [
                                        3,
                                        20
                                    ];
                                case 19:
                                    return [
                                        3,
                                        20
                                    ];
                                case 20:
                                    return [
                                        3,
                                        22
                                    ];
                                case 21:
                                    e = _state.sent();
                                    ok = false;
                                    message = String(e.message || e);
                                    return [
                                        3,
                                        22
                                    ];
                                case 22:
                                    this.ack(cmd.cmdId, ok, message);
                                    return [
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                key: "ack",
                value: function ack(cmdId, ok, message) {
                    fetch("/api/t/ack", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        credentials: "same-origin",
                        body: JSON.stringify({
                            terminalId: this.terminalId,
                            token: this.token,
                            cmdId: cmdId,
                            ok: ok,
                            message: message
                        })
                    }).catch(function() {});
                }
            },
            {
                key: "captureAndSend",
                value: function captureAndSend() {
                    return _async_to_generator(function() {
                        var _this, _this_layout, _this_layout1, W, H, cv, c, blob, unused;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _this = this;
                                    _state.label = 1;
                                case 1:
                                    _state.trys.push([
                                        1,
                                        5,
                                        ,
                                        6
                                    ]);
                                    if (native("capture")) {
                                        window.LumaBridge.capture(function(d) {
                                            if (d) _this.uploadShot(d);
                                        });
                                        return [
                                            2
                                        ];
                                    }
                                    W = ((_this_layout = this.layout) === null || _this_layout === void 0 ? void 0 : _this_layout.width) || 1920, H = ((_this_layout1 = this.layout) === null || _this_layout1 === void 0 ? void 0 : _this_layout1.height) || 1080;
                                    cv = document.createElement("canvas");
                                    cv.width = W;
                                    cv.height = H;
                                    c = cv.getContext("2d");
                                    c.fillStyle = getComputedStyle(this.stage).backgroundColor || "#000";
                                    c.fillRect(0, 0, W, H);
                                    return [
                                        4,
                                        new Promise(function(res) {
                                            return cv.toBlob(res, "image/jpeg", 0.8);
                                        })
                                    ];
                                case 2:
                                    blob = _state.sent();
                                    if (!blob) return [
                                        3,
                                        4
                                    ];
                                    return [
                                        4,
                                        this.uploadBlob(blob)
                                    ];
                                case 3:
                                    _state.sent();
                                    _state.label = 4;
                                case 4:
                                    return [
                                        3,
                                        6
                                    ];
                                case 5:
                                    unused = _state.sent();
                                    return [
                                        3,
                                        6
                                    ];
                                case 6:
                                    return [
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                key: "uploadShot",
                value: function uploadShot(dataUrl) {
                    return _async_to_generator(function() {
                        var _, _1, unused;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _state.trys.push([
                                        0,
                                        4,
                                        ,
                                        5
                                    ]);
                                    _1 = (_ = this).uploadBlob;
                                    return [
                                        4,
                                        fetch(dataUrl)
                                    ];
                                case 1:
                                    return [
                                        4,
                                        _state.sent().blob()
                                    ];
                                case 2:
                                    return [
                                        4,
                                        _1.apply(_, [
                                            _state.sent()
                                        ])
                                    ];
                                case 3:
                                    _state.sent();
                                    return [
                                        3,
                                        5
                                    ];
                                case 4:
                                    unused = _state.sent();
                                    return [
                                        3,
                                        5
                                    ];
                                case 5:
                                    return [
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                key: "uploadBlob",
                value: function uploadBlob(blob) {
                    return _async_to_generator(function() {
                        var fd, unused;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _state.trys.push([
                                        0,
                                        2,
                                        ,
                                        3
                                    ]);
                                    fd = new FormData();
                                    fd.append("shot", blob, "shot.jpg");
                                    fd.append("terminalId", this.terminalId);
                                    fd.append("token", this.token || "");
                                    return [
                                        4,
                                        fetch("/api/t/shot", {
                                            method: "POST",
                                            body: fd,
                                            credentials: "same-origin"
                                        })
                                    ];
                                case 1:
                                    _state.sent();
                                    return [
                                        3,
                                        3
                                    ];
                                case 2:
                                    unused = _state.sent();
                                    return [
                                        3,
                                        3
                                    ];
                                case 3:
                                    return [
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            }
        ]);
        return Player;
    }();
    function ping(stage) {
        try {
            new Image().src = "/api/t/ping?stage=" + encodeURIComponent(stage) + "&t=" + Date.now();
        } catch (unused) {}
    }
    function sanId(v) {
        return v && v !== "null" && v !== "undefined" ? String(v) : null;
    }
    function raceBridge(p) {
        return Promise.race([
            Promise.resolve(p),
            new Promise(function(r) {
                return setTimeout(function() {
                    return r(null);
                }, 2e3);
            })
        ]);
    }
    function bootstrap() {
        return _async_to_generator(function() {
            var q, mode, terminalId, token, layoutId, inline, player, layout, man, r, unused, sch, r1, data, layout1;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        ping("boot-start");
                        q = new URLSearchParams(location.search);
                        mode = q.get("mode") || (q.get("terminalId") ? "term" : "preview");
                        terminalId = sanId(q.get("terminalId"));
                        token = sanId(q.get("token"));
                        layoutId = q.get("layoutId");
                        inline = q.get("data");
                        player = new Player();
                        if (mode === "term") {
                            player.terminalId = terminalId;
                            player.token = token;
                        }
                        ping("boot-bridge-probed");
                        window.__onNetworkChange = function(online) {
                            if (!online) return;
                            try {
                                player.startCommands();
                                player.refreshTerm();
                            } catch (e) {}
                        };
                        window.addEventListener("message", function(e) {
                            var d = e.data;
                            if (!d || !d.type) return;
                            if (d.type === "luma:preview" && d.layout) {
                                player.load(d.layout, {
                                    resolver: function resolver(id) {
                                        return "/api/media/".concat(id, "/raw");
                                    },
                                    mode: "preview"
                                });
                            } else if (d.type === "luma:hs-mode") {
                                player.setEditMode(!!d.on);
                            } else if (d.type === "luma:hs-update") {
                                player.updateHotspot(d.id, d.patch || {});
                            } else if (d.type === "luma:hs-remove") {
                                player.removeHotspot(d.id);
                            } else if (d.type === "luma:hs-add-center") {
                                player.addHotspotCenter();
                            }
                        });
                        player.setHotspotHandlers({
                            onSelect: function onSelect(hs) {
                                try {
                                    window.parent.postMessage({
                                        type: "luma:hs-select",
                                        hs: hs
                                    }, "*");
                                } catch (unused) {}
                            },
                            onChange: function onChange() {
                                try {
                                    window.parent.postMessage({
                                        type: "luma:hs-change",
                                        hotspots: player.layout.hotspots || []
                                    }, "*");
                                } catch (unused) {}
                            }
                        });
                        if (inline) {
                            try {
                                layout = JSON.parse(decodeURIComponent(inline));
                                player.load(layout, {
                                    resolver: function resolver(id) {
                                        return "/api/media/".concat(id, "/raw");
                                    },
                                    mode: "preview"
                                });
                                return [
                                    2
                                ];
                            } catch (e) {
                                showFallback("\u9884\u89C8\u6570\u636E\u89E3\u6790\u5931\u8D25");
                                return [
                                    2
                                ];
                            }
                        }
                        if (!(mode === "term")) return [
                            3,
                            10
                        ];
                        ping("term-branch");
                        if (!terminalId) return [
                            3,
                            1
                        ];
                        player.terminalId = terminalId;
                        player.token = token;
                        return [
                            3,
                            3
                        ];
                    case 1:
                        return [
                            4,
                            player.ensureTerminal()
                        ];
                    case 2:
                        _state.sent();
                        _state.label = 3;
                    case 3:
                        ping("term-id=" + (player.terminalId ? "ok" : "null"));
                        setTimeout(function() {
                            if (mode === "term" && !player.terminalId) {
                                ping("stuck-10s-retry");
                                player.ensureTerminal();
                            }
                        }, 1e4);
                        man = null;
                        _state.label = 4;
                    case 4:
                        _state.trys.push([
                            4,
                            8,
                            ,
                            9
                        ]);
                        return [
                            4,
                            fetch("/api/t/manifest?terminalId=".concat(encodeURIComponent(player.terminalId || ""), "&token=").concat(encodeURIComponent(player.token || "")))
                        ];
                    case 5:
                        r = _state.sent();
                        if (!r.ok) return [
                            3,
                            7
                        ];
                        return [
                            4,
                            r.json()
                        ];
                    case 6:
                        man = _state.sent();
                        try {
                            localStorage.setItem("luma_manifest", JSON.stringify(man));
                        } catch (unused) {}
                        _state.label = 7;
                    case 7:
                        return [
                            3,
                            9
                        ];
                    case 8:
                        unused = _state.sent();
                        return [
                            3,
                            9
                        ];
                    case 9:
                        if (!man) {
                            try {
                                man = JSON.parse(localStorage.getItem("luma_manifest") || "null");
                            } catch (unused) {
                                man = null;
                            }
                        }
                        if (!man) {
                            showFallback("\u7EC8\u7AEF\u6E05\u5355\u83B7\u53D6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7EC8\u7AEFID/\u4EE4\u724C");
                            return [
                                2
                            ];
                        }
                        player.lastManifest = man;
                        sch = pickActiveSchedule(man);
                        player.currentScheduleId = sch ? sch.scheduleId : null;
                        if (sch) {
                            player.hideWelcome();
                            player.load(sch.layout, {
                                resolver: function resolver(id) {
                                    return "/api/t/media/".concat(id, "?terminalId=").concat(encodeURIComponent(player.terminalId || ""), "&token=").concat(encodeURIComponent(player.token || ""));
                                },
                                mode: "term"
                            });
                        } else {
                            player.showWelcome();
                            player.startPolling();
                            player.startCommands();
                            player.startHeartbeat();
                        }
                        return [
                            2
                        ];
                    case 10:
                        if (!layoutId) return [
                            3,
                            13
                        ];
                        return [
                            4,
                            fetch("/api/layouts/".concat(encodeURIComponent(layoutId)))
                        ];
                    case 11:
                        r1 = _state.sent();
                        if (!r1.ok) {
                            showFallback("\u8282\u76EE\u83B7\u53D6\u5931\u8D25");
                            return [
                                2
                            ];
                        }
                        return [
                            4,
                            r1.json()
                        ];
                    case 12:
                        data = _state.sent();
                        layout1 = data.item || data;
                        player.load(layout1, {
                            resolver: function resolver(id) {
                                return "/api/media/".concat(id, "/raw");
                            },
                            mode: "preview"
                        });
                        return [
                            2
                        ];
                    case 13:
                        showFallback("\u672A\u6307\u5B9A\u64AD\u653E\u5185\u5BB9\uFF08\u9700 terminalId / layoutId / data \u53C2\u6570\uFF09");
                        return [
                            2
                        ];
                }
            });
        })();
    }
    bootstrap();
    window.__LUMA_PLAYER__ = {
        version: "1.1.0"
    };
})();
