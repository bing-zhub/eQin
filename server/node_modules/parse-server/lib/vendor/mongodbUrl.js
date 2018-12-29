// A slightly patched version of node's url module, with support for mongodb://
// uris.
//
// See https://github.com/nodejs/node/blob/master/LICENSE for licensing
// information

'use strict';

const punycode = require('punycode');

exports.parse = urlParse;
exports.resolve = urlResolve;
exports.resolveObject = urlResolveObject;
exports.format = urlFormat;

exports.Url = Url;

function Url() {
  this.protocol = null;
  this.slashes = null;
  this.auth = null;
  this.host = null;
  this.port = null;
  this.hostname = null;
  this.hash = null;
  this.search = null;
  this.query = null;
  this.pathname = null;
  this.path = null;
  this.href = null;
}

// Reference: RFC 3986, RFC 1808, RFC 2396

// define these here so at least they only have to be
// compiled once on the first module load.
const protocolPattern = /^([a-z0-9.+-]+:)/i;
const portPattern = /:[0-9]*$/;

// Special case for a simple path URL
const simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/;

const hostnameMaxLen = 255;
// protocols that can allow "unsafe" and "unwise" chars.
const unsafeProtocol = {
  'javascript': true,
  'javascript:': true
};
// protocols that never have a hostname.
const hostlessProtocol = {
  'javascript': true,
  'javascript:': true
};
// protocols that always contain a // bit.
const slashedProtocol = {
  'http': true,
  'http:': true,
  'https': true,
  'https:': true,
  'ftp': true,
  'ftp:': true,
  'gopher': true,
  'gopher:': true,
  'file': true,
  'file:': true
};
const querystring = require('querystring');

/* istanbul ignore next: improve coverage */
function urlParse(url, parseQueryString, slashesDenoteHost) {
  if (url instanceof Url) return url;

  var u = new Url();
  u.parse(url, parseQueryString, slashesDenoteHost);
  return u;
}

/* istanbul ignore next: improve coverage */
Url.prototype.parse = function (url, parseQueryString, slashesDenoteHost) {
  if (typeof url !== 'string') {
    throw new TypeError('Parameter "url" must be a string, not ' + typeof url);
  }

  // Copy chrome, IE, opera backslash-handling behavior.
  // Back slashes before the query string get converted to forward slashes
  // See: https://code.google.com/p/chromium/issues/detail?id=25916
  var hasHash = false;
  var start = -1;
  var end = -1;
  var rest = '';
  var lastPos = 0;
  var i = 0;
  for (var inWs = false, split = false; i < url.length; ++i) {
    const code = url.charCodeAt(i);

    // Find first and last non-whitespace characters for trimming
    const isWs = code === 32 /* */ || code === 9 /*\t*/ || code === 13 /*\r*/ || code === 10 /*\n*/ || code === 12 /*\f*/ || code === 160 /*\u00A0*/ || code === 65279 /*\uFEFF*/;
    if (start === -1) {
      if (isWs) continue;
      lastPos = start = i;
    } else {
      if (inWs) {
        if (!isWs) {
          end = -1;
          inWs = false;
        }
      } else if (isWs) {
        end = i;
        inWs = true;
      }
    }

    // Only convert backslashes while we haven't seen a split character
    if (!split) {
      switch (code) {
        case 35:
          // '#'
          hasHash = true;
        // Fall through
        case 63:
          // '?'
          split = true;
          break;
        case 92:
          // '\\'
          if (i - lastPos > 0) rest += url.slice(lastPos, i);
          rest += '/';
          lastPos = i + 1;
          break;
      }
    } else if (!hasHash && code === 35 /*#*/) {
        hasHash = true;
      }
  }

  // Check if string was non-empty (including strings with only whitespace)
  if (start !== -1) {
    if (lastPos === start) {
      // We didn't convert any backslashes

      if (end === -1) {
        if (start === 0) rest = url;else rest = url.slice(start);
      } else {
        rest = url.slice(start, end);
      }
    } else if (end === -1 && lastPos < url.length) {
      // We converted some backslashes and have only part of the entire string
      rest += url.slice(lastPos);
    } else if (end !== -1 && lastPos < end) {
      // We converted some backslashes and have only part of the entire string
      rest += url.slice(lastPos, end);
    }
  }

  if (!slashesDenoteHost && !hasHash) {
    // Try fast path regexp
    const simplePath = simplePathPattern.exec(rest);
    if (simplePath) {
      this.path = rest;
      this.href = rest;
      this.pathname = simplePath[1];
      if (simplePath[2]) {
        this.search = simplePath[2];
        if (parseQueryString) {
          this.query = querystring.parse(this.search.slice(1));
        } else {
          this.query = this.search.slice(1);
        }
      } else if (parseQueryString) {
        this.search = '';
        this.query = {};
      }
      return this;
    }
  }

  var proto = protocolPattern.exec(rest);
  if (proto) {
    proto = proto[0];
    var lowerProto = proto.toLowerCase();
    this.protocol = lowerProto;
    rest = rest.slice(proto.length);
  }

  // figure out if it's got a host
  // user@server is *always* interpreted as a hostname, and url
  // resolution will treat //foo/bar as host=foo,path=bar because that's
  // how the browser resolves relative URLs.
  if (slashesDenoteHost || proto || /^\/\/[^@\/]+@[^@\/]+/.test(rest)) {
    var slashes = rest.charCodeAt(0) === 47 /*/*/ && rest.charCodeAt(1) === 47 /*/*/;
    if (slashes && !(proto && hostlessProtocol[proto])) {
      rest = rest.slice(2);
      this.slashes = true;
    }
  }

  if (!hostlessProtocol[proto] && (slashes || proto && !slashedProtocol[proto])) {

    // there's a hostname.
    // the first instance of /, ?, ;, or # ends the host.
    //
    // If there is an @ in the hostname, then non-host chars *are* allowed
    // to the left of the last @ sign, unless some host-ending character
    // comes *before* the @-sign.
    // URLs are obnoxious.
    //
    // ex:
    // http://a@b@c/ => user:a@b host:c
    // http://a@b?@c => user:a host:b path:/?@c

    // v0.12 TODO(isaacs): This is not quite how Chrome does things.
    // Review our test case against browsers more comprehensively.

    var hostEnd = -1;
    var atSign = -1;
    var nonHost = -1;
    for (i = 0; i < rest.length; ++i) {
      switch (rest.charCodeAt(i)) {
        case 9: // '\t'
        case 10: // '\n'
        case 13: // '\r'
        case 32: // ' '
        case 34: // '"'
        case 37: // '%'
        case 39: // '\''
        case 59: // ';'
        case 60: // '<'
        case 62: // '>'
        case 92: // '\\'
        case 94: // '^'
        case 96: // '`'
        case 123: // '{'
        case 124: // '|'
        case 125:
          // '}'
          // Characters that are never ever allowed in a hostname from RFC 2396
          if (nonHost === -1) nonHost = i;
          break;
        case 35: // '#'
        case 47: // '/'
        case 63:
          // '?'
          // Find the first instance of any host-ending characters
          if (nonHost === -1) nonHost = i;
          hostEnd = i;
          break;
        case 64:
          // '@'
          // At this point, either we have an explicit point where the
          // auth portion cannot go past, or the last @ char is the decider.
          atSign = i;
          nonHost = -1;
          break;
      }
      if (hostEnd !== -1) break;
    }
    start = 0;
    if (atSign !== -1) {
      this.auth = decodeURIComponent(rest.slice(0, atSign));
      start = atSign + 1;
    }
    if (nonHost === -1) {
      this.host = rest.slice(start);
      rest = '';
    } else {
      this.host = rest.slice(start, nonHost);
      rest = rest.slice(nonHost);
    }

    // pull out port.
    this.parseHost();

    // we've indicated that there is a hostname,
    // so even if it's empty, it has to be present.
    if (typeof this.hostname !== 'string') this.hostname = '';

    var hostname = this.hostname;

    // if hostname begins with [ and ends with ]
    // assume that it's an IPv6 address.
    var ipv6Hostname = hostname.charCodeAt(0) === 91 /*[*/ && hostname.charCodeAt(hostname.length - 1) === 93 /*]*/;

    // validate a little.
    if (!ipv6Hostname) {
      const result = validateHostname(this, rest, hostname);
      if (result !== undefined) rest = result;
    }

    if (this.hostname.length > hostnameMaxLen) {
      this.hostname = '';
    } else {
      // hostnames are always lower case.
      this.hostname = this.hostname.toLowerCase();
    }

    if (!ipv6Hostname) {
      // IDNA Support: Returns a punycoded representation of "domain".
      // It only converts parts of the domain name that
      // have non-ASCII characters, i.e. it doesn't matter if
      // you call it with a domain that already is ASCII-only.
      this.hostname = punycode.toASCII(this.hostname);
    }

    var p = this.port ? ':' + this.port : '';
    var h = this.hostname || '';
    this.host = h + p;

    // strip [ and ] from the hostname
    // the host field still retains them, though
    if (ipv6Hostname) {
      this.hostname = this.hostname.slice(1, -1);
      if (rest[0] !== '/') {
        rest = '/' + rest;
      }
    }
  }

  // now rest is set to the post-host stuff.
  // chop off any delim chars.
  if (!unsafeProtocol[lowerProto]) {
    // First, make 100% sure that any "autoEscape" chars get
    // escaped, even if encodeURIComponent doesn't think they
    // need to be.
    const result = autoEscapeStr(rest);
    if (result !== undefined) rest = result;
  }

  var questionIdx = -1;
  var hashIdx = -1;
  for (i = 0; i < rest.length; ++i) {
    const code = rest.charCodeAt(i);
    if (code === 35 /*#*/) {
        this.hash = rest.slice(i);
        hashIdx = i;
        break;
      } else if (code === 63 /*?*/ && questionIdx === -1) {
      questionIdx = i;
    }
  }

  if (questionIdx !== -1) {
    if (hashIdx === -1) {
      this.search = rest.slice(questionIdx);
      this.query = rest.slice(questionIdx + 1);
    } else {
      this.search = rest.slice(questionIdx, hashIdx);
      this.query = rest.slice(questionIdx + 1, hashIdx);
    }
    if (parseQueryString) {
      this.query = querystring.parse(this.query);
    }
  } else if (parseQueryString) {
    // no query string, but parseQueryString still requested
    this.search = '';
    this.query = {};
  }

  var firstIdx = questionIdx !== -1 && (hashIdx === -1 || questionIdx < hashIdx) ? questionIdx : hashIdx;
  if (firstIdx === -1) {
    if (rest.length > 0) this.pathname = rest;
  } else if (firstIdx > 0) {
    this.pathname = rest.slice(0, firstIdx);
  }
  if (slashedProtocol[lowerProto] && this.hostname && !this.pathname) {
    this.pathname = '/';
  }

  // to support http.request
  if (this.pathname || this.search) {
    const p = this.pathname || '';
    const s = this.search || '';
    this.path = p + s;
  }

  // finally, reconstruct the href based on what has been validated.
  this.href = this.format();
  return this;
};

/* istanbul ignore next: improve coverage */
function validateHostname(self, rest, hostname) {
  for (var i = 0, lastPos; i <= hostname.length; ++i) {
    var code;
    if (i < hostname.length) code = hostname.charCodeAt(i);
    if (code === 46 /*.*/ || i === hostname.length) {
      if (i - lastPos > 0) {
        if (i - lastPos > 63) {
          self.hostname = hostname.slice(0, lastPos + 63);
          return '/' + hostname.slice(lastPos + 63) + rest;
        }
      }
      lastPos = i + 1;
      continue;
    } else if (code >= 48 /*0*/ && code <= 57 /*9*/ || code >= 97 /*a*/ && code <= 122 /*z*/ || code === 45 /*-*/ || code >= 65 /*A*/ && code <= 90 /*Z*/ || code === 43 /*+*/ || code === 95 /*_*/ ||
    /* BEGIN MONGO URI PATCH */
    code === 44 /*,*/ || code === 58 /*:*/ ||
    /* END MONGO URI PATCH */
    code > 127) {
      continue;
    }
    // Invalid host character
    self.hostname = hostname.slice(0, i);
    if (i < hostname.length) return '/' + hostname.slice(i) + rest;
    break;
  }
}

/* istanbul ignore next: improve coverage */
function autoEscapeStr(rest) {
  var newRest = '';
  var lastPos = 0;
  for (var i = 0; i < rest.length; ++i) {
    // Automatically escape all delimiters and unwise characters from RFC 2396
    // Also escape single quotes in case of an XSS attack
    switch (rest.charCodeAt(i)) {
      case 9:
        // '\t'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%09';
        lastPos = i + 1;
        break;
      case 10:
        // '\n'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%0A';
        lastPos = i + 1;
        break;
      case 13:
        // '\r'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%0D';
        lastPos = i + 1;
        break;
      case 32:
        // ' '
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%20';
        lastPos = i + 1;
        break;
      case 34:
        // '"'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%22';
        lastPos = i + 1;
        break;
      case 39:
        // '\''
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%27';
        lastPos = i + 1;
        break;
      case 60:
        // '<'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%3C';
        lastPos = i + 1;
        break;
      case 62:
        // '>'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%3E';
        lastPos = i + 1;
        break;
      case 92:
        // '\\'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%5C';
        lastPos = i + 1;
        break;
      case 94:
        // '^'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%5E';
        lastPos = i + 1;
        break;
      case 96:
        // '`'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%60';
        lastPos = i + 1;
        break;
      case 123:
        // '{'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%7B';
        lastPos = i + 1;
        break;
      case 124:
        // '|'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%7C';
        lastPos = i + 1;
        break;
      case 125:
        // '}'
        if (i - lastPos > 0) newRest += rest.slice(lastPos, i);
        newRest += '%7D';
        lastPos = i + 1;
        break;
    }
  }
  if (lastPos === 0) return;
  if (lastPos < rest.length) return newRest + rest.slice(lastPos);else return newRest;
}

// format a parsed object into a url string
/* istanbul ignore next: improve coverage */
function urlFormat(obj) {
  // ensure it's an object, and not a string url.
  // If it's an obj, this is a no-op.
  // this way, you can call url_format() on strings
  // to clean up potentially wonky urls.
  if (typeof obj === 'string') obj = urlParse(obj);else if (typeof obj !== 'object' || obj === null) throw new TypeError('Parameter "urlObj" must be an object, not ' + obj === null ? 'null' : typeof obj);else if (!(obj instanceof Url)) return Url.prototype.format.call(obj);

  return obj.format();
}

