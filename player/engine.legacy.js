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
    if (o && typeof o.next === "function") { return o; }
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
    // player/widgets.js
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
    var pad2 = function pad2(n) {
        return n < 10 ? "0" + n : "" + n;
    };
    var objAssign = function objAssign(t, s) {
        if (s) {
            for(var k in s){
                if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
            }
        }
        return t;
    };
    var appendAll = function appendAll(p, ns) {
        for(var i = 0; i < ns.length; i++){
            if (ns[i] != null) p.appendChild(ns[i]);
        }
        return p;
    };
    function renderImage(holder, item, resolver) {
        var img = document.createElement("img");
        var url = item.mediaId ? resolver(item.mediaId) : item.url || "";
        img.src = url;
        img.className = "w-img " + (item.fit || "cover");
        img.alt = item.alt || "";
        img.onerror = function() {
            var miss = objAssign(document.createElement("div"), {
                className: "w-img",
                textContent: "\u56FE\u7247\u7F3A\u5931"
            });
            if (img.parentNode) img.parentNode.replaceChild(miss, img);
        };
        holder.appendChild(img);
        return function() {};
    }
    function renderVideo(holder, item, resolver, onEnd) {
        var v = document.createElement("video");
        var url = item.mediaId ? resolver(item.mediaId) : item.url || "";
        v.muted = true;
        v.defaultMuted = true;
        v.setAttribute("muted", "");
        v.volume = 0;
        v.setAttribute("autoplay", "");
        v.setAttribute("playsinline", "");
        v.setAttribute("webkit-playsinline", "");
        v.autoplay = true;
        v.playsInline = true;
        v.src = url;
        v.loop = !!item.loop && !(item.duration > 0);
        v.className = "w-video " + (item.fit || "cover");
        v.addEventListener("ended", function() {
            return onEnd && onEnd();
        });
        holder.appendChild(v);
        var started = false;
        var watchdog = setTimeout(function() {
            if (!started && v.currentTime < 0.5) {
                try {
                    v.pause();
                } catch (e) {}
                onEnd && onEnd();
            }
        }, 8e3);
        v.addEventListener("timeupdate", function() {
            if (v.currentTime > 0.5) started = true;
        });
        v.addEventListener("error", function() {
            if (!started) {
                clearTimeout(watchdog);
                onEnd && onEnd();
            }
        });
        var p = v.play();
        if (p && p.catch) p.catch(function() {});
        return function() {
            clearTimeout(watchdog);
            try {
                v.pause();
            } catch (e) {}
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
            return pad2(n);
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
        appendAll(wrap, [
            valEl,
            unitEl,
            labelEl
        ]);
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
                appendAll(w, [
                    l,
                    i
                ]);
                return {
                    wrap: w,
                    input: i
                };
            };
            var nameRow = row("\u59D3\u540D\uFF08\u9009\u586B\uFF09", "\u60A8\u7684\u59D3\u540D");
            var phoneRow = row("\u8054\u7CFB\u7535\u8BDD", "\u624B\u673A\u53F7\u7801");
            appendAll(d, [
                nameRow.wrap,
                phoneRow.wrap
            ]);
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
    // player/engine.js
    var app = document.getElementById("app");
    var fallback = document.getElementById("fallback");
    var welcome = document.getElementById("welcome");
    var showFallback = function showFallback(msg) {
        try {
            fallback.innerHTML = '<div class="big">灵屏 LumaSign</div><div>'.concat(msg, "</div>");
            fallback.classList.remove("hidden");
        } catch (e) {}
    };
    var hideFallback = function hideFallback() {
        try {
            fallback.classList.add("hidden");
        } catch (e) {}
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
    var HTML_V = "1443";
    var pad22 = function pad22(n) {
        return n < 10 ? "0" + n : "" + n;
    };
    var objAssign2 = function objAssign2(t, s) {
        if (s) {
            for(var k in s){
                if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
            }
        }
        return t;
    };
    var appendAll2 = function appendAll2(p, ns) {
        for(var i = 0; i < ns.length; i++){
            if (ns[i] != null) p.appendChild(ns[i]);
        }
        return p;
    };
    var el = function el(tag, opts, kids) {
        var d = document.createElement(tag);
        if (opts) {
            for(var k in opts){
                if (!Object.prototype.hasOwnProperty.call(opts, k)) continue;
                if (k === "text") d.textContent = opts[k];
                else if (k === "class") d.className = opts[k];
                else d.setAttribute(k, opts[k]);
            }
        }
        if (kids) {
            for(var i = 0; i < kids.length; i++){
                if (kids[i] != null) d.appendChild(kids[i]);
            }
        }
        return d;
    };
    var native = function native(name) {
        return !!(window.LumaBridge && typeof window.LumaBridge[name] === "function");
    };
    var ymd = function ymd(d) {
        return "".concat(d.getFullYear(), "-").concat(pad22(d.getMonth() + 1), "-").concat(pad22(d.getDate()));
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
        if (Array.isArray(sch.weekdays) && sch.weekdays.length && sch.weekdays.indexOf(when.getDay()) === -1) return false;
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
                    var rcs = this.regionCtls || [];
                    for(var i = 0; i < rcs.length; i++)rcs[i].aborted = true;
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
                /* ---------------- 欢迎页（终端无展示任务时展示，对标竞品"液晶互动"空闲屏） ----------------
       竞品空闲屏展示：版本号 + 节目状态 + 鼠标/键盘交互入口。这里镜像其信息密度，
       让嵌墙设备在无任务时也清楚"我是谁、连没连上、在等什么"，而非黑屏或纯 logo。 */ key: "hideWelcome",
                value: function hideWelcome() {
                    if (welcome) welcome.classList.add("hidden");
                    if (this._welcomeTimer) {
                        clearInterval(this._welcomeTimer);
                        this._welcomeTimer = null;
                    }
                }
            },
            {
                key: "showWelcome",
                value: function showWelcome() {
                    return _async_to_generator(function() {
                        var ip, ver, hw, model, playerVer, r, raw, info, ok, statusText, statusEl, self;
                        return _ts_generator(this, function(_state) {
                            this.stop();
                            hideFallback();
                            if (!welcome) return [
                                2
                            ];
                            ip = "";
                            ver = "";
                            hw = this._hwInfo || {};
                            model = hw.model || "";
                            playerVer = window.__LUMA_PLAYER__ && window.__LUMA_PLAYER__.version || "";
                            try {
                                if (native("getIpAddress")) {
                                    r = window.LumaBridge.getIpAddress();
                                    ip = typeof r === "string" ? r.trim() : "";
                                }
                            } catch (e) {}
                            try {
                                if (native("getNativeStatus")) {
                                    raw = window.LumaBridge.getNativeStatus();
                                    info = typeof raw === "string" ? JSON.parse(raw) : raw;
                                    if (info && info.appVersion) ver = String(info.appVersion);
                                }
                            } catch (e) {}
                            ok = !!this.terminalId;
                            statusText = ok ? "\u5DF2\u8FDE\u63A5\u7BA1\u7406\u7AEF \xB7 \u7B49\u5F85\u5206\u914D\u64AD\u653E\u4EFB\u52A1" : "\u6B63\u5728\u8FDE\u63A5\u7BA1\u7406\u7AEF\u2026";
                            welcome.innerHTML = '<div class="welcome-ip">\u672C\u673AIP\uFF1A' + (ip || "\u672A\u8FDE\u63A5") + "</div>" + (ver ? '<div class="welcome-version">\u7075\u5C4F v' + escapeHtml(ver) + (playerVer ? " \xB7 \u5F15\u64CE " + escapeHtml(playerVer) : "") + "</div>" : "") + '<div class="welcome-center"><div class="welcome-title">\u7075\u5C4F LumaSign</div><div class="welcome-sub">\u5C40\u57DF\u7F51\u6570\u5B57\u6807\u724C\u64AD\u653E\u7AEF</div>' + (model ? '<div class="welcome-sub" style="font-size:16px;opacity:.4;margin-top:8px">' + escapeHtml(model) + "</div>" : "") + '<div class="welcome-status ' + (ok ? "ok" : "wait") + '"><span class="dot"></span>' + statusText + '</div><div class="welcome-pulse"></div></div><div class="welcome-hint">\u53F3\u952E / \u83DC\u5355\u952E\uFF1A\u8FD0\u7EF4\u83DC\u5355\u3000\xB7\u3000\u957F\u6309 2 \u79D2\uFF1A\u9000\u51FA\u3000\xB7\u3000\u7B49\u5F85\u64AD\u653E\u5185\u5BB9\u4E2D\u2026</div>';
                            welcome.classList.remove("hidden");
                            if (this._welcomeTimer) clearInterval(this._welcomeTimer);
                            statusEl = welcome.querySelector(".welcome-status");
                            self = this;
                            this._welcomeTimer = setInterval(function() {
                                if (!welcome || welcome.classList.contains("hidden") || !statusEl) {
                                    clearInterval(self._welcomeTimer);
                                    return;
                                }
                                var live = !!self.terminalId;
                                statusEl.className = "welcome-status " + (live ? "ok" : "wait");
                                statusEl.innerHTML = '<span class="dot"></span>' + (live ? "\u5DF2\u8FDE\u63A5\u7BA1\u7406\u7AEF \xB7 \u7B49\u5F85\u5206\u914D\u64AD\u653E\u4EFB\u52A1" : "\u6B63\u5728\u8FDE\u63A5\u7BA1\u7406\u7AEF\u2026");
                            }, 4e3);
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
                            ping("load-begin");
                            try {
                                this.stop();
                            } catch (e) {
                                ping("stop-err:" + encodeURIComponent(String(e && e.message || e)).slice(0, 90));
                            }
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
                            ping("build-stage");
                            this.buildStage(layout);
                            ping("stage-built");
                            this.startRegions(layout);
                            ping("regions-ok");
                            this.primeDataSources().catch(function() {}).then(function() {
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
                        var _this, ids, preg, pi, pitems, pj, pit;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _this = this;
                                    ids = [];
                                    preg = this.layout && this.layout.regions || [];
                                    for(pi = 0; pi < preg.length; pi++){
                                        pitems = preg[pi].items || [];
                                        for(pj = 0; pj < pitems.length; pj++){
                                            pit = pitems[pj];
                                            if (pit.dataSourceId && ids.indexOf(pit.dataSourceId) === -1) ids.push(pit.dataSourceId);
                                        }
                                    }
                                    this._dsIds = ids;
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
                            var _this_ctl, dsi, i, data;
                            return _ts_generator(this, function(_state) {
                                switch(_state.label){
                                    case 0:
                                        if (!this._dsIds.length || ((_this_ctl = this.ctl) === null || _this_ctl === void 0 ? void 0 : _this_ctl.aborted)) return [
                                            2
                                        ];
                                        dsi = this._dsIds || [];
                                        i = 0;
                                        _state.label = 1;
                                    case 1:
                                        if (!(i < dsi.length)) return [
                                            3,
                                            4
                                        ];
                                        return [
                                            4,
                                            this.fetchDataSourceData(dsi[i])
                                        ];
                                    case 2:
                                        data = _state.sent();
                                        if (data !== null) this.dsCache[dsi[i]] = data;
                                        _state.label = 3;
                                    case 3:
                                        i++;
                                        return [
                                            3,
                                            1
                                        ];
                                    case 4:
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
                        var isVideo = /\.(mp4|webm|mov|m4v)$/i.test(url) || bg.mime && String(bg.mime).indexOf("video") === 0;
                        if (isVideo) {
                            var v = document.createElement("video");
                            v.muted = true;
                            v.volume = 0;
                            v.autoplay = true;
                            v.loop = true;
                            v.playsInline = true;
                            v.src = url;
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
                    var regions = layout && layout.regions || [];
                    for(var ri = 0; ri < regions.length; ri++){
                        var r = regions[ri];
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
                    var regs = layout && layout.regions || [];
                    for(var ri = 0; ri < regs.length; ri++){
                        var r = regs[ri];
                        var its = r.items || [];
                        for(var ii = 0; ii < its.length; ii++)its[ii]._getData = function(id) {
                            return _this.dsCache[id];
                        };
                        if (r._el) this.runRegion(r);
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
                    var _this, _loop = function(hi) {
                        var hs = list[hi];
                        var el2 = document.createElement("div");
                        el2.className = "hotspot" + (hs.shape === "circle" ? " circle" : "");
                        el2.dataset.id = hs.id;
                        el2.style.left = hs.x + "px";
                        el2.style.top = hs.y + "px";
                        el2.style.width = hs.w + "px";
                        el2.style.height = hs.h + "px";
                        el2.style.pointerEvents = interactive ? "auto" : "none";
                        if (_this.editMode) {
                            el2.classList.add("editing");
                            var lbl = document.createElement("span");
                            lbl.className = "hs-label";
                            lbl.textContent = hs.action && hs.action.label || hs.action && hs.action.type || "\u70ED\u533A";
                            el2.appendChild(lbl);
                            var handle = document.createElement("div");
                            handle.className = "hs-handle";
                            el2.appendChild(handle);
                            _this._bindHotspotInteractions(el2, hs);
                        } else if (_this.mode === "term") {
                            el2.addEventListener("click", function(e) {
                                e.stopPropagation();
                                _this1.dispatchHotspot(hs);
                            });
                        }
                        layer.appendChild(el2);
                    };
                    var _this1 = this;
                    if (!this.stage) return;
                    var layer = this.ensureHotspotLayer();
                    layer.innerHTML = "";
                    var interactive = this.editMode || this.mode === "term";
                    layer.style.pointerEvents = interactive ? "auto" : "none";
                    layer.classList.toggle("editing", this.editMode);
                    var list = this.layout && this.layout.hotspots || [];
                    for(var hi = 0; hi < list.length; hi++)_this = this, _loop(hi);
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
                    appendAll2(bar, [
                        backBtn,
                        el("div", {
                            class: "hs-nav-crumbs"
                        }, crumbs)
                    ]);
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
                    var hs = (this.layout.hotspots || []).filter(function(x) {
                        return x.id === id;
                    })[0];
                    if (!hs) return;
                    objAssign2(hs, patch);
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
                        var q, hdr, qi, e;
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
                                    qi = 0;
                                    _state.label = 1;
                                case 1:
                                    if (!(qi < q.length)) return [
                                        3,
                                        6
                                    ];
                                    _state.label = 2;
                                case 2:
                                    _state.trys.push([
                                        2,
                                        4,
                                        ,
                                        5
                                    ]);
                                    return [
                                        4,
                                        fetch("/api/interaction", {
                                            method: "POST",
                                            headers: hdr,
                                            body: JSON.stringify(q[qi])
                                        })
                                    ];
                                case 3:
                                    _state.sent();
                                    return [
                                        3,
                                        5
                                    ];
                                case 4:
                                    e = _state.sent();
                                    return [
                                        3,
                                        5
                                    ];
                                case 5:
                                    qi++;
                                    return [
                                        3,
                                        1
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
                            var _this, _loop, _this1, showing, _ret;
                            return _ts_generator(this, function(_state) {
                                switch(_state.label){
                                    case 0:
                                        _loop = function() {
                                            var items, item, warm, holder, ended, onEnd, stop, prev, single, ms, startedAt, endedAt;
                                            return _ts_generator(this, function(_state) {
                                                switch(_state.label){
                                                    case 0:
                                                        items = live();
                                                        if (!!items) return [
                                                            3,
                                                            2
                                                        ];
                                                        region._el.innerHTML = "";
                                                        showing = null;
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
                                                        try {
                                                            warm = function warm(it) {
                                                                if (it && it.mediaId && (!it.widget || it.widget === "image")) {
                                                                    var im = new Image();
                                                                    im.src = _this1.resolver(it.mediaId);
                                                                }
                                                            };
                                                            warm(item);
                                                            warm(items[(idx + 1) % items.length]);
                                                        } catch (e) {}
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
                                                        prev = showing;
                                                        showing = {
                                                            holder: holder,
                                                            stop: stop
                                                        };
                                                        setTimeout(function() {
                                                            if (prev) {
                                                                try {
                                                                    prev.stop();
                                                                } catch (e) {}
                                                                if (prev.holder.parentNode) prev.holder.remove();
                                                            }
                                                        }, region.transition === "none" ? 30 : 550);
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
                                                        if (!(!loop && idx >= items.length - 1)) return [
                                                            3,
                                                            5
                                                        ];
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
                                                        } catch (e2) {}
                                                        if (holder.parentNode) holder.remove();
                                                        showing = null;
                                                        return [
                                                            2,
                                                            "break"
                                                        ];
                                                    case 5:
                                                        idx = (idx + 1) % Math.max(1, items.length);
                                                        return [
                                                            2
                                                        ];
                                                }
                                            });
                                        };
                                        _this1 = this;
                                        showing = null;
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
                        var r, man2, e, man, sch, id, e1;
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
                                    ping("sched-n=" + (man.schedules || []).length + " hit=" + (sch ? sch.scheduleId : "null") + " cur=" + this.currentScheduleId);
                                    id = sch ? sch.scheduleId : null;
                                    if (!(id !== this.currentScheduleId)) return [
                                        3,
                                        13
                                    ];
                                    this.currentScheduleId = id;
                                    if (!sch) return [
                                        3,
                                        12
                                    ];
                                    _state.label = 8;
                                case 8:
                                    _state.trys.push([
                                        8,
                                        10,
                                        ,
                                        11
                                    ]);
                                    this.hideWelcome();
                                    return [
                                        4,
                                        this.load(sch.layout, {
                                            resolver: this.resolver,
                                            mode: "term"
                                        })
                                    ];
                                case 9:
                                    _state.sent();
                                    ping("load-ok");
                                    return [
                                        3,
                                        11
                                    ];
                                case 10:
                                    e1 = _state.sent();
                                    ping("load-err:" + encodeURIComponent(String(e1 && e1.message || e1)).slice(0, 90));
                                    return [
                                        3,
                                        11
                                    ];
                                case 11:
                                    return [
                                        3,
                                        13
                                    ];
                                case 12:
                                    this.showWelcome();
                                    this.startPolling();
                                    this.startCommands();
                                    this.startHeartbeat();
                                    _state.label = 13;
                                case 13:
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
                                    serial = null;
                                    try {
                                        serial = localStorage.getItem("luma_term_serial");
                                    } catch (unused) {
                                        serial = null;
                                    }
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
                                        objAssign2(body, {
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
                    this._nsCache = null;
                    this._nsAt = 0;
                    var pullNativeStatus = function pullNativeStatus() {
                        if (!native("getNativeStatus")) return;
                        var now = Date.now();
                        if (now - _this._nsAt < 5e3) return;
                        _this._nsAt = now;
                        try {
                            Promise.resolve(window.LumaBridge.getNativeStatus()).then(function(raw) {
                                try {
                                    var info = typeof raw === "string" ? JSON.parse(raw) : raw;
                                    if (info) _this._nsCache = info;
                                } catch (e) {}
                            }).catch(function() {});
                        } catch (e) {}
                    };
                    pullNativeStatus();
                    this.hbTimer = setInterval(function() {
                        return _async_to_generator(function() {
                            var _this_layout, body, info, t0, dt, unused;
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
                                            3,
                                            ,
                                            4
                                        ]);
                                        body = {
                                            terminalId: this.terminalId,
                                            token: this.token,
                                            playing: ((_this_layout = this.layout) === null || _this_layout === void 0 ? void 0 : _this_layout.name) || null,
                                            latency: this._hbLatency || void 0
                                        };
                                        pullNativeStatus();
                                        info = this._nsCache;
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
                                        } else if (typeof performance !== "undefined") {
                                            body.uptime = Math.floor(performance.now() / 1e3);
                                        }
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
                                    case 2:
                                        _state.sent();
                                        dt = Math.round(performance.now() - t0);
                                        if (dt > 0 && dt < 6e4) this._hbLatency = dt;
                                        return [
                                            3,
                                            4
                                        ];
                                    case 3:
                                        unused = _state.sent();
                                        return [
                                            3,
                                            4
                                        ];
                                    case 4:
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
                    es.onerror = function() {
                        try {
                            es.close();
                        } catch (e2) {}
                        setTimeout(function() {
                            if (_this.terminalId && _this.es === es) _this.startCommands();
                        }, 5e3);
                    };
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
                        var _this_layout, _this_layout1, W, H, cv, c, blob, _tmp, unused;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _state.trys.push([
                                        0,
                                        6,
                                        ,
                                        7
                                    ]);
                                    if (native("capture")) {
                                        window.LumaBridge.capture("window.__lumaPlayer.onCaptureShot");
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
                                    if (!(typeof cv.toBlob === "function")) return [
                                        3,
                                        2
                                    ];
                                    return [
                                        4,
                                        new Promise(function(res) {
                                            return cv.toBlob(res, "image/jpeg", 0.8);
                                        })
                                    ];
                                case 1:
                                    _tmp = _state.sent();
                                    return [
                                        3,
                                        3
                                    ];
                                case 2:
                                    _tmp = null;
                                    _state.label = 3;
                                case 3:
                                    blob = _tmp;
                                    if (!blob) return [
                                        3,
                                        5
                                    ];
                                    return [
                                        4,
                                        this.uploadBlob(blob)
                                    ];
                                case 4:
                                    _state.sent();
                                    _state.label = 5;
                                case 5:
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
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                key: "onCaptureShot",
                value: function onCaptureShot(dataUrl) {
                    if (dataUrl) this.uploadShot(dataUrl);
                }
            },
            {
                key: "uploadShot",
                value: function uploadShot(dataUrl) {
                    return _async_to_generator(function() {
                        var blob, parts, mime, bstr, u8, i, unused;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _state.trys.push([
                                        0,
                                        6,
                                        ,
                                        7
                                    ]);
                                    if (!(dataUrl && dataUrl.indexOf("data:") === 0)) return [
                                        3,
                                        1
                                    ];
                                    parts = dataUrl.split(",");
                                    mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
                                    bstr = atob(parts[1]);
                                    u8 = new Uint8Array(bstr.length);
                                    for(i = 0; i < bstr.length; i++)u8[i] = bstr.charCodeAt(i);
                                    blob = new Blob([
                                        u8
                                    ], {
                                        type: mime
                                    });
                                    return [
                                        3,
                                        4
                                    ];
                                case 1:
                                    return [
                                        4,
                                        fetch(dataUrl)
                                    ];
                                case 2:
                                    return [
                                        4,
                                        _state.sent().blob()
                                    ];
                                case 3:
                                    blob = _state.sent();
                                    _state.label = 4;
                                case 4:
                                    return [
                                        4,
                                        this.uploadBlob(blob)
                                    ];
                                case 5:
                                    _state.sent();
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
                        var q, unused;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _state.trys.push([
                                        0,
                                        2,
                                        ,
                                        3
                                    ]);
                                    q = "terminalId=".concat(encodeURIComponent(this.terminalId || ""), "&token=").concat(encodeURIComponent(this.token || ""));
                                    return [
                                        4,
                                        fetch("/api/t/shot?".concat(q), {
                                            method: "POST",
                                            body: blob,
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
            var q, mode, terminalId, token, layoutId, inline, player, layout, sv, man, r, unused, sch, e, e1, r1, data, layout1;
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
                        window.__lumaPlayer = player;
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
                            19
                        ];
                        ping("term-branch");
                        _state.label = 1;
                    case 1:
                        _state.trys.push([
                            1,
                            17,
                            ,
                            18
                        ]);
                        if (!terminalId) return [
                            3,
                            2
                        ];
                        player.terminalId = terminalId;
                        player.token = token;
                        return [
                            3,
                            4
                        ];
                    case 2:
                        return [
                            4,
                            player.ensureTerminal()
                        ];
                    case 3:
                        _state.sent();
                        _state.label = 4;
                    case 4:
                        ping("term-id=" + (player.terminalId ? "ok" : "null"));
                        player.startPolling();
                        player.startCommands();
                        player.startHeartbeat();
                        ping("timers-started");
                        sv = null;
                        try {
                            sv = sessionStorage.getItem("luma_html_v");
                        } catch (e) {}
                        if (sv !== HTML_V && location.search.indexOf("_v=") === -1) {
                            try {
                                sessionStorage.setItem("luma_html_v", HTML_V);
                            } catch (e) {}
                            ping("html-upgrade-" + HTML_V);
                            location.replace("/player/?mode=term&_v=" + HTML_V);
                            return [
                                2
                            ];
                        }
                        setTimeout(function() {
                            if (mode === "term" && !player.terminalId) {
                                ping("stuck-10s-retry");
                                player.ensureTerminal();
                            }
                        }, 1e4);
                        man = null;
                        _state.label = 5;
                    case 5:
                        _state.trys.push([
                            5,
                            9,
                            ,
                            10
                        ]);
                        return [
                            4,
                            fetch("/api/t/manifest?terminalId=".concat(encodeURIComponent(player.terminalId || ""), "&token=").concat(encodeURIComponent(player.token || "")))
                        ];
                    case 6:
                        r = _state.sent();
                        if (!r.ok) return [
                            3,
                            8
                        ];
                        return [
                            4,
                            r.json()
                        ];
                    case 7:
                        man = _state.sent();
                        try {
                            localStorage.setItem("luma_manifest", JSON.stringify(man));
                        } catch (unused) {}
                        _state.label = 8;
                    case 8:
                        return [
                            3,
                            10
                        ];
                    case 9:
                        unused = _state.sent();
                        return [
                            3,
                            10
                        ];
                    case 10:
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
                        ping("m1-ok");
                        player.lastManifest = man;
                        sch = null;
                        try {
                            sch = pickActiveSchedule(man);
                        } catch (e) {
                            ping("pick-err:" + encodeURIComponent(String(e && e.message || e)).slice(0, 80));
                        }
                        ping("sched=" + (sch ? sch.scheduleId : "null"));
                        player.currentScheduleId = sch ? sch.scheduleId : null;
                        if (!sch) return [
                            3,
                            15
                        ];
                        try {
                            player.hideWelcome();
                        } catch (e) {
                            ping("hw-err:" + encodeURIComponent(String(e && e.message || e)).slice(0, 80));
                        }
                        _state.label = 11;
                    case 11:
                        _state.trys.push([
                            11,
                            13,
                            ,
                            14
                        ]);
                        return [
                            4,
                            player.load(sch.layout, {
                                resolver: function resolver(id) {
                                    return "/api/t/media/".concat(id, "?terminalId=").concat(encodeURIComponent(player.terminalId || ""), "&token=").concat(encodeURIComponent(player.token || ""));
                                },
                                mode: "term"
                            })
                        ];
                    case 12:
                        _state.sent();
                        ping("boot-load-ok");
                        return [
                            3,
                            14
                        ];
                    case 13:
                        e = _state.sent();
                        ping("boot-load-err:" + encodeURIComponent(String(e && e.message || e)).slice(0, 90));
                        showFallback("\u6E32\u67D3\u5F02\u5E38\uFF1A" + (e && e.message || e));
                        return [
                            3,
                            14
                        ];
                    case 14:
                        return [
                            3,
                            16
                        ];
                    case 15:
                        player.showWelcome();
                        player.startPolling();
                        player.startCommands();
                        player.startHeartbeat();
                        _state.label = 16;
                    case 16:
                        return [
                            3,
                            18
                        ];
                    case 17:
                        e1 = _state.sent();
                        ping("boot-err:" + encodeURIComponent(String(e1 && e1.message || e1)).slice(0, 90));
                        showFallback("\u542F\u52A8\u5F02\u5E38\uFF1A" + (e1 && e1.message || e1));
                        return [
                            3,
                            18
                        ];
                    case 18:
                        return [
                            2
                        ];
                    case 19:
                        if (!layoutId) return [
                            3,
                            22
                        ];
                        return [
                            4,
                            fetch("/api/layouts/".concat(encodeURIComponent(layoutId)))
                        ];
                    case 20:
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
                    case 21:
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
                    case 22:
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
    if (o && typeof o.next === "function") { return o; }
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
    // player/widgets.js
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
    var pad2 = function pad2(n) {
        return n < 10 ? "0" + n : "" + n;
    };
    var objAssign = function objAssign(t, s) {
        if (s) {
            for(var k in s){
                if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
            }
        }
        return t;
    };
    var appendAll = function appendAll(p, ns) {
        for(var i = 0; i < ns.length; i++){
            if (ns[i] != null) p.appendChild(ns[i]);
        }
        return p;
    };
    function renderImage(holder, item, resolver2) {
        var img = document.createElement("img");
        var url = item.mediaId ? resolver2(item.mediaId) : item.url || "";
        img.src = url;
        img.className = "w-img " + (item.fit || "cover");
        img.alt = item.alt || "";
        img.onerror = function() {
            var miss = objAssign(document.createElement("div"), {
                className: "w-img",
                textContent: "\u56FE\u7247\u7F3A\u5931"
            });
            if (img.parentNode) img.parentNode.replaceChild(miss, img);
        };
        holder.appendChild(img);
        return function() {};
    }
    function renderVideo(holder, item, resolver2, onEnd) {
        var v = document.createElement("video");
        var url = item.mediaId ? resolver2(item.mediaId) : item.url || "";
        v.muted = true;
        v.defaultMuted = true;
        v.setAttribute("muted", "");
        v.volume = 0;
        v.setAttribute("autoplay", "");
        v.setAttribute("playsinline", "");
        v.setAttribute("webkit-playsinline", "");
        v.autoplay = true;
        v.playsInline = true;
        v.src = url;
        v.loop = !!item.loop && !(item.duration > 0);
        v.className = "w-video " + (item.fit || "cover");
        v.addEventListener("ended", function() {
            return onEnd && onEnd();
        });
        holder.appendChild(v);
        var started = false;
        var watchdog = setTimeout(function() {
            if (!started && v.currentTime < 0.5) {
                try {
                    v.pause();
                } catch (e) {}
                onEnd && onEnd();
            }
        }, 8e3);
        v.addEventListener("timeupdate", function() {
            if (v.currentTime > 0.5) started = true;
        });
        v.addEventListener("error", function() {
            if (!started) {
                clearTimeout(watchdog);
                onEnd && onEnd();
            }
        });
        var p = v.play();
        if (p && p.catch) p.catch(function() {});
        if (window.__lumaPlayer) {
            var bpKey = (item.id || "") + "|" + (item.mediaId || url || "");
            v.addEventListener("loadedmetadata", function() {
                if (window.__lumaPlayer.loadBreakpoint) {
                    var bp = window.__lumaPlayer.loadBreakpoint(bpKey);
                    if (bp && bp.position > 0 && bp.position < (v.duration || Infinity)) {
                        try {
                            v.currentTime = bp.position;
                        } catch (e) {}
                    }
                }
            });
            var lastReport = 0;
            v.addEventListener("timeupdate", function() {
                if (!item.duration && window.__lumaPlayer.reportBreakpoint) {
                    var now = Date.now();
                    if (now - lastReport > 3e3 && v.currentTime > 0) {
                        lastReport = now;
                        try {
                            window.__lumaPlayer.reportBreakpoint(bpKey, v.currentTime, v.duration || 0);
                        } catch (e) {}
                    }
                }
            });
        }
        return function() {
            clearTimeout(watchdog);
            if (window.__lumaPlayer && window.__lumaPlayer.reportBreakpoint && item.id) {
                var bpKey = (item.id || "") + "|" + (item.mediaId || url || "");
                try {
                    if (v.currentTime > 0 && v.duration) window.__lumaPlayer.reportBreakpoint(bpKey, v.currentTime, v.duration);
                } catch (e) {}
            }
            try {
                v.pause();
            } catch (e) {}
        };
    }
    function renderBorderMarquee(holder, item) {
        var wrap = document.createElement("div");
        wrap.className = "w-border-marquee";
        var fs = item.fontSize ? "font-size:".concat(item.fontSize, "px;") : "font-size:28px;";
        var color = item.color ? "color:".concat(item.color, ";") : "color:#ffffff;";
        var bg = item.bg ? "background:".concat(item.bg, ";") : "background:rgba(0,0,0,0.5);";
        var pad3 = item.padding != null ? item.padding : 4;
        wrap.style.cssText = fs + color + bg + "padding:".concat(pad3, "px;box-sizing:border-box;");
        var text = item.text || "\u6B22\u8FCE\u5149\u4E34\uFF0C\u8BF7\u591A\u591A\u5173\u7167";
        var speed = item.speed || 4;
        var behavior = item.behavior || "scroll";
        var makeLine = function makeLine(vertical) {
            var m = document.createElement("marquee");
            m.textContent = text + "\u3000\u3000" + text;
            m.setAttribute("scrollamount", String(speed));
            m.setAttribute("scrolldelay", item.delay || "90");
            m.setAttribute("behavior", behavior);
            if (vertical) m.setAttribute("direction", "up");
            m.className = vertical ? "bm-v" : "bm-h";
            return m;
        };
        appendAll(wrap, [
            makeLine(false),
            makeLine(true),
            makeLine(true),
            makeLine(false)
        ]);
        holder.appendChild(wrap);
        return function() {};
    }
    function renderTimerPlay(holder, item) {
        var d = document.createElement("div");
        d.className = "w-timer-play";
        var fs = item.fontSize || 44;
        var color = item.color || "#ffffff";
        var bg = item.bg || "rgba(0,0,0,0.6)";
        d.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:".concat(bg, ";color:").concat(color, ";font-size:").concat(fs, "px;font-weight:600;text-align:center;line-height:1.4;");
        holder.appendChild(d);
        var startStr = item.startTime || "00:00";
        var endStr = item.endTime || startStr;
        var content = item.content || "\u8282\u76EE\u5185\u5BB9";
        var title = item.title || "";
        var render = function render() {
            var now = /* @__PURE__ */ new Date();
            var nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
            var _String_split_map = _sliced_to_array(String(startStr).split(":").map(Number), 2), sh = _String_split_map[0], sm = _String_split_map[1];
            var _String_split_map1 = _sliced_to_array(String(endStr).split(":").map(Number), 2), eh = _String_split_map1[0], em = _String_split_map1[1];
            var startSec = sh * 3600 + sm * 60;
            var endSec = eh * 3600 + em * 60;
            var inWindow2, diff;
            if (startSec <= endSec) {
                inWindow2 = nowSec >= startSec && nowSec <= endSec;
                if (!inWindow2) diff = nowSec > endSec ? startSec + 86400 - nowSec : startSec - nowSec;
            } else {
                inWindow2 = nowSec >= startSec || nowSec <= endSec;
                if (!inWindow2) diff = startSec - nowSec;
            }
            if (inWindow2) {
                d.innerHTML = '<div><div style="font-size:'.concat(fs + 8, 'px;margin-bottom:8px;">').concat(esc(title || "\u8282\u76EE\u64AD\u653E\u4E2D"), "</div><div>").concat(esc(content), "</div></div>");
            } else {
                var h = Math.floor(diff / 3600);
                var m = Math.floor(diff % 3600 / 60);
                var s = diff % 60;
                var pad2n = function pad2n(n) {
                    return n < 10 ? "0" + n : "" + n;
                };
                d.innerHTML = '<div><div style="opacity:.7;font-size:'.concat(fs - 8, 'px;margin-bottom:6px;">').concat(esc(title || "\u8282\u76EE"), '</div><div>距离开始还有 <span style="font-variant-numeric:tabular-nums;">').concat(pad2n(h), ":").concat(pad2n(m), ":").concat(pad2n(s), '</span></div><div style="opacity:.5;font-size:').concat(fs - 16, 'px;margin-top:4px;">').concat(esc(startStr), " ~ ").concat(esc(endStr), "</div></div>");
            }
        };
        render();
        var id = setInterval(render, 1e3);
        return function() {
            return clearInterval(id);
        };
    }
    function renderPoweroff(holder, item) {
        var d = document.createElement("div");
        d.className = "w-poweroff";
        var fs = item.fontSize || 48;
        var color = item.color || "#ffffff";
        var bg = item.bg || "rgba(255,0,0,0.6)";
        var title = item.title || "\u5373\u5C06\u5173\u673A";
        d.style.cssText = "width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:".concat(bg, ";color:").concat(color, ";font-size:").concat(fs, "px;font-weight:700;text-align:center;line-height:1.4;");
        holder.appendChild(d);
        var autoExitFired = false;
        var render = function render() {
            var st = window.__lumaPlayer && window.__lumaPlayer.getServerState ? window.__lumaPlayer.getServerState() : null;
            var target = st && st.poweroffAt || item.fixedAt || 0;
            if (!target) {
                d.innerHTML = '<div style="opacity:.8;font-size:'.concat(fs - 8, 'px;">未设置关机计划</div>');
                return;
            }
            var diff = Math.max(0, target - Date.now());
            if (diff === 0 && !autoExitFired) {
                autoExitFired = true;
                if (item.autoExit && window.__lumaPlayer && window.__lumaPlayer.exit) {
                    try {
                        window.__lumaPlayer.exit("poweroff-scheduled");
                    } catch (e) {}
                }
            }
            var s = Math.floor(diff / 1e3);
            var h = Math.floor(s / 3600);
            var m = Math.floor(s % 3600 / 60);
            var sec = s % 60;
            var pad2n = function pad2n(n) {
                return n < 10 ? "0" + n : "" + n;
            };
            d.innerHTML = '<div style="opacity:.9;font-size:'.concat(fs - 8, 'px;margin-bottom:8px;">').concat(esc(title), '</div><div style="font-variant-numeric:tabular-nums;letter-spacing:.05em;">').concat(pad2n(h), ":").concat(pad2n(m), ":").concat(pad2n(sec), '</div><div style="opacity:.7;font-size:').concat(fs - 20, 'px;margin-top:6px;">').concat(esc(item.subtitle || "\u8DDD\u4E0B\u6B21\u5173\u673A"), "</div>");
        };
        render();
        var id = setInterval(render, 1e3);
        return function() {
            return clearInterval(id);
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
        var pad3 = function pad3(n) {
            return pad2(n);
        };
        var tick = function tick() {
            var now = /* @__PURE__ */ new Date();
            if (item.format === "analog") {
                timeEl.textContent = "".concat(pad3(now.getHours()), ":").concat(pad3(now.getMinutes()));
            } else {
                timeEl.textContent = "".concat(pad3(now.getHours()), ":").concat(pad3(now.getMinutes()), ":").concat(pad3(now.getSeconds()));
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
    function renderDate(holder, item) {
        var d = document.createElement("div");
        d.className = "w-date";
        var fs = item.fontSize ? "font-size:".concat(item.fontSize, "px;") : "";
        var color = item.color ? "color:".concat(item.color, ";") : "";
        var bg = item.bg ? "background:".concat(item.bg, ";") : "";
        d.style.cssText = fs + color + bg;
        holder.appendChild(d);
        var fmt = item.format || "long";
        var tick = function tick() {
            var now = /* @__PURE__ */ new Date();
            if (fmt === "md") d.textContent = pad(now.getMonth() + 1) + "-" + pad(now.getDate());
            else if (fmt === "ym") d.textContent = now.getFullYear() + "/" + pad(now.getMonth() + 1);
            else if (fmt === "dmy") d.textContent = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
            else d.textContent = "".concat(now.getFullYear(), "年").concat(now.getMonth() + 1, "月").concat(now.getDate(), "日");
        };
        tick();
        var id = setInterval(tick, 3e4);
        return function() {
            return clearInterval(id);
        };
    }
    function renderWeekday(holder, item) {
        var d = document.createElement("div");
        d.className = "w-weekday";
        var fs = item.fontSize ? "font-size:".concat(item.fontSize, "px;") : "";
        var color = item.color ? "color:".concat(item.color, ";") : "";
        var bg = item.bg ? "background:".concat(item.bg, ";") : "";
        d.style.cssText = fs + color + bg;
        holder.appendChild(d);
        var cn = [
            "\u65E5",
            "\u4E00",
            "\u4E8C",
            "\u4E09",
            "\u56DB",
            "\u4E94",
            "\u516D"
        ];
        var cnFull = [
            "\u661F\u671F\u65E5",
            "\u661F\u671F\u4E00",
            "\u661F\u671F\u4E8C",
            "\u661F\u671F\u4E09",
            "\u661F\u671F\u56DB",
            "\u661F\u671F\u4E94",
            "\u661F\u671F\u516D"
        ];
        var enFull = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday"
        ];
        var enShort = [
            "Sun",
            "Mon",
            "Tue",
            "Wed",
            "Thu",
            "Fri",
            "Sat"
        ];
        var fmt = item.format || "cn";
        var tick = function tick() {
            var i = (/* @__PURE__ */ new Date()).getDay();
            d.textContent = fmt === "cn-short" ? cn[i] : fmt === "en" ? enFull[i] : fmt === "en-short" ? enShort[i] : cnFull[i];
        };
        tick();
        var id = setInterval(tick, 3e4);
        return function() {
            return clearInterval(id);
        };
    }
    function renderWeather(holder, item) {
        var box = document.createElement("div");
        box.className = "w-weather";
        var color = item.color || "#ffffff";
        var bg = item.bg || "rgba(0,0,0,0.4)";
        box.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:".concat(bg, ";color:").concat(color, ";padding:10px;box-sizing:border-box;");
        holder.appendChild(box);
        var city = (item.city || "Beijing").trim();
        var ttl = Math.max(5, item.ttl || 30) * 60 * 1e3;
        var fallback2 = item.fallback || "";
        var cache = null;
        var cacheExp = 0;
        var lastErr = null;
        var icon = function icon(w) {
            w = (w || "").toLowerCase();
            if (/clear|晴|sunshine/.test(w)) return "\u2600";
            if (/partly|多云|云/.test(w)) return "\u2601";
            if (/cloudy|阴/.test(w)) return "\u2601";
            if (/rain|雨/.test(w)) return "\uD83C\uDF27";
            if (/snow|雪/.test(w)) return "\u2744";
            if (/fog|mist|雾|霾/.test(w)) return "\uD83C\uDF2B";
            if (/thunder|雷/.test(w)) return "\u26A1";
            if (/haze|霾/.test(w)) return "\uD83C\uDF2B";
            return "\uD83C\uDF24";
        };
        var renderCard = function renderCard(data) {
            var _data_temperature_2m, _data_temperature_2m1, _data_temperature_2m2;
            var t = ((_data_temperature_2m = data.temperature_2m) === null || _data_temperature_2m === void 0 ? void 0 : _data_temperature_2m.current) != null ? Math.round(data.temperature_2m.current) : null;
            var tMin = ((_data_temperature_2m1 = data.temperature_2m) === null || _data_temperature_2m1 === void 0 ? void 0 : _data_temperature_2m1.min_24h) != null ? Math.round(data.temperature_2m.min_24h) : null;
            var tMax = ((_data_temperature_2m2 = data.temperature_2m) === null || _data_temperature_2m2 === void 0 ? void 0 : _data_temperature_2m2.max_24h) != null ? Math.round(data.temperature_2m.max_24h) : null;
            var desc = data.weather_code != null || data.weather_code ? data.weather_code_desc || "\u2014" : "\u2014";
            box.innerHTML = "";
            var card = document.createElement("div");
            card.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:4px;";
            var head = document.createElement("div");
            head.style.cssText = "font-size:".concat(item.fontSize || 20, "px;font-weight:600;letter-spacing:1px;");
            head.textContent = item.title || city;
            card.appendChild(head);
            var line = document.createElement("div");
            line.style.cssText = "font-size:".concat(item.bigFontSize || 44, "px;line-height:1.1;");
            line.textContent = "".concat(icon(desc), " ").concat(t == null ? "\u2014" : t + "\xB0");
            card.appendChild(line);
            var range = document.createElement("div");
            range.style.cssText = "font-size:14px;opacity:.85;";
            range.textContent = tMin != null && tMax != null ? "".concat(tMin, "\xb0 ~ ").concat(tMax, "\xb0") : desc || "";
            card.appendChild(range);
            if (item.showUpdated && cacheExp) {
                var up = document.createElement("div");
                up.style.cssText = "font-size:11px;opacity:.5;margin-top:2px;";
                up.textContent = "\u66F4\u65B0\u4E8E " + new Date(cacheExp - ttl).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit"
                });
                card.appendChild(up);
            }
            box.appendChild(card);
        };
        var showError = function showError() {
            if (fallback2) {
                box.textContent = fallback2;
            } else {
                box.innerHTML = "";
                var card = document.createElement("div");
                card.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:4px;opacity:.7;";
                var title = document.createElement("div");
                title.style.cssText = "font-size:".concat(item.fontSize || 18, "px;");
                title.textContent = (item.title || city) + " \u2014";
                card.appendChild(title);
                var err = document.createElement("div");
                err.style.cssText = "font-size:12px;opacity:.8;";
                err.textContent = lastErr || "\u5929\u6C14\u52A0\u8F7D\u4E2D\u2026";
                card.appendChild(err);
                box.appendChild(card);
            }
        };
        var doFetch = function doFetch() {
            return _async_to_generator(function() {
                var url, r, j, cc, e;
                return _ts_generator(this, function(_state) {
                    switch(_state.label){
                        case 0:
                            url = "https://wttr.in/" + encodeURIComponent(city) + "?format=j1";
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
                                fetch(url, {
                                    credentials: "omit"
                                })
                            ];
                        case 2:
                            r = _state.sent();
                            if (!r.ok) throw new Error("HTTP " + r.status);
                            return [
                                4,
                                r.json()
                            ];
                        case 3:
                            j = _state.sent();
                            cache = j;
                            cacheExp = Date.now() + ttl;
                            if (j && j.current_condition && j.current_condition[0]) {
                                cc = j.current_condition[0];
                                cache.temperature_2m = {
                                    current: Number(cc.temp_C),
                                    min_24h: j.weather && j.weather[0] ? Number(j.weather[0].mintempC) : null,
                                    max_24h: j.weather && j.weather[0] ? Number(j.weather[0].maxtempC) : null
                                };
                                cache.weather_code_desc = cc.weatherDesc && cc.weatherDesc[0] ? cc.weatherDesc[0].value : "";
                            }
                            renderCard(cache);
                            return [
                                3,
                                5
                            ];
                        case 4:
                            e = _state.sent();
                            lastErr = "\u7F51\u7EDC\u5F02\u5E38";
                            if (!cache) showError();
                            else renderCard(cache);
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
            })();
        };
        var refresh = function refresh() {
            var now = Date.now();
            if (cache && now < cacheExp) {
                renderCard(cache);
                return;
            }
            doFetch();
        };
        refresh();
        var id = setInterval(refresh, ttl);
        return function() {
            return clearInterval(id);
        };
    }
    function renderLogo(holder, item) {
        var wrap = document.createElement("div");
        wrap.className = "w-logo";
        wrap.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;";
        holder.appendChild(wrap);
        var img = document.createElement("img");
        var fit = item.fit || "contain";
        img.style.cssText = "object-fit:".concat(fit, ";opacity:").concat(item.opacity == null ? 0.9 : item.opacity, ";");
        if (item.w) img.style.width = item.w + (String(item.w).indexOf("%") >= 0 ? "%" : "px");
        if (item.h) img.style.height = item.h + (String(item.h).indexOf("%") >= 0 ? "%" : "px");
        img.className = "w-logo-img";
        img.onerror = function() {
            wrap.textContent = item.fallback || "";
        };
        wrap.appendChild(img);
        var url = item.mediaId ? typeof resolver === "function" ? resolver(item.mediaId) : item.mediaId : item.url || "";
        if (url) img.src = url;
        else wrap.textContent = item.fallback || "";
        return function() {};
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
        appendAll(wrap, [
            valEl,
            unitEl,
            labelEl
        ]);
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
                var pad3 = 30;
                var bw = (W - pad3 * 2) / Math.max(1, n - 1);
                var pts = rows.map(function(r, i) {
                    return "".concat(pad3 + i * bw, ",").concat(H - pad3 - r.value / maxV * (H - pad3 * 2));
                });
                svg = '<svg viewBox="0 0 '.concat(W, " ").concat(H, '" class="chart-svg" preserveAspectRatio="xMidYMid meet"><polyline points="').concat(pts.join(" "), '" fill="none" stroke="').concat(palette[0], '" stroke-width="3"/>') + rows.map(function(r, i) {
                    return '<circle cx="'.concat(pad3 + i * bw, '" cy="').concat(H - pad3 - r.value / maxV * (H - pad3 * 2), '" r="4" fill="').concat(palette[0], '"/>');
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
                appendAll(w, [
                    l,
                    i
                ]);
                return {
                    wrap: w,
                    input: i
                };
            };
            var nameRow = row("\u59D3\u540D\uFF08\u9009\u586B\uFF09", "\u60A8\u7684\u59D3\u540D");
            var phoneRow = row("\u8054\u7CFB\u7535\u8BDD", "\u624B\u673A\u53F7\u7801");
            appendAll(d, [
                nameRow.wrap,
                phoneRow.wrap
            ]);
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
        "border-marquee": renderBorderMarquee,
        "timer-play": renderTimerPlay,
        poweroff: renderPoweroff,
        clock: renderClock,
        date: renderDate,
        weekday: renderWeekday,
        weather: renderWeather,
        logo: renderLogo,
        qrcode: renderQR,
        meeting: renderMeeting,
        html: renderHtml,
        "data-text": renderDataText,
        "data-number": renderDataNumber,
        "data-chart": renderDataChart,
        "form": renderForm
    };
    function renderWidget(holder, item, resolver2, onEnd) {
        var fn = RENDERERS[item.widget] || renderText;
        return fn(holder, item, resolver2, onEnd) || function() {};
    }
    // player/engine.js
    var app = document.getElementById("app");
    var fallback = document.getElementById("fallback");
    var welcome = document.getElementById("welcome");
    var showFallback = function showFallback(msg) {
        try {
            fallback.innerHTML = '<div class="big">灵屏 LumaSign</div><div>'.concat(msg, "</div>");
            fallback.classList.remove("hidden");
        } catch (e) {}
    };
    var hideFallback = function hideFallback() {
        try {
            fallback.classList.add("hidden");
        } catch (e) {}
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
    var HTML_V = "1450";
    var pad22 = function pad22(n) {
        return n < 10 ? "0" + n : "" + n;
    };
    var objAssign2 = function objAssign2(t, s) {
        if (s) {
            for(var k in s){
                if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
            }
        }
        return t;
    };
    var appendAll2 = function appendAll2(p, ns) {
        for(var i = 0; i < ns.length; i++){
            if (ns[i] != null) p.appendChild(ns[i]);
        }
        return p;
    };
    var TRANSITION_MS = {
        "fade": 550,
        "none": 0,
        // 滑动推拉（4）
        "slide-left": 500,
        "slide-right": 500,
        "slide-up": 500,
        "slide-down": 500,
        // 推入（4）
        "push-left": 500,
        "push-right": 500,
        "push-up": 500,
        "push-down": 500,
        // 擦除（4）
        "wipe-left": 500,
        "wipe-right": 500,
        "wipe-up": 500,
        "wipe-down": 500,
        // 缩放（2）
        "zoom-in": 600,
        "zoom-out": 600,
        // 旋转（2）
        "spin-in": 600,
        "spin-out": 600,
        // 翻转（2）
        "flip-h": 700,
        "flip-v": 700,
        // 模糊（2）
        "blur-in": 400,
        "blur-out": 400,
        // 特效（3）
        "glitch": 500,
        "shake": 500,
        "flip-book": 700,
        // 3D 视差（1）
        "cube": 700
    };
    var transitionMs = function transitionMs(name) {
        return TRANSITION_MS[name] != null ? TRANSITION_MS[name] : 550;
    };
    var el = function el(tag, opts, kids) {
        var d = document.createElement(tag);
        if (opts) {
            for(var k in opts){
                if (!Object.prototype.hasOwnProperty.call(opts, k)) continue;
                if (k === "text") d.textContent = opts[k];
                else if (k === "class") d.className = opts[k];
                else d.setAttribute(k, opts[k]);
            }
        }
        if (kids) {
            for(var i = 0; i < kids.length; i++){
                if (kids[i] != null) d.appendChild(kids[i]);
            }
        }
        return d;
    };
    var native = function native(name) {
        return !!(window.LumaBridge && typeof window.LumaBridge[name] === "function");
    };
    var ymd = function ymd(d) {
        return "".concat(d.getFullYear(), "-").concat(pad22(d.getMonth() + 1), "-").concat(pad22(d.getDate()));
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
        if (Array.isArray(sch.weekdays) && sch.weekdays.length && sch.weekdays.indexOf(when.getDay()) === -1) return false;
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
            this._serverState = {};
            this._breakpointCache = {};
            this._bpTimer = null;
        }
        _create_class(Player, [
            {
                key: "stop",
                value: function stop() {
                    this.ctl.aborted = true;
                    var rcs = this.regionCtls || [];
                    for(var i = 0; i < rcs.length; i++)rcs[i].aborted = true;
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
                /* ---------------- 欢迎页（终端无展示任务时展示，对标竞品"液晶互动"空闲屏） ----------------
       竞品空闲屏展示：版本号 + 节目状态 + 鼠标/键盘交互入口。这里镜像其信息密度，
       让嵌墙设备在无任务时也清楚"我是谁、连没连上、在等什么"，而非黑屏或纯 logo。 */ key: "hideWelcome",
                value: function hideWelcome() {
                    if (welcome) welcome.classList.add("hidden");
                    if (this._welcomeTimer) {
                        clearInterval(this._welcomeTimer);
                        this._welcomeTimer = null;
                    }
                }
            },
            {
                key: "showWelcome",
                value: function showWelcome() {
                    return _async_to_generator(function() {
                        var ip, ver, hw, model, playerVer, r, raw, info, ok, statusText, statusEl, self;
                        return _ts_generator(this, function(_state) {
                            this.stop();
                            hideFallback();
                            if (!welcome) return [
                                2
                            ];
                            ip = "";
                            ver = "";
                            hw = this._hwInfo || {};
                            model = hw.model || "";
                            playerVer = window.__LUMA_PLAYER__ && window.__LUMA_PLAYER__.version || "";
                            try {
                                if (native("getIpAddress")) {
                                    r = window.LumaBridge.getIpAddress();
                                    ip = typeof r === "string" ? r.trim() : "";
                                }
                            } catch (e) {}
                            try {
                                if (native("getNativeStatus")) {
                                    raw = window.LumaBridge.getNativeStatus();
                                    info = typeof raw === "string" ? JSON.parse(raw) : raw;
                                    if (info && info.appVersion) ver = String(info.appVersion);
                                }
                            } catch (e) {}
                            ok = !!this.terminalId;
                            statusText = ok ? "\u5DF2\u8FDE\u63A5\u7BA1\u7406\u7AEF \xB7 \u7B49\u5F85\u5206\u914D\u64AD\u653E\u4EFB\u52A1" : "\u6B63\u5728\u8FDE\u63A5\u7BA1\u7406\u7AEF\u2026";
                            welcome.innerHTML = '<div class="welcome-ip">\u672C\u673AIP\uFF1A' + (ip || "\u672A\u8FDE\u63A5") + "</div>" + (ver ? '<div class="welcome-version">\u7075\u5C4F v' + escapeHtml(ver) + (playerVer ? " \xB7 \u5F15\u64CE " + escapeHtml(playerVer) : "") + "</div>" : "") + '<div class="welcome-center"><div class="welcome-title">\u7075\u5C4F LumaSign</div><div class="welcome-sub">\u5C40\u57DF\u7F51\u6570\u5B57\u6807\u724C\u64AD\u653E\u7AEF</div>' + (model ? '<div class="welcome-sub" style="font-size:16px;opacity:.4;margin-top:8px">' + escapeHtml(model) + "</div>" : "") + '<div class="welcome-status ' + (ok ? "ok" : "wait") + '"><span class="dot"></span>' + statusText + '</div><div class="welcome-pulse"></div></div><div class="welcome-hint">\u53F3\u952E / \u83DC\u5355\u952E\uFF1A\u8FD0\u7EF4\u83DC\u5355\u3000\xB7\u3000\u957F\u6309 2 \u79D2\uFF1A\u9000\u51FA\u3000\xB7\u3000\u7B49\u5F85\u64AD\u653E\u5185\u5BB9\u4E2D\u2026</div>';
                            welcome.classList.remove("hidden");
                            if (this._welcomeTimer) clearInterval(this._welcomeTimer);
                            statusEl = welcome.querySelector(".welcome-status");
                            self = this;
                            this._welcomeTimer = setInterval(function() {
                                if (!welcome || welcome.classList.contains("hidden") || !statusEl) {
                                    clearInterval(self._welcomeTimer);
                                    return;
                                }
                                var live = !!self.terminalId;
                                statusEl.className = "welcome-status " + (live ? "ok" : "wait");
                                statusEl.innerHTML = '<span class="dot"></span>' + (live ? "\u5DF2\u8FDE\u63A5\u7BA1\u7406\u7AEF \xB7 \u7B49\u5F85\u5206\u914D\u64AD\u653E\u4EFB\u52A1" : "\u6B63\u5728\u8FDE\u63A5\u7BA1\u7406\u7AEF\u2026");
                            }, 4e3);
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
                            ping("load-begin");
                            try {
                                this.stop();
                            } catch (e) {
                                ping("stop-err:" + encodeURIComponent(String(e && e.message || e)).slice(0, 90));
                            }
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
                            ping("build-stage");
                            if (this.mode === "term" && this.terminalId) this.refreshBreakpoints();
                            this.buildStage(layout);
                            ping("stage-built");
                            this.startRegions(layout);
                            ping("regions-ok");
                            this.primeDataSources().catch(function() {}).then(function() {
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
                        var _this, ids, preg, pi, pitems, pj, pit;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _this = this;
                                    ids = [];
                                    preg = this.layout && this.layout.regions || [];
                                    for(pi = 0; pi < preg.length; pi++){
                                        pitems = preg[pi].items || [];
                                        for(pj = 0; pj < pitems.length; pj++){
                                            pit = pitems[pj];
                                            if (pit.dataSourceId && ids.indexOf(pit.dataSourceId) === -1) ids.push(pit.dataSourceId);
                                        }
                                    }
                                    this._dsIds = ids;
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
                            var _this_ctl, dsi, i, data;
                            return _ts_generator(this, function(_state) {
                                switch(_state.label){
                                    case 0:
                                        if (!this._dsIds.length || ((_this_ctl = this.ctl) === null || _this_ctl === void 0 ? void 0 : _this_ctl.aborted)) return [
                                            2
                                        ];
                                        dsi = this._dsIds || [];
                                        i = 0;
                                        _state.label = 1;
                                    case 1:
                                        if (!(i < dsi.length)) return [
                                            3,
                                            4
                                        ];
                                        return [
                                            4,
                                            this.fetchDataSourceData(dsi[i])
                                        ];
                                    case 2:
                                        data = _state.sent();
                                        if (data !== null) this.dsCache[dsi[i]] = data;
                                        _state.label = 3;
                                    case 3:
                                        i++;
                                        return [
                                            3,
                                            1
                                        ];
                                    case 4:
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
                        var isVideo = /\.(mp4|webm|mov|m4v)$/i.test(url) || bg.mime && String(bg.mime).indexOf("video") === 0;
                        if (isVideo) {
                            var v = document.createElement("video");
                            v.muted = true;
                            v.volume = 0;
                            v.autoplay = true;
                            v.loop = true;
                            v.playsInline = true;
                            v.src = url;
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
                    var regions = layout && layout.regions || [];
                    for(var ri = 0; ri < regions.length; ri++){
                        var r = regions[ri];
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
                    var regs = layout && layout.regions || [];
                    for(var ri = 0; ri < regs.length; ri++){
                        var r = regs[ri];
                        var its = r.items || [];
                        for(var ii = 0; ii < its.length; ii++)its[ii]._getData = function(id) {
                            return _this.dsCache[id];
                        };
                        if (r._el) this.runRegion(r);
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
                    var _this, _loop = function(hi) {
                        var hs = list[hi];
                        var el2 = document.createElement("div");
                        el2.className = "hotspot" + (hs.shape === "circle" ? " circle" : "");
                        el2.dataset.id = hs.id;
                        el2.style.left = hs.x + "px";
                        el2.style.top = hs.y + "px";
                        el2.style.width = hs.w + "px";
                        el2.style.height = hs.h + "px";
                        el2.style.pointerEvents = interactive ? "auto" : "none";
                        if (_this.editMode) {
                            el2.classList.add("editing");
                            var lbl = document.createElement("span");
                            lbl.className = "hs-label";
                            lbl.textContent = hs.action && hs.action.label || hs.action && hs.action.type || "\u70ED\u533A";
                            el2.appendChild(lbl);
                            var handle = document.createElement("div");
                            handle.className = "hs-handle";
                            el2.appendChild(handle);
                            _this._bindHotspotInteractions(el2, hs);
                        } else if (_this.mode === "term") {
                            el2.addEventListener("click", function(e) {
                                e.stopPropagation();
                                _this1.dispatchHotspot(hs);
                            });
                        }
                        layer.appendChild(el2);
                    };
                    var _this1 = this;
                    if (!this.stage) return;
                    var layer = this.ensureHotspotLayer();
                    layer.innerHTML = "";
                    var interactive = this.editMode || this.mode === "term";
                    layer.style.pointerEvents = interactive ? "auto" : "none";
                    layer.classList.toggle("editing", this.editMode);
                    var list = this.layout && this.layout.hotspots || [];
                    for(var hi = 0; hi < list.length; hi++)_this = this, _loop(hi);
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
                    appendAll2(bar, [
                        backBtn,
                        el("div", {
                            class: "hs-nav-crumbs"
                        }, crumbs)
                    ]);
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
                    var hs = (this.layout.hotspots || []).filter(function(x) {
                        return x.id === id;
                    })[0];
                    if (!hs) return;
                    objAssign2(hs, patch);
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
                        var q, hdr, qi, e;
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
                                    qi = 0;
                                    _state.label = 1;
                                case 1:
                                    if (!(qi < q.length)) return [
                                        3,
                                        6
                                    ];
                                    _state.label = 2;
                                case 2:
                                    _state.trys.push([
                                        2,
                                        4,
                                        ,
                                        5
                                    ]);
                                    return [
                                        4,
                                        fetch("/api/interaction", {
                                            method: "POST",
                                            headers: hdr,
                                            body: JSON.stringify(q[qi])
                                        })
                                    ];
                                case 3:
                                    _state.sent();
                                    return [
                                        3,
                                        5
                                    ];
                                case 4:
                                    e = _state.sent();
                                    return [
                                        3,
                                        5
                                    ];
                                case 5:
                                    qi++;
                                    return [
                                        3,
                                        1
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
                            var _this, _loop, _this1, showing, _ret;
                            return _ts_generator(this, function(_state) {
                                switch(_state.label){
                                    case 0:
                                        _loop = function() {
                                            var items, item, warm, holder, ended, onEnd, stop, tName, tDur, prev, single, ms, startedAt, endedAt, tName2;
                                            return _ts_generator(this, function(_state) {
                                                switch(_state.label){
                                                    case 0:
                                                        items = live();
                                                        if (!!items) return [
                                                            3,
                                                            2
                                                        ];
                                                        region._el.innerHTML = "";
                                                        showing = null;
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
                                                        try {
                                                            warm = function warm(it) {
                                                                if (it && it.mediaId && (!it.widget || it.widget === "image")) {
                                                                    var im = new Image();
                                                                    im.src = _this1.resolver(it.mediaId);
                                                                }
                                                            };
                                                            warm(item);
                                                            warm(items[(idx + 1) % items.length]);
                                                        } catch (e) {}
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
                                                        tName = region.transition || "fade";
                                                        if (tName !== "none") holder.classList.add("t-" + tName);
                                                        tDur = transitionMs(tName);
                                                        prev = showing;
                                                        showing = {
                                                            holder: holder,
                                                            stop: stop
                                                        };
                                                        setTimeout(function() {
                                                            if (prev) {
                                                                try {
                                                                    prev.stop();
                                                                } catch (e) {}
                                                                if (prev.holder.parentNode) prev.holder.remove();
                                                            }
                                                        }, tName === "none" ? 30 : tDur);
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
                                                        if (!(!loop && idx >= items.length - 1)) return [
                                                            3,
                                                            5
                                                        ];
                                                        holder.classList.remove("show");
                                                        holder.classList.add("hide");
                                                        tName2 = region.transition || "fade";
                                                        return [
                                                            4,
                                                            _this.wait(tName2 === "none" ? 0 : transitionMs(tName2), function() {
                                                                return true;
                                                            }, ctl)
                                                        ];
                                                    case 4:
                                                        _state.sent();
                                                        try {
                                                            stop();
                                                        } catch (e2) {}
                                                        if (holder.parentNode) holder.remove();
                                                        showing = null;
                                                        return [
                                                            2,
                                                            "break"
                                                        ];
                                                    case 5:
                                                        idx = (idx + 1) % Math.max(1, items.length);
                                                        return [
                                                            2
                                                        ];
                                                }
                                            });
                                        };
                                        _this1 = this;
                                        showing = null;
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
                        var r, man2, e, man, sch, id, e1;
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
                                    ping("sched-n=" + (man.schedules || []).length + " hit=" + (sch ? sch.scheduleId : "null") + " cur=" + this.currentScheduleId);
                                    id = sch ? sch.scheduleId : null;
                                    if (!(id !== this.currentScheduleId)) return [
                                        3,
                                        13
                                    ];
                                    this.currentScheduleId = id;
                                    if (!sch) return [
                                        3,
                                        12
                                    ];
                                    _state.label = 8;
                                case 8:
                                    _state.trys.push([
                                        8,
                                        10,
                                        ,
                                        11
                                    ]);
                                    this.hideWelcome();
                                    return [
                                        4,
                                        this.load(sch.layout, {
                                            resolver: this.resolver,
                                            mode: "term"
                                        })
                                    ];
                                case 9:
                                    _state.sent();
                                    ping("load-ok");
                                    return [
                                        3,
                                        11
                                    ];
                                case 10:
                                    e1 = _state.sent();
                                    ping("load-err:" + encodeURIComponent(String(e1 && e1.message || e1)).slice(0, 90));
                                    return [
                                        3,
                                        11
                                    ];
                                case 11:
                                    return [
                                        3,
                                        13
                                    ];
                                case 12:
                                    this.showWelcome();
                                    this.startPolling();
                                    this.startCommands();
                                    this.startHeartbeat();
                                    _state.label = 13;
                                case 13:
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
                                    serial = null;
                                    try {
                                        serial = localStorage.getItem("luma_term_serial");
                                    } catch (unused) {
                                        serial = null;
                                    }
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
                                        objAssign2(body, {
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
                    this._nsCache = null;
                    this._nsAt = 0;
                    var pullNativeStatus = function pullNativeStatus() {
                        if (!native("getNativeStatus")) return;
                        var now = Date.now();
                        if (now - _this._nsAt < 5e3) return;
                        _this._nsAt = now;
                        try {
                            Promise.resolve(window.LumaBridge.getNativeStatus()).then(function(raw) {
                                try {
                                    var info = typeof raw === "string" ? JSON.parse(raw) : raw;
                                    if (info) _this._nsCache = info;
                                } catch (e) {}
                            }).catch(function() {});
                        } catch (e) {}
                    };
                    pullNativeStatus();
                    this.hbTimer = setInterval(function() {
                        return _async_to_generator(function() {
                            var _this_layout, body, info, t0, hr, js, unused, dt, unused1;
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
                                            8,
                                            ,
                                            9
                                        ]);
                                        body = {
                                            terminalId: this.terminalId,
                                            token: this.token,
                                            playing: ((_this_layout = this.layout) === null || _this_layout === void 0 ? void 0 : _this_layout.name) || null,
                                            latency: this._hbLatency || void 0
                                        };
                                        pullNativeStatus();
                                        info = this._nsCache;
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
                                            if (Array.isArray(info.devices)) body.devices = info.devices;
                                        } else if (typeof performance !== "undefined") {
                                            body.uptime = Math.floor(performance.now() / 1e3);
                                        }
                                        t0 = performance.now();
                                        _state.label = 2;
                                    case 2:
                                        _state.trys.push([
                                            2,
                                            6,
                                            ,
                                            7
                                        ]);
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
                                    case 3:
                                        hr = _state.sent();
                                        if (!hr.ok) return [
                                            3,
                                            5
                                        ];
                                        return [
                                            4,
                                            hr.json()
                                        ];
                                    case 4:
                                        js = _state.sent();
                                        if (js && js.ok !== false) this._serverState = js;
                                        _state.label = 5;
                                    case 5:
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
                                        dt = Math.round(performance.now() - t0);
                                        if (dt > 0 && dt < 6e4) this._hbLatency = dt;
                                        return [
                                            3,
                                            9
                                        ];
                                    case 8:
                                        unused1 = _state.sent();
                                        return [
                                            3,
                                            9
                                        ];
                                    case 9:
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
                // ★ v1.3.31：暴露服务端状态给 widget（PowerOff / TimerPlay 等）
                key: "getServerState",
                value: function getServerState() {
                    return this._serverState || {};
                }
            },
            {
                // ★ v1.3.31：断点续播（对齐竞品 BreakPointDBAdapter）
                //   key 格式：itemId|mediaId 或 itemId|url；返回 {position, duration} 或 null
                key: "loadBreakpoint",
                value: function loadBreakpoint(key) {
                    var c = this._breakpointCache;
                    var b = c[key];
                    if (!b) return null;
                    if (b.expired && b.expired < Date.now()) return null;
                    return {
                        position: b.position || 0,
                        duration: b.duration || 0
                    };
                }
            },
            {
                // ★ v1.3.31：断点续播上报（本地缓存 + 服务端持久化）
                key: "reportBreakpoint",
                value: function reportBreakpoint(key, position, duration) {
                    var _this = this;
                    if (!key || !position) return;
                    var now = Date.now();
                    var expireMs = 24 * 3600 * 1e3;
                    this._breakpointCache[key] = {
                        position: position,
                        duration: duration,
                        at: now,
                        expired: now + expireMs
                    };
                    if (!this._bpTimer) {
                        this._bpTimer = setInterval(function() {
                            var t = Date.now();
                            for(var k in _this._breakpointCache){
                                if (_this._breakpointCache[k].expired < t) delete _this._breakpointCache[k];
                            }
                        }, 60 * 60 * 1e3);
                    }
                    if (!this.terminalId) return;
                    fetch("/api/t/breakpoint", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        credentials: "same-origin",
                        body: JSON.stringify({
                            terminalId: this.terminalId,
                            token: this.token || "",
                            key: key,
                            position: position,
                            duration: duration
                        })
                    }).catch(function() {});
                }
            },
            {
                key: "refreshBreakpoints",
                value: // ★ v1.3.31：请求服务端刷新断点缓存（新节目加载时拉取最近 24h 保存的进度）
                function refreshBreakpoints() {
                    return _async_to_generator(function() {
                        var r, js, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, b, now, unused;
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
                                        4,
                                        ,
                                        5
                                    ]);
                                    return [
                                        4,
                                        fetch("/api/t/breakpoints?terminalId=".concat(encodeURIComponent(this.terminalId), "&token=").concat(encodeURIComponent(this.token || "")))
                                    ];
                                case 2:
                                    r = _state.sent();
                                    if (!r.ok) return [
                                        2
                                    ];
                                    return [
                                        4,
                                        r.json()
                                    ];
                                case 3:
                                    js = _state.sent();
                                    if (js && js.ok && js.breakpoints) {
                                        _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                                        try {
                                            for(_iterator = js.breakpoints[Symbol.iterator](); !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
                                                b = _step.value;
                                                if (b.key && b.position > 0) {
                                                    now = Date.now();
                                                    this._breakpointCache[b.key] = {
                                                        position: b.position,
                                                        duration: b.duration || 0,
                                                        at: now,
                                                        expired: now + 24 * 3600 * 1e3
                                                    };
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
                                    }
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
                // ★ v1.3.31：退出播放（PowerOff 倒计时归零、管理员触发等场景）
                key: "exit",
                value: function exit(reason) {
                    try {
                        if (typeof window.LumaBridge !== "undefined" && window.LumaBridge && window.LumaBridge.exitApp) window.LumaBridge.exitApp();
                    } catch (unused) {}
                    try {
                        if (typeof window.LumaBridge !== "undefined" && window.LumaBridge && window.LumaBridge.shutdown) window.LumaBridge.shutdown();
                    } catch (unused) {}
                    try {
                        if (this.terminalId) fetch("/api/t/ping?stage=exit&reason=".concat(encodeURIComponent(reason || "js-exit"), "&t=").concat(Date.now())).catch(function() {});
                    } catch (unused) {}
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
                    es.onerror = function() {
                        try {
                            es.close();
                        } catch (e2) {}
                        setTimeout(function() {
                            if (_this.terminalId && _this.es === es) _this.startCommands();
                        }, 5e3);
                    };
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
                        var _this_layout, _this_layout1, W, H, cv, c, blob, _tmp, unused;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _state.trys.push([
                                        0,
                                        6,
                                        ,
                                        7
                                    ]);
                                    if (native("capture")) {
                                        window.LumaBridge.capture("window.__lumaPlayer.onCaptureShot");
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
                                    if (!(typeof cv.toBlob === "function")) return [
                                        3,
                                        2
                                    ];
                                    return [
                                        4,
                                        new Promise(function(res) {
                                            return cv.toBlob(res, "image/jpeg", 0.8);
                                        })
                                    ];
                                case 1:
                                    _tmp = _state.sent();
                                    return [
                                        3,
                                        3
                                    ];
                                case 2:
                                    _tmp = null;
                                    _state.label = 3;
                                case 3:
                                    blob = _tmp;
                                    if (!blob) return [
                                        3,
                                        5
                                    ];
                                    return [
                                        4,
                                        this.uploadBlob(blob)
                                    ];
                                case 4:
                                    _state.sent();
                                    _state.label = 5;
                                case 5:
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
                                        2
                                    ];
                            }
                        });
                    }).call(this);
                }
            },
            {
                key: "onCaptureShot",
                value: function onCaptureShot(dataUrl) {
                    if (dataUrl) this.uploadShot(dataUrl);
                }
            },
            {
                key: "uploadShot",
                value: function uploadShot(dataUrl) {
                    return _async_to_generator(function() {
                        var blob, parts, mime, bstr, u8, i, unused;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _state.trys.push([
                                        0,
                                        6,
                                        ,
                                        7
                                    ]);
                                    if (!(dataUrl && dataUrl.indexOf("data:") === 0)) return [
                                        3,
                                        1
                                    ];
                                    parts = dataUrl.split(",");
                                    mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
                                    bstr = atob(parts[1]);
                                    u8 = new Uint8Array(bstr.length);
                                    for(i = 0; i < bstr.length; i++)u8[i] = bstr.charCodeAt(i);
                                    blob = new Blob([
                                        u8
                                    ], {
                                        type: mime
                                    });
                                    return [
                                        3,
                                        4
                                    ];
                                case 1:
                                    return [
                                        4,
                                        fetch(dataUrl)
                                    ];
                                case 2:
                                    return [
                                        4,
                                        _state.sent().blob()
                                    ];
                                case 3:
                                    blob = _state.sent();
                                    _state.label = 4;
                                case 4:
                                    return [
                                        4,
                                        this.uploadBlob(blob)
                                    ];
                                case 5:
                                    _state.sent();
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
                        var q, unused;
                        return _ts_generator(this, function(_state) {
                            switch(_state.label){
                                case 0:
                                    _state.trys.push([
                                        0,
                                        2,
                                        ,
                                        3
                                    ]);
                                    q = "terminalId=".concat(encodeURIComponent(this.terminalId || ""), "&token=").concat(encodeURIComponent(this.token || ""));
                                    return [
                                        4,
                                        fetch("/api/t/shot?".concat(q), {
                                            method: "POST",
                                            body: blob,
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
            var q, mode, terminalId, token, layoutId, inline, player, layout, sv, man, r, unused, sch, e, e1, r1, data, layout1;
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
                        window.__lumaPlayer = player;
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
                                    resolver: function resolver1(id) {
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
                                    resolver: function resolver1(id) {
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
                            19
                        ];
                        ping("term-branch");
                        _state.label = 1;
                    case 1:
                        _state.trys.push([
                            1,
                            17,
                            ,
                            18
                        ]);
                        if (!terminalId) return [
                            3,
                            2
                        ];
                        player.terminalId = terminalId;
                        player.token = token;
                        return [
                            3,
                            4
                        ];
                    case 2:
                        return [
                            4,
                            player.ensureTerminal()
                        ];
                    case 3:
                        _state.sent();
                        _state.label = 4;
                    case 4:
                        ping("term-id=" + (player.terminalId ? "ok" : "null"));
                        player.startPolling();
                        player.startCommands();
                        player.startHeartbeat();
                        ping("timers-started");
                        sv = null;
                        try {
                            sv = sessionStorage.getItem("luma_html_v");
                        } catch (e) {}
                        if (sv !== HTML_V && location.search.indexOf("_v=") === -1) {
                            try {
                                sessionStorage.setItem("luma_html_v", HTML_V);
                            } catch (e) {}
                            ping("html-upgrade-" + HTML_V);
                            location.replace("/player/?mode=term&_v=" + HTML_V);
                            return [
                                2
                            ];
                        }
                        setTimeout(function() {
                            if (mode === "term" && !player.terminalId) {
                                ping("stuck-10s-retry");
                                player.ensureTerminal();
                            }
                        }, 1e4);
                        man = null;
                        _state.label = 5;
                    case 5:
                        _state.trys.push([
                            5,
                            9,
                            ,
                            10
                        ]);
                        return [
                            4,
                            fetch("/api/t/manifest?terminalId=".concat(encodeURIComponent(player.terminalId || ""), "&token=").concat(encodeURIComponent(player.token || "")))
                        ];
                    case 6:
                        r = _state.sent();
                        if (!r.ok) return [
                            3,
                            8
                        ];
                        return [
                            4,
                            r.json()
                        ];
                    case 7:
                        man = _state.sent();
                        try {
                            localStorage.setItem("luma_manifest", JSON.stringify(man));
                        } catch (unused) {}
                        _state.label = 8;
                    case 8:
                        return [
                            3,
                            10
                        ];
                    case 9:
                        unused = _state.sent();
                        return [
                            3,
                            10
                        ];
                    case 10:
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
                        ping("m1-ok");
                        player.lastManifest = man;
                        sch = null;
                        try {
                            sch = pickActiveSchedule(man);
                        } catch (e) {
                            ping("pick-err:" + encodeURIComponent(String(e && e.message || e)).slice(0, 80));
                        }
                        ping("sched=" + (sch ? sch.scheduleId : "null"));
                        player.currentScheduleId = sch ? sch.scheduleId : null;
                        if (!sch) return [
                            3,
                            15
                        ];
                        try {
                            player.hideWelcome();
                        } catch (e) {
                            ping("hw-err:" + encodeURIComponent(String(e && e.message || e)).slice(0, 80));
                        }
                        _state.label = 11;
                    case 11:
                        _state.trys.push([
                            11,
                            13,
                            ,
                            14
                        ]);
                        return [
                            4,
                            player.load(sch.layout, {
                                resolver: function resolver1(id) {
                                    return "/api/t/media/".concat(id, "?terminalId=").concat(encodeURIComponent(player.terminalId || ""), "&token=").concat(encodeURIComponent(player.token || ""));
                                },
                                mode: "term"
                            })
                        ];
                    case 12:
                        _state.sent();
                        ping("boot-load-ok");
                        return [
                            3,
                            14
                        ];
                    case 13:
                        e = _state.sent();
                        ping("boot-load-err:" + encodeURIComponent(String(e && e.message || e)).slice(0, 90));
                        showFallback("\u6E32\u67D3\u5F02\u5E38\uFF1A" + (e && e.message || e));
                        return [
                            3,
                            14
                        ];
                    case 14:
                        return [
                            3,
                            16
                        ];
                    case 15:
                        player.showWelcome();
                        player.startPolling();
                        player.startCommands();
                        player.startHeartbeat();
                        _state.label = 16;
                    case 16:
                        return [
                            3,
                            18
                        ];
                    case 17:
                        e1 = _state.sent();
                        ping("boot-err:" + encodeURIComponent(String(e1 && e1.message || e1)).slice(0, 90));
                        showFallback("\u542F\u52A8\u5F02\u5E38\uFF1A" + (e1 && e1.message || e1));
                        return [
                            3,
                            18
                        ];
                    case 18:
                        return [
                            2
                        ];
                    case 19:
                        if (!layoutId) return [
                            3,
                            22
                        ];
                        return [
                            4,
                            fetch("/api/layouts/".concat(encodeURIComponent(layoutId)))
                        ];
                    case 20:
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
                    case 21:
                        data = _state.sent();
                        layout1 = data.item || data;
                        player.load(layout1, {
                            resolver: function resolver1(id) {
                                return "/api/media/".concat(id, "/raw");
                            },
                            mode: "preview"
                        });
                        return [
                            2
                        ];
                    case 22:
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
