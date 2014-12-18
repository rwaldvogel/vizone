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
                class: 'Node-store',
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
              }
            };

            var parentObj = {
              title: viewInfo.fnName,
              sourceLink: {
                label: viewInfo.fnName,
                url: viewInfo.location
              }
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
        class: 'Node-action'
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