/* istanbul ignore next: improve coverage */
Url.prototype.format = function () {
  var auth = this.auth || '';
  if (auth) {
    auth = encodeAuth(auth);
    auth += '@';
  }

  var protocol = this.protocol || '';
  var pathname = this.pathname || '';
  var hash = this.hash || '';
  var host = false;
  var query = '';

  if (this.host) {
    host = auth + this.host;
  } else if (this.hostname) {
    host = auth + (this.hostname.indexOf(':') === -1 ? this.hostname : '[' + this.hostname + ']');
    if (this.port) {
      host += ':' + this.port;
    }
  }

  if (this.query !== null && typeof this.query === 'object') query = querystring.stringify(this.query);

  var search = this.search || query && '?' + query || '';

  if (protocol && protocol.charCodeAt(protocol.length - 1) !== 58 /*:*/) protocol += ':';

  var newPathname = '';
  var lastPos = 0;
  for (var i = 0; i < pathname.length; ++i) {
    switch (pathname.charCodeAt(i)) {
      case 35:
        // '#'
        if (i - lastPos > 0) newPathname += pathname.slice(lastPos, i);
        newPathname += '%23';
        lastPos = i + 1;
        break;
      case 63:
        // '?'
        if (i - lastPos > 0) newPathname += pathname.slice(lastPos, i);
        newPathname += '%3F';
        lastPos = i + 1;
        break;
    }
  }
  if (lastPos > 0) {
    if (lastPos !== pathname.length) pathname = newPathname + pathname.slice(lastPos);else pathname = newPathname;
  }

  // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
  // unless they had them to begin with.
  if (this.slashes || (!protocol || slashedProtocol[protocol]) && host !== false) {
    host = '//' + (host || '');
    if (pathname && pathname.charCodeAt(0) !== 47 /*/*/) pathname = '/' + pathname;
  } else if (!host) {
    host = '';
  }

  search = search.replace('#', '%23');

  if (hash && hash.charCodeAt(0) !== 35 /*#*/) hash = '#' + hash;
  if (search && search.charCodeAt(0) !== 63 /*?*/) search = '?' + search;

  return protocol + host + pathname + search + hash;
};

/* istanbul ignore next: improve coverage */
function urlResolve(source, relative) {
  return urlParse(source, false, true).resolve(relative);
}

/* istanbul ignore next: improve coverage */
Url.prototype.resolve = function (relative) {
  return this.resolveObject(urlParse(relative, false, true)).format();
};

/* istanbul ignore next: improve coverage */
function urlResolveObject(source, relative) {
  if (!source) return relative;
  return urlParse(source, false, true).resolveObject(relative);
}

/* istanbul ignore next: improve coverage */
Url.prototype.resolveObject = function (relative) {
  if (typeof relative === 'string') {
    var rel = new Url();
    rel.parse(relative, false, true);
    relative = rel;
  }

  var result = new Url();
  var tkeys = Object.keys(this);
  for (var tk = 0; tk < tkeys.length; tk++) {
    var tkey = tkeys[tk];
    result[tkey] = this[tkey];
  }

  // hash is always overridden, no matter what.
  // even href="" will remove it.
  result.hash = relative.hash;

  // if the relative url is empty, then there's nothing left to do here.
  if (relative.href === '') {
    result.href = result.format();
    return result;
  }

  // hrefs like //foo/bar always cut to the protocol.
  if (relative.slashes && !relative.protocol) {
    // take everything except the protocol from relative
    var rkeys = Object.keys(relative);
    for (var rk = 0; rk < rkeys.length; rk++) {
      var rkey = rkeys[rk];
      if (rkey !== 'protocol') result[rkey] = relative[rkey];
    }

    //urlParse appends trailing / to urls like http://www.example.com
    if (slashedProtocol[result.protocol] && result.hostname && !result.pathname) {
      result.path = result.pathname = '/';
    }

    result.href = result.format();
    return result;
  }

  if (relative.protocol && relative.protocol !== result.protocol) {
    // if it's a known url protocol, then changing
    // the protocol does weird things
    // first, if it's not file:, then we MUST have a host,
    // and if there was a path
    // to begin with, then we MUST have a path.
    // if it is file:, then the host is dropped,
    // because that's known to be hostless.
    // anything else is assumed to be absolute.
    if (!slashedProtocol[relative.protocol]) {
      var keys = Object.keys(relative);
      for (var v = 0; v < keys.length; v++) {
        var k = keys[v];
        result[k] = relative[k];
      }
      result.href = result.format();
      return result;
    }

    result.protocol = relative.protocol;
    if (!relative.host && !/^file:?$/.test(relative.protocol) && !hostlessProtocol[relative.protocol]) {
      const relPath = (relative.pathname || '').split('/');
      while (relPath.length && !(relative.host = relPath.shift()));
      if (!relative.host) relative.host = '';
      if (!relative.hostname) relative.hostname = '';
      if (relPath[0] !== '') relPath.unshift('');
      if (relPath.length < 2) relPath.unshift('');
      result.pathname = relPath.join('/');
    } else {
      result.pathname = relative.pathname;
    }
    result.search = relative.search;
    result.query = relative.query;
    result.host = relative.host || '';
    result.auth = relative.auth;
    result.hostname = relative.hostname || relative.host;
    result.port = relative.port;
    // to support http.request
    if (result.pathname || result.search) {
      var p = result.pathname || '';
      var s = result.search || '';
      result.path = p + s;
    }
    result.slashes = result.slashes || relative.slashes;
    result.href = result.format();
    return result;
  }

  var isSourceAbs = result.pathname && result.pathname.charAt(0) === '/';
  var isRelAbs = relative.host || relative.pathname && relative.pathname.charAt(0) === '/';
  var mustEndAbs = isRelAbs || isSourceAbs || result.host && relative.pathname;
  var removeAllDots = mustEndAbs;
  var srcPath = result.pathname && result.pathname.split('/') || [];
  var relPath = relative.pathname && relative.pathname.split('/') || [];
  var psychotic = result.protocol && !slashedProtocol[result.protocol];

  // if the url is a non-slashed url, then relative
  // links like ../.. should be able
  // to crawl up to the hostname, as well.  This is strange.
  // result.protocol has already been set by now.
  // Later on, put the first path part into the host field.
  if (psychotic) {
    result.hostname = '';
    result.port = null;
    if (result.host) {
      if (srcPath[0] === '') srcPath[0] = result.host;else srcPath.unshift(result.host);
    }
    result.host = '';
    if (relative.protocol) {
      relative.hostname = null;
      relative.port = null;
      if (relative.host) {
        if (relPath[0] === '') relPath[0] = relative.host;else relPath.unshift(relative.host);
      }
      relative.host = null;
    }
    mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
  }

  if (isRelAbs) {
    // it's absolute.
    result.host = relative.host || relative.host === '' ? relative.host : result.host;
    result.hostname = relative.hostname || relative.hostname === '' ? relative.hostname : result.hostname;
    result.search = relative.search;
    result.query = relative.query;
    srcPath = relPath;
    // fall through to the dot-handling below.
  } else if (relPath.length) {
    // it's relative
    // throw away the existing file, and take the new path instead.
    if (!srcPath) srcPath = [];
    srcPath.pop();
    srcPath = srcPath.concat(relPath);
    result.search = relative.search;
    result.query = relative.query;
  } else if (relative.search !== null && relative.search !== undefined) {
    // just pull out the search.
    // like href='?foo'.
    // Put this after the other two cases because it simplifies the booleans
    if (psychotic) {
      result.hostname = result.host = srcPath.shift();
      //occasionally the auth can get stuck only in host
      //this especially happens in cases like
      //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
      const authInHost = result.host && result.host.indexOf('@') > 0 ? result.host.split('@') : false;
      if (authInHost) {
        result.auth = authInHost.shift();
        result.host = result.hostname = authInHost.shift();
      }
    }
    result.search = relative.search;
    result.query = relative.query;
    //to support http.request
    if (result.pathname !== null || result.search !== null) {
      result.path = (result.pathname ? result.pathname : '') + (result.search ? result.search : '');
    }
    result.href = result.format();
    return result;
  }

  if (!srcPath.length) {
    // no path at all.  easy.
    // we've already handled the other stuff above.
    result.pathname = null;
    //to support http.request
    if (result.search) {
      result.path = '/' + result.search;
    } else {
      result.path = null;
    }
    result.href = result.format();
    return result;
  }

  // if a url ENDs in . or .., then it must get a trailing slash.
  // however, if it ends in anything else non-slashy,
  // then it must NOT get a trailing slash.
  var last = srcPath.slice(-1)[0];
  var hasTrailingSlash = (result.host || relative.host || srcPath.length > 1) && (last === '.' || last === '..') || last === '';

  // strip single dots, resolve double dots to parent dir
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = srcPath.length; i >= 0; i--) {
    last = srcPath[i];
    if (last === '.') {
      spliceOne(srcPath, i);
    } else if (last === '..') {
      spliceOne(srcPath, i);
      up++;
    } else if (up) {
      spliceOne(srcPath, i);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (!mustEndAbs && !removeAllDots) {
    for (; up--; up) {
      srcPath.unshift('..');
    }
  }

  if (mustEndAbs && srcPath[0] !== '' && (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
    srcPath.unshift('');
  }

  if (hasTrailingSlash && srcPath.join('/').substr(-1) !== '/') {
    srcPath.push('');
  }

  var isAbsolute = srcPath[0] === '' || srcPath[0] && srcPath[0].charAt(0) === '/';

  // put the host back
  if (psychotic) {
    result.hostname = result.host = isAbsolute ? '' : srcPath.length ? srcPath.shift() : '';
    //occasionally the auth can get stuck only in host
    //this especially happens in cases like
    //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
    const authInHost = result.host && result.host.indexOf('@') > 0 ? result.host.split('@') : false;
    if (authInHost) {
      result.auth = authInHost.shift();
      result.host = result.hostname = authInHost.shift();
    }
  }

  mustEndAbs = mustEndAbs || result.host && srcPath.length;

  if (mustEndAbs && !isAbsolute) {
    srcPath.unshift('');
  }

  if (!srcPath.length) {
    result.pathname = null;
    result.path = null;
  } else {
    result.pathname = srcPath.join('/');
  }

  //to support request.http
  if (result.pathname !== null || result.search !== null) {
    result.path = (result.pathname ? result.pathname : '') + (result.search ? result.search : '');
  }
  result.auth = relative.auth || result.auth;
  result.slashes = result.slashes || relative.slashes;
  result.href = result.format();
  return result;
};

/* istanbul ignore next: improve coverage */
Url.prototype.parseHost = function () {
  var host = this.host;
  var port = portPattern.exec(host);
  if (port) {
    port = port[0];
    if (port !== ':') {
      this.port = port.slice(1);
    }
    host = host.slice(0, host.length - port.length);
  }
  if (host) this.hostname = host;
};

// About 1.5x faster than the two-arg version of Array#splice().
/* istanbul ignore next: improve coverage */
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1) list[i] = list[k];
  list.pop();
}

