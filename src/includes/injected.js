if (document.contentType !== 'text/html' && /\.user\.js$/i.test(window.location.href)) !function () {

  function installScript() {
    // check if this is a userscript
    var text = document.body.textContent;
    if (/^\s*</.test(text)) return;
    opera.extension.postMessage({
      cmd: 'InstallScript',
      data: {
        url: window.location.href,
        from: document.referrer,
        text: text,
      },
    });
    window.history.go(-1);
  }
  if (document.readyState != 'complete') {
    window.addEventListener('load', installScript, false);
  } else installScript();

}(); else !function (window) {

  var _ = {
    getUniqId: function () {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    },
    includes: function (arr, item) {
      var length = arr.length;
      for (var i = 0; i < length; i ++)
        if (arr[i] === item) return true;
      return false;
    },
    forEach: function (arr, func, context) {
      var length = arr.length;
      for (var i = 0; i < length; i ++)
        if (func.call(context, arr[i], i, arr) === false) break;
    },
  };

  /**
  * http://www.webtoolkit.info/javascript-utf8.html
  */
  function utf8decode (utftext) {
    var string = "";
    var i = 0;
    var c = 0, c2 = 0, c3 = 0;
    while ( i < utftext.length ) {
      c = utftext.charCodeAt(i);
      if (c < 128) {string += String.fromCharCode(c);i++;}
      else if((c > 191) && (c < 224)) {
        c2 = utftext.charCodeAt(i+1);
        string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
        i += 2;
      } else {
        c2 = utftext.charCodeAt(i+1);
        c3 = utftext.charCodeAt(i+2);
        string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
        i += 3;
      }
    }
    return string;
  }

  // Messages
  !function (callbacks) {
    opera.extension.onmessage = function (e) {
      var message = e.data;
      if (message.cmd === 'Callback') {
        var func = callbacks[message.cmdFor];
        func && func(message.data);
      } else if (message.cmd === 'HttpRequested') {
        var req = comm.requests[message.data.id];
        req && req.callback(message.data);
      } else if (message.cmd === 'GetPopup') {
        var data = {
          menus: menus,
          ids: ids,
          url: window.location.href,
        };
        if (badge.ready) data.badge = badge.number;
        opera.extension.postMessage({
          cmd: 'SetPopup',
          data: data,
        });
      } else if (~[
        'Command',
        'UpdateValues',
      ].indexOf(message.cmd)) {
        comm.handleR(message);
      }
    };
  }({
    GetInjected: function (data) {
      loadScript(data);
    },
    GetRequestId: function (id) {
      comm.qrequests.shift().start(id);
    },
  });

  /**
   * @desc Wrap methods to prevent unexpected modifications.
   */
  function getWrapper() {
    // http://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects
    // http://developer.mozilla.org/docs/Web/API/Window
    var comm = this;
    var wrapper = {};
    // `eval` should be called directly so that it is run in current scope
    wrapper.eval = eval;
    // Wrap methods
    comm.forEach([
      // 'uneval',
      'isFinite',
      'isNaN',
      'parseFloat',
      'parseInt',
      'decodeURI',
      'decodeURIComponent',
      'encodeURI',
      'encodeURIComponent',

      'addEventListener',
      'alert',
      'atob',
      'blur',
      'btoa',
      'clearInterval',
      'clearTimeout',
      'close',
      'confirm',
      'dispatchEvent',
      'fetch',
      'find',
      'focus',
      'getComputedStyle',
      'getSelection',
      'matchMedia',
      'moveBy',
      'moveTo',
      'open',
      'openDialog',
      'postMessage',
      'print',
      'prompt',
      'requestAnimationFrame',
      'removeEventListener',
      'resizeBy',
      'resizeTo',
      'scroll',
      'scrollBy',
      'scrollByLines',
      'scrollByPages',
      'scrollTo',
      'setInterval',
      'setTimeout',
      'stop',
    ], function (name) {
      var method = window[name];
      if (method) wrapper[name] = function () {
        return method.apply(window, arguments);
      };
    });
    // Wrap properties
    comm.forEach(comm.props, function (name) {
      if (wrapper[name]) return;
      var modified = false;
      var value;
      Object.defineProperty(wrapper, name, {
        get: function () {
          if (!modified) value = window[name];
          return value === window ? wrapper : value;
        },
        set: function (val) {
          modified = true;
          value = val;
        },
      });
    });
    return wrapper;
  }

  // Communicator
  var comm = {
    state: 0,
    utf8decode: utf8decode,
    getUniqId: _.getUniqId,

    // Array functions
    // to avoid using prototype functions
    // since they may be changed by page scripts
    includes: _.includes,
    forEach: _.forEach,
    props: Object.getOwnPropertyNames(window),

    init: function() {
      var comm = this;
      comm.load = comm.checkLoad = function(){};
    },
    handleR: function(obj) {
      var comm = this;
      var maps = {
        LoadScript: comm.loadScript.bind(comm),
        Command: function (data) {
          var func = comm.command[data];
          if(func) func();
        },
        HttpRequested: function (r) {
          var req = comm.requests[r.id];
          if (req) req.callback(r);
        },
        UpdateValues: function (data) {
          var values = comm.values;
          if (values && values[data.uri]) values[data.uri] = data.values;
        },
      };
      var func = maps[obj.cmd];
      if (func) func(obj.data);
    },
    runCode: function(name, func, wrapper) {
      try {
        func.call(wrapper.window || wrapper, wrapper);
      } catch (e) {
        var msg = 'Error running script: ' + name + '\n' + e;
        if (e.message) msg += '\n' + e.message;
        console.error(msg);
      }
    },
    initRequest: function() {
      // request functions
      function reqAbort(){
        opera.extension.postMessage({cmd: 'AbortRequest', data: this.id});
      }

      // request object functions
      function callback(req) {
        var t = this;
        var cb = t.details['on' + req.type];
        if (cb) {
          if(req.data.response) {
            if(!t.data.length) {
              if(req.resType) { // blob or arraybuffer
                var m = req.data.response.match(/^data:(.*?);base64,(.*)$/);
                if (!m) req.data.response = null;
                else {
                  var b = window.atob(m[2]);
                  if(t.details.responseType == 'blob')
                    t.data.push(new Blob([b], {type: m[1]}));
                  else {  // arraybuffer
                    m = new Uint8Array(b.length);
                    for(var i = 0; i < b.length; i ++) m[i] = b.charCodeAt(i);
                    t.data.push(m.buffer);
                  }
                }
              } else if(t.details.responseType == 'json') // json
                t.data.push(JSON.parse(req.data.response));
              else  // text
                t.data.push(req.data.response);
            }
            req.data.response = t.data[0];
          }
          cb(req.data);
        }
        if (req.type == 'loadend') delete comm.requests[t.id];
      }
      function start(id) {
        var t = this;
        var data = {
          id: id,
          method: t.details.method,
          url: t.details.url,
          data: t.details.data,
          //async: !t.details.synchronous,
          user: t.details.user,
          password: t.details.password,
          headers: t.details.headers,
          overrideMimeType: t.details.overrideMimeType,
        };
        t.id = id;
        comm.requests[id] = t;
        if(comm.includes(['arraybuffer', 'blob'], t.details.responseType))
          data.responseType = 'blob';
        opera.extension.postMessage({cmd: 'HttpRequest', data: data});
      }
      function getFullUrl(url) {
        var a = document.createElement('a');
        a.setAttribute('href', url);
        return a.href;
      }

      var comm = this;
      comm.requests = {};
      comm.qrequests = [];
      comm.Request = function(details) {
        var t = {
          details: details,
          callback: callback,
          start: start,
          req: {
            abort: reqAbort,
          },
          data: [],
        };
        details.url = getFullUrl(details.url);
        comm.qrequests.push(t);
        opera.extension.postMessage({cmd: 'GetRequestId'});
        return t.req;
      };
    },
    getWrapper: getWrapper,
    wrapGM: function(script, cache) {
      function getValues() {
        return comm.values[script.uri];
      }
      function propertyToString() {
        return '[Violentmonkey property]';
      }
      function addProperty(name, prop, obj) {
        if('value' in prop) prop.writable = false;
        prop.configurable = false;
        Object.defineProperty(obj, name, prop);
        if (typeof obj[name] == 'function')
          obj[name].toString = propertyToString;
      }
      function saveValues() {
        opera.extension.postMessage({
          cmd: 'SetValue',
          data: {
            uri: script.uri,
            values: getValues(),
          },
        });
      }
      // Add GM functions
      // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
      var comm = this;
      var gm = {};
      var grant = script.meta.grant || [];
      var urls = {};
      if (!grant.length || grant.length == 1 && grant[0] == 'none') {
        // @grant none
        grant.pop();
      } else {
        gm['window'] = comm.getWrapper();
      }
      if(!comm.includes(grant, 'unsafeWindow')) grant.push('unsafeWindow');
      if(!comm.includes(grant, 'GM_info')) grant.push('GM_info');
      var resources = script.meta.resources || {};
      var gm_funcs = {
        unsafeWindow: {value: window},
        GM_info: {
          get: function () {
            var m = script.code.match(/\/\/\s+==UserScript==\s+([\s\S]*?)\/\/\s+==\/UserScript==\s/);
            var data = {
              description: script.meta.description || '',
              excludes: script.meta.exclude.concat(),
              includes: script.meta.include.concat(),
              matches: script.meta.match.concat(),
              name: script.meta.name || '',
              namespace: script.meta.namespace || '',
              resources: {},
              'run-at': script.meta['run-at'] || '',
              unwrap: false,
              version: script.meta.version || '',
            };
            var obj = {};
            addProperty('scriptMetaStr', {value: m ? m[1] : ''}, obj);

            // whether update is allowed
            addProperty('scriptWillUpdate', {value: !!script.update}, obj);

            // Violentmonkey specific data
            addProperty('version', {value: comm.version}, obj);
            addProperty('scriptHandler', {value: 'Violentmonkey'}, obj);

            // script object
            addProperty('script', {value:{}}, obj);
            var i;
            for(i in data) {
              addProperty(i, {value: data[i]}, obj.script);
            }
            for(i in script.meta.resources)
              addProperty(i, {value: script.meta.resources[i]}, obj.script.resources);

            return obj;
          },
        },
        GM_deleteValue: {
          value: function (key) {
            var values = getValues();
            delete values[key];
            saveValues();
          },
        },
        GM_getValue: {
          value: function(key, val) {
            var values = getValues();
            var v = values[key];
            if (v) {
              var type = v[0];
              v = v.slice(1);
              switch(type) {
                case 'n':
                  val = Number(v);
                  break;
                case 'b':
                  val = v == 'true';
                  break;
                case 'o':
                  try {
                    val = JSON.parse(v);
                  } catch(e) {
                    console.warn(e);
                  }
                  break;
                default:
                  val = v;
              }
            }
            return val;
          },
        },
        GM_listValues: {
          value: function () {
            return Object.getOwnPropertyNames(getValues());
          },
        },
        GM_setValue: {
          value: function (key, val) {
            var type = (typeof val)[0];
            switch(type) {
              case 'o':
                val = type + JSON.stringify(val);
                break;
              default:
                val = type + val;
            }
            var values = getValues();
            values[key] = val;
            saveValues();
          },
        },
        GM_getResourceText: {
          value: function (name) {
            for(var i in resources) if (name == i) {
              var text = cache[resources[i]];
              if (text) text = comm.utf8decode(window.atob(text));
              return text;
            }
          },
        },
        GM_getResourceURL: {
          value: function (name) {
            for (var i in resources) if (name == i) {
              i = resources[i];
              var url = urls[i];
              if (!url) {
                var cc = cache[i];
                if (cc) {
                  url = urls[i] = 'data:text/plain,' + cc;
                }
              }
            }
            return url;
          }
        },
        GM_addStyle: {
          value: function (css) {
            if (document.head) {
              var style = document.createElement('style');
              style.innerHTML = css;
              document.head.appendChild(style);
              return style;
            }
          },
        },
        GM_log: {
          /* eslint-disable no-console */
          value: function (data) {console.log(data);},
          /* eslint-enable no-console */
        },
        GM_openInTab: {
          value: function (url) {
            var a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.click();
          },
        },
        GM_registerMenuCommand: {
          value: function (cap, func, acc) {
            comm.command[cap] = func;
            if (window.top === window) menus.push([cap, acc]);
            getPopup();
          },
        },
        GM_xmlhttpRequest: {
          value: function (details) {
            if(!comm.Request) comm.initRequest();
            return comm.Request(details);
          },
        },
      };
      comm.forEach(grant, function (name) {
        var prop = gm_funcs[name];
        if(prop) addProperty(name, prop, gm);
      });
      return gm;
    },
    loadScript: function (data) {
      function buildCode(script) {
        var require = script.meta.require || [];
        var wrapper = comm.wrapGM(script, data.cache);
        var code = [];
        var part;
        comm.forEach(Object.getOwnPropertyNames(wrapper), function(name) {
          code.push(name + '=this["' + name + '"]=g["' + name + '"]');
        });
        if (code.length) {
          // In Opera Presto, the top level context is an isolated object
          // instead of `window`, consequently top level objects such as
          // `location` and `XMLHttpRequest` will be undefined unless prefixed
          // with `window.`. Another way to solve this is to add `window` to
          // the scope chain by using `with (window)`.
          code = ['var ' + code.join(',') + ';delete g;with(window)with(this)!function(){'];
        } else {
          code = [];
        }
        for(var i = 0; i < require.length; i ++)
          if((part = data.require[require[i]])) code.push(part);
        // wrap code to make 'use strict' work
        code.push('!function(){' + script.code + '\n}.call(this)');
        code.push('}.call(this);');
        code = code.join('\n');
        var name = script.custom.name || script.meta.name || script.id;
        // normal injection
        try {
          // In content page of Opera Presto, the top level Window-like object
          // `this` is different from `window`. In order to build the function
          // with prototypes from `window`, we MUST use `window.Function`
          // instead of `Function`.
          var func = new window.Function('g', code);
        } catch(e) {
          console.error('Syntax error in script: ' + name + '\n' + e.message);
          return;
        }
        comm.runCode(name, func, wrapper);
      }
      function run(list) {
        while (list.length) buildCode(list.shift());
      }
      var comm = this;
      var start = [];
      var idle = [];
      var end = [];
      comm.command = {};
      comm.version = data.version;
      comm.values = {};
      // reset load and checkLoad
      comm.load = function() {
        run(end);
        setTimeout(function() {
          run(idle);
        }, 0);
      };
      comm.checkLoad = function() {
        if (!comm.state && comm.includes(['interactive', 'complete'], document.readyState))
          comm.state = 1;
        if (comm.state) comm.load();
      };
      comm.forEach(data.scripts, function(script) {
        comm.values[script.uri] = data.values[script.uri] || {};
        var list;
        if(script && script.enabled) {
          switch (script.custom['run-at'] || script.meta['run-at']) {
            case 'document-start':
              list = start;
              break;
            case 'document-idle':
              list = idle;
              break;
            default:
              list = end;
          }
          list.push(script);
        }
      });
      run(start);
      comm.checkLoad();
      document.addEventListener('DOMContentLoaded', comm.checkLoad, false);
    },
  };

  var menus = [];
  var ids = [];
  var badge = {
    number: 0,
    ready: false,
  };
  function getPopup() {
    opera.extension.postMessage({cmd: 'GetPopup'});
  }
  function loadScript(data) {
    data.scripts.forEach(function (script) {
      ids.push(script.id);
      if (script.enabled) badge.number ++;
    });
    comm.loadScript(data);
    badge.ready = true;
    getPopup();
  }
  comm.init();
  opera.extension.postMessage({
    cmd: 'GetInjected',
    data: window.location.href,
  });

}(window);
