if (!window.zone) {
(function(){

'use strict';


function Zone(parentZone, data) {
  var zone = (arguments.length) ? Object.create(parentZone) : this;

  zone.parent = parentZone;

  Object.keys(data || {}).forEach(function(property) {

    var _property = property.substr(1);

    // augment the new zone with a hook decorates the parent's hook
    if (property[0] === '$') {
      zone[_property] = data[property](parentZone[_property] || function () {});

    // augment the new zone with a hook that runs after the parent's hook
    } else if (property[0] === '+') {
      if (parentZone[_property]) {
        zone[_property] = function () {
          var result = parentZone[_property].apply(this, arguments);
          data[property].apply(this, arguments);
          return result;
        };
      } else {
        zone[_property] = data[property];
      }

    // augment the new zone with a hook that runs before the parent's hook
    } else if (property[0] === '-') {
      if (parentZone[_property]) {
        zone[_property] = function () {
          data[property].apply(this, arguments);
          return parentZone[_property].apply(this, arguments);
        };
      } else {
        zone[_property] = data[property];
      }

    // set the new zone's hook (replacing the parent zone's)
    } else {
      zone[property] = (typeof data[property] === 'object') ?
                        JSON.parse(JSON.stringify(data[property])) :
                        data[property];
    }
  });

  return zone;
}


Zone.prototype = {
  constructor: Zone,

  fork: function (locals) {
    this.onZoneCreated();
    return new Zone(this, locals);
  },

  bind: function (fn, skipEnqueue) {
    skipEnqueue || this.enqueueTask(fn);
    var zone = this.fork();
    return function zoneBoundFn() {
      return zone.run(fn, this, arguments);
    };
  },

  bindOnce: function (fn) {
    var boundZone = this;
    return this.bind(function () {
      var result = fn.apply(this, arguments);
      boundZone.dequeueTask(fn);
      return result;
    });
  },

  run: function run (fn, applyTo, applyWith) {
    applyWith = applyWith || [];

    var oldZone = window.zone,
        result;

    window.zone = this;

    try {
      this.beforeTask();
      result = fn.apply(applyTo, applyWith);
    } catch (e) {
      if (zone.onError) {
        zone.onError(e);
      } else {
        throw e;
      }
    } finally {
      this.afterTask();
      window.zone = oldZone;
    }
    return result;
  },

  beforeTask: function () {},
  onZoneCreated: function () {},
  afterTask: function () {},
  enqueueTask: function () {},
  dequeueTask: function () {}
};


Zone.patchSetClearFn = function (obj, fnNames) {
  fnNames.map(function (name) {
    return name[0].toUpperCase() + name.substr(1);
  }).
  forEach(function (name) {
    var setName = 'set' + name;
    var clearName = 'clear' + name;
    var delegate = obj[setName];

    if (delegate) {
      var ids = {};

      if (setName === 'setInterval') {
        zone[setName] = function (fn) {
          var id;
          arguments[0] = function () {
            delete ids[id];
            return fn.apply(this, arguments);
          };
          var args = Zone.bindArguments(arguments);
          id = delegate.apply(obj, args);
          ids[id] = true;
          return id;
        };
      } else {
        zone[setName] = function (fn) {
          var id;
          arguments[0] = function () {
            delete ids[id];
            return fn.apply(this, arguments);
          };
          var args = Zone.bindArgumentsOnce(arguments);
          id = delegate.apply(obj, args);
          ids[id] = true;
          return id;
        };
      }


      obj[setName] = function () {
        return zone[setName].apply(this, arguments);
      };

      var clearDelegate = obj[clearName];

      zone[clearName] = function (id) {
        if (ids[id]) {
          delete ids[id];
          zone.dequeueTask();
        }
        return clearDelegate.apply(this, arguments);
      };

      obj[clearName] = function () {
        return zone[clearName].apply(this, arguments);
      };
    }
  });
};


Zone.patchSetFn = function (obj, fnNames) {
  fnNames.forEach(function (name) {
    var delegate = obj[name];

    if (delegate) {
      zone[name] = function (fn) {
        arguments[0] = function () {
          return fn.apply(this, arguments);
        };
        var args = Zone.bindArgumentsOnce(arguments);
        return delegate.apply(obj, args);
      };

      obj[name] = function () {
        return zone[name].apply(this, arguments);
      };
    }
  });
};

Zone.patchPrototype = function (obj, fnNames) {
  fnNames.forEach(function (name) {
    var delegate = obj[name];
    if (delegate) {
      obj[name] = function () {
        return delegate.apply(this, Zone.bindArguments(arguments));
      };
    }
  });
};

Zone.bindArguments = function (args) {
  for (var i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === 'function') {
      args[i] = zone.bind(args[i]);
    }
  }
  return args;
};


Zone.bindArgumentsOnce = function (args) {
  for (var i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === 'function') {
      args[i] = zone.bindOnce(args[i]);
    }
  }
  return args;
};

Zone.patchableFn = function (obj, fnNames) {
  fnNames.forEach(function (name) {
    var delegate = obj[name];
    zone[name] = function () {
      return delegate.apply(obj, arguments);
    };

    obj[name] = function () {
      return zone[name].apply(this, arguments);
    };
  });
};

Zone.patchProperty = function (obj, prop) {
  var desc = Object.getOwnPropertyDescriptor(obj, prop) || {
    enumerable: true,
    configurable: true
  };

  // A property descriptor cannot have getter/setter and be writable
  // deleting the writable and value properties avoids this error:
  //
  // TypeError: property descriptors must not specify a value or be writable when a
  // getter or setter has been specified
  delete desc.writable;
  delete desc.value;

  // substr(2) cuz 'onclick' -> 'click', etc
  var eventName = prop.substr(2);
  var _prop = '_' + prop;

  desc.set = function (fn) {
    if (this[_prop]) {
      this.removeEventListener(eventName, this[_prop]);
    }

    if (typeof fn === 'function') {
      this[_prop] = fn;
      this.addEventListener(eventName, fn, false);
    } else {
      this[_prop] = null;
    }
  };

  desc.get = function () {
    return this[_prop];
  };

  Object.defineProperty(obj, prop, desc);
};

Zone.patchProperties = function (obj, properties) {

  (properties || (function () {
      var props = [];
      for (var prop in obj) {
        props.push(prop);
      }
      return props;
    }()).
    filter(function (propertyName) {
      return propertyName.substr(0,2) === 'on';
    })).
    forEach(function (eventName) {
      Zone.patchProperty(obj, eventName);
    });
};

Zone.patchEventTargetMethods = function (obj) {
  var addDelegate = obj.addEventListener;
  obj.addEventListener = function (eventName, fn) {
    arguments[1] = fn._bound = zone.bind(fn);
    return addDelegate.apply(this, arguments);
  };

  var removeDelegate = obj.removeEventListener;
  obj.removeEventListener = function (eventName, fn) {
    arguments[1] = arguments[1]._bound || arguments[1];
    var result = removeDelegate.apply(this, arguments);
    zone.dequeueTask(fn);
    return result;
  };
};

Zone.patch = function patch () {
  Zone.patchSetClearFn(window, [
    'timeout',
    'interval',
    'immediate'
  ]);

  Zone.patchSetFn(window, [
    'requestAnimationFrame',
    'mozRequestAnimationFrame',
    'webkitRequestAnimationFrame'
  ]);

  Zone.patchableFn(window, ['alert', 'prompt']);

  // patched properties depend on addEventListener, so this needs to come first
  if (window.EventTarget) {
    Zone.patchEventTargetMethods(window.EventTarget.prototype);

  // Note: EventTarget is not available in all browsers,
  // if it's not available, we instead patch the APIs in the IDL that inherit from EventTarget
  } else {
    [ 'ApplicationCache',
      'EventSource',
      'FileReader',
      'InputMethodContext',
      'MediaController',
      'MessagePort',
      'Node',
      'Performance',
      'SVGElementInstance',
      'SharedWorker',
      'TextTrack',
      'TextTrackCue',
      'TextTrackList',
      'WebKitNamedFlow',
      'Window',
      'Worker',
      'WorkerGlobalScope',
      'XMLHttpRequestEventTarget',
      'XMLHttpRequestUpload'
    ].
    filter(function (thing) {
      return window[thing];
    }).
    map(function (thing) {
      return window[thing].prototype;
    }).
    forEach(Zone.patchEventTargetMethods);
  }

  if (Zone.canPatchViaPropertyDescriptor()) {
    Zone.patchViaPropertyDescriptor();
  } else {
    Zone.patchViaCapturingAllTheEvents();
    Zone.patchClass('XMLHttpRequest');
  }

  // patch promises
  if (window.Promise) {
    Zone.patchPrototype(Promise.prototype, [
      'then',
      'catch'
    ]);
  }
  Zone.patchMutationObserverClass('MutationObserver');
  Zone.patchMutationObserverClass('WebKitMutationObserver');
  Zone.patchDefineProperty();
  Zone.patchRegisterElement();
};

//
Zone.canPatchViaPropertyDescriptor = function () {
  Object.defineProperty(HTMLElement.prototype, 'onclick', {
    get: function () {
      return true;
    }
  });
  var elt = document.createElement('div');
  var result = !!elt.onclick;
  Object.defineProperty(HTMLElement.prototype, 'onclick', {});
  return result;
};

// for browsers that we can patch the descriptor:
// - eventually Chrome once this bug gets resolved
// - Firefox
Zone.patchViaPropertyDescriptor = function () {
  Zone.patchProperties(HTMLElement.prototype, Zone.onEventNames);
  Zone.patchProperties(XMLHttpRequest.prototype);
};

// Whenever any event fires, we check the event target and all parents
// for `onwhatever` properties and replace them with zone-bound functions
// - Chrome (for now)
Zone.patchViaCapturingAllTheEvents = function () {
  Zone.eventNames.forEach(function (property) {
    var onproperty = 'on' + property;
    document.addEventListener(property, function (event) {
      var elt = event.target, bound;
      while (elt) {
        if (elt[onproperty] && !elt[onproperty]._unbound) {
          bound = zone.bind(elt[onproperty]);
          bound._unbound = elt[onproperty];
          elt[onproperty] = bound;
        }
        elt = elt.parentElement;
      }
    }, true);
  });
};

// wrap some native API on `window`
Zone.patchClass = function (className) {
  var OriginalClass = window[className];
  if (!OriginalClass) {
    return;
  }
  window[className] = function () {
    var a = Zone.bindArguments(arguments);
    switch (a.length) {
      case 0: this._o = new OriginalClass(); break;
      case 1: this._o = new OriginalClass(a[0]); break;
      case 2: this._o = new OriginalClass(a[0], a[1]); break;
      case 3: this._o = new OriginalClass(a[0], a[1], a[2]); break;
      case 4: this._o = new OriginalClass(a[0], a[1], a[2], a[3]); break;
      default: throw new Error('what are you even doing?');
    }
  };

  var instance = new OriginalClass(className.substr(-16) === 'MutationObserver' ? function () {} : undefined);

  var prop;
  for (prop in instance) {
    (function (prop) {
      if (typeof instance[prop] === 'function') {
        window[className].prototype[prop] = function () {
          return this._o[prop].apply(this._o, arguments);
        };
      } else {
        Object.defineProperty(window[className].prototype, prop, {
          set: function (fn) {
            if (typeof fn === 'function') {
              this._o[prop] = zone.bind(fn);
            } else {
              this._o[prop] = fn;
            }
          },
          get: function () {
            return this._o[prop];
          }
        });
      }
    }(prop));
  };
};

// wrap some native API on `window`
Zone.patchMutationObserverClass = function (className) {
  var OriginalClass = window[className];
  if (!OriginalClass) {
    return;
  }
  window[className] = function (fn) {
    this._o = new OriginalClass(zone.bind(fn, true));
  };

  var instance = new OriginalClass(function () {});

  window[className].prototype.disconnect = function () {
    var result = this._o.disconnect.apply(this._o, arguments);
    this._active && zone.dequeueTask();
    this._active = false;
    return result;
  };

  window[className].prototype.observe = function () {
    if (!this._active) {
      zone.enqueueTask();
    }
    this._active = true;
    return this._o.observe.apply(this._o, arguments);
  };

  var prop;
  for (prop in instance) {
    (function (prop) {
      if (typeof window[className].prototype !== undefined) {
        return;
      }
      if (typeof instance[prop] === 'function') {
        window[className].prototype[prop] = function () {
          return this._o[prop].apply(this._o, arguments);
        };
      } else {
        Object.defineProperty(window[className].prototype, prop, {
          set: function (fn) {
            if (typeof fn === 'function') {
              this._o[prop] = zone.bind(fn);
            } else {
              this._o[prop] = fn;
            }
          },
          get: function () {
            return this._o[prop];
          }
        });
      }
    }(prop));
  }
};

// might need similar for object.freeze
// i regret nothing
Zone.patchDefineProperty = function () {
  var _defineProperty = Object.defineProperty;
  var _getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  var _create = Object.create;

  Object.defineProperty = function (obj, prop, desc) {
    if (isUnconfigurable(obj, prop)) {
      throw new TypeError('Cannot assign to read only property \'' + prop + '\' of ' + obj);
    }
    if (prop !== 'prototype') {
      desc = rewriteDescriptor(obj, prop, desc);
    }
    return _defineProperty(obj, prop, desc);
  };

  Object.defineProperties = function (obj, props) {
    Object.keys(props).forEach(function (prop) {
      Object.defineProperty(obj, prop, props[prop]);
    });
    return obj;
  };

  Object.create = function (obj, proto) {
    if (typeof proto === 'object') {
      Object.keys(proto).forEach(function (prop) {
        proto[prop] = rewriteDescriptor(obj, prop, proto[prop]);
      });
    }
    return _create(obj, proto);
  };

  Object.getOwnPropertyDescriptor = function (obj, prop) {
    var desc = _getOwnPropertyDescriptor(obj, prop);
    if (isUnconfigurable(obj, prop)) {
      desc.configurable = false;
    }
    return desc;
  };

  Zone._redefineProperty = function (obj, prop, desc) {
    desc = rewriteDescriptor(obj, prop, desc);
    return _defineProperty(obj, prop, desc);
  };

  function isUnconfigurable (obj, prop) {
    return obj && obj.__unconfigurables && obj.__unconfigurables[prop];
  }

  function rewriteDescriptor (obj, prop, desc) {
    desc.configurable = true;
    if (!desc.configurable) {
      if (!obj.__unconfigurables) {
        _defineProperty(obj, '__unconfigurables', { writable: true, value: {} });
      }
      obj.__unconfigurables[prop] = true;
    }
    return desc;
  }
};

Zone.patchRegisterElement = function () {
  if (!('registerElement' in document)) {
    return;
  }
  var _registerElement = document.registerElement;
  var callbacks = [
    'createdCallback',
    'attachedCallback',
    'detachedCallback',
    'attributeChangedCallback'
  ];
  document.registerElement = function (name, opts) {
    callbacks.forEach(function (callback) {
      if (opts.prototype[callback]) {
        var descriptor = Object.getOwnPropertyDescriptor(opts.prototype, callback);
        if (descriptor.value) {
          descriptor.value = zone.bind(descriptor.value || opts.prototype[callback]);
          Zone._redefineProperty(opts.prototype, callback, descriptor);
        }
      }
    });
    return _registerElement.apply(document, [name, opts]);
  };
}

Zone.eventNames = 'copy cut paste abort blur focus canplay canplaythrough change click contextmenu dblclick drag dragend dragenter dragleave dragover dragstart drop durationchange emptied ended input invalid keydown keypress keyup load loadeddata loadedmetadata loadstart mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup pause play playing progress ratechange reset scroll seeked seeking select show stalled submit suspend timeupdate volumechange waiting mozfullscreenchange mozfullscreenerror mozpointerlockchange mozpointerlockerror error webglcontextrestored webglcontextlost webglcontextcreationerror'.split(' ');
Zone.onEventNames = Zone.eventNames.map(function (property) {
  return 'on' + property;
});

Zone.init = function init () {
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = new Zone();
  } else {
    window.zone = new Zone();
  }
  Zone.patch();
};