var hexTable = new Array(256);
for (var i = 0; i < 256; ++i) hexTable[i] = '%' + ((i < 16 ? '0' : '') + i.toString(16)).toUpperCase();
/* istanbul ignore next: improve coverage */
function encodeAuth(str) {
  // faster encodeURIComponent alternative for encoding auth uri components
  var out = '';
  var lastPos = 0;
  for (var i = 0; i < str.length; ++i) {
    var c = str.charCodeAt(i);

    // These characters do not need escaping:
    // ! - . _ ~
    // ' ( ) * :
    // digits
    // alpha (uppercase)
    // alpha (lowercase)
    if (c === 0x21 || c === 0x2D || c === 0x2E || c === 0x5F || c === 0x7E || c >= 0x27 && c <= 0x2A || c >= 0x30 && c <= 0x3A || c >= 0x41 && c <= 0x5A || c >= 0x61 && c <= 0x7A) {
      continue;
    }

    if (i - lastPos > 0) out += str.slice(lastPos, i);

    lastPos = i + 1;

    // Other ASCII characters
    if (c < 0x80) {
      out += hexTable[c];
      continue;
    }

    // Multi-byte characters ...
    if (c < 0x800) {
      out += hexTable[0xC0 | c >> 6] + hexTable[0x80 | c & 0x3F];
      continue;
    }
    if (c < 0xD800 || c >= 0xE000) {
      out += hexTable[0xE0 | c >> 12] + hexTable[0x80 | c >> 6 & 0x3F] + hexTable[0x80 | c & 0x3F];
      continue;
    }
    // Surrogate pair
    ++i;
    var c2;
    if (i < str.length) c2 = str.charCodeAt(i) & 0x3FF;else c2 = 0;
    c = 0x10000 + ((c & 0x3FF) << 10 | c2);
    out += hexTable[0xF0 | c >> 18] + hexTable[0x80 | c >> 12 & 0x3F] + hexTable[0x80 | c >> 6 & 0x3F] + hexTable[0x80 | c & 0x3F];
  }
  if (lastPos === 0) return str;
  if (lastPos < str.length) return out + str.slice(lastPos);
  return out;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy92ZW5kb3IvbW9uZ29kYlVybC5qcyJdLCJuYW1lcyI6WyJwdW55Y29kZSIsInJlcXVpcmUiLCJleHBvcnRzIiwicGFyc2UiLCJ1cmxQYXJzZSIsInJlc29sdmUiLCJ1cmxSZXNvbHZlIiwicmVzb2x2ZU9iamVjdCIsInVybFJlc29sdmVPYmplY3QiLCJmb3JtYXQiLCJ1cmxGb3JtYXQiLCJVcmwiLCJwcm90b2NvbCIsInNsYXNoZXMiLCJhdXRoIiwiaG9zdCIsInBvcnQiLCJob3N0bmFtZSIsImhhc2giLCJzZWFyY2giLCJxdWVyeSIsInBhdGhuYW1lIiwicGF0aCIsImhyZWYiLCJwcm90b2NvbFBhdHRlcm4iLCJwb3J0UGF0dGVybiIsInNpbXBsZVBhdGhQYXR0ZXJuIiwiaG9zdG5hbWVNYXhMZW4iLCJ1bnNhZmVQcm90b2NvbCIsImhvc3RsZXNzUHJvdG9jb2wiLCJzbGFzaGVkUHJvdG9jb2wiLCJxdWVyeXN0cmluZyIsInVybCIsInBhcnNlUXVlcnlTdHJpbmciLCJzbGFzaGVzRGVub3RlSG9zdCIsInUiLCJwcm90b3R5cGUiLCJUeXBlRXJyb3IiLCJoYXNIYXNoIiwic3RhcnQiLCJlbmQiLCJyZXN0IiwibGFzdFBvcyIsImkiLCJpbldzIiwic3BsaXQiLCJsZW5ndGgiLCJjb2RlIiwiY2hhckNvZGVBdCIsImlzV3MiLCJzbGljZSIsInNpbXBsZVBhdGgiLCJleGVjIiwicHJvdG8iLCJsb3dlclByb3RvIiwidG9Mb3dlckNhc2UiLCJ0ZXN0IiwiaG9zdEVuZCIsImF0U2lnbiIsIm5vbkhvc3QiLCJkZWNvZGVVUklDb21wb25lbnQiLCJwYXJzZUhvc3QiLCJpcHY2SG9zdG5hbWUiLCJyZXN1bHQiLCJ2YWxpZGF0ZUhvc3RuYW1lIiwidW5kZWZpbmVkIiwidG9BU0NJSSIsInAiLCJoIiwiYXV0b0VzY2FwZVN0ciIsInF1ZXN0aW9uSWR4IiwiaGFzaElkeCIsImZpcnN0SWR4IiwicyIsInNlbGYiLCJuZXdSZXN0Iiwib2JqIiwiY2FsbCIsImVuY29kZUF1dGgiLCJpbmRleE9mIiwic3RyaW5naWZ5IiwibmV3UGF0aG5hbWUiLCJyZXBsYWNlIiwic291cmNlIiwicmVsYXRpdmUiLCJyZWwiLCJ0a2V5cyIsIk9iamVjdCIsImtleXMiLCJ0ayIsInRrZXkiLCJya2V5cyIsInJrIiwicmtleSIsInYiLCJrIiwicmVsUGF0aCIsInNoaWZ0IiwidW5zaGlmdCIsImpvaW4iLCJpc1NvdXJjZUFicyIsImNoYXJBdCIsImlzUmVsQWJzIiwibXVzdEVuZEFicyIsInJlbW92ZUFsbERvdHMiLCJzcmNQYXRoIiwicHN5Y2hvdGljIiwicG9wIiwiY29uY2F0IiwiYXV0aEluSG9zdCIsImxhc3QiLCJoYXNUcmFpbGluZ1NsYXNoIiwidXAiLCJzcGxpY2VPbmUiLCJzdWJzdHIiLCJwdXNoIiwiaXNBYnNvbHV0ZSIsImxpc3QiLCJpbmRleCIsIm4iLCJoZXhUYWJsZSIsIkFycmF5IiwidG9TdHJpbmciLCJ0b1VwcGVyQ2FzZSIsInN0ciIsIm91dCIsImMiLCJjMiJdLCJtYXBwaW5ncyI6IkFBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7QUFFQSxNQUFNQSxXQUFXQyxRQUFRLFVBQVIsQ0FBakI7O0FBRUFDLFFBQVFDLEtBQVIsR0FBZ0JDLFFBQWhCO0FBQ0FGLFFBQVFHLE9BQVIsR0FBa0JDLFVBQWxCO0FBQ0FKLFFBQVFLLGFBQVIsR0FBd0JDLGdCQUF4QjtBQUNBTixRQUFRTyxNQUFSLEdBQWlCQyxTQUFqQjs7QUFFQVIsUUFBUVMsR0FBUixHQUFjQSxHQUFkOztBQUVBLFNBQVNBLEdBQVQsR0FBZTtBQUNiLE9BQUtDLFFBQUwsR0FBZ0IsSUFBaEI7QUFDQSxPQUFLQyxPQUFMLEdBQWUsSUFBZjtBQUNBLE9BQUtDLElBQUwsR0FBWSxJQUFaO0FBQ0EsT0FBS0MsSUFBTCxHQUFZLElBQVo7QUFDQSxPQUFLQyxJQUFMLEdBQVksSUFBWjtBQUNBLE9BQUtDLFFBQUwsR0FBZ0IsSUFBaEI7QUFDQSxPQUFLQyxJQUFMLEdBQVksSUFBWjtBQUNBLE9BQUtD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dEIsSUFDQU4sU0FBUyxPQUFTTSxLQUFLLENBQU4sR0FBVyxJQUE1QixDQURBLEdBRUFOLFNBQVMsT0FBUU0sSUFBSSxJQUFyQixDQUZQO0FBR0E7QUFDRDtBQUNEO0FBQ0EsTUFBRW5GLENBQUY7QUFDQSxRQUFJb0YsRUFBSjtBQUNBLFFBQUlwRixJQUFJaUYsSUFBSTlFLE1BQVosRUFDRWlGLEtBQUtILElBQUk1RSxVQUFKLENBQWVMLENBQWYsSUFBb0IsS0FBekIsQ0FERixLQUdFb0YsS0FBSyxDQUFMO0FBQ0ZELFFBQUksV0FBWSxDQUFDQSxJQUFJLEtBQUwsS0FBZSxFQUFoQixHQUFzQkMsRUFBakMsQ0FBSjtBQUNBRixXQUFPTCxTQUFTLE9BQVFNLEtBQUssRUFBdEIsSUFDQU4sU0FBUyxPQUFTTSxLQUFLLEVBQU4sR0FBWSxJQUE3QixDQURBLEdBRUFOLFNBQVMsT0FBU00sS0FBSyxDQUFOLEdBQVcsSUFBNUIsQ0FGQSxHQUdBTixTQUFTLE9BQVFNLElBQUksSUFBckIsQ0FIUDtBQUlEO0FBQ0QsTUFBSXBGLFlBQVksQ0FBaEIsRUFDRSxPQUFPa0YsR0FBUDtBQUNGLE1BQUlsRixVQUFVa0YsSUFBSTlFLE1BQWxCLEVBQ0UsT0FBTytFLE1BQU1ELElBQUkxRSxLQUFKLENBQVVSLE9BQVYsQ0FBYjtBQUNGLFNBQU9tRixHQUFQO0FBQ0QiLCJmaWxlIjoibW9uZ29kYlVybC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEEgc2xpZ2h0bHkgcGF0Y2hlZCB2ZXJzaW9uIG9mIG5vZGUncyB1cmwgbW9kdWxlLCB3aXRoIHN1cHBvcnQgZm9yIG1vbmdvZGI6Ly9cbi8vIHVyaXMuXG4vL1xuLy8gU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9ub2RlanMvbm9kZS9ibG9iL21hc3Rlci9MSUNFTlNFIGZvciBsaWNlbnNpbmdcbi8vIGluZm9ybWF0aW9uXG5cbid1c2Ugc3RyaWN0JztcblxuY29uc3QgcHVueWNvZGUgPSByZXF1aXJlKCdwdW55Y29kZScpO1xuXG5leHBvcnRzLnBhcnNlID0gdXJsUGFyc2U7XG5leHBvcnRzLnJlc29sdmUgPSB1cmxSZXNvbHZlO1xuZXhwb3J0cy5yZXNvbHZlT2JqZWN0ID0gdXJsUmVzb2x2ZU9iamVjdDtcbmV4cG9ydHMuZm9ybWF0ID0gdXJsRm9ybWF0O1xuXG5leHBvcnRzLlVybCA9IFVybDtcblxuZnVuY3Rpb24gVXJsKCkge1xuICB0aGlzLnByb3RvY29sID0gbnVsbDtcbiAgdGhpcy5zbGFzaGVzID0gbnVsbDtcbiAgdGhpcy5hdXRoID0gbnVsbDtcbiAgdGhpcy5ob3N0ID0gbnVsbDtcbiAgdGhpcy5wb3J0ID0gbnVsbDtcbiAgdGhpcy5ob3N0bmFtZSA9IG51bGw7XG4gIHRoaXMuaGFzaCA9IG51bGw7XG4gIHRoaXMuc2VhcmNoID0gbnVsbDtcbiAgdGhpcy5xdWVyeSA9IG51bGw7XG4gIHRoaXMucGF0aG5hbWUgPSBudWxsO1xuICB0aGlzLnBhdGggPSBudWxsO1xuICB0aGlzLmhyZWYgPSBudWxsO1xufVxuXG4vLyBSZWZlcmVuY2U6IFJGQyAzOTg2LCBSRkMgMTgwOCwgUkZDIDIzOTZcblxuLy8gZGVmaW5lIHRoZXNlIGhlcmUgc28gYXQgbGVhc3QgdGhleSBvbmx5IGhhdmUgdG8gYmVcbi8vIGNvbXBpbGVkIG9uY2Ugb24gdGhlIGZpcnN0IG1vZHVsZSBsb2FkLlxuY29uc3QgcHJvdG9jb2xQYXR0ZXJuID0gL14oW2EtejAtOS4rLV0rOikvaTtcbmNvbnN0IHBvcnRQYXR0ZXJuID0gLzpbMC05XSokLztcblxuLy8gU3BlY2lhbCBjYXNlIGZvciBhIHNpbXBsZSBwYXRoIFVSTFxuY29uc3Qgc2ltcGxlUGF0aFBhdHRlcm4gPSAvXihcXC9cXC8/KD8hXFwvKVteXFw/XFxzXSopKFxcP1teXFxzXSopPyQvO1xuXG5jb25zdCBob3N0bmFtZU1heExlbiA9IDI1NTtcbi8vIHByb3RvY29scyB0aGF0IGNhbiBhbGxvdyBcInVuc2FmZVwiIGFuZCBcInVud2lzZVwiIGNoYXJzLlxuY29uc3QgdW5zYWZlUHJvdG9jb2wgPSB7XG4gICdqYXZhc2NyaXB0JzogdHJ1ZSxcbiAgJ2phdmFzY3JpcHQ6JzogdHJ1ZVxufTtcbi8vIHByb3RvY29scyB0aGF0IG5ldmVyIGhhdmUgYSBob3N0bmFtZS5cbmNvbnN0IGhvc3RsZXNzUHJvdG9jb2wgPSB7XG4gICdqYXZhc2NyaXB0JzogdHJ1ZSxcbiAgJ2phdmFzY3JpcHQ6JzogdHJ1ZVxufTtcbi8vIHByb3RvY29scyB0aGF0IGFsd2F5cyBjb250YWluIGEgLy8gYml0LlxuY29uc3Qgc2xhc2hlZFByb3RvY29sID0ge1xuICAnaHR0cCc6IHRydWUsXG4gICdodHRwOic6IHRydWUsXG4gICdodHRwcyc6IHRydWUsXG4gICdodHRwczonOiB0cnVlLFxuICAnZnRwJzogdHJ1ZSxcbiAgJ2Z0cDonOiB0cnVlLFxuICAnZ29waGVyJzogdHJ1ZSxcbiAgJ2dvcGhlcjonOiB0cnVlLFxuICAnZmlsZSc6IHRydWUsXG4gICdmaWxlOic6IHRydWVcbn07XG5jb25zdCBxdWVyeXN0cmluZyA9IHJlcXVpcmUoJ3F1ZXJ5c3RyaW5nJyk7XG5cbi8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0OiBpbXByb3ZlIGNvdmVyYWdlICovXG5mdW5jdGlvbiB1cmxQYXJzZSh1cmwsIHBhcnNlUXVlcnlTdHJpbmcsIHNsYXNoZXNEZW5vdGVIb3N0KSB7XG4gIGlmICh1cmwgaW5zdGFuY2VvZiBVcmwpIHJldHVybiB1cmw7XG5cbiAgdmFyIHUgPSBuZXcgVXJsKCk7XG4gIHUucGFyc2UodXJsLCBwYXJzZVF1ZXJ5U3RyaW5nLCBzbGFzaGVzRGVub3RlSG9zdCk7XG4gIHJldHVybiB1O1xufVxuXG4vKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dDogaW1wcm92ZSBjb3ZlcmFnZSAqL1xuVXJsLnByb3RvdHlwZS5wYXJzZSA9IGZ1bmN0aW9uKHVybCwgcGFyc2VRdWVyeVN0cmluZywgc2xhc2hlc0Rlbm90ZUhvc3QpIHtcbiAgaWYgKHR5cGVvZiB1cmwgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignUGFyYW1ldGVyIFwidXJsXCIgbXVzdCBiZSBhIHN0cmluZywgbm90ICcgKyB0eXBlb2YgdXJsKTtcbiAgfVxuXG4gIC8vIENvcHkgY2hyb21lLCBJRSwgb3BlcmEgYmFja3NsYXNoLWhhbmRsaW5nIGJlaGF2aW9yLlxuICAvLyBCYWNrIHNsYXNoZXMgYmVmb3JlIHRoZSBxdWVyeSBzdHJpbmcgZ2V0IGNvbnZlcnRlZCB0byBmb3J3YXJkIHNsYXNoZXNcbiAgLy8gU2VlOiBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL2Nocm9taXVtL2lzc3Vlcy9kZXRhaWw/aWQ9MjU5MTZcbiAgdmFyIGhhc0hhc2ggPSBmYWxzZTtcbiAgdmFyIHN0YXJ0ID0gLTE7XG4gIHZhciBlbmQgPSAtMTtcbiAgdmFyIHJlc3QgPSAnJztcbiAgdmFyIGxhc3RQb3MgPSAwO1xuICB2YXIgaSA9IDA7XG4gIGZvciAodmFyIGluV3MgPSBmYWxzZSwgc3BsaXQgPSBmYWxzZTsgaSA8IHVybC5sZW5ndGg7ICsraSkge1xuICAgIGNvbnN0IGNvZGUgPSB1cmwuY2hhckNvZGVBdChpKTtcblxuICAgIC8vIEZpbmQgZmlyc3QgYW5kIGxhc3Qgbm9uLXdoaXRlc3BhY2UgY2hhcmFjdGVycyBmb3IgdHJpbW1pbmdcbiAgICBjb25zdCBpc1dzID0gY29kZSA9PT0gMzIvKiAqLyB8fFxuICAgICAgICAgICAgICAgICBjb2RlID09PSA5LypcXHQqLyB8fFxuICAgICAgICAgICAgICAgICBjb2RlID09PSAxMy8qXFxyKi8gfHxcbiAgICAgICAgICAgICAgICAgY29kZSA9PT0gMTAvKlxcbiovIHx8XG4gICAgICAgICAgICAgICAgIGNvZGUgPT09IDEyLypcXGYqLyB8fFxuICAgICAgICAgICAgICAgICBjb2RlID09PSAxNjAvKlxcdTAwQTAqLyB8fFxuICAgICAgICAgICAgICAgICBjb2RlID09PSA2NTI3OS8qXFx1RkVGRiovO1xuICAgIGlmIChzdGFydCA9PT0gLTEpIHtcbiAgICAgIGlmIChpc1dzKVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIGxhc3RQb3MgPSBzdGFydCA9IGk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChpbldzKSB7XG4gICAgICAgIGlmICghaXNXcykge1xuICAgICAgICAgIGVuZCA9IC0xO1xuICAgICAgICAgIGluV3MgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChpc1dzKSB7XG4gICAgICAgIGVuZCA9IGk7XG4gICAgICAgIGluV3MgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE9ubHkgY29udmVydCBiYWNrc2xhc2hlcyB3aGlsZSB3ZSBoYXZlbid0IHNlZW4gYSBzcGxpdCBjaGFyYWN0ZXJcbiAgICBpZiAoIXNwbGl0KSB7XG4gICAgICBzd2l0Y2ggKGNvZGUpIHtcbiAgICAgIGNhc2UgMzU6IC8vICcjJ1xuICAgICAgICBoYXNIYXNoID0gdHJ1ZTtcbiAgICAgICAgLy8gRmFsbCB0aHJvdWdoXG4gICAgICBjYXNlIDYzOiAvLyAnPydcbiAgICAgICAgc3BsaXQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgOTI6IC8vICdcXFxcJ1xuICAgICAgICBpZiAoaSAtIGxhc3RQb3MgPiAwKVxuICAgICAgICAgIHJlc3QgKz0gdXJsLnNsaWNlKGxhc3RQb3MsIGkpO1xuICAgICAgICByZXN0ICs9ICcvJztcbiAgICAgICAgbGFzdFBvcyA9IGkgKyAxO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKCFoYXNIYXNoICYmIGNvZGUgPT09IDM1LyojKi8pIHtcbiAgICAgIGhhc0hhc2ggPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIC8vIENoZWNrIGlmIHN0cmluZyB3YXMgbm9uLWVtcHR5IChpbmNsdWRpbmcgc3RyaW5ncyB3aXRoIG9ubHkgd2hpdGVzcGFjZSlcbiAgaWYgKHN0YXJ0ICE9PSAtMSkge1xuICAgIGlmIChsYXN0UG9zID09PSBzdGFydCkge1xuICAgICAgLy8gV2UgZGlkbid0IGNvbnZlcnQgYW55IGJhY2tzbGFzaGVzXG5cbiAgICAgIGlmIChlbmQgPT09IC0xKSB7XG4gICAgICAgIGlmIChzdGFydCA9PT0gMClcbiAgICAgICAgICByZXN0ID0gdXJsO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgcmVzdCA9IHVybC5zbGljZShzdGFydCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN0ID0gdXJsLnNsaWNlKHN0YXJ0LCBlbmQpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW5kID09PSAtMSAmJiBsYXN0UG9zIDwgdXJsLmxlbmd0aCkge1xuICAgICAgLy8gV2UgY29udmVydGVkIHNvbWUgYmFja3NsYXNoZXMgYW5kIGhhdmUgb25seSBwYXJ0IG9mIHRoZSBlbnRpcmUgc3RyaW5nXG4gICAgICByZXN0ICs9IHVybC5zbGljZShsYXN0UG9zKTtcbiAgICB9IGVsc2UgaWYgKGVuZCAhPT0gLTEgJiYgbGFzdFBvcyA8IGVuZCkge1xuICAgICAgLy8gV2UgY29udmVydGVkIHNvbWUgYmFja3NsYXNoZXMgYW5kIGhhdmUgb25seSBwYXJ0IG9mIHRoZSBlbnRpcmUgc3RyaW5nXG4gICAgICByZXN0ICs9IHVybC5zbGljZShsYXN0UG9zLCBlbmQpO1xuICAgIH1cbiAgfVxuXG4gIGlmICghc2xhc2hlc0Rlbm90ZUhvc3QgJiYgIWhhc0hhc2gpIHtcbiAgICAvLyBUcnkgZmFzdCBwYXRoIHJlZ2V4cFxuICAgIGNvbnN0IHNpbXBsZVBhdGggPSBzaW1wbGVQYXRoUGF0dGVybi5leGVjKHJlc3QpO1xuICAgIGlmIChzaW1wbGVQYXRoKSB7XG4gICAgICB0aGlzLnBhdGggPSByZXN0O1xuICAgICAgdGhpcy5ocmVmID0gcmVzdDtcbiAgICAgIHRoaXMucGF0aG5hbWUgPSBzaW1wbGVQYXRoWzFdO1xuICAgICAgaWYgKHNpbXBsZVBhdGhbMl0pIHtcbiAgICAgICAgdGhpcy5zZWFyY2ggPSBzaW1wbGVQYXRoWzJdO1xuICAgICAgICBpZiAocGFyc2VRdWVyeVN0cmluZykge1xuICAgICAgICAgIHRoaXMucXVlcnkgPSBxdWVyeXN0cmluZy5wYXJzZSh0aGlzLnNlYXJjaC5zbGljZSgxKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5xdWVyeSA9IHRoaXMuc2VhcmNoLnNsaWNlKDEpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHBhcnNlUXVlcnlTdHJpbmcpIHtcbiAgICAgICAgdGhpcy5zZWFyY2ggPSAnJztcbiAgICAgICAgdGhpcy5xdWVyeSA9IHt9O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICB9XG5cbiAgdmFyIHByb3RvID0gcHJvdG9jb2xQYXR0ZXJuLmV4ZWMocmVzdCk7XG4gIGlmIChwcm90bykge1xuICAgIHByb3RvID0gcHJvdG9bMF07XG4gICAgdmFyIGxvd2VyUHJvdG8gPSBwcm90by50b0xvd2VyQ2FzZSgpO1xuICAgIHRoaXMucHJvdG9jb2wgPSBsb3dlclByb3RvO1xuICAgIHJlc3QgPSByZXN0LnNsaWNlKHByb3RvLmxlbmd0aCk7XG4gIH1cblxuICAvLyBmaWd1cmUgb3V0IGlmIGl0J3MgZ290IGEgaG9zdFxuICAvLyB1c2VyQHNlcnZlciBpcyAqYWx3YXlzKiBpbnRlcnByZXRlZCBhcyBhIGhvc3RuYW1lLCBhbmQgdXJsXG4gIC8vIHJlc29sdXRpb24gd2lsbCB0cmVhdCAvL2Zvby9iYXIgYXMgaG9zdD1mb28scGF0aD1iYXIgYmVjYXVzZSB0aGF0J3NcbiAgLy8gaG93IHRoZSBicm93c2VyIHJlc29sdmVzIHJlbGF0aXZlIFVSTHMuXG4gIGlmIChzbGFzaGVzRGVub3RlSG9zdCB8fCBwcm90byB8fCAvXlxcL1xcL1teQFxcL10rQFteQFxcL10rLy50ZXN0KHJlc3QpKSB7XG4gICAgdmFyIHNsYXNoZXMgPSByZXN0LmNoYXJDb2RlQXQoMCkgPT09IDQ3LyovKi8gJiZcbiAgICAgICAgICAgICAgICAgIHJlc3QuY2hhckNvZGVBdCgxKSA9PT0gNDcvKi8qLztcbiAgICBpZiAoc2xhc2hlcyAmJiAhKHByb3RvICYmIGhvc3RsZXNzUHJvdG9jb2xbcHJvdG9dKSkge1xuICAgICAgcmVzdCA9IHJlc3Quc2xpY2UoMik7XG4gICAgICB0aGlzLnNsYXNoZXMgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIGlmICghaG9zdGxlc3NQcm90b2NvbFtwcm90b10gJiZcbiAgICAgIChzbGFzaGVzIHx8IChwcm90byAmJiAhc2xhc2hlZFByb3RvY29sW3Byb3RvXSkpKSB7XG5cbiAgICAvLyB0aGVyZSdzIGEgaG9zdG5hbWUuXG4gICAgLy8gdGhlIGZpcnN0IGluc3RhbmNlIG9mIC8sID8sIDssIG9yICMgZW5kcyB0aGUgaG9zdC5cbiAgICAvL1xuICAgIC8vIElmIHRoZXJlIGlzIGFuIEAgaW4gdGhlIGhvc3RuYW1lLCB0aGVuIG5vbi1ob3N0IGNoYXJzICphcmUqIGFsbG93ZWRcbiAgICAvLyB0byB0aGUgbGVmdCBvZiB0aGUgbGFzdCBAIHNpZ24sIHVubGVzcyBzb21lIGhvc3QtZW5kaW5nIGNoYXJhY3RlclxuICAgIC8vIGNvbWVzICpiZWZvcmUqIHRoZSBALXNpZ24uXG4gICAgLy8gVVJMcyBhcmUgb2Jub3hpb3VzLlxuICAgIC8vXG4gICAgLy8gZXg6XG4gICAgLy8gaHR0cDovL2FAYkBjLyA9PiB1c2VyOmFAYiBob3N0OmNcbiAgICAvLyBodHRwOi8vYUBiP0BjID0+IHVzZXI6YSBob3N0OmIgcGF0aDovP0BjXG5cbiAgICAvLyB2MC4xMiBUT0RPKGlzYWFjcyk6IFRoaXMgaXMgbm90IHF1aXRlIGhvdyBDaHJvbWUgZG9lcyB0aGluZ3MuXG4gICAgLy8gUmV2aWV3IG91ciB0ZXN0IGNhc2UgYWdhaW5zdCBicm93c2VycyBtb3JlIGNvbXByZWhlbnNpdmVseS5cblxuICAgIHZhciBob3N0RW5kID0gLTE7XG4gICAgdmFyIGF0U2lnbiA9IC0xO1xuICAgIHZhciBub25Ib3N0ID0gLTE7XG4gICAgZm9yIChpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyArK2kpIHtcbiAgICAgIHN3aXRjaCAocmVzdC5jaGFyQ29kZUF0KGkpKSB7XG4gICAgICBjYXNlIDk6ICAgLy8gJ1xcdCdcbiAgICAgIGNhc2UgMTA6ICAvLyAnXFxuJ1xuICAgICAgY2FzZSAxMzogIC8vICdcXHInXG4gICAgICBjYXNlIDMyOiAgLy8gJyAnXG4gICAgICBjYXNlIDM0OiAgLy8gJ1wiJ1xuICAgICAgY2FzZSAzNzogIC8vICclJ1xuICAgICAgY2FzZSAzOTogIC8vICdcXCcnXG4gICAgICBjYXNlIDU5OiAgLy8gJzsnXG4gICAgICBjYXNlIDYwOiAgLy8gJzwnXG4gICAgICBjYXNlIDYyOiAgLy8gJz4nXG4gICAgICBjYXNlIDkyOiAgLy8gJ1xcXFwnXG4gICAgICBjYXNlIDk0OiAgLy8gJ14nXG4gICAgICBjYXNlIDk2OiAgLy8gJ2AnXG4gICAgICBjYXNlIDEyMzogLy8gJ3snXG4gICAgICBjYXNlIDEyNDogLy8gJ3wnXG4gICAgICBjYXNlIDEyNTogLy8gJ30nXG4gICAgICAgIC8vIENoYXJhY3RlcnMgdGhhdCBhcmUgbmV2ZXIgZXZlciBhbGxvd2VkIGluIGEgaG9zdG5hbWUgZnJvbSBSRkMgMjM5NlxuICAgICAgICBpZiAobm9uSG9zdCA9PT0gLTEpXG4gICAgICAgICAgbm9uSG9zdCA9IGk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAzNTogLy8gJyMnXG4gICAgICBjYXNlIDQ3OiAvLyAnLydcbiAgICAgIGNhc2UgNjM6IC8vICc/J1xuICAgICAgICAvLyBGaW5kIHRoZSBmaXJzdCBpbnN0YW5jZSBvZiBhbnkgaG9zdC1lbmRpbmcgY2hhcmFjdGVyc1xuICAgICAgICBpZiAobm9uSG9zdCA9PT0gLTEpXG4gICAgICAgICAgbm9uSG9zdCA9IGk7XG4gICAgICAgIGhvc3RFbmQgPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgNjQ6IC8vICdAJ1xuICAgICAgICAvLyBBdCB0aGlzIHBvaW50LCBlaXRoZXIgd2UgaGF2ZSBhbiBleHBsaWNpdCBwb2ludCB3aGVyZSB0aGVcbiAgICAgICAgLy8gYXV0aCBwb3J0aW9uIGNhbm5vdCBnbyBwYXN0LCBvciB0aGUgbGFzdCBAIGNoYXIgaXMgdGhlIGRlY2lkZXIuXG4gICAgICAgIGF0U2lnbiA9IGk7XG4gICAgICAgIG5vbkhvc3QgPSAtMTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBpZiAoaG9zdEVuZCAhPT0gLTEpXG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBzdGFydCA9IDA7XG4gICAgaWYgKGF0U2lnbiAhPT0gLTEpIHtcbiAgICAgIHRoaXMuYXV0aCA9IGRlY29kZVVSSUNvbXBvbmVudChyZXN0LnNsaWNlKDAsIGF0U2lnbikpO1xuICAgICAgc3RhcnQgPSBhdFNpZ24gKyAxO1xuICAgIH1cbiAgICBpZiAobm9uSG9zdCA9PT0gLTEpIHtcbiAgICAgIHRoaXMuaG9zdCA9IHJlc3Quc2xpY2Uoc3RhcnQpO1xuICAgICAgcmVzdCA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmhvc3QgPSByZXN0LnNsaWNlKHN0YXJ0LCBub25Ib3N0KTtcbiAgICAgIHJlc3QgPSByZXN0LnNsaWNlKG5vbkhvc3QpO1xuICAgIH1cblxuICAgIC8vIHB1bGwgb3V0IHBvcnQuXG4gICAgdGhpcy5wYXJzZUhvc3QoKTtcblxuICAgIC8vIHdlJ3ZlIGluZGljYXRlZCB0aGF0IHRoZXJlIGlzIGEgaG9zdG5hbWUsXG4gICAgLy8gc28gZXZlbiBpZiBpdCdzIGVtcHR5LCBpdCBoYXMgdG8gYmUgcHJlc2VudC5cbiAgICBpZiAodHlwZW9mIHRoaXMuaG9zdG5hbWUgIT09ICdzdHJpbmcnKVxuICAgICAgdGhpcy5ob3N0bmFtZSA9ICcnO1xuXG4gICAgdmFyIGhvc3RuYW1lID0gdGhpcy5ob3N0bmFtZTtcblxuICAgIC8vIGlmIGhvc3RuYW1lIGJlZ2lucyB3aXRoIFsgYW5kIGVuZHMgd2l0aCBdXG4gICAgLy8gYXNzdW1lIHRoYXQgaXQncyBhbiBJUHY2IGFkZHJlc3MuXG4gICAgdmFyIGlwdjZIb3N0bmFtZSA9IGhvc3RuYW1lLmNoYXJDb2RlQXQoMCkgPT09IDkxLypbKi8gJiZcbiAgICAgICAgICAgICAgICAgICAgICAgaG9zdG5hbWUuY2hhckNvZGVBdChob3N0bmFtZS5sZW5ndGggLSAxKSA9PT0gOTMvKl0qLztcblxuICAgIC8vIHZhbGlkYXRlIGEgbGl0dGxlLlxuICAgIGlmICghaXB2Nkhvc3RuYW1lKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSB2YWxpZGF0ZUhvc3RuYW1lKHRoaXMsIHJlc3QsIGhvc3RuYW1lKTtcbiAgICAgIGlmIChyZXN1bHQgIT09IHVuZGVmaW5lZClcbiAgICAgICAgcmVzdCA9IHJlc3VsdDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5ob3N0bmFtZS5sZW5ndGggPiBob3N0bmFtZU1heExlbikge1xuICAgICAgdGhpcy5ob3N0bmFtZSA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBob3N0bmFtZXMgYXJlIGFsd2F5cyBsb3dlciBjYXNlLlxuICAgICAgdGhpcy5ob3N0bmFtZSA9IHRoaXMuaG9zdG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICB9XG5cbiAgICBpZiAoIWlwdjZIb3N0bmFtZSkge1xuICAgICAgLy8gSUROQSBTdXBwb3J0OiBSZXR1cm5zIGEgcHVueWNvZGVkIHJlcHJlc2VudGF0aW9uIG9mIFwiZG9tYWluXCIuXG4gICAgICAvLyBJdCBvbmx5IGNvbnZlcnRzIHBhcnRzIG9mIHRoZSBkb21haW4gbmFtZSB0aGF0XG4gICAgICAvLyBoYXZlIG5vbi1BU0NJSSBjaGFyYWN0ZXJzLCBpLmUuIGl0IGRvZXNuJ3QgbWF0dGVyIGlmXG4gICAgICAvLyB5b3UgY2FsbCBpdCB3aXRoIGEgZG9tYWluIHRoYXQgYWxyZWFkeSBpcyBBU0NJSS1vbmx5LlxuICAgICAgdGhpcy5ob3N0bmFtZSA9IHB1bnljb2RlLnRvQVNDSUkodGhpcy5ob3N0bmFtZSk7XG4gICAgfVxuXG4gICAgdmFyIHAgPSB0aGlzLnBvcnQgPyAnOicgKyB0aGlzLnBvcnQgOiAnJztcbiAgICB2YXIgaCA9IHRoaXMuaG9zdG5hbWUgfHwgJyc7XG4gICAgdGhpcy5ob3N0ID0gaCArIHA7XG5cbiAgICAvLyBzdHJpcCBbIGFuZCBdIGZyb20gdGhlIGhvc3RuYW1lXG4gICAgLy8gdGhlIGhvc3QgZmllbGQgc3RpbGwgcmV0YWlucyB0aGVtLCB0aG91Z2hcbiAgICBpZiAoaXB2Nkhvc3RuYW1lKSB7XG4gICAgICB0aGlzLmhvc3RuYW1lID0gdGhpcy5ob3N0bmFtZS5zbGljZSgxLCAtMSk7XG4gICAgICBpZiAocmVzdFswXSAhPT0gJy8nKSB7XG4gICAgICAgIHJlc3QgPSAnLycgKyByZXN0O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIG5vdyByZXN0IGlzIHNldCB0byB0aGUgcG9zdC1ob3N0IHN0dWZmLlxuICAvLyBjaG9wIG9mZiBhbnkgZGVsaW0gY2hhcnMuXG4gIGlmICghdW5zYWZlUHJvdG9jb2xbbG93ZXJQcm90b10pIHtcbiAgICAvLyBGaXJzdCwgbWFrZSAxMDAlIHN1cmUgdGhhdCBhbnkgXCJhdXRvRXNjYXBlXCIgY2hhcnMgZ2V0XG4gICAgLy8gZXNjYXBlZCwgZXZlbiBpZiBlbmNvZGVVUklDb21wb25lbnQgZG9lc24ndCB0aGluayB0aGV5XG4gICAgLy8gbmVlZCB0byBiZS5cbiAgICBjb25zdCByZXN1bHQgPSBhdXRvRXNjYXBlU3RyKHJlc3QpO1xuICAgIGlmIChyZXN1bHQgIT09IHVuZGVmaW5lZClcbiAgICAgIHJlc3QgPSByZXN1bHQ7XG4gIH1cblxuICB2YXIgcXVlc3Rpb25JZHggPSAtMTtcbiAgdmFyIGhhc2hJZHggPSAtMTtcbiAgZm9yIChpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyArK2kpIHtcbiAgICBjb25zdCBjb2RlID0gcmVzdC5jaGFyQ29kZUF0KGkpO1xuICAgIGlmIChjb2RlID09PSAzNS8qIyovKSB7XG4gICAgICB0aGlzLmhhc2ggPSByZXN0LnNsaWNlKGkpO1xuICAgICAgaGFzaElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9IGVsc2UgaWYgKGNvZGUgPT09IDYzLyo/Ki8gJiYgcXVlc3Rpb25JZHggPT09IC0xKSB7XG4gICAgICBxdWVzdGlvbklkeCA9IGk7XG4gICAgfVxuICB9XG5cbiAgaWYgKHF1ZXN0aW9uSWR4ICE9PSAtMSkge1xuICAgIGlmIChoYXNoSWR4ID09PSAtMSkge1xuICAgICAgdGhpcy5zZWFyY2ggPSByZXN0LnNsaWNlKHF1ZXN0aW9uSWR4KTtcbiAgICAgIHRoaXMucXVlcnkgPSByZXN0LnNsaWNlKHF1ZXN0aW9uSWR4ICsgMSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuc2VhcmNoID0gcmVzdC5zbGljZShxdWVzdGlvbklkeCwgaGFzaElkeCk7XG4gICAgICB0aGlzLnF1ZXJ5ID0gcmVzdC5zbGljZShxdWVzdGlvbklkeCArIDEsIGhhc2hJZHgpO1xuICAgIH1cbiAgICBpZiAocGFyc2VRdWVyeVN0cmluZykge1xuICAgICAgdGhpcy5xdWVyeSA9IHF1ZXJ5c3RyaW5nLnBhcnNlKHRoaXMucXVlcnkpO1xuICAgIH1cbiAgfSBlbHNlIGlmIChwYXJzZVF1ZXJ5U3RyaW5nKSB7XG4gICAgLy8gbm8gcXVlcnkgc3RyaW5nLCBidXQgcGFyc2VRdWVyeVN0cmluZyBzdGlsbCByZXF1ZXN0ZWRcbiAgICB0aGlzLnNlYXJjaCA9ICcnO1xuICAgIHRoaXMucXVlcnkgPSB7fTtcbiAgfVxuXG4gIHZhciBmaXJzdElkeCA9IChxdWVzdGlvbklkeCAhPT0gLTEgJiZcbiAgICAgICAgICAgICAgICAgIChoYXNoSWR4ID09PSAtMSB8fCBxdWVzdGlvbklkeCA8IGhhc2hJZHgpXG4gICAgPyBxdWVzdGlvbklkeFxuICAgIDogaGFzaElkeCk7XG4gIGlmIChmaXJzdElkeCA9PT0gLTEpIHtcbiAgICBpZiAocmVzdC5sZW5ndGggPiAwKVxuICAgICAgdGhpcy5wYXRobmFtZSA9IHJlc3Q7XG4gIH0gZWxzZSBpZiAoZmlyc3RJZHggPiAwKSB7XG4gICAgdGhpcy5wYXRobmFtZSA9IHJlc3Quc2xpY2UoMCwgZmlyc3RJZHgpO1xuICB9XG4gIGlmIChzbGFzaGVkUHJvdG9jb2xbbG93ZXJQcm90b10gJiZcbiAgICAgIHRoaXMuaG9zdG5hbWUgJiYgIXRoaXMucGF0aG5hbWUpIHtcbiAgICB0aGlzLnBhdGhuYW1lID0gJy8nO1xuICB9XG5cbiAgLy8gdG8gc3VwcG9ydCBodHRwLnJlcXVlc3RcbiAgaWYgKHRoaXMucGF0aG5hbWUgfHwgdGhpcy5zZWFyY2gpIHtcbiAgICBjb25zdCBwID0gdGhpcy5wYXRobmFtZSB8fCAnJztcbiAgICBjb25zdCBzID0gdGhpcy5zZWFyY2ggfHwgJyc7XG4gICAgdGhpcy5wYXRoID0gcCArIHM7XG4gIH1cblxuICAvLyBmaW5hbGx5LCByZWNvbnN0cnVjdCB0aGUgaHJlZiBiYXNlZCBvbiB3aGF0IGhhcyBiZWVuIHZhbGlkYXRlZC5cbiAgdGhpcy5ocmVmID0gdGhpcy5mb3JtYXQoKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dDogaW1wcm92ZSBjb3ZlcmFnZSAqL1xuZnVuY3Rpb24gdmFsaWRhdGVIb3N0bmFtZShzZWxmLCByZXN0LCBob3N0bmFtZSkge1xuICBmb3IgKHZhciBpID0gMCwgbGFzdFBvczsgaSA8PSBob3N0bmFtZS5sZW5ndGg7ICsraSkge1xuICAgIHZhciBjb2RlO1xuICAgIGlmIChpIDwgaG9zdG5hbWUubGVuZ3RoKVxuICAgICAgY29kZSA9IGhvc3RuYW1lLmNoYXJDb2RlQXQoaSk7XG4gICAgaWYgKGNvZGUgPT09IDQ2LyouKi8gfHwgaSA9PT0gaG9zdG5hbWUubGVuZ3RoKSB7XG4gICAgICBpZiAoaSAtIGxhc3RQb3MgPiAwKSB7XG4gICAgICAgIGlmIChpIC0gbGFzdFBvcyA+IDYzKSB7XG4gICAgICAgICAgc2VsZi5ob3N0bmFtZSA9IGhvc3RuYW1lLnNsaWNlKDAsIGxhc3RQb3MgKyA2Myk7XG4gICAgICAgICAgcmV0dXJuICcvJyArIGhvc3RuYW1lLnNsaWNlKGxhc3RQb3MgKyA2MykgKyByZXN0O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBsYXN0UG9zID0gaSArIDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9IGVsc2UgaWYgKChjb2RlID49IDQ4LyowKi8gJiYgY29kZSA8PSA1Ny8qOSovKSB8fFxuICAgICAgICAgICAgICAgKGNvZGUgPj0gOTcvKmEqLyAmJiBjb2RlIDw9IDEyMi8qeiovKSB8fFxuICAgICAgICAgICAgICAgY29kZSA9PT0gNDUvKi0qLyB8fFxuICAgICAgICAgICAgICAgKGNvZGUgPj0gNjUvKkEqLyAmJiBjb2RlIDw9IDkwLypaKi8pIHx8XG4gICAgICAgICAgICAgICBjb2RlID09PSA0My8qKyovIHx8XG4gICAgICAgICAgICAgICBjb2RlID09PSA5NS8qXyovIHx8XG4gICAgICAgICAgICAgICAvKiBCRUdJTiBNT05HTyBVUkkgUEFUQ0ggKi9cbiAgICAgICAgICAgICAgIGNvZGUgPT09IDQ0LyosKi8gfHxcbiAgICAgICAgICAgICAgIGNvZGUgPT09IDU4Lyo6Ki8gfHxcbiAgICAgICAgICAgICAgIC8qIEVORCBNT05HTyBVUkkgUEFUQ0ggKi9cbiAgICAgICAgICAgICAgIGNvZGUgPiAxMjcpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBJbnZhbGlkIGhvc3QgY2hhcmFjdGVyXG4gICAgc2VsZi5ob3N0bmFtZSA9IGhvc3RuYW1lLnNsaWNlKDAsIGkpO1xuICAgIGlmIChpIDwgaG9zdG5hbWUubGVuZ3RoKVxuICAgICAgcmV0dXJuICcvJyArIGhvc3RuYW1lLnNsaWNlKGkpICsgcmVzdDtcbiAgICBicmVhaztcbiAgfVxufVxuXG4vKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dDogaW1wcm92ZSBjb3ZlcmFnZSAqL1xuZnVuY3Rpb24gYXV0b0VzY2FwZVN0cihyZXN0KSB7XG4gIHZhciBuZXdSZXN0ID0gJyc7XG4gIHZhciBsYXN0UG9zID0gMDtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgKytpKSB7XG4gICAgLy8gQXV0b21hdGljYWxseSBlc2NhcGUgYWxsIGRlbGltaXRlcnMgYW5kIHVud2lzZSBjaGFyYWN0ZXJzIGZyb20gUkZDIDIzOTZcbiAgICAvLyBBbHNvIGVzY2FwZSBzaW5nbGUgcXVvdGVzIGluIGNhc2Ugb2YgYW4gWFNTIGF0dGFja1xuICAgIHN3aXRjaCAocmVzdC5jaGFyQ29kZUF0KGkpKSB7XG4gICAgY2FzZSA5OiAgIC8vICdcXHQnXG4gICAgICBpZiAoaSAtIGxhc3RQb3MgPiAwKVxuICAgICAgICBuZXdSZXN0ICs9IHJlc3Quc2xpY2UobGFzdFBvcywgaSk7XG4gICAgICBuZXdSZXN0ICs9ICclMDknO1xuICAgICAgbGFzdFBvcyA9IGkgKyAxO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAxMDogIC8vICdcXG4nXG4gICAgICBpZiAoaSAtIGxhc3RQb3MgPiAwKVxuICAgICAgICBuZXdSZXN0ICs9IHJlc3Quc2xpY2UobGFzdFBvcywgaSk7XG4gICAgICBuZXdSZXN0ICs9ICclMEEnO1xuICAgICAgbGFzdFBvcyA9IGkgKyAxO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAxMzogIC8vICdcXHInXG4gICAgICBpZiAoaSAtIGxhc3RQb3MgPiAwKVxuICAgICAgICBuZXdSZXN0ICs9IHJlc3Quc2xpY2UobGFzdFBvcywgaSk7XG4gICAgICBuZXdSZXN0ICs9ICclMEQnO1xuICAgICAgbGFzdFBvcyA9IGkgKyAxO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAzMjogIC8vICcgJ1xuICAgICAgaWYgKGkgLSBsYXN0UG9zID4gMClcbiAgICAgICAgbmV3UmVzdCArPSByZXN0LnNsaWNlKGxhc3RQb3MsIGkpO1xuICAgICAgbmV3UmVzdCArPSAnJTIwJztcbiAgICAgIGxhc3RQb3MgPSBpICsgMTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgMzQ6ICAvLyAnXCInXG4gICAgICBpZiAoaSAtIGxhc3RQb3MgPiAwKVxuICAgICAgICBuZXdSZXN0ICs9IHJlc3Quc2xpY2UobGFzdFBvcywgaSk7XG4gICAgICBuZXdSZXN0ICs9ICclMjInO1xuICAgICAgbGFzdFBvcyA9IGkgKyAxO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAzOTogIC8vICdcXCcnXG4gICAgICBpZiAoaSAtIGxhc3RQb3MgPiAwKVxuICAgICAgICBuZXdSZXN0ICs9IHJlc3Quc2xpY2UobGFzdFBvcywgaSk7XG4gICAgICBuZXdSZXN0ICs9ICclMjcnO1xuICAgICAgbGFzdFBvcyA9IGkgKyAxO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSA2MDogIC8vICc8J1xuICAgICAgaWYgKGkgLSBsYXN0UG9zID4gMClcbiAgICAgICAgbmV3UmVzdCArPSByZXN0LnNsaWNlKGxhc3RQb3MsIGkpO1xuICAgICAgbmV3UmVzdCArPSAnJTNDJztcbiAgICAgIGxhc3RQb3MgPSBpICsgMTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgNjI6ICAvLyAnPidcbiAgICAgIGlmIChpIC0gbGFzdFBvcyA+IDApXG4gICAgICAgIG5ld1Jlc3QgKz0gcmVzdC5zbGljZShsYXN0UG9zLCBpKTtcbiAgICAgIG5ld1Jlc3QgKz0gJyUzRSc7XG4gICAgICBsYXN0UG9zID0gaSArIDE7XG4gICAgICBicmVhaztcbiAgICBjYXNlIDkyOiAgLy8gJ1xcXFwnXG4gICAgICBpZiAoaSAtIGxhc3RQb3MgPiAwKVxuICAgICAgICBuZXdSZXN0ICs9IHJlc3Quc2xpY2UobGFzdFBvcywgaSk7XG4gICAgICBuZXdSZXN0ICs9ICclNUMnO1xuICAgICAgbGFzdFBvcyA9IGkgKyAxO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSA5NDogIC8vICdeJ1xuICAgICAgaWYgKGkgLSBsYXN0UG9zID4gMClcbiAgICAgICAgbmV3UmVzdCArPSByZXN0LnNsaWNlKGxhc3RQb3MsIGkpO1xuICAgICAgbmV3UmVzdCArPSAnJTVFJztcbiAgICAgIGxhc3RQb3MgPSBpICsgMTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgOTY6ICAvLyAnYCdcbiAgICAgIGlmIChpIC0gbGFzdFBvcyA+IDApXG4gICAgICAgIG5ld1Jlc3QgKz0gcmVzdC5zbGljZShsYXN0UG9zLCBpKTtcbiAgICAgIG5ld1Jlc3QgKz0gJyU2MCc7XG4gICAgICBsYXN0UG9zID0gaSArIDE7XG4gICAgICBicmVhaztcbiAgICBjYXNlIDEyMzogLy8gJ3snXG4gICAgICBpZiAoaSAtIGxhc3RQb3MgPiAwKVxuICAgICAgICBuZXdSZXN0ICs9IHJlc3Quc2xpY2UobGFzdFBvcywgaSk7XG4gICAgICBuZXdSZXN0ICs9ICclN0InO1xuICAgICAgbGFzdFBvcyA9IGkgKyAxO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAxMjQ6IC8vICd8J1xuICAgICAgaWYgKGkgLSBsYXN0UG9zID4gMClcbiAgICAgICAgbmV3UmVzdCArPSByZXN0LnNsaWNlKGxhc3RQb3MsIGkpO1xuICAgICAgbmV3UmVzdCArPSAnJTdDJztcbiAgICAgIGxhc3RQb3MgPSBpICsgMTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgMTI1OiAvLyAnfSdcbiAgICAgIGlmIChpIC0gbGFzdFBvcyA+IDApXG4gICAgICAgIG5ld1Jlc3QgKz0gcmVzdC5zbGljZShsYXN0UG9zLCBpKTtcbiAgICAgIG5ld1Jlc3QgKz0gJyU3RCc7XG4gICAgICBsYXN0UG9zID0gaSArIDE7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKGxhc3RQb3MgPT09IDApXG4gICAgcmV0dXJuO1xuICBpZiAobGFzdFBvcyA8IHJlc3QubGVuZ3RoKVxuICAgIHJldHVybiBuZXdSZXN0ICsgcmVzdC5zbGljZShsYXN0UG9zKTtcbiAgZWxzZVxuICAgIHJldHVybiBuZXdSZXN0O1xufVxuXG4vLyBmb3JtYXQgYSBwYXJzZWQgb2JqZWN0IGludG8gYSB1cmwgc3RyaW5nXG4vKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dDogaW1wcm92ZSBjb3ZlcmFnZSAqL1xuZnVuY3Rpb24gdXJsRm9ybWF0KG9iaikge1xuICAvLyBlbnN1cmUgaXQncyBhbiBvYmplY3QsIGFuZCBub3QgYSBzdHJpbmcgdXJsLlxuICAvLyBJZiBpdCdzIGFuIG9iaiwgdGhpcyBpcyBhIG5vLW9wLlxuICAvLyB0aGlzIHdheSwgeW91IGNhbiBjYWxsIHVybF9mb3JtYXQoKSBvbiBzdHJpbmdzXG4gIC8vIHRvIGNsZWFuIHVwIHBvdGVudGlhbGx5IHdvbmt5IHVybHMuXG4gIGlmICh0eXBlb2Ygb2JqID09PSAnc3RyaW5nJykgb2JqID0gdXJsUGFyc2Uob2JqKTtcblxuICBlbHNlIGlmICh0eXBlb2Ygb2JqICE9PSAnb2JqZWN0JyB8fCBvYmogPT09IG51bGwpXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignUGFyYW1ldGVyIFwidXJsT2JqXCIgbXVzdCBiZSBhbiBvYmplY3QsIG5vdCAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgIG9iaiA9PT0gbnVsbCA/ICdudWxsJyA6IHR5cGVvZiBvYmopO1xuXG4gIGVsc2UgaWYgKCEob2JqIGluc3RhbmNlb2YgVXJsKSkgcmV0dXJuIFVybC5wcm90b3R5cGUuZm9ybWF0LmNhbGwob2JqKTtcblxuICByZXR1cm4gb2JqLmZvcm1hdCgpO1xufVxuXG4vKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dDogaW1wcm92ZSBjb3ZlcmFnZSAqL1xuVXJsLnByb3RvdHlwZS5mb3JtYXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGF1dGggPSB0aGlzLmF1dGggfHwgJyc7XG4gIGlmIChhdXRoKSB7XG4gICAgYXV0aCA9IGVuY29kZUF1dGgoYXV0aCk7XG4gICAgYXV0aCArPSAnQCc7XG4gIH1cblxuICB2YXIgcHJvdG9jb2wgPSB0aGlzLnByb3RvY29sIHx8ICcnO1xuICB2YXIgcGF0aG5hbWUgPSB0aGlzLnBhdGhuYW1lIHx8ICcnO1xuICB2YXIgaGFzaCA9IHRoaXMuaGFzaCB8fCAnJztcbiAgdmFyIGhvc3QgPSBmYWxzZTtcbiAgdmFyIHF1ZXJ5ID0gJyc7XG5cbiAgaWYgKHRoaXMuaG9zdCkge1xuICAgIGhvc3QgPSBhdXRoICsgdGhpcy5ob3N0O1xuICB9IGVsc2UgaWYgKHRoaXMuaG9zdG5hbWUpIHtcbiAgICBob3N0ID0gYXV0aCArICh0aGlzLmhvc3RuYW1lLmluZGV4T2YoJzonKSA9PT0gLTEgP1xuICAgICAgdGhpcy5ob3N0bmFtZSA6XG4gICAgICAnWycgKyB0aGlzLmhvc3RuYW1lICsgJ10nKTtcbiAgICBpZiAodGhpcy5wb3J0KSB7XG4gICAgICBob3N0ICs9ICc6JyArIHRoaXMucG9ydDtcbiAgICB9XG4gIH1cblxuICBpZiAodGhpcy5xdWVyeSAhPT0gbnVsbCAmJiB0eXBlb2YgdGhpcy5xdWVyeSA9PT0gJ29iamVjdCcpXG4gICAgcXVlcnkgPSBxdWVyeXN0cmluZy5zdHJpbmdpZnkodGhpcy5xdWVyeSk7XG5cbiAgdmFyIHNlYXJjaCA9IHRoaXMuc2VhcmNoIHx8IChxdWVyeSAmJiAoJz8nICsgcXVlcnkpKSB8fCAnJztcblxuICBpZiAocHJvdG9jb2wgJiYgcHJvdG9jb2wuY2hhckNvZGVBdChwcm90b2NvbC5sZW5ndGggLSAxKSAhPT0gNTgvKjoqLylcbiAgICBwcm90b2NvbCArPSAnOic7XG5cbiAgdmFyIG5ld1BhdGhuYW1lID0gJyc7XG4gIHZhciBsYXN0UG9zID0gMDtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXRobmFtZS5sZW5ndGg7ICsraSkge1xuICAgIHN3aXRjaCAocGF0aG5hbWUuY2hhckNvZGVBdChpKSkge1xuICAgIGNhc2UgMzU6IC8vICcjJ1xuICAgICAgaWYgKGkgLSBsYXN0UG9zID4gMClcbiAgICAgICAgbmV3UGF0aG5hbWUgKz0gcGF0aG5hbWUuc2xpY2UobGFzdFBvcywgaSk7XG4gICAgICBuZXdQYXRobmFtZSArPSAnJTIzJztcbiAgICAgIGxhc3RQb3MgPSBpICsgMTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgNjM6IC8vICc/J1xuICAgICAgaWYgKGkgLSBsYXN0UG9zID4gMClcbiAgICAgICAgbmV3UGF0aG5hbWUgKz0gcGF0aG5hbWUuc2xpY2UobGFzdFBvcywgaSk7XG4gICAgICBuZXdQYXRobmFtZSArPSAnJTNGJztcbiAgICAgIGxhc3RQb3MgPSBpICsgMTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAobGFzdFBvcyA+IDApIHtcbiAgICBpZiAobGFzdFBvcyAhPT0gcGF0aG5hbWUubGVuZ3RoKVxuICAgICAgcGF0aG5hbWUgPSBuZXdQYXRobmFtZSArIHBhdGhuYW1lLnNsaWNlKGxhc3RQb3MpO1xuICAgIGVsc2VcbiAgICAgIHBhdGhuYW1lID0gbmV3UGF0aG5hbWU7XG4gIH1cblxuICAvLyBvbmx5IHRoZSBzbGFzaGVkUHJvdG9jb2xzIGdldCB0aGUgLy8uICBOb3QgbWFpbHRvOiwgeG1wcDosIGV0Yy5cbiAgLy8gdW5sZXNzIHRoZXkgaGFkIHRoZW0gdG8gYmVnaW4gd2l0aC5cbiAgaWYgKHRoaXMuc2xhc2hlcyB8fFxuICAgICAgKCFwcm90b2NvbCB8fCBzbGFzaGVkUHJvdG9jb2xbcHJvdG9jb2xdKSAmJiBob3N0ICE9PSBmYWxzZSkge1xuICAgIGhvc3QgPSAnLy8nICsgKGhvc3QgfHwgJycpO1xuICAgIGlmIChwYXRobmFtZSAmJiBwYXRobmFtZS5jaGFyQ29kZUF0KDApICE9PSA0Ny8qLyovKVxuICAgICAgcGF0aG5hbWUgPSAnLycgKyBwYXRobmFtZTtcbiAgfSBlbHNlIGlmICghaG9zdCkge1xuICAgIGhvc3QgPSAnJztcbiAgfVxuXG4gIHNlYXJjaCA9IHNlYXJjaC5yZXBsYWNlKCcjJywgJyUyMycpO1xuXG4gIGlmIChoYXNoICYmIGhhc2guY2hhckNvZGVBdCgwKSAhPT0gMzUvKiMqLykgaGFzaCA9ICcjJyArIGhhc2g7XG4gIGlmIChzZWFyY2ggJiYgc2VhcmNoLmNoYXJDb2RlQXQoMCkgIT09IDYzLyo/Ki8pIHNlYXJjaCA9ICc/JyArIHNlYXJjaDtcblxuICByZXR1cm4gcHJvdG9jb2wgKyBob3N0ICsgcGF0aG5hbWUgKyBzZWFyY2ggKyBoYXNoO1xufTtcblxuLyogaXN0YW5idWwgaWdub3JlIG5leHQ6IGltcHJvdmUgY292ZXJhZ2UgKi9cbmZ1bmN0aW9uIHVybFJlc29sdmUoc291cmNlLCByZWxhdGl2ZSkge1xuICByZXR1cm4gdXJsUGFyc2Uoc291cmNlLCBmYWxzZSwgdHJ1ZSkucmVzb2x2ZShyZWxhdGl2ZSk7XG59XG5cbi8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0OiBpbXByb3ZlIGNvdmVyYWdlICovXG5VcmwucHJvdG90eXBlLnJlc29sdmUgPSBmdW5jdGlvbihyZWxhdGl2ZSkge1xuICByZXR1cm4gdGhpcy5yZXNvbHZlT2JqZWN0KHVybFBhcnNlKHJlbGF0aXZlLCBmYWxzZSwgdHJ1ZSkpLmZvcm1hdCgpO1xufTtcblxuLyogaXN0YW5idWwgaWdub3JlIG5leHQ6IGltcHJvdmUgY292ZXJhZ2UgKi9cbmZ1bmN0aW9uIHVybFJlc29sdmVPYmplY3Qoc291cmNlLCByZWxhdGl2ZSkge1xuICBpZiAoIXNvdXJjZSkgcmV0dXJuIHJlbGF0aXZlO1xuICByZXR1cm4gdXJsUGFyc2Uoc291cmNlLCBmYWxzZSwgdHJ1ZSkucmVzb2x2ZU9iamVjdChyZWxhdGl2ZSk7XG59XG5cbi8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0OiBpbXByb3ZlIGNvdmVyYWdlICovXG5VcmwucHJvdG90eXBlLnJlc29sdmVPYmplY3QgPSBmdW5jdGlvbihyZWxhdGl2ZSkge1xuICBpZiAodHlwZW9mIHJlbGF0aXZlID09PSAnc3RyaW5nJykge1xuICAgIHZhciByZWwgPSBuZXcgVXJsKCk7XG4gICAgcmVsLnBhcnNlKHJlbGF0aXZlLCBmYWxzZSwgdHJ1ZSk7XG4gICAgcmVsYXRpdmUgPSByZWw7XG4gIH1cblxuICB2YXIgcmVzdWx0ID0gbmV3IFVybCgpO1xuICB2YXIgdGtleXMgPSBPYmplY3Qua2V5cyh0aGlzKTtcbiAgZm9yICh2YXIgdGsgPSAwOyB0ayA8IHRrZXlzLmxlbmd0aDsgdGsrKykge1xuICAgIHZhciB0a2V5ID0gdGtleXNbdGtdO1xuICAgIHJlc3VsdFt0a2V5XSA9IHRoaXNbdGtleV07XG4gIH1cblxuICAvLyBoYXNoIGlzIGFsd2F5cyBvdmVycmlkZGVuLCBubyBtYXR0ZXIgd2hhdC5cbiAgLy8gZXZlbiBocmVmPVwiXCIgd2lsbCByZW1vdmUgaXQuXG4gIHJlc3VsdC5oYXNoID0gcmVsYXRpdmUuaGFzaDtcblxuICAvLyBpZiB0aGUgcmVsYXRpdmUgdXJsIGlzIGVtcHR5LCB0aGVuIHRoZXJlJ3Mgbm90aGluZyBsZWZ0IHRvIGRvIGhlcmUuXG4gIGlmIChyZWxhdGl2ZS5ocmVmID09PSAnJykge1xuICAgIHJlc3VsdC5ocmVmID0gcmVzdWx0LmZvcm1hdCgpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBocmVmcyBsaWtlIC8vZm9vL2JhciBhbHdheXMgY3V0IHRvIHRoZSBwcm90b2NvbC5cbiAgaWYgKHJlbGF0aXZlLnNsYXNoZXMgJiYgIXJlbGF0aXZlLnByb3RvY29sKSB7XG4gICAgLy8gdGFrZSBldmVyeXRoaW5nIGV4Y2VwdCB0aGUgcHJvdG9jb2wgZnJvbSByZWxhdGl2ZVxuICAgIHZhciBya2V5cyA9IE9iamVjdC5rZXlzKHJlbGF0aXZlKTtcbiAgICBmb3IgKHZhciByayA9IDA7IHJrIDwgcmtleXMubGVuZ3RoOyByaysrKSB7XG4gICAgICB2YXIgcmtleSA9IHJrZXlzW3JrXTtcbiAgICAgIGlmIChya2V5ICE9PSAncHJvdG9jb2wnKVxuICAgICAgICByZXN1bHRbcmtleV0gPSByZWxhdGl2ZVtya2V5XTtcbiAgICB9XG5cbiAgICAvL3VybFBhcnNlIGFwcGVuZHMgdHJhaWxpbmcgLyB0byB1cmxzIGxpa2UgaHR0cDovL3d3dy5leGFtcGxlLmNvbVxuICAgIGlmIChzbGFzaGVkUHJvdG9jb2xbcmVzdWx0LnByb3RvY29sXSAmJlxuICAgICAgICByZXN1bHQuaG9zdG5hbWUgJiYgIXJlc3VsdC5wYXRobmFtZSkge1xuICAgICAgcmVzdWx0LnBhdGggPSByZXN1bHQucGF0aG5hbWUgPSAnLyc7XG4gICAgfVxuXG4gICAgcmVzdWx0LmhyZWYgPSByZXN1bHQuZm9ybWF0KCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIGlmIChyZWxhdGl2ZS5wcm90b2NvbCAmJiByZWxhdGl2ZS5wcm90b2NvbCAhPT0gcmVzdWx0LnByb3RvY29sKSB7XG4gICAgLy8gaWYgaXQncyBhIGtub3duIHVybCBwcm90b2NvbCwgdGhlbiBjaGFuZ2luZ1xuICAgIC8vIHRoZSBwcm90b2NvbCBkb2VzIHdlaXJkIHRoaW5nc1xuICAgIC8vIGZpcnN0LCBpZiBpdCdzIG5vdCBmaWxlOiwgdGhlbiB3ZSBNVVNUIGhhdmUgYSBob3N0LFxuICAgIC8vIGFuZCBpZiB0aGVyZSB3YXMgYSBwYXRoXG4gICAgLy8gdG8gYmVnaW4gd2l0aCwgdGhlbiB3ZSBNVVNUIGhhdmUgYSBwYXRoLlxuICAgIC8vIGlmIGl0IGlzIGZpbGU6LCB0aGVuIHRoZSBob3N0IGlzIGRyb3BwZWQsXG4gICAgLy8gYmVjYXVzZSB0aGF0J3Mga25vd24gdG8gYmUgaG9zdGxlc3MuXG4gICAgLy8gYW55dGhpbmcgZWxzZSBpcyBhc3N1bWVkIHRvIGJlIGFic29sdXRlLlxuICAgIGlmICghc2xhc2hlZFByb3RvY29sW3JlbGF0aXZlLnByb3RvY29sXSkge1xuICAgICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhyZWxhdGl2ZSk7XG4gICAgICBmb3IgKHZhciB2ID0gMDsgdiA8IGtleXMubGVuZ3RoOyB2KyspIHtcbiAgICAgICAgdmFyIGsgPSBrZXlzW3ZdO1xuICAgICAgICByZXN1bHRba10gPSByZWxhdGl2ZVtrXTtcbiAgICAgIH1cbiAgICAgIHJlc3VsdC5ocmVmID0gcmVzdWx0LmZvcm1hdCgpO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICByZXN1bHQucHJvdG9jb2wgPSByZWxhdGl2ZS5wcm90b2NvbDtcbiAgICBpZiAoIXJlbGF0aXZlLmhvc3QgJiZcbiAgICAgICAgIS9eZmlsZTo/JC8udGVzdChyZWxhdGl2ZS5wcm90b2NvbCkgJiZcbiAgICAgICAgIWhvc3RsZXNzUHJvdG9jb2xbcmVsYXRpdmUucHJvdG9jb2xdKSB7XG4gICAgICBjb25zdCByZWxQYXRoID0gKHJlbGF0aXZlLnBhdGhuYW1lIHx8ICcnKS5zcGxpdCgnLycpO1xuICAgICAgd2hpbGUgKHJlbFBhdGgubGVuZ3RoICYmICEocmVsYXRpdmUuaG9zdCA9IHJlbFBhdGguc2hpZnQoKSkpO1xuICAgICAgaWYgKCFyZWxhdGl2ZS5ob3N0KSByZWxhdGl2ZS5ob3N0ID0gJyc7XG4gICAgICBpZiAoIXJlbGF0aXZlLmhvc3RuYW1lKSByZWxhdGl2ZS5ob3N0bmFtZSA9ICcnO1xuICAgICAgaWYgKHJlbFBhdGhbMF0gIT09ICcnKSByZWxQYXRoLnVuc2hpZnQoJycpO1xuICAgICAgaWYgKHJlbFBhdGgubGVuZ3RoIDwgMikgcmVsUGF0aC51bnNoaWZ0KCcnKTtcbiAgICAgIHJlc3VsdC5wYXRobmFtZSA9IHJlbFBhdGguam9pbignLycpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQucGF0aG5hbWUgPSByZWxhdGl2ZS5wYXRobmFtZTtcbiAgICB9XG4gICAgcmVzdWx0LnNlYXJjaCA9IHJlbGF0aXZlLnNlYXJjaDtcbiAgICByZXN1bHQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcbiAgICByZXN1bHQuaG9zdCA9IHJlbGF0aXZlLmhvc3QgfHwgJyc7XG4gICAgcmVzdWx0LmF1dGggPSByZWxhdGl2ZS5hdXRoO1xuICAgIHJlc3VsdC5ob3N0bmFtZSA9IHJlbGF0aXZlLmhvc3RuYW1lIHx8IHJlbGF0aXZlLmhvc3Q7XG4gICAgcmVzdWx0LnBvcnQgPSByZWxhdGl2ZS5wb3J0O1xuICAgIC8vIHRvIHN1cHBvcnQgaHR0cC5yZXF1ZXN0XG4gICAgaWYgKHJlc3VsdC5wYXRobmFtZSB8fCByZXN1bHQuc2VhcmNoKSB7XG4gICAgICB2YXIgcCA9IHJlc3VsdC5wYXRobmFtZSB8fCAnJztcbiAgICAgIHZhciBzID0gcmVzdWx0LnNlYXJjaCB8fCAnJztcbiAgICAgIHJlc3VsdC5wYXRoID0gcCArIHM7XG4gICAgfVxuICAgIHJlc3VsdC5zbGFzaGVzID0gcmVzdWx0LnNsYXNoZXMgfHwgcmVsYXRpdmUuc2xhc2hlcztcbiAgICByZXN1bHQuaHJlZiA9IHJlc3VsdC5mb3JtYXQoKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgdmFyIGlzU291cmNlQWJzID0gKHJlc3VsdC5wYXRobmFtZSAmJiByZXN1bHQucGF0aG5hbWUuY2hhckF0KDApID09PSAnLycpO1xuICB2YXIgaXNSZWxBYnMgPSAoXG4gICAgcmVsYXRpdmUuaG9zdCB8fFxuICAgICAgcmVsYXRpdmUucGF0aG5hbWUgJiYgcmVsYXRpdmUucGF0aG5hbWUuY2hhckF0KDApID09PSAnLydcbiAgKTtcbiAgdmFyIG11c3RFbmRBYnMgPSAoaXNSZWxBYnMgfHwgaXNTb3VyY2VBYnMgfHxcbiAgICAgICAgICAgICAgICAgICAgKHJlc3VsdC5ob3N0ICYmIHJlbGF0aXZlLnBhdGhuYW1lKSk7XG4gIHZhciByZW1vdmVBbGxEb3RzID0gbXVzdEVuZEFicztcbiAgdmFyIHNyY1BhdGggPSByZXN1bHQucGF0aG5hbWUgJiYgcmVzdWx0LnBhdGhuYW1lLnNwbGl0KCcvJykgfHwgW107XG4gIHZhciByZWxQYXRoID0gcmVsYXRpdmUucGF0aG5hbWUgJiYgcmVsYXRpdmUucGF0aG5hbWUuc3BsaXQoJy8nKSB8fCBbXTtcbiAgdmFyIHBzeWNob3RpYyA9IHJlc3VsdC5wcm90b2NvbCAmJiAhc2xhc2hlZFByb3RvY29sW3Jlc3VsdC5wcm90b2NvbF07XG5cbiAgLy8gaWYgdGhlIHVybCBpcyBhIG5vbi1zbGFzaGVkIHVybCwgdGhlbiByZWxhdGl2ZVxuICAvLyBsaW5rcyBsaWtlIC4uLy4uIHNob3VsZCBiZSBhYmxlXG4gIC8vIHRvIGNyYXdsIHVwIHRvIHRoZSBob3N0bmFtZSwgYXMgd2VsbC4gIFRoaXMgaXMgc3RyYW5nZS5cbiAgLy8gcmVzdWx0LnByb3RvY29sIGhhcyBhbHJlYWR5IGJlZW4gc2V0IGJ5IG5vdy5cbiAgLy8gTGF0ZXIgb24sIHB1dCB0aGUgZmlyc3QgcGF0aCBwYXJ0IGludG8gdGhlIGhvc3QgZmllbGQuXG4gIGlmIChwc3ljaG90aWMpIHtcbiAgICByZXN1bHQuaG9zdG5hbWUgPSAnJztcbiAgICByZXN1bHQucG9ydCA9IG51bGw7XG4gICAgaWYgKHJlc3VsdC5ob3N0KSB7XG4gICAgICBpZiAoc3JjUGF0aFswXSA9PT0gJycpIHNyY1BhdGhbMF0gPSByZXN1bHQuaG9zdDtcbiAgICAgIGVsc2Ugc3JjUGF0aC51bnNoaWZ0KHJlc3VsdC5ob3N0KTtcbiAgICB9XG4gICAgcmVzdWx0Lmhvc3QgPSAnJztcbiAgICBpZiAocmVsYXRpdmUucHJvdG9jb2wpIHtcbiAgICAgIHJlbGF0aXZlLmhvc3RuYW1lID0gbnVsbDtcbiAgICAgIHJlbGF0aXZlLnBvcnQgPSBudWxsO1xuICAgICAgaWYgKHJlbGF0aXZlLmhvc3QpIHtcbiAgICAgICAgaWYgKHJlbFBhdGhbMF0gPT09ICcnKSByZWxQYXRoWzBdID0gcmVsYXRpdmUuaG9zdDtcbiAgICAgICAgZWxzZSByZWxQYXRoLnVuc2hpZnQocmVsYXRpdmUuaG9zdCk7XG4gICAgICB9XG4gICAgICByZWxhdGl2ZS5ob3N0ID0gbnVsbDtcbiAgICB9XG4gICAgbXVzdEVuZEFicyA9IG11c3RFbmRBYnMgJiYgKHJlbFBhdGhbMF0gPT09ICcnIHx8IHNyY1BhdGhbMF0gPT09ICcnKTtcbiAgfVxuXG4gIGlmIChpc1JlbEFicykge1xuICAgIC8vIGl0J3MgYWJzb2x1dGUuXG4gICAgcmVzdWx0Lmhvc3QgPSAocmVsYXRpdmUuaG9zdCB8fCByZWxhdGl2ZS5ob3N0ID09PSAnJykgP1xuICAgICAgcmVsYXRpdmUuaG9zdCA6IHJlc3VsdC5ob3N0O1xuICAgIHJlc3VsdC5ob3N0bmFtZSA9IChyZWxhdGl2ZS5ob3N0bmFtZSB8fCByZWxhdGl2ZS5ob3N0bmFtZSA9PT0gJycpID9cbiAgICAgIHJlbGF0aXZlLmhvc3RuYW1lIDogcmVzdWx0Lmhvc3RuYW1lO1xuICAgIHJlc3VsdC5zZWFyY2ggPSByZWxhdGl2ZS5zZWFyY2g7XG4gICAgcmVzdWx0LnF1ZXJ5ID0gcmVsYXRpdmUucXVlcnk7XG4gICAgc3JjUGF0aCA9IHJlbFBhdGg7XG4gICAgLy8gZmFsbCB0aHJvdWdoIHRvIHRoZSBkb3QtaGFuZGxpbmcgYmVsb3cuXG4gIH0gZWxzZSBpZiAocmVsUGF0aC5sZW5ndGgpIHtcbiAgICAvLyBpdCdzIHJlbGF0aXZlXG4gICAgLy8gdGhyb3cgYXdheSB0aGUgZXhpc3RpbmcgZmlsZSwgYW5kIHRha2UgdGhlIG5ldyBwYXRoIGluc3RlYWQuXG4gICAgaWYgKCFzcmNQYXRoKSBzcmNQYXRoID0gW107XG4gICAgc3JjUGF0aC5wb3AoKTtcbiAgICBzcmNQYXRoID0gc3JjUGF0aC5jb25jYXQocmVsUGF0aCk7XG4gICAgcmVzdWx0LnNlYXJjaCA9IHJlbGF0aXZlLnNlYXJjaDtcbiAgICByZXN1bHQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcbiAgfSBlbHNlIGlmIChyZWxhdGl2ZS5zZWFyY2ggIT09IG51bGwgJiYgcmVsYXRpdmUuc2VhcmNoICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBqdXN0IHB1bGwgb3V0IHRoZSBzZWFyY2guXG4gICAgLy8gbGlrZSBocmVmPSc/Zm9vJy5cbiAgICAvLyBQdXQgdGhpcyBhZnRlciB0aGUgb3RoZXIgdHdvIGNhc2VzIGJlY2F1c2UgaXQgc2ltcGxpZmllcyB0aGUgYm9vbGVhbnNcbiAgICBpZiAocHN5Y2hvdGljKSB7XG4gICAgICByZXN1bHQuaG9zdG5hbWUgPSByZXN1bHQuaG9zdCA9IHNyY1BhdGguc2hpZnQoKTtcbiAgICAgIC8vb2NjYXNpb25hbGx5IHRoZSBhdXRoIGNhbiBnZXQgc3R1Y2sgb25seSBpbiBob3N0XG4gICAgICAvL3RoaXMgZXNwZWNpYWxseSBoYXBwZW5zIGluIGNhc2VzIGxpa2VcbiAgICAgIC8vdXJsLnJlc29sdmVPYmplY3QoJ21haWx0bzpsb2NhbDFAZG9tYWluMScsICdsb2NhbDJAZG9tYWluMicpXG4gICAgICBjb25zdCBhdXRoSW5Ib3N0ID0gcmVzdWx0Lmhvc3QgJiYgcmVzdWx0Lmhvc3QuaW5kZXhPZignQCcpID4gMCA/XG4gICAgICAgIHJlc3VsdC5ob3N0LnNwbGl0KCdAJykgOiBmYWxzZTtcbiAgICAgIGlmIChhdXRoSW5Ib3N0KSB7XG4gICAgICAgIHJlc3VsdC5hdXRoID0gYXV0aEluSG9zdC5zaGlmdCgpO1xuICAgICAgICByZXN1bHQuaG9zdCA9IHJlc3VsdC5ob3N0bmFtZSA9IGF1dGhJbkhvc3Quc2hpZnQoKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmVzdWx0LnNlYXJjaCA9IHJlbGF0aXZlLnNlYXJjaDtcbiAgICByZXN1bHQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcbiAgICAvL3RvIHN1cHBvcnQgaHR0cC5yZXF1ZXN0XG4gICAgaWYgKHJlc3VsdC5wYXRobmFtZSAhPT0gbnVsbCB8fCByZXN1bHQuc2VhcmNoICE9PSBudWxsKSB7XG4gICAgICByZXN1bHQucGF0aCA9IChyZXN1bHQucGF0aG5hbWUgPyByZXN1bHQucGF0aG5hbWUgOiAnJykgK1xuICAgICAgICAgICAgICAgICAgICAocmVzdWx0LnNlYXJjaCA/IHJlc3VsdC5zZWFyY2ggOiAnJyk7XG4gICAgfVxuICAgIHJlc3VsdC5ocmVmID0gcmVzdWx0LmZvcm1hdCgpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBpZiAoIXNyY1BhdGgubGVuZ3RoKSB7XG4gICAgLy8gbm8gcGF0aCBhdCBhbGwuICBlYXN5LlxuICAgIC8vIHdlJ3ZlIGFscmVhZHkgaGFuZGxlZCB0aGUgb3RoZXIgc3R1ZmYgYWJvdmUuXG4gICAgcmVzdWx0LnBhdGhuYW1lID0gbnVsbDtcbiAgICAvL3RvIHN1cHBvcnQgaHR0cC5yZXF1ZXN0XG4gICAgaWYgKHJlc3VsdC5zZWFyY2gpIHtcbiAgICAgIHJlc3VsdC5wYXRoID0gJy8nICsgcmVzdWx0LnNlYXJjaDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0LnBhdGggPSBudWxsO1xuICAgIH1cbiAgICByZXN1bHQuaHJlZiA9IHJlc3VsdC5mb3JtYXQoKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gaWYgYSB1cmwgRU5EcyBpbiAuIG9yIC4uLCB0aGVuIGl0IG11c3QgZ2V0IGEgdHJhaWxpbmcgc2xhc2guXG4gIC8vIGhvd2V2ZXIsIGlmIGl0IGVuZHMgaW4gYW55dGhpbmcgZWxzZSBub24tc2xhc2h5LFxuICAvLyB0aGVuIGl0IG11c3QgTk9UIGdldCBhIHRyYWlsaW5nIHNsYXNoLlxuICB2YXIgbGFzdCA9IHNyY1BhdGguc2xpY2UoLTEpWzBdO1xuICB2YXIgaGFzVHJhaWxpbmdTbGFzaCA9IChcbiAgICAocmVzdWx0Lmhvc3QgfHwgcmVsYXRpdmUuaG9zdCB8fCBzcmNQYXRoLmxlbmd0aCA+IDEpICYmXG4gICAgICAobGFzdCA9PT0gJy4nIHx8IGxhc3QgPT09ICcuLicpIHx8IGxhc3QgPT09ICcnKTtcblxuICAvLyBzdHJpcCBzaW5nbGUgZG90cywgcmVzb2x2ZSBkb3VibGUgZG90cyB0byBwYXJlbnQgZGlyXG4gIC8vIGlmIHRoZSBwYXRoIHRyaWVzIHRvIGdvIGFib3ZlIHRoZSByb290LCBgdXBgIGVuZHMgdXAgPiAwXG4gIHZhciB1cCA9IDA7XG4gIGZvciAodmFyIGkgPSBzcmNQYXRoLmxlbmd0aDsgaSA+PSAwOyBpLS0pIHtcbiAgICBsYXN0ID0gc3JjUGF0aFtpXTtcbiAgICBpZiAobGFzdCA9PT0gJy4nKSB7XG4gICAgICBzcGxpY2VPbmUoc3JjUGF0aCwgaSk7XG4gICAgfSBlbHNlIGlmIChsYXN0ID09PSAnLi4nKSB7XG4gICAgICBzcGxpY2VPbmUoc3JjUGF0aCwgaSk7XG4gICAgICB1cCsrO1xuICAgIH0gZWxzZSBpZiAodXApIHtcbiAgICAgIHNwbGljZU9uZShzcmNQYXRoLCBpKTtcbiAgICAgIHVwLS07XG4gICAgfVxuICB9XG5cbiAgLy8gaWYgdGhlIHBhdGggaXMgYWxsb3dlZCB0byBnbyBhYm92ZSB0aGUgcm9vdCwgcmVzdG9yZSBsZWFkaW5nIC4uc1xuICBpZiAoIW11c3RFbmRBYnMgJiYgIXJlbW92ZUFsbERvdHMpIHtcbiAgICBmb3IgKDsgdXAtLTsgdXApIHtcbiAgICAgIHNyY1BhdGgudW5zaGlmdCgnLi4nKTtcbiAgICB9XG4gIH1cblxuICBpZiAobXVzdEVuZEFicyAmJiBzcmNQYXRoWzBdICE9PSAnJyAmJlxuICAgICAgKCFzcmNQYXRoWzBdIHx8IHNyY1BhdGhbMF0uY2hhckF0KDApICE9PSAnLycpKSB7XG4gICAgc3JjUGF0aC51bnNoaWZ0KCcnKTtcbiAgfVxuXG4gIGlmIChoYXNUcmFpbGluZ1NsYXNoICYmIChzcmNQYXRoLmpvaW4oJy8nKS5zdWJzdHIoLTEpICE9PSAnLycpKSB7XG4gICAgc3JjUGF0aC5wdXNoKCcnKTtcbiAgfVxuXG4gIHZhciBpc0Fic29sdXRlID0gc3JjUGF0aFswXSA9PT0gJycgfHxcbiAgICAgIChzcmNQYXRoWzBdICYmIHNyY1BhdGhbMF0uY2hhckF0KDApID09PSAnLycpO1xuXG4gIC8vIHB1dCB0aGUgaG9zdCBiYWNrXG4gIGlmIChwc3ljaG90aWMpIHtcbiAgICByZXN1bHQuaG9zdG5hbWUgPSByZXN1bHQuaG9zdCA9IGlzQWJzb2x1dGUgPyAnJyA6XG4gICAgICBzcmNQYXRoLmxlbmd0aCA/IHNyY1BhdGguc2hpZnQoKSA6ICcnO1xuICAgIC8vb2NjYXNpb25hbGx5IHRoZSBhdXRoIGNhbiBnZXQgc3R1Y2sgb25seSBpbiBob3N0XG4gICAgLy90aGlzIGVzcGVjaWFsbHkgaGFwcGVucyBpbiBjYXNlcyBsaWtlXG4gICAgLy91cmwucmVzb2x2ZU9iamVjdCgnbWFpbHRvOmxvY2FsMUBkb21haW4xJywgJ2xvY2FsMkBkb21haW4yJylcbiAgICBjb25zdCBhdXRoSW5Ib3N0ID0gcmVzdWx0Lmhvc3QgJiYgcmVzdWx0Lmhvc3QuaW5kZXhPZignQCcpID4gMCA/XG4gICAgICByZXN1bHQuaG9zdC5zcGxpdCgnQCcpIDogZmFsc2U7XG4gICAgaWYgKGF1dGhJbkhvc3QpIHtcbiAgICAgIHJlc3VsdC5hdXRoID0gYXV0aEluSG9zdC5zaGlmdCgpO1xuICAgICAgcmVzdWx0Lmhvc3QgPSByZXN1bHQuaG9zdG5hbWUgPSBhdXRoSW5Ib3N0LnNoaWZ0KCk7XG4gICAgfVxuICB9XG5cbiAgbXVzdEVuZEFicyA9IG11c3RFbmRBYnMgfHwgKHJlc3VsdC5ob3N0ICYmIHNyY1BhdGgubGVuZ3RoKTtcblxuICBpZiAobXVzdEVuZEFicyAmJiAhaXNBYnNvbHV0ZSkge1xuICAgIHNyY1BhdGgudW5zaGlmdCgnJyk7XG4gIH1cblxuICBpZiAoIXNyY1BhdGgubGVuZ3RoKSB7XG4gICAgcmVzdWx0LnBhdGhuYW1lID0gbnVsbDtcbiAgICByZXN1bHQucGF0aCA9IG51bGw7XG4gIH0gZWxzZSB7XG4gICAgcmVzdWx0LnBhdGhuYW1lID0gc3JjUGF0aC5qb2luKCcvJyk7XG4gIH1cblxuICAvL3RvIHN1cHBvcnQgcmVxdWVzdC5odHRwXG4gIGlmIChyZXN1bHQucGF0aG5hbWUgIT09IG51bGwgfHwgcmVzdWx0LnNlYXJjaCAhPT0gbnVsbCkge1xuICAgIHJlc3VsdC5wYXRoID0gKHJlc3VsdC5wYXRobmFtZSA/IHJlc3VsdC5wYXRobmFtZSA6ICcnKSArXG4gICAgICAgICAgICAgICAgICAocmVzdWx0LnNlYXJjaCA/IHJlc3VsdC5zZWFyY2ggOiAnJyk7XG4gIH1cbiAgcmVzdWx0LmF1dGggPSByZWxhdGl2ZS5hdXRoIHx8IHJlc3VsdC5hdXRoO1xuICByZXN1bHQuc2xhc2hlcyA9IHJlc3VsdC5zbGFzaGVzIHx8IHJlbGF0aXZlLnNsYXNoZXM7XG4gIHJlc3VsdC5ocmVmID0gcmVzdWx0LmZvcm1hdCgpO1xuICByZXR1cm4gcmVzdWx0O1xufTtcblxuLyogaXN0YW5idWwgaWdub3JlIG5leHQ6IGltcHJvdmUgY292ZXJhZ2UgKi9cblVybC5wcm90b3R5cGUucGFyc2VIb3N0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBob3N0ID0gdGhpcy5ob3N0O1xuICB2YXIgcG9ydCA9IHBvcnRQYXR0ZXJuLmV4ZWMoaG9zdCk7XG4gIGlmIChwb3J0KSB7XG4gICAgcG9ydCA9IHBvcnRbMF07XG4gICAgaWYgKHBvcnQgIT09ICc6Jykge1xuICAgICAgdGhpcy5wb3J0ID0gcG9ydC5zbGljZSgxKTtcbiAgICB9XG4gICAgaG9zdCA9IGhvc3Quc2xpY2UoMCwgaG9zdC5sZW5ndGggLSBwb3J0Lmxlbmd0aCk7XG4gIH1cbiAgaWYgKGhvc3QpIHRoaXMuaG9zdG5hbWUgPSBob3N0O1xufTtcblxuLy8gQWJvdXQgMS41eCBmYXN0ZXIgdGhhbiB0aGUgdHdvLWFyZyB2ZXJzaW9uIG9mIEFycmF5I3NwbGljZSgpLlxuLyogaXN0YW5idWwgaWdub3JlIG5leHQ6IGltcHJvdmUgY292ZXJhZ2UgKi9cbmZ1bmN0aW9uIHNwbGljZU9uZShsaXN0LCBpbmRleCkge1xuICBmb3IgKHZhciBpID0gaW5kZXgsIGsgPSBpICsgMSwgbiA9IGxpc3QubGVuZ3RoOyBrIDwgbjsgaSArPSAxLCBrICs9IDEpXG4gICAgbGlzdFtpXSA9IGxpc3Rba107XG4gIGxpc3QucG9wKCk7XG59XG5cbnZhciBoZXhUYWJsZSA9IG5ldyBBcnJheSgyNTYpO1xuZm9yICh2YXIgaSA9IDA7IGkgPCAyNTY7ICsraSlcbiAgaGV4VGFibGVbaV0gPSAnJScgKyAoKGkgPCAxNiA/ICcwJyA6ICcnKSArIGkudG9TdHJpbmcoMTYpKS50b1VwcGVyQ2FzZSgpO1xuLyogaXN0YW5idWwgaWdub3JlIG5leHQ6IGltcHJvdmUgY292ZXJhZ2UgKi9cbmZ1bmN0aW9uIGVuY29kZUF1dGgoc3RyKSB7XG4gIC8vIGZhc3RlciBlbmNvZGVVUklDb21wb25lbnQgYWx0ZXJuYXRpdmUgZm9yIGVuY29kaW5nIGF1dGggdXJpIGNvbXBvbmVudHNcbiAgdmFyIG91dCA9ICcnO1xuICB2YXIgbGFzdFBvcyA9IDA7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgKytpKSB7XG4gICAgdmFyIGMgPSBzdHIuY2hhckNvZGVBdChpKTtcblxuICAgIC8vIFRoZXNlIGNoYXJhY3RlcnMgZG8gbm90IG5lZWQgZXNjYXBpbmc6XG4gICAgLy8gISAtIC4gXyB+XG4gICAgLy8gJyAoICkgKiA6XG4gICAgLy8gZGlnaXRzXG4gICAgLy8gYWxwaGEgKHVwcGVyY2FzZSlcbiAgICAvLyBhbHBoYSAobG93ZXJjYXNlKVxuICAgIGlmIChjID09PSAweDIxIHx8IGMgPT09IDB4MkQgfHwgYyA9PT0gMHgyRSB8fCBjID09PSAweDVGIHx8IGMgPT09IDB4N0UgfHxcbiAgICAgICAgKGMgPj0gMHgyNyAmJiBjIDw9IDB4MkEpIHx8XG4gICAgICAgIChjID49IDB4MzAgJiYgYyA8PSAweDNBKSB8fFxuICAgICAgICAoYyA+PSAweDQxICYmIGMgPD0gMHg1QSkgfHxcbiAgICAgICAgKGMgPj0gMHg2MSAmJiBjIDw9IDB4N0EpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoaSAtIGxhc3RQb3MgPiAwKVxuICAgICAgb3V0ICs9IHN0ci5zbGljZShsYXN0UG9zLCBpKTtcblxuICAgIGxhc3RQb3MgPSBpICsgMTtcblxuICAgIC8vIE90aGVyIEFTQ0lJIGNoYXJhY3RlcnNcbiAgICBpZiAoYyA8IDB4ODApIHtcbiAgICAgIG91dCArPSBoZXhUYWJsZVtjXTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIE11bHRpLWJ5dGUgY2hhcmFjdGVycyAuLi5cbiAgICBpZiAoYyA8IDB4ODAwKSB7XG4gICAgICBvdXQgKz0gaGV4VGFibGVbMHhDMCB8IChjID4+IDYpXSArIGhleFRhYmxlWzB4ODAgfCAoYyAmIDB4M0YpXTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA8IDB4RDgwMCB8fCBjID49IDB4RTAwMCkge1xuICAgICAgb3V0ICs9IGhleFRhYmxlWzB4RTAgfCAoYyA+PiAxMildICtcbiAgICAgICAgICAgICBoZXhUYWJsZVsweDgwIHwgKChjID4+IDYpICYgMHgzRildICtcbiAgICAgICAgICAgICBoZXhUYWJsZVsweDgwIHwgKGMgJiAweDNGKV07XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gU3Vycm9nYXRlIHBhaXJcbiAgICArK2k7XG4gICAgdmFyIGMyO1xuICAgIGlmIChpIDwgc3RyLmxlbmd0aClcbiAgICAgIGMyID0gc3RyLmNoYXJDb2RlQXQoaSkgJiAweDNGRjtcbiAgICBlbHNlXG4gICAgICBjMiA9IDA7XG4gICAgYyA9IDB4MTAwMDAgKyAoKChjICYgMHgzRkYpIDw8IDEwKSB8IGMyKTtcbiAgICBvdXQgKz0gaGV4VGFibGVbMHhGMCB8IChjID4+IDE4KV0gK1xuICAgICAgICAgICBoZXhUYWJsZVsweDgwIHwgKChjID4+IDEyKSAmIDB4M0YpXSArXG4gICAgICAgICAgIGhleFRhYmxlWzB4ODAgfCAoKGMgPj4gNikgJiAweDNGKV0gK1xuICAgICAgICAgICBoZXhUYWJsZVsweDgwIHwgKGMgJiAweDNGKV07XG4gIH1cbiAgaWYgKGxhc3RQb3MgPT09IDApXG4gICAgcmV0dXJuIHN0cjtcbiAgaWYgKGxhc3RQb3MgPCBzdHIubGVuZ3RoKVxuICAgIHJldHVybiBvdXQgKyBzdHIuc2xpY2UobGFzdFBvcyk7XG4gIHJldHVybiBvdXQ7XG59XG4iXX0=