Zone.init();


})();
}
(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

// patches should require vizone.js
// patches should fail silently if their host frameworks are missing
// patches should announce load success by printing colorful message to the console

require('./patches/simflux-viz');
},{"./patches/simflux-viz":2}],2:[function(require,module,exports){
if (window.simflux && window.simflux.history) return;  // prevent double-loading

var simflux = window.simflux || (typeof simflux !== 'undefined' ? simflux : (require.isDefined('simflux') && require('simflux')));

if (!simflux) return; // fail silently

var vizone = require('./../vizone');

var simfluxViz = function () {

  simflux.history = [];

  // make sure simflux is attached to window since by default it doesn't have to be
  window.simflux = simflux;

  //function warn() {
  //  var args = [
  //    '%c' + arguments[0],
  //    'color:darkorange'
  //  ].concat(Array.prototype.slice.call(arguments, 1));
  //
  //  // use console.error to get a proper stack trace
  //  console.error.apply(console, args);
  //}


  function patchDispatcher(dispatcher) {
    dispatcher.history = [];
  }

  function patchStore(dispatcher, store) {
    store.$$$stackInfo = parseStackLine2(store.$$$stack, '[store]');
    for (var a in store) {
      if (store.hasOwnProperty(a) && typeof store[a] === 'function') {
        (function(a, fn) {
          store[a] = function() {
            return vizone(
              Function.apply.bind(fn, this, Array.prototype.slice.call(arguments, 0)),
              {
                title: store.storeName,
                subtitle: a,
                class: 'Node--store',
                sourceLink: {
                  label: store.storeName,
                  url: store.$$$stackInfo.location
                }
              }
            );
          };
        })(a, store[a]);
      }
    }
  }

  function parseStackLine2(stack, defaultFnName) {

    var stackInfo = stack.match(/\n.+\n\s+at\s+(.+)\n/);
    stackInfo = stackInfo.length>1 ? stackInfo[1] : defaultFnName;
    stackInfo = stackInfo.match(/^(.+)\((.+)\)$/);

    return {
      fnName: stackInfo.length>1 ? stackInfo[1].trim() : defaultFnName,
      location: stackInfo.length>2 ? stackInfo[2] : ''
    };
  }

  function patchActionCreator(dispatcher, ac) {
    ac.$$$stackInfo = parseStackLine2(ac.$$$stack, '[actionCreator]');
    for (var a in ac) {
      if (ac.hasOwnProperty(a) && typeof ac[a] === 'function') {
        (function(pa, fn) {
          ac[pa] = function() {

            var stack = new Error().stack;
            //console.log("-->stack: ", stack);
            var viewInfo = parseStackLine2(stack, '[view]'),
                args = Array.prototype.slice.call(arguments, 0),
                acName = (ac.name || '[Action Creator]');

            var historyObj = {
              title: acName + '.<b>' + pa + '</b>',
              args: args,
              sourceLink: {
                label: acName,
                url: ac.$$$stackInfo.location
              },
              class: 'Node--actionCreator'
            };

            var parentObj = {
              title: viewInfo.fnName,
              sourceLink: {
                label: viewInfo.fnName,
                url: viewInfo.location
              },
              class: 'Node--actionOriginator'
            };

            return vizone(Function.apply.bind(fn, this, args), historyObj, parentObj);
          };
        })(a, ac[a]);
      }
    }
  }

  // when simflux-viz is loaded, immediately patch any existing
  // dispatchers, stores, and action creators
  simflux.dispatchers.forEach(function (dispatcher) {
    patchDispatcher(dispatcher);

    // monkey patch stores
    dispatcher.stores.forEach(function (store) {
      patchStore(dispatcher, store);
    });

    // monkey patch action creators
    dispatcher.actionCreators.forEach(function (ac) {
      patchActionCreator(dispatcher, ac);
    });

  });

  var odispatch = simflux.Dispatcher.prototype.dispatch;
  simflux.Dispatcher.prototype.dispatch = function(action) {
    return vizone(
      Function.apply.bind(odispatch, this, Array.prototype.slice.call(arguments, 0)),
      {
        title: action,
        args: Array.prototype.slice.call(arguments, 1),
        class: 'Node--action'
      }
    );
  };

  var oregisterActionCreator = simflux.Dispatcher.prototype.registerActionCreator;
  simflux.Dispatcher.prototype.registerActionCreator = function(ac) {
    var r = oregisterActionCreator.apply(this, Array.prototype.slice.call(arguments, 0));
    patchActionCreator(this, ac);
    return r;
  };

  var oregisterStore = simflux.Dispatcher.prototype.registerStore;
  simflux.Dispatcher.prototype.registerStore = function(store) {
    var r = oregisterStore.apply(this, Array.prototype.slice.call(arguments, 0));
    patchStore(this, store);
    return r;
  };

  var oinstantiateDispatcher = simflux.instantiateDispatcher;
  simflux.instantiateDispatcher = function(name) {
    var d = oinstantiateDispatcher.apply(this, Array.prototype.slice.call(arguments, 0));
    patchDispatcher(d);
    return d;
  };

  console.log("%csimflux-viz loaded", "color:white; background-color:orange; font-size: 14pt; border-radius:8px; padding: 0 10px; font-family:Verdana;");
};

simfluxViz();
},{"./../vizone":4,"simflux":"simflux"}],3:[function(require,module,exports){
'use strict';

var contEl, historyMax = 1000, historyCount = 0;

function initHistoryGraph() {
  if (!contEl) {
    contEl = document.createElement("div");
    contEl.id = "vizone";
    contEl.style.display = 'none';
    document.body.appendChild(contEl);
  }
}

function appendToHistoryGraph(historyObj, newItem) {
  var id = 'vizone-'+historyCount;

  var el = document.createElement('pre');
  el.id = id;
  el.innerText = JSON.stringify(newItem);
  contEl.appendChild(el);

  // remove oldest graph if reached buffer limit
  if (historyCount >= historyMax) {
    el = document.getElementById('vizone-'+(historyCount-historyMax));
    if (el) {
      contEl.removeChild(el);
    }
  }

  historyCount++;
}

module.exports = {
  appendToHistoryGraph: appendToHistoryGraph,
  initHistoryGraph: initHistoryGraph
};
},{}],4:[function(require,module,exports){
var vizoneDOM = require('./vizone-dom');

vizoneDOM.initHistoryGraph();

// Calling vizone will append an item to the application
// flow tree
// (An item describes an application flow occurrence)
//
// fn (optional) will be called and its result returned
// A forked zone is created to execute fn()
// If a falsey value is provided in place of fn,
// then newItem is guaranteed to be a leaf
//
// Assuming fn is provided...
// We append newItem to history, and then create
// a forked zone in which to execute fn()
// By recursively creating forked zones we build
// the tree of application flow
//
// parentItem is optional: it will additionally insert an item
// as the only parent of newItem
//
// forceRoot will make this occurrence a root node even
// if it would have had a parent node under normal circumstances.
// Note that if parentItem is supplied, then it will be the root,
// and newItem will be the only child of parentItem.
function vizone(fn, newItem, parentItem, forceRoot) {
  if (parentItem) {
    return vizone(vizone.bind(null, fn, newItem), parentItem);
  }

  var zone = window.zone;

  if (forceRoot && zone.historyObj) {
    zone.fork().run(vizone.bind(null, fn, parentItem, newItem));
  }

  var historyObj = zone.historyObj || {
        items: []
      };

  if (zone.historyObj) {
    // child:
    // if we are inside of a viz-forked zone (a "leaf") then attach
    // this item to the tree

    newItem.$$$parent = zone.historyItem.$$$index;
    newItem.$$$zoneIndex = zone.historyObj.zoneIndex;

  } else {
    // root:
    // if the current zone doesn't have a historyObj property,
    // this must be the root item

    zone.history = zone.history || [];
    newItem.$$$zoneIndex = historyObj.zoneIndex = zone.history.length;
    zone.history.push(historyObj);

  }

  // append item to the items array
  newItem.$$$index = historyObj.items.length;
  historyObj.items.push(newItem);

  vizoneDOM.appendToHistoryGraph(historyObj, newItem);

  if (fn) {
    var r,
      fz = window.zone.fork();

    fz.run(function() {
      fz.historyObj = historyObj;
      fz.historyItem = newItem;
      r = fn(); // this runs synchronously so r is always returned below
    });

    return r;
  }
}

module.exports = vizone;
},{"./vizone-dom":3}]},{},[1]);
