// The Module object: Our interface to the outside world. We import
// and export values on it, and do the work to get that through
// closure compiler if necessary. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to do an eval in order to handle the closure compiler
// case, where this code here is minified but Module was defined
// elsewhere (e.g. case 4 above). We also need to check if Module
// already exists (e.g. case 3 above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module;
if (!Module) Module = (typeof Module !== 'undefined' ? Module : null) || {};

// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
for (var key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

// The environment setup code below is customized to use Module.
// *** Environment setup code ***
var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;

// Three configurations we can be running in:
// 1) We could be the application main() thread running in the main JS UI thread. (ENVIRONMENT_IS_WORKER == false and ENVIRONMENT_IS_PTHREAD == false)
// 2) We could be the application main() thread proxied to worker. (with Emscripten -s PROXY_TO_WORKER=1) (ENVIRONMENT_IS_WORKER == true, ENVIRONMENT_IS_PTHREAD == false)
// 3) We could be an application pthread running in a worker. (ENVIRONMENT_IS_WORKER == true and ENVIRONMENT_IS_PTHREAD == true)

if (Module['ENVIRONMENT']) {
  if (Module['ENVIRONMENT'] === 'WEB') {
    ENVIRONMENT_IS_WEB = true;
  } else if (Module['ENVIRONMENT'] === 'WORKER') {
    ENVIRONMENT_IS_WORKER = true;
  } else if (Module['ENVIRONMENT'] === 'NODE') {
    ENVIRONMENT_IS_NODE = true;
  } else if (Module['ENVIRONMENT'] === 'SHELL') {
    ENVIRONMENT_IS_SHELL = true;
  } else {
    throw new Error('The provided Module[\'ENVIRONMENT\'] value is not valid. It must be one of: WEB|WORKER|NODE|SHELL.');
  }
} else {
  ENVIRONMENT_IS_WEB = typeof window === 'object';
  ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
  ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof require === 'function' && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
  ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;
}

var ENVIRONMENT_IS_PTHREAD;
if (!ENVIRONMENT_IS_PTHREAD) ENVIRONMENT_IS_PTHREAD = false; // ENVIRONMENT_IS_PTHREAD=true will have been preset in pthread-main.js. Make it false in the main runtime thread.
var PthreadWorkerInit; // Collects together variables that are needed at initialization time for the web workers that host pthreads.
if (!ENVIRONMENT_IS_PTHREAD) PthreadWorkerInit = {};
var currentScriptUrl = ENVIRONMENT_IS_WORKER ? undefined : document.currentScript.src;

if (ENVIRONMENT_IS_NODE) {
  // Expose functionality in the same simple way that the shells work
  // Note that we pollute the global namespace here, otherwise we break in node
  if (!Module['print']) Module['print'] = console.log;
  if (!Module['printErr']) Module['printErr'] = console.warn;

  var nodeFS;
  var nodePath;

  Module['read'] = function shell_read(filename, binary) {
    if (!nodeFS) nodeFS = require('fs');
    if (!nodePath) nodePath = require('path');
    filename = nodePath['normalize'](filename);
    var ret = nodeFS['readFileSync'](filename);
    return binary ? ret : ret.toString();
  };

  Module['readBinary'] = function readBinary(filename) {
    var ret = Module['read'](filename, true);
    if (!ret.buffer) {
      ret = new Uint8Array(ret);
    }
    assert(ret.buffer);
    return ret;
  };

  Module['load'] = function load(f) {
    globalEval(read(f));
  };

  if (!Module['thisProgram']) {
    if (process['argv'].length > 1) {
      Module['thisProgram'] = process['argv'][1].replace(/\\/g, '/');
    } else {
      Module['thisProgram'] = 'unknown-program';
    }
  }

  Module['arguments'] = process['argv'].slice(2);

  if (typeof module !== 'undefined') {
    module['exports'] = Module;
  }

  process['on']('uncaughtException', function(ex) {
    // suppress ExitStatus exceptions from showing an error
    if (!(ex instanceof ExitStatus)) {
      throw ex;
    }
  });

  Module['inspect'] = function () { return '[Emscripten Module object]'; };
}
else if (ENVIRONMENT_IS_SHELL) {
  if (!Module['print']) Module['print'] = print;
  if (typeof printErr != 'undefined') Module['printErr'] = printErr; // not present in v8 or older sm

  if (typeof read != 'undefined') {
    Module['read'] = read;
  } else {
    Module['read'] = function shell_read() { throw 'no read() available' };
  }

  Module['readBinary'] = function readBinary(f) {
    if (typeof readbuffer === 'function') {
      return new Uint8Array(readbuffer(f));
    }
    var data = read(f, 'binary');
    assert(typeof data === 'object');
    return data;
  };

  if (typeof scriptArgs != 'undefined') {
    Module['arguments'] = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }

  if (typeof quit === 'function') {
    Module['quit'] = function(status, toThrow) {
      quit(status);
    }
  }

}
else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  Module['read'] = function shell_read(url) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send(null);
    return xhr.responseText;
  };

  if (ENVIRONMENT_IS_WORKER) {
    Module['readBinary'] = function readBinary(url) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.responseType = 'arraybuffer';
      xhr.send(null);
      return new Uint8Array(xhr.response);
    };
  }

  Module['readAsync'] = function readAsync(url, onload, onerror) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function xhr_onload() {
      if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
        onload(xhr.response);
      } else {
        onerror();
      }
    };
    xhr.onerror = onerror;
    xhr.send(null);
  };

  if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }

  if (typeof console !== 'undefined') {
    if (!Module['print']) Module['print'] = function shell_print(x) {
      console.log(x);
    };
    if (!Module['printErr']) Module['printErr'] = function shell_printErr(x) {
      console.warn(x);
    };
  } else {
    // Probably a worker, and without console.log. We can do very little here...
    var TRY_USE_DUMP = false;
    if (!Module['print']) Module['print'] = (TRY_USE_DUMP && (typeof(dump) !== "undefined") ? (function(x) {
      dump(x);
    }) : (function(x) {
      // self.postMessage(x); // enable this if you want stdout to be sent as messages
    }));
  }

  if (ENVIRONMENT_IS_WORKER) {
    Module['load'] = importScripts;
  }

  if (typeof Module['setWindowTitle'] === 'undefined') {
    Module['setWindowTitle'] = function(title) { document.title = title };
  }
}
else {
  // Unreachable because SHELL is dependant on the others
  throw 'Unknown runtime environment. Where are we?';
}

function globalEval(x) {
  eval.call(null, x);
}
if (!Module['load'] && Module['read']) {
  Module['load'] = function load(f) {
    globalEval(Module['read'](f));
  };
}
if (!Module['print']) {
  Module['print'] = function(){};
}
if (!Module['printErr']) {
  Module['printErr'] = Module['print'];
}
if (!Module['arguments']) {
  Module['arguments'] = [];
}
if (!Module['thisProgram']) {
  Module['thisProgram'] = './this.program';
}
if (!Module['quit']) {
  Module['quit'] = function(status, toThrow) {
    throw toThrow;
  }
}

// *** Environment setup code ***

// Closure helpers
Module.print = Module['print'];
Module.printErr = Module['printErr'];

// Callbacks
Module['preRun'] = [];
Module['postRun'] = [];

// Merge back in the overrides
for (var key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = undefined;



// {{PREAMBLE_ADDITIONS}}

// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html

//========================================
// Runtime code shared with compiler
//========================================

var Runtime = {
  setTempRet0: function (value) {
    tempRet0 = value;
    return value;
  },
  getTempRet0: function () {
    return tempRet0;
  },
  stackSave: function () {
    return STACKTOP;
  },
  stackRestore: function (stackTop) {
    STACKTOP = stackTop;
  },
  getNativeTypeSize: function (type) {
    switch (type) {
      case 'i1': case 'i8': return 1;
      case 'i16': return 2;
      case 'i32': return 4;
      case 'i64': return 8;
      case 'float': return 4;
      case 'double': return 8;
      default: {
        if (type[type.length-1] === '*') {
          return Runtime.QUANTUM_SIZE; // A pointer
        } else if (type[0] === 'i') {
          var bits = parseInt(type.substr(1));
          assert(bits % 8 === 0);
          return bits/8;
        } else {
          return 0;
        }
      }
    }
  },
  getNativeFieldSize: function (type) {
    return Math.max(Runtime.getNativeTypeSize(type), Runtime.QUANTUM_SIZE);
  },
  STACK_ALIGN: 16,
  prepVararg: function (ptr, type) {
    if (type === 'double' || type === 'i64') {
      // move so the load is aligned
      if (ptr & 7) {
        assert((ptr & 7) === 4);
        ptr += 4;
      }
    } else {
      assert((ptr & 3) === 0);
    }
    return ptr;
  },
  getAlignSize: function (type, size, vararg) {
    // we align i64s and doubles on 64-bit boundaries, unlike x86
    if (!vararg && (type == 'i64' || type == 'double')) return 8;
    if (!type) return Math.min(size, 8); // align structures internally to 64 bits
    return Math.min(size || (type ? Runtime.getNativeFieldSize(type) : 0), Runtime.QUANTUM_SIZE);
  },
  dynCall: function (sig, ptr, args) {
    if (args && args.length) {
      assert(args.length == sig.length-1);
      assert(('dynCall_' + sig) in Module, 'bad function pointer type - no table for sig \'' + sig + '\'');
      return Module['dynCall_' + sig].apply(null, [ptr].concat(args));
    } else {
      assert(sig.length == 1);
      assert(('dynCall_' + sig) in Module, 'bad function pointer type - no table for sig \'' + sig + '\'');
      return Module['dynCall_' + sig].call(null, ptr);
    }
  },
  functionPointers: [],
  addFunction: function (func) {
    for (var i = 0; i < Runtime.functionPointers.length; i++) {
      if (!Runtime.functionPointers[i]) {
        Runtime.functionPointers[i] = func;
        return 2*(1 + i);
      }
    }
    throw 'Finished up all reserved function pointers. Use a higher value for RESERVED_FUNCTION_POINTERS.';
  },
  removeFunction: function (index) {
    Runtime.functionPointers[(index-2)/2] = null;
  },
  warnOnce: function (text) {
    if (!Runtime.warnOnce.shown) Runtime.warnOnce.shown = {};
    if (!Runtime.warnOnce.shown[text]) {
      Runtime.warnOnce.shown[text] = 1;
      Module.printErr(text);
    }
  },
  funcWrappers: {},
  getFuncWrapper: function (func, sig) {
    if (!func) return; // on null pointer, return undefined
    assert(sig);
    if (!Runtime.funcWrappers[sig]) {
      Runtime.funcWrappers[sig] = {};
    }
    var sigCache = Runtime.funcWrappers[sig];
    if (!sigCache[func]) {
      // optimize away arguments usage in common cases
      if (sig.length === 1) {
        sigCache[func] = function dynCall_wrapper() {
          return Runtime.dynCall(sig, func);
        };
      } else if (sig.length === 2) {
        sigCache[func] = function dynCall_wrapper(arg) {
          return Runtime.dynCall(sig, func, [arg]);
        };
      } else {
        // general case
        sigCache[func] = function dynCall_wrapper() {
          return Runtime.dynCall(sig, func, Array.prototype.slice.call(arguments));
        };
      }
    }
    return sigCache[func];
  },
  getCompilerSetting: function (name) {
    throw 'You must build with -s RETAIN_COMPILER_SETTINGS=1 for Runtime.getCompilerSetting or emscripten_get_compiler_setting to work';
  },
  stackAlloc: function (size) { var ret = STACKTOP;STACKTOP = (STACKTOP + size)|0;STACKTOP = (((STACKTOP)+15)&-16);(assert((((STACKTOP|0) < (STACK_MAX|0))|0))|0); return ret; },
  staticAlloc: function (size) { var ret = STATICTOP;STATICTOP = (STATICTOP + (assert(!staticSealed),size))|0;STATICTOP = (((STATICTOP)+15)&-16); return ret; },
  dynamicAlloc: function (size) { assert(DYNAMICTOP_PTR);var ret = HEAP32[DYNAMICTOP_PTR>>2];var end = (((ret + size + 15)|0) & -16);HEAP32[DYNAMICTOP_PTR>>2] = end;if (end >= TOTAL_MEMORY) {var success = enlargeMemory();if (!success) {HEAP32[DYNAMICTOP_PTR>>2] = ret;return 0;}}return ret;},
  alignMemory: function (size,quantum) { var ret = size = Math.ceil((size)/(quantum ? quantum : 16))*(quantum ? quantum : 16); return ret; },
  makeBigInt: function (low,high,unsigned) { var ret = (unsigned ? ((+((low>>>0)))+((+((high>>>0)))*4294967296.0)) : ((+((low>>>0)))+((+((high|0)))*4294967296.0))); return ret; },
  GLOBAL_BASE: 8,
  QUANTUM_SIZE: 4,
  __dummy__: 0
}



Module["Runtime"] = Runtime;



//========================================
// Runtime essentials
//========================================

var ABORT = 0; // whether we are quitting the application. no code should run after this. set in exit() and abort()
var EXITSTATUS = 0;

/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

var globalScope = this;

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  var func = Module['_' + ident]; // closure exported function
  if (!func) {
    try { func = eval('_' + ident); } catch(e) {}
  }
  assert(func, 'Cannot call unknown function ' + ident + ' (perhaps LLVM optimizations or closure removed it?)');
  return func;
}

var cwrap, ccall;
(function(){
  var JSfuncs = {
    // Helpers for cwrap -- it can't refer to Runtime directly because it might
    // be renamed by closure, instead it calls JSfuncs['stackSave'].body to find
    // out what the minified function name is.
    'stackSave': function() {
      Runtime.stackSave()
    },
    'stackRestore': function() {
      Runtime.stackRestore()
    },
    // type conversion from js to c
    'arrayToC' : function(arr) {
      var ret = Runtime.stackAlloc(arr.length);
      writeArrayToMemory(arr, ret);
      return ret;
    },
    'stringToC' : function(str) {
      var ret = 0;
      if (str !== null && str !== undefined && str !== 0) { // null string
        // at most 4 bytes per UTF-8 code point, +1 for the trailing '\0'
        var len = (str.length << 2) + 1;
        ret = Runtime.stackAlloc(len);
        stringToUTF8(str, ret, len);
      }
      return ret;
    }
  };
  // For fast lookup of conversion functions
  var toC = {'string' : JSfuncs['stringToC'], 'array' : JSfuncs['arrayToC']};

  // C calling interface.
  ccall = function ccallFunc(ident, returnType, argTypes, args, opts) {
    var func = getCFunc(ident);
    var cArgs = [];
    var stack = 0;
    assert(returnType !== 'array', 'Return type should not be "array".');
    if (args) {
      for (var i = 0; i < args.length; i++) {
        var converter = toC[argTypes[i]];
        if (converter) {
          if (stack === 0) stack = Runtime.stackSave();
          cArgs[i] = converter(args[i]);
        } else {
          cArgs[i] = args[i];
        }
      }
    }
    var ret = func.apply(null, cArgs);
    if ((!opts || !opts.async) && typeof EmterpreterAsync === 'object') {
      assert(!EmterpreterAsync.state, 'cannot start async op with normal JS calling ccall');
    }
    if (opts && opts.async) assert(!returnType, 'async ccalls cannot return values');
    if (returnType === 'string') ret = Pointer_stringify(ret);
    if (stack !== 0) {
      if (opts && opts.async) {
        EmterpreterAsync.asyncFinalizers.push(function() {
          Runtime.stackRestore(stack);
        });
        return;
      }
      Runtime.stackRestore(stack);
    }
    return ret;
  }

  var sourceRegex = /^function\s*[a-zA-Z$_0-9]*\s*\(([^)]*)\)\s*{\s*([^*]*?)[\s;]*(?:return\s*(.*?)[;\s]*)?}$/;
  function parseJSFunc(jsfunc) {
    // Match the body and the return value of a javascript function source
    var parsed = jsfunc.toString().match(sourceRegex).slice(1);
    return {arguments : parsed[0], body : parsed[1], returnValue: parsed[2]}
  }

  // sources of useful functions. we create this lazily as it can trigger a source decompression on this entire file
  var JSsource = null;
  function ensureJSsource() {
    if (!JSsource) {
      JSsource = {};
      for (var fun in JSfuncs) {
        if (JSfuncs.hasOwnProperty(fun)) {
          // Elements of toCsource are arrays of three items:
          // the code, and the return value
          JSsource[fun] = parseJSFunc(JSfuncs[fun]);
        }
      }
    }
  }

  cwrap = function cwrap(ident, returnType, argTypes) {
    argTypes = argTypes || [];
    var cfunc = getCFunc(ident);
    // When the function takes numbers and returns a number, we can just return
    // the original function
    var numericArgs = argTypes.every(function(type){ return type === 'number'});
    var numericRet = (returnType !== 'string');
    if ( numericRet && numericArgs) {
      return cfunc;
    }
    // Creation of the arguments list (["$1","$2",...,"$nargs"])
    var argNames = argTypes.map(function(x,i){return '$'+i});
    var funcstr = "(function(" + argNames.join(',') + ") {";
    var nargs = argTypes.length;
    if (!numericArgs) {
      // Generate the code needed to convert the arguments from javascript
      // values to pointers
      ensureJSsource();
      funcstr += 'var stack = ' + JSsource['stackSave'].body + ';';
      for (var i = 0; i < nargs; i++) {
        var arg = argNames[i], type = argTypes[i];
        if (type === 'number') continue;
        var convertCode = JSsource[type + 'ToC']; // [code, return]
        funcstr += 'var ' + convertCode.arguments + ' = ' + arg + ';';
        funcstr += convertCode.body + ';';
        funcstr += arg + '=(' + convertCode.returnValue + ');';
      }
    }

    // When the code is compressed, the name of cfunc is not literally 'cfunc' anymore
    var cfuncname = parseJSFunc(function(){return cfunc}).returnValue;
    // Call the function
    funcstr += 'var ret = ' + cfuncname + '(' + argNames.join(',') + ');';
    if (!numericRet) { // Return type can only by 'string' or 'number'
      // Convert the result to a string
      var strgfy = parseJSFunc(function(){return Pointer_stringify}).returnValue;
      funcstr += 'ret = ' + strgfy + '(ret);';
    }
    funcstr += "if (typeof EmterpreterAsync === 'object') { assert(!EmterpreterAsync.state, 'cannot start async op with normal JS calling cwrap') }";
    if (!numericArgs) {
      // If we had a stack, restore it
      ensureJSsource();
      funcstr += JSsource['stackRestore'].body.replace('()', '(stack)') + ';';
    }
    funcstr += 'return ret})';
    return eval(funcstr);
  };
})();
Module["ccall"] = ccall;
Module["cwrap"] = cwrap;

/** @type {function(number, number, string, boolean=)} */
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[((ptr)>>0)]=value; break;
      case 'i8': HEAP8[((ptr)>>0)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}
Module["setValue"] = setValue;

/** @type {function(number, string, boolean=)} */
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[((ptr)>>0)];
      case 'i8': return HEAP8[((ptr)>>0)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for setValue: ' + type);
    }
  return null;
}
Module["getValue"] = getValue;

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_STATIC = 2; // Cannot be freed
var ALLOC_DYNAMIC = 3; // Cannot be freed except through sbrk
var ALLOC_NONE = 4; // Do not allocate
Module["ALLOC_NORMAL"] = ALLOC_NORMAL;
Module["ALLOC_STACK"] = ALLOC_STACK;
Module["ALLOC_STATIC"] = ALLOC_STATIC;
Module["ALLOC_DYNAMIC"] = ALLOC_DYNAMIC;
Module["ALLOC_NONE"] = ALLOC_NONE;

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
/** @type {function((TypedArray|Array<number>|number), string, number, number=)} */
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [typeof _malloc === 'function' ? _malloc : Runtime.staticAlloc, Runtime.stackAlloc, Runtime.staticAlloc, Runtime.dynamicAlloc][allocator === undefined ? ALLOC_STATIC : allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var ptr = ret, stop;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)>>0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(/** @type {!Uint8Array} */ (slab), ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    if (typeof curr === 'function') {
      curr = Runtime.getFunctionIndex(curr);
    }

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }
    assert(type, 'Must know what type to store in allocate!');

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = Runtime.getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}
Module["allocate"] = allocate;

// Allocate memory during any stage of startup - static memory early on, dynamic memory later, malloc when ready
function getMemory(size) {
  if (!staticSealed) return Runtime.staticAlloc(size);
  if (!runtimeInitialized) return Runtime.dynamicAlloc(size);
  return _malloc(size);
}
Module["getMemory"] = getMemory;

/** @type {function(number, number=)} */
function Pointer_stringify(ptr, length) {
  if (length === 0 || !ptr) return '';
  // TODO: use TextDecoder
  // Find the length, and check for UTF while doing so
  var hasUtf = 0;
  var t;
  var i = 0;
  while (1) {
    assert(ptr + i < TOTAL_MEMORY);
    t = HEAPU8[(((ptr)+(i))>>0)];
    hasUtf |= t;
    if (t == 0 && !length) break;
    i++;
    if (length && i == length) break;
  }
  if (!length) length = i;

  var ret = '';

  if (hasUtf < 128) {
    var MAX_CHUNK = 1024; // split up into chunks, because .apply on a huge string can overflow the stack
    var curr;
    while (length > 0) {
      curr = String.fromCharCode.apply(String, HEAPU8.subarray(ptr, ptr + Math.min(length, MAX_CHUNK)));
      ret = ret ? ret + curr : curr;
      ptr += MAX_CHUNK;
      length -= MAX_CHUNK;
    }
    return ret;
  }
  return Module['UTF8ToString'](ptr);
}
Module["Pointer_stringify"] = Pointer_stringify;

// Given a pointer 'ptr' to a null-terminated ASCII-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function AsciiToString(ptr) {
  var str = '';
  while (1) {
    var ch = HEAP8[((ptr++)>>0)];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
}
Module["AsciiToString"] = AsciiToString;

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in ASCII form. The copy will require at most str.length+1 bytes of space in the HEAP.

function stringToAscii(str, outPtr) {
  return writeAsciiToMemory(str, outPtr, false);
}
Module["stringToAscii"] = stringToAscii;

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;
function UTF8ArrayToString(u8Array, idx) {
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  while (u8Array[endPtr]) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var u0, u1, u2, u3, u4, u5;

    var str = '';
    while (1) {
      // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
      u0 = u8Array[idx++];
      if (!u0) return str;
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        u3 = u8Array[idx++] & 63;
        if ((u0 & 0xF8) == 0xF0) {
          u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | u3;
        } else {
          u4 = u8Array[idx++] & 63;
          if ((u0 & 0xFC) == 0xF8) {
            u0 = ((u0 & 3) << 24) | (u1 << 18) | (u2 << 12) | (u3 << 6) | u4;
          } else {
            u5 = u8Array[idx++] & 63;
            u0 = ((u0 & 1) << 30) | (u1 << 24) | (u2 << 18) | (u3 << 12) | (u4 << 6) | u5;
          }
        }
      }
      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
}
Module["UTF8ArrayToString"] = UTF8ArrayToString;

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function UTF8ToString(ptr) {
  return UTF8ArrayToString(HEAPU8,ptr);
}
Module["UTF8ToString"] = UTF8ToString;

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0x1FFFFF) {
      if (outIdx + 3 >= endIdx) break;
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0x3FFFFFF) {
      if (outIdx + 4 >= endIdx) break;
      outU8Array[outIdx++] = 0xF8 | (u >> 24);
      outU8Array[outIdx++] = 0x80 | ((u >> 18) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 5 >= endIdx) break;
      outU8Array[outIdx++] = 0xFC | (u >> 30);
      outU8Array[outIdx++] = 0x80 | ((u >> 24) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 18) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}
Module["stringToUTF8Array"] = stringToUTF8Array;

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}
Module["stringToUTF8"] = stringToUTF8;

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) {
      ++len;
    } else if (u <= 0x7FF) {
      len += 2;
    } else if (u <= 0xFFFF) {
      len += 3;
    } else if (u <= 0x1FFFFF) {
      len += 4;
    } else if (u <= 0x3FFFFFF) {
      len += 5;
    } else {
      len += 6;
    }
  }
  return len;
}
Module["lengthBytesUTF8"] = lengthBytesUTF8;

// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

var UTF16Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;
function UTF16ToString(ptr) {
  assert(ptr % 2 == 0, 'Pointer passed to UTF16ToString must be aligned to two bytes!');
  var endPtr = ptr;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  var idx = endPtr >> 1;
  while (HEAP16[idx]) ++idx;
  endPtr = idx << 1;

  if (endPtr - ptr > 32 && UTF16Decoder) {
    return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
  } else {
    var i = 0;

    var str = '';
    while (1) {
      var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
      if (codeUnit == 0) return str;
      ++i;
      // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
      str += String.fromCharCode(codeUnit);
    }
  }
}


// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16 form. The copy will require at most str.length*4+2 bytes of space in the HEAP.
// Use the function lengthBytesUTF16() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=2, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<2 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 2 == 0, 'Pointer passed to stringToUTF16 must be aligned to two bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF16(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr)>>1)]=codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr)>>1)]=0;
  return outPtr - startPtr;
}


// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF16(str) {
  return str.length*2;
}


function UTF32ToString(ptr) {
  assert(ptr % 4 == 0, 'Pointer passed to UTF32ToString must be aligned to four bytes!');
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}


// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32 form. The copy will require at most str.length*4+4 bytes of space in the HEAP.
// Use the function lengthBytesUTF32() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=4, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<4 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 4 == 0, 'Pointer passed to stringToUTF32 must be aligned to four bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF32(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr)>>2)]=codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr)>>2)]=0;
  return outPtr - startPtr;
}


// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}


function demangle(func) {
  var __cxa_demangle_func = Module['___cxa_demangle'] || Module['__cxa_demangle'];
  if (__cxa_demangle_func) {
    try {
      var s =
        func.substr(1);
      var len = lengthBytesUTF8(s)+1;
      var buf = _malloc(len);
      stringToUTF8(s, buf, len);
      var status = _malloc(4);
      var ret = __cxa_demangle_func(buf, 0, 0, status);
      if (getValue(status, 'i32') === 0 && ret) {
        return Pointer_stringify(ret);
      }
      // otherwise, libcxxabi failed
    } catch(e) {
      // ignore problems here
    } finally {
      if (buf) _free(buf);
      if (status) _free(status);
      if (ret) _free(ret);
    }
    // failure when using libcxxabi, don't demangle
    return func;
  }
  Runtime.warnOnce('warning: build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling');
  return func;
}

function demangleAll(text) {
  var regex =
    /__Z[\w\d_]+/g;
  return text.replace(regex,
    function(x) {
      var y = demangle(x);
      return x === y ? x : (x + ' [' + y + ']');
    });
}

function jsStackTrace() {
  var err = new Error();
  if (!err.stack) {
    // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
    // so try that as a special-case.
    try {
      throw new Error(0);
    } catch(e) {
      err = e;
    }
    if (!err.stack) {
      return '(no stack trace available)';
    }
  }
  return err.stack.toString();
}

function stackTrace() {
  var js = jsStackTrace();
  if (Module['extraStackTrace']) js += '\n' + Module['extraStackTrace']();
  return demangleAll(js);
}
Module["stackTrace"] = stackTrace;

// Memory management

var PAGE_SIZE = 16384;
var WASM_PAGE_SIZE = 65536;
var ASMJS_PAGE_SIZE = 16777216;
var MIN_TOTAL_MEMORY = 16777216;

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}

var HEAP,
/** @type {ArrayBuffer} */
  buffer,
/** @type {Int8Array} */
  HEAP8,
/** @type {Uint8Array} */
  HEAPU8,
/** @type {Int16Array} */
  HEAP16,
/** @type {Uint16Array} */
  HEAPU16,
/** @type {Int32Array} */
  HEAP32,
/** @type {Uint32Array} */
  HEAPU32,
/** @type {Float32Array} */
  HEAPF32,
/** @type {Float64Array} */
  HEAPF64;

function updateGlobalBuffer(buf) {
  Module['buffer'] = buffer = buf;
}

function updateGlobalBufferViews() {
  Module['HEAP8'] = HEAP8 = new Int8Array(buffer);
  Module['HEAP16'] = HEAP16 = new Int16Array(buffer);
  Module['HEAP32'] = HEAP32 = new Int32Array(buffer);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(buffer);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(buffer);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(buffer);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(buffer);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(buffer);
}

var STATIC_BASE, STATICTOP, staticSealed; // static area
var STACK_BASE, STACKTOP, STACK_MAX; // stack area
var DYNAMIC_BASE, DYNAMICTOP_PTR; // dynamic area handled by sbrk

if (!ENVIRONMENT_IS_PTHREAD) { // Pthreads have already initialized these variables in src/pthread-main.js, where they were passed to the thread worker at startup time
  STATIC_BASE = STATICTOP = STACK_BASE = STACKTOP = STACK_MAX = DYNAMIC_BASE = DYNAMICTOP_PTR = 0;
  staticSealed = false;
}

if (ENVIRONMENT_IS_PTHREAD) {
  staticSealed = true; // The static memory area has been initialized already in the main thread, pthreads skip this.
}

// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  assert((STACK_MAX & 3) == 0);
  HEAPU32[(STACK_MAX >> 2)-1] = 0x02135467;
  HEAPU32[(STACK_MAX >> 2)-2] = 0x89BACDFE;
}

function checkStackCookie() {
  if (HEAPU32[(STACK_MAX >> 2)-1] != 0x02135467 || HEAPU32[(STACK_MAX >> 2)-2] != 0x89BACDFE) {
    abort('Stack overflow! Stack cookie has been overwritten, expected hex dwords 0x89BACDFE and 0x02135467, but received 0x' + HEAPU32[(STACK_MAX >> 2)-2].toString(16) + ' ' + HEAPU32[(STACK_MAX >> 2)-1].toString(16));
  }
  // Also test the global address 0 for integrity. This check is not compatible with SAFE_SPLIT_MEMORY though, since that mode already tests all address 0 accesses on its own.
  if (HEAP32[0] !== 0x63736d65 /* 'emsc' */) throw 'Runtime error: The application has corrupted its heap memory area (address zero)!';
}

function abortStackOverflow(allocSize) {
  abort('Stack overflow! Attempted to allocate ' + allocSize + ' bytes on the stack, but stack has only ' + (STACK_MAX - Module['asm'].stackSave() + allocSize) + ' bytes available!');
}

function abortOnCannotGrowMemory() {
  abort('Cannot enlarge memory arrays. Either (1) compile with  -s TOTAL_MEMORY=X  with X higher than the current value ' + TOTAL_MEMORY + ', (2) compile with  -s ALLOW_MEMORY_GROWTH=1  which allows increasing the size at runtime but prevents some optimizations, (3) set Module.TOTAL_MEMORY to a higher value before the program runs, or (4) if you want malloc to return NULL (0) instead of this abort, compile with  -s ABORTING_MALLOC=0 ');
}


function enlargeMemory() {
  abort('Cannot enlarge memory arrays, since compiling with pthreads support enabled (-s USE_PTHREADS=1).');
}


var TOTAL_STACK = Module['TOTAL_STACK'] || 5242880;
var TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;
if (TOTAL_MEMORY < TOTAL_STACK) Module.printErr('TOTAL_MEMORY should be larger than TOTAL_STACK, was ' + TOTAL_MEMORY + '! (TOTAL_STACK=' + TOTAL_STACK + ')');

// Initialize the runtime's memory
// check for full engine support (use string 'subarray' to avoid closure compiler confusion)
assert(typeof Int32Array !== 'undefined' && typeof Float64Array !== 'undefined' && Int32Array.prototype.subarray !== undefined && Int32Array.prototype.set !== undefined,
       'JS engine does not provide full typed array support');


if (typeof SharedArrayBuffer !== 'undefined') {
  if (!ENVIRONMENT_IS_PTHREAD) buffer = new SharedArrayBuffer(TOTAL_MEMORY);
  // Currently SharedArrayBuffer does not have a slice() operation, so polyfill it in.
  // Adapted from https://github.com/ttaubert/node-arraybuffer-slice, (c) 2014 Tim Taubert <tim@timtaubert.de>
  // arraybuffer-slice may be freely distributed under the MIT license.
  (function (undefined) {
    "use strict";
    function clamp(val, length) {
      val = (val|0) || 0;
      if (val < 0) return Math.max(val + length, 0);
      return Math.min(val, length);
    }
    if (typeof SharedArrayBuffer !== 'undefined' && !SharedArrayBuffer.prototype.slice) {
      SharedArrayBuffer.prototype.slice = function (from, to) {
        var length = this.byteLength;
        var begin = clamp(from, length);
        var end = length;
        if (to !== undefined) end = clamp(to, length);
        if (begin > end) return new ArrayBuffer(0);
        var num = end - begin;
        var target = new ArrayBuffer(num);
        var targetArray = new Uint8Array(target);
        var sourceArray = new Uint8Array(this, begin, num);
        targetArray.set(sourceArray);
        return target;
      };
    }
  })();
} else {
  if (!ENVIRONMENT_IS_PTHREAD) buffer = new ArrayBuffer(TOTAL_MEMORY);
}
updateGlobalBufferViews();

if (typeof Atomics === 'undefined') {
  // Polyfill singlethreaded atomics ops from http://lars-t-hansen.github.io/ecmascript_sharedmem/shmem.html#Atomics.add
  // No thread-safety needed since we don't have multithreading support.
  Atomics = {};
  Atomics['add'] = function(t, i, v) { var w = t[i]; t[i] += v; return w; }
  Atomics['and'] = function(t, i, v) { var w = t[i]; t[i] &= v; return w; }
  Atomics['compareExchange'] = function(t, i, e, r) { var w = t[i]; if (w == e) t[i] = r; return w; }
  Atomics['exchange'] = function(t, i, v) { var w = t[i]; t[i] = v; return w; }
  Atomics['wait'] = function(t, i, v, o) { if (t[i] != v) return 'not-equal'; else return 'timed-out'; }
  Atomics['wake'] = function(t, i, c) { return 0; }
  Atomics['wakeOrRequeue'] = function(t, i1, c, i2, v) { return 0; }
  Atomics['isLockFree'] = function(s) { return true; }
  Atomics['load'] = function(t, i) { return t[i]; }
  Atomics['or'] = function(t, i, v) { var w = t[i]; t[i] |= v; return w; }
  Atomics['store'] = function(t, i, v) { t[i] = v; return v; }
  Atomics['sub'] = function(t, i, v) { var w = t[i]; t[i] -= v; return w; }
  Atomics['xor'] = function(t, i, v) { var w = t[i]; t[i] ^= v; return w; }
}


function getTotalMemory() {
  return TOTAL_MEMORY;
}

// Endianness check (note: assumes compiler arch was little-endian)
if (!ENVIRONMENT_IS_PTHREAD) {
  HEAP32[0] = 0x63736d65; /* 'emsc' */
} else {
  if (HEAP32[0] !== 0x63736d65) throw 'Runtime error: The application has corrupted its heap memory area (address zero)!';
}
HEAP16[1] = 0x6373;
if (HEAPU8[2] !== 0x73 || HEAPU8[3] !== 0x63) throw 'Runtime error: expected the system to be little-endian!';

Module['HEAP'] = HEAP;
Module['buffer'] = buffer;
Module['HEAP8'] = HEAP8;
Module['HEAP16'] = HEAP16;
Module['HEAP32'] = HEAP32;
Module['HEAPU8'] = HEAPU8;
Module['HEAPU16'] = HEAPU16;
Module['HEAPU32'] = HEAPU32;
Module['HEAPF32'] = HEAPF32;
Module['HEAPF64'] = HEAPF64;

function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Module['dynCall_v'](func);
      } else {
        Module['dynCall_vi'](func, callback.arg);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the runtime has exited

var runtimeInitialized = false;
var runtimeExited = false;

if (ENVIRONMENT_IS_PTHREAD) runtimeInitialized = true; // The runtime is hosted in the main thread, and bits shared to pthreads via SharedArrayBuffer. No need to init again in pthread.

function preRun() {
  if (ENVIRONMENT_IS_PTHREAD) return; // PThreads reuse the runtime from the main thread.
  // compatibility - merge in anything from Module['preRun'] at this time
  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPRERUN__);
}

function ensureInitRuntime() {
  checkStackCookie();
  if (ENVIRONMENT_IS_PTHREAD) return; // PThreads reuse the runtime from the main thread.
  if (runtimeInitialized) return;
  runtimeInitialized = true;
  // Pass the thread address inside the asm.js scope to store it for fast access that avoids the need for a FFI out.
  __register_pthread_ptr(PThread.mainThreadBlock, /*isMainBrowserThread=*/!ENVIRONMENT_IS_WORKER, /*isMainRuntimeThread=*/1);
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  checkStackCookie();
  if (ENVIRONMENT_IS_PTHREAD) return; // PThreads reuse the runtime from the main thread.
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  checkStackCookie();
  if (ENVIRONMENT_IS_PTHREAD) return; // PThreads reuse the runtime from the main thread.
  callRuntimeCallbacks(__ATEXIT__);
  runtimeExited = true;
}

function postRun() {
  checkStackCookie();
  if (ENVIRONMENT_IS_PTHREAD) return; // PThreads reuse the runtime from the main thread.
  // compatibility - merge in anything from Module['postRun'] at this time
  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}
Module["addOnPreRun"] = addOnPreRun;

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}
Module["addOnInit"] = addOnInit;

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}
Module["addOnPreMain"] = addOnPreMain;

function addOnExit(cb) {
  __ATEXIT__.unshift(cb);
}
Module["addOnExit"] = addOnExit;

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}
Module["addOnPostRun"] = addOnPostRun;

// Tools

/** @type {function(string, boolean=, number=)} */
function intArrayFromString(stringy, dontAddNull, length) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}
Module["intArrayFromString"] = intArrayFromString;

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      assert(false, 'Character code ' + chr + ' (' + String.fromCharCode(chr) + ')  at offset ' + i + ' not in 0x00-0xFF.');
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}
Module["intArrayToString"] = intArrayToString;

// Deprecated: This function should not be called because it is unsafe and does not provide
// a maximum length limit of how many bytes it is allowed to write. Prefer calling the
// function stringToUTF8Array() instead, which takes in a maximum length that can be used
// to be secure from out of bounds writes.
/** @deprecated */
function writeStringToMemory(string, buffer, dontAddNull) {
  Runtime.warnOnce('writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!');

  var /** @type {number} */ lastChar, /** @type {number} */ end;
  if (dontAddNull) {
    // stringToUTF8Array always appends null. If we don't want to do that, remember the
    // character that existed at the location where the null will be placed, and restore
    // that after the write (below).
    end = buffer + lengthBytesUTF8(string);
    lastChar = HEAP8[end];
  }
  stringToUTF8(string, buffer, Infinity);
  if (dontAddNull) HEAP8[end] = lastChar; // Restore the value under the null character.
}
Module["writeStringToMemory"] = writeStringToMemory;

function writeArrayToMemory(array, buffer) {
  assert(array.length >= 0, 'writeArrayToMemory array must have a length (should be an array or typed array)')
  HEAP8.set(array, buffer);
}
Module["writeArrayToMemory"] = writeArrayToMemory;

function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; ++i) {
    assert(str.charCodeAt(i) === str.charCodeAt(i)&0xff);
    HEAP8[((buffer++)>>0)]=str.charCodeAt(i);
  }
  // Null-terminate the pointer to the HEAP.
  if (!dontAddNull) HEAP8[((buffer)>>0)]=0;
}
Module["writeAsciiToMemory"] = writeAsciiToMemory;

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}

// check for imul support, and also for correctness ( https://bugs.webkit.org/show_bug.cgi?id=126345 )
if (!Math['imul'] || Math['imul'](0xffffffff, 5) !== -5) Math['imul'] = function imul(a, b) {
  var ah  = a >>> 16;
  var al = a & 0xffff;
  var bh  = b >>> 16;
  var bl = b & 0xffff;
  return (al*bl + ((ah*bl + al*bh) << 16))|0;
};
Math.imul = Math['imul'];


if (!Math['clz32']) Math['clz32'] = function(x) {
  x = x >>> 0;
  for (var i = 0; i < 32; i++) {
    if (x & (1 << (31 - i))) return i;
  }
  return 32;
};
Math.clz32 = Math['clz32']

if (!Math['trunc']) Math['trunc'] = function(x) {
  return x < 0 ? Math.ceil(x) : Math.floor(x);
};
Math.trunc = Math['trunc'];

var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;

// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// PRE_RUN_ADDITIONS (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled
var runDependencyTracking = {};

function getUniqueRunDependency(id) {
  var orig = id;
  while (1) {
    if (!runDependencyTracking[id]) return id;
    id = orig + Math.random();
  }
  return id;
}

function addRunDependency(id) {
  // We should never get here in pthreads (could no-op this out if called in pthreads, but that might indicate a bug in caller side,
  // so good to be very explicit)
  assert(!ENVIRONMENT_IS_PTHREAD);
  runDependencies++;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
  if (id) {
    assert(!runDependencyTracking[id]);
    runDependencyTracking[id] = 1;
    if (runDependencyWatcher === null && typeof setInterval !== 'undefined') {
      // Check for missing dependencies every few seconds
      runDependencyWatcher = setInterval(function() {
        if (ABORT) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
          return;
        }
        var shown = false;
        for (var dep in runDependencyTracking) {
          if (!shown) {
            shown = true;
            Module.printErr('still waiting on run dependencies:');
          }
          Module.printErr('dependency: ' + dep);
        }
        if (shown) {
          Module.printErr('(end of list)');
        }
      }, 10000);
    }
  } else {
    Module.printErr('warning: run dependency added without ID');
  }
}
Module["addRunDependency"] = addRunDependency;

function removeRunDependency(id) {
  runDependencies--;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
  if (id) {
    assert(runDependencyTracking[id]);
    delete runDependencyTracking[id];
  } else {
    Module.printErr('warning: run dependency removed without ID');
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}
Module["removeRunDependency"] = removeRunDependency;

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data



var memoryInitializer = null;






// === Body ===

var ASM_CONSTS = [function() { postMessage({ cmd: 'processQueuedMainThreadWork' }) },
 function() { return !!(Module['canvas']); },
 function() { Module['noExitRuntime'] = true },
 function() { throw 'Canceled!' }];

function _emscripten_asm_const_i(code) {
  return ASM_CONSTS[code]();
}



STATIC_BASE = Runtime.GLOBAL_BASE;

STATICTOP = STATIC_BASE + 11648;
/* global initializers */ if (!ENVIRONMENT_IS_PTHREAD) __ATINIT__.push({ func: function() { __GLOBAL__sub_I_test_cpp() } }, { func: function() { __GLOBAL__sub_I_bind_cpp() } }, { func: function() { ___emscripten_pthread_data_constructor() } });


if (!ENVIRONMENT_IS_PTHREAD) {
/* memory initializer */ allocate([232,3,0,0,0,0,0,0,149,214,38,232,11,46,1,66,52,4,0,0,206,8,0,0,52,4,0,0,237,8,0,0,52,4,0,0,12,9,0,0,52,4,0,0,43,9,0,0,52,4,0,0,74,9,0,0,52,4,0,0,105,9,0,0,52,4,0,0,136,9,0,0,52,4,0,0,167,9,0,0,52,4,0,0,198,9,0,0,52,4,0,0,229,9,0,0,52,4,0,0,4,10,0,0,52,4,0,0,35,10,0,0,52,4,0,0,66,10,0,0,240,4,0,0,85,10,0,0,0,0,0,0,1,0,0,0,152,0,0,0,0,0,0,0,52,4,0,0,148,10,0,0,240,4,0,0,186,10,0,0,0,0,0,0,1,0,0,0,152,0,0,0,0,0,0,0,240,4,0,0,249,10,0,0,0,0,0,0,1,0,0,0,152,0,0,0,0,0,0,0,92,4,0,0,69,24,0,0,224,0,0,0,0,0,0,0,92,4,0,0,104,24,0,0,240,0,0,0,0,0,0,0,52,4,0,0,127,24,0,0,92,4,0,0,193,24,0,0,224,0,0,0,0,0,0,0,92,4,0,0,227,24,0,0,120,1,0,0,0,0,0,0,52,4,0,0,184,25,0,0,92,4,0,0,24,26,0,0,48,1,0,0,0,0,0,0,92,4,0,0,197,25,0,0,64,1,0,0,0,0,0,0,52,4,0,0,230,25,0,0,92,4,0,0,243,25,0,0,32,1,0,0,0,0,0,0,92,4,0,0,59,27,0,0,24,1,0,0,0,0,0,0,92,4,0,0,72,27,0,0,24,1,0,0,0,0,0,0,92,4,0,0,88,27,0,0,24,1,0,0,0,0,0,0,92,4,0,0,106,27,0,0,104,1,0,0,0,0,0,0,92,4,0,0,159,27,0,0,48,1,0,0,0,0,0,0,92,4,0,0,123,27,0,0,152,1,0,0,0,0,0,0,92,4,0,0,193,27,0,0,48,1,0,0,0,0,0,0,212,4,0,0,233,27,0,0,212,4,0,0,235,27,0,0,212,4,0,0,237,27,0,0,212,4,0,0,239,27,0,0,212,4,0,0,241,27,0,0,212,4,0,0,243,27,0,0,212,4,0,0,245,27,0,0,212,4,0,0,247,27,0,0,212,4,0,0,249,27,0,0,212,4,0,0,251,27,0,0,212,4,0,0,253,27,0,0,212,4,0,0,255,27,0,0,212,4,0,0,1,28,0,0,92,4,0,0,3,28,0,0,32,1,0,0,0,0,0,0,68,2,0,0,5,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,3,0,0,0,117,41,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,255,255,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,196,2,0,0,5,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,3,0,0,0,125,41,0,0,0,4,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,10,255,255,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,196,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,255,255,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,208,0,0,0,6,0,0,0,7,0,0,0,8,0,0,0,9,0,0,0,10,0,0,0,11,0,0,0,12,0,0,0,0,0,0,0,248,0,0,0,6,0,0,0,13,0,0,0,14,0,0,0,15,0,0,0,10,0,0,0,11,0,0,0,16,0,0,0,200,3,0,0,236,3,0,0,0,0,0,0,8,1,0,0,17,0,0,0,18,0,0,0,19,0,0,0,20,0,0,0,175,25,0,0,0,0,0,0,32,1,0,0,21,0,0,0,22,0,0,0,23,0,0,0,24,0,0,0,25,0,0,0,26,0,0,0,27,0,0,0,28,0,0,0,0,0,0,0,72,1,0,0,21,0,0,0,29,0,0,0,23,0,0,0,24,0,0,0,25,0,0,0,30,0,0,0,31,0,0,0,32,0,0,0,0,0,0,0,88,1,0,0,33,0,0,0,34,0,0,0,35,0,0,0,0,0,0,0,104,1,0,0,36,0,0,0,37,0,0,0,38,0,0,0,0,0,0,0,120,1,0,0,39,0,0,0,40,0,0,0,19,0,0,0,0,0,0,0,136,1,0,0,36,0,0,0,41,0,0,0,38,0,0,0,0,0,0,0,184,1,0,0,21,0,0,0,42,0,0,0,23,0,0,0,24,0,0,0,43,0,0,0,0,0,0,0,48,2,0,0,21,0,0,0,44,0,0,0,23,0,0,0,24,0,0,0,25,0,0,0,45,0,0,0,46,0,0,0,47,0,0,0,112,117,115,104,105,110,103,32,109,101,115,115,97,103,101,10,0,109,101,115,115,97,103,101,0,119,97,105,116,105,110,103,32,102,111,114,32,109,101,115,115,97,103,101,10,0,112,111,112,112,105,110,103,32,109,101,115,115,97,103,101,58,32,37,115,10,0,97,108,108,111,99,97,116,111,114,60,84,62,58,58,97,108,108,111,99,97,116,101,40,115,105,122,101,95,116,32,110,41,32,39,110,39,32,101,120,99,101,101,100,115,32,109,97,120,105,109,117,109,32,115,117,112,112,111,114,116,101,100,32,115,105,122,101,0,116,104,114,101,97,100,32,99,111,110,115,116,114,117,99,116,111,114,32,102,97,105,108,101,100,0,118,111,105,100,0,98,111,111,108,0,99,104,97,114,0,115,105,103,110,101,100,32,99,104,97,114,0,117,110,115,105,103,110,101,100,32,99,104,97,114,0,115,104,111,114,116,0,117,110,115,105,103,110,101,100,32,115,104,111,114,116,0,105,110,116,0,117,110,115,105,103,110,101,100,32,105,110,116,0,108,111,110,103,0,117,110,115,105,103,110,101,100,32,108,111,110,103,0,102,108,111,97,116,0,100,111,117,98,108,101,0,115,116,100,58,58,115,116,114,105,110,103,0,115,116,100,58,58,98,97,115,105,99,95,115,116,114,105,110,103,60,117,110,115,105,103,110,101,100,32,99,104,97,114,62,0,115,116,100,58,58,119,115,116,114,105,110,103,0,101,109,115,99,114,105,112,116,101,110,58,58,118,97,108,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,99,104,97,114,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,115,105,103,110,101,100,32,99,104,97,114,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,117,110,115,105,103,110,101,100,32,99,104,97,114,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,115,104,111,114,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,117,110,115,105,103,110,101,100,32,115,104,111,114,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,105,110,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,117,110,115,105,103,110,101,100,32,105,110,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,108,111,110,103,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,117,110,115,105,103,110,101,100,32,108,111,110,103,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,105,110,116,56,95,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,117,105,110,116,56,95,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,105,110,116,49,54,95,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,117,105,110,116,49,54,95,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,105,110,116,51,50,95,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,117,105,110,116,51,50,95,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,102,108,111,97,116,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,100,111,117,98,108,101,62,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,60,108,111,110,103,32,100,111,117,98,108,101,62,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,101,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,100,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,102,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,109,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,108,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,106,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,105,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,116,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,115,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,104,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,97,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,73,99,69,69,0,78,49,48,101,109,115,99,114,105,112,116,101,110,51,118,97,108,69,0,78,83,116,51,95,95,50,49,50,98,97,115,105,99,95,115,116,114,105,110,103,73,119,78,83,95,49,49,99,104,97,114,95,116,114,97,105,116,115,73,119,69,69,78,83,95,57,97,108,108,111,99,97,116,111,114,73,119,69,69,69,69,0,78,83,116,51,95,95,50,50,49,95,95,98,97,115,105,99,95,115,116,114,105,110,103,95,99,111,109,109,111,110,73,76,98,49,69,69,69,0,78,83,116,51,95,95,50,49,50,98,97,115,105,99,95,115,116,114,105,110,103,73,104,78,83,95,49,49,99,104,97,114,95,116,114,97,105,116,115,73,104,69,69,78,83,95,57,97,108,108,111,99,97,116,111,114,73,104,69,69,69,69,0,78,83,116,51,95,95,50,49,50,98,97,115,105,99,95,115,116,114,105,110,103,73,99,78,83,95,49,49,99,104,97,114,95,116,114,97,105,116,115,73,99,69,69,78,83,95,57,97,108,108,111,99,97,116,111,114,73,99,69,69,69,69,0,17,0,10,0,17,17,17,0,0,0,0,5,0,0,0,0,0,0,9,0,0,0,0,11,0,0,0,0,0,0,0,0,17,0,15,10,17,17,17,3,10,7,0,1,19,9,11,11,0,0,9,6,11,0,0,11,0,6,17,0,0,0,17,17,17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,0,0,0,0,0,17,0,10,10,17,17,17,0,10,0,0,2,0,9,11,0,0,0,9,0,11,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,12,0,0,0,0,0,0,0,0,0,0,0,12,0,0,0,0,12,0,0,0,0,9,12,0,0,0,0,0,12,0,0,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,0,0,0,0,0,0,0,0,0,0,0,13,0,0,0,4,13,0,0,0,0,9,14,0,0,0,0,0,14,0,0,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,16,0,0,0,0,0,0,0,0,0,0,0,15,0,0,0,0,15,0,0,0,0,9,16,0,0,0,0,0,16,0,0,16,0,0,18,0,0,0,18,18,18,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,18,0,0,0,18,18,18,0,0,0,0,0,0,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,0,0,0,0,0,0,0,0,10,0,0,0,0,10,0,0,0,0,9,11,0,0,0,0,0,11,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,12,0,0,0,0,0,0,0,0,0,0,0,12,0,0,0,0,12,0,0,0,0,9,12,0,0,0,0,0,12,0,0,12,0,0,45,43,32,32,32,48,88,48,120,0,40,110,117,108,108,41,0,45,48,88,43,48,88,32,48,88,45,48,120,43,48,120,32,48,120,0,105,110,102,0,73,78,70,0,110,97,110,0,78,65,78,0,48,49,50,51,52,53,54,55,56,57,65,66,67,68,69,70,46,0,84,33,34,25,13,1,2,3,17,75,28,12,16,4,11,29,18,30,39,104,110,111,112,113,98,32,5,6,15,19,20,21,26,8,22,7,40,36,23,24,9,10,14,27,31,37,35,131,130,125,38,42,43,60,61,62,63,67,71,74,77,88,89,90,91,92,93,94,95,96,97,99,100,101,102,103,105,106,107,108,114,115,116,121,122,123,124,0,73,108,108,101,103,97,108,32,98,121,116,101,32,115,101,113,117,101,110,99,101,0,68,111,109,97,105,110,32,101,114,114,111,114,0,82,101,115,117,108,116,32,110,111,116,32,114,101,112,114,101,115,101,110,116,97,98,108,101,0,78,111,116,32,97,32,116,116,121,0,80,101,114,109,105,115,115,105,111,110,32,100,101,110,105,101,100,0,79,112,101,114,97,116,105,111,110,32,110,111,116,32,112,101,114,109,105,116,116,101,100,0,78,111,32,115,117,99,104,32,102,105,108,101,32,111,114,32,100,105,114,101,99,116,111,114,121,0,78,111,32,115,117,99,104,32,112,114,111,99,101,115,115,0,70,105,108,101,32,101,120,105,115,116,115,0,86,97,108,117,101,32,116,111,111,32,108,97,114,103,101,32,102,111,114,32,100,97,116,97,32,116,121,112,101,0,78,111,32,115,112,97,99,101,32,108,101,102,116,32,111,110,32,100,101,118,105,99,101,0,79,117,116,32,111,102,32,109,101,109,111,114,121,0,82,101,115,111,117,114,99,101,32,98,117,115,121,0,73,110,116,101,114,114,117,112,116,101,100,32,115,121,115,116,101,109,32,99,97,108,108,0,82,101,115,111,117,114,99,101,32,116,101,109,112,111,114,97,114,105,108,121,32,117,110,97,118,97,105,108,97,98,108,101,0,73,110,118,97,108,105,100,32,115,101,101,107,0,67,114,111,115,115,45,100,101,118,105,99,101,32,108,105,110,107,0,82,101,97,100,45,111,110,108,121,32,102,105,108,101,32,115,121,115,116,101,109,0,68,105,114,101,99,116,111,114,121,32,110,111,116,32,101,109,112,116,121,0,67,111,110,110,101,99,116,105,111,110,32,114,101,115,101,116,32,98,121,32,112,101,101,114,0,79,112,101,114,97,116,105,111,110,32,116,105,109,101,100,32,111,117,116,0,67,111,110,110,101,99,116,105,111,110,32,114,101,102,117,115,101,100,0,72,111,115,116,32,105,115,32,100,111,119,110,0,72,111,115,116,32,105,115,32,117,110,114,101,97,99,104,97,98,108,101,0,65,100,100,114,101,115,115,32,105,110,32,117,115,101,0,66,114,111,107,101,110,32,112,105,112,101,0,73,47,79,32,101,114,114,111,114,0,78,111,32,115,117,99,104,32,100,101,118,105,99,101,32,111,114,32,97,100,100,114,101,115,115,0,66,108,111,99,107,32,100,101,118,105,99,101,32,114,101,113,117,105,114,101,100,0,78,111,32,115,117,99,104,32,100,101,118,105,99,101,0,78,111,116,32,97,32,100,105,114,101,99,116,111,114,121,0,73,115,32,97,32,100,105,114,101,99,116,111,114,121,0,84,101,120,116,32,102,105,108,101,32,98,117,115,121,0,69,120,101,99,32,102,111,114,109,97,116,32,101,114,114,111,114,0,73,110,118,97,108,105,100,32,97,114,103,117,109,101,110,116,0,65,114,103,117,109,101,110,116,32,108,105,115,116,32,116,111,111,32,108,111,110,103,0,83,121,109,98,111,108,105,99,32,108,105,110,107,32,108,111,111,112,0,70,105,108,101,110,97,109,101,32,116,111,111,32,108,111,110,103,0,84,111,111,32,109,97,110,121,32,111,112,101,110,32,102,105,108,101,115,32,105,110,32,115,121,115,116,101,109,0,78,111,32,102,105,108,101,32,100,101,115,99,114,105,112,116,111,114,115,32,97,118,97,105,108,97,98,108,101,0,66,97,100,32,102,105,108,101,32,100,101,115,99,114,105,112,116,111,114,0,78,111,32,99,104,105,108,100,32,112,114,111,99,101,115,115,0,66,97,100,32,97,100,100,114,101,115,115,0,70,105,108,101,32,116,111,111,32,108,97,114,103,101,0,84,111,111,32,109,97,110,121,32,108,105,110,107,115,0,78,111,32,108,111,99,107,115,32,97,118,97,105,108,97,98,108,101,0,82,101,115,111,117,114,99,101,32,100,101,97,100,108,111,99,107,32,119,111,117,108,100,32,111,99,99,117,114,0,83,116,97,116,101,32,110,111,116,32,114,101,99,111,118,101,114,97,98,108,101,0,80,114,101,118,105,111,117,115,32,111,119,110,101,114,32,100,105,101,100,0,79,112,101,114,97,116,105,111,110,32,99,97,110,99,101,108,101,100,0,70,117,110,99,116,105,111,110,32,110,111,116,32,105,109,112,108,101,109,101,110,116,101,100,0,78,111,32,109,101,115,115,97,103,101,32,111,102,32,100,101,115,105,114,101,100,32,116,121,112,101,0,73,100,101,110,116,105,102,105,101,114,32,114,101,109,111,118,101,100,0,68,101,118,105,99,101,32,110,111,116,32,97,32,115,116,114,101,97,109,0,78,111,32,100,97,116,97,32,97,118,97,105,108,97,98,108,101,0,68,101,118,105,99,101,32,116,105,109,101,111,117,116,0,79,117,116,32,111,102,32,115,116,114,101,97,109,115,32,114,101,115,111,117,114,99,101,115,0,76,105,110,107,32,104,97,115,32,98,101,101,110,32,115,101,118,101,114,101,100,0,80,114,111,116,111,99,111,108,32,101,114,114,111,114,0,66,97,100,32,109,101,115,115,97,103,101,0,70,105,108,101,32,100,101,115,99,114,105,112,116,111,114,32,105,110,32,98,97,100,32,115,116,97,116,101,0,78,111,116,32,97,32,115,111,99,107,101,116,0,68,101,115,116,105,110,97,116,105,111,110,32,97,100,100,114,101,115,115,32,114,101,113,117,105,114,101,100,0,77,101,115,115,97,103,101,32,116,111,111,32,108,97,114,103,101,0,80,114,111,116,111,99,111,108,32,119,114,111,110,103,32,116,121,112,101,32,102,111,114,32,115,111,99,107,101,116,0,80,114,111,116,111,99,111,108,32,110,111,116,32,97,118,97,105,108,97,98,108,101,0,80,114,111,116,111,99,111,108,32,110,111,116,32,115,117,112,112,111,114,116,101,100,0,83,111,99,107,101,116,32,116,121,112,101,32,110,111,116,32,115,117,112,112,111,114,116,101,100,0,78,111,116,32,115,117,112,112,111,114,116,101,100,0,80,114,111,116,111,99,111,108,32,102,97,109,105,108,121,32,110,111,116,32,115,117,112,112,111,114,116,101,100,0,65,100,100,114,101,115,115,32,102,97,109,105,108,121,32,110,111,116,32,115,117,112,112,111,114,116,101,100,32,98,121,32,112,114,111,116,111,99,111,108,0,65,100,100,114,101,115,115,32,110,111,116,32,97,118,97,105,108,97,98,108,101,0,78,101,116,119,111,114,107,32,105,115,32,100,111,119,110,0,78,101,116,119,111,114,107,32,117,110,114,101,97,99,104,97,98,108,101,0,67,111,110,110,101,99,116,105,111,110,32,114,101,115,101,116,32,98,121,32,110,101,116,119,111,114,107,0,67,111,110,110,101,99,116,105,111,110,32,97,98,111,114,116,101,100,0,78,111,32,98,117,102,102,101,114,32,115,112,97,99,101,32,97,118,97,105,108,97,98,108,101,0,83,111,99,107,101,116,32,105,115,32,99,111,110,110,101,99,116,101,100,0,83,111,99,107,101,116,32,110,111,116,32,99,111,110,110,101,99,116,101,100,0,67,97,110,110,111,116,32,115,101,110,100,32,97,102,116,101,114,32,115,111,99,107,101,116,32,115,104,117,116,100,111,119,110,0,79,112,101,114,97,116,105,111,110,32,97,108,114,101,97,100,121,32,105,110,32,112,114,111,103,114,101,115,115,0,79,112,101,114,97,116,105,111,110,32,105,110,32,112,114,111,103,114,101,115,115,0,83,116,97,108,101,32,102,105,108,101,32,104,97,110,100,108,101,0,82,101,109,111,116,101,32,73,47,79,32,101,114,114,111,114,0,81,117,111,116,97,32,101,120,99,101,101,100,101,100,0,78,111,32,109,101,100,105,117,109,32,102,111,117,110,100,0,87,114,111,110,103,32,109,101,100,105,117,109,32,116,121,112,101,0,78,111,32,101,114,114,111,114,32,105,110,102,111,114,109,97,116,105,111,110,0,0,123,32,114,101,116,117,114,110,32,33,33,40,77,111,100,117,108,101,91,39,99,97,110,118,97,115,39,93,41,59,32,125,0,35,99,97,110,118,97,115,0,77,111,100,117,108,101,91,39,110,111,69,120,105,116,82,117,110,116,105,109,101,39,93,32,61,32,116,114,117,101,0,65,112,112,108,105,99,97,116,105,111,110,32,109,97,105,110,32,116,104,114,101,97,100,0,101,109,115,99,114,105,112,116,101,110,95,105,115,95,109,97,105,110,95,114,117,110,116,105,109,101,95,116,104,114,101,97,100,40,41,32,38,38,32,34,101,109,115,99,114,105,112,116,101,110,95,109,97,105,110,95,116,104,114,101,97,100,95,112,114,111,99,101,115,115,95,113,117,101,117,101,100,95,99,97,108,108,115,32,109,117,115,116,32,98,101,32,99,97,108,108,101,100,32,102,114,111,109,32,116,104,101,32,109,97,105,110,32,116,104,114,101,97,100,33,34,0,47,85,115,101,114,115,47,121,97,105,114,47,68,111,119,110,108,111,97,100,115,47,101,109,115,100,107,45,112,111,114,116,97,98,108,101,47,101,109,115,99,114,105,112,116,101,110,47,49,46,51,55,46,50,50,47,115,121,115,116,101,109,47,108,105,98,47,112,116,104,114,101,97,100,47,108,105,98,114,97,114,121,95,112,116,104,114,101,97,100,46,99,0,101,109,115,99,114,105,112,116,101,110,95,109,97,105,110,95,116,104,114,101,97,100,95,112,114,111,99,101,115,115,95,113,117,101,117,101,100,95,99,97,108,108,115,0,48,32,38,38,32,34,73,110,118,97,108,105,100,32,69,109,115,99,114,105,112,116,101,110,32,112,116,104,114,101,97,100,32,95,100,111,95,99,97,108,108,32,111,112,99,111,100,101,33,34,0,95,100,111,95,99,97,108,108,0,99,97,108,108,0,101,109,115,99,114,105,112,116,101,110,95,97,115,121,110,99,95,114,117,110,95,105,110,95,109,97,105,110,95,116,104,114,101,97,100,0,112,111,115,116,77,101,115,115,97,103,101,40,123,32,99,109,100,58,32,39,112,114,111,99,101,115,115,81,117,101,117,101,100,77,97,105,110,84,104,114,101,97,100,87,111,114,107,39,32,125,41,0,116,104,114,111,119,32,39,67,97,110,99,101,108,101,100,33,39,0,99,111,110,100,105,116,105,111,110,95,118,97,114,105,97,98,108,101,58,58,119,97,105,116,58,32,109,117,116,101,120,32,110,111,116,32,108,111,99,107,101,100,0,99,111,110,100,105,116,105,111,110,95,118,97,114,105,97,98,108,101,32,119,97,105,116,32,102,97,105,108,101,100,0,109,117,116,101,120,32,108,111,99,107,32,102,97,105,108,101,100,0,101,99,32,61,61,32,48,0,47,85,115,101,114,115,47,121,97,105,114,47,68,111,119,110,108,111,97,100,115,47,101,109,115,100,107,45,112,111,114,116,97,98,108,101,47,101,109,115,99,114,105,112,116,101,110,47,49,46,51,55,46,50,50,47,115,121,115,116,101,109,47,108,105,98,47,108,105,98,99,120,120,47,109,117,116,101,120,46,99,112,112,0,117,110,108,111,99,107,0,98,97,115,105,99,95,115,116,114,105,110,103,0,117,110,115,112,101,99,105,102,105,101,100,32,103,101,110,101,114,105,99,95,99,97,116,101,103,111,114,121,32,101,114,114,111,114,0,85,110,107,110,111,119,110,32,101,114,114,111,114,32,37,100,0,110,101,119,95,101,114,114,110,111,32,61,61,32,69,82,65,78,71,69,0,47,85,115,101,114,115,47,121,97,105,114,47,68,111,119,110,108,111,97,100,115,47,101,109,115,100,107,45,112,111,114,116,97,98,108,101,47,101,109,115,99,114,105,112,116,101,110,47,49,46,51,55,46,50,50,47,115,121,115,116,101,109,47,108,105,98,47,108,105,98,99,120,120,47,115,121,115,116,101,109,95,101,114,114,111,114,46,99,112,112,0,100,111,95,115,116,114,101,114,114,111,114,95,114,0,103,101,110,101,114,105,99,0,78,83,116,51,95,95,50,50,52,95,95,103,101,110,101,114,105,99,95,101,114,114,111,114,95,99,97,116,101,103,111,114,121,69,0,78,83,116,51,95,95,50,49,50,95,95,100,111,95,109,101,115,115,97,103,101,69,0,78,83,116,51,95,95,50,49,52,101,114,114,111,114,95,99,97,116,101,103,111,114,121,69,0,117,110,115,112,101,99,105,102,105,101,100,32,115,121,115,116,101,109,95,99,97,116,101,103,111,114,121,32,101,114,114,111,114,0,115,121,115,116,101,109,0,78,83,116,51,95,95,50,50,51,95,95,115,121,115,116,101,109,95,101,114,114,111,114,95,99,97,116,101,103,111,114,121,69,0,78,83,116,51,95,95,50,49,50,115,121,115,116,101,109,95,101,114,114,111,114,69,0,58,32,0,95,95,116,104,114,101,97,100,95,115,112,101,99,105,102,105,99,95,112,116,114,32,99,111,110,115,116,114,117,99,116,105,111,110,32,102,97,105,108,101,100,0,116,101,114,109,105,110,97,116,105,110,103,32,119,105,116,104,32,37,115,32,101,120,99,101,112,116,105,111,110,32,111,102,32,116,121,112,101,32,37,115,58,32,37,115,0,116,101,114,109,105,110,97,116,105,110,103,32,119,105,116,104,32,37,115,32,101,120,99,101,112,116,105,111,110,32,111,102,32,116,121,112,101,32,37,115,0,116,101,114,109,105,110,97,116,105,110,103,32,119,105,116,104,32,37,115,32,102,111,114,101,105,103,110,32,101,120,99,101,112,116,105,111,110,0,116,101,114,109,105,110,97,116,105,110,103,0,117,110,99,97,117,103,104,116,0,83,116,57,101,120,99,101,112,116,105,111,110,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,54,95,95,115,104,105,109,95,116,121,112,101,95,105,110,102,111,69,0,83,116,57,116,121,112,101,95,105,110,102,111,0,78,49,48,95,95,99,120,120,97,98,105,118,49,50,48,95,95,115,105,95,99,108,97,115,115,95,116,121,112,101,95,105,110,102,111,69,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,55,95,95,99,108,97,115,115,95,116,121,112,101,95,105,110,102,111,69,0,112,116,104,114,101,97,100,95,111,110,99,101,32,102,97,105,108,117,114,101,32,105,110,32,95,95,99,120,97,95,103,101,116,95,103,108,111,98,97,108,115,95,102,97,115,116,40,41,0,99,97,110,110,111,116,32,99,114,101,97,116,101,32,112,116,104,114,101,97,100,32,107,101,121,32,102,111,114,32,95,95,99,120,97,95,103,101,116,95,103,108,111,98,97,108,115,40,41,0,99,97,110,110,111,116,32,122,101,114,111,32,111,117,116,32,116,104,114,101,97,100,32,118,97,108,117,101,32,102,111,114,32,95,95,99,120,97,95,103,101,116,95,103,108,111,98,97,108,115,40,41,0,116,101,114,109,105,110,97,116,101,95,104,97,110,100,108,101,114,32,117,110,101,120,112,101,99,116,101,100,108,121,32,114,101,116,117,114,110,101,100,0,116,101,114,109,105,110,97,116,101,95,104,97,110,100,108,101,114,32,117,110,101,120,112,101,99,116,101,100,108,121,32,116,104,114,101,119,32,97,110,32,101,120,99,101,112,116,105,111,110,0,115,116,100,58,58,98,97,100,95,97,108,108,111,99,0,83,116,57,98,97,100,95,97,108,108,111,99,0,83,116,49,49,108,111,103,105,99,95,101,114,114,111,114,0,83,116,49,51,114,117,110,116,105,109,101,95,101,114,114,111,114,0,83,116,49,50,108,101,110,103,116,104,95,101,114,114,111,114,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,57,95,95,112,111,105,110,116,101,114,95,116,121,112,101,95,105,110,102,111,69,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,55,95,95,112,98,97,115,101,95,116,121,112,101,95,105,110,102,111,69,0,78,49,48,95,95,99,120,120,97,98,105,118,49,50,51,95,95,102,117,110,100,97,109,101,110,116,97,108,95,116,121,112,101,95,105,110,102,111,69,0,118,0,98,0,99,0,104,0,97,0,115,0,116,0,105,0,106,0,108,0,109,0,102,0,100,0,78,49,48,95,95,99,120,120,97,98,105,118,49,50,49,95,95,118,109,105,95,99,108,97,115,115,95,116,121,112,101,95,105,110,102,111,69,0], "i8", ALLOC_NONE, Runtime.GLOBAL_BASE);
}





/* no memory initializer */
var tempDoublePtr;

if (!ENVIRONMENT_IS_PTHREAD) tempDoublePtr = Runtime.alignMemory(allocate(12, "i8", ALLOC_STATIC), 8);

assert(tempDoublePtr % 8 == 0);

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much

  HEAP8[tempDoublePtr] = HEAP8[ptr];

  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];

  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];

  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];

}

function copyTempDouble(ptr) {

  HEAP8[tempDoublePtr] = HEAP8[ptr];

  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];

  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];

  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];

  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];

  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];

  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];

  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];

}

// {{PRE_LIBRARY}}


  
  function _atexit(func, arg) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_2(110, func, arg);
      __ATEXIT__.unshift({ func: func, arg: arg });
    }function ___cxa_atexit() {
  return _atexit.apply(null, arguments)
  }

  
  var _tzname; if (ENVIRONMENT_IS_PTHREAD) _tzname = PthreadWorkerInit._tzname; else PthreadWorkerInit._tzname = _tzname = allocate(8, "i32*", ALLOC_STATIC);
  
  var _daylight; if (ENVIRONMENT_IS_PTHREAD) _daylight = PthreadWorkerInit._daylight; else PthreadWorkerInit._daylight = _daylight = allocate(1, "i32*", ALLOC_STATIC);
  
  var _timezone; if (ENVIRONMENT_IS_PTHREAD) _timezone = PthreadWorkerInit._timezone; else PthreadWorkerInit._timezone = _timezone = allocate(1, "i32*", ALLOC_STATIC);function _tzset() {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_0(119);
      // TODO: Use (malleable) environment variables instead of system settings.
      if (_tzset.called) return;
      _tzset.called = true;
  
      HEAP32[((_timezone)>>2)]=-(new Date()).getTimezoneOffset() * 60;
  
      var winter = new Date(2000, 0, 1);
      var summer = new Date(2000, 6, 1);
      HEAP32[((_daylight)>>2)]=Number(winter.getTimezoneOffset() != summer.getTimezoneOffset());
  
      function extractZone(date) {
        var match = date.toTimeString().match(/\(([A-Za-z ]+)\)$/);
        return match ? match[1] : "GMT";
      };
      var winterName = extractZone(winter);
      var summerName = extractZone(summer);
      var winterNamePtr = allocate(intArrayFromString(winterName), 'i8', ALLOC_NORMAL);
      var summerNamePtr = allocate(intArrayFromString(summerName), 'i8', ALLOC_NORMAL);
      if (summer.getTimezoneOffset() < winter.getTimezoneOffset()) {
        // Northern hemisphere
        HEAP32[((_tzname)>>2)]=winterNamePtr;
        HEAP32[(((_tzname)+(4))>>2)]=summerNamePtr;
      } else {
        HEAP32[((_tzname)>>2)]=summerNamePtr;
        HEAP32[(((_tzname)+(4))>>2)]=winterNamePtr;
      }
    }

   

   

  
  function __ZSt18uncaught_exceptionv() { // std::uncaught_exception()
      return !!__ZSt18uncaught_exceptionv.uncaught_exception;
    }
  
  
  
  var EXCEPTIONS={last:0,caught:[],infos:{},deAdjust:function (adjusted) {
        if (!adjusted || EXCEPTIONS.infos[adjusted]) return adjusted;
        for (var ptr in EXCEPTIONS.infos) {
          var info = EXCEPTIONS.infos[ptr];
          if (info.adjusted === adjusted) {
            return ptr;
          }
        }
        return adjusted;
      },addRef:function (ptr) {
        if (!ptr) return;
        var info = EXCEPTIONS.infos[ptr];
        info.refcount++;
      },decRef:function (ptr) {
        if (!ptr) return;
        var info = EXCEPTIONS.infos[ptr];
        assert(info.refcount > 0);
        info.refcount--;
        // A rethrown exception can reach refcount 0; it must not be discarded
        // Its next handler will clear the rethrown flag and addRef it, prior to
        // final decRef and destruction here
        if (info.refcount === 0 && !info.rethrown) {
          if (info.destructor) {
            Module['dynCall_vi'](info.destructor, ptr);
          }
          delete EXCEPTIONS.infos[ptr];
          ___cxa_free_exception(ptr);
        }
      },clearRef:function (ptr) {
        if (!ptr) return;
        var info = EXCEPTIONS.infos[ptr];
        info.refcount = 0;
      }};
  function ___resumeException(ptr) {
      if (!EXCEPTIONS.last) { EXCEPTIONS.last = ptr; }
      throw ptr;
    }function ___cxa_find_matching_catch() {
      var thrown = EXCEPTIONS.last;
      if (!thrown) {
        // just pass through the null ptr
        return ((Runtime.setTempRet0(0),0)|0);
      }
      var info = EXCEPTIONS.infos[thrown];
      var throwntype = info.type;
      if (!throwntype) {
        // just pass through the thrown ptr
        return ((Runtime.setTempRet0(0),thrown)|0);
      }
      var typeArray = Array.prototype.slice.call(arguments);
  
      var pointer = Module['___cxa_is_pointer_type'](throwntype);
      // can_catch receives a **, add indirection
      if (!___cxa_find_matching_catch.buffer) ___cxa_find_matching_catch.buffer = _malloc(4);
      HEAP32[((___cxa_find_matching_catch.buffer)>>2)]=thrown;
      thrown = ___cxa_find_matching_catch.buffer;
      // The different catch blocks are denoted by different types.
      // Due to inheritance, those types may not precisely match the
      // type of the thrown object. Find one which matches, and
      // return the type of the catch block which should be called.
      for (var i = 0; i < typeArray.length; i++) {
        if (typeArray[i] && Module['___cxa_can_catch'](typeArray[i], throwntype, thrown)) {
          thrown = HEAP32[((thrown)>>2)]; // undo indirection
          info.adjusted = thrown;
          return ((Runtime.setTempRet0(typeArray[i]),thrown)|0);
        }
      }
      // Shouldn't happen unless we have bogus data in typeArray
      // or encounter a type for which emscripten doesn't have suitable
      // typeinfo defined. Best-efforts match just in case.
      thrown = HEAP32[((thrown)>>2)]; // undo indirection
      return ((Runtime.setTempRet0(throwntype),thrown)|0);
    }function ___cxa_throw(ptr, type, destructor) {
      EXCEPTIONS.infos[ptr] = {
        ptr: ptr,
        adjusted: ptr,
        type: type,
        destructor: destructor,
        refcount: 0,
        caught: false,
        rethrown: false
      };
      EXCEPTIONS.last = ptr;
      if (!("uncaught_exception" in __ZSt18uncaught_exceptionv)) {
        __ZSt18uncaught_exceptionv.uncaught_exception = 1;
      } else {
        __ZSt18uncaught_exceptionv.uncaught_exception++;
      }
      throw ptr;
    }

  
  function getShiftFromSize(size) {
      switch (size) {
          case 1: return 0;
          case 2: return 1;
          case 4: return 2;
          case 8: return 3;
          default:
              throw new TypeError('Unknown type size: ' + size);
      }
    }
  
  
  
  function embind_init_charCodes() {
      var codes = new Array(256);
      for (var i = 0; i < 256; ++i) {
          codes[i] = String.fromCharCode(i);
      }
      embind_charCodes = codes;
    }var embind_charCodes=undefined;function readLatin1String(ptr) {
      var ret = "";
      var c = ptr;
      while (HEAPU8[c]) {
          ret += embind_charCodes[HEAPU8[c++]];
      }
      return ret;
    }
  
  
  var awaitingDependencies={};
  
  var registeredTypes={};
  
  var typeDependencies={};
  
  
  
  
  
  
  var char_0=48;
  
  var char_9=57;function makeLegalFunctionName(name) {
      if (undefined === name) {
          return '_unknown';
      }
      name = name.replace(/[^a-zA-Z0-9_]/g, '$');
      var f = name.charCodeAt(0);
      if (f >= char_0 && f <= char_9) {
          return '_' + name;
      } else {
          return name;
      }
    }function createNamedFunction(name, body) {
      name = makeLegalFunctionName(name);
      /*jshint evil:true*/
      return new Function(
          "body",
          "return function " + name + "() {\n" +
          "    \"use strict\";" +
          "    return body.apply(this, arguments);\n" +
          "};\n"
      )(body);
    }function extendError(baseErrorType, errorName) {
      var errorClass = createNamedFunction(errorName, function(message) {
          this.name = errorName;
          this.message = message;
  
          var stack = (new Error(message)).stack;
          if (stack !== undefined) {
              this.stack = this.toString() + '\n' +
                  stack.replace(/^Error(:[^\n]*)?\n/, '');
          }
      });
      errorClass.prototype = Object.create(baseErrorType.prototype);
      errorClass.prototype.constructor = errorClass;
      errorClass.prototype.toString = function() {
          if (this.message === undefined) {
              return this.name;
          } else {
              return this.name + ': ' + this.message;
          }
      };
  
      return errorClass;
    }var BindingError=undefined;function throwBindingError(message) {
      throw new BindingError(message);
    }
  
  
  
  var InternalError=undefined;function throwInternalError(message) {
      throw new InternalError(message);
    }function whenDependentTypesAreResolved(myTypes, dependentTypes, getTypeConverters) {
      myTypes.forEach(function(type) {
          typeDependencies[type] = dependentTypes;
      });
  
      function onComplete(typeConverters) {
          var myTypeConverters = getTypeConverters(typeConverters);
          if (myTypeConverters.length !== myTypes.length) {
              throwInternalError('Mismatched type converter count');
          }
          for (var i = 0; i < myTypes.length; ++i) {
              registerType(myTypes[i], myTypeConverters[i]);
          }
      }
  
      var typeConverters = new Array(dependentTypes.length);
      var unregisteredTypes = [];
      var registered = 0;
      dependentTypes.forEach(function(dt, i) {
          if (registeredTypes.hasOwnProperty(dt)) {
              typeConverters[i] = registeredTypes[dt];
          } else {
              unregisteredTypes.push(dt);
              if (!awaitingDependencies.hasOwnProperty(dt)) {
                  awaitingDependencies[dt] = [];
              }
              awaitingDependencies[dt].push(function() {
                  typeConverters[i] = registeredTypes[dt];
                  ++registered;
                  if (registered === unregisteredTypes.length) {
                      onComplete(typeConverters);
                  }
              });
          }
      });
      if (0 === unregisteredTypes.length) {
          onComplete(typeConverters);
      }
    }function registerType(rawType, registeredInstance, options) {
      options = options || {};
  
      if (!('argPackAdvance' in registeredInstance)) {
          throw new TypeError('registerType registeredInstance requires argPackAdvance');
      }
  
      var name = registeredInstance.name;
      if (!rawType) {
          throwBindingError('type "' + name + '" must have a positive integer typeid pointer');
      }
      if (registeredTypes.hasOwnProperty(rawType)) {
          if (options.ignoreDuplicateRegistrations) {
              return;
          } else {
              throwBindingError("Cannot register type '" + name + "' twice");
          }
      }
  
      registeredTypes[rawType] = registeredInstance;
      delete typeDependencies[rawType];
  
      if (awaitingDependencies.hasOwnProperty(rawType)) {
          var callbacks = awaitingDependencies[rawType];
          delete awaitingDependencies[rawType];
          callbacks.forEach(function(cb) {
              cb();
          });
      }
    }function __embind_register_bool(rawType, name, size, trueValue, falseValue) {
      var shift = getShiftFromSize(size);
  
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(wt) {
              // ambiguous emscripten ABI: sometimes return values are
              // true or false, and sometimes integers (0 or 1)
              return !!wt;
          },
          'toWireType': function(destructors, o) {
              return o ? trueValue : falseValue;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': function(pointer) {
              // TODO: if heap is fixed (like in asm.js) this could be executed outside
              var heap;
              if (size === 1) {
                  heap = HEAP8;
              } else if (size === 2) {
                  heap = HEAP16;
              } else if (size === 4) {
                  heap = HEAP32;
              } else {
                  throw new TypeError("Unknown boolean type size: " + name);
              }
              return this['fromWireType'](heap[pointer >> shift]);
          },
          destructorFunction: null, // This type does not need a destructor
      });
    }

  
  
  
  var PROCINFO={ppid:1,pid:42,sid:42,pgid:42};
  
  
  var __pthread_ptr=0;
  
  var __pthread_is_main_runtime_thread=0;
  
  var __pthread_is_main_browser_thread=0; var PThread={MAIN_THREAD_ID:1,mainThreadInfo:{schedPolicy:0,schedPrio:0},unusedWorkerPool:[],runningWorkers:[],initMainThreadBlock:function () {
        if (ENVIRONMENT_IS_PTHREAD) return undefined;
        PThread.mainThreadBlock = allocate(244, "i32*", ALLOC_STATIC);
  
        for (var i = 0; i < 244/4; ++i) HEAPU32[PThread.mainThreadBlock/4+i] = 0;
  
        // The pthread struct has a field that points to itself - this is used as a magic ID to detect whether the pthread_t
        // structure is 'alive'.
        HEAP32[(((PThread.mainThreadBlock)+(24))>>2)]=PThread.mainThreadBlock;
  
        // pthread struct robust_list head should point to itself.
        var headPtr = PThread.mainThreadBlock + 168;
        HEAP32[((headPtr)>>2)]=headPtr;
  
        // Allocate memory for thread-local storage.
        var tlsMemory = allocate(128 * 4, "i32*", ALLOC_STATIC);
        for (var i = 0; i < 128; ++i) HEAPU32[tlsMemory/4+i] = 0;
        Atomics.store(HEAPU32, (PThread.mainThreadBlock + 116 ) >> 2, tlsMemory); // Init thread-local-storage memory array.
        Atomics.store(HEAPU32, (PThread.mainThreadBlock + 52 ) >> 2, PThread.mainThreadBlock); // Main thread ID.
        Atomics.store(HEAPU32, (PThread.mainThreadBlock + 56 ) >> 2, PROCINFO.pid); // Process ID.
  
      },pthreads:{},pthreadIdCounter:2,exitHandlers:null,setThreadStatus:function () {},runExitHandlers:function () {
        if (PThread.exitHandlers !== null) {
          while (PThread.exitHandlers.length > 0) {
            PThread.exitHandlers.pop()();
          }
          PThread.exitHandlers = null;
        }
  
        // Call into the musl function that runs destructors of all thread-specific data.
        if (ENVIRONMENT_IS_PTHREAD && threadInfoStruct) ___pthread_tsd_run_dtors();
      },threadExit:function (exitCode) {
        var tb = _pthread_self();
        if (tb) { // If we haven't yet exited?
          Atomics.store(HEAPU32, (tb + 4 ) >> 2, exitCode);
          // When we publish this, the main thread is free to deallocate the thread object and we are done.
          // Therefore set threadInfoStruct = 0; above to 'release' the object in this worker thread.
          Atomics.store(HEAPU32, (tb + 0 ) >> 2, 1);
  
          // Disable all cancellation so that executing the cleanup handlers won't trigger another JS
          // canceled exception to be thrown.
          Atomics.store(HEAPU32, (tb + 72 ) >> 2, 1/*PTHREAD_CANCEL_DISABLE*/);
          Atomics.store(HEAPU32, (tb + 76 ) >> 2, 0/*PTHREAD_CANCEL_DEFERRED*/);
          PThread.runExitHandlers();
  
          _emscripten_futex_wake(tb + 0, 2147483647);
          __register_pthread_ptr(0, 0, 0); // Unregister the thread block also inside the asm.js scope.
          threadInfoStruct = 0;
          if (ENVIRONMENT_IS_PTHREAD) {
            // This worker no longer owns any WebGL OffscreenCanvases, so transfer them back to parent thread.
            var transferList = [];
  
  
            postMessage({ cmd: 'exit' });
          }
        }
      },threadCancel:function () {
        PThread.runExitHandlers();
        Atomics.store(HEAPU32, (threadInfoStruct + 4 ) >> 2, -1/*PTHREAD_CANCELED*/);
        Atomics.store(HEAPU32, (threadInfoStruct + 0 ) >> 2, 1); // Mark the thread as no longer running.
        _emscripten_futex_wake(threadInfoStruct + 0, 2147483647); // wake all threads
        threadInfoStruct = selfThreadId = 0; // Not hosting a pthread anymore in this worker, reset the info structures to null.
        __register_pthread_ptr(0, 0, 0); // Unregister the thread block also inside the asm.js scope.
        postMessage({ cmd: 'cancelDone' });
      },terminateAllThreads:function () {
        for (var t in PThread.pthreads) {
          var pthread = PThread.pthreads[t];
          if (pthread) {
            PThread.freeThreadData(pthread);
            if (pthread.worker) pthread.worker.terminate();
          }
        }
        PThread.pthreads = {};
        for (var t in PThread.unusedWorkerPool) {
          var pthread = PThread.unusedWorkerPool[t];
          if (pthread) {
            PThread.freeThreadData(pthread);
            if (pthread.worker) pthread.worker.terminate();
          }
        }
        PThread.unusedWorkerPool = [];
        for (var t in PThread.runningWorkers) {
          var pthread = PThread.runningWorkers[t];
          if (pthread) {
            PThread.freeThreadData(pthread);
            if (pthread.worker) pthread.worker.terminate();
          }
        }
        PThread.runningWorkers = [];
      },freeThreadData:function (pthread) {
        if (!pthread) return;
        if (pthread.threadInfoStruct) {
          var tlsMemory = HEAP32[(((pthread.threadInfoStruct)+(116))>>2)];
          HEAP32[(((pthread.threadInfoStruct)+(116))>>2)]=0;
          _free(pthread.tlsMemory);
          _free(pthread.threadInfoStruct);
        }
        pthread.threadInfoStruct = 0;
        if (pthread.allocatedOwnStack && pthread.stackBase) _free(pthread.stackBase);
        pthread.stackBase = 0;
        if (pthread.worker) pthread.worker.pthread = null;
      },receiveObjectTransfer:function (data) {
      },allocateUnusedWorkers:function (numWorkers, onFinishedLoading) {
        if (typeof SharedArrayBuffer === 'undefined') return; // No multithreading support, no-op.
        Module['print']('Preallocating ' + numWorkers + ' workers for a pthread spawn pool.');
  
        var numWorkersLoaded = 0;
        for (var i = 0; i < numWorkers; ++i) {
          var pthreadMainJs = 'pthread-main.js';
          // Allow HTML module to configure the location where the 'pthread-main.js' file will be loaded from,
          // either via Module.locateFile() function, or via Module.pthreadMainPrefixURL string. If neither
          // of these are passed, then the default URL 'pthread-main.js' relative to the main html file is loaded.
          if (typeof Module['locateFile'] === 'function') pthreadMainJs = Module['locateFile'](pthreadMainJs);
          else if (Module['pthreadMainPrefixURL']) pthreadMainJs = Module['pthreadMainPrefixURL'] + pthreadMainJs;
          var worker = new Worker(pthreadMainJs);
  
          worker.onmessage = function(e) {
            var d = e.data;
            // TODO: Move the proxied call mechanism into a queue inside heap.
            if (d.proxiedCall) {
              var returnValue;
              var funcTable = (d.func >= 0) ? proxiedFunctionTable : ASM_CONSTS;
              var funcIdx = (d.func >= 0) ? d.func : (-1 - d.func);
              PThread.currentProxiedOperationCallerThread = worker.pthread.threadInfoStruct; // Sometimes we need to backproxy events to the calling thread (e.g. HTML5 DOM events handlers such as emscripten_set_mousemove_callback()), so keep track in a globally accessible variable about the thread that initiated the proxying.
              switch(d.proxiedCall & 31) {
                case 1: returnValue = funcTable[funcIdx](); break;
                case 2: returnValue = funcTable[funcIdx](d.p0); break;
                case 3: returnValue = funcTable[funcIdx](d.p0, d.p1); break;
                case 4: returnValue = funcTable[funcIdx](d.p0, d.p1, d.p2); break;
                case 5: returnValue = funcTable[funcIdx](d.p0, d.p1, d.p2, d.p3); break;
                case 6: returnValue = funcTable[funcIdx](d.p0, d.p1, d.p2, d.p3, d.p4); break;
                case 7: returnValue = funcTable[funcIdx](d.p0, d.p1, d.p2, d.p3, d.p4, d.p5); break;
                case 8: returnValue = funcTable[funcIdx](d.p0, d.p1, d.p2, d.p3, d.p4, d.p5, d.p6); break;
                case 9: returnValue = funcTable[funcIdx](d.p0, d.p1, d.p2, d.p3, d.p4, d.p5, d.p6, d.p7); break;
                case 10: returnValue = funcTable[funcIdx](d.p0, d.p1, d.p2, d.p3, d.p4, d.p5, d.p6, d.p7, d.p8); break;
                default:
                  if (d.proxiedCall) {
                    Module['printErr']("worker sent an unknown proxied call idx " + d.proxiedCall);
                    console.error(e.data);
                  }
                  break;
              }
              if (d.returnValue) {
                if (d.proxiedCall < 32) HEAP32[d.returnValue >> 2] = returnValue;
                else HEAPF64[d.returnValue >> 3] = returnValue;
              }
              var waitAddress = d.waitAddress;
              if (waitAddress) {
                Atomics.store(HEAP32, waitAddress >> 2, 1);
                Atomics.wake(HEAP32, waitAddress >> 2, 1);
              }
              return;
            }
  
            // If this message is intended to a recipient that is not the main thread, forward it to the target thread.
            if (d.targetThread && d.targetThread != _pthread_self()) {
              var thread = PThread.pthreads[d.targetThread];
              if (thread) {
                thread.worker.postMessage(e.data, d.transferList);
              } else {
                console.error('Internal error! Worker sent a message "' + d.cmd + '" to target pthread ' + d.targetThread + ', but that thread no longer exists!');
              }
              return;
            }
  
            if (d.cmd === 'processQueuedMainThreadWork') {
              // TODO: Must post message to main Emscripten thread in PROXY_TO_WORKER mode.
              _emscripten_main_thread_process_queued_calls();
            } else if (d.cmd === 'spawnThread') {
              __spawn_thread(e.data);
            } else if (d.cmd === 'cleanupThread') {
              __cleanup_thread(d.thread);
            } else if (d.cmd === 'killThread') {
              __kill_thread(d.thread);
            } else if (d.cmd === 'cancelThread') {
              __cancel_thread(d.thread);
            } else if (d.cmd === 'loaded') {
              ++numWorkersLoaded;
              if (numWorkersLoaded === numWorkers && onFinishedLoading) {
                onFinishedLoading();
              }
            } else if (d.cmd === 'print') {
              Module['print']('Thread ' + d.threadId + ': ' + d.text);
            } else if (d.cmd === 'printErr') {
              Module['printErr']('Thread ' + d.threadId + ': ' + d.text);
            } else if (d.cmd === 'alert') {
              alert('Thread ' + d.threadId + ': ' + d.text);
            } else if (d.cmd === 'exit') {
              // currently no-op
            } else if (d.cmd === 'cancelDone') {
              PThread.freeThreadData(worker.pthread);
              worker.pthread = undefined; // Detach the worker from the pthread object, and return it to the worker pool as an unused worker.
              PThread.unusedWorkerPool.push(worker);
              // TODO: Free if detached.
              PThread.runningWorkers.splice(PThread.runningWorkers.indexOf(worker.pthread), 1); // Not a running Worker anymore.
            } else if (d.cmd === 'objectTransfer') {
              PThread.receiveObjectTransfer(e.data);
            } else {
              Module['printErr']("worker sent an unknown command " + d.cmd);
            }
          };
  
          worker.onerror = function(e) {
            Module['printErr']('pthread sent an error! ' + e.filename + ':' + e.lineno + ': ' + e.message);
          };
  
          // Allocate tempDoublePtr for the worker. This is done here on the worker's behalf, since we may need to do this statically
          // if the runtime has not been loaded yet, etc. - so we just use getMemory, which is main-thread only.
          var tempDoublePtr = getMemory(8); // TODO: leaks. Cleanup after worker terminates.
  
          // Ask the new worker to load up the Emscripten-compiled page. This is a heavy operation.
          worker.postMessage({
              cmd: 'load',
              // If the application main .js file was loaded from a Blob, then it is not possible
              // to access the URL of the current script that could be passed to a Web Worker so that
              // it could load up the same file. In that case, developer must either deliver the Blob
              // object in Module['mainScriptUrlOrBlob'], or a URL to it, so that pthread Workers can
              // independently load up the same main application file.
              urlOrBlob: Module['mainScriptUrlOrBlob'] || currentScriptUrl,
              buffer: HEAPU8.buffer,
              tempDoublePtr: tempDoublePtr,
              TOTAL_MEMORY: TOTAL_MEMORY,
              STATICTOP: STATICTOP,
              DYNAMIC_BASE: DYNAMIC_BASE,
              DYNAMICTOP_PTR: DYNAMICTOP_PTR,
              PthreadWorkerInit: PthreadWorkerInit
            });
          PThread.unusedWorkerPool.push(worker);
        }
      },getNewWorker:function () {
        if (PThread.unusedWorkerPool.length == 0) PThread.allocateUnusedWorkers(1);
        if (PThread.unusedWorkerPool.length > 0) return PThread.unusedWorkerPool.pop();
        else return null;
      },busySpinWait:function (msecs) {
        var t = performance.now() + msecs;
        while(performance.now() < t) {
          ;
        }
      }};function _emscripten_set_thread_name_js(threadId, name) {
    } 

  
  function simpleReadValueFromPointer(pointer) {
      return this['fromWireType'](HEAPU32[pointer >> 2]);
    }function __embind_register_std_string(rawType, name) {
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              var length = HEAPU32[value >> 2];
              var a = new Array(length);
              for (var i = 0; i < length; ++i) {
                  a[i] = String.fromCharCode(HEAPU8[value + 4 + i]);
              }
              _free(value);
              return a.join('');
          },
          'toWireType': function(destructors, value) {
              if (value instanceof ArrayBuffer) {
                  value = new Uint8Array(value);
              }
  
              function getTAElement(ta, index) {
                  return ta[index];
              }
              function getStringElement(string, index) {
                  return string.charCodeAt(index);
              }
              var getElement;
              if (value instanceof Uint8Array) {
                  getElement = getTAElement;
              } else if (value instanceof Uint8ClampedArray) {
                  getElement = getTAElement;
              } else if (value instanceof Int8Array) {
                  getElement = getTAElement;
              } else if (typeof value === 'string') {
                  getElement = getStringElement;
              } else {
                  throwBindingError('Cannot pass non-string to std::string');
              }
  
              // assumes 4-byte alignment
              var length = value.length;
              var ptr = _malloc(4 + length);
              HEAPU32[ptr >> 2] = length;
              for (var i = 0; i < length; ++i) {
                  var charCode = getElement(value, i);
                  if (charCode > 255) {
                      _free(ptr);
                      throwBindingError('String has UTF-16 code units that do not fit in 8 bits');
                  }
                  HEAPU8[ptr + 4 + i] = charCode;
              }
              if (destructors !== null) {
                  destructors.push(_free, ptr);
              }
              return ptr;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: function(ptr) { _free(ptr); },
      });
    }

  
  function _embind_repr(v) {
      if (v === null) {
          return 'null';
      }
      var t = typeof v;
      if (t === 'object' || t === 'array' || t === 'function') {
          return v.toString();
      } else {
          return '' + v;
      }
    }
  
  function integerReadValueFromPointer(name, shift, signed) {
      // integers are quite common, so generate very specialized functions
      switch (shift) {
          case 0: return signed ?
              function readS8FromPointer(pointer) { return HEAP8[pointer]; } :
              function readU8FromPointer(pointer) { return HEAPU8[pointer]; };
          case 1: return signed ?
              function readS16FromPointer(pointer) { return HEAP16[pointer >> 1]; } :
              function readU16FromPointer(pointer) { return HEAPU16[pointer >> 1]; };
          case 2: return signed ?
              function readS32FromPointer(pointer) { return HEAP32[pointer >> 2]; } :
              function readU32FromPointer(pointer) { return HEAPU32[pointer >> 2]; };
          default:
              throw new TypeError("Unknown integer type: " + name);
      }
    }function __embind_register_integer(primitiveType, name, size, minRange, maxRange) {
      name = readLatin1String(name);
      if (maxRange === -1) { // LLVM doesn't have signed and unsigned 32-bit types, so u32 literals come out as 'i32 -1'. Always treat those as max u32.
          maxRange = 4294967295;
      }
  
      var shift = getShiftFromSize(size);
      
      var fromWireType = function(value) {
          return value;
      };
      
      if (minRange === 0) {
          var bitshift = 32 - 8*size;
          fromWireType = function(value) {
              return (value << bitshift) >>> bitshift;
          };
      }
  
      var isUnsignedType = (name.indexOf('unsigned') != -1);
  
      registerType(primitiveType, {
          name: name,
          'fromWireType': fromWireType,
          'toWireType': function(destructors, value) {
              // todo: Here we have an opportunity for -O3 level "unsafe" optimizations: we could
              // avoid the following two if()s and assume value is of proper type.
              if (typeof value !== "number" && typeof value !== "boolean") {
                  throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
              }
              if (value < minRange || value > maxRange) {
                  throw new TypeError('Passing a number "' + _embind_repr(value) + '" from JS side to C/C++ side to an argument of type "' + name + '", which is outside the valid range [' + minRange + ', ' + maxRange + ']!');
              }
              return isUnsignedType ? (value >>> 0) : (value | 0);
          },
          'argPackAdvance': 8,
          'readValueFromPointer': integerReadValueFromPointer(name, shift, minRange !== 0),
          destructorFunction: null, // This type does not need a destructor
      });
    }

  
  function __spawn_thread(threadParams) {
      if (ENVIRONMENT_IS_PTHREAD) throw 'Internal Error! _spawn_thread() can only ever be called from main application thread!';
  
      var worker = PThread.getNewWorker();
      if (worker.pthread !== undefined) throw 'Internal error!';
      if (!threadParams.pthread_ptr) throw 'Internal error, no pthread ptr!';
      PThread.runningWorkers.push(worker);
  
      // Allocate memory for thread-local storage and initialize it to zero.
      var tlsMemory = _malloc(128 * 4);
      for (var i = 0; i < 128; ++i) {
        HEAP32[(((tlsMemory)+(i*4))>>2)]=0;
      }
  
      var pthread = PThread.pthreads[threadParams.pthread_ptr] = { // Create a pthread info object to represent this thread.
        worker: worker,
        stackBase: threadParams.stackBase,
        stackSize: threadParams.stackSize,
        allocatedOwnStack: threadParams.allocatedOwnStack,
        thread: threadParams.pthread_ptr,
        threadInfoStruct: threadParams.pthread_ptr // Info area for this thread in Emscripten HEAP (shared)
      };
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 0 ) >> 2, 0); // threadStatus <- 0, meaning not yet exited.
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 4 ) >> 2, 0); // threadExitCode <- 0.
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 20 ) >> 2, 0); // profilerBlock <- 0.
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 80 ) >> 2, threadParams.detached);
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 116 ) >> 2, tlsMemory); // Init thread-local-storage memory array.
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 60 ) >> 2, 0); // Mark initial status to unused.
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 52 ) >> 2, pthread.threadInfoStruct); // Main thread ID.
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 56 ) >> 2, PROCINFO.pid); // Process ID.
  
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 120) >> 2, threadParams.stackSize);
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 96) >> 2, threadParams.stackSize);
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 92) >> 2, threadParams.stackBase);
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 120 + 8) >> 2, threadParams.stackBase);
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 120 + 12) >> 2, threadParams.detached);
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 120 + 20) >> 2, threadParams.schedPolicy);
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 120 + 24) >> 2, threadParams.schedPrio);
  
      var global_libc = _emscripten_get_global_libc();
      var global_locale = global_libc + 40;
      Atomics.store(HEAPU32, (pthread.threadInfoStruct + 188) >> 2, global_locale);
  
  
      worker.pthread = pthread;
  
      // Ask the worker to start executing its pthread entry point function.
      worker.postMessage({
        cmd: 'run',
        start_routine: threadParams.startRoutine,
        arg: threadParams.arg,
        threadInfoStruct: threadParams.pthread_ptr,
        selfThreadId: threadParams.pthread_ptr, // TODO: Remove this since thread ID is now the same as the thread address.
        parentThreadId: threadParams.parent_pthread_ptr,
        stackBase: threadParams.stackBase,
        stackSize: threadParams.stackSize,
      }, threadParams.transferList);
    }
  
  function _pthread_getschedparam(thread, policy, schedparam) {
      if (!policy && !schedparam) return ERRNO_CODES.EINVAL;
  
      if (!thread) {
        Module['printErr']('pthread_getschedparam called with a null thread pointer!');
        return ERRNO_CODES.ESRCH;
      }
      var self = HEAP32[(((thread)+(24))>>2)];
      if (self != thread) {
        Module['printErr']('pthread_getschedparam attempted on thread ' + thread + ', which does not point to a valid thread, or does not exist anymore!');
        return ERRNO_CODES.ESRCH;
      }
  
      var schedPolicy = Atomics.load(HEAPU32, (thread + 120 + 20 ) >> 2);
      var schedPrio = Atomics.load(HEAPU32, (thread + 120 + 24 ) >> 2);
  
      if (policy) HEAP32[((policy)>>2)]=schedPolicy;
      if (schedparam) HEAP32[((schedparam)>>2)]=schedPrio;
      return 0;
    }
  
   function _pthread_create(pthread_ptr, attr, start_routine, arg) {
      if (typeof SharedArrayBuffer === 'undefined') {
        Module['printErr']('Current environment does not support SharedArrayBuffer, pthreads are not available!');
        return 11;
      }
      if (!pthread_ptr) {
        Module['printErr']('pthread_create called with a null thread pointer!');
        return 22;
      }
  
      var transferList = []; // List of JS objects that will transfer ownership to the Worker hosting the thread
  
  
      // Synchronously proxy the thread creation to main thread if possible. If we need to transfer ownership of objects, then
      // proxy asynchronously via postMessage.
      if (ENVIRONMENT_IS_PTHREAD && transferList.length == 0) {
        return _emscripten_sync_run_in_main_thread_4(137, pthread_ptr, attr, start_routine, arg);
      }
  
      var stackSize = 0;
      var stackBase = 0;
      var detached = 0; // Default thread attr is PTHREAD_CREATE_JOINABLE, i.e. start as not detached.
      var schedPolicy = 0; /*SCHED_OTHER*/
      var schedPrio = 0;
      if (attr) {
        stackSize = HEAP32[((attr)>>2)];
        stackBase = HEAP32[(((attr)+(8))>>2)];
        detached = HEAP32[(((attr)+(12))>>2)] != 0/*PTHREAD_CREATE_JOINABLE*/;
        var inheritSched = HEAP32[(((attr)+(16))>>2)] == 0/*PTHREAD_INHERIT_SCHED*/;
        if (inheritSched) {
          var prevSchedPolicy = HEAP32[(((attr)+(20))>>2)];
          var prevSchedPrio = HEAP32[(((attr)+(24))>>2)];
          _pthread_getschedparam(_pthread_self(), attr + 20, attr + 24);
          schedPolicy = HEAP32[(((attr)+(20))>>2)];
          schedPrio = HEAP32[(((attr)+(24))>>2)];
          HEAP32[(((attr)+(20))>>2)]=prevSchedPolicy;
          HEAP32[(((attr)+(24))>>2)]=prevSchedPrio;
        } else {
          schedPolicy = HEAP32[(((attr)+(20))>>2)];
          schedPrio = HEAP32[(((attr)+(24))>>2)];
        }
      }
      stackSize += 81920 /*DEFAULT_STACK_SIZE*/;
      var allocatedOwnStack = stackBase == 0; // If allocatedOwnStack == true, then the pthread impl maintains the stack allocation.
      if (allocatedOwnStack) {
        stackBase = _malloc(stackSize); // Allocate a stack if the user doesn't want to place the stack in a custom memory area.
      } else {
        // Musl stores the stack base address assuming stack grows downwards, so adjust it to Emscripten convention that the
        // stack grows upwards instead.
        stackBase -= stackSize;
        assert(stackBase > 0);
      }
  
      // Allocate thread block (pthread_t structure).
      var threadInfoStruct = _malloc(244);
      for (var i = 0; i < 244 >> 2; ++i) HEAPU32[(threadInfoStruct>>2) + i] = 0; // zero-initialize thread structure.
      HEAP32[((pthread_ptr)>>2)]=threadInfoStruct;
  
      // The pthread struct has a field that points to itself - this is used as a magic ID to detect whether the pthread_t
      // structure is 'alive'.
      HEAP32[(((threadInfoStruct)+(24))>>2)]=threadInfoStruct;
  
      // pthread struct robust_list head should point to itself.
      var headPtr = threadInfoStruct + 168;
      HEAP32[((headPtr)>>2)]=headPtr;
  
      var threadParams = {
        stackBase: stackBase,
        stackSize: stackSize,
        allocatedOwnStack: allocatedOwnStack,
        schedPolicy: schedPolicy,
        schedPrio: schedPrio,
        detached: detached,
        startRoutine: start_routine,
        pthread_ptr: threadInfoStruct,
        parent_pthread_ptr: _pthread_self(),
        arg: arg,
        transferList: transferList
      };
  
      if (ENVIRONMENT_IS_PTHREAD) {
        // The prepopulated pool of web workers that can host pthreads is stored in the main JS thread. Therefore if a
        // pthread is attempting to spawn a new thread, the thread creation must be deferred to the main JS thread.
        threadParams.cmd = 'spawnThread';
        postMessage(threadParams, transferList);
      } else {
        // We are the main thread, so we have the pthread warmup pool in this thread and can fire off JS thread creation
        // directly ourselves.
        __spawn_thread(threadParams);
      }
  
      return 0;
    }

  
  function ___setErrNo(value) {
      if (Module['___errno_location']) HEAP32[((Module['___errno_location']())>>2)]=value;
      else Module.printErr('failed to set errno from JS');
      return value;
    }
  
  var ERRNO_CODES={EPERM:1,ENOENT:2,ESRCH:3,EINTR:4,EIO:5,ENXIO:6,E2BIG:7,ENOEXEC:8,EBADF:9,ECHILD:10,EAGAIN:11,EWOULDBLOCK:11,ENOMEM:12,EACCES:13,EFAULT:14,ENOTBLK:15,EBUSY:16,EEXIST:17,EXDEV:18,ENODEV:19,ENOTDIR:20,EISDIR:21,EINVAL:22,ENFILE:23,EMFILE:24,ENOTTY:25,ETXTBSY:26,EFBIG:27,ENOSPC:28,ESPIPE:29,EROFS:30,EMLINK:31,EPIPE:32,EDOM:33,ERANGE:34,ENOMSG:42,EIDRM:43,ECHRNG:44,EL2NSYNC:45,EL3HLT:46,EL3RST:47,ELNRNG:48,EUNATCH:49,ENOCSI:50,EL2HLT:51,EDEADLK:35,ENOLCK:37,EBADE:52,EBADR:53,EXFULL:54,ENOANO:55,EBADRQC:56,EBADSLT:57,EDEADLOCK:35,EBFONT:59,ENOSTR:60,ENODATA:61,ETIME:62,ENOSR:63,ENONET:64,ENOPKG:65,EREMOTE:66,ENOLINK:67,EADV:68,ESRMNT:69,ECOMM:70,EPROTO:71,EMULTIHOP:72,EDOTDOT:73,EBADMSG:74,ENOTUNIQ:76,EBADFD:77,EREMCHG:78,ELIBACC:79,ELIBBAD:80,ELIBSCN:81,ELIBMAX:82,ELIBEXEC:83,ENOSYS:38,ENOTEMPTY:39,ENAMETOOLONG:36,ELOOP:40,EOPNOTSUPP:95,EPFNOSUPPORT:96,ECONNRESET:104,ENOBUFS:105,EAFNOSUPPORT:97,EPROTOTYPE:91,ENOTSOCK:88,ENOPROTOOPT:92,ESHUTDOWN:108,ECONNREFUSED:111,EADDRINUSE:98,ECONNABORTED:103,ENETUNREACH:101,ENETDOWN:100,ETIMEDOUT:110,EHOSTDOWN:112,EHOSTUNREACH:113,EINPROGRESS:115,EALREADY:114,EDESTADDRREQ:89,EMSGSIZE:90,EPROTONOSUPPORT:93,ESOCKTNOSUPPORT:94,EADDRNOTAVAIL:99,ENETRESET:102,EISCONN:106,ENOTCONN:107,ETOOMANYREFS:109,EUSERS:87,EDQUOT:122,ESTALE:116,ENOTSUP:95,ENOMEDIUM:123,EILSEQ:84,EOVERFLOW:75,ECANCELED:125,ENOTRECOVERABLE:131,EOWNERDEAD:130,ESTRPIPE:86};function _sysconf(name) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_1(72, name);
      // long sysconf(int name);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/sysconf.html
      switch(name) {
        case 30: return PAGE_SIZE;
        case 85:
          var maxHeapSize = 2*1024*1024*1024 - 16777216;
          maxHeapSize = HEAPU8.length;
          return maxHeapSize / PAGE_SIZE;
        case 132:
        case 133:
        case 12:
        case 137:
        case 138:
        case 15:
        case 235:
        case 16:
        case 17:
        case 18:
        case 19:
        case 20:
        case 149:
        case 13:
        case 10:
        case 236:
        case 153:
        case 9:
        case 21:
        case 22:
        case 159:
        case 154:
        case 14:
        case 77:
        case 78:
        case 139:
        case 80:
        case 81:
        case 82:
        case 68:
        case 67:
        case 164:
        case 11:
        case 29:
        case 47:
        case 48:
        case 95:
        case 52:
        case 51:
        case 46:
          return 200809;
        case 79:
          return 0;
        case 27:
        case 246:
        case 127:
        case 128:
        case 23:
        case 24:
        case 160:
        case 161:
        case 181:
        case 182:
        case 242:
        case 183:
        case 184:
        case 243:
        case 244:
        case 245:
        case 165:
        case 178:
        case 179:
        case 49:
        case 50:
        case 168:
        case 169:
        case 175:
        case 170:
        case 171:
        case 172:
        case 97:
        case 76:
        case 32:
        case 173:
        case 35:
          return -1;
        case 176:
        case 177:
        case 7:
        case 155:
        case 8:
        case 157:
        case 125:
        case 126:
        case 92:
        case 93:
        case 129:
        case 130:
        case 131:
        case 94:
        case 91:
          return 1;
        case 74:
        case 60:
        case 69:
        case 70:
        case 4:
          return 1024;
        case 31:
        case 42:
        case 72:
          return 32;
        case 87:
        case 26:
        case 33:
          return 2147483647;
        case 34:
        case 1:
          return 47839;
        case 38:
        case 36:
          return 99;
        case 43:
        case 37:
          return 2048;
        case 0: return 2097152;
        case 3: return 65536;
        case 28: return 32768;
        case 44: return 32767;
        case 75: return 16384;
        case 39: return 1000;
        case 89: return 700;
        case 71: return 256;
        case 40: return 255;
        case 2: return 100;
        case 180: return 64;
        case 25: return 20;
        case 5: return 16;
        case 6: return 6;
        case 73: return 4;
        case 84: {
          if (typeof navigator === 'object') return navigator['hardwareConcurrency'] || 1;
          return 1;
        }
      }
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }

  
  
  
  
  var _environ; if (ENVIRONMENT_IS_PTHREAD) _environ = PthreadWorkerInit._environ; else PthreadWorkerInit._environ = _environ = allocate(1, "i32*", ALLOC_STATIC);var ___environ=_environ;function ___buildEnvironment(env) {
      // WARNING: Arbitrary limit!
      var MAX_ENV_VALUES = 64;
      var TOTAL_ENV_SIZE = 1024;
  
      // Statically allocate memory for the environment.
      var poolPtr;
      var envPtr;
      if (!___buildEnvironment.called) {
        ___buildEnvironment.called = true;
        // Set default values. Use string keys for Closure Compiler compatibility.
        ENV['USER'] = ENV['LOGNAME'] = 'web_user';
        ENV['PATH'] = '/';
        ENV['PWD'] = '/';
        ENV['HOME'] = '/home/web_user';
        ENV['LANG'] = 'C';
        ENV['_'] = Module['thisProgram'];
        // Allocate memory.
        poolPtr = allocate(TOTAL_ENV_SIZE, 'i8', ALLOC_STATIC);
        envPtr = allocate(MAX_ENV_VALUES * 4,
                          'i8*', ALLOC_STATIC);
        HEAP32[((envPtr)>>2)]=poolPtr;
        HEAP32[((_environ)>>2)]=envPtr;
      } else {
        envPtr = HEAP32[((_environ)>>2)];
        poolPtr = HEAP32[((envPtr)>>2)];
      }
  
      // Collect key=value lines.
      var strings = [];
      var totalSize = 0;
      for (var key in env) {
        if (typeof env[key] === 'string') {
          var line = key + '=' + env[key];
          strings.push(line);
          totalSize += line.length;
        }
      }
      if (totalSize > TOTAL_ENV_SIZE) {
        throw new Error('Environment size exceeded TOTAL_ENV_SIZE!');
      }
  
      // Make new.
      var ptrSize = 4;
      for (var i = 0; i < strings.length; i++) {
        var line = strings[i];
        writeAsciiToMemory(line, poolPtr);
        HEAP32[(((envPtr)+(i * ptrSize))>>2)]=poolPtr;
        poolPtr += line.length + 1;
      }
      HEAP32[(((envPtr)+(strings.length * ptrSize))>>2)]=0;
    }var ENV={};function _putenv(string) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_1(115, string);
      // int putenv(char *string);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/putenv.html
      // WARNING: According to the standard (and the glibc implementation), the
      //          string is taken by reference so future changes are reflected.
      //          We copy it instead, possibly breaking some uses.
      if (string === 0) {
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
      }
      string = Pointer_stringify(string);
      var splitPoint = string.indexOf('=')
      if (string === '' || string.indexOf('=') === -1) {
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
      }
      var name = string.slice(0, splitPoint);
      var value = string.slice(splitPoint + 1);
      if (!(name in ENV) || ENV[name] !== value) {
        ENV[name] = value;
        ___buildEnvironment(ENV);
      }
      return 0;
    }

  function ___call_main(argc, argv) {
      return _main(argc, argv);
    }

  function _emscripten_get_now() { abort() }

  
  
  
  var ERRNO_MESSAGES={0:"Success",1:"Not super-user",2:"No such file or directory",3:"No such process",4:"Interrupted system call",5:"I/O error",6:"No such device or address",7:"Arg list too long",8:"Exec format error",9:"Bad file number",10:"No children",11:"No more processes",12:"Not enough core",13:"Permission denied",14:"Bad address",15:"Block device required",16:"Mount device busy",17:"File exists",18:"Cross-device link",19:"No such device",20:"Not a directory",21:"Is a directory",22:"Invalid argument",23:"Too many open files in system",24:"Too many open files",25:"Not a typewriter",26:"Text file busy",27:"File too large",28:"No space left on device",29:"Illegal seek",30:"Read only file system",31:"Too many links",32:"Broken pipe",33:"Math arg out of domain of func",34:"Math result not representable",35:"File locking deadlock error",36:"File or path name too long",37:"No record locks available",38:"Function not implemented",39:"Directory not empty",40:"Too many symbolic links",42:"No message of desired type",43:"Identifier removed",44:"Channel number out of range",45:"Level 2 not synchronized",46:"Level 3 halted",47:"Level 3 reset",48:"Link number out of range",49:"Protocol driver not attached",50:"No CSI structure available",51:"Level 2 halted",52:"Invalid exchange",53:"Invalid request descriptor",54:"Exchange full",55:"No anode",56:"Invalid request code",57:"Invalid slot",59:"Bad font file fmt",60:"Device not a stream",61:"No data (for no delay io)",62:"Timer expired",63:"Out of streams resources",64:"Machine is not on the network",65:"Package not installed",66:"The object is remote",67:"The link has been severed",68:"Advertise error",69:"Srmount error",70:"Communication error on send",71:"Protocol error",72:"Multihop attempted",73:"Cross mount point (not really error)",74:"Trying to read unreadable message",75:"Value too large for defined data type",76:"Given log. name not unique",77:"f.d. invalid for this operation",78:"Remote address changed",79:"Can   access a needed shared lib",80:"Accessing a corrupted shared lib",81:".lib section in a.out corrupted",82:"Attempting to link in too many libs",83:"Attempting to exec a shared library",84:"Illegal byte sequence",86:"Streams pipe error",87:"Too many users",88:"Socket operation on non-socket",89:"Destination address required",90:"Message too long",91:"Protocol wrong type for socket",92:"Protocol not available",93:"Unknown protocol",94:"Socket type not supported",95:"Not supported",96:"Protocol family not supported",97:"Address family not supported by protocol family",98:"Address already in use",99:"Address not available",100:"Network interface is not configured",101:"Network is unreachable",102:"Connection reset by network",103:"Connection aborted",104:"Connection reset by peer",105:"No buffer space available",106:"Socket is already connected",107:"Socket is not connected",108:"Can't send after socket shutdown",109:"Too many references",110:"Connection timed out",111:"Connection refused",112:"Host is down",113:"Host is unreachable",114:"Socket already connected",115:"Connection already in progress",116:"Stale file handle",122:"Quota exceeded",123:"No medium (in tape drive)",125:"Operation canceled",130:"Previous owner died",131:"State not recoverable"};
  
  var PATH={splitPath:function (filename) {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },normalizeArray:function (parts, allowAboveRoot) {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up; up--) {
            parts.unshift('..');
          }
        }
        return parts;
      },normalize:function (path) {
        var isAbsolute = path.charAt(0) === '/',
            trailingSlash = path.substr(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },dirname:function (path) {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.substr(0, dir.length - 1);
        }
        return root + dir;
      },basename:function (path) {
        // EMSCRIPTEN return '/'' for '/', not an empty string
        if (path === '/') return '/';
        var lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return path;
        return path.substr(lastSlash+1);
      },extname:function (path) {
        return PATH.splitPath(path)[3];
      },join:function () {
        var paths = Array.prototype.slice.call(arguments, 0);
        return PATH.normalize(paths.join('/'));
      },join2:function (l, r) {
        return PATH.normalize(l + '/' + r);
      },resolve:function () {
        var resolvedPath = '',
          resolvedAbsolute = false;
        for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
          var path = (i >= 0) ? arguments[i] : FS.cwd();
          // Skip empty and invalid entries
          if (typeof path !== 'string') {
            throw new TypeError('Arguments to path.resolve must be strings');
          } else if (!path) {
            return ''; // an invalid portion invalidates the whole thing
          }
          resolvedPath = path + '/' + resolvedPath;
          resolvedAbsolute = path.charAt(0) === '/';
        }
        // At this point the path should be resolved to a full absolute path, but
        // handle relative paths to be safe (might happen when process.cwd() fails)
        resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter(function(p) {
          return !!p;
        }), !resolvedAbsolute).join('/');
        return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
      },relative:function (from, to) {
        from = PATH.resolve(from).substr(1);
        to = PATH.resolve(to).substr(1);
        function trim(arr) {
          var start = 0;
          for (; start < arr.length; start++) {
            if (arr[start] !== '') break;
          }
          var end = arr.length - 1;
          for (; end >= 0; end--) {
            if (arr[end] !== '') break;
          }
          if (start > end) return [];
          return arr.slice(start, end - start + 1);
        }
        var fromParts = trim(from.split('/'));
        var toParts = trim(to.split('/'));
        var length = Math.min(fromParts.length, toParts.length);
        var samePartsLength = length;
        for (var i = 0; i < length; i++) {
          if (fromParts[i] !== toParts[i]) {
            samePartsLength = i;
            break;
          }
        }
        var outputParts = [];
        for (var i = samePartsLength; i < fromParts.length; i++) {
          outputParts.push('..');
        }
        outputParts = outputParts.concat(toParts.slice(samePartsLength));
        return outputParts.join('/');
      }};
  
  var TTY={ttys:[],init:function () {
        // https://github.com/kripken/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
        //   // device, it always assumes it's a TTY device. because of this, we're forcing
        //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
        //   // with text files until FS.init can be refactored.
        //   process['stdin']['setEncoding']('utf8');
        // }
      },shutdown:function () {
        // https://github.com/kripken/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process['stdin']['pause']();
        // }
      },register:function (dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },stream_ops:{open:function (stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
          }
          stream.tty = tty;
          stream.seekable = false;
        },close:function (stream) {
          // flush any pending line data
          stream.tty.ops.flush(stream.tty);
        },flush:function (stream) {
          stream.tty.ops.flush(stream.tty);
        },read:function (stream, buffer, offset, length, pos /* ignored */) {
          if (!stream.tty || !stream.tty.ops.get_char) {
            throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
          }
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = stream.tty.ops.get_char(stream.tty);
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
            }
            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset+i] = result;
          }
          if (bytesRead) {
            stream.node.timestamp = Date.now();
          }
          return bytesRead;
        },write:function (stream, buffer, offset, length, pos) {
          if (!stream.tty || !stream.tty.ops.put_char) {
            throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
          }
          for (var i = 0; i < length; i++) {
            try {
              stream.tty.ops.put_char(stream.tty, buffer[offset+i]);
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
          }
          if (length) {
            stream.node.timestamp = Date.now();
          }
          return i;
        }},default_tty_ops:{get_char:function (tty) {
          if (!tty.input.length) {
            var result = null;
            if (ENVIRONMENT_IS_NODE) {
              // we will read data by chunks of BUFSIZE
              var BUFSIZE = 256;
              var buf = new Buffer(BUFSIZE);
              var bytesRead = 0;
  
              var isPosixPlatform = (process.platform != 'win32'); // Node doesn't offer a direct check, so test by exclusion
  
              var fd = process.stdin.fd;
              if (isPosixPlatform) {
                // Linux and Mac cannot use process.stdin.fd (which isn't set up as sync)
                var usingDevice = false;
                try {
                  fd = fs.openSync('/dev/stdin', 'r');
                  usingDevice = true;
                } catch (e) {}
              }
  
              try {
                bytesRead = fs.readSync(fd, buf, 0, BUFSIZE, null);
              } catch(e) {
                // Cross-platform differences: on Windows, reading EOF throws an exception, but on other OSes,
                // reading EOF returns 0. Uniformize behavior by treating the EOF exception to return 0.
                if (e.toString().indexOf('EOF') != -1) bytesRead = 0;
                else throw e;
              }
  
              if (usingDevice) { fs.closeSync(fd); }
              if (bytesRead > 0) {
                result = buf.slice(0, bytesRead).toString('utf-8');
              } else {
                result = null;
              }
  
            } else if (typeof window != 'undefined' &&
              typeof window.prompt == 'function') {
              // Browser.
              result = window.prompt('Input: ');  // returns null on cancel
              if (result !== null) {
                result += '\n';
              }
            } else if (typeof readline == 'function') {
              // Command line.
              result = readline();
              if (result !== null) {
                result += '\n';
              }
            }
            if (!result) {
              return null;
            }
            tty.input = intArrayFromString(result, true);
          }
          return tty.input.shift();
        },put_char:function (tty, val) {
          if (val === null || val === 10) {
            Module['print'](UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val); // val == 0 would cut text output off in the middle.
          }
        },flush:function (tty) {
          if (tty.output && tty.output.length > 0) {
            Module['print'](UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          }
        }},default_tty1_ops:{put_char:function (tty, val) {
          if (val === null || val === 10) {
            Module['printErr'](UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val);
          }
        },flush:function (tty) {
          if (tty.output && tty.output.length > 0) {
            Module['printErr'](UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          }
        }}};
  
  var MEMFS={ops_table:null,mount:function (mount) {
        return MEMFS.createNode(null, '/', 16384 | 511 /* 0777 */, 0);
      },createNode:function (parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
          // no supported
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (!MEMFS.ops_table) {
          MEMFS.ops_table = {
            dir: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                lookup: MEMFS.node_ops.lookup,
                mknod: MEMFS.node_ops.mknod,
                rename: MEMFS.node_ops.rename,
                unlink: MEMFS.node_ops.unlink,
                rmdir: MEMFS.node_ops.rmdir,
                readdir: MEMFS.node_ops.readdir,
                symlink: MEMFS.node_ops.symlink
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek
              }
            },
            file: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek,
                read: MEMFS.stream_ops.read,
                write: MEMFS.stream_ops.write,
                allocate: MEMFS.stream_ops.allocate,
                mmap: MEMFS.stream_ops.mmap,
                msync: MEMFS.stream_ops.msync
              }
            },
            link: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                readlink: MEMFS.node_ops.readlink
              },
              stream: {}
            },
            chrdev: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: FS.chrdev_stream_ops
            }
          };
        }
        var node = FS.createNode(parent, name, mode, dev);
        if (FS.isDir(node.mode)) {
          node.node_ops = MEMFS.ops_table.dir.node;
          node.stream_ops = MEMFS.ops_table.dir.stream;
          node.contents = {};
        } else if (FS.isFile(node.mode)) {
          node.node_ops = MEMFS.ops_table.file.node;
          node.stream_ops = MEMFS.ops_table.file.stream;
          node.usedBytes = 0; // The actual number of bytes used in the typed array, as opposed to contents.length which gives the whole capacity.
          // When the byte data of the file is populated, this will point to either a typed array, or a normal JS array. Typed arrays are preferred
          // for performance, and used by default. However, typed arrays are not resizable like normal JS arrays are, so there is a small disk size
          // penalty involved for appending file writes that continuously grow a file similar to std::vector capacity vs used -scheme.
          node.contents = null; 
        } else if (FS.isLink(node.mode)) {
          node.node_ops = MEMFS.ops_table.link.node;
          node.stream_ops = MEMFS.ops_table.link.stream;
        } else if (FS.isChrdev(node.mode)) {
          node.node_ops = MEMFS.ops_table.chrdev.node;
          node.stream_ops = MEMFS.ops_table.chrdev.stream;
        }
        node.timestamp = Date.now();
        // add the new node to the parent
        if (parent) {
          parent.contents[name] = node;
        }
        return node;
      },getFileDataAsRegularArray:function (node) {
        if (node.contents && node.contents.subarray) {
          var arr = [];
          for (var i = 0; i < node.usedBytes; ++i) arr.push(node.contents[i]);
          return arr; // Returns a copy of the original data.
        }
        return node.contents; // No-op, the file contents are already in a JS array. Return as-is.
      },getFileDataAsTypedArray:function (node) {
        if (!node.contents) return new Uint8Array;
        if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes); // Make sure to not return excess unused bytes.
        return new Uint8Array(node.contents);
      },expandFileStorage:function (node, newCapacity) {
        // If we are asked to expand the size of a file that already exists, revert to using a standard JS array to store the file
        // instead of a typed array. This makes resizing the array more flexible because we can just .push() elements at the back to
        // increase the size.
        if (node.contents && node.contents.subarray && newCapacity > node.contents.length) {
          node.contents = MEMFS.getFileDataAsRegularArray(node);
          node.usedBytes = node.contents.length; // We might be writing to a lazy-loaded file which had overridden this property, so force-reset it.
        }
  
        if (!node.contents || node.contents.subarray) { // Keep using a typed array if creating a new storage, or if old one was a typed array as well.
          var prevCapacity = node.contents ? node.contents.length : 0;
          if (prevCapacity >= newCapacity) return; // No need to expand, the storage was already large enough.
          // Don't expand strictly to the given requested limit if it's only a very small increase, but instead geometrically grow capacity.
          // For small filesizes (<1MB), perform size*2 geometric increase, but for large sizes, do a much more conservative size*1.125 increase to
          // avoid overshooting the allocation cap by a very large margin.
          var CAPACITY_DOUBLING_MAX = 1024 * 1024;
          newCapacity = Math.max(newCapacity, (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2.0 : 1.125)) | 0);
          if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256); // At minimum allocate 256b for each file when expanding.
          var oldContents = node.contents;
          node.contents = new Uint8Array(newCapacity); // Allocate new storage.
          if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0); // Copy old data over to the new storage.
          return;
        }
        // Not using a typed array to back the file storage. Use a standard JS array instead.
        if (!node.contents && newCapacity > 0) node.contents = [];
        while (node.contents.length < newCapacity) node.contents.push(0);
      },resizeFileStorage:function (node, newSize) {
        if (node.usedBytes == newSize) return;
        if (newSize == 0) {
          node.contents = null; // Fully decommit when requesting a resize to zero.
          node.usedBytes = 0;
          return;
        }
        if (!node.contents || node.contents.subarray) { // Resize a typed array if that is being used as the backing store.
          var oldContents = node.contents;
          node.contents = new Uint8Array(new ArrayBuffer(newSize)); // Allocate new storage.
          if (oldContents) {
            node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes))); // Copy old data over to the new storage.
          }
          node.usedBytes = newSize;
          return;
        }
        // Backing with a JS array.
        if (!node.contents) node.contents = [];
        if (node.contents.length > newSize) node.contents.length = newSize;
        else while (node.contents.length < newSize) node.contents.push(0);
        node.usedBytes = newSize;
      },node_ops:{getattr:function (node) {
          var attr = {};
          // device numbers reuse inode numbers.
          attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
          attr.ino = node.id;
          attr.mode = node.mode;
          attr.nlink = 1;
          attr.uid = 0;
          attr.gid = 0;
          attr.rdev = node.rdev;
          if (FS.isDir(node.mode)) {
            attr.size = 4096;
          } else if (FS.isFile(node.mode)) {
            attr.size = node.usedBytes;
          } else if (FS.isLink(node.mode)) {
            attr.size = node.link.length;
          } else {
            attr.size = 0;
          }
          attr.atime = new Date(node.timestamp);
          attr.mtime = new Date(node.timestamp);
          attr.ctime = new Date(node.timestamp);
          // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
          //       but this is not required by the standard.
          attr.blksize = 4096;
          attr.blocks = Math.ceil(attr.size / attr.blksize);
          return attr;
        },setattr:function (node, attr) {
          if (attr.mode !== undefined) {
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            node.timestamp = attr.timestamp;
          }
          if (attr.size !== undefined) {
            MEMFS.resizeFileStorage(node, attr.size);
          }
        },lookup:function (parent, name) {
          throw FS.genericErrors[ERRNO_CODES.ENOENT];
        },mknod:function (parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },rename:function (old_node, new_dir, new_name) {
          // if we're overwriting a directory at new_name, make sure it's empty.
          if (FS.isDir(old_node.mode)) {
            var new_node;
            try {
              new_node = FS.lookupNode(new_dir, new_name);
            } catch (e) {
            }
            if (new_node) {
              for (var i in new_node.contents) {
                throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
              }
            }
          }
          // do the internal rewiring
          delete old_node.parent.contents[old_node.name];
          old_node.name = new_name;
          new_dir.contents[new_name] = old_node;
          old_node.parent = new_dir;
        },unlink:function (parent, name) {
          delete parent.contents[name];
        },rmdir:function (parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
          }
          delete parent.contents[name];
        },readdir:function (node) {
          var entries = ['.', '..']
          for (var key in node.contents) {
            if (!node.contents.hasOwnProperty(key)) {
              continue;
            }
            entries.push(key);
          }
          return entries;
        },symlink:function (parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 511 /* 0777 */ | 40960, 0);
          node.link = oldpath;
          return node;
        },readlink:function (node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          return node.link;
        }},stream_ops:{read:function (stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= stream.node.usedBytes) return 0;
          var size = Math.min(stream.node.usedBytes - position, length);
          assert(size >= 0);
          if (size > 8 && contents.subarray) { // non-trivial, and typed array
            buffer.set(contents.subarray(position, position + size), offset);
          } else {
            for (var i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
          }
          return size;
        },write:function (stream, buffer, offset, length, position, canOwn) {
          if (!length) return 0;
          var node = stream.node;
          node.timestamp = Date.now();
  
          if (buffer.subarray && (!node.contents || node.contents.subarray)) { // This write is from a typed array to a typed array?
            if (canOwn) {
              assert(position === 0, 'canOwn must imply no weird position inside the file');
              node.contents = buffer.subarray(offset, offset + length);
              node.usedBytes = length;
              return length;
            } else if (node.usedBytes === 0 && position === 0) { // If this is a simple first write to an empty file, do a fast set since we don't need to care about old data.
              node.contents = new Uint8Array(buffer.subarray(offset, offset + length));
              node.usedBytes = length;
              return length;
            } else if (position + length <= node.usedBytes) { // Writing to an already allocated and used subrange of the file?
              node.contents.set(buffer.subarray(offset, offset + length), position);
              return length;
            }
          }
  
          // Appending to an existing file and we need to reallocate, or source data did not come as a typed array.
          MEMFS.expandFileStorage(node, position+length);
          if (node.contents.subarray && buffer.subarray) node.contents.set(buffer.subarray(offset, offset + length), position); // Use typed array write if available.
          else {
            for (var i = 0; i < length; i++) {
             node.contents[position + i] = buffer[offset + i]; // Or fall back to manual write if not.
            }
          }
          node.usedBytes = Math.max(node.usedBytes, position+length);
          return length;
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.usedBytes;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          return position;
        },allocate:function (stream, offset, length) {
          MEMFS.expandFileStorage(stream.node, offset + length);
          stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
        },mmap:function (stream, buffer, offset, length, position, prot, flags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
          }
          var ptr;
          var allocated;
          var contents = stream.node.contents;
          // Only make a new copy when MAP_PRIVATE is specified.
          if ( !(flags & 2) &&
                (contents.buffer === buffer || contents.buffer === buffer.buffer) ) {
            // We can't emulate MAP_SHARED when the file is not backed by the buffer
            // we're mapping to (e.g. the HEAP buffer).
            allocated = false;
            ptr = contents.byteOffset;
          } else {
            // Try to avoid unnecessary slices.
            if (position > 0 || position + length < stream.node.usedBytes) {
              if (contents.subarray) {
                contents = contents.subarray(position, position + length);
              } else {
                contents = Array.prototype.slice.call(contents, position, position + length);
              }
            }
            allocated = true;
            ptr = _malloc(length);
            if (!ptr) {
              throw new FS.ErrnoError(ERRNO_CODES.ENOMEM);
            }
            buffer.set(contents, ptr);
          }
          return { ptr: ptr, allocated: allocated };
        },msync:function (stream, buffer, offset, length, mmapFlags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
          }
          if (mmapFlags & 2) {
            // MAP_PRIVATE calls need not to be synced back to underlying fs
            return 0;
          }
  
          var bytesWritten = MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
          // should we check if bytesWritten and length are the same?
          return 0;
        }}};
  
  var IDBFS={dbs:{},indexedDB:function () {
        if (typeof indexedDB !== 'undefined') return indexedDB;
        var ret = null;
        if (typeof window === 'object') ret = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
        assert(ret, 'IDBFS used, but indexedDB not supported');
        return ret;
      },DB_VERSION:21,DB_STORE_NAME:"FILE_DATA",mount:function (mount) {
        // reuse all of the core MEMFS functionality
        return MEMFS.mount.apply(null, arguments);
      },syncfs:function (mount, populate, callback) {
        IDBFS.getLocalSet(mount, function(err, local) {
          if (err) return callback(err);
  
          IDBFS.getRemoteSet(mount, function(err, remote) {
            if (err) return callback(err);
  
            var src = populate ? remote : local;
            var dst = populate ? local : remote;
  
            IDBFS.reconcile(src, dst, callback);
          });
        });
      },getDB:function (name, callback) {
        // check the cache first
        var db = IDBFS.dbs[name];
        if (db) {
          return callback(null, db);
        }
  
        var req;
        try {
          req = IDBFS.indexedDB().open(name, IDBFS.DB_VERSION);
        } catch (e) {
          return callback(e);
        }
        if (!req) {
          return callback("Unable to connect to IndexedDB");
        }
        req.onupgradeneeded = function(e) {
          var db = e.target.result;
          var transaction = e.target.transaction;
  
          var fileStore;
  
          if (db.objectStoreNames.contains(IDBFS.DB_STORE_NAME)) {
            fileStore = transaction.objectStore(IDBFS.DB_STORE_NAME);
          } else {
            fileStore = db.createObjectStore(IDBFS.DB_STORE_NAME);
          }
  
          if (!fileStore.indexNames.contains('timestamp')) {
            fileStore.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
        req.onsuccess = function() {
          db = req.result;
  
          // add to the cache
          IDBFS.dbs[name] = db;
          callback(null, db);
        };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },getLocalSet:function (mount, callback) {
        var entries = {};
  
        function isRealDir(p) {
          return p !== '.' && p !== '..';
        };
        function toAbsolute(root) {
          return function(p) {
            return PATH.join2(root, p);
          }
        };
  
        var check = FS.readdir(mount.mountpoint).filter(isRealDir).map(toAbsolute(mount.mountpoint));
  
        while (check.length) {
          var path = check.pop();
          var stat;
  
          try {
            stat = FS.stat(path);
          } catch (e) {
            return callback(e);
          }
  
          if (FS.isDir(stat.mode)) {
            check.push.apply(check, FS.readdir(path).filter(isRealDir).map(toAbsolute(path)));
          }
  
          entries[path] = { timestamp: stat.mtime };
        }
  
        return callback(null, { type: 'local', entries: entries });
      },getRemoteSet:function (mount, callback) {
        var entries = {};
  
        IDBFS.getDB(mount.mountpoint, function(err, db) {
          if (err) return callback(err);
  
          var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readonly');
          transaction.onerror = function(e) {
            callback(this.error);
            e.preventDefault();
          };
  
          var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
          var index = store.index('timestamp');
  
          index.openKeyCursor().onsuccess = function(event) {
            var cursor = event.target.result;
  
            if (!cursor) {
              return callback(null, { type: 'remote', db: db, entries: entries });
            }
  
            entries[cursor.primaryKey] = { timestamp: cursor.key };
  
            cursor.continue();
          };
        });
      },loadLocalEntry:function (path, callback) {
        var stat, node;
  
        try {
          var lookup = FS.lookupPath(path);
          node = lookup.node;
          stat = FS.stat(path);
        } catch (e) {
          return callback(e);
        }
  
        if (FS.isDir(stat.mode)) {
          return callback(null, { timestamp: stat.mtime, mode: stat.mode });
        } else if (FS.isFile(stat.mode)) {
          // Performance consideration: storing a normal JavaScript array to a IndexedDB is much slower than storing a typed array.
          // Therefore always convert the file contents to a typed array first before writing the data to IndexedDB.
          node.contents = MEMFS.getFileDataAsTypedArray(node);
          return callback(null, { timestamp: stat.mtime, mode: stat.mode, contents: node.contents });
        } else {
          return callback(new Error('node type not supported'));
        }
      },storeLocalEntry:function (path, entry, callback) {
        try {
          if (FS.isDir(entry.mode)) {
            FS.mkdir(path, entry.mode);
          } else if (FS.isFile(entry.mode)) {
            FS.writeFile(path, entry.contents, { encoding: 'binary', canOwn: true });
          } else {
            return callback(new Error('node type not supported'));
          }
  
          FS.chmod(path, entry.mode);
          FS.utime(path, entry.timestamp, entry.timestamp);
        } catch (e) {
          return callback(e);
        }
  
        callback(null);
      },removeLocalEntry:function (path, callback) {
        try {
          var lookup = FS.lookupPath(path);
          var stat = FS.stat(path);
  
          if (FS.isDir(stat.mode)) {
            FS.rmdir(path);
          } else if (FS.isFile(stat.mode)) {
            FS.unlink(path);
          }
        } catch (e) {
          return callback(e);
        }
  
        callback(null);
      },loadRemoteEntry:function (store, path, callback) {
        var req = store.get(path);
        req.onsuccess = function(event) { callback(null, event.target.result); };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },storeRemoteEntry:function (store, path, entry, callback) {
        var req = store.put(entry, path);
        req.onsuccess = function() { callback(null); };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },removeRemoteEntry:function (store, path, callback) {
        var req = store.delete(path);
        req.onsuccess = function() { callback(null); };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },reconcile:function (src, dst, callback) {
        var total = 0;
  
        var create = [];
        Object.keys(src.entries).forEach(function (key) {
          var e = src.entries[key];
          var e2 = dst.entries[key];
          if (!e2 || e.timestamp > e2.timestamp) {
            create.push(key);
            total++;
          }
        });
  
        var remove = [];
        Object.keys(dst.entries).forEach(function (key) {
          var e = dst.entries[key];
          var e2 = src.entries[key];
          if (!e2) {
            remove.push(key);
            total++;
          }
        });
  
        if (!total) {
          return callback(null);
        }
  
        var errored = false;
        var completed = 0;
        var db = src.type === 'remote' ? src.db : dst.db;
        var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readwrite');
        var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
  
        function done(err) {
          if (err) {
            if (!done.errored) {
              done.errored = true;
              return callback(err);
            }
            return;
          }
          if (++completed >= total) {
            return callback(null);
          }
        };
  
        transaction.onerror = function(e) {
          done(this.error);
          e.preventDefault();
        };
  
        // sort paths in ascending order so directory entries are created
        // before the files inside them
        create.sort().forEach(function (path) {
          if (dst.type === 'local') {
            IDBFS.loadRemoteEntry(store, path, function (err, entry) {
              if (err) return done(err);
              IDBFS.storeLocalEntry(path, entry, done);
            });
          } else {
            IDBFS.loadLocalEntry(path, function (err, entry) {
              if (err) return done(err);
              IDBFS.storeRemoteEntry(store, path, entry, done);
            });
          }
        });
  
        // sort paths in descending order so files are deleted before their
        // parent directories
        remove.sort().reverse().forEach(function(path) {
          if (dst.type === 'local') {
            IDBFS.removeLocalEntry(path, done);
          } else {
            IDBFS.removeRemoteEntry(store, path, done);
          }
        });
      }};
  
  var NODEFS={isWindows:false,staticInit:function () {
        NODEFS.isWindows = !!process.platform.match(/^win/);
      },mount:function (mount) {
        assert(ENVIRONMENT_IS_NODE);
        return NODEFS.createNode(null, '/', NODEFS.getMode(mount.opts.root), 0);
      },createNode:function (parent, name, mode, dev) {
        if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var node = FS.createNode(parent, name, mode);
        node.node_ops = NODEFS.node_ops;
        node.stream_ops = NODEFS.stream_ops;
        return node;
      },getMode:function (path) {
        var stat;
        try {
          stat = fs.lstatSync(path);
          if (NODEFS.isWindows) {
            // On Windows, directories return permission bits 'rw-rw-rw-', even though they have 'rwxrwxrwx', so
            // propagate write bits to execute bits.
            stat.mode = stat.mode | ((stat.mode & 146) >> 1);
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        return stat.mode;
      },realPath:function (node) {
        var parts = [];
        while (node.parent !== node) {
          parts.push(node.name);
          node = node.parent;
        }
        parts.push(node.mount.opts.root);
        parts.reverse();
        return PATH.join.apply(null, parts);
      },flagsToPermissionStringMap:{0:"r",1:"r+",2:"r+",64:"r",65:"r+",66:"r+",129:"rx+",193:"rx+",514:"w+",577:"w",578:"w+",705:"wx",706:"wx+",1024:"a",1025:"a",1026:"a+",1089:"a",1090:"a+",1153:"ax",1154:"ax+",1217:"ax",1218:"ax+",4096:"rs",4098:"rs+"},flagsToPermissionString:function (flags) {
        flags &= ~0x200000 /*O_PATH*/; // Ignore this flag from musl, otherwise node.js fails to open the file.
        flags &= ~0x800 /*O_NONBLOCK*/; // Ignore this flag from musl, otherwise node.js fails to open the file.
        flags &= ~0x8000 /*O_LARGEFILE*/; // Ignore this flag from musl, otherwise node.js fails to open the file.
        flags &= ~0x80000 /*O_CLOEXEC*/; // Some applications may pass it; it makes no sense for a single process.
        if (flags in NODEFS.flagsToPermissionStringMap) {
          return NODEFS.flagsToPermissionStringMap[flags];
        } else {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
      },node_ops:{getattr:function (node) {
          var path = NODEFS.realPath(node);
          var stat;
          try {
            stat = fs.lstatSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          // node.js v0.10.20 doesn't report blksize and blocks on Windows. Fake them with default blksize of 4096.
          // See http://support.microsoft.com/kb/140365
          if (NODEFS.isWindows && !stat.blksize) {
            stat.blksize = 4096;
          }
          if (NODEFS.isWindows && !stat.blocks) {
            stat.blocks = (stat.size+stat.blksize-1)/stat.blksize|0;
          }
          return {
            dev: stat.dev,
            ino: stat.ino,
            mode: stat.mode,
            nlink: stat.nlink,
            uid: stat.uid,
            gid: stat.gid,
            rdev: stat.rdev,
            size: stat.size,
            atime: stat.atime,
            mtime: stat.mtime,
            ctime: stat.ctime,
            blksize: stat.blksize,
            blocks: stat.blocks
          };
        },setattr:function (node, attr) {
          var path = NODEFS.realPath(node);
          try {
            if (attr.mode !== undefined) {
              fs.chmodSync(path, attr.mode);
              // update the common node structure mode as well
              node.mode = attr.mode;
            }
            if (attr.timestamp !== undefined) {
              var date = new Date(attr.timestamp);
              fs.utimesSync(path, date, date);
            }
            if (attr.size !== undefined) {
              fs.truncateSync(path, attr.size);
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },lookup:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          var mode = NODEFS.getMode(path);
          return NODEFS.createNode(parent, name, mode);
        },mknod:function (parent, name, mode, dev) {
          var node = NODEFS.createNode(parent, name, mode, dev);
          // create the backing node for this in the fs root as well
          var path = NODEFS.realPath(node);
          try {
            if (FS.isDir(node.mode)) {
              fs.mkdirSync(path, node.mode);
            } else {
              fs.writeFileSync(path, '', { mode: node.mode });
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          return node;
        },rename:function (oldNode, newDir, newName) {
          var oldPath = NODEFS.realPath(oldNode);
          var newPath = PATH.join2(NODEFS.realPath(newDir), newName);
          try {
            fs.renameSync(oldPath, newPath);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },unlink:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          try {
            fs.unlinkSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },rmdir:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          try {
            fs.rmdirSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },readdir:function (node) {
          var path = NODEFS.realPath(node);
          try {
            return fs.readdirSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },symlink:function (parent, newName, oldPath) {
          var newPath = PATH.join2(NODEFS.realPath(parent), newName);
          try {
            fs.symlinkSync(oldPath, newPath);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },readlink:function (node) {
          var path = NODEFS.realPath(node);
          try {
            path = fs.readlinkSync(path);
            path = NODEJS_PATH.relative(NODEJS_PATH.resolve(node.mount.opts.root), path);
            return path;
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        }},stream_ops:{open:function (stream) {
          var path = NODEFS.realPath(stream.node);
          try {
            if (FS.isFile(stream.node.mode)) {
              stream.nfd = fs.openSync(path, NODEFS.flagsToPermissionString(stream.flags));
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },close:function (stream) {
          try {
            if (FS.isFile(stream.node.mode) && stream.nfd) {
              fs.closeSync(stream.nfd);
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },read:function (stream, buffer, offset, length, position) {
          if (length === 0) return 0; // node errors on 0 length reads
          // FIXME this is terrible.
          var nbuffer = new Buffer(length);
          var res;
          try {
            res = fs.readSync(stream.nfd, nbuffer, 0, length, position);
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          if (res > 0) {
            for (var i = 0; i < res; i++) {
              buffer[offset + i] = nbuffer[i];
            }
          }
          return res;
        },write:function (stream, buffer, offset, length, position) {
          // FIXME this is terrible.
          var nbuffer = new Buffer(buffer.subarray(offset, offset + length));
          var res;
          try {
            res = fs.writeSync(stream.nfd, nbuffer, 0, length, position);
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          return res;
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              try {
                var stat = fs.fstatSync(stream.nfd);
                position += stat.size;
              } catch (e) {
                throw new FS.ErrnoError(ERRNO_CODES[e.code]);
              }
            }
          }
  
          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
  
          return position;
        }}};
  
  var WORKERFS={DIR_MODE:16895,FILE_MODE:33279,reader:null,mount:function (mount) {
        assert(ENVIRONMENT_IS_WORKER);
        if (!WORKERFS.reader) WORKERFS.reader = new FileReaderSync();
        var root = WORKERFS.createNode(null, '/', WORKERFS.DIR_MODE, 0);
        var createdParents = {};
        function ensureParent(path) {
          // return the parent node, creating subdirs as necessary
          var parts = path.split('/');
          var parent = root;
          for (var i = 0; i < parts.length-1; i++) {
            var curr = parts.slice(0, i+1).join('/');
            // Issue 4254: Using curr as a node name will prevent the node
            // from being found in FS.nameTable when FS.open is called on
            // a path which holds a child of this node,
            // given that all FS functions assume node names
            // are just their corresponding parts within their given path,
            // rather than incremental aggregates which include their parent's
            // directories.
            if (!createdParents[curr]) {
              createdParents[curr] = WORKERFS.createNode(parent, parts[i], WORKERFS.DIR_MODE, 0);
            }
            parent = createdParents[curr];
          }
          return parent;
        }
        function base(path) {
          var parts = path.split('/');
          return parts[parts.length-1];
        }
        // We also accept FileList here, by using Array.prototype
        Array.prototype.forEach.call(mount.opts["files"] || [], function(file) {
          WORKERFS.createNode(ensureParent(file.name), base(file.name), WORKERFS.FILE_MODE, 0, file, file.lastModifiedDate);
        });
        (mount.opts["blobs"] || []).forEach(function(obj) {
          WORKERFS.createNode(ensureParent(obj["name"]), base(obj["name"]), WORKERFS.FILE_MODE, 0, obj["data"]);
        });
        (mount.opts["packages"] || []).forEach(function(pack) {
          pack['metadata'].files.forEach(function(file) {
            var name = file.filename.substr(1); // remove initial slash
            WORKERFS.createNode(ensureParent(name), base(name), WORKERFS.FILE_MODE, 0, pack['blob'].slice(file.start, file.end));
          });
        });
        return root;
      },createNode:function (parent, name, mode, dev, contents, mtime) {
        var node = FS.createNode(parent, name, mode);
        node.mode = mode;
        node.node_ops = WORKERFS.node_ops;
        node.stream_ops = WORKERFS.stream_ops;
        node.timestamp = (mtime || new Date).getTime();
        assert(WORKERFS.FILE_MODE !== WORKERFS.DIR_MODE);
        if (mode === WORKERFS.FILE_MODE) {
          node.size = contents.size;
          node.contents = contents;
        } else {
          node.size = 4096;
          node.contents = {};
        }
        if (parent) {
          parent.contents[name] = node;
        }
        return node;
      },node_ops:{getattr:function (node) {
          return {
            dev: 1,
            ino: undefined,
            mode: node.mode,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: undefined,
            size: node.size,
            atime: new Date(node.timestamp),
            mtime: new Date(node.timestamp),
            ctime: new Date(node.timestamp),
            blksize: 4096,
            blocks: Math.ceil(node.size / 4096),
          };
        },setattr:function (node, attr) {
          if (attr.mode !== undefined) {
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            node.timestamp = attr.timestamp;
          }
        },lookup:function (parent, name) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        },mknod:function (parent, name, mode, dev) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        },rename:function (oldNode, newDir, newName) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        },unlink:function (parent, name) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        },rmdir:function (parent, name) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        },readdir:function (node) {
          var entries = ['.', '..'];
          for (var key in node.contents) {
            if (!node.contents.hasOwnProperty(key)) {
              continue;
            }
            entries.push(key);
          }
          return entries;
        },symlink:function (parent, newName, oldPath) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        },readlink:function (node) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }},stream_ops:{read:function (stream, buffer, offset, length, position) {
          if (position >= stream.node.size) return 0;
          var chunk = stream.node.contents.slice(position, position + length);
          var ab = WORKERFS.reader.readAsArrayBuffer(chunk);
          buffer.set(new Uint8Array(ab), offset);
          return chunk.size;
        },write:function (stream, buffer, offset, length, position) {
          throw new FS.ErrnoError(ERRNO_CODES.EIO);
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.size;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          return position;
        }}};
  
  var _stdin; if (ENVIRONMENT_IS_PTHREAD) _stdin = PthreadWorkerInit._stdin; else PthreadWorkerInit._stdin = _stdin = allocate(1, "i32*", ALLOC_STATIC);
  
  var _stdout; if (ENVIRONMENT_IS_PTHREAD) _stdout = PthreadWorkerInit._stdout; else PthreadWorkerInit._stdout = _stdout = allocate(1, "i32*", ALLOC_STATIC);
  
  var _stderr; if (ENVIRONMENT_IS_PTHREAD) _stderr = PthreadWorkerInit._stderr; else PthreadWorkerInit._stderr = _stderr = allocate(1, "i32*", ALLOC_STATIC);var FS={root:null,mounts:[],devices:[null],streams:[],nextInode:1,nameTable:null,currentPath:"/",initialized:false,ignorePermissions:true,trackingDelegate:{},tracking:{openFlags:{READ:1,WRITE:2}},ErrnoError:null,genericErrors:{},filesystems:null,syncFSRequests:0,handleFSError:function (e) {
        if (!(e instanceof FS.ErrnoError)) throw e + ' : ' + stackTrace();
        return ___setErrNo(e.errno);
      },lookupPath:function (path, opts) {
        path = PATH.resolve(FS.cwd(), path);
        opts = opts || {};
  
        if (!path) return { path: '', node: null };
  
        var defaults = {
          follow_mount: true,
          recurse_count: 0
        };
        for (var key in defaults) {
          if (opts[key] === undefined) {
            opts[key] = defaults[key];
          }
        }
  
        if (opts.recurse_count > 8) {  // max recursive lookup of 8
          throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
        }
  
        // split the path
        var parts = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), false);
  
        // start at the root
        var current = FS.root;
        var current_path = '/';
  
        for (var i = 0; i < parts.length; i++) {
          var islast = (i === parts.length-1);
          if (islast && opts.parent) {
            // stop resolving
            break;
          }
  
          current = FS.lookupNode(current, parts[i]);
          current_path = PATH.join2(current_path, parts[i]);
  
          // jump to the mount's root node if this is a mountpoint
          if (FS.isMountpoint(current)) {
            if (!islast || (islast && opts.follow_mount)) {
              current = current.mounted.root;
            }
          }
  
          // by default, lookupPath will not follow a symlink if it is the final path component.
          // setting opts.follow = true will override this behavior.
          if (!islast || opts.follow) {
            var count = 0;
            while (FS.isLink(current.mode)) {
              var link = FS.readlink(current_path);
              current_path = PATH.resolve(PATH.dirname(current_path), link);
  
              var lookup = FS.lookupPath(current_path, { recurse_count: opts.recurse_count });
              current = lookup.node;
  
              if (count++ > 40) {  // limit max consecutive symlinks to 40 (SYMLOOP_MAX).
                throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
              }
            }
          }
        }
  
        return { path: current_path, node: current };
      },getPath:function (node) {
        var path;
        while (true) {
          if (FS.isRoot(node)) {
            var mount = node.mount.mountpoint;
            if (!path) return mount;
            return mount[mount.length-1] !== '/' ? mount + '/' + path : mount + path;
          }
          path = path ? node.name + '/' + path : node.name;
          node = node.parent;
        }
      },hashName:function (parentid, name) {
        var hash = 0;
  
  
        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },hashAddNode:function (node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },hashRemoveNode:function (node) {
        var hash = FS.hashName(node.parent.id, node.name);
        if (FS.nameTable[hash] === node) {
          FS.nameTable[hash] = node.name_next;
        } else {
          var current = FS.nameTable[hash];
          while (current) {
            if (current.name_next === node) {
              current.name_next = node.name_next;
              break;
            }
            current = current.name_next;
          }
        }
      },lookupNode:function (parent, name) {
        var err = FS.mayLookup(parent);
        if (err) {
          throw new FS.ErrnoError(err, parent);
        }
        var hash = FS.hashName(parent.id, name);
        for (var node = FS.nameTable[hash]; node; node = node.name_next) {
          var nodeName = node.name;
          if (node.parent.id === parent.id && nodeName === name) {
            return node;
          }
        }
        // if we failed to find it in the cache, call into the VFS
        return FS.lookup(parent, name);
      },createNode:function (parent, name, mode, rdev) {
        if (!FS.FSNode) {
          FS.FSNode = function(parent, name, mode, rdev) {
            if (!parent) {
              parent = this;  // root node sets parent to itself
            }
            this.parent = parent;
            this.mount = parent.mount;
            this.mounted = null;
            this.id = FS.nextInode++;
            this.name = name;
            this.mode = mode;
            this.node_ops = {};
            this.stream_ops = {};
            this.rdev = rdev;
          };
  
          FS.FSNode.prototype = {};
  
          // compatibility
          var readMode = 292 | 73;
          var writeMode = 146;
  
          // NOTE we must use Object.defineProperties instead of individual calls to
          // Object.defineProperty in order to make closure compiler happy
          Object.defineProperties(FS.FSNode.prototype, {
            read: {
              get: function() { return (this.mode & readMode) === readMode; },
              set: function(val) { val ? this.mode |= readMode : this.mode &= ~readMode; }
            },
            write: {
              get: function() { return (this.mode & writeMode) === writeMode; },
              set: function(val) { val ? this.mode |= writeMode : this.mode &= ~writeMode; }
            },
            isFolder: {
              get: function() { return FS.isDir(this.mode); }
            },
            isDevice: {
              get: function() { return FS.isChrdev(this.mode); }
            }
          });
        }
  
        var node = new FS.FSNode(parent, name, mode, rdev);
  
        FS.hashAddNode(node);
  
        return node;
      },destroyNode:function (node) {
        FS.hashRemoveNode(node);
      },isRoot:function (node) {
        return node === node.parent;
      },isMountpoint:function (node) {
        return !!node.mounted;
      },isFile:function (mode) {
        return (mode & 61440) === 32768;
      },isDir:function (mode) {
        return (mode & 61440) === 16384;
      },isLink:function (mode) {
        return (mode & 61440) === 40960;
      },isChrdev:function (mode) {
        return (mode & 61440) === 8192;
      },isBlkdev:function (mode) {
        return (mode & 61440) === 24576;
      },isFIFO:function (mode) {
        return (mode & 61440) === 4096;
      },isSocket:function (mode) {
        return (mode & 49152) === 49152;
      },flagModes:{"r":0,"rs":1052672,"r+":2,"w":577,"wx":705,"xw":705,"w+":578,"wx+":706,"xw+":706,"a":1089,"ax":1217,"xa":1217,"a+":1090,"ax+":1218,"xa+":1218},modeStringToFlags:function (str) {
        var flags = FS.flagModes[str];
        if (typeof flags === 'undefined') {
          throw new Error('Unknown file open mode: ' + str);
        }
        return flags;
      },flagsToPermissionString:function (flag) {
        var perms = ['r', 'w', 'rw'][flag & 3];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },nodePermissions:function (node, perms) {
        if (FS.ignorePermissions) {
          return 0;
        }
        // return 0 if any user, group or owner bits are set.
        if (perms.indexOf('r') !== -1 && !(node.mode & 292)) {
          return ERRNO_CODES.EACCES;
        } else if (perms.indexOf('w') !== -1 && !(node.mode & 146)) {
          return ERRNO_CODES.EACCES;
        } else if (perms.indexOf('x') !== -1 && !(node.mode & 73)) {
          return ERRNO_CODES.EACCES;
        }
        return 0;
      },mayLookup:function (dir) {
        var err = FS.nodePermissions(dir, 'x');
        if (err) return err;
        if (!dir.node_ops.lookup) return ERRNO_CODES.EACCES;
        return 0;
      },mayCreate:function (dir, name) {
        try {
          var node = FS.lookupNode(dir, name);
          return ERRNO_CODES.EEXIST;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },mayDelete:function (dir, name, isdir) {
        var node;
        try {
          node = FS.lookupNode(dir, name);
        } catch (e) {
          return e.errno;
        }
        var err = FS.nodePermissions(dir, 'wx');
        if (err) {
          return err;
        }
        if (isdir) {
          if (!FS.isDir(node.mode)) {
            return ERRNO_CODES.ENOTDIR;
          }
          if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
            return ERRNO_CODES.EBUSY;
          }
        } else {
          if (FS.isDir(node.mode)) {
            return ERRNO_CODES.EISDIR;
          }
        }
        return 0;
      },mayOpen:function (node, flags) {
        if (!node) {
          return ERRNO_CODES.ENOENT;
        }
        if (FS.isLink(node.mode)) {
          return ERRNO_CODES.ELOOP;
        } else if (FS.isDir(node.mode)) {
          if (FS.flagsToPermissionString(flags) !== 'r' || // opening for write
              (flags & 512)) { // TODO: check for O_SEARCH? (== search for dir only)
            return ERRNO_CODES.EISDIR;
          }
        }
        return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
      },MAX_OPEN_FDS:4096,nextfd:function (fd_start, fd_end) {
        fd_start = fd_start || 0;
        fd_end = fd_end || FS.MAX_OPEN_FDS;
        for (var fd = fd_start; fd <= fd_end; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(ERRNO_CODES.EMFILE);
      },getStream:function (fd) {
        return FS.streams[fd];
      },createStream:function (stream, fd_start, fd_end) {
        if (!FS.FSStream) {
          FS.FSStream = function(){};
          FS.FSStream.prototype = {};
          // compatibility
          Object.defineProperties(FS.FSStream.prototype, {
            object: {
              get: function() { return this.node; },
              set: function(val) { this.node = val; }
            },
            isRead: {
              get: function() { return (this.flags & 2097155) !== 1; }
            },
            isWrite: {
              get: function() { return (this.flags & 2097155) !== 0; }
            },
            isAppend: {
              get: function() { return (this.flags & 1024); }
            }
          });
        }
        // clone it, so we can return an instance of FSStream
        var newStream = new FS.FSStream();
        for (var p in stream) {
          newStream[p] = stream[p];
        }
        stream = newStream;
        var fd = FS.nextfd(fd_start, fd_end);
        stream.fd = fd;
        FS.streams[fd] = stream;
        return stream;
      },closeStream:function (fd) {
        FS.streams[fd] = null;
      },chrdev_stream_ops:{open:function (stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          if (stream.stream_ops.open) {
            stream.stream_ops.open(stream);
          }
        },llseek:function () {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }},major:function (dev) {
        return ((dev) >> 8);
      },minor:function (dev) {
        return ((dev) & 0xff);
      },makedev:function (ma, mi) {
        return ((ma) << 8 | (mi));
      },registerDevice:function (dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },getDevice:function (dev) {
        return FS.devices[dev];
      },getMounts:function (mount) {
        var mounts = [];
        var check = [mount];
  
        while (check.length) {
          var m = check.pop();
  
          mounts.push(m);
  
          check.push.apply(check, m.mounts);
        }
  
        return mounts;
      },syncfs:function (populate, callback) {
        if (typeof(populate) === 'function') {
          callback = populate;
          populate = false;
        }
  
        FS.syncFSRequests++;
  
        if (FS.syncFSRequests > 1) {
          console.log('warning: ' + FS.syncFSRequests + ' FS.syncfs operations in flight at once, probably just doing extra work');
        }
  
        var mounts = FS.getMounts(FS.root.mount);
        var completed = 0;
  
        function doCallback(err) {
          assert(FS.syncFSRequests > 0);
          FS.syncFSRequests--;
          return callback(err);
        }
  
        function done(err) {
          if (err) {
            if (!done.errored) {
              done.errored = true;
              return doCallback(err);
            }
            return;
          }
          if (++completed >= mounts.length) {
            doCallback(null);
          }
        };
  
        // sync all mounts
        mounts.forEach(function (mount) {
          if (!mount.type.syncfs) {
            return done(null);
          }
          mount.type.syncfs(mount, populate, done);
        });
      },mount:function (type, opts, mountpoint) {
        var root = mountpoint === '/';
        var pseudo = !mountpoint;
        var node;
  
        if (root && FS.root) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        } else if (!root && !pseudo) {
          var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
          mountpoint = lookup.path;  // use the absolute path
          node = lookup.node;
  
          if (FS.isMountpoint(node)) {
            throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
          }
  
          if (!FS.isDir(node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
          }
        }
  
        var mount = {
          type: type,
          opts: opts,
          mountpoint: mountpoint,
          mounts: []
        };
  
        // create a root node for the fs
        var mountRoot = type.mount(mount);
        mountRoot.mount = mount;
        mount.root = mountRoot;
  
        if (root) {
          FS.root = mountRoot;
        } else if (node) {
          // set as a mountpoint
          node.mounted = mount;
  
          // add the new mount to the current mount's children
          if (node.mount) {
            node.mount.mounts.push(mount);
          }
        }
  
        return mountRoot;
      },unmount:function (mountpoint) {
        var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
        if (!FS.isMountpoint(lookup.node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
  
        // destroy the nodes for this mount, and all its child mounts
        var node = lookup.node;
        var mount = node.mounted;
        var mounts = FS.getMounts(mount);
  
        Object.keys(FS.nameTable).forEach(function (hash) {
          var current = FS.nameTable[hash];
  
          while (current) {
            var next = current.name_next;
  
            if (mounts.indexOf(current.mount) !== -1) {
              FS.destroyNode(current);
            }
  
            current = next;
          }
        });
  
        // no longer a mountpoint
        node.mounted = null;
  
        // remove this mount from the child mounts
        var idx = node.mount.mounts.indexOf(mount);
        assert(idx !== -1);
        node.mount.mounts.splice(idx, 1);
      },lookup:function (parent, name) {
        return parent.node_ops.lookup(parent, name);
      },mknod:function (path, mode, dev) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        if (!name || name === '.' || name === '..') {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var err = FS.mayCreate(parent, name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.mknod) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        return parent.node_ops.mknod(parent, name, mode, dev);
      },create:function (path, mode) {
        mode = mode !== undefined ? mode : 438 /* 0666 */;
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },mkdir:function (path, mode) {
        mode = mode !== undefined ? mode : 511 /* 0777 */;
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },mkdirTree:function (path, mode) {
        var dirs = path.split('/');
        var d = '';
        for (var i = 0; i < dirs.length; ++i) {
          if (!dirs[i]) continue;
          d += '/' + dirs[i];
          try {
            FS.mkdir(d, mode);
          } catch(e) {
            if (e.errno != ERRNO_CODES.EEXIST) throw e;
          }
        }
      },mkdev:function (path, mode, dev) {
        if (typeof(dev) === 'undefined') {
          dev = mode;
          mode = 438 /* 0666 */;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },symlink:function (oldpath, newpath) {
        if (!PATH.resolve(oldpath)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        }
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        }
        var newname = PATH.basename(newpath);
        var err = FS.mayCreate(parent, newname);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.symlink) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        return parent.node_ops.symlink(parent, newname, oldpath);
      },rename:function (old_path, new_path) {
        var old_dirname = PATH.dirname(old_path);
        var new_dirname = PATH.dirname(new_path);
        var old_name = PATH.basename(old_path);
        var new_name = PATH.basename(new_path);
        // parents must exist
        var lookup, old_dir, new_dir;
        try {
          lookup = FS.lookupPath(old_path, { parent: true });
          old_dir = lookup.node;
          lookup = FS.lookupPath(new_path, { parent: true });
          new_dir = lookup.node;
        } catch (e) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        if (!old_dir || !new_dir) throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        // need to be part of the same mount
        if (old_dir.mount !== new_dir.mount) {
          throw new FS.ErrnoError(ERRNO_CODES.EXDEV);
        }
        // source must exist
        var old_node = FS.lookupNode(old_dir, old_name);
        // old path should not be an ancestor of the new path
        var relative = PATH.relative(old_path, new_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        // new path should not be an ancestor of the old path
        relative = PATH.relative(new_path, old_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
        }
        // see if the new path already exists
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {
          // not fatal
        }
        // early out if nothing needs to change
        if (old_node === new_node) {
          return;
        }
        // we'll need to delete the old entry
        var isdir = FS.isDir(old_node.mode);
        var err = FS.mayDelete(old_dir, old_name, isdir);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        // need delete permissions if we'll be overwriting.
        // need create permissions if new doesn't already exist.
        err = new_node ?
          FS.mayDelete(new_dir, new_name, isdir) :
          FS.mayCreate(new_dir, new_name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!old_dir.node_ops.rename) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        // if we are going to change the parent, check write permissions
        if (new_dir !== old_dir) {
          err = FS.nodePermissions(old_dir, 'w');
          if (err) {
            throw new FS.ErrnoError(err);
          }
        }
        try {
          if (FS.trackingDelegate['willMovePath']) {
            FS.trackingDelegate['willMovePath'](old_path, new_path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willMovePath']('"+old_path+"', '"+new_path+"') threw an exception: " + e.message);
        }
        // remove the node from the lookup hash
        FS.hashRemoveNode(old_node);
        // do the underlying fs rename
        try {
          old_dir.node_ops.rename(old_node, new_dir, new_name);
        } catch (e) {
          throw e;
        } finally {
          // add the node back to the hash (in case node_ops.rename
          // changed its name)
          FS.hashAddNode(old_node);
        }
        try {
          if (FS.trackingDelegate['onMovePath']) FS.trackingDelegate['onMovePath'](old_path, new_path);
        } catch(e) {
          console.log("FS.trackingDelegate['onMovePath']('"+old_path+"', '"+new_path+"') threw an exception: " + e.message);
        }
      },rmdir:function (path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, true);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.rmdir) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        try {
          if (FS.trackingDelegate['willDeletePath']) {
            FS.trackingDelegate['willDeletePath'](path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willDeletePath']('"+path+"') threw an exception: " + e.message);
        }
        parent.node_ops.rmdir(parent, name);
        FS.destroyNode(node);
        try {
          if (FS.trackingDelegate['onDeletePath']) FS.trackingDelegate['onDeletePath'](path);
        } catch(e) {
          console.log("FS.trackingDelegate['onDeletePath']('"+path+"') threw an exception: " + e.message);
        }
      },readdir:function (path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        if (!node.node_ops.readdir) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
        }
        return node.node_ops.readdir(node);
      },unlink:function (path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, false);
        if (err) {
          // According to POSIX, we should map EISDIR to EPERM, but
          // we instead do what Linux does (and we must, as we use
          // the musl linux libc).
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.unlink) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        try {
          if (FS.trackingDelegate['willDeletePath']) {
            FS.trackingDelegate['willDeletePath'](path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willDeletePath']('"+path+"') threw an exception: " + e.message);
        }
        parent.node_ops.unlink(parent, name);
        FS.destroyNode(node);
        try {
          if (FS.trackingDelegate['onDeletePath']) FS.trackingDelegate['onDeletePath'](path);
        } catch(e) {
          console.log("FS.trackingDelegate['onDeletePath']('"+path+"') threw an exception: " + e.message);
        }
      },readlink:function (path) {
        var lookup = FS.lookupPath(path);
        var link = lookup.node;
        if (!link) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        }
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        return PATH.resolve(FS.getPath(link.parent), link.node_ops.readlink(link));
      },stat:function (path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        if (!node) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        }
        if (!node.node_ops.getattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        return node.node_ops.getattr(node);
      },lstat:function (path) {
        return FS.stat(path, true);
      },chmod:function (path, mode, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        node.node_ops.setattr(node, {
          mode: (mode & 4095) | (node.mode & ~4095),
          timestamp: Date.now()
        });
      },lchmod:function (path, mode) {
        FS.chmod(path, mode, true);
      },fchmod:function (fd, mode) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        FS.chmod(stream.node, mode);
      },chown:function (path, uid, gid, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        node.node_ops.setattr(node, {
          timestamp: Date.now()
          // we ignore the uid / gid for now
        });
      },lchown:function (path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },fchown:function (fd, uid, gid) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        FS.chown(stream.node, uid, gid);
      },truncate:function (path, len) {
        if (len < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: true });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isDir(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
        }
        if (!FS.isFile(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var err = FS.nodePermissions(node, 'w');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        node.node_ops.setattr(node, {
          size: len,
          timestamp: Date.now()
        });
      },ftruncate:function (fd, len) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        FS.truncate(stream.node, len);
      },utime:function (path, atime, mtime) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        node.node_ops.setattr(node, {
          timestamp: Math.max(atime, mtime)
        });
      },open:function (path, flags, mode, fd_start, fd_end) {
        if (path === "") {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        }
        flags = typeof flags === 'string' ? FS.modeStringToFlags(flags) : flags;
        mode = typeof mode === 'undefined' ? 438 /* 0666 */ : mode;
        if ((flags & 64)) {
          mode = (mode & 4095) | 32768;
        } else {
          mode = 0;
        }
        var node;
        if (typeof path === 'object') {
          node = path;
        } else {
          path = PATH.normalize(path);
          try {
            var lookup = FS.lookupPath(path, {
              follow: !(flags & 131072)
            });
            node = lookup.node;
          } catch (e) {
            // ignore
          }
        }
        // perhaps we need to create the node
        var created = false;
        if ((flags & 64)) {
          if (node) {
            // if O_CREAT and O_EXCL are set, error out if the node already exists
            if ((flags & 128)) {
              throw new FS.ErrnoError(ERRNO_CODES.EEXIST);
            }
          } else {
            // node doesn't exist, try to create it
            node = FS.mknod(path, mode, 0);
            created = true;
          }
        }
        if (!node) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        }
        // can't truncate a device
        if (FS.isChrdev(node.mode)) {
          flags &= ~512;
        }
        // if asked only for a directory, then this must be one
        if ((flags & 65536) && !FS.isDir(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
        }
        // check permissions, if this is not a file we just created now (it is ok to
        // create and write to a file with read-only permissions; it is read-only
        // for later use)
        if (!created) {
          var err = FS.mayOpen(node, flags);
          if (err) {
            throw new FS.ErrnoError(err);
          }
        }
        // do truncation if necessary
        if ((flags & 512)) {
          FS.truncate(node, 0);
        }
        // we've already handled these, don't pass down to the underlying vfs
        flags &= ~(128 | 512);
  
        // register the stream with the filesystem
        var stream = FS.createStream({
          node: node,
          path: FS.getPath(node),  // we want the absolute path to the node
          flags: flags,
          seekable: true,
          position: 0,
          stream_ops: node.stream_ops,
          // used by the file family libc calls (fopen, fwrite, ferror, etc.)
          ungotten: [],
          error: false
        }, fd_start, fd_end);
        // call the new stream's open function
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
        if (Module['logReadFiles'] && !(flags & 1)) {
          if (!FS.readFiles) FS.readFiles = {};
          if (!(path in FS.readFiles)) {
            FS.readFiles[path] = 1;
            Module['printErr']('read file: ' + path);
          }
        }
        try {
          if (FS.trackingDelegate['onOpenFile']) {
            var trackingFlags = 0;
            if ((flags & 2097155) !== 1) {
              trackingFlags |= FS.tracking.openFlags.READ;
            }
            if ((flags & 2097155) !== 0) {
              trackingFlags |= FS.tracking.openFlags.WRITE;
            }
            FS.trackingDelegate['onOpenFile'](path, trackingFlags);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['onOpenFile']('"+path+"', flags) threw an exception: " + e.message);
        }
        return stream;
      },close:function (stream) {
        if (stream.getdents) stream.getdents = null; // free readdir state
        try {
          if (stream.stream_ops.close) {
            stream.stream_ops.close(stream);
          }
        } catch (e) {
          throw e;
        } finally {
          FS.closeStream(stream.fd);
        }
      },llseek:function (stream, offset, whence) {
        if (!stream.seekable || !stream.stream_ops.llseek) {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }
        stream.position = stream.stream_ops.llseek(stream, offset, whence);
        stream.ungotten = [];
        return stream.position;
      },read:function (stream, buffer, offset, length, position) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
        }
        if (!stream.stream_ops.read) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var seeking = true;
        if (typeof position === 'undefined') {
          position = stream.position;
          seeking = false;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }
        var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
        if (!seeking) stream.position += bytesRead;
        return bytesRead;
      },write:function (stream, buffer, offset, length, position, canOwn) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
        }
        if (!stream.stream_ops.write) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        if (stream.flags & 1024) {
          // seek to the end before writing in append mode
          FS.llseek(stream, 0, 2);
        }
        var seeking = true;
        if (typeof position === 'undefined') {
          position = stream.position;
          seeking = false;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }
        var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
        if (!seeking) stream.position += bytesWritten;
        try {
          if (stream.path && FS.trackingDelegate['onWriteToFile']) FS.trackingDelegate['onWriteToFile'](stream.path);
        } catch(e) {
          console.log("FS.trackingDelegate['onWriteToFile']('"+path+"') threw an exception: " + e.message);
        }
        return bytesWritten;
      },allocate:function (stream, offset, length) {
        if (offset < 0 || length <= 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if (!FS.isFile(stream.node.mode) && !FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
        }
        if (!stream.stream_ops.allocate) {
          throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
        }
        stream.stream_ops.allocate(stream, offset, length);
      },mmap:function (stream, buffer, offset, length, position, prot, flags) {
        // TODO if PROT is PROT_WRITE, make sure we have write access
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(ERRNO_CODES.EACCES);
        }
        if (!stream.stream_ops.mmap) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
        }
        return stream.stream_ops.mmap(stream, buffer, offset, length, position, prot, flags);
      },msync:function (stream, buffer, offset, length, mmapFlags) {
        if (!stream || !stream.stream_ops.msync) {
          return 0;
        }
        return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
      },munmap:function (stream) {
        return 0;
      },ioctl:function (stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTTY);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },readFile:function (path, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'r';
        opts.encoding = opts.encoding || 'binary';
        if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
          throw new Error('Invalid encoding type "' + opts.encoding + '"');
        }
        var ret;
        var stream = FS.open(path, opts.flags);
        var stat = FS.stat(path);
        var length = stat.size;
        var buf = new Uint8Array(length);
        FS.read(stream, buf, 0, length, 0);
        if (opts.encoding === 'utf8') {
          ret = UTF8ArrayToString(buf, 0);
        } else if (opts.encoding === 'binary') {
          ret = buf;
        }
        FS.close(stream);
        return ret;
      },writeFile:function (path, data, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'w';
        opts.encoding = opts.encoding || 'utf8';
        if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
          throw new Error('Invalid encoding type "' + opts.encoding + '"');
        }
        var stream = FS.open(path, opts.flags, opts.mode);
        if (opts.encoding === 'utf8') {
          var buf = new Uint8Array(lengthBytesUTF8(data)+1);
          var actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length);
          FS.write(stream, buf, 0, actualNumBytes, 0, opts.canOwn);
        } else if (opts.encoding === 'binary') {
          FS.write(stream, data, 0, data.length, 0, opts.canOwn);
        }
        FS.close(stream);
      },cwd:function () {
        return FS.currentPath;
      },chdir:function (path) {
        var lookup = FS.lookupPath(path, { follow: true });
        if (lookup.node === null) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        }
        if (!FS.isDir(lookup.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
        }
        var err = FS.nodePermissions(lookup.node, 'x');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        FS.currentPath = lookup.path;
      },createDefaultDirectories:function () {
        FS.mkdir('/tmp');
        FS.mkdir('/home');
        FS.mkdir('/home/web_user');
      },createDefaultDevices:function () {
        // create /dev
        FS.mkdir('/dev');
        // setup /dev/null
        FS.registerDevice(FS.makedev(1, 3), {
          read: function() { return 0; },
          write: function(stream, buffer, offset, length, pos) { return length; }
        });
        FS.mkdev('/dev/null', FS.makedev(1, 3));
        // setup /dev/tty and /dev/tty1
        // stderr needs to print output using Module['printErr']
        // so we register a second tty just for it.
        TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
        TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
        FS.mkdev('/dev/tty', FS.makedev(5, 0));
        FS.mkdev('/dev/tty1', FS.makedev(6, 0));
        // setup /dev/[u]random
        var random_device;
        if (typeof crypto !== 'undefined') {
          // for modern web browsers
          var randomBuffer = new Uint8Array(1);
          random_device = function() { crypto.getRandomValues(randomBuffer); return randomBuffer[0]; };
        } else if (ENVIRONMENT_IS_NODE) {
          // for nodejs
          random_device = function() { return require('crypto').randomBytes(1)[0]; };
        } else {
          // default for ES5 platforms
          random_device = function() { return (Math.random()*256)|0; };
        }
        FS.createDevice('/dev', 'random', random_device);
        FS.createDevice('/dev', 'urandom', random_device);
        // we're not going to emulate the actual shm device,
        // just create the tmp dirs that reside in it commonly
        FS.mkdir('/dev/shm');
        FS.mkdir('/dev/shm/tmp');
      },createSpecialDirectories:function () {
        // create /proc/self/fd which allows /proc/self/fd/6 => readlink gives the name of the stream for fd 6 (see test_unistd_ttyname)
        FS.mkdir('/proc');
        FS.mkdir('/proc/self');
        FS.mkdir('/proc/self/fd');
        FS.mount({
          mount: function() {
            var node = FS.createNode('/proc/self', 'fd', 16384 | 511 /* 0777 */, 73);
            node.node_ops = {
              lookup: function(parent, name) {
                var fd = +name;
                var stream = FS.getStream(fd);
                if (!stream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
                var ret = {
                  parent: null,
                  mount: { mountpoint: 'fake' },
                  node_ops: { readlink: function() { return stream.path } }
                };
                ret.parent = ret; // make it look like a simple root node
                return ret;
              }
            };
            return node;
          }
        }, {}, '/proc/self/fd');
      },createStandardStreams:function () {
        // TODO deprecate the old functionality of a single
        // input / output callback and that utilizes FS.createDevice
        // and instead require a unique set of stream ops
  
        // by default, we symlink the standard streams to the
        // default tty devices. however, if the standard streams
        // have been overwritten we create a unique device for
        // them instead.
        if (Module['stdin']) {
          FS.createDevice('/dev', 'stdin', Module['stdin']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdin');
        }
        if (Module['stdout']) {
          FS.createDevice('/dev', 'stdout', null, Module['stdout']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdout');
        }
        if (Module['stderr']) {
          FS.createDevice('/dev', 'stderr', null, Module['stderr']);
        } else {
          FS.symlink('/dev/tty1', '/dev/stderr');
        }
  
        // open default streams for the stdin, stdout and stderr devices
        var stdin = FS.open('/dev/stdin', 'r');
        assert(stdin.fd === 0, 'invalid handle for stdin (' + stdin.fd + ')');
  
        var stdout = FS.open('/dev/stdout', 'w');
        assert(stdout.fd === 1, 'invalid handle for stdout (' + stdout.fd + ')');
  
        var stderr = FS.open('/dev/stderr', 'w');
        assert(stderr.fd === 2, 'invalid handle for stderr (' + stderr.fd + ')');
      },ensureErrnoError:function () {
        if (FS.ErrnoError) return;
        FS.ErrnoError = function ErrnoError(errno, node) {
          //Module.printErr(stackTrace()); // useful for debugging
          this.node = node;
          this.setErrno = function(errno) {
            this.errno = errno;
            for (var key in ERRNO_CODES) {
              if (ERRNO_CODES[key] === errno) {
                this.code = key;
                break;
              }
            }
          };
          this.setErrno(errno);
          this.message = ERRNO_MESSAGES[errno];
          if (this.stack) this.stack = demangleAll(this.stack);
        };
        FS.ErrnoError.prototype = new Error();
        FS.ErrnoError.prototype.constructor = FS.ErrnoError;
        // Some errors may happen quite a bit, to avoid overhead we reuse them (and suffer a lack of stack info)
        [ERRNO_CODES.ENOENT].forEach(function(code) {
          FS.genericErrors[code] = new FS.ErrnoError(code);
          FS.genericErrors[code].stack = '<generic error, no stack>';
        });
      },staticInit:function () {
        FS.ensureErrnoError();
  
        FS.nameTable = new Array(4096);
  
        FS.mount(MEMFS, {}, '/');
  
        FS.createDefaultDirectories();
        FS.createDefaultDevices();
        FS.createSpecialDirectories();
  
        FS.filesystems = {
          'MEMFS': MEMFS,
          'IDBFS': IDBFS,
          'NODEFS': NODEFS,
          'WORKERFS': WORKERFS,
        };
      },init:function (input, output, error) {
        assert(!FS.init.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
        FS.init.initialized = true;
  
        FS.ensureErrnoError();
  
        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        Module['stdin'] = input || Module['stdin'];
        Module['stdout'] = output || Module['stdout'];
        Module['stderr'] = error || Module['stderr'];
  
        FS.createStandardStreams();
      },quit:function () {
        FS.init.initialized = false;
        // force-flush all streams, so we get musl std streams printed out
        var fflush = Module['_fflush'];
        if (fflush) fflush(0);
        // close all of our streams
        for (var i = 0; i < FS.streams.length; i++) {
          var stream = FS.streams[i];
          if (!stream) {
            continue;
          }
          FS.close(stream);
        }
      },getMode:function (canRead, canWrite) {
        var mode = 0;
        if (canRead) mode |= 292 | 73;
        if (canWrite) mode |= 146;
        return mode;
      },joinPath:function (parts, forceRelative) {
        var path = PATH.join.apply(null, parts);
        if (forceRelative && path[0] == '/') path = path.substr(1);
        return path;
      },absolutePath:function (relative, base) {
        return PATH.resolve(base, relative);
      },standardizePath:function (path) {
        return PATH.normalize(path);
      },findObject:function (path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (ret.exists) {
          return ret.object;
        } else {
          ___setErrNo(ret.error);
          return null;
        }
      },analyzePath:function (path, dontResolveLastLink) {
        // operate from within the context of the symlink's target
        try {
          var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          path = lookup.path;
        } catch (e) {
        }
        var ret = {
          isRoot: false, exists: false, error: 0, name: null, path: null, object: null,
          parentExists: false, parentPath: null, parentObject: null
        };
        try {
          var lookup = FS.lookupPath(path, { parent: true });
          ret.parentExists = true;
          ret.parentPath = lookup.path;
          ret.parentObject = lookup.node;
          ret.name = PATH.basename(path);
          lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          ret.exists = true;
          ret.path = lookup.path;
          ret.object = lookup.node;
          ret.name = lookup.node.name;
          ret.isRoot = lookup.path === '/';
        } catch (e) {
          ret.error = e.errno;
        };
        return ret;
      },createFolder:function (parent, name, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.mkdir(path, mode);
      },createPath:function (parent, path, canRead, canWrite) {
        parent = typeof parent === 'string' ? parent : FS.getPath(parent);
        var parts = path.split('/').reverse();
        while (parts.length) {
          var part = parts.pop();
          if (!part) continue;
          var current = PATH.join2(parent, part);
          try {
            FS.mkdir(current);
          } catch (e) {
            // ignore EEXIST
          }
          parent = current;
        }
        return current;
      },createFile:function (parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.create(path, mode);
      },createDataFile:function (parent, name, data, canRead, canWrite, canOwn) {
        var path = name ? PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name) : parent;
        var mode = FS.getMode(canRead, canWrite);
        var node = FS.create(path, mode);
        if (data) {
          if (typeof data === 'string') {
            var arr = new Array(data.length);
            for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
            data = arr;
          }
          // make sure we can write to the file
          FS.chmod(node, mode | 146);
          var stream = FS.open(node, 'w');
          FS.write(stream, data, 0, data.length, 0, canOwn);
          FS.close(stream);
          FS.chmod(node, mode);
        }
        return node;
      },createDevice:function (parent, name, input, output) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(!!input, !!output);
        if (!FS.createDevice.major) FS.createDevice.major = 64;
        var dev = FS.makedev(FS.createDevice.major++, 0);
        // Create a fake device that a set of stream ops to emulate
        // the old behavior.
        FS.registerDevice(dev, {
          open: function(stream) {
            stream.seekable = false;
          },
          close: function(stream) {
            // flush any pending line data
            if (output && output.buffer && output.buffer.length) {
              output(10);
            }
          },
          read: function(stream, buffer, offset, length, pos /* ignored */) {
            var bytesRead = 0;
            for (var i = 0; i < length; i++) {
              var result;
              try {
                result = input();
              } catch (e) {
                throw new FS.ErrnoError(ERRNO_CODES.EIO);
              }
              if (result === undefined && bytesRead === 0) {
                throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
              }
              if (result === null || result === undefined) break;
              bytesRead++;
              buffer[offset+i] = result;
            }
            if (bytesRead) {
              stream.node.timestamp = Date.now();
            }
            return bytesRead;
          },
          write: function(stream, buffer, offset, length, pos) {
            for (var i = 0; i < length; i++) {
              try {
                output(buffer[offset+i]);
              } catch (e) {
                throw new FS.ErrnoError(ERRNO_CODES.EIO);
              }
            }
            if (length) {
              stream.node.timestamp = Date.now();
            }
            return i;
          }
        });
        return FS.mkdev(path, mode, dev);
      },createLink:function (parent, name, target, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        return FS.symlink(target, path);
      },forceLoadFile:function (obj) {
        if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
        var success = true;
        if (typeof XMLHttpRequest !== 'undefined') {
          throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
        } else if (Module['read']) {
          // Command-line.
          try {
            // WARNING: Can't read binary files in V8's d8 or tracemonkey's js, as
            //          read() will try to parse UTF8.
            obj.contents = intArrayFromString(Module['read'](obj.url), true);
            obj.usedBytes = obj.contents.length;
          } catch (e) {
            success = false;
          }
        } else {
          throw new Error('Cannot load without read() or XMLHttpRequest.');
        }
        if (!success) ___setErrNo(ERRNO_CODES.EIO);
        return success;
      },createLazyFile:function (parent, name, url, canRead, canWrite) {
        // Lazy chunked Uint8Array (implements get and length from Uint8Array). Actual getting is abstracted away for eventual reuse.
        function LazyUint8Array() {
          this.lengthKnown = false;
          this.chunks = []; // Loaded chunks. Index is the chunk number
        }
        LazyUint8Array.prototype.get = function LazyUint8Array_get(idx) {
          if (idx > this.length-1 || idx < 0) {
            return undefined;
          }
          var chunkOffset = idx % this.chunkSize;
          var chunkNum = (idx / this.chunkSize)|0;
          return this.getter(chunkNum)[chunkOffset];
        }
        LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(getter) {
          this.getter = getter;
        }
        LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
          // Find length
          var xhr = new XMLHttpRequest();
          xhr.open('HEAD', url, false);
          xhr.send(null);
          if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
          var datalength = Number(xhr.getResponseHeader("Content-length"));
          var header;
          var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
          var usesGzip = (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";
  
          var chunkSize = 1024*1024; // Chunk size in bytes
  
          if (!hasByteServing) chunkSize = datalength;
  
          // Function to get a range from the remote URL.
          var doXHR = (function(from, to) {
            if (from > to) throw new Error("invalid range (" + from + ", " + to + ") or no bytes requested!");
            if (to > datalength-1) throw new Error("only " + datalength + " bytes available! programmer error!");
  
            // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
  
            // Some hints to the browser that we want binary data.
            if (typeof Uint8Array != 'undefined') xhr.responseType = 'arraybuffer';
            if (xhr.overrideMimeType) {
              xhr.overrideMimeType('text/plain; charset=x-user-defined');
            }
  
            xhr.send(null);
            if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
            if (xhr.response !== undefined) {
              return new Uint8Array(xhr.response || []);
            } else {
              return intArrayFromString(xhr.responseText || '', true);
            }
          });
          var lazyArray = this;
          lazyArray.setDataGetter(function(chunkNum) {
            var start = chunkNum * chunkSize;
            var end = (chunkNum+1) * chunkSize - 1; // including this byte
            end = Math.min(end, datalength-1); // if datalength-1 is selected, this is the last block
            if (typeof(lazyArray.chunks[chunkNum]) === "undefined") {
              lazyArray.chunks[chunkNum] = doXHR(start, end);
            }
            if (typeof(lazyArray.chunks[chunkNum]) === "undefined") throw new Error("doXHR failed!");
            return lazyArray.chunks[chunkNum];
          });
  
          if (usesGzip || !datalength) {
            // if the server uses gzip or doesn't supply the length, we have to download the whole file to get the (uncompressed) length
            chunkSize = datalength = 1; // this will force getter(0)/doXHR do download the whole file
            datalength = this.getter(0).length;
            chunkSize = datalength;
            console.log("LazyFiles on gzip forces download of the whole file when length is accessed");
          }
  
          this._length = datalength;
          this._chunkSize = chunkSize;
          this.lengthKnown = true;
        }
        if (typeof XMLHttpRequest !== 'undefined') {
          if (!ENVIRONMENT_IS_WORKER) throw 'Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc';
          var lazyArray = new LazyUint8Array();
          Object.defineProperties(lazyArray, {
            length: {
              get: function() {
                if(!this.lengthKnown) {
                  this.cacheLength();
                }
                return this._length;
              }
            },
            chunkSize: {
              get: function() {
                if(!this.lengthKnown) {
                  this.cacheLength();
                }
                return this._chunkSize;
              }
            }
          });
  
          var properties = { isDevice: false, contents: lazyArray };
        } else {
          var properties = { isDevice: false, url: url };
        }
  
        var node = FS.createFile(parent, name, properties, canRead, canWrite);
        // This is a total hack, but I want to get this lazy file code out of the
        // core of MEMFS. If we want to keep this lazy file concept I feel it should
        // be its own thin LAZYFS proxying calls to MEMFS.
        if (properties.contents) {
          node.contents = properties.contents;
        } else if (properties.url) {
          node.contents = null;
          node.url = properties.url;
        }
        // Add a function that defers querying the file size until it is asked the first time.
        Object.defineProperties(node, {
          usedBytes: {
            get: function() { return this.contents.length; }
          }
        });
        // override each stream op with one that tries to force load the lazy file first
        var stream_ops = {};
        var keys = Object.keys(node.stream_ops);
        keys.forEach(function(key) {
          var fn = node.stream_ops[key];
          stream_ops[key] = function forceLoadLazyFile() {
            if (!FS.forceLoadFile(node)) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
            return fn.apply(null, arguments);
          };
        });
        // use a custom read function
        stream_ops.read = function stream_ops_read(stream, buffer, offset, length, position) {
          if (!FS.forceLoadFile(node)) {
            throw new FS.ErrnoError(ERRNO_CODES.EIO);
          }
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (contents.slice) { // normal array
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          } else {
            for (var i = 0; i < size; i++) { // LazyUint8Array from sync binary XHR
              buffer[offset + i] = contents.get(position + i);
            }
          }
          return size;
        };
        node.stream_ops = stream_ops;
        return node;
      },createPreloadedFile:function (parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) {
        Browser.init(); // XXX perhaps this method should move onto Browser?
        // TODO we should allow people to just pass in a complete filename instead
        // of parent and name being that we just join them anyways
        var fullname = name ? PATH.resolve(PATH.join2(parent, name)) : parent;
        var dep = getUniqueRunDependency('cp ' + fullname); // might have several active requests for the same fullname
        function processData(byteArray) {
          function finish(byteArray) {
            if (preFinish) preFinish();
            if (!dontCreateFile) {
              FS.createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
            }
            if (onload) onload();
            removeRunDependency(dep);
          }
          var handled = false;
          Module['preloadPlugins'].forEach(function(plugin) {
            if (handled) return;
            if (plugin['canHandle'](fullname)) {
              plugin['handle'](byteArray, fullname, finish, function() {
                if (onerror) onerror();
                removeRunDependency(dep);
              });
              handled = true;
            }
          });
          if (!handled) finish(byteArray);
        }
        addRunDependency(dep);
        if (typeof url == 'string') {
          Browser.asyncLoad(url, function(byteArray) {
            processData(byteArray);
          }, onerror);
        } else {
          processData(url);
        }
      },indexedDB:function () {
        return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
      },DB_NAME:function () {
        return 'EM_FS_' + window.location.pathname;
      },DB_VERSION:20,DB_STORE_NAME:"FILE_DATA",saveFilesToDB:function (paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = function openRequest_onupgradeneeded() {
          console.log('creating db');
          var db = openRequest.result;
          db.createObjectStore(FS.DB_STORE_NAME);
        };
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          var transaction = db.transaction([FS.DB_STORE_NAME], 'readwrite');
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var putRequest = files.put(FS.analyzePath(path).object.contents, path);
            putRequest.onsuccess = function putRequest_onsuccess() { ok++; if (ok + fail == total) finish() };
            putRequest.onerror = function putRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      },loadFilesFromDB:function (paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = onerror; // no database to load from
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          try {
            var transaction = db.transaction([FS.DB_STORE_NAME], 'readonly');
          } catch(e) {
            onerror(e);
            return;
          }
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var getRequest = files.get(path);
            getRequest.onsuccess = function getRequest_onsuccess() {
              if (FS.analyzePath(path).exists) {
                FS.unlink(path);
              }
              FS.createDataFile(PATH.dirname(path), PATH.basename(path), getRequest.result, true, true, true);
              ok++;
              if (ok + fail == total) finish();
            };
            getRequest.onerror = function getRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      }};var SYSCALLS={DEFAULT_POLLMASK:5,mappings:{},umask:511,calculateAt:function (dirfd, path) {
        if (path[0] !== '/') {
          // relative path
          var dir;
          if (dirfd === -100) {
            dir = FS.cwd();
          } else {
            var dirstream = FS.getStream(dirfd);
            if (!dirstream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
            dir = dirstream.path;
          }
          path = PATH.join2(dir, path);
        }
        return path;
      },doStat:function (func, path, buf) {
        try {
          var stat = func(path);
        } catch (e) {
          if (e && e.node && PATH.normalize(path) !== PATH.normalize(FS.getPath(e.node))) {
            // an error occurred while trying to look up the path; we should just report ENOTDIR
            return -ERRNO_CODES.ENOTDIR;
          }
          throw e;
        }
        HEAP32[((buf)>>2)]=stat.dev;
        HEAP32[(((buf)+(4))>>2)]=0;
        HEAP32[(((buf)+(8))>>2)]=stat.ino;
        HEAP32[(((buf)+(12))>>2)]=stat.mode;
        HEAP32[(((buf)+(16))>>2)]=stat.nlink;
        HEAP32[(((buf)+(20))>>2)]=stat.uid;
        HEAP32[(((buf)+(24))>>2)]=stat.gid;
        HEAP32[(((buf)+(28))>>2)]=stat.rdev;
        HEAP32[(((buf)+(32))>>2)]=0;
        HEAP32[(((buf)+(36))>>2)]=stat.size;
        HEAP32[(((buf)+(40))>>2)]=4096;
        HEAP32[(((buf)+(44))>>2)]=stat.blocks;
        HEAP32[(((buf)+(48))>>2)]=(stat.atime.getTime() / 1000)|0;
        HEAP32[(((buf)+(52))>>2)]=0;
        HEAP32[(((buf)+(56))>>2)]=(stat.mtime.getTime() / 1000)|0;
        HEAP32[(((buf)+(60))>>2)]=0;
        HEAP32[(((buf)+(64))>>2)]=(stat.ctime.getTime() / 1000)|0;
        HEAP32[(((buf)+(68))>>2)]=0;
        HEAP32[(((buf)+(72))>>2)]=stat.ino;
        return 0;
      },doMsync:function (addr, stream, len, flags) {
        var buffer = new Uint8Array(HEAPU8.subarray(addr, addr + len));
        FS.msync(stream, buffer, 0, len, flags);
      },doMkdir:function (path, mode) {
        // remove a trailing slash, if one - /a/b/ has basename of '', but
        // we want to create b in the context of this function
        path = PATH.normalize(path);
        if (path[path.length-1] === '/') path = path.substr(0, path.length-1);
        FS.mkdir(path, mode, 0);
        return 0;
      },doMknod:function (path, mode, dev) {
        // we don't want this in the JS API as it uses mknod to create all nodes.
        switch (mode & 61440) {
          case 32768:
          case 8192:
          case 24576:
          case 4096:
          case 49152:
            break;
          default: return -ERRNO_CODES.EINVAL;
        }
        FS.mknod(path, mode, dev);
        return 0;
      },doReadlink:function (path, buf, bufsize) {
        if (bufsize <= 0) return -ERRNO_CODES.EINVAL;
        var ret = FS.readlink(path);
  
        var len = Math.min(bufsize, lengthBytesUTF8(ret));
        var endChar = HEAP8[buf+len];
        stringToUTF8(ret, buf, bufsize+1);
        // readlink is one of the rare functions that write out a C string, but does never append a null to the output buffer(!)
        // stringToUTF8() always appends a null byte, so restore the character under the null byte after the write.
        HEAP8[buf+len] = endChar;
  
        return len;
      },doAccess:function (path, amode) {
        if (amode & ~7) {
          // need a valid mode
          return -ERRNO_CODES.EINVAL;
        }
        var node;
        var lookup = FS.lookupPath(path, { follow: true });
        node = lookup.node;
        var perms = '';
        if (amode & 4) perms += 'r';
        if (amode & 2) perms += 'w';
        if (amode & 1) perms += 'x';
        if (perms /* otherwise, they've just passed F_OK */ && FS.nodePermissions(node, perms)) {
          return -ERRNO_CODES.EACCES;
        }
        return 0;
      },doDup:function (path, flags, suggestFD) {
        var suggest = FS.getStream(suggestFD);
        if (suggest) FS.close(suggest);
        return FS.open(path, flags, 0, suggestFD, suggestFD).fd;
      },doReadv:function (stream, iov, iovcnt, offset) {
        var ret = 0;
        for (var i = 0; i < iovcnt; i++) {
          var ptr = HEAP32[(((iov)+(i*8))>>2)];
          var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
          var curr = FS.read(stream, HEAP8,ptr, len, offset);
          if (curr < 0) return -1;
          ret += curr;
          if (curr < len) break; // nothing more to read
        }
        return ret;
      },doWritev:function (stream, iov, iovcnt, offset) {
        var ret = 0;
        for (var i = 0; i < iovcnt; i++) {
          var ptr = HEAP32[(((iov)+(i*8))>>2)];
          var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
          var curr = FS.write(stream, HEAP8,ptr, len, offset);
          if (curr < 0) return -1;
          ret += curr;
        }
        return ret;
      },varargs:0,get:function (varargs) {
        SYSCALLS.varargs += 4;
        var ret = HEAP32[(((SYSCALLS.varargs)-(4))>>2)];
        return ret;
      },getStr:function () {
        var ret = Pointer_stringify(SYSCALLS.get());
        return ret;
      },getStreamFromFD:function () {
        var stream = FS.getStream(SYSCALLS.get());
        if (!stream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        return stream;
      },getSocketFromFD:function () {
        var socket = SOCKFS.getSocket(SYSCALLS.get());
        if (!socket) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        return socket;
      },getSocketAddress:function (allowNull) {
        var addrp = SYSCALLS.get(), addrlen = SYSCALLS.get();
        if (allowNull && addrp === 0) return null;
        var info = __read_sockaddr(addrp, addrlen);
        if (info.errno) throw new FS.ErrnoError(info.errno);
        info.addr = DNS.lookup_addr(info.addr) || info.addr;
        return info;
      },get64:function () {
        var low = SYSCALLS.get(), high = SYSCALLS.get();
        if (low >= 0) assert(high === 0);
        else assert(high === -1);
        return low;
      },getZero:function () {
        assert(SYSCALLS.get() === 0);
      }};function ___syscall54(which, varargs) {if (ENVIRONMENT_IS_PTHREAD) { return _emscripten_sync_run_in_main_thread_2(138, 54, varargs) }
  SYSCALLS.varargs = varargs;
  try {
   // ioctl
      var stream = SYSCALLS.getStreamFromFD(), op = SYSCALLS.get();
      switch (op) {
        case 21505: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0;
        }
        case 21506: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0; // no-op, not actually adjusting terminal settings
        }
        case 21519: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          var argp = SYSCALLS.get();
          HEAP32[((argp)>>2)]=0;
          return 0;
        }
        case 21520: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return -ERRNO_CODES.EINVAL; // not supported
        }
        case 21531: {
          var argp = SYSCALLS.get();
          return FS.ioctl(stream, op, argp);
        }
        case 21523: {
          // TODO: in theory we should write to the winsize struct that gets
          // passed in, but for now musl doesn't read anything on it
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0;
        }
        default: abort('bad ioctl syscall ' + op);
      }
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

   

  function _confstr(name, buf, len) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_3(68, name, buf, len);
      // size_t confstr(int name, char *buf, size_t len);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/confstr.html
      var value;
      switch (name) {
        case 0:
          value = ENV['PATH'] || '/';
          break;
        case 1:
          // Mimicking glibc.
          value = 'POSIX_V6_ILP32_OFF32\nPOSIX_V6_ILP32_OFFBIG';
          break;
        case 2:
          // This JS implementation was tested against this glibc version.
          value = 'glibc 2.14';
          break;
        case 3:
          // We don't support pthreads.
          value = '';
          break;
        case 1118:
        case 1122:
        case 1124:
        case 1125:
        case 1126:
        case 1128:
        case 1129:
        case 1130:
          value = '';
          break;
        case 1116:
        case 1117:
        case 1121:
          value = '-m32';
          break;
        case 1120:
          value = '-m32 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64';
          break;
        default:
          ___setErrNo(ERRNO_CODES.EINVAL);
          return 0;
      }
      if (len == 0 || buf == 0) {
        return value.length + 1;
      } else {
        var length = Math.min(len, value.length);
        for (var i = 0; i < length; i++) {
          HEAP8[(((buf)+(i))>>0)]=value.charCodeAt(i);
        }
        if (len > length) HEAP8[(((buf)+(i++))>>0)]=0;
        return i;
      }
    }

  
  var __main_thread_futex_wait_address; if (ENVIRONMENT_IS_PTHREAD) __main_thread_futex_wait_address = PthreadWorkerInit.__main_thread_futex_wait_address; else PthreadWorkerInit.__main_thread_futex_wait_address = __main_thread_futex_wait_address = allocate(1, "i32*", ALLOC_STATIC);function _emscripten_futex_wake_or_requeue(addr, count, addr2, cmpValue) {
      if (addr <= 0 || addr2 <= 0 || addr >= HEAP8.length || addr2 >= HEAP8.length || count < 0
        || addr&3 != 0 || addr2&3 != 0) {
        return -22;
      }
  
      // See if main thread is waiting on this address? If so, wake it up by resetting its wake location to zero,
      // or move it to wait on addr2. Note that this is not a fair procedure, since we always wake main thread first before
      // any workers, so this scheme does not adhere to real queue-based waiting.
      var mainThreadWaitAddress = Atomics.load(HEAP32, __main_thread_futex_wait_address >> 2);
      var mainThreadWoken = 0;
      if (mainThreadWaitAddress == addr) {
        // Check cmpValue precondition before taking any action.
        var val1 = Atomics.load(HEAP32, addr >> 2);
        if (val1 != cmpValue) return -11;
  
        // If we are actually waking any waiters, then new main thread wait location is reset, otherwise requeue it to wait on addr2.
        var newMainThreadWaitAddress = (count > 0) ? 0 : addr2;
        var loadedAddr = Atomics.compareExchange(HEAP32, __main_thread_futex_wait_address >> 2, mainThreadWaitAddress, newMainThreadWaitAddress);
        if (loadedAddr == mainThreadWaitAddress && count > 0) {
          --count; // Main thread was woken, so one less workers to wake up.
          mainThreadWoken = 1;
        }
      }
  
      // Wake any workers waiting on this address.
      var ret = Atomics.wakeOrRequeue(HEAP32, addr >> 2, count, addr2 >> 2, cmpValue);
      if (ret == Atomics.NOTEQUAL) return -11;
      if (ret >= 0) return ret + mainThreadWoken;
      throw 'Atomics.wakeOrRequeue returned an unexpected value ' + ret;
    }

  function _pthread_cleanup_push(routine, arg) {
      if (PThread.exitHandlers === null) {
        PThread.exitHandlers = [];
        if (!ENVIRONMENT_IS_PTHREAD) {
          __ATEXIT__.push(function() { PThread.runExitHandlers(); });
        }
      }
      PThread.exitHandlers.push(function() { Module['dynCall_vi'](routine, arg) });
    }

  function _getenv(name) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_1(111, name);
      // char *getenv(const char *name);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/getenv.html
      if (name === 0) return 0;
      name = Pointer_stringify(name);
      if (!ENV.hasOwnProperty(name)) return 0;
  
      if (_getenv.ret) _free(_getenv.ret);
      _getenv.ret = allocate(intArrayFromString(ENV[name]), 'i8', ALLOC_NORMAL);
      return _getenv.ret;
    }

  
  function _emscripten_conditional_set_current_thread_status_js(expectedStatus, newStatus) {
    } 

  function _gettimeofday(ptr) {
      var now = Date.now();
      HEAP32[((ptr)>>2)]=(now/1000)|0; // seconds
      HEAP32[(((ptr)+(4))>>2)]=((now % 1000)*1000)|0; // microseconds
      return 0;
    }

  function ___cxa_find_matching_catch_2() {
          return ___cxa_find_matching_catch.apply(null, arguments);
        }

  function ___cxa_find_matching_catch_3() {
          return ___cxa_find_matching_catch.apply(null, arguments);
        }

  
  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
      return dest;
    } 

  function _utime(path, times) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_2(12, path, times);
      // int utime(const char *path, const struct utimbuf *times);
      // http://pubs.opengroup.org/onlinepubs/009695399/basedefs/utime.h.html
      var time;
      if (times) {
        // NOTE: We don't keep track of access timestamps.
        var offset = 4;
        time = HEAP32[(((times)+(offset))>>2)];
        time *= 1000;
      } else {
        time = Date.now();
      }
      path = Pointer_stringify(path);
      try {
        FS.utime(path, time, time);
        return 0;
      } catch (e) {
        FS.handleFSError(e);
        return -1;
      }
    }

   

   

   

   

  function ___gxx_personality_v0() {
    }

  
  
  var cttz_i8; if (ENVIRONMENT_IS_PTHREAD) cttz_i8 = PthreadWorkerInit.cttz_i8; else PthreadWorkerInit.cttz_i8 = cttz_i8 = allocate([8,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,5,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,6,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,5,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,7,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,5,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,6,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,5,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0], "i8", ALLOC_STATIC);   

   

  function __embind_register_memory_view(rawType, dataTypeIndex, name) {
      var typeMapping = [
          Int8Array,
          Uint8Array,
          Int16Array,
          Uint16Array,
          Int32Array,
          Uint32Array,
          Float32Array,
          Float64Array,
      ];
  
      var TA = typeMapping[dataTypeIndex];
  
      function decodeMemoryView(handle) {
          handle = handle >> 2;
          var heap = HEAPU32;
          var size = heap[handle]; // in elements
          var data = heap[handle + 1]; // byte offset into emscripten heap
          return new TA(heap['buffer'], data, size);
      }
  
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': decodeMemoryView,
          'argPackAdvance': 8,
          'readValueFromPointer': decodeMemoryView,
      }, {
          ignoreDuplicateRegistrations: true,
      });
    }


  function _clearenv(name) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_1(112, name);
      // int clearenv (void);
      // http://www.gnu.org/s/hello/manual/libc/Environment-Access.html#index-clearenv-3107
      ENV = {};
      ___buildEnvironment(ENV);
      return 0;
    }

  
  function ___cxa_free_exception(ptr) {
      try {
        return _free(ptr);
      } catch(e) { // XXX FIXME
        Module.printErr('exception during cxa_free_exception: ' + e);
      }
    }function ___cxa_end_catch() {
      // Clear state flag.
      Module['setThrew'](0);
      // Call destructor if one is registered then clear it.
      var ptr = EXCEPTIONS.caught.pop();
      if (ptr) {
        EXCEPTIONS.decRef(EXCEPTIONS.deAdjust(ptr));
        EXCEPTIONS.last = 0; // XXX in decRef?
      }
    }

  
  function _emscripten_set_current_thread_status_js(newStatus) {
    } 

  function ___assert_fail(condition, filename, line, func) {
      ABORT = true;
      throw 'Assertion failed: ' + Pointer_stringify(condition) + ', at: ' + [filename ? Pointer_stringify(filename) : 'unknown filename', line, func ? Pointer_stringify(func) : 'unknown function'] + ' at ' + stackTrace();
    }

  function __embind_register_void(rawType, name) {
      name = readLatin1String(name);
      registerType(rawType, {
          isVoid: true, // void return values can be optimized out sometimes
          name: name,
          'argPackAdvance': 0,
          'fromWireType': function() {
              return undefined;
          },
          'toWireType': function(destructors, o) {
              // TODO: assert if anything else is given?
              return undefined;
          },
      });
    }

   


  function _abort() {
      Module['abort']();
    }

  function _emscripten_futex_wait(addr, val, timeout) {
      if (addr <= 0 || addr > HEAP8.length || addr&3 != 0) return -22;
  //    dump('futex_wait addr:' + addr + ' by thread: ' + _pthread_self() + (ENVIRONMENT_IS_PTHREAD?'(pthread)':'') + '\n');
      if (ENVIRONMENT_IS_WORKER) {
        var ret = Atomics.wait(HEAP32, addr >> 2, val, timeout);
  //    dump('futex_wait done by thread: ' + _pthread_self() + (ENVIRONMENT_IS_PTHREAD?'(pthread)':'') + '\n');
        if (ret === 'timed-out') return -110;
        if (ret === 'not-equal') return -11;
        if (ret === 'ok') return 0;
        throw 'Atomics.wait returned an unexpected value ' + ret;
      } else {
        // Atomics.wait is not available in the main browser thread, so simulate it via busy spinning.
        var loadedVal = Atomics.load(HEAP32, addr >> 2);
        if (val != loadedVal) return -11;
  
        var tNow = performance.now();
        var tEnd = tNow + timeout;
  
  
        // Register globally which address the main thread is simulating to be waiting on. When zero, main thread is not waiting on anything,
        // and on nonzero, the contents of address pointed by __main_thread_futex_wait_address tell which address the main thread is simulating its wait on.
        Atomics.store(HEAP32, __main_thread_futex_wait_address >> 2, addr);
        var ourWaitAddress = addr; // We may recursively re-enter this function while processing queued calls, in which case we'll do a spurious wakeup of the older wait operation.
        while (addr == ourWaitAddress) {
          tNow = performance.now();
          if (tNow > tEnd) {
            return -110;
          }
          _emscripten_main_thread_process_queued_calls(); // We are performing a blocking loop here, so must pump any pthreads if they want to perform operations that are proxied.
          addr = Atomics.load(HEAP32, __main_thread_futex_wait_address >> 2); // Look for a worker thread waking us up.
        }
        return 0;
      }
    }


  function ___lock() {}

  function ___unlock() {}

  function _chroot(path) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_1(37, path);
      // int chroot(const char *path);
      // http://pubs.opengroup.org/onlinepubs/7908799/xsh/chroot.html
      ___setErrNo(ERRNO_CODES.EACCES);
      return -1;
    }

  var _emscripten_asm_const_int=true;

  function _setenv(envname, envval, overwrite) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_3(113, envname, envval, overwrite);
      // int setenv(const char *envname, const char *envval, int overwrite);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/setenv.html
      if (envname === 0) {
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
      }
      var name = Pointer_stringify(envname);
      var val = Pointer_stringify(envval);
      if (name === '' || name.indexOf('=') !== -1) {
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
      }
      if (ENV.hasOwnProperty(name) && !overwrite) return 0;
      ENV[name] = val;
      ___buildEnvironment(ENV);
      return 0;
    }

  
  
  var emval_free_list=[];
  
  var emval_handle_array=[{},{value:undefined},{value:null},{value:true},{value:false}];function __emval_decref(handle) {
      if (handle > 4 && 0 === --emval_handle_array[handle].refcount) {
          emval_handle_array[handle] = undefined;
          emval_free_list.push(handle);
      }
    }
  
  
  
  function count_emval_handles() {
      var count = 0;
      for (var i = 5; i < emval_handle_array.length; ++i) {
          if (emval_handle_array[i] !== undefined) {
              ++count;
          }
      }
      return count;
    }
  
  function get_first_emval() {
      for (var i = 5; i < emval_handle_array.length; ++i) {
          if (emval_handle_array[i] !== undefined) {
              return emval_handle_array[i];
          }
      }
      return null;
    }function init_emval() {
      Module['count_emval_handles'] = count_emval_handles;
      Module['get_first_emval'] = get_first_emval;
    }function __emval_register(value) {
  
      switch(value){
        case undefined :{ return 1; }
        case null :{ return 2; }
        case true :{ return 3; }
        case false :{ return 4; }
        default:{
          var handle = emval_free_list.length ?
              emval_free_list.pop() :
              emval_handle_array.length;
  
          emval_handle_array[handle] = {refcount: 1, value: value};
          return handle;
          }
        }
    }function __embind_register_emval(rawType, name) {
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(handle) {
              var rv = emval_handle_array[handle].value;
              __emval_decref(handle);
              return rv;
          },
          'toWireType': function(destructors, value) {
              return __emval_register(value);
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: null, // This type does not need a destructor
  
          // TODO: do we need a deleteObject here?  write a test where
          // emval is passed into JS via an interface
      });
    }

  function _emscripten_has_threading_support() {
      return typeof SharedArrayBuffer !== 'undefined';
    }

  function ___cxa_allocate_exception(size) {
      return _malloc(size);
    }

  function _unsetenv(name) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_1(114, name);
      // int unsetenv(const char *name);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/unsetenv.html
      if (name === 0) {
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
      }
      name = Pointer_stringify(name);
      if (name === '' || name.indexOf('=') !== -1) {
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
      }
      if (ENV.hasOwnProperty(name)) {
        delete ENV[name];
        ___buildEnvironment(ENV);
      }
      return 0;
    }

  
  function floatReadValueFromPointer(name, shift) {
      switch (shift) {
          case 2: return function(pointer) {
              return this['fromWireType'](HEAPF32[pointer >> 2]);
          };
          case 3: return function(pointer) {
              return this['fromWireType'](HEAPF64[pointer >> 3]);
          };
          default:
              throw new TypeError("Unknown float type: " + name);
      }
    }function __embind_register_float(rawType, name, size) {
      var shift = getShiftFromSize(size);
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              return value;
          },
          'toWireType': function(destructors, value) {
              // todo: Here we have an opportunity for -O3 level "unsafe" optimizations: we could
              // avoid the following if() and assume value is of proper type.
              if (typeof value !== "number" && typeof value !== "boolean") {
                  throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
              }
              return value;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': floatReadValueFromPointer(name, shift),
          destructorFunction: null, // This type does not need a destructor
      });
    }

  
  
  function _emscripten_get_now_is_monotonic() {
      // return whether emscripten_get_now is guaranteed monotonic; the Date.now
      // implementation is not :(
      return ENVIRONMENT_IS_NODE || (typeof dateNow !== 'undefined') ||
          ((ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && self['performance'] && self['performance']['now']);
    }function _clock_gettime(clk_id, tp) {
      // int clock_gettime(clockid_t clk_id, struct timespec *tp);
      var now;
      if (clk_id === 0) {
        now = Date.now();
      } else if (clk_id === 1 && _emscripten_get_now_is_monotonic()) {
        now = _emscripten_get_now();
      } else {
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
      }
      HEAP32[((tp)>>2)]=(now/1000)|0; // seconds
      HEAP32[(((tp)+(4))>>2)]=((now % 1000)*1000*1000)|0; // nanoseconds
      return 0;
    }function ___clock_gettime() {
  return _clock_gettime.apply(null, arguments)
  }

  function ___cxa_begin_catch(ptr) {
      var info = EXCEPTIONS.infos[ptr];
      if (info && !info.caught) {
        info.caught = true;
        __ZSt18uncaught_exceptionv.uncaught_exception--;
      }
      if (info) info.rethrown = false;
      EXCEPTIONS.caught.push(ptr);
      EXCEPTIONS.addRef(EXCEPTIONS.deAdjust(ptr));
      return ptr;
    }

  function ___syscall6(which, varargs) {if (ENVIRONMENT_IS_PTHREAD) { return _emscripten_sync_run_in_main_thread_2(138, 6, varargs) }
  SYSCALLS.varargs = varargs;
  try {
   // close
      var stream = SYSCALLS.getStreamFromFD();
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

   

  
    

  function _emscripten_futex_wake(addr, count) {
      if (addr <= 0 || addr > HEAP8.length || addr&3 != 0 || count < 0) return -22;
      if (count == 0) return 0;
  //    dump('futex_wake addr:' + addr + ' by thread: ' + _pthread_self() + (ENVIRONMENT_IS_PTHREAD?'(pthread)':'') + '\n');
  
      // See if main thread is waiting on this address? If so, wake it up by resetting its wake location to zero.
      // Note that this is not a fair procedure, since we always wake main thread first before any workers, so
      // this scheme does not adhere to real queue-based waiting.
      var mainThreadWaitAddress = Atomics.load(HEAP32, __main_thread_futex_wait_address >> 2);
      var mainThreadWoken = 0;
      if (mainThreadWaitAddress == addr) {
        var loadedAddr = Atomics.compareExchange(HEAP32, __main_thread_futex_wait_address >> 2, mainThreadWaitAddress, 0);
        if (loadedAddr == mainThreadWaitAddress) {
          --count;
          mainThreadWoken = 1;
          if (count <= 0) return 1;
        }
      }
  
      // Wake any workers waiting on this address.
      var ret = Atomics.wake(HEAP32, addr >> 2, count);
      if (ret >= 0) return ret + mainThreadWoken;
      throw 'Atomics.wake returned an unexpected value ' + ret;
    }

  function _emscripten_syscall(which, varargs) {
    switch (which) {
      case 54: return ___syscall54(which, varargs);
      case 6: return ___syscall6(which, varargs);
      case 140: return ___syscall140(which, varargs);
      case 146: return ___syscall146(which, varargs);
      default: throw "surprising proxied syscall: " + which;
    }
  }

  function __embind_register_std_wstring(rawType, charSize, name) {
      // nb. do not cache HEAPU16 and HEAPU32, they may be destroyed by enlargeMemory().
      name = readLatin1String(name);
      var getHeap, shift;
      if (charSize === 2) {
          getHeap = function() { return HEAPU16; };
          shift = 1;
      } else if (charSize === 4) {
          getHeap = function() { return HEAPU32; };
          shift = 2;
      }
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              var HEAP = getHeap();
              var length = HEAPU32[value >> 2];
              var a = new Array(length);
              var start = (value + 4) >> shift;
              for (var i = 0; i < length; ++i) {
                  a[i] = String.fromCharCode(HEAP[start + i]);
              }
              _free(value);
              return a.join('');
          },
          'toWireType': function(destructors, value) {
              // assumes 4-byte alignment
              var HEAP = getHeap();
              var length = value.length;
              var ptr = _malloc(4 + length * charSize);
              HEAPU32[ptr >> 2] = length;
              var start = (ptr + 4) >> shift;
              for (var i = 0; i < length; ++i) {
                  HEAP[start + i] = value.charCodeAt(i);
              }
              if (destructors !== null) {
                  destructors.push(_free, ptr);
              }
              return ptr;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: function(ptr) { _free(ptr); },
      });
    }

  function _pthread_cleanup_pop(execute) {
      var routine = PThread.exitHandlers.pop();
      if (execute) routine();
    }

  function _fpathconf(fildes, name) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_2(46, fildes, name);
      // long fpathconf(int fildes, int name);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/encrypt.html
      // NOTE: The first parameter is ignored, so pathconf == fpathconf.
      // The constants here aren't real values. Just mimicking glibc.
      switch (name) {
        case 0:
          return 32000;
        case 1:
        case 2:
        case 3:
          return 255;
        case 4:
        case 5:
        case 16:
        case 17:
        case 18:
          return 4096;
        case 6:
        case 7:
        case 20:
          return 1;
        case 8:
          return 0;
        case 9:
        case 10:
        case 11:
        case 12:
        case 14:
        case 15:
        case 19:
          return -1;
        case 13:
          return 64;
      }
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }


  function ___syscall140(which, varargs) {if (ENVIRONMENT_IS_PTHREAD) { return _emscripten_sync_run_in_main_thread_2(138, 140, varargs) }
  SYSCALLS.varargs = varargs;
  try {
   // llseek
      var stream = SYSCALLS.getStreamFromFD(), offset_high = SYSCALLS.get(), offset_low = SYSCALLS.get(), result = SYSCALLS.get(), whence = SYSCALLS.get();
      // NOTE: offset_high is unused - Emscripten's off_t is 32-bit
      var offset = offset_low;
      FS.llseek(stream, offset, whence);
      HEAP32[((result)>>2)]=stream.position;
      if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function _utimes(path, times) {
      if (ENVIRONMENT_IS_PTHREAD) return _emscripten_sync_run_in_main_thread_2(13, path, times);
      var time;
      if (times) {
        var offset = 8 + 0;
        time = HEAP32[(((times)+(offset))>>2)] * 1000;
        offset = 8 + 4;
        time += HEAP32[(((times)+(offset))>>2)] / 1000;
      } else {
        time = Date.now();
      }
      path = Pointer_stringify(path);
      try {
        FS.utime(path, time, time);
        return 0;
      } catch (e) {
        FS.handleFSError(e);
        return -1;
      }
    }

  function ___syscall146(which, varargs) {if (ENVIRONMENT_IS_PTHREAD) { return _emscripten_sync_run_in_main_thread_2(138, 146, varargs) }
  SYSCALLS.varargs = varargs;
  try {
   // writev
      var stream = SYSCALLS.getStreamFromFD(), iov = SYSCALLS.get(), iovcnt = SYSCALLS.get();
      return SYSCALLS.doWritev(stream, iov, iovcnt);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  var ___dso_handle; if (ENVIRONMENT_IS_PTHREAD) ___dso_handle = PthreadWorkerInit.___dso_handle; else PthreadWorkerInit.___dso_handle = ___dso_handle = allocate(1, "i32*", ALLOC_STATIC);
embind_init_charCodes();
BindingError = Module['BindingError'] = extendError(Error, 'BindingError');;
InternalError = Module['InternalError'] = extendError(Error, 'InternalError');;
if (!ENVIRONMENT_IS_PTHREAD) PThread.initMainThreadBlock();;
if (!ENVIRONMENT_IS_PTHREAD) ___buildEnvironment(ENV);;
if (ENVIRONMENT_IS_NODE) {
    _emscripten_get_now = function _emscripten_get_now_actual() {
      var t = process['hrtime']();
      return t[0] * 1e3 + t[1] / 1e6;
    };
  } else if (typeof dateNow !== 'undefined') {
    _emscripten_get_now = dateNow;
  } else if (typeof self === 'object' && self['performance'] && typeof self['performance']['now'] === 'function') {
    _emscripten_get_now = function() { return self['performance']['now'](); };
  } else if (typeof performance === 'object' && typeof performance['now'] === 'function') {
    _emscripten_get_now = function() { return performance['now'](); };
  } else {
    _emscripten_get_now = Date.now;
  };
FS.staticInit();__ATINIT__.unshift(function() { if (!Module["noFSInit"] && !FS.init.initialized) FS.init() });__ATMAIN__.push(function() { FS.ignorePermissions = false });__ATEXIT__.push(function() { FS.quit() });Module["FS_createFolder"] = FS.createFolder;Module["FS_createPath"] = FS.createPath;Module["FS_createDataFile"] = FS.createDataFile;Module["FS_createPreloadedFile"] = FS.createPreloadedFile;Module["FS_createLazyFile"] = FS.createLazyFile;Module["FS_createLink"] = FS.createLink;Module["FS_createDevice"] = FS.createDevice;Module["FS_unlink"] = FS.unlink;;
__ATINIT__.unshift(function() { TTY.init() });__ATEXIT__.push(function() { TTY.shutdown() });;
if (ENVIRONMENT_IS_NODE) { var fs = require("fs"); var NODEJS_PATH = require("path"); NODEFS.staticInit(); };
init_emval();;

 // proxiedFunctionTable specifies the list of functions that can be called either synchronously or asynchronously from other threads in postMessage()d or internally queued events. This way a pthread in a Worker can synchronously access e.g. the DOM on the main thread.

var proxiedFunctionTable = [null];

if (!ENVIRONMENT_IS_PTHREAD) {
 // Only main thread initializes these, pthreads copy them over at thread worker init time (in pthread-main.js)
DYNAMICTOP_PTR = allocate(1, "i32", ALLOC_STATIC);

STACK_BASE = STACKTOP = Runtime.alignMemory(STATICTOP);

STACK_MAX = STACK_BASE + TOTAL_STACK;

DYNAMIC_BASE = Runtime.alignMemory(STACK_MAX);

HEAP32[DYNAMICTOP_PTR>>2] = DYNAMIC_BASE;

staticSealed = true; // seal the static portion of memory

assert(DYNAMIC_BASE < TOTAL_MEMORY, "TOTAL_MEMORY not big enough for stack");

}


function nullFunc_iiii(x) { Module["printErr"]("Invalid function pointer called with signature 'iiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_viiiii(x) { Module["printErr"]("Invalid function pointer called with signature 'viiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_i(x) { Module["printErr"]("Invalid function pointer called with signature 'i'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_vi(x) { Module["printErr"]("Invalid function pointer called with signature 'vi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_vii(x) { Module["printErr"]("Invalid function pointer called with signature 'vii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_ii(x) { Module["printErr"]("Invalid function pointer called with signature 'ii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_viii(x) { Module["printErr"]("Invalid function pointer called with signature 'viii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_v(x) { Module["printErr"]("Invalid function pointer called with signature 'v'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_iiiii(x) { Module["printErr"]("Invalid function pointer called with signature 'iiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_viiiiii(x) { Module["printErr"]("Invalid function pointer called with signature 'viiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_iii(x) { Module["printErr"]("Invalid function pointer called with signature 'iii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function nullFunc_viiii(x) { Module["printErr"]("Invalid function pointer called with signature 'viiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  Module["printErr"]("Build with ASSERTIONS=2 for more info.");abort(x) }

function invoke_iiii(index,a1,a2,a3) {
  try {
    return Module["dynCall_iiii"](index,a1,a2,a3);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_viiiii(index,a1,a2,a3,a4,a5) {
  try {
    Module["dynCall_viiiii"](index,a1,a2,a3,a4,a5);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_i(index) {
  try {
    return Module["dynCall_i"](index);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_vi(index,a1) {
  try {
    Module["dynCall_vi"](index,a1);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_vii(index,a1,a2) {
  try {
    Module["dynCall_vii"](index,a1,a2);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_ii(index,a1) {
  try {
    return Module["dynCall_ii"](index,a1);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_viii(index,a1,a2,a3) {
  try {
    Module["dynCall_viii"](index,a1,a2,a3);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_v(index) {
  try {
    Module["dynCall_v"](index);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_iiiii(index,a1,a2,a3,a4) {
  try {
    return Module["dynCall_iiiii"](index,a1,a2,a3,a4);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_viiiiii(index,a1,a2,a3,a4,a5,a6) {
  try {
    Module["dynCall_viiiiii"](index,a1,a2,a3,a4,a5,a6);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_iii(index,a1,a2) {
  try {
    return Module["dynCall_iii"](index,a1,a2);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

function invoke_viiii(index,a1,a2,a3,a4) {
  try {
    Module["dynCall_viiii"](index,a1,a2,a3,a4);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    Module["setThrew"](1, 0);
  }
}

Module.asmGlobalArg = { "Math": Math, "Int8Array": Int8Array, "Int16Array": Int16Array, "Int32Array": Int32Array, "Uint8Array": Uint8Array, "Uint16Array": Uint16Array, "Uint32Array": Uint32Array, "Float32Array": Float32Array, "Float64Array": Float64Array, "NaN": NaN, "Infinity": Infinity };
Module.asmGlobalArg['Atomics'] = Atomics;
Module.asmLibraryArg = { "abort": abort, "assert": assert, "enlargeMemory": enlargeMemory, "getTotalMemory": getTotalMemory, "abortOnCannotGrowMemory": abortOnCannotGrowMemory, "abortStackOverflow": abortStackOverflow, "nullFunc_iiii": nullFunc_iiii, "nullFunc_viiiii": nullFunc_viiiii, "nullFunc_i": nullFunc_i, "nullFunc_vi": nullFunc_vi, "nullFunc_vii": nullFunc_vii, "nullFunc_ii": nullFunc_ii, "nullFunc_viii": nullFunc_viii, "nullFunc_v": nullFunc_v, "nullFunc_iiiii": nullFunc_iiiii, "nullFunc_viiiiii": nullFunc_viiiiii, "nullFunc_iii": nullFunc_iii, "nullFunc_viiii": nullFunc_viiii, "invoke_iiii": invoke_iiii, "invoke_viiiii": invoke_viiiii, "invoke_i": invoke_i, "invoke_vi": invoke_vi, "invoke_vii": invoke_vii, "invoke_ii": invoke_ii, "invoke_viii": invoke_viii, "invoke_v": invoke_v, "invoke_iiiii": invoke_iiiii, "invoke_viiiiii": invoke_viiiiii, "invoke_iii": invoke_iii, "invoke_viiii": invoke_viiii, "_pthread_cleanup_pop": _pthread_cleanup_pop, "__spawn_thread": __spawn_thread, "_putenv": _putenv, "floatReadValueFromPointer": floatReadValueFromPointer, "simpleReadValueFromPointer": simpleReadValueFromPointer, "_fpathconf": _fpathconf, "___gxx_personality_v0": ___gxx_personality_v0, "__embind_register_memory_view": __embind_register_memory_view, "throwInternalError": throwInternalError, "get_first_emval": get_first_emval, "_abort": _abort, "___cxa_begin_catch": ___cxa_begin_catch, "_pthread_cleanup_push": _pthread_cleanup_push, "_emscripten_futex_wake_or_requeue": _emscripten_futex_wake_or_requeue, "_emscripten_syscall": _emscripten_syscall, "__embind_register_integer": __embind_register_integer, "___unlock": ___unlock, "___assert_fail": ___assert_fail, "___cxa_free_exception": ___cxa_free_exception, "___cxa_allocate_exception": ___cxa_allocate_exception, "__ZSt18uncaught_exceptionv": __ZSt18uncaught_exceptionv, "extendError": extendError, "___buildEnvironment": ___buildEnvironment, "getShiftFromSize": getShiftFromSize, "_utimes": _utimes, "__embind_register_emval": __embind_register_emval, "_emscripten_asm_const_i": _emscripten_asm_const_i, "_clock_gettime": _clock_gettime, "_emscripten_futex_wait": _emscripten_futex_wait, "_tzset": _tzset, "___setErrNo": ___setErrNo, "__emval_register": __emval_register, "_emscripten_set_current_thread_status_js": _emscripten_set_current_thread_status_js, "_pthread_getschedparam": _pthread_getschedparam, "__embind_register_void": __embind_register_void, "_clearenv": _clearenv, "___cxa_end_catch": ___cxa_end_catch, "__embind_register_bool": __embind_register_bool, "___resumeException": ___resumeException, "___cxa_find_matching_catch_3": ___cxa_find_matching_catch_3, "_sysconf": _sysconf, "_utime": _utime, "_embind_repr": _embind_repr, "___call_main": ___call_main, "createNamedFunction": createNamedFunction, "_emscripten_get_now_is_monotonic": _emscripten_get_now_is_monotonic, "embind_init_charCodes": embind_init_charCodes, "readLatin1String": readLatin1String, "_confstr": _confstr, "_emscripten_memcpy_big": _emscripten_memcpy_big, "__emval_decref": __emval_decref, "_getenv": _getenv, "__embind_register_float": __embind_register_float, "makeLegalFunctionName": makeLegalFunctionName, "_pthread_create": _pthread_create, "___syscall54": ___syscall54, "_emscripten_has_threading_support": _emscripten_has_threading_support, "__embind_register_std_wstring": __embind_register_std_wstring, "init_emval": init_emval, "whenDependentTypesAreResolved": whenDependentTypesAreResolved, "_emscripten_get_now": _emscripten_get_now, "_chroot": _chroot, "___cxa_find_matching_catch_2": ___cxa_find_matching_catch_2, "_emscripten_futex_wake": _emscripten_futex_wake, "___cxa_atexit": ___cxa_atexit, "registerType": registerType, "___cxa_throw": ___cxa_throw, "___lock": ___lock, "throwBindingError": throwBindingError, "___syscall6": ___syscall6, "_unsetenv": _unsetenv, "___clock_gettime": ___clock_gettime, "count_emval_handles": count_emval_handles, "_gettimeofday": _gettimeofday, "_atexit": _atexit, "___syscall140": ___syscall140, "_emscripten_set_thread_name_js": _emscripten_set_thread_name_js, "integerReadValueFromPointer": integerReadValueFromPointer, "__embind_register_std_string": __embind_register_std_string, "___cxa_find_matching_catch": ___cxa_find_matching_catch, "_setenv": _setenv, "___syscall146": ___syscall146, "_emscripten_conditional_set_current_thread_status_js": _emscripten_conditional_set_current_thread_status_js, "DYNAMICTOP_PTR": DYNAMICTOP_PTR, "tempDoublePtr": tempDoublePtr, "ABORT": ABORT, "STACKTOP": STACKTOP, "STACK_MAX": STACK_MAX, "cttz_i8": cttz_i8, "___dso_handle": ___dso_handle };
// EMSCRIPTEN_START_ASM
var asm = (function(global, env, buffer) {
'almost asm';


  var HEAP8 = new global.Int8Array(buffer);
  var HEAP16 = new global.Int16Array(buffer);
  var HEAP32 = new global.Int32Array(buffer);
  var HEAPU8 = new global.Uint8Array(buffer);
  var HEAPU16 = new global.Uint16Array(buffer);
  var HEAPU32 = new global.Uint32Array(buffer);
  var HEAPF32 = new global.Float32Array(buffer);
  var HEAPF64 = new global.Float64Array(buffer);

  var DYNAMICTOP_PTR=env.DYNAMICTOP_PTR|0;
  var tempDoublePtr=env.tempDoublePtr|0;
  var ABORT=env.ABORT|0;
  var STACKTOP=env.STACKTOP|0;
  var STACK_MAX=env.STACK_MAX|0;
  var cttz_i8=env.cttz_i8|0;
  var ___dso_handle=env.___dso_handle|0;

  var __THREW__ = 0;
  var threwValue = 0;
  var setjmpId = 0;
  var undef = 0;
  var nan = global.NaN, inf = global.Infinity;
  var tempInt = 0, tempBigInt = 0, tempBigIntS = 0, tempValue = 0, tempDouble = 0.0;
  var tempRet0 = 0;

  var __pthread_ptr = 0;
  var __pthread_is_main_runtime_thread = 0;
  var __pthread_is_main_browser_thread = 0;

  var Math_floor=global.Math.floor;
  var Math_abs=global.Math.abs;
  var Math_sqrt=global.Math.sqrt;
  var Math_pow=global.Math.pow;
  var Math_cos=global.Math.cos;
  var Math_sin=global.Math.sin;
  var Math_tan=global.Math.tan;
  var Math_acos=global.Math.acos;
  var Math_asin=global.Math.asin;
  var Math_atan=global.Math.atan;
  var Math_atan2=global.Math.atan2;
  var Math_exp=global.Math.exp;
  var Math_log=global.Math.log;
  var Math_ceil=global.Math.ceil;
  var Math_imul=global.Math.imul;
  var Math_min=global.Math.min;
  var Math_max=global.Math.max;
  var Math_clz32=global.Math.clz32;
  var abort=env.abort;
  var assert=env.assert;
  var enlargeMemory=env.enlargeMemory;
  var getTotalMemory=env.getTotalMemory;
  var abortOnCannotGrowMemory=env.abortOnCannotGrowMemory;
  var abortStackOverflow=env.abortStackOverflow;
  var nullFunc_iiii=env.nullFunc_iiii;
  var nullFunc_viiiii=env.nullFunc_viiiii;
  var nullFunc_i=env.nullFunc_i;
  var nullFunc_vi=env.nullFunc_vi;
  var nullFunc_vii=env.nullFunc_vii;
  var nullFunc_ii=env.nullFunc_ii;
  var nullFunc_viii=env.nullFunc_viii;
  var nullFunc_v=env.nullFunc_v;
  var nullFunc_iiiii=env.nullFunc_iiiii;
  var nullFunc_viiiiii=env.nullFunc_viiiiii;
  var nullFunc_iii=env.nullFunc_iii;
  var nullFunc_viiii=env.nullFunc_viiii;
  var invoke_iiii=env.invoke_iiii;
  var invoke_viiiii=env.invoke_viiiii;
  var invoke_i=env.invoke_i;
  var invoke_vi=env.invoke_vi;
  var invoke_vii=env.invoke_vii;
  var invoke_ii=env.invoke_ii;
  var invoke_viii=env.invoke_viii;
  var invoke_v=env.invoke_v;
  var invoke_iiiii=env.invoke_iiiii;
  var invoke_viiiiii=env.invoke_viiiiii;
  var invoke_iii=env.invoke_iii;
  var invoke_viiii=env.invoke_viiii;
  var _pthread_cleanup_pop=env._pthread_cleanup_pop;
  var __spawn_thread=env.__spawn_thread;
  var _putenv=env._putenv;
  var floatReadValueFromPointer=env.floatReadValueFromPointer;
  var simpleReadValueFromPointer=env.simpleReadValueFromPointer;
  var _fpathconf=env._fpathconf;
  var ___gxx_personality_v0=env.___gxx_personality_v0;
  var __embind_register_memory_view=env.__embind_register_memory_view;
  var throwInternalError=env.throwInternalError;
  var get_first_emval=env.get_first_emval;
  var _abort=env._abort;
  var ___cxa_begin_catch=env.___cxa_begin_catch;
  var _pthread_cleanup_push=env._pthread_cleanup_push;
  var _emscripten_futex_wake_or_requeue=env._emscripten_futex_wake_or_requeue;
  var _emscripten_syscall=env._emscripten_syscall;
  var __embind_register_integer=env.__embind_register_integer;
  var ___unlock=env.___unlock;
  var ___assert_fail=env.___assert_fail;
  var ___cxa_free_exception=env.___cxa_free_exception;
  var ___cxa_allocate_exception=env.___cxa_allocate_exception;
  var __ZSt18uncaught_exceptionv=env.__ZSt18uncaught_exceptionv;
  var extendError=env.extendError;
  var ___buildEnvironment=env.___buildEnvironment;
  var getShiftFromSize=env.getShiftFromSize;
  var _utimes=env._utimes;
  var __embind_register_emval=env.__embind_register_emval;
  var _emscripten_asm_const_i=env._emscripten_asm_const_i;
  var _clock_gettime=env._clock_gettime;
  var _emscripten_futex_wait=env._emscripten_futex_wait;
  var _tzset=env._tzset;
  var ___setErrNo=env.___setErrNo;
  var __emval_register=env.__emval_register;
  var _emscripten_set_current_thread_status_js=env._emscripten_set_current_thread_status_js;
  var _pthread_getschedparam=env._pthread_getschedparam;
  var __embind_register_void=env.__embind_register_void;
  var _clearenv=env._clearenv;
  var ___cxa_end_catch=env.___cxa_end_catch;
  var __embind_register_bool=env.__embind_register_bool;
  var ___resumeException=env.___resumeException;
  var ___cxa_find_matching_catch_3=env.___cxa_find_matching_catch_3;
  var _sysconf=env._sysconf;
  var _utime=env._utime;
  var _embind_repr=env._embind_repr;
  var ___call_main=env.___call_main;
  var createNamedFunction=env.createNamedFunction;
  var _emscripten_get_now_is_monotonic=env._emscripten_get_now_is_monotonic;
  var embind_init_charCodes=env.embind_init_charCodes;
  var readLatin1String=env.readLatin1String;
  var _confstr=env._confstr;
  var _emscripten_memcpy_big=env._emscripten_memcpy_big;
  var __emval_decref=env.__emval_decref;
  var _getenv=env._getenv;
  var __embind_register_float=env.__embind_register_float;
  var makeLegalFunctionName=env.makeLegalFunctionName;
  var _pthread_create=env._pthread_create;
  var ___syscall54=env.___syscall54;
  var _emscripten_has_threading_support=env._emscripten_has_threading_support;
  var __embind_register_std_wstring=env.__embind_register_std_wstring;
  var init_emval=env.init_emval;
  var whenDependentTypesAreResolved=env.whenDependentTypesAreResolved;
  var _emscripten_get_now=env._emscripten_get_now;
  var _chroot=env._chroot;
  var ___cxa_find_matching_catch_2=env.___cxa_find_matching_catch_2;
  var _emscripten_futex_wake=env._emscripten_futex_wake;
  var ___cxa_atexit=env.___cxa_atexit;
  var registerType=env.registerType;
  var ___cxa_throw=env.___cxa_throw;
  var ___lock=env.___lock;
  var throwBindingError=env.throwBindingError;
  var ___syscall6=env.___syscall6;
  var _unsetenv=env._unsetenv;
  var ___clock_gettime=env.___clock_gettime;
  var count_emval_handles=env.count_emval_handles;
  var _gettimeofday=env._gettimeofday;
  var _atexit=env._atexit;
  var ___syscall140=env.___syscall140;
  var _emscripten_set_thread_name_js=env._emscripten_set_thread_name_js;
  var integerReadValueFromPointer=env.integerReadValueFromPointer;
  var __embind_register_std_string=env.__embind_register_std_string;
  var ___cxa_find_matching_catch=env.___cxa_find_matching_catch;
  var _setenv=env._setenv;
  var ___syscall146=env.___syscall146;
  var _emscripten_conditional_set_current_thread_status_js=env._emscripten_conditional_set_current_thread_status_js;
  var Atomics_load=global.Atomics.load;
  var Atomics_store=global.Atomics.store;
  var Atomics_exchange=global.Atomics.exchange;
  var Atomics_compareExchange=global.Atomics.compareExchange;
  var Atomics_add=global.Atomics.add;
  var Atomics_sub=global.Atomics.sub;
  var Atomics_and=global.Atomics.and;
  var Atomics_or=global.Atomics.or;
  var Atomics_xor=global.Atomics.xor;
  var tempFloat = 0.0;

// EMSCRIPTEN_START_FUNCS

function stackAlloc(size) {
  size = size|0;
  var ret = 0;
  ret = STACKTOP;
  STACKTOP = (STACKTOP + size)|0;
  STACKTOP = (STACKTOP + 15)&-16;
  if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(size|0);

  return ret|0;
}
function stackSave() {
  return STACKTOP|0;
}
function stackRestore(top) {
  top = top|0;
  STACKTOP = top;
}
function establishStackSpace(stackBase, stackMax) {
  stackBase = stackBase|0;
  stackMax = stackMax|0;
  STACKTOP = stackBase;
  STACK_MAX = stackMax;
}

function setThrew(threw, value) {
  threw = threw|0;
  value = value|0;
  if ((__THREW__|0) == 0) {
    __THREW__ = threw;
    threwValue = value;
  }
}

function setTempRet0(value) {
  value = value|0;
  tempRet0 = value;
}
function getTempRet0() {
  return tempRet0|0;
}

function ___cxx_global_var_init() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 (___cxa_atexit((48|0),(7240|0),(___dso_handle|0))|0);
 return;
}
function ___cxx_global_var_init_1() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 (___cxa_atexit((49|0),(7268|0),(___dso_handle|0))|0);
 return;
}
function ___cxx_global_var_init_2() {
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 80|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(80|0);
 $3 = sp + 52|0;
 $6 = sp + 40|0;
 $10 = sp + 24|0;
 $13 = sp + 12|0;
 $16 = 7316;
 $17 = $16;
 $15 = $17;
 $18 = $15;
 $14 = $18;
 $19 = $14;
 HEAP32[$19>>2] = 0;
 $20 = ((($19)) + 4|0);
 HEAP32[$20>>2] = 0;
 $21 = ((($19)) + 8|0);
 HEAP32[$21>>2] = 0;
 $22 = ((($19)) + 12|0);
 $12 = $22;
 HEAP32[$13>>2] = 0;
 $23 = $12;
 $11 = $13;
 $24 = $11;
 $25 = HEAP32[$24>>2]|0;
 $9 = $23;
 HEAP32[$10>>2] = $25;
 $26 = $9;
 $8 = $26;
 $7 = $10;
 $27 = $7;
 $28 = HEAP32[$27>>2]|0;
 HEAP32[$26>>2] = $28;
 $29 = ((($18)) + 16|0);
 HEAP32[$29>>2] = 0;
 $30 = ((($18)) + 20|0);
 $5 = $30;
 HEAP32[$6>>2] = 0;
 $31 = $5;
 $4 = $6;
 $32 = $4;
 $33 = HEAP32[$32>>2]|0;
 $2 = $31;
 HEAP32[$3>>2] = $33;
 $34 = $2;
 $1 = $34;
 $0 = $3;
 $35 = $0;
 $36 = HEAP32[$35>>2]|0;
 HEAP32[$34>>2] = $36;
 (___cxa_atexit((50|0),(7316|0),(___dso_handle|0))|0);
 STACKTOP = sp;return;
}
function __ZNSt3__25dequeI7MessageNS_9allocatorIS1_EEED2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = $1;
 __ZNSt3__212__deque_baseI7MessageNS_9allocatorIS1_EEED2Ev($2);
 STACKTOP = sp;return;
}
function __Z4pushv() {
 var $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0;
 var $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0;
 var $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0;
 var $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0;
 var $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0;
 var $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0;
 var $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0;
 var $99 = 0, $vararg_buffer = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 272|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(272|0);
 $vararg_buffer = sp + 16|0;
 $38 = sp + 8|0;
 $40 = sp + 269|0;
 $51 = sp + 268|0;
 $59 = sp;
 $60 = sp + 40|0;
 $63 = sp + 20|0;
 while(1) {
  ;HEAP32[$59>>2]=HEAP32[8>>2]|0;HEAP32[$59+4>>2]=HEAP32[8+4>>2]|0;
  __ZNSt3__211this_thread9sleep_forIxNS_5ratioILx1ELx1000EEEEEvRKNS_6chrono8durationIT_T0_EE($59);
  $57 = $60;
  $58 = 7240;
  $64 = $57;
  $65 = $58;
  HEAP32[$64>>2] = $65;
  $66 = HEAP32[$64>>2]|0;
  __ZNSt3__25mutex4lockEv($66);
  __THREW__ = 0;
  (invoke_iii(51,(1296|0),($vararg_buffer|0))|0);
  $67 = __THREW__; __THREW__ = 0;
  $68 = $67&1;
  if ($68) {
   break;
  }
  $55 = $63;
  $56 = 1313;
  $69 = $55;
  $54 = $69;
  $70 = $54;
  $53 = $70;
  $71 = $53;
  $52 = $71;
  ;HEAP32[$71>>2]=0|0;HEAP32[$71+4>>2]=0|0;HEAP32[$71+8>>2]=0|0;
  $72 = $56;
  $73 = $56;
  $74 = (__ZNSt3__211char_traitsIcE6lengthEPKc($73)|0);
  $46 = $69;
  $47 = $72;
  $48 = $74;
  $75 = $46;
  $76 = $48;
  $44 = $75;
  $77 = $44;
  $43 = $77;
  $78 = $43;
  $42 = $78;
  $79 = $42;
  $41 = $79;
  $80 = $41;
  $39 = $80;
  $81 = $39;
  ;HEAP8[$38>>0]=HEAP8[$40>>0]|0;
  $37 = $81;
  $82 = $37;
  $36 = $82;
  $45 = -1;
  $83 = $45;
  $84 = (($83) - 16)|0;
  $85 = ($76>>>0)>($84>>>0);
  if ($85) {
   label = 4;
   break;
  }
  $87 = $48;
  $88 = ($87>>>0)<(11);
  $89 = $48;
  if ($88) {
   $34 = $75;
   $35 = $89;
   $90 = $34;
   $91 = $35;
   $92 = $91&255;
   $33 = $90;
   $93 = $33;
   $32 = $93;
   $94 = $32;
   $95 = ((($94)) + 11|0);
   HEAP8[$95>>0] = $92;
   $31 = $75;
   $96 = $31;
   $30 = $96;
   $97 = $30;
   $29 = $97;
   $98 = $29;
   $28 = $98;
   $99 = $28;
   $27 = $99;
   $100 = $27;
   $49 = $100;
  } else {
   $6 = $89;
   $101 = $6;
   $102 = ($101>>>0)<(11);
   if ($102) {
    $109 = 11;
   } else {
    $103 = $6;
    $104 = (($103) + 1)|0;
    $5 = $104;
    $105 = $5;
    $106 = (($105) + 15)|0;
    $107 = $106 & -16;
    $109 = $107;
   }
   $108 = (($109) - 1)|0;
   $50 = $108;
   $4 = $75;
   $110 = $4;
   $3 = $110;
   $111 = $3;
   $2 = $111;
   $112 = $2;
   $113 = $50;
   $114 = (($113) + 1)|0;
   $12 = $112;
   $13 = $114;
   $115 = $12;
   $116 = $13;
   $9 = $115;
   $10 = $116;
   $11 = 0;
   $117 = $9;
   $8 = $117;
   $118 = $10;
   $7 = $118;
   $119 = $7;
   __THREW__ = 0;
   $120 = (invoke_ii(53,($119|0))|0);
   $121 = __THREW__; __THREW__ = 0;
   $122 = $121&1;
   if ($122) {
    break;
   }
   $49 = $120;
   $123 = $49;
   $16 = $75;
   $17 = $123;
   $124 = $16;
   $125 = $17;
   $15 = $124;
   $126 = $15;
   $14 = $126;
   $127 = $14;
   HEAP32[$127>>2] = $125;
   $128 = $50;
   $129 = (($128) + 1)|0;
   $20 = $75;
   $21 = $129;
   $130 = $20;
   $131 = $21;
   $132 = -2147483648 | $131;
   $19 = $130;
   $133 = $19;
   $18 = $133;
   $134 = $18;
   $135 = ((($134)) + 8|0);
   HEAP32[$135>>2] = $132;
   $136 = $48;
   $24 = $75;
   $25 = $136;
   $137 = $24;
   $138 = $25;
   $23 = $137;
   $139 = $23;
   $22 = $139;
   $140 = $22;
   $141 = ((($140)) + 4|0);
   HEAP32[$141>>2] = $138;
  }
  $142 = $49;
  $26 = $142;
  $143 = $26;
  $144 = $47;
  $145 = $48;
  (__ZNSt3__211char_traitsIcE4copyEPcPKcj($143,$144,$145)|0);
  $146 = $49;
  $147 = $48;
  $148 = (($146) + ($147)|0);
  HEAP8[$51>>0] = 0;
  __ZNSt3__211char_traitsIcE6assignERcRKc($148,$51);
  __THREW__ = 0;
  invoke_vii(54,(7316|0),($63|0));
  $149 = __THREW__; __THREW__ = 0;
  $150 = $149&1;
  if ($150) {
   label = 14;
   break;
  }
  __ZN7MessageD2Ev($63);
  __ZNSt3__218condition_variable10notify_allEv(7268);
  $1 = $60;
  $151 = $1;
  $152 = HEAP32[$151>>2]|0;
  __ZNSt3__25mutex6unlockEv($152);
 }
 if ((label|0) == 4) {
  __THREW__ = 0;
  invoke_vi(52,($75|0));
  $86 = __THREW__; __THREW__ = 0;
 }
 else if ((label|0) == 14) {
  $155 = ___cxa_find_matching_catch_2()|0;
  $156 = tempRet0;
  $61 = $155;
  $62 = $156;
  __ZN7MessageD2Ev($63);
  $0 = $60;
  $157 = $0;
  $158 = HEAP32[$157>>2]|0;
  __ZNSt3__25mutex6unlockEv($158);
  $159 = $61;
  $160 = $62;
  ___resumeException($159|0);
  // unreachable;
 }
 $153 = ___cxa_find_matching_catch_2()|0;
 $154 = tempRet0;
 $61 = $153;
 $62 = $154;
 $0 = $60;
 $157 = $0;
 $158 = HEAP32[$157>>2]|0;
 __ZNSt3__25mutex6unlockEv($158);
 $159 = $61;
 $160 = $62;
 ___resumeException($159|0);
 // unreachable;
}
function __ZNSt3__211this_thread9sleep_forIxNS_5ratioILx1ELx1000EEEEEvRKNS_6chrono8durationIT_T0_EE($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0;
 var $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0;
 var $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0;
 var $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0;
 var $171 = 0, $172 = 0, $173 = 0.0, $174 = 0, $175 = 0, $176 = 0.0, $177 = 0.0, $178 = 0.0, $179 = 0, $18 = 0, $180 = 0.0, $181 = 0, $182 = 0.0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0.0;
 var $19 = 0, $190 = 0.0, $191 = 0, $192 = 0, $193 = 0.0, $194 = 0.0, $195 = 0.0, $196 = 0, $197 = 0.0, $198 = 0, $199 = 0.0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0;
 var $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0;
 var $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0;
 var $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0;
 var $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0, $279 = 0;
 var $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0, $297 = 0;
 var $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0, $314 = 0;
 var $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0, $332 = 0;
 var $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0, $35 = 0, $350 = 0;
 var $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0, $366 = 0, $367 = 0, $368 = 0, $369 = 0;
 var $37 = 0, $370 = 0, $371 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0;
 var $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0;
 var $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0;
 var $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 512|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(512|0);
 $8 = sp + 506|0;
 $17 = sp + 208|0;
 $20 = sp + 200|0;
 $21 = sp + 192|0;
 $23 = sp + 505|0;
 $27 = sp + 184|0;
 $34 = sp + 176|0;
 $37 = sp + 168|0;
 $38 = sp + 160|0;
 $40 = sp + 504|0;
 $44 = sp + 152|0;
 $48 = sp + 144|0;
 $49 = sp + 136|0;
 $52 = sp + 503|0;
 $57 = sp + 128|0;
 $60 = sp + 120|0;
 $61 = sp + 112|0;
 $63 = sp + 502|0;
 $69 = sp + 104|0;
 $72 = sp + 96|0;
 $73 = sp + 88|0;
 $75 = sp + 501|0;
 $79 = sp + 80|0;
 $85 = sp + 72|0;
 $86 = sp + 64|0;
 $89 = sp + 500|0;
 $94 = sp + 56|0;
 $95 = sp + 48|0;
 $99 = sp + 40|0;
 $100 = sp + 32|0;
 $102 = sp + 24|0;
 $103 = sp + 16|0;
 $104 = sp + 8|0;
 $105 = sp;
 $101 = $0;
 $106 = $101;
 $107 = $100;
 $108 = $107;
 HEAP32[$108>>2] = 0;
 $109 = (($107) + 4)|0;
 $110 = $109;
 HEAP32[$110>>2] = 0;
 $96 = $99;
 $97 = $100;
 $98 = 0;
 $111 = $96;
 $112 = $97;
 $113 = $112;
 $114 = $113;
 $115 = HEAP32[$114>>2]|0;
 $116 = (($113) + 4)|0;
 $117 = $116;
 $118 = HEAP32[$117>>2]|0;
 $119 = $111;
 $120 = $119;
 HEAP32[$120>>2] = $115;
 $121 = (($119) + 4)|0;
 $122 = $121;
 HEAP32[$122>>2] = $118;
 $123 = $99;
 $124 = $123;
 $125 = HEAP32[$124>>2]|0;
 $126 = (($123) + 4)|0;
 $127 = $126;
 $128 = HEAP32[$127>>2]|0;
 $129 = $102;
 $130 = $129;
 HEAP32[$130>>2] = $125;
 $131 = (($129) + 4)|0;
 $132 = $131;
 HEAP32[$132>>2] = $128;
 $9 = $106;
 $10 = $102;
 $133 = $10;
 $134 = $9;
 $6 = $133;
 $7 = $134;
 $135 = $6;
 $136 = $7;
 $3 = $8;
 $4 = $135;
 $5 = $136;
 $137 = $4;
 $2 = $137;
 $138 = $2;
 $139 = $138;
 $140 = $139;
 $141 = HEAP32[$140>>2]|0;
 $142 = (($139) + 4)|0;
 $143 = $142;
 $144 = HEAP32[$143>>2]|0;
 $145 = $5;
 $1 = $145;
 $146 = $1;
 $147 = $146;
 $148 = $147;
 $149 = HEAP32[$148>>2]|0;
 $150 = (($147) + 4)|0;
 $151 = $150;
 $152 = HEAP32[$151>>2]|0;
 $153 = ($144|0)<($152|0);
 $154 = ($141>>>0)<($149>>>0);
 $155 = ($144|0)==($152|0);
 $156 = $155 & $154;
 $157 = $153 | $156;
 if (!($157)) {
  STACKTOP = sp;return;
 }
 $158 = $101;
 $50 = $158;
 $51 = 16;
 $159 = $50;
 $160 = $51;
 $45 = $52;
 $46 = $159;
 $47 = $160;
 $161 = $46;
 $41 = $48;
 $42 = $161;
 $43 = 0;
 $162 = $41;
 $163 = $42;
 $39 = $163;
 $164 = $39;
 $35 = $40;
 $36 = $164;
 $165 = $36;
 $33 = $165;
 $166 = $33;
 $167 = $166;
 $168 = $167;
 $169 = HEAP32[$168>>2]|0;
 $170 = (($167) + 4)|0;
 $171 = $170;
 $172 = HEAP32[$171>>2]|0;
 $173 = (+($169>>>0)) + (4294967296.0*(+($172|0)));
 HEAPF64[$37>>3] = $173;
 $30 = $34;
 $31 = $37;
 $32 = 0;
 $174 = $30;
 $175 = $31;
 $176 = +HEAPF64[$175>>3];
 HEAPF64[$174>>3] = $176;
 $177 = +HEAPF64[$34>>3];
 HEAPF64[$38>>3] = $177;
 $178 = +HEAPF64[$38>>3];
 HEAPF64[$44>>3] = $178;
 $29 = $44;
 $179 = $29;
 $180 = +HEAPF64[$179>>3];
 HEAPF64[$162>>3] = $180;
 $11 = $48;
 $181 = $11;
 $182 = +HEAPF64[$181>>3];
 $183 = $47;
 $24 = $49;
 $25 = $183;
 $26 = 0;
 $184 = $24;
 $185 = $25;
 $22 = $185;
 $186 = $22;
 $18 = $23;
 $19 = $186;
 $187 = $19;
 $16 = $187;
 $188 = $16;
 $189 = +HEAPF64[$188>>3];
 $190 = $189 * 1000.0;
 HEAPF64[$20>>3] = $190;
 $13 = $17;
 $14 = $20;
 $15 = 0;
 $191 = $13;
 $192 = $14;
 $193 = +HEAPF64[$192>>3];
 HEAPF64[$191>>3] = $193;
 $194 = +HEAPF64[$17>>3];
 HEAPF64[$21>>3] = $194;
 $195 = +HEAPF64[$21>>3];
 HEAPF64[$27>>3] = $195;
 $12 = $27;
 $196 = $12;
 $197 = +HEAPF64[$196>>3];
 HEAPF64[$184>>3] = $197;
 $28 = $49;
 $198 = $28;
 $199 = +HEAPF64[$198>>3];
 $200 = $182 < $199;
 if ($200) {
  $201 = $101;
  $62 = $201;
  $202 = $62;
  $58 = $63;
  $59 = $202;
  $203 = $59;
  $56 = $203;
  $204 = $56;
  $205 = $204;
  $206 = $205;
  $207 = HEAP32[$206>>2]|0;
  $208 = (($205) + 4)|0;
  $209 = $208;
  $210 = HEAP32[$209>>2]|0;
  $211 = (___muldi3(($207|0),($210|0),1000000,0)|0);
  $212 = tempRet0;
  $213 = $60;
  $214 = $213;
  HEAP32[$214>>2] = $211;
  $215 = (($213) + 4)|0;
  $216 = $215;
  HEAP32[$216>>2] = $212;
  $53 = $57;
  $54 = $60;
  $55 = 0;
  $217 = $53;
  $218 = $54;
  $219 = $218;
  $220 = $219;
  $221 = HEAP32[$220>>2]|0;
  $222 = (($219) + 4)|0;
  $223 = $222;
  $224 = HEAP32[$223>>2]|0;
  $225 = $217;
  $226 = $225;
  HEAP32[$226>>2] = $221;
  $227 = (($225) + 4)|0;
  $228 = $227;
  HEAP32[$228>>2] = $224;
  $229 = $57;
  $230 = $229;
  $231 = HEAP32[$230>>2]|0;
  $232 = (($229) + 4)|0;
  $233 = $232;
  $234 = HEAP32[$233>>2]|0;
  $235 = $61;
  $236 = $235;
  HEAP32[$236>>2] = $231;
  $237 = (($235) + 4)|0;
  $238 = $237;
  HEAP32[$238>>2] = $234;
  $239 = $61;
  $240 = $239;
  $241 = HEAP32[$240>>2]|0;
  $242 = (($239) + 4)|0;
  $243 = $242;
  $244 = HEAP32[$243>>2]|0;
  $245 = $104;
  $246 = $245;
  HEAP32[$246>>2] = $241;
  $247 = (($245) + 4)|0;
  $248 = $247;
  HEAP32[$248>>2] = $244;
  ;HEAP32[$103>>2]=HEAP32[$104>>2]|0;HEAP32[$103+4>>2]=HEAP32[$104+4>>2]|0;
  $249 = $101;
  $87 = $103;
  $88 = $249;
  $250 = $87;
  $251 = $88;
  $82 = $89;
  $83 = $250;
  $84 = $251;
  $252 = $83;
  ;HEAP32[$85>>2]=HEAP32[$252>>2]|0;HEAP32[$85+4>>2]=HEAP32[$252+4>>2]|0;
  $81 = $85;
  $253 = $81;
  $254 = $253;
  $255 = $254;
  $256 = HEAP32[$255>>2]|0;
  $257 = (($254) + 4)|0;
  $258 = $257;
  $259 = HEAP32[$258>>2]|0;
  $260 = $84;
  $76 = $86;
  $77 = $260;
  $78 = 0;
  $261 = $76;
  $262 = $77;
  $74 = $262;
  $263 = $74;
  $70 = $75;
  $71 = $263;
  $264 = $71;
  $68 = $264;
  $265 = $68;
  $266 = $265;
  $267 = $266;
  $268 = HEAP32[$267>>2]|0;
  $269 = (($266) + 4)|0;
  $270 = $269;
  $271 = HEAP32[$270>>2]|0;
  $272 = (___muldi3(($268|0),($271|0),1000000,0)|0);
  $273 = tempRet0;
  $274 = $72;
  $275 = $274;
  HEAP32[$275>>2] = $272;
  $276 = (($274) + 4)|0;
  $277 = $276;
  HEAP32[$277>>2] = $273;
  $65 = $69;
  $66 = $72;
  $67 = 0;
  $278 = $65;
  $279 = $66;
  $280 = $279;
  $281 = $280;
  $282 = HEAP32[$281>>2]|0;
  $283 = (($280) + 4)|0;
  $284 = $283;
  $285 = HEAP32[$284>>2]|0;
  $286 = $278;
  $287 = $286;
  HEAP32[$287>>2] = $282;
  $288 = (($286) + 4)|0;
  $289 = $288;
  HEAP32[$289>>2] = $285;
  $290 = $69;
  $291 = $290;
  $292 = HEAP32[$291>>2]|0;
  $293 = (($290) + 4)|0;
  $294 = $293;
  $295 = HEAP32[$294>>2]|0;
  $296 = $73;
  $297 = $296;
  HEAP32[$297>>2] = $292;
  $298 = (($296) + 4)|0;
  $299 = $298;
  HEAP32[$299>>2] = $295;
  $300 = $73;
  $301 = $300;
  $302 = HEAP32[$301>>2]|0;
  $303 = (($300) + 4)|0;
  $304 = $303;
  $305 = HEAP32[$304>>2]|0;
  $306 = $79;
  $307 = $306;
  HEAP32[$307>>2] = $302;
  $308 = (($306) + 4)|0;
  $309 = $308;
  HEAP32[$309>>2] = $305;
  $64 = $79;
  $310 = $64;
  $311 = $310;
  $312 = $311;
  $313 = HEAP32[$312>>2]|0;
  $314 = (($311) + 4)|0;
  $315 = $314;
  $316 = HEAP32[$315>>2]|0;
  $317 = $261;
  $318 = $317;
  HEAP32[$318>>2] = $313;
  $319 = (($317) + 4)|0;
  $320 = $319;
  HEAP32[$320>>2] = $316;
  $80 = $86;
  $321 = $80;
  $322 = $321;
  $323 = $322;
  $324 = HEAP32[$323>>2]|0;
  $325 = (($322) + 4)|0;
  $326 = $325;
  $327 = HEAP32[$326>>2]|0;
  $328 = ($259|0)<($327|0);
  $329 = ($256>>>0)<($324>>>0);
  $330 = ($259|0)==($327|0);
  $331 = $330 & $329;
  $332 = $328 | $331;
  if ($332) {
   $90 = $103;
   $333 = $90;
   $334 = $333;
   $335 = $334;
   $336 = HEAP32[$335>>2]|0;
   $337 = (($334) + 4)|0;
   $338 = $337;
   $339 = HEAP32[$338>>2]|0;
   $340 = (_i64Add(($336|0),($339|0),1,0)|0);
   $341 = tempRet0;
   $342 = $333;
   $343 = $342;
   HEAP32[$343>>2] = $340;
   $344 = (($342) + 4)|0;
   $345 = $344;
   HEAP32[$345>>2] = $341;
  }
 } else {
  $346 = $95;
  $347 = $346;
  HEAP32[$347>>2] = -1;
  $348 = (($346) + 4)|0;
  $349 = $348;
  HEAP32[$349>>2] = 2147483647;
  $91 = $94;
  $92 = $95;
  $93 = 0;
  $350 = $91;
  $351 = $92;
  $352 = $351;
  $353 = $352;
  $354 = HEAP32[$353>>2]|0;
  $355 = (($352) + 4)|0;
  $356 = $355;
  $357 = HEAP32[$356>>2]|0;
  $358 = $350;
  $359 = $358;
  HEAP32[$359>>2] = $354;
  $360 = (($358) + 4)|0;
  $361 = $360;
  HEAP32[$361>>2] = $357;
  $362 = $94;
  $363 = $362;
  $364 = HEAP32[$363>>2]|0;
  $365 = (($362) + 4)|0;
  $366 = $365;
  $367 = HEAP32[$366>>2]|0;
  $368 = $105;
  $369 = $368;
  HEAP32[$369>>2] = $364;
  $370 = (($368) + 4)|0;
  $371 = $370;
  HEAP32[$371>>2] = $367;
  ;HEAP32[$103>>2]=HEAP32[$105>>2]|0;HEAP32[$103+4>>2]=HEAP32[$105+4>>2]|0;
 }
 __ZNSt3__211this_thread9sleep_forERKNS_6chrono8durationIxNS_5ratioILx1ELx1000000000EEEEE($103);
 STACKTOP = sp;return;
}
function __ZNSt3__25dequeI7MessageNS_9allocatorIS1_EEE9push_backEOS1_($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0;
 var $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0;
 var $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0;
 var $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 144|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(144|0);
 $20 = sp;
 $25 = sp + 140|0;
 $35 = sp + 8|0;
 $32 = $0;
 $33 = $1;
 $36 = $32;
 $31 = $36;
 $37 = $31;
 $38 = ((($37)) + 20|0);
 $30 = $38;
 $39 = $30;
 $29 = $39;
 $40 = $29;
 $34 = $40;
 $11 = $36;
 $41 = $11;
 $10 = $41;
 $42 = $10;
 $9 = $42;
 $43 = $9;
 $44 = ((($43)) + 8|0);
 $45 = HEAP32[$44>>2]|0;
 $46 = ((($43)) + 4|0);
 $47 = HEAP32[$46>>2]|0;
 $48 = $45;
 $49 = $47;
 $50 = (($48) - ($49))|0;
 $51 = (($50|0) / 4)&-1;
 $52 = ($51|0)==(0);
 if ($52) {
  $73 = 0;
 } else {
  $8 = $42;
  $53 = $8;
  $54 = ((($53)) + 8|0);
  $55 = HEAP32[$54>>2]|0;
  $56 = ((($53)) + 4|0);
  $57 = HEAP32[$56>>2]|0;
  $58 = $55;
  $59 = $57;
  $60 = (($58) - ($59))|0;
  $61 = (($60|0) / 4)&-1;
  $62 = ($61*341)|0;
  $63 = (($62) - 1)|0;
  $73 = $63;
 }
 $64 = ((($41)) + 16|0);
 $65 = HEAP32[$64>>2]|0;
 $7 = $41;
 $66 = $7;
 $67 = ((($66)) + 20|0);
 $6 = $67;
 $68 = $6;
 $5 = $68;
 $69 = $5;
 $70 = HEAP32[$69>>2]|0;
 $71 = (($65) + ($70))|0;
 $72 = (($73) - ($71))|0;
 $74 = ($72|0)==(0);
 if ($74) {
  __ZNSt3__25dequeI7MessageNS_9allocatorIS1_EEE19__add_back_capacityEv($36);
 }
 $75 = $34;
 __ZNSt3__212__deque_baseI7MessageNS_9allocatorIS1_EEE3endEv($35,$36);
 $2 = $35;
 $76 = $2;
 $77 = ((($76)) + 4|0);
 $78 = HEAP32[$77>>2]|0;
 $3 = $78;
 $79 = $3;
 $80 = $33;
 $4 = $80;
 $81 = $4;
 $22 = $75;
 $23 = $79;
 $24 = $81;
 $82 = $22;
 $83 = $23;
 $84 = $24;
 $21 = $84;
 $85 = $21;
 ;HEAP8[$20>>0]=HEAP8[$25>>0]|0;
 $17 = $82;
 $18 = $83;
 $19 = $85;
 $86 = $17;
 $87 = $18;
 $88 = $19;
 $16 = $88;
 $89 = $16;
 $13 = $86;
 $14 = $87;
 $15 = $89;
 $90 = $14;
 $91 = $15;
 $12 = $91;
 $92 = $12;
 __ZN7MessageC2EOS_($90,$92);
 $28 = $36;
 $93 = $28;
 $94 = ((($93)) + 20|0);
 $27 = $94;
 $95 = $27;
 $26 = $95;
 $96 = $26;
 $97 = HEAP32[$96>>2]|0;
 $98 = (($97) + 1)|0;
 HEAP32[$96>>2] = $98;
 STACKTOP = sp;return;
}
function __ZN7MessageD2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = $1;
 __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($2);
 STACKTOP = sp;return;
}
function __Z3popv() {
 var $$byval_copy = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0;
 var $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0;
 var $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0;
 var $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0;
 var $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $vararg_buffer = 0, $vararg_buffer1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 144|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(144|0);
 $$byval_copy = sp + 129|0;
 $vararg_buffer1 = sp + 8|0;
 $vararg_buffer = sp;
 $22 = sp + 32|0;
 $25 = sp + 128|0;
 $26 = sp + 12|0;
 while(1) {
  $20 = $22;
  $21 = 7240;
  $27 = $20;
  $28 = $21;
  $19 = $28;
  $29 = $19;
  HEAP32[$27>>2] = $29;
  $30 = ((($27)) + 4|0);
  HEAP8[$30>>0] = 1;
  $31 = HEAP32[$27>>2]|0;
  __ZNSt3__25mutex4lockEv($31);
  __THREW__ = 0;
  (invoke_iii(51,(1321|0),($vararg_buffer|0))|0);
  $32 = __THREW__; __THREW__ = 0;
  $33 = $32&1;
  if ($33) {
   label = 12;
   break;
  }
  __THREW__ = 0;
  ;HEAP8[$$byval_copy>>0]=HEAP8[$25>>0]|0;
  invoke_viii(55,(7268|0),($22|0),($$byval_copy|0));
  $34 = __THREW__; __THREW__ = 0;
  $35 = $34&1;
  if ($35) {
   label = 12;
   break;
  }
  $18 = 7316;
  $36 = $18;
  $17 = $36;
  $37 = $17;
  $38 = ((($37)) + 4|0);
  $39 = HEAP32[$38>>2]|0;
  $40 = ((($36)) + 16|0);
  $41 = HEAP32[$40>>2]|0;
  $42 = (($41>>>0) / 341)&-1;
  $43 = (($39) + ($42<<2)|0);
  $44 = HEAP32[$43>>2]|0;
  $45 = ((($36)) + 16|0);
  $46 = HEAP32[$45>>2]|0;
  $47 = (($46>>>0) % 341)&-1;
  $48 = (($44) + (($47*12)|0)|0);
  __THREW__ = 0;
  invoke_vii(56,($26|0),($48|0));
  $49 = __THREW__; __THREW__ = 0;
  $50 = $49&1;
  if ($50) {
   label = 12;
   break;
  }
  $15 = $26;
  $51 = $15;
  $14 = $51;
  $52 = $14;
  $13 = $52;
  $53 = $13;
  $12 = $53;
  $54 = $12;
  $11 = $54;
  $55 = $11;
  $10 = $55;
  $56 = $10;
  $57 = ((($56)) + 11|0);
  $58 = HEAP8[$57>>0]|0;
  $59 = $58&255;
  $60 = $59 & 128;
  $61 = ($60|0)!=(0);
  if ($61) {
   $4 = $53;
   $62 = $4;
   $3 = $62;
   $63 = $3;
   $2 = $63;
   $64 = $2;
   $65 = HEAP32[$64>>2]|0;
   $71 = $65;
  } else {
   $9 = $53;
   $66 = $9;
   $8 = $66;
   $67 = $8;
   $7 = $67;
   $68 = $7;
   $6 = $68;
   $69 = $6;
   $5 = $69;
   $70 = $5;
   $71 = $70;
  }
  $1 = $71;
  $72 = $1;
  __THREW__ = 0;
  HEAP32[$vararg_buffer1>>2] = $72;
  (invoke_iii(51,(1342|0),($vararg_buffer1|0))|0);
  $73 = __THREW__; __THREW__ = 0;
  $74 = $73&1;
  if ($74) {
   label = 13;
   break;
  }
  __THREW__ = 0;
  invoke_vi(57,(7316|0));
  $75 = __THREW__; __THREW__ = 0;
  $76 = $75&1;
  if ($76) {
   label = 13;
   break;
  }
  __ZN7MessageD2Ev($26);
  $0 = $22;
  $77 = $0;
  $78 = ((($77)) + 4|0);
  $79 = HEAP8[$78>>0]|0;
  $80 = $79&1;
  if (!($80)) {
   continue;
  }
  $81 = HEAP32[$77>>2]|0;
  __ZNSt3__25mutex6unlockEv($81);
 }
 if ((label|0) == 12) {
  $82 = ___cxa_find_matching_catch_2()|0;
  $83 = tempRet0;
  $23 = $82;
  $24 = $83;
 }
 else if ((label|0) == 13) {
  $84 = ___cxa_find_matching_catch_2()|0;
  $85 = tempRet0;
  $23 = $84;
  $24 = $85;
  __ZN7MessageD2Ev($26);
 }
 $16 = $22;
 $86 = $16;
 $87 = ((($86)) + 4|0);
 $88 = HEAP8[$87>>0]|0;
 $89 = $88&1;
 if (!($89)) {
  $91 = $23;
  $92 = $24;
  ___resumeException($91|0);
  // unreachable;
 }
 $90 = HEAP32[$86>>2]|0;
 __ZNSt3__25mutex6unlockEv($90);
 $91 = $23;
 $92 = $24;
 ___resumeException($91|0);
 // unreachable;
}
function __ZNSt3__218condition_variable4waitIZ3popvE3__0EEvRNS_11unique_lockINS_5mutexEEET_($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $3 = $0;
 $4 = $1;
 $5 = $3;
 while(1) {
  $6 = (__ZZ3popvENK3__0clEv($2)|0);
  $7 = $6 ^ 1;
  if (!($7)) {
   break;
  }
  $8 = $4;
  __ZNSt3__218condition_variable4waitERNS_11unique_lockINS_5mutexEEE($5,$8);
 }
 STACKTOP = sp;return;
}
function __ZN7MessageC2ERKS_($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $2 = $0;
 $3 = $1;
 $4 = $2;
 $5 = $3;
 __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEEC2ERKS5_($4,$5);
 STACKTOP = sp;return;
}
function __ZNSt3__25dequeI7MessageNS_9allocatorIS1_EEE9pop_frontEv($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0;
 var $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0;
 var $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0;
 var $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0;
 var $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 144|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(144|0);
 $6 = sp + 8|0;
 $9 = sp + 129|0;
 $24 = sp;
 $27 = sp + 128|0;
 $32 = $0;
 $34 = $32;
 $31 = $34;
 $35 = $31;
 $36 = ((($35)) + 20|0);
 $30 = $36;
 $37 = $30;
 $29 = $37;
 $38 = $29;
 $33 = $38;
 $39 = $33;
 $14 = $34;
 $40 = $14;
 $41 = ((($40)) + 4|0);
 $42 = HEAP32[$41>>2]|0;
 $43 = ((($34)) + 16|0);
 $44 = HEAP32[$43>>2]|0;
 $45 = (($44>>>0) / 341)&-1;
 $46 = (($42) + ($45<<2)|0);
 $47 = HEAP32[$46>>2]|0;
 $48 = ((($34)) + 16|0);
 $49 = HEAP32[$48>>2]|0;
 $50 = (($49>>>0) % 341)&-1;
 $51 = (($47) + (($50*12)|0)|0);
 $1 = $51;
 $52 = $1;
 $7 = $39;
 $8 = $52;
 $53 = $7;
 $54 = $8;
 ;HEAP8[$6>>0]=HEAP8[$9>>0]|0;
 $4 = $53;
 $5 = $54;
 $55 = $4;
 $56 = $5;
 $2 = $55;
 $3 = $56;
 $57 = $3;
 __ZN7MessageD2Ev($57);
 $12 = $34;
 $58 = $12;
 $59 = ((($58)) + 20|0);
 $11 = $59;
 $60 = $11;
 $10 = $60;
 $61 = $10;
 $62 = HEAP32[$61>>2]|0;
 $63 = (($62) + -1)|0;
 HEAP32[$61>>2] = $63;
 $64 = ((($34)) + 16|0);
 $65 = HEAP32[$64>>2]|0;
 $66 = (($65) + 1)|0;
 HEAP32[$64>>2] = $66;
 $67 = ($66>>>0)>=(682);
 if (!($67)) {
  STACKTOP = sp;return;
 }
 $68 = $33;
 $13 = $34;
 $69 = $13;
 $70 = ((($69)) + 4|0);
 $71 = HEAP32[$70>>2]|0;
 $72 = HEAP32[$71>>2]|0;
 $19 = $68;
 $20 = $72;
 $21 = 341;
 $73 = $19;
 $74 = $20;
 $75 = $21;
 $16 = $73;
 $17 = $74;
 $18 = $75;
 $76 = $17;
 $15 = $76;
 $77 = $15;
 __ZdlPv($77);
 $28 = $34;
 $78 = $28;
 $79 = ((($78)) + 4|0);
 $80 = HEAP32[$79>>2]|0;
 $81 = ((($80)) + 4|0);
 $25 = $78;
 $26 = $81;
 $82 = $25;
 $83 = $26;
 ;HEAP8[$24>>0]=HEAP8[$27>>0]|0;
 $22 = $82;
 $23 = $83;
 $84 = $22;
 $85 = $23;
 $86 = ((($84)) + 4|0);
 HEAP32[$86>>2] = $85;
 $87 = ((($34)) + 16|0);
 $88 = HEAP32[$87>>2]|0;
 $89 = (($88) - 341)|0;
 HEAP32[$87>>2] = $89;
 STACKTOP = sp;return;
}
function _main() {
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $0 = sp + 12|0;
 $1 = sp + 8|0;
 __ZNSt3__26threadC2IRFvvEJEvEEOT_DpOT0_($0,58);
 __THREW__ = 0;
 invoke_vii(59,($1|0),(60|0));
 $4 = __THREW__; __THREW__ = 0;
 $5 = $4&1;
 if ($5) {
  $6 = ___cxa_find_matching_catch_2()|0;
  $7 = tempRet0;
  $2 = $6;
  $3 = $7;
  __ZNSt3__26threadD2Ev($0);
  $8 = $2;
  $9 = $3;
  ___resumeException($8|0);
  // unreachable;
 } else {
  __ZNSt3__26threadD2Ev($1);
  __ZNSt3__26threadD2Ev($0);
  STACKTOP = sp;return 0;
 }
 return (0)|0;
}
function __ZNSt3__26threadC2IRFvvEJEvEEOT_DpOT0_($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0;
 var $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0;
 var $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0;
 var $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0;
 var $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0;
 var $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0;
 var $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0;
 var $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0;
 var $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0;
 var $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0, $279 = 0, $28 = 0;
 var $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0;
 var $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0;
 var $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0;
 var $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0;
 var $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 560|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(560|0);
 $28 = sp + 440|0;
 $31 = sp + 428|0;
 $34 = sp + 416|0;
 $53 = sp + 340|0;
 $54 = sp + 40|0;
 $57 = sp + 328|0;
 $58 = sp + 553|0;
 $59 = sp + 32|0;
 $71 = sp + 552|0;
 $83 = sp + 24|0;
 $84 = sp + 16|0;
 $85 = sp + 8|0;
 $86 = sp;
 $91 = sp + 551|0;
 $92 = sp + 550|0;
 $93 = sp + 549|0;
 $94 = sp + 548|0;
 $125 = sp + 100|0;
 $128 = sp + 88|0;
 $131 = sp + 76|0;
 $134 = sp + 64|0;
 $137 = sp + 52|0;
 $138 = sp + 48|0;
 $132 = $0;
 $133 = $1;
 $140 = $132;
 $141 = (__Znwj(4)|0);
 __THREW__ = 0;
 invoke_vi(61,($141|0));
 $142 = __THREW__; __THREW__ = 0;
 $143 = $142&1;
 if ($143) {
  $235 = ___cxa_find_matching_catch_2()|0;
  $236 = tempRet0;
  $135 = $235;
  $136 = $236;
  __ZdlPv($141);
  $293 = $135;
  $294 = $136;
  ___resumeException($293|0);
  // unreachable;
 }
 $130 = $134;
 HEAP32[$131>>2] = $141;
 $144 = $130;
 $129 = $131;
 $145 = $129;
 $146 = HEAP32[$145>>2]|0;
 $127 = $144;
 HEAP32[$128>>2] = $146;
 $147 = $127;
 $126 = $128;
 $148 = $126;
 $149 = HEAP32[$148>>2]|0;
 $124 = $147;
 HEAP32[$125>>2] = $149;
 $150 = $124;
 $123 = $125;
 $151 = $123;
 $152 = HEAP32[$151>>2]|0;
 HEAP32[$150>>2] = $152;
 __THREW__ = 0;
 $153 = (invoke_ii(53,8)|0);
 $154 = __THREW__; __THREW__ = 0;
 $155 = $154&1;
 if ($155) {
  $237 = ___cxa_find_matching_catch_2()|0;
  $238 = tempRet0;
  $135 = $237;
  $136 = $238;
 } else {
  $110 = $134;
  $156 = $110;
  $157 = $133;
  $109 = $157;
  $158 = $109;
  $96 = $158;
  $159 = $96;
  $95 = $159;
  $160 = $95;
  HEAP32[$138>>2] = $160;
  $88 = $153;
  $89 = $156;
  $90 = $138;
  $161 = $88;
  $162 = $89;
  $87 = $162;
  $163 = $87;
  $164 = $90;
  $47 = $164;
  $165 = $47;
  ;HEAP8[$83>>0]=HEAP8[$94>>0]|0;
  ;HEAP8[$84>>0]=HEAP8[$93>>0]|0;
  ;HEAP8[$85>>0]=HEAP8[$92>>0]|0;
  ;HEAP8[$86>>0]=HEAP8[$91>>0]|0;
  $80 = $161;
  $81 = $163;
  $82 = $165;
  $166 = $80;
  $167 = $81;
  $79 = $167;
  $168 = $79;
  $73 = $166;
  $74 = $168;
  $169 = $73;
  $170 = $74;
  $72 = $170;
  $171 = $72;
  $69 = $169;
  $70 = $171;
  $172 = $69;
  $173 = $70;
  $67 = $173;
  $174 = $67;
  $66 = $174;
  $175 = $66;
  $65 = $175;
  $176 = $65;
  $177 = HEAP32[$176>>2]|0;
  $68 = $177;
  $64 = $174;
  $178 = $64;
  $63 = $178;
  $179 = $63;
  HEAP32[$179>>2] = 0;
  $180 = $68;
  $181 = $70;
  $62 = $181;
  $182 = $62;
  $61 = $182;
  $183 = $61;
  $60 = $183;
  $184 = $60;
  $48 = $184;
  ;HEAP8[$59>>0]=HEAP8[$71>>0]|0;
  $56 = $172;
  HEAP32[$57>>2] = $180;
  $185 = $56;
  $55 = $57;
  $186 = $55;
  $187 = HEAP32[$186>>2]|0;
  $49 = $59;
  ;HEAP8[$54>>0]=HEAP8[$58>>0]|0;
  $52 = $185;
  HEAP32[$53>>2] = $187;
  $188 = $52;
  $51 = $54;
  $50 = $53;
  $189 = $50;
  $190 = HEAP32[$189>>2]|0;
  HEAP32[$188>>2] = $190;
  $191 = ((($166)) + 4|0);
  $192 = $82;
  $75 = $192;
  $193 = $75;
  $77 = $191;
  $78 = $193;
  $194 = $77;
  $195 = $78;
  $76 = $195;
  $196 = $76;
  $197 = HEAP32[$196>>2]|0;
  HEAP32[$194>>2] = $197;
  $33 = $137;
  HEAP32[$34>>2] = $153;
  $198 = $33;
  $32 = $34;
  $199 = $32;
  $200 = HEAP32[$199>>2]|0;
  $30 = $198;
  HEAP32[$31>>2] = $200;
  $201 = $30;
  $29 = $31;
  $202 = $29;
  $203 = HEAP32[$202>>2]|0;
  $27 = $201;
  HEAP32[$28>>2] = $203;
  $204 = $27;
  $26 = $28;
  $205 = $26;
  $206 = HEAP32[$205>>2]|0;
  HEAP32[$204>>2] = $206;
  $25 = $137;
  $207 = $25;
  $24 = $207;
  $208 = $24;
  $23 = $208;
  $209 = $23;
  $210 = HEAP32[$209>>2]|0;
  $8 = $140;
  $9 = 62;
  $10 = $210;
  $211 = $8;
  $212 = $9;
  $213 = $10;
  __THREW__ = 0;
  $214 = (invoke_iiiii(63,($211|0),(0|0),($212|0),($213|0))|0);
  $215 = __THREW__; __THREW__ = 0;
  $216 = $215&1;
  do {
   if (!($216)) {
    $139 = $214;
    $217 = $139;
    $218 = ($217|0)==(0);
    if (!($218)) {
     $256 = $139;
     __THREW__ = 0;
     invoke_vii(64,($256|0),(1431|0));
     $257 = __THREW__; __THREW__ = 0;
     break;
    }
    $6 = $137;
    $219 = $6;
    $5 = $219;
    $220 = $5;
    $4 = $220;
    $221 = $4;
    $222 = HEAP32[$221>>2]|0;
    $7 = $222;
    $3 = $219;
    $223 = $3;
    $2 = $223;
    $224 = $2;
    HEAP32[$224>>2] = 0;
    $46 = $137;
    $225 = $46;
    $43 = $225;
    $44 = 0;
    $226 = $43;
    $42 = $226;
    $227 = $42;
    $41 = $227;
    $228 = $41;
    $229 = HEAP32[$228>>2]|0;
    $45 = $229;
    $230 = $44;
    $38 = $226;
    $231 = $38;
    $37 = $231;
    $232 = $37;
    HEAP32[$232>>2] = $230;
    $233 = $45;
    $234 = ($233|0)!=(0|0);
    if ($234) {
     $36 = $226;
     $258 = $36;
     $35 = $258;
     $259 = $35;
     $260 = $45;
     $39 = $259;
     $40 = $260;
     $261 = $40;
     $262 = ($261|0)==(0|0);
     if (!($262)) {
      __ZNSt3__25tupleIJNS_10unique_ptrINS_15__thread_structENS_14default_deleteIS2_EEEEPFvvEEED2Ev($261);
      __ZdlPv($261);
     }
    }
    $108 = $134;
    $263 = $108;
    $105 = $263;
    $106 = 0;
    $264 = $105;
    $104 = $264;
    $265 = $104;
    $103 = $265;
    $266 = $103;
    $267 = HEAP32[$266>>2]|0;
    $107 = $267;
    $268 = $106;
    $100 = $264;
    $269 = $100;
    $99 = $269;
    $270 = $99;
    HEAP32[$270>>2] = $268;
    $271 = $107;
    $272 = ($271|0)!=(0|0);
    if (!($272)) {
     STACKTOP = sp;return;
    }
    $98 = $264;
    $273 = $98;
    $97 = $273;
    $274 = $97;
    $275 = $107;
    $101 = $274;
    $102 = $275;
    $276 = $102;
    $277 = ($276|0)==(0|0);
    if ($277) {
     STACKTOP = sp;return;
    }
    __ZNSt3__215__thread_structD2Ev($276);
    __ZdlPv($276);
    STACKTOP = sp;return;
   }
  } while(0);
  $239 = ___cxa_find_matching_catch_2()|0;
  $240 = tempRet0;
  $135 = $239;
  $136 = $240;
  $22 = $137;
  $241 = $22;
  $19 = $241;
  $20 = 0;
  $242 = $19;
  $18 = $242;
  $243 = $18;
  $17 = $243;
  $244 = $17;
  $245 = HEAP32[$244>>2]|0;
  $21 = $245;
  $246 = $20;
  $14 = $242;
  $247 = $14;
  $13 = $247;
  $248 = $13;
  HEAP32[$248>>2] = $246;
  $249 = $21;
  $250 = ($249|0)!=(0|0);
  if ($250) {
   $12 = $242;
   $251 = $12;
   $11 = $251;
   $252 = $11;
   $253 = $21;
   $15 = $252;
   $16 = $253;
   $254 = $16;
   $255 = ($254|0)==(0|0);
   if (!($255)) {
    __ZNSt3__25tupleIJNS_10unique_ptrINS_15__thread_structENS_14default_deleteIS2_EEEEPFvvEEED2Ev($254);
    __ZdlPv($254);
   }
  }
 }
 $122 = $134;
 $278 = $122;
 $119 = $278;
 $120 = 0;
 $279 = $119;
 $118 = $279;
 $280 = $118;
 $117 = $280;
 $281 = $117;
 $282 = HEAP32[$281>>2]|0;
 $121 = $282;
 $283 = $120;
 $114 = $279;
 $284 = $114;
 $113 = $284;
 $285 = $113;
 HEAP32[$285>>2] = $283;
 $286 = $121;
 $287 = ($286|0)!=(0|0);
 if (!($287)) {
  $293 = $135;
  $294 = $136;
  ___resumeException($293|0);
  // unreachable;
 }
 $112 = $279;
 $288 = $112;
 $111 = $288;
 $289 = $111;
 $290 = $121;
 $115 = $289;
 $116 = $290;
 $291 = $116;
 $292 = ($291|0)==(0|0);
 if ($292) {
  $293 = $135;
  $294 = $136;
  ___resumeException($293|0);
  // unreachable;
 }
 __ZNSt3__215__thread_structD2Ev($291);
 __ZdlPv($291);
 $293 = $135;
 $294 = $136;
 ___resumeException($293|0);
 // unreachable;
}
function __ZNSt3__212__deque_baseI7MessageNS_9allocatorIS1_EEED2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0;
 var $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 64|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(64|0);
 $13 = $0;
 $16 = $13;
 __ZNSt3__212__deque_baseI7MessageNS_9allocatorIS1_EEE5clearEv($16);
 $12 = $16;
 $17 = $12;
 $18 = ((($17)) + 4|0);
 $19 = HEAP32[$18>>2]|0;
 $14 = $19;
 $11 = $16;
 $20 = $11;
 $21 = ((($20)) + 8|0);
 $22 = HEAP32[$21>>2]|0;
 $15 = $22;
 while(1) {
  $23 = $14;
  $24 = $15;
  $25 = ($23|0)!=($24|0);
  if (!($25)) {
   break;
  }
  $10 = $16;
  $26 = $10;
  $27 = ((($26)) + 20|0);
  $9 = $27;
  $28 = $9;
  $8 = $28;
  $29 = $8;
  $30 = $14;
  $31 = HEAP32[$30>>2]|0;
  $5 = $29;
  $6 = $31;
  $7 = 341;
  $32 = $5;
  $33 = $6;
  $34 = $7;
  $2 = $32;
  $3 = $33;
  $4 = $34;
  $35 = $3;
  $1 = $35;
  $36 = $1;
  __ZdlPv($36);
  $37 = $14;
  $38 = ((($37)) + 4|0);
  $14 = $38;
 }
 __ZNSt3__214__split_bufferIP7MessageNS_9allocatorIS2_EEED2Ev($16);
 STACKTOP = sp;return;
}
function __ZNSt3__212__deque_baseI7MessageNS_9allocatorIS1_EEE5clearEv($0) {
 $0 = $0|0;
 var $$sink = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0;
 var $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0;
 var $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0;
 var $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0;
 var $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0;
 var $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 192|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(192|0);
 $6 = sp + 8|0;
 $9 = sp + 177|0;
 $26 = sp;
 $29 = sp + 176|0;
 $41 = sp + 24|0;
 $42 = sp + 16|0;
 $39 = $0;
 $43 = $39;
 $38 = $43;
 $44 = $38;
 $45 = ((($44)) + 20|0);
 $37 = $45;
 $46 = $37;
 $36 = $46;
 $47 = $36;
 $40 = $47;
 __ZNSt3__212__deque_baseI7MessageNS_9allocatorIS1_EEE5beginEv($41,$43);
 __ZNSt3__212__deque_baseI7MessageNS_9allocatorIS1_EEE3endEv($42,$43);
 while(1) {
  $34 = $41;
  $35 = $42;
  $48 = $34;
  $49 = $35;
  $32 = $48;
  $33 = $49;
  $50 = $32;
  $51 = ((($50)) + 4|0);
  $52 = HEAP32[$51>>2]|0;
  $53 = $33;
  $54 = ((($53)) + 4|0);
  $55 = HEAP32[$54>>2]|0;
  $56 = ($52|0)==($55|0);
  $57 = $56 ^ 1;
  if (!($57)) {
   break;
  }
  $58 = $40;
  $16 = $41;
  $59 = $16;
  $60 = ((($59)) + 4|0);
  $61 = HEAP32[$60>>2]|0;
  $1 = $61;
  $62 = $1;
  $7 = $58;
  $8 = $62;
  $63 = $7;
  $64 = $8;
  ;HEAP8[$6>>0]=HEAP8[$9>>0]|0;
  $4 = $63;
  $5 = $64;
  $65 = $4;
  $66 = $5;
  $2 = $65;
  $3 = $66;
  $67 = $3;
  __ZN7MessageD2Ev($67);
  $10 = $41;
  $68 = $10;
  $69 = ((($68)) + 4|0);
  $70 = HEAP32[$69>>2]|0;
  $71 = ((($70)) + 12|0);
  HEAP32[$69>>2] = $71;
  $72 = HEAP32[$68>>2]|0;
  $73 = HEAP32[$72>>2]|0;
  $74 = $71;
  $75 = $73;
  $76 = (($74) - ($75))|0;
  $77 = (($76|0) / 12)&-1;
  $78 = ($77|0)==(341);
  if (!($78)) {
   continue;
  }
  $79 = HEAP32[$68>>2]|0;
  $80 = ((($79)) + 4|0);
  HEAP32[$68>>2] = $80;
  $81 = HEAP32[$68>>2]|0;
  $82 = HEAP32[$81>>2]|0;
  $83 = ((($68)) + 4|0);
  HEAP32[$83>>2] = $82;
 }
 $13 = $43;
 $84 = $13;
 $85 = ((($84)) + 20|0);
 $12 = $85;
 $86 = $12;
 $11 = $86;
 $87 = $11;
 HEAP32[$87>>2] = 0;
 while(1) {
  $14 = $43;
  $88 = $14;
  $89 = ((($88)) + 8|0);
  $90 = HEAP32[$89>>2]|0;
  $91 = ((($88)) + 4|0);
  $92 = HEAP32[$91>>2]|0;
  $93 = $90;
  $94 = $92;
  $95 = (($93) - ($94))|0;
  $96 = (($95|0) / 4)&-1;
  $97 = ($96>>>0)>(2);
  if (!($97)) {
   break;
  }
  $98 = $40;
  $15 = $43;
  $99 = $15;
  $100 = ((($99)) + 4|0);
  $101 = HEAP32[$100>>2]|0;
  $102 = HEAP32[$101>>2]|0;
  $21 = $98;
  $22 = $102;
  $23 = 341;
  $103 = $21;
  $104 = $22;
  $105 = $23;
  $18 = $103;
  $19 = $104;
  $20 = $105;
  $106 = $19;
  $17 = $106;
  $107 = $17;
  __ZdlPv($107);
  $30 = $43;
  $108 = $30;
  $109 = ((($108)) + 4|0);
  $110 = HEAP32[$109>>2]|0;
  $111 = ((($110)) + 4|0);
  $27 = $108;
  $28 = $111;
  $112 = $27;
  $113 = $28;
  ;HEAP8[$26>>0]=HEAP8[$29>>0]|0;
  $24 = $112;
  $25 = $113;
  $114 = $24;
  $115 = $25;
  $116 = ((($114)) + 4|0);
  HEAP32[$116>>2] = $115;
 }
 $31 = $43;
 $117 = $31;
 $118 = ((($117)) + 8|0);
 $119 = HEAP32[$118>>2]|0;
 $120 = ((($117)) + 4|0);
 $121 = HEAP32[$120>>2]|0;
 $122 = $119;
 $123 = $121;
 $124 = (($122) - ($123))|0;
 $125 = (($124|0) / 4)&-1;
 switch ($125|0) {
 case 1:  {
  $$sink = 170;
  break;
 }
 case 2:  {
  $$sink = 341;
  break;
 }
 default: {
  STACKTOP = sp;return;
 }
 }
 $126 = ((($43)) + 16|0);
 HEAP32[$126>>2] = $$sink;
 STACKTOP = sp;return;
}
function __ZNSt3__214__split_bufferIP7MessageNS_9allocatorIS2_EEED2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0;
 var $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0;
 var $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0;
 var $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $9 = 0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 144|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(144|0);
 $19 = sp + 8|0;
 $22 = sp + 133|0;
 $29 = sp;
 $32 = sp + 132|0;
 $34 = $0;
 $35 = $34;
 $33 = $35;
 $36 = $33;
 $37 = ((($36)) + 4|0);
 $38 = HEAP32[$37>>2]|0;
 $30 = $36;
 $31 = $38;
 $39 = $30;
 $40 = $31;
 ;HEAP8[$29>>0]=HEAP8[$32>>0]|0;
 $27 = $39;
 $28 = $40;
 $41 = $27;
 while(1) {
  $42 = $28;
  $43 = ((($41)) + 8|0);
  $44 = HEAP32[$43>>2]|0;
  $45 = ($42|0)!=($44|0);
  if (!($45)) {
   break;
  }
  $26 = $41;
  $46 = $26;
  $47 = ((($46)) + 12|0);
  $25 = $47;
  $48 = $25;
  $24 = $48;
  $49 = $24;
  $50 = ((($41)) + 8|0);
  $51 = HEAP32[$50>>2]|0;
  $52 = ((($51)) + -4|0);
  HEAP32[$50>>2] = $52;
  $23 = $52;
  $53 = $23;
  $20 = $49;
  $21 = $53;
  $54 = $20;
  $55 = $21;
  ;HEAP8[$19>>0]=HEAP8[$22>>0]|0;
  $17 = $54;
  $18 = $55;
  $56 = $17;
  $57 = $18;
  $15 = $56;
  $16 = $57;
 }
 $58 = HEAP32[$35>>2]|0;
 $59 = ($58|0)!=(0|0);
 if (!($59)) {
  STACKTOP = sp;return;
 }
 $14 = $35;
 $60 = $14;
 $61 = ((($60)) + 12|0);
 $13 = $61;
 $62 = $13;
 $12 = $62;
 $63 = $12;
 $64 = HEAP32[$35>>2]|0;
 $4 = $35;
 $65 = $4;
 $3 = $65;
 $66 = $3;
 $67 = ((($66)) + 12|0);
 $2 = $67;
 $68 = $2;
 $1 = $68;
 $69 = $1;
 $70 = HEAP32[$69>>2]|0;
 $71 = HEAP32[$65>>2]|0;
 $72 = $70;
 $73 = $71;
 $74 = (($72) - ($73))|0;
 $75 = (($74|0) / 4)&-1;
 $9 = $63;
 $10 = $64;
 $11 = $75;
 $76 = $9;
 $77 = $10;
 $78 = $11;
 $6 = $76;
 $7 = $77;
 $8 = $78;
 $79 = $7;
 $5 = $79;
 $80 = $5;
 __ZdlPv($80);
 STACKTOP = sp;return;
}
function ___clang_call_terminate($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 (___cxa_begin_catch(($0|0))|0);
 __ZSt9terminatev();
 // unreachable;
}
function __ZNSt3__212__deque_baseI7MessageNS_9allocatorIS1_EEE5beginEv($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 32|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(32|0);
 $7 = $1;
 $9 = $7;
 $6 = $9;
 $10 = $6;
 $11 = ((($10)) + 4|0);
 $12 = HEAP32[$11>>2]|0;
 $13 = ((($9)) + 16|0);
 $14 = HEAP32[$13>>2]|0;
 $15 = (($14>>>0) / 341)&-1;
 $16 = (($12) + ($15<<2)|0);
 $8 = $16;
 $17 = $8;
 $5 = $9;
 $18 = $5;
 $19 = ((($18)) + 8|0);
 $20 = HEAP32[$19>>2]|0;
 $21 = ((($18)) + 4|0);
 $22 = HEAP32[$21>>2]|0;
 $23 = ($20|0)==($22|0);
 if ($23) {
  $30 = 0;
 } else {
  $24 = $8;
  $25 = HEAP32[$24>>2]|0;
  $26 = ((($9)) + 16|0);
  $27 = HEAP32[$26>>2]|0;
  $28 = (($27>>>0) % 341)&-1;
  $29 = (($25) + (($28*12)|0)|0);
  $30 = $29;
 }
 $2 = $0;
 $3 = $17;
 $4 = $30;
 $31 = $2;
 $32 = $3;
 HEAP32[$31>>2] = $32;
 $33 = ((($31)) + 4|0);
 $34 = $4;
 HEAP32[$33>>2] = $34;
 STACKTOP = sp;return;
}
function __ZNSt3__212__deque_baseI7MessageNS_9allocatorIS1_EEE3endEv($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $5 = 0, $6 = 0;
 var $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(48|0);
 $10 = $1;
 $13 = $10;
 $9 = $13;
 $14 = $9;
 $15 = ((($14)) + 20|0);
 $8 = $15;
 $16 = $8;
 $7 = $16;
 $17 = $7;
 $18 = HEAP32[$17>>2]|0;
 $19 = ((($13)) + 16|0);
 $20 = HEAP32[$19>>2]|0;
 $21 = (($18) + ($20))|0;
 $11 = $21;
 $6 = $13;
 $22 = $6;
 $23 = ((($22)) + 4|0);
 $24 = HEAP32[$23>>2]|0;
 $25 = $11;
 $26 = (($25>>>0) / 341)&-1;
 $27 = (($24) + ($26<<2)|0);
 $12 = $27;
 $28 = $12;
 $2 = $13;
 $29 = $2;
 $30 = ((($29)) + 8|0);
 $31 = HEAP32[$30>>2]|0;
 $32 = ((($29)) + 4|0);
 $33 = HEAP32[$32>>2]|0;
 $34 = ($31|0)==($33|0);
 if ($34) {
  $40 = 0;
  $3 = $0;
  $4 = $28;
  $5 = $40;
  $41 = $3;
  $42 = $4;
  HEAP32[$41>>2] = $42;
  $43 = ((($41)) + 4|0);
  $44 = $5;
  HEAP32[$43>>2] = $44;
  STACKTOP = sp;return;
 }
 $35 = $12;
 $36 = HEAP32[$35>>2]|0;
 $37 = $11;
 $38 = (($37>>>0) % 341)&-1;
 $39 = (($36) + (($38*12)|0)|0);
 $40 = $39;
 $3 = $0;
 $4 = $28;
 $5 = $40;
 $41 = $3;
 $42 = $4;
 HEAP32[$41>>2] = $42;
 $43 = ((($41)) + 4|0);
 $44 = $5;
 HEAP32[$43>>2] = $44;
 STACKTOP = sp;return;
}
function __ZNSt3__211char_traitsIcE6lengthEPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = $1;
 $3 = (_strlen($2)|0);
 STACKTOP = sp;return ($3|0);
}
function __ZNSt3__211char_traitsIcE4copyEPcPKcj($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $3 = $0;
 $4 = $1;
 $5 = $2;
 $6 = $5;
 $7 = ($6|0)==(0);
 $8 = $3;
 if ($7) {
  STACKTOP = sp;return ($8|0);
 }
 $9 = $4;
 $10 = $5;
 _memcpy(($8|0),($9|0),($10|0))|0;
 STACKTOP = sp;return ($8|0);
}
function __ZNSt3__211char_traitsIcE6assignERcRKc($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $2 = $0;
 $3 = $1;
 $4 = $3;
 $5 = HEAP8[$4>>0]|0;
 $6 = $2;
 HEAP8[$6>>0] = $5;
 STACKTOP = sp;return;
}
function __ZNSt3__25dequeI7MessageNS_9allocatorIS1_EEE19__add_back_capacityEv($0) {
 $0 = $0|0;
 var $$byval_copy = 0, $$byval_copy3 = 0, $$byval_copy4 = 0, $$byval_copy5 = 0, $$sink1 = 0, $$sink2 = 0, $1 = 0, $10 = 0, $100 = 0, $1000 = 0, $1001 = 0, $1002 = 0, $1003 = 0, $1004 = 0, $1005 = 0, $1006 = 0, $1007 = 0, $1008 = 0, $1009 = 0, $101 = 0;
 var $1010 = 0, $1011 = 0, $1012 = 0, $1013 = 0, $1014 = 0, $1015 = 0, $1016 = 0, $1017 = 0, $1018 = 0, $1019 = 0, $102 = 0, $1020 = 0, $1021 = 0, $1022 = 0, $1023 = 0, $1024 = 0, $1025 = 0, $1026 = 0, $1027 = 0, $1028 = 0;
 var $1029 = 0, $103 = 0, $1030 = 0, $1031 = 0, $1032 = 0, $1033 = 0, $1034 = 0, $1035 = 0, $1036 = 0, $1037 = 0, $1038 = 0, $1039 = 0, $104 = 0, $1040 = 0, $1041 = 0, $1042 = 0, $1043 = 0, $1044 = 0, $1045 = 0, $1046 = 0;
 var $1047 = 0, $1048 = 0, $1049 = 0, $105 = 0, $1050 = 0, $1051 = 0, $1052 = 0, $1053 = 0, $1054 = 0, $1055 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0;
 var $115 = 0, $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0;
 var $133 = 0, $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0;
 var $151 = 0, $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0;
 var $17 = 0, $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0;
 var $188 = 0, $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0;
 var $205 = 0, $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0;
 var $223 = 0, $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0;
 var $241 = 0, $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0;
 var $26 = 0, $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0;
 var $278 = 0, $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0;
 var $296 = 0, $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0;
 var $313 = 0, $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0;
 var $331 = 0, $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0;
 var $35 = 0, $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0, $366 = 0, $367 = 0;
 var $368 = 0, $369 = 0, $37 = 0, $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0, $376 = 0, $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0, $381 = 0, $382 = 0, $383 = 0, $384 = 0, $385 = 0;
 var $386 = 0, $387 = 0, $388 = 0, $389 = 0, $39 = 0, $390 = 0, $391 = 0, $392 = 0, $393 = 0, $394 = 0, $395 = 0, $396 = 0, $397 = 0, $398 = 0, $399 = 0, $4 = 0, $40 = 0, $400 = 0, $401 = 0, $402 = 0;
 var $403 = 0, $404 = 0, $405 = 0, $406 = 0, $407 = 0, $408 = 0, $409 = 0, $41 = 0, $410 = 0, $411 = 0, $412 = 0, $413 = 0, $414 = 0, $415 = 0, $416 = 0, $417 = 0, $418 = 0, $419 = 0, $42 = 0, $420 = 0;
 var $421 = 0, $422 = 0, $423 = 0, $424 = 0, $425 = 0, $426 = 0, $427 = 0, $428 = 0, $429 = 0, $43 = 0, $430 = 0, $431 = 0, $432 = 0, $433 = 0, $434 = 0, $435 = 0, $436 = 0, $437 = 0, $438 = 0, $439 = 0;
 var $44 = 0, $440 = 0, $441 = 0, $442 = 0, $443 = 0, $444 = 0, $445 = 0, $446 = 0, $447 = 0, $448 = 0, $449 = 0, $45 = 0, $450 = 0, $451 = 0, $452 = 0, $453 = 0, $454 = 0, $455 = 0, $456 = 0, $457 = 0;
 var $458 = 0, $459 = 0, $46 = 0, $460 = 0, $461 = 0, $462 = 0, $463 = 0, $464 = 0, $465 = 0, $466 = 0, $467 = 0, $468 = 0, $469 = 0, $47 = 0, $470 = 0, $471 = 0, $472 = 0, $473 = 0, $474 = 0, $475 = 0;
 var $476 = 0, $477 = 0, $478 = 0, $479 = 0, $48 = 0, $480 = 0, $481 = 0, $482 = 0, $483 = 0, $484 = 0, $485 = 0, $486 = 0, $487 = 0, $488 = 0, $489 = 0, $49 = 0, $490 = 0, $491 = 0, $492 = 0, $493 = 0;
 var $494 = 0, $495 = 0, $496 = 0, $497 = 0, $498 = 0, $499 = 0, $5 = 0, $50 = 0, $500 = 0, $501 = 0, $502 = 0, $503 = 0, $504 = 0, $505 = 0, $506 = 0, $507 = 0, $508 = 0, $509 = 0, $51 = 0, $510 = 0;
 var $511 = 0, $512 = 0, $513 = 0, $514 = 0, $515 = 0, $516 = 0, $517 = 0, $518 = 0, $519 = 0, $52 = 0, $520 = 0, $521 = 0, $522 = 0, $523 = 0, $524 = 0, $525 = 0, $526 = 0, $527 = 0, $528 = 0, $529 = 0;
 var $53 = 0, $530 = 0, $531 = 0, $532 = 0, $533 = 0, $534 = 0, $535 = 0, $536 = 0, $537 = 0, $538 = 0, $539 = 0, $54 = 0, $540 = 0, $541 = 0, $542 = 0, $543 = 0, $544 = 0, $545 = 0, $546 = 0, $547 = 0;
 var $548 = 0, $549 = 0, $55 = 0, $550 = 0, $551 = 0, $552 = 0, $553 = 0, $554 = 0, $555 = 0, $556 = 0, $557 = 0, $558 = 0, $559 = 0, $56 = 0, $560 = 0, $561 = 0, $562 = 0, $563 = 0, $564 = 0, $565 = 0;
 var $566 = 0, $567 = 0, $568 = 0, $569 = 0, $57 = 0, $570 = 0, $571 = 0, $572 = 0, $573 = 0, $574 = 0, $575 = 0, $576 = 0, $577 = 0, $578 = 0, $579 = 0, $58 = 0, $580 = 0, $581 = 0, $582 = 0, $583 = 0;
 var $584 = 0, $585 = 0, $586 = 0, $587 = 0, $588 = 0, $589 = 0, $59 = 0, $590 = 0, $591 = 0, $592 = 0, $593 = 0, $594 = 0, $595 = 0, $596 = 0, $597 = 0, $598 = 0, $599 = 0, $6 = 0, $60 = 0, $600 = 0;
 var $601 = 0, $602 = 0, $603 = 0, $604 = 0, $605 = 0, $606 = 0, $607 = 0, $608 = 0, $609 = 0, $61 = 0, $610 = 0, $611 = 0, $612 = 0, $613 = 0, $614 = 0, $615 = 0, $616 = 0, $617 = 0, $618 = 0, $619 = 0;
 var $62 = 0, $620 = 0, $621 = 0, $622 = 0, $623 = 0, $624 = 0, $625 = 0, $626 = 0, $627 = 0, $628 = 0, $629 = 0, $63 = 0, $630 = 0, $631 = 0, $632 = 0, $633 = 0, $634 = 0, $635 = 0, $636 = 0, $637 = 0;
 var $638 = 0, $639 = 0, $64 = 0, $640 = 0, $641 = 0, $642 = 0, $643 = 0, $644 = 0, $645 = 0, $646 = 0, $647 = 0, $648 = 0, $649 = 0, $65 = 0, $650 = 0, $651 = 0, $652 = 0, $653 = 0, $654 = 0, $655 = 0;
 var $656 = 0, $657 = 0, $658 = 0, $659 = 0, $66 = 0, $660 = 0, $661 = 0, $662 = 0, $663 = 0, $664 = 0, $665 = 0, $666 = 0, $667 = 0, $668 = 0, $669 = 0, $67 = 0, $670 = 0, $671 = 0, $672 = 0, $673 = 0;
 var $674 = 0, $675 = 0, $676 = 0, $677 = 0, $678 = 0, $679 = 0, $68 = 0, $680 = 0, $681 = 0, $682 = 0, $683 = 0, $684 = 0, $685 = 0, $686 = 0, $687 = 0, $688 = 0, $689 = 0, $69 = 0, $690 = 0, $691 = 0;
 var $692 = 0, $693 = 0, $694 = 0, $695 = 0, $696 = 0, $697 = 0, $698 = 0, $699 = 0, $7 = 0, $70 = 0, $700 = 0, $701 = 0, $702 = 0, $703 = 0, $704 = 0, $705 = 0, $706 = 0, $707 = 0, $708 = 0, $709 = 0;
 var $71 = 0, $710 = 0, $711 = 0, $712 = 0, $713 = 0, $714 = 0, $715 = 0, $716 = 0, $717 = 0, $718 = 0, $719 = 0, $72 = 0, $720 = 0, $721 = 0, $722 = 0, $723 = 0, $724 = 0, $725 = 0, $726 = 0, $727 = 0;
 var $728 = 0, $729 = 0, $73 = 0, $730 = 0, $731 = 0, $732 = 0, $733 = 0, $734 = 0, $735 = 0, $736 = 0, $737 = 0, $738 = 0, $739 = 0, $74 = 0, $740 = 0, $741 = 0, $742 = 0, $743 = 0, $744 = 0, $745 = 0;
 var $746 = 0, $747 = 0, $748 = 0, $749 = 0, $75 = 0, $750 = 0, $751 = 0, $752 = 0, $753 = 0, $754 = 0, $755 = 0, $756 = 0, $757 = 0, $758 = 0, $759 = 0, $76 = 0, $760 = 0, $761 = 0, $762 = 0, $763 = 0;
 var $764 = 0, $765 = 0, $766 = 0, $767 = 0, $768 = 0, $769 = 0, $77 = 0, $770 = 0, $771 = 0, $772 = 0, $773 = 0, $774 = 0, $775 = 0, $776 = 0, $777 = 0, $778 = 0, $779 = 0, $78 = 0, $780 = 0, $781 = 0;
 var $782 = 0, $783 = 0, $784 = 0, $785 = 0, $786 = 0, $787 = 0, $788 = 0, $789 = 0, $79 = 0, $790 = 0, $791 = 0, $792 = 0, $793 = 0, $794 = 0, $795 = 0, $796 = 0, $797 = 0, $798 = 0, $799 = 0, $8 = 0;
 var $80 = 0, $800 = 0, $801 = 0, $802 = 0, $803 = 0, $804 = 0, $805 = 0, $806 = 0, $807 = 0, $808 = 0, $809 = 0, $81 = 0, $810 = 0, $811 = 0, $812 = 0, $813 = 0, $814 = 0, $815 = 0, $816 = 0, $817 = 0;
 var $818 = 0, $819 = 0, $82 = 0, $820 = 0, $821 = 0, $822 = 0, $823 = 0, $824 = 0, $825 = 0, $826 = 0, $827 = 0, $828 = 0, $829 = 0, $83 = 0, $830 = 0, $831 = 0, $832 = 0, $833 = 0, $834 = 0, $835 = 0;
 var $836 = 0, $837 = 0, $838 = 0, $839 = 0, $84 = 0, $840 = 0, $841 = 0, $842 = 0, $843 = 0, $844 = 0, $845 = 0, $846 = 0, $847 = 0, $848 = 0, $849 = 0, $85 = 0, $850 = 0, $851 = 0, $852 = 0, $853 = 0;
 var $854 = 0, $855 = 0, $856 = 0, $857 = 0, $858 = 0, $859 = 0, $86 = 0, $860 = 0, $861 = 0, $862 = 0, $863 = 0, $864 = 0, $865 = 0, $866 = 0, $867 = 0, $868 = 0, $869 = 0, $87 = 0, $870 = 0, $871 = 0;
 var $872 = 0, $873 = 0, $874 = 0, $875 = 0, $876 = 0, $877 = 0, $878 = 0, $879 = 0, $88 = 0, $880 = 0, $881 = 0, $882 = 0, $883 = 0, $884 = 0, $885 = 0, $886 = 0, $887 = 0, $888 = 0, $889 = 0, $89 = 0;
 var $890 = 0, $891 = 0, $892 = 0, $893 = 0, $894 = 0, $895 = 0, $896 = 0, $897 = 0, $898 = 0, $899 = 0, $9 = 0, $90 = 0, $900 = 0, $901 = 0, $902 = 0, $903 = 0, $904 = 0, $905 = 0, $906 = 0, $907 = 0;
 var $908 = 0, $909 = 0, $91 = 0, $910 = 0, $911 = 0, $912 = 0, $913 = 0, $914 = 0, $915 = 0, $916 = 0, $917 = 0, $918 = 0, $919 = 0, $92 = 0, $920 = 0, $921 = 0, $922 = 0, $923 = 0, $924 = 0, $925 = 0;
 var $926 = 0, $927 = 0, $928 = 0, $929 = 0, $93 = 0, $930 = 0, $931 = 0, $932 = 0, $933 = 0, $934 = 0, $935 = 0, $936 = 0, $937 = 0, $938 = 0, $939 = 0, $94 = 0, $940 = 0, $941 = 0, $942 = 0, $943 = 0;
 var $944 = 0, $945 = 0, $946 = 0, $947 = 0, $948 = 0, $949 = 0, $95 = 0, $950 = 0, $951 = 0, $952 = 0, $953 = 0, $954 = 0, $955 = 0, $956 = 0, $957 = 0, $958 = 0, $959 = 0, $96 = 0, $960 = 0, $961 = 0;
 var $962 = 0, $963 = 0, $964 = 0, $965 = 0, $966 = 0, $967 = 0, $968 = 0, $969 = 0, $97 = 0, $970 = 0, $971 = 0, $972 = 0, $973 = 0, $974 = 0, $975 = 0, $976 = 0, $977 = 0, $978 = 0, $979 = 0, $98 = 0;
 var $980 = 0, $981 = 0, $982 = 0, $983 = 0, $984 = 0, $985 = 0, $986 = 0, $987 = 0, $988 = 0, $989 = 0, $99 = 0, $990 = 0, $991 = 0, $992 = 0, $993 = 0, $994 = 0, $995 = 0, $996 = 0, $997 = 0, $998 = 0;
 var $999 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 1616|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(1616|0);
 $$byval_copy5 = sp + 1600|0;
 $$byval_copy4 = sp + 1596|0;
 $$byval_copy3 = sp + 1592|0;
 $$byval_copy = sp + 1588|0;
 $16 = sp + 1524|0;
 $17 = sp + 64|0;
 $20 = sp + 1512|0;
 $21 = sp + 1504|0;
 $22 = sp + 56|0;
 $27 = sp + 1480|0;
 $52 = sp + 48|0;
 $55 = sp + 1610|0;
 $72 = sp + 40|0;
 $75 = sp + 1609|0;
 $81 = sp + 1276|0;
 $87 = sp + 1252|0;
 $93 = sp + 1228|0;
 $105 = sp + 1180|0;
 $131 = sp + 32|0;
 $136 = sp + 1608|0;
 $144 = sp + 1032|0;
 $145 = sp + 1028|0;
 $146 = sp + 1008|0;
 $147 = sp + 1004|0;
 $150 = sp + 992|0;
 $153 = sp + 24|0;
 $156 = sp + 1607|0;
 $204 = sp + 16|0;
 $207 = sp + 1606|0;
 $213 = sp + 756|0;
 $219 = sp + 732|0;
 $225 = sp + 708|0;
 $237 = sp + 660|0;
 $263 = sp + 8|0;
 $268 = sp + 1605|0;
 $276 = sp + 512|0;
 $277 = sp + 508|0;
 $278 = sp + 488|0;
 $279 = sp + 484|0;
 $282 = sp + 472|0;
 $307 = sp + 372|0;
 $313 = sp + 348|0;
 $319 = sp + 324|0;
 $331 = sp + 276|0;
 $334 = sp;
 $337 = sp + 1604|0;
 $365 = sp + 148|0;
 $366 = sp + 144|0;
 $367 = sp + 140|0;
 $368 = sp + 136|0;
 $369 = sp + 116|0;
 $370 = sp + 112|0;
 $371 = sp + 108|0;
 $372 = sp + 96|0;
 $375 = sp + 80|0;
 $376 = sp + 76|0;
 $363 = $0;
 $378 = $363;
 $362 = $378;
 $379 = $362;
 $380 = ((($379)) + 20|0);
 $361 = $380;
 $381 = $361;
 $360 = $381;
 $382 = $360;
 $364 = $382;
 $359 = $378;
 $383 = $359;
 $384 = ((($383)) + 16|0);
 $385 = HEAP32[$384>>2]|0;
 $386 = ($385>>>0)>=(341);
 if ($386) {
  $387 = ((($378)) + 16|0);
  $388 = HEAP32[$387>>2]|0;
  $389 = (($388) - 341)|0;
  HEAP32[$387>>2] = $389;
  $358 = $378;
  $390 = $358;
  $391 = ((($390)) + 4|0);
  $392 = HEAP32[$391>>2]|0;
  $393 = HEAP32[$392>>2]|0;
  HEAP32[$365>>2] = $393;
  $338 = $378;
  $394 = $338;
  $395 = ((($394)) + 4|0);
  $396 = HEAP32[$395>>2]|0;
  $397 = ((($396)) + 4|0);
  $335 = $394;
  $336 = $397;
  $398 = $335;
  $399 = $336;
  ;HEAP8[$334>>0]=HEAP8[$337>>0]|0;
  $332 = $398;
  $333 = $399;
  $400 = $332;
  $401 = $333;
  $402 = ((($400)) + 4|0);
  HEAP32[$402>>2] = $401;
  $272 = $378;
  $273 = $365;
  $403 = $272;
  $404 = ((($403)) + 8|0);
  $405 = HEAP32[$404>>2]|0;
  $271 = $403;
  $406 = $271;
  $407 = ((($406)) + 12|0);
  $270 = $407;
  $408 = $270;
  $269 = $408;
  $409 = $269;
  $410 = HEAP32[$409>>2]|0;
  $411 = ($405|0)==($410|0);
  do {
   if ($411) {
    $412 = ((($403)) + 4|0);
    $413 = HEAP32[$412>>2]|0;
    $414 = HEAP32[$403>>2]|0;
    $415 = ($413>>>0)>($414>>>0);
    if ($415) {
     $416 = ((($403)) + 4|0);
     $417 = HEAP32[$416>>2]|0;
     $418 = HEAP32[$403>>2]|0;
     $419 = $417;
     $420 = $418;
     $421 = (($419) - ($420))|0;
     $422 = (($421|0) / 4)&-1;
     $274 = $422;
     $423 = $274;
     $424 = (($423) + 1)|0;
     $425 = (($424|0) / 2)&-1;
     $274 = $425;
     $426 = ((($403)) + 4|0);
     $427 = HEAP32[$426>>2]|0;
     $428 = ((($403)) + 8|0);
     $429 = HEAP32[$428>>2]|0;
     $430 = ((($403)) + 4|0);
     $431 = HEAP32[$430>>2]|0;
     $432 = $274;
     $433 = (0 - ($432))|0;
     $434 = (($431) + ($433<<2)|0);
     $248 = $427;
     $249 = $429;
     $250 = $434;
     $435 = $248;
     $247 = $435;
     $436 = $247;
     $437 = $249;
     $241 = $437;
     $438 = $241;
     $439 = $250;
     $242 = $439;
     $440 = $242;
     $243 = $436;
     $244 = $438;
     $245 = $440;
     $441 = $244;
     $442 = $243;
     $443 = $441;
     $444 = $442;
     $445 = (($443) - ($444))|0;
     $446 = (($445|0) / 4)&-1;
     $246 = $446;
     $447 = $246;
     $448 = ($447>>>0)>(0);
     if ($448) {
      $449 = $245;
      $450 = $243;
      $451 = $246;
      $452 = $451<<2;
      _memmove(($449|0),($450|0),($452|0))|0;
     }
     $453 = $245;
     $454 = $246;
     $455 = (($453) + ($454<<2)|0);
     $456 = ((($403)) + 8|0);
     HEAP32[$456>>2] = $455;
     $457 = $274;
     $458 = ((($403)) + 4|0);
     $459 = HEAP32[$458>>2]|0;
     $460 = (0 - ($457))|0;
     $461 = (($459) + ($460<<2)|0);
     HEAP32[$458>>2] = $461;
     break;
    } else {
     $240 = $403;
     $462 = $240;
     $463 = ((($462)) + 12|0);
     $239 = $463;
     $464 = $239;
     $238 = $464;
     $465 = $238;
     $466 = HEAP32[$465>>2]|0;
     $467 = HEAP32[$403>>2]|0;
     $468 = $466;
     $469 = $467;
     $470 = (($468) - ($469))|0;
     $471 = (($470|0) / 4)&-1;
     $472 = $471<<1;
     HEAP32[$276>>2] = $472;
     HEAP32[$277>>2] = 1;
     $205 = $276;
     $206 = $277;
     $473 = $205;
     $474 = $206;
     ;HEAP8[$204>>0]=HEAP8[$207>>0]|0;
     $202 = $473;
     $203 = $474;
     $475 = $202;
     $476 = $203;
     $199 = $204;
     $200 = $475;
     $201 = $476;
     $477 = $200;
     $478 = HEAP32[$477>>2]|0;
     $479 = $201;
     $480 = HEAP32[$479>>2]|0;
     $481 = ($478>>>0)<($480>>>0);
     $482 = $203;
     $483 = $202;
     $484 = $481 ? $482 : $483;
     $485 = HEAP32[$484>>2]|0;
     $275 = $485;
     $486 = $275;
     $487 = $275;
     $488 = (($487>>>0) / 4)&-1;
     $194 = $403;
     $489 = $194;
     $490 = ((($489)) + 12|0);
     $193 = $490;
     $491 = $193;
     $192 = $491;
     $492 = $192;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEEC2EjjS5_($278,$486,$488,$492);
     $493 = ((($403)) + 4|0);
     $494 = HEAP32[$493>>2]|0;
     $195 = $279;
     $196 = $494;
     $495 = $195;
     $496 = $196;
     HEAP32[$495>>2] = $496;
     $497 = ((($403)) + 8|0);
     $498 = HEAP32[$497>>2]|0;
     $197 = $282;
     $198 = $498;
     $499 = $197;
     $500 = $198;
     HEAP32[$499>>2] = $500;
     __THREW__ = 0;
     ;HEAP32[$$byval_copy>>2]=HEAP32[$279>>2]|0;
     ;HEAP32[$$byval_copy3>>2]=HEAP32[$282>>2]|0;
     invoke_viii(65,($278|0),($$byval_copy|0),($$byval_copy3|0));
     $501 = __THREW__; __THREW__ = 0;
     $502 = $501&1;
     if ($502) {
      $555 = ___cxa_find_matching_catch_2()|0;
      $556 = tempRet0;
      $280 = $555;
      $281 = $556;
      __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($278);
      $557 = $280;
      $558 = $281;
      ___resumeException($557|0);
      // unreachable;
     } else {
      $211 = $403;
      $212 = $278;
      $503 = $211;
      $210 = $503;
      $504 = $210;
      $505 = HEAP32[$504>>2]|0;
      HEAP32[$213>>2] = $505;
      $506 = $212;
      $208 = $506;
      $507 = $208;
      $508 = HEAP32[$507>>2]|0;
      $509 = $211;
      HEAP32[$509>>2] = $508;
      $209 = $213;
      $510 = $209;
      $511 = HEAP32[$510>>2]|0;
      $512 = $212;
      HEAP32[$512>>2] = $511;
      $513 = ((($403)) + 4|0);
      $514 = ((($278)) + 4|0);
      $217 = $513;
      $218 = $514;
      $515 = $217;
      $216 = $515;
      $516 = $216;
      $517 = HEAP32[$516>>2]|0;
      HEAP32[$219>>2] = $517;
      $518 = $218;
      $214 = $518;
      $519 = $214;
      $520 = HEAP32[$519>>2]|0;
      $521 = $217;
      HEAP32[$521>>2] = $520;
      $215 = $219;
      $522 = $215;
      $523 = HEAP32[$522>>2]|0;
      $524 = $218;
      HEAP32[$524>>2] = $523;
      $525 = ((($403)) + 8|0);
      $526 = ((($278)) + 8|0);
      $223 = $525;
      $224 = $526;
      $527 = $223;
      $222 = $527;
      $528 = $222;
      $529 = HEAP32[$528>>2]|0;
      HEAP32[$225>>2] = $529;
      $530 = $224;
      $220 = $530;
      $531 = $220;
      $532 = HEAP32[$531>>2]|0;
      $533 = $223;
      HEAP32[$533>>2] = $532;
      $221 = $225;
      $534 = $221;
      $535 = HEAP32[$534>>2]|0;
      $536 = $224;
      HEAP32[$536>>2] = $535;
      $228 = $403;
      $537 = $228;
      $538 = ((($537)) + 12|0);
      $227 = $538;
      $539 = $227;
      $226 = $539;
      $540 = $226;
      $231 = $278;
      $541 = $231;
      $542 = ((($541)) + 12|0);
      $230 = $542;
      $543 = $230;
      $229 = $543;
      $544 = $229;
      $235 = $540;
      $236 = $544;
      $545 = $235;
      $234 = $545;
      $546 = $234;
      $547 = HEAP32[$546>>2]|0;
      HEAP32[$237>>2] = $547;
      $548 = $236;
      $232 = $548;
      $549 = $232;
      $550 = HEAP32[$549>>2]|0;
      $551 = $235;
      HEAP32[$551>>2] = $550;
      $233 = $237;
      $552 = $233;
      $553 = HEAP32[$552>>2]|0;
      $554 = $236;
      HEAP32[$554>>2] = $553;
      __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($278);
      break;
     }
    }
   }
  } while(0);
  $253 = $403;
  $559 = $253;
  $560 = ((($559)) + 12|0);
  $252 = $560;
  $561 = $252;
  $251 = $561;
  $562 = $251;
  $563 = ((($403)) + 8|0);
  $564 = HEAP32[$563>>2]|0;
  $254 = $564;
  $565 = $254;
  $566 = $273;
  $265 = $562;
  $266 = $565;
  $267 = $566;
  $567 = $265;
  $568 = $266;
  $569 = $267;
  $264 = $569;
  $570 = $264;
  ;HEAP8[$263>>0]=HEAP8[$268>>0]|0;
  $260 = $567;
  $261 = $568;
  $262 = $570;
  $571 = $260;
  $572 = $261;
  $573 = $262;
  $259 = $573;
  $574 = $259;
  $256 = $571;
  $257 = $572;
  $258 = $574;
  $575 = $257;
  $576 = $258;
  $255 = $576;
  $577 = $255;
  $578 = HEAP32[$577>>2]|0;
  HEAP32[$575>>2] = $578;
  $579 = ((($403)) + 8|0);
  $580 = HEAP32[$579>>2]|0;
  $581 = ((($580)) + 4|0);
  HEAP32[$579>>2] = $581;
  STACKTOP = sp;return;
 }
 $191 = $378;
 $582 = $191;
 $583 = ((($582)) + 8|0);
 $584 = HEAP32[$583>>2]|0;
 $585 = ((($582)) + 4|0);
 $586 = HEAP32[$585>>2]|0;
 $587 = $584;
 $588 = $586;
 $589 = (($587) - ($588))|0;
 $590 = (($589|0) / 4)&-1;
 $190 = $378;
 $591 = $190;
 $189 = $591;
 $592 = $189;
 $593 = ((($592)) + 12|0);
 $188 = $593;
 $594 = $188;
 $187 = $594;
 $595 = $187;
 $596 = HEAP32[$595>>2]|0;
 $597 = HEAP32[$591>>2]|0;
 $598 = $596;
 $599 = $597;
 $600 = (($598) - ($599))|0;
 $601 = (($600|0) / 4)&-1;
 $602 = ($590>>>0)<($601>>>0);
 if (!($602)) {
  $59 = $378;
  $847 = $59;
  $58 = $847;
  $848 = $58;
  $849 = ((($848)) + 12|0);
  $57 = $849;
  $850 = $57;
  $56 = $850;
  $851 = $56;
  $852 = HEAP32[$851>>2]|0;
  $853 = HEAP32[$847>>2]|0;
  $854 = $852;
  $855 = $853;
  $856 = (($854) - ($855))|0;
  $857 = (($856|0) / 4)&-1;
  $858 = $857<<1;
  HEAP32[$370>>2] = $858;
  HEAP32[$371>>2] = 1;
  $53 = $370;
  $54 = $371;
  $859 = $53;
  $860 = $54;
  ;HEAP8[$52>>0]=HEAP8[$55>>0]|0;
  $50 = $859;
  $51 = $860;
  $861 = $50;
  $862 = $51;
  $47 = $52;
  $48 = $861;
  $49 = $862;
  $863 = $48;
  $864 = HEAP32[$863>>2]|0;
  $865 = $49;
  $866 = HEAP32[$865>>2]|0;
  $867 = ($864>>>0)<($866>>>0);
  $868 = $51;
  $869 = $50;
  $870 = $867 ? $868 : $869;
  $871 = HEAP32[$870>>2]|0;
  $46 = $378;
  $872 = $46;
  $873 = ((($872)) + 8|0);
  $874 = HEAP32[$873>>2]|0;
  $875 = ((($872)) + 4|0);
  $876 = HEAP32[$875>>2]|0;
  $877 = $874;
  $878 = $876;
  $879 = (($877) - ($878))|0;
  $880 = (($879|0) / 4)&-1;
  $45 = $378;
  $881 = $45;
  $882 = ((($881)) + 12|0);
  $44 = $882;
  $883 = $44;
  $43 = $883;
  $884 = $43;
  __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEEC2EjjS5_($369,$871,$880,$884);
  $885 = $364;
  $41 = $885;
  $42 = 341;
  $886 = $41;
  $887 = $42;
  $38 = $886;
  $39 = $887;
  $40 = 0;
  $888 = $38;
  $889 = $39;
  $37 = $888;
  $890 = ($889>>>0)>(357913941);
  do {
   if ($890) {
    $33 = 1363;
    $891 = (___cxa_allocate_exception(8)|0);
    $892 = $33;
    $31 = $891;
    $32 = $892;
    $893 = $31;
    $894 = $32;
    __THREW__ = 0;
    invoke_vii(66,($893|0),($894|0));
    $895 = __THREW__; __THREW__ = 0;
    $896 = $895&1;
    if ($896) {
     $898 = ___cxa_find_matching_catch_2()|0;
     $899 = tempRet0;
     $34 = $898;
     $35 = $899;
     ___cxa_free_exception(($891|0));
     $900 = $34;
     $901 = $35;
     $$sink1 = $901;$$sink2 = $900;
     break;
    } else {
     HEAP32[$893>>2] = (1216);
     __THREW__ = 0;
     invoke_viii(67,($891|0),(392|0),(36|0));
     $897 = __THREW__; __THREW__ = 0;
     label = 40;
     break;
    }
   } else {
    $902 = $39;
    $903 = ($902*12)|0;
    $36 = $903;
    $904 = $36;
    __THREW__ = 0;
    $905 = (invoke_ii(53,($904|0))|0);
    $906 = __THREW__; __THREW__ = 0;
    $907 = $906&1;
    if ($907) {
     label = 40;
    } else {
     $908 = $364;
     $28 = $375;
     $29 = $908;
     $30 = 341;
     $909 = $28;
     $910 = $29;
     HEAP32[$909>>2] = $910;
     $911 = ((($909)) + 4|0);
     $912 = $30;
     HEAP32[$911>>2] = $912;
     $24 = $372;
     $25 = $905;
     $26 = $375;
     $913 = $24;
     $914 = $25;
     $915 = $26;
     $23 = $915;
     $916 = $23;
     ;HEAP32[$27>>2]=HEAP32[$916>>2]|0;HEAP32[$27+4>>2]=HEAP32[$916+4>>2]|0;
     ;HEAP8[$22>>0]=HEAP8[$27>>0]|0;HEAP8[$22+1>>0]=HEAP8[$27+1>>0]|0;HEAP8[$22+2>>0]=HEAP8[$27+2>>0]|0;HEAP8[$22+3>>0]=HEAP8[$27+3>>0]|0;HEAP8[$22+4>>0]=HEAP8[$27+4>>0]|0;HEAP8[$22+5>>0]=HEAP8[$27+5>>0]|0;HEAP8[$22+6>>0]=HEAP8[$27+6>>0]|0;HEAP8[$22+7>>0]=HEAP8[$27+7>>0]|0;
     $19 = $913;
     HEAP32[$20>>2] = $914;
     $917 = $19;
     $18 = $20;
     $918 = $18;
     $919 = HEAP32[$918>>2]|0;
     $12 = $22;
     $920 = $12;
     ;HEAP32[$21>>2]=HEAP32[$920>>2]|0;HEAP32[$21+4>>2]=HEAP32[$920+4>>2]|0;
     ;HEAP8[$17>>0]=HEAP8[$21>>0]|0;HEAP8[$17+1>>0]=HEAP8[$21+1>>0]|0;HEAP8[$17+2>>0]=HEAP8[$21+2>>0]|0;HEAP8[$17+3>>0]=HEAP8[$21+3>>0]|0;HEAP8[$17+4>>0]=HEAP8[$21+4>>0]|0;HEAP8[$17+5>>0]=HEAP8[$21+5>>0]|0;HEAP8[$17+6>>0]=HEAP8[$21+6>>0]|0;HEAP8[$17+7>>0]=HEAP8[$21+7>>0]|0;
     $15 = $917;
     HEAP32[$16>>2] = $919;
     $921 = $15;
     $14 = $16;
     $922 = $14;
     $923 = HEAP32[$922>>2]|0;
     HEAP32[$921>>2] = $923;
     $924 = ((($921)) + 4|0);
     $13 = $17;
     $925 = $13;
     ;HEAP32[$924>>2]=HEAP32[$925>>2]|0;HEAP32[$924+4>>2]=HEAP32[$925+4>>2]|0;
     $11 = $372;
     $926 = $11;
     $10 = $926;
     $927 = $10;
     $9 = $927;
     $928 = $9;
     $929 = HEAP32[$928>>2]|0;
     HEAP32[$376>>2] = $929;
     __THREW__ = 0;
     invoke_vii(68,($369|0),($376|0));
     $930 = __THREW__; __THREW__ = 0;
     $931 = $930&1;
     L26: do {
      if (!($931)) {
       $7 = $372;
       $932 = $7;
       $6 = $932;
       $933 = $6;
       $5 = $933;
       $934 = $5;
       $935 = HEAP32[$934>>2]|0;
       $8 = $935;
       $4 = $932;
       $936 = $4;
       $3 = $936;
       $937 = $3;
       HEAP32[$937>>2] = 0;
       $2 = $378;
       $938 = $2;
       $939 = ((($938)) + 8|0);
       $940 = HEAP32[$939>>2]|0;
       $377 = $940;
       while(1) {
        $941 = $377;
        $1 = $378;
        $942 = $1;
        $943 = ((($942)) + 4|0);
        $944 = HEAP32[$943>>2]|0;
        $945 = ($941|0)!=($944|0);
        if (!($945)) {
         break;
        }
        $946 = $377;
        $947 = ((($946)) + -4|0);
        $377 = $947;
        __THREW__ = 0;
        invoke_vii(69,($369|0),($947|0));
        $948 = __THREW__; __THREW__ = 0;
        $949 = $948&1;
        if ($949) {
         break L26;
        }
       }
       $305 = $378;
       $306 = $369;
       $978 = $305;
       $304 = $978;
       $979 = $304;
       $980 = HEAP32[$979>>2]|0;
       HEAP32[$307>>2] = $980;
       $981 = $306;
       $302 = $981;
       $982 = $302;
       $983 = HEAP32[$982>>2]|0;
       $984 = $305;
       HEAP32[$984>>2] = $983;
       $303 = $307;
       $985 = $303;
       $986 = HEAP32[$985>>2]|0;
       $987 = $306;
       HEAP32[$987>>2] = $986;
       $988 = ((($378)) + 4|0);
       $989 = ((($369)) + 4|0);
       $311 = $988;
       $312 = $989;
       $990 = $311;
       $310 = $990;
       $991 = $310;
       $992 = HEAP32[$991>>2]|0;
       HEAP32[$313>>2] = $992;
       $993 = $312;
       $308 = $993;
       $994 = $308;
       $995 = HEAP32[$994>>2]|0;
       $996 = $311;
       HEAP32[$996>>2] = $995;
       $309 = $313;
       $997 = $309;
       $998 = HEAP32[$997>>2]|0;
       $999 = $312;
       HEAP32[$999>>2] = $998;
       $1000 = ((($378)) + 8|0);
       $1001 = ((($369)) + 8|0);
       $317 = $1000;
       $318 = $1001;
       $1002 = $317;
       $316 = $1002;
       $1003 = $316;
       $1004 = HEAP32[$1003>>2]|0;
       HEAP32[$319>>2] = $1004;
       $1005 = $318;
       $314 = $1005;
       $1006 = $314;
       $1007 = HEAP32[$1006>>2]|0;
       $1008 = $317;
       HEAP32[$1008>>2] = $1007;
       $315 = $319;
       $1009 = $315;
       $1010 = HEAP32[$1009>>2]|0;
       $1011 = $318;
       HEAP32[$1011>>2] = $1010;
       $322 = $378;
       $1012 = $322;
       $1013 = ((($1012)) + 12|0);
       $321 = $1013;
       $1014 = $321;
       $320 = $1014;
       $1015 = $320;
       $325 = $369;
       $1016 = $325;
       $1017 = ((($1016)) + 12|0);
       $324 = $1017;
       $1018 = $324;
       $323 = $1018;
       $1019 = $323;
       $329 = $1015;
       $330 = $1019;
       $1020 = $329;
       $328 = $1020;
       $1021 = $328;
       $1022 = HEAP32[$1021>>2]|0;
       HEAP32[$331>>2] = $1022;
       $1023 = $330;
       $326 = $1023;
       $1024 = $326;
       $1025 = HEAP32[$1024>>2]|0;
       $1026 = $329;
       HEAP32[$1026>>2] = $1025;
       $327 = $331;
       $1027 = $327;
       $1028 = HEAP32[$1027>>2]|0;
       $1029 = $330;
       HEAP32[$1029>>2] = $1028;
       $357 = $372;
       $1030 = $357;
       $354 = $1030;
       $355 = 0;
       $1031 = $354;
       $353 = $1031;
       $1032 = $353;
       $352 = $1032;
       $1033 = $352;
       $1034 = HEAP32[$1033>>2]|0;
       $356 = $1034;
       $1035 = $355;
       $342 = $1031;
       $1036 = $342;
       $341 = $1036;
       $1037 = $341;
       HEAP32[$1037>>2] = $1035;
       $1038 = $356;
       $1039 = ($1038|0)!=(0|0);
       if ($1039) {
        $340 = $1031;
        $1040 = $340;
        $339 = $1040;
        $1041 = $339;
        $1042 = ((($1041)) + 4|0);
        $1043 = $356;
        $350 = $1042;
        $351 = $1043;
        $1044 = $350;
        $1045 = HEAP32[$1044>>2]|0;
        $1046 = $351;
        $1047 = ((($1044)) + 4|0);
        $1048 = HEAP32[$1047>>2]|0;
        $347 = $1045;
        $348 = $1046;
        $349 = $1048;
        $1049 = $347;
        $1050 = $348;
        $1051 = $349;
        $344 = $1049;
        $345 = $1050;
        $346 = $1051;
        $1052 = $345;
        $343 = $1052;
        $1053 = $343;
        __ZdlPv($1053);
       }
       __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($369);
       STACKTOP = sp;return;
      }
     } while(0);
     $952 = ___cxa_find_matching_catch_2()|0;
     $953 = tempRet0;
     $373 = $952;
     $374 = $953;
     $301 = $372;
     $954 = $301;
     $298 = $954;
     $299 = 0;
     $955 = $298;
     $297 = $955;
     $956 = $297;
     $296 = $956;
     $957 = $296;
     $958 = HEAP32[$957>>2]|0;
     $300 = $958;
     $959 = $299;
     $286 = $955;
     $960 = $286;
     $285 = $960;
     $961 = $285;
     HEAP32[$961>>2] = $959;
     $962 = $300;
     $963 = ($962|0)!=(0|0);
     if (!($963)) {
      __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($369);
      $1054 = $373;
      $1055 = $374;
      ___resumeException($1054|0);
      // unreachable;
     }
     $284 = $955;
     $964 = $284;
     $283 = $964;
     $965 = $283;
     $966 = ((($965)) + 4|0);
     $967 = $300;
     $294 = $966;
     $295 = $967;
     $968 = $294;
     $969 = HEAP32[$968>>2]|0;
     $970 = $295;
     $971 = ((($968)) + 4|0);
     $972 = HEAP32[$971>>2]|0;
     $291 = $969;
     $292 = $970;
     $293 = $972;
     $973 = $291;
     $974 = $292;
     $975 = $293;
     $288 = $973;
     $289 = $974;
     $290 = $975;
     $976 = $289;
     $287 = $976;
     $977 = $287;
     __ZdlPv($977);
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($369);
     $1054 = $373;
     $1055 = $374;
     ___resumeException($1054|0);
     // unreachable;
    }
   }
  } while(0);
  if ((label|0) == 40) {
   $950 = ___cxa_find_matching_catch_2()|0;
   $951 = tempRet0;
   $$sink1 = $951;$$sink2 = $950;
  }
  $373 = $$sink2;
  $374 = $$sink1;
  __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($369);
  $1054 = $373;
  $1055 = $374;
  ___resumeException($1054|0);
  // unreachable;
 }
 $186 = $378;
 $603 = $186;
 $185 = $603;
 $604 = $185;
 $605 = ((($604)) + 12|0);
 $184 = $605;
 $606 = $184;
 $183 = $606;
 $607 = $183;
 $608 = HEAP32[$607>>2]|0;
 $609 = ((($603)) + 8|0);
 $610 = HEAP32[$609>>2]|0;
 $611 = $608;
 $612 = $610;
 $613 = (($611) - ($612))|0;
 $614 = (($613|0) / 4)&-1;
 $615 = ($614|0)!=(0);
 $616 = $364;
 if ($615) {
  $181 = $616;
  $182 = 341;
  $617 = $181;
  $618 = $182;
  $178 = $617;
  $179 = $618;
  $180 = 0;
  $619 = $178;
  $620 = $179;
  $177 = $619;
  $621 = ($620>>>0)>(357913941);
  if (!($621)) {
   $632 = $179;
   $633 = ($632*12)|0;
   $176 = $633;
   $634 = $176;
   $635 = (__Znwj($634)|0);
   HEAP32[$366>>2] = $635;
   __ZNSt3__214__split_bufferIP7MessageNS_9allocatorIS2_EEE9push_backEOS2_($378,$366);
   STACKTOP = sp;return;
  }
  $173 = 1363;
  $622 = (___cxa_allocate_exception(8)|0);
  $623 = $173;
  $171 = $622;
  $172 = $623;
  $624 = $171;
  $625 = $172;
  __THREW__ = 0;
  invoke_vii(66,($624|0),($625|0));
  $626 = __THREW__; __THREW__ = 0;
  $627 = $626&1;
  if ($627) {
   $628 = ___cxa_find_matching_catch_2()|0;
   $629 = tempRet0;
   $174 = $628;
   $175 = $629;
   ___cxa_free_exception(($622|0));
   $630 = $174;
   $631 = $175;
   ___resumeException($630|0);
   // unreachable;
  } else {
   HEAP32[$624>>2] = (1216);
   ___cxa_throw(($622|0),(392|0),(36|0));
   // unreachable;
  }
 }
 $169 = $616;
 $170 = 341;
 $636 = $169;
 $637 = $170;
 $166 = $636;
 $167 = $637;
 $168 = 0;
 $638 = $166;
 $639 = $167;
 $165 = $638;
 $640 = ($639>>>0)>(357913941);
 if ($640) {
  $161 = 1363;
  $641 = (___cxa_allocate_exception(8)|0);
  $642 = $161;
  $159 = $641;
  $160 = $642;
  $643 = $159;
  $644 = $160;
  __THREW__ = 0;
  invoke_vii(66,($643|0),($644|0));
  $645 = __THREW__; __THREW__ = 0;
  $646 = $645&1;
  if ($646) {
   $647 = ___cxa_find_matching_catch_2()|0;
   $648 = tempRet0;
   $162 = $647;
   $163 = $648;
   ___cxa_free_exception(($641|0));
   $649 = $162;
   $650 = $163;
   ___resumeException($649|0);
   // unreachable;
  } else {
   HEAP32[$643>>2] = (1216);
   ___cxa_throw(($641|0),(392|0),(36|0));
   // unreachable;
  }
 }
 $651 = $167;
 $652 = ($651*12)|0;
 $164 = $652;
 $653 = $164;
 $654 = (__Znwj($653)|0);
 HEAP32[$367>>2] = $654;
 __ZNSt3__214__split_bufferIP7MessageNS_9allocatorIS2_EEE10push_frontEOS2_($378,$367);
 $158 = $378;
 $655 = $158;
 $656 = ((($655)) + 4|0);
 $657 = HEAP32[$656>>2]|0;
 $658 = HEAP32[$657>>2]|0;
 HEAP32[$368>>2] = $658;
 $157 = $378;
 $659 = $157;
 $660 = ((($659)) + 4|0);
 $661 = HEAP32[$660>>2]|0;
 $662 = ((($661)) + 4|0);
 $154 = $659;
 $155 = $662;
 $663 = $154;
 $664 = $155;
 ;HEAP8[$153>>0]=HEAP8[$156>>0]|0;
 $151 = $663;
 $152 = $664;
 $665 = $151;
 $666 = $152;
 $667 = ((($665)) + 4|0);
 HEAP32[$667>>2] = $666;
 $140 = $378;
 $141 = $368;
 $668 = $140;
 $669 = ((($668)) + 8|0);
 $670 = HEAP32[$669>>2]|0;
 $139 = $668;
 $671 = $139;
 $672 = ((($671)) + 12|0);
 $138 = $672;
 $673 = $138;
 $137 = $673;
 $674 = $137;
 $675 = HEAP32[$674>>2]|0;
 $676 = ($670|0)==($675|0);
 do {
  if ($676) {
   $677 = ((($668)) + 4|0);
   $678 = HEAP32[$677>>2]|0;
   $679 = HEAP32[$668>>2]|0;
   $680 = ($678>>>0)>($679>>>0);
   if ($680) {
    $681 = ((($668)) + 4|0);
    $682 = HEAP32[$681>>2]|0;
    $683 = HEAP32[$668>>2]|0;
    $684 = $682;
    $685 = $683;
    $686 = (($684) - ($685))|0;
    $687 = (($686|0) / 4)&-1;
    $142 = $687;
    $688 = $142;
    $689 = (($688) + 1)|0;
    $690 = (($689|0) / 2)&-1;
    $142 = $690;
    $691 = ((($668)) + 4|0);
    $692 = HEAP32[$691>>2]|0;
    $693 = ((($668)) + 8|0);
    $694 = HEAP32[$693>>2]|0;
    $695 = ((($668)) + 4|0);
    $696 = HEAP32[$695>>2]|0;
    $697 = $142;
    $698 = (0 - ($697))|0;
    $699 = (($696) + ($698<<2)|0);
    $116 = $692;
    $117 = $694;
    $118 = $699;
    $700 = $116;
    $115 = $700;
    $701 = $115;
    $702 = $117;
    $109 = $702;
    $703 = $109;
    $704 = $118;
    $110 = $704;
    $705 = $110;
    $111 = $701;
    $112 = $703;
    $113 = $705;
    $706 = $112;
    $707 = $111;
    $708 = $706;
    $709 = $707;
    $710 = (($708) - ($709))|0;
    $711 = (($710|0) / 4)&-1;
    $114 = $711;
    $712 = $114;
    $713 = ($712>>>0)>(0);
    if ($713) {
     $714 = $113;
     $715 = $111;
     $716 = $114;
     $717 = $716<<2;
     _memmove(($714|0),($715|0),($717|0))|0;
    }
    $718 = $113;
    $719 = $114;
    $720 = (($718) + ($719<<2)|0);
    $721 = ((($668)) + 8|0);
    HEAP32[$721>>2] = $720;
    $722 = $142;
    $723 = ((($668)) + 4|0);
    $724 = HEAP32[$723>>2]|0;
    $725 = (0 - ($722))|0;
    $726 = (($724) + ($725<<2)|0);
    HEAP32[$723>>2] = $726;
    break;
   } else {
    $108 = $668;
    $727 = $108;
    $728 = ((($727)) + 12|0);
    $107 = $728;
    $729 = $107;
    $106 = $729;
    $730 = $106;
    $731 = HEAP32[$730>>2]|0;
    $732 = HEAP32[$668>>2]|0;
    $733 = $731;
    $734 = $732;
    $735 = (($733) - ($734))|0;
    $736 = (($735|0) / 4)&-1;
    $737 = $736<<1;
    HEAP32[$144>>2] = $737;
    HEAP32[$145>>2] = 1;
    $73 = $144;
    $74 = $145;
    $738 = $73;
    $739 = $74;
    ;HEAP8[$72>>0]=HEAP8[$75>>0]|0;
    $70 = $738;
    $71 = $739;
    $740 = $70;
    $741 = $71;
    $67 = $72;
    $68 = $740;
    $69 = $741;
    $742 = $68;
    $743 = HEAP32[$742>>2]|0;
    $744 = $69;
    $745 = HEAP32[$744>>2]|0;
    $746 = ($743>>>0)<($745>>>0);
    $747 = $71;
    $748 = $70;
    $749 = $746 ? $747 : $748;
    $750 = HEAP32[$749>>2]|0;
    $143 = $750;
    $751 = $143;
    $752 = $143;
    $753 = (($752>>>0) / 4)&-1;
    $62 = $668;
    $754 = $62;
    $755 = ((($754)) + 12|0);
    $61 = $755;
    $756 = $61;
    $60 = $756;
    $757 = $60;
    __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEEC2EjjS5_($146,$751,$753,$757);
    $758 = ((($668)) + 4|0);
    $759 = HEAP32[$758>>2]|0;
    $63 = $147;
    $64 = $759;
    $760 = $63;
    $761 = $64;
    HEAP32[$760>>2] = $761;
    $762 = ((($668)) + 8|0);
    $763 = HEAP32[$762>>2]|0;
    $65 = $150;
    $66 = $763;
    $764 = $65;
    $765 = $66;
    HEAP32[$764>>2] = $765;
    __THREW__ = 0;
    ;HEAP32[$$byval_copy4>>2]=HEAP32[$147>>2]|0;
    ;HEAP32[$$byval_copy5>>2]=HEAP32[$150>>2]|0;
    invoke_viii(65,($146|0),($$byval_copy4|0),($$byval_copy5|0));
    $766 = __THREW__; __THREW__ = 0;
    $767 = $766&1;
    if ($767) {
     $820 = ___cxa_find_matching_catch_2()|0;
     $821 = tempRet0;
     $148 = $820;
     $149 = $821;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($146);
     $822 = $148;
     $823 = $149;
     ___resumeException($822|0);
     // unreachable;
    } else {
     $79 = $668;
     $80 = $146;
     $768 = $79;
     $78 = $768;
     $769 = $78;
     $770 = HEAP32[$769>>2]|0;
     HEAP32[$81>>2] = $770;
     $771 = $80;
     $76 = $771;
     $772 = $76;
     $773 = HEAP32[$772>>2]|0;
     $774 = $79;
     HEAP32[$774>>2] = $773;
     $77 = $81;
     $775 = $77;
     $776 = HEAP32[$775>>2]|0;
     $777 = $80;
     HEAP32[$777>>2] = $776;
     $778 = ((($668)) + 4|0);
     $779 = ((($146)) + 4|0);
     $85 = $778;
     $86 = $779;
     $780 = $85;
     $84 = $780;
     $781 = $84;
     $782 = HEAP32[$781>>2]|0;
     HEAP32[$87>>2] = $782;
     $783 = $86;
     $82 = $783;
     $784 = $82;
     $785 = HEAP32[$784>>2]|0;
     $786 = $85;
     HEAP32[$786>>2] = $785;
     $83 = $87;
     $787 = $83;
     $788 = HEAP32[$787>>2]|0;
     $789 = $86;
     HEAP32[$789>>2] = $788;
     $790 = ((($668)) + 8|0);
     $791 = ((($146)) + 8|0);
     $91 = $790;
     $92 = $791;
     $792 = $91;
     $90 = $792;
     $793 = $90;
     $794 = HEAP32[$793>>2]|0;
     HEAP32[$93>>2] = $794;
     $795 = $92;
     $88 = $795;
     $796 = $88;
     $797 = HEAP32[$796>>2]|0;
     $798 = $91;
     HEAP32[$798>>2] = $797;
     $89 = $93;
     $799 = $89;
     $800 = HEAP32[$799>>2]|0;
     $801 = $92;
     HEAP32[$801>>2] = $800;
     $96 = $668;
     $802 = $96;
     $803 = ((($802)) + 12|0);
     $95 = $803;
     $804 = $95;
     $94 = $804;
     $805 = $94;
     $99 = $146;
     $806 = $99;
     $807 = ((($806)) + 12|0);
     $98 = $807;
     $808 = $98;
     $97 = $808;
     $809 = $97;
     $103 = $805;
     $104 = $809;
     $810 = $103;
     $102 = $810;
     $811 = $102;
     $812 = HEAP32[$811>>2]|0;
     HEAP32[$105>>2] = $812;
     $813 = $104;
     $100 = $813;
     $814 = $100;
     $815 = HEAP32[$814>>2]|0;
     $816 = $103;
     HEAP32[$816>>2] = $815;
     $101 = $105;
     $817 = $101;
     $818 = HEAP32[$817>>2]|0;
     $819 = $104;
     HEAP32[$819>>2] = $818;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($146);
     break;
    }
   }
  }
 } while(0);
 $121 = $668;
 $824 = $121;
 $825 = ((($824)) + 12|0);
 $120 = $825;
 $826 = $120;
 $119 = $826;
 $827 = $119;
 $828 = ((($668)) + 8|0);
 $829 = HEAP32[$828>>2]|0;
 $122 = $829;
 $830 = $122;
 $831 = $141;
 $133 = $827;
 $134 = $830;
 $135 = $831;
 $832 = $133;
 $833 = $134;
 $834 = $135;
 $132 = $834;
 $835 = $132;
 ;HEAP8[$131>>0]=HEAP8[$136>>0]|0;
 $128 = $832;
 $129 = $833;
 $130 = $835;
 $836 = $128;
 $837 = $129;
 $838 = $130;
 $127 = $838;
 $839 = $127;
 $124 = $836;
 $125 = $837;
 $126 = $839;
 $840 = $125;
 $841 = $126;
 $123 = $841;
 $842 = $123;
 $843 = HEAP32[$842>>2]|0;
 HEAP32[$840>>2] = $843;
 $844 = ((($668)) + 8|0);
 $845 = HEAP32[$844>>2]|0;
 $846 = ((($845)) + 4|0);
 HEAP32[$844>>2] = $846;
 STACKTOP = sp;return;
}
function __ZNSt3__214__split_bufferIP7MessageNS_9allocatorIS2_EEE9push_backEOS2_($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$byval_copy = 0, $$byval_copy1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0;
 var $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0;
 var $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0;
 var $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0;
 var $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0;
 var $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0;
 var $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0;
 var $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0;
 var $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0;
 var $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0;
 var $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0;
 var $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0;
 var $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 400|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(400|0);
 $$byval_copy1 = sp + 384|0;
 $$byval_copy = sp + 380|0;
 $14 = sp + 8|0;
 $17 = sp + 389|0;
 $23 = sp + 300|0;
 $29 = sp + 276|0;
 $35 = sp + 252|0;
 $47 = sp + 204|0;
 $74 = sp;
 $79 = sp + 388|0;
 $87 = sp + 52|0;
 $88 = sp + 48|0;
 $89 = sp + 28|0;
 $90 = sp + 24|0;
 $93 = sp + 12|0;
 $83 = $0;
 $84 = $1;
 $94 = $83;
 $95 = ((($94)) + 8|0);
 $96 = HEAP32[$95>>2]|0;
 $82 = $94;
 $97 = $82;
 $98 = ((($97)) + 12|0);
 $81 = $98;
 $99 = $81;
 $80 = $99;
 $100 = $80;
 $101 = HEAP32[$100>>2]|0;
 $102 = ($96|0)==($101|0);
 do {
  if ($102) {
   $103 = ((($94)) + 4|0);
   $104 = HEAP32[$103>>2]|0;
   $105 = HEAP32[$94>>2]|0;
   $106 = ($104>>>0)>($105>>>0);
   if ($106) {
    $107 = ((($94)) + 4|0);
    $108 = HEAP32[$107>>2]|0;
    $109 = HEAP32[$94>>2]|0;
    $110 = $108;
    $111 = $109;
    $112 = (($110) - ($111))|0;
    $113 = (($112|0) / 4)&-1;
    $85 = $113;
    $114 = $85;
    $115 = (($114) + 1)|0;
    $116 = (($115|0) / 2)&-1;
    $85 = $116;
    $117 = ((($94)) + 4|0);
    $118 = HEAP32[$117>>2]|0;
    $119 = ((($94)) + 8|0);
    $120 = HEAP32[$119>>2]|0;
    $121 = ((($94)) + 4|0);
    $122 = HEAP32[$121>>2]|0;
    $123 = $85;
    $124 = (0 - ($123))|0;
    $125 = (($122) + ($124<<2)|0);
    $58 = $118;
    $59 = $120;
    $60 = $125;
    $126 = $58;
    $57 = $126;
    $127 = $57;
    $128 = $59;
    $51 = $128;
    $129 = $51;
    $130 = $60;
    $52 = $130;
    $131 = $52;
    $53 = $127;
    $54 = $129;
    $55 = $131;
    $132 = $54;
    $133 = $53;
    $134 = $132;
    $135 = $133;
    $136 = (($134) - ($135))|0;
    $137 = (($136|0) / 4)&-1;
    $56 = $137;
    $138 = $56;
    $139 = ($138>>>0)>(0);
    if ($139) {
     $140 = $55;
     $141 = $53;
     $142 = $56;
     $143 = $142<<2;
     _memmove(($140|0),($141|0),($143|0))|0;
    }
    $144 = $55;
    $145 = $56;
    $146 = (($144) + ($145<<2)|0);
    $147 = ((($94)) + 8|0);
    HEAP32[$147>>2] = $146;
    $148 = $85;
    $149 = ((($94)) + 4|0);
    $150 = HEAP32[$149>>2]|0;
    $151 = (0 - ($148))|0;
    $152 = (($150) + ($151<<2)|0);
    HEAP32[$149>>2] = $152;
    break;
   } else {
    $50 = $94;
    $153 = $50;
    $154 = ((($153)) + 12|0);
    $49 = $154;
    $155 = $49;
    $48 = $155;
    $156 = $48;
    $157 = HEAP32[$156>>2]|0;
    $158 = HEAP32[$94>>2]|0;
    $159 = $157;
    $160 = $158;
    $161 = (($159) - ($160))|0;
    $162 = (($161|0) / 4)&-1;
    $163 = $162<<1;
    HEAP32[$87>>2] = $163;
    HEAP32[$88>>2] = 1;
    $15 = $87;
    $16 = $88;
    $164 = $15;
    $165 = $16;
    ;HEAP8[$14>>0]=HEAP8[$17>>0]|0;
    $12 = $164;
    $13 = $165;
    $166 = $12;
    $167 = $13;
    $9 = $14;
    $10 = $166;
    $11 = $167;
    $168 = $10;
    $169 = HEAP32[$168>>2]|0;
    $170 = $11;
    $171 = HEAP32[$170>>2]|0;
    $172 = ($169>>>0)<($171>>>0);
    $173 = $13;
    $174 = $12;
    $175 = $172 ? $173 : $174;
    $176 = HEAP32[$175>>2]|0;
    $86 = $176;
    $177 = $86;
    $178 = $86;
    $179 = (($178>>>0) / 4)&-1;
    $4 = $94;
    $180 = $4;
    $181 = ((($180)) + 12|0);
    $3 = $181;
    $182 = $3;
    $2 = $182;
    $183 = $2;
    __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEEC2EjjS5_($89,$177,$179,$183);
    $184 = ((($94)) + 4|0);
    $185 = HEAP32[$184>>2]|0;
    $5 = $90;
    $6 = $185;
    $186 = $5;
    $187 = $6;
    HEAP32[$186>>2] = $187;
    $188 = ((($94)) + 8|0);
    $189 = HEAP32[$188>>2]|0;
    $7 = $93;
    $8 = $189;
    $190 = $7;
    $191 = $8;
    HEAP32[$190>>2] = $191;
    __THREW__ = 0;
    ;HEAP32[$$byval_copy>>2]=HEAP32[$90>>2]|0;
    ;HEAP32[$$byval_copy1>>2]=HEAP32[$93>>2]|0;
    invoke_viii(65,($89|0),($$byval_copy|0),($$byval_copy1|0));
    $192 = __THREW__; __THREW__ = 0;
    $193 = $192&1;
    if ($193) {
     $246 = ___cxa_find_matching_catch_2()|0;
     $247 = tempRet0;
     $91 = $246;
     $92 = $247;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($89);
     $248 = $91;
     $249 = $92;
     ___resumeException($248|0);
     // unreachable;
    } else {
     $21 = $94;
     $22 = $89;
     $194 = $21;
     $20 = $194;
     $195 = $20;
     $196 = HEAP32[$195>>2]|0;
     HEAP32[$23>>2] = $196;
     $197 = $22;
     $18 = $197;
     $198 = $18;
     $199 = HEAP32[$198>>2]|0;
     $200 = $21;
     HEAP32[$200>>2] = $199;
     $19 = $23;
     $201 = $19;
     $202 = HEAP32[$201>>2]|0;
     $203 = $22;
     HEAP32[$203>>2] = $202;
     $204 = ((($94)) + 4|0);
     $205 = ((($89)) + 4|0);
     $27 = $204;
     $28 = $205;
     $206 = $27;
     $26 = $206;
     $207 = $26;
     $208 = HEAP32[$207>>2]|0;
     HEAP32[$29>>2] = $208;
     $209 = $28;
     $24 = $209;
     $210 = $24;
     $211 = HEAP32[$210>>2]|0;
     $212 = $27;
     HEAP32[$212>>2] = $211;
     $25 = $29;
     $213 = $25;
     $214 = HEAP32[$213>>2]|0;
     $215 = $28;
     HEAP32[$215>>2] = $214;
     $216 = ((($94)) + 8|0);
     $217 = ((($89)) + 8|0);
     $33 = $216;
     $34 = $217;
     $218 = $33;
     $32 = $218;
     $219 = $32;
     $220 = HEAP32[$219>>2]|0;
     HEAP32[$35>>2] = $220;
     $221 = $34;
     $30 = $221;
     $222 = $30;
     $223 = HEAP32[$222>>2]|0;
     $224 = $33;
     HEAP32[$224>>2] = $223;
     $31 = $35;
     $225 = $31;
     $226 = HEAP32[$225>>2]|0;
     $227 = $34;
     HEAP32[$227>>2] = $226;
     $38 = $94;
     $228 = $38;
     $229 = ((($228)) + 12|0);
     $37 = $229;
     $230 = $37;
     $36 = $230;
     $231 = $36;
     $41 = $89;
     $232 = $41;
     $233 = ((($232)) + 12|0);
     $40 = $233;
     $234 = $40;
     $39 = $234;
     $235 = $39;
     $45 = $231;
     $46 = $235;
     $236 = $45;
     $44 = $236;
     $237 = $44;
     $238 = HEAP32[$237>>2]|0;
     HEAP32[$47>>2] = $238;
     $239 = $46;
     $42 = $239;
     $240 = $42;
     $241 = HEAP32[$240>>2]|0;
     $242 = $45;
     HEAP32[$242>>2] = $241;
     $43 = $47;
     $243 = $43;
     $244 = HEAP32[$243>>2]|0;
     $245 = $46;
     HEAP32[$245>>2] = $244;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($89);
     break;
    }
   }
  }
 } while(0);
 $63 = $94;
 $250 = $63;
 $251 = ((($250)) + 12|0);
 $62 = $251;
 $252 = $62;
 $61 = $252;
 $253 = $61;
 $254 = ((($94)) + 8|0);
 $255 = HEAP32[$254>>2]|0;
 $64 = $255;
 $256 = $64;
 $257 = $84;
 $65 = $257;
 $258 = $65;
 $76 = $253;
 $77 = $256;
 $78 = $258;
 $259 = $76;
 $260 = $77;
 $261 = $78;
 $75 = $261;
 $262 = $75;
 ;HEAP8[$74>>0]=HEAP8[$79>>0]|0;
 $71 = $259;
 $72 = $260;
 $73 = $262;
 $263 = $71;
 $264 = $72;
 $265 = $73;
 $70 = $265;
 $266 = $70;
 $67 = $263;
 $68 = $264;
 $69 = $266;
 $267 = $68;
 $268 = $69;
 $66 = $268;
 $269 = $66;
 $270 = HEAP32[$269>>2]|0;
 HEAP32[$267>>2] = $270;
 $271 = ((($94)) + 8|0);
 $272 = HEAP32[$271>>2]|0;
 $273 = ((($272)) + 4|0);
 HEAP32[$271>>2] = $273;
 STACKTOP = sp;return;
}
function __ZNSt3__214__split_bufferIP7MessageNS_9allocatorIS2_EEE10push_frontEOS2_($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$byval_copy = 0, $$byval_copy1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0;
 var $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0;
 var $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0;
 var $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0;
 var $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0;
 var $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0;
 var $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0;
 var $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0;
 var $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0;
 var $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0;
 var $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0;
 var $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0;
 var $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0;
 var $97 = 0, $98 = 0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 416|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(416|0);
 $$byval_copy1 = sp + 396|0;
 $$byval_copy = sp + 392|0;
 $10 = sp + 8|0;
 $13 = sp + 401|0;
 $26 = sp + 300|0;
 $32 = sp + 276|0;
 $38 = sp + 252|0;
 $50 = sp + 204|0;
 $77 = sp;
 $82 = sp + 400|0;
 $90 = sp + 52|0;
 $91 = sp + 48|0;
 $92 = sp + 28|0;
 $93 = sp + 24|0;
 $96 = sp + 12|0;
 $86 = $0;
 $87 = $1;
 $97 = $86;
 $98 = ((($97)) + 4|0);
 $99 = HEAP32[$98>>2]|0;
 $100 = HEAP32[$97>>2]|0;
 $101 = ($99|0)==($100|0);
 do {
  if ($101) {
   $102 = ((($97)) + 8|0);
   $103 = HEAP32[$102>>2]|0;
   $85 = $97;
   $104 = $85;
   $105 = ((($104)) + 12|0);
   $84 = $105;
   $106 = $84;
   $83 = $106;
   $107 = $83;
   $108 = HEAP32[$107>>2]|0;
   $109 = ($103>>>0)<($108>>>0);
   if ($109) {
    $63 = $97;
    $110 = $63;
    $111 = ((($110)) + 12|0);
    $62 = $111;
    $112 = $62;
    $61 = $112;
    $113 = $61;
    $114 = HEAP32[$113>>2]|0;
    $115 = ((($97)) + 8|0);
    $116 = HEAP32[$115>>2]|0;
    $117 = $114;
    $118 = $116;
    $119 = (($117) - ($118))|0;
    $120 = (($119|0) / 4)&-1;
    $88 = $120;
    $121 = $88;
    $122 = (($121) + 1)|0;
    $123 = (($122|0) / 2)&-1;
    $88 = $123;
    $124 = ((($97)) + 4|0);
    $125 = HEAP32[$124>>2]|0;
    $126 = ((($97)) + 8|0);
    $127 = HEAP32[$126>>2]|0;
    $128 = ((($97)) + 8|0);
    $129 = HEAP32[$128>>2]|0;
    $130 = $88;
    $131 = (($129) + ($130<<2)|0);
    $58 = $125;
    $59 = $127;
    $60 = $131;
    $132 = $58;
    $57 = $132;
    $133 = $57;
    $134 = $59;
    $51 = $134;
    $135 = $51;
    $136 = $60;
    $52 = $136;
    $137 = $52;
    $53 = $133;
    $54 = $135;
    $55 = $137;
    $138 = $54;
    $139 = $53;
    $140 = $138;
    $141 = $139;
    $142 = (($140) - ($141))|0;
    $143 = (($142|0) / 4)&-1;
    $56 = $143;
    $144 = $56;
    $145 = ($144>>>0)>(0);
    if ($145) {
     $146 = $56;
     $147 = $55;
     $148 = (0 - ($146))|0;
     $149 = (($147) + ($148<<2)|0);
     $55 = $149;
     $150 = $55;
     $151 = $53;
     $152 = $56;
     $153 = $152<<2;
     _memmove(($150|0),($151|0),($153|0))|0;
    }
    $154 = $55;
    $155 = ((($97)) + 4|0);
    HEAP32[$155>>2] = $154;
    $156 = $88;
    $157 = ((($97)) + 8|0);
    $158 = HEAP32[$157>>2]|0;
    $159 = (($158) + ($156<<2)|0);
    HEAP32[$157>>2] = $159;
    break;
   } else {
    $20 = $97;
    $160 = $20;
    $161 = ((($160)) + 12|0);
    $19 = $161;
    $162 = $19;
    $18 = $162;
    $163 = $18;
    $164 = HEAP32[$163>>2]|0;
    $165 = HEAP32[$97>>2]|0;
    $166 = $164;
    $167 = $165;
    $168 = (($166) - ($167))|0;
    $169 = (($168|0) / 4)&-1;
    $170 = $169<<1;
    HEAP32[$90>>2] = $170;
    HEAP32[$91>>2] = 1;
    $11 = $90;
    $12 = $91;
    $171 = $11;
    $172 = $12;
    ;HEAP8[$10>>0]=HEAP8[$13>>0]|0;
    $8 = $171;
    $9 = $172;
    $173 = $8;
    $174 = $9;
    $5 = $10;
    $6 = $173;
    $7 = $174;
    $175 = $6;
    $176 = HEAP32[$175>>2]|0;
    $177 = $7;
    $178 = HEAP32[$177>>2]|0;
    $179 = ($176>>>0)<($178>>>0);
    $180 = $9;
    $181 = $8;
    $182 = $179 ? $180 : $181;
    $183 = HEAP32[$182>>2]|0;
    $89 = $183;
    $184 = $89;
    $185 = $89;
    $186 = (($185) + 3)|0;
    $187 = (($186>>>0) / 4)&-1;
    $4 = $97;
    $188 = $4;
    $189 = ((($188)) + 12|0);
    $3 = $189;
    $190 = $3;
    $2 = $190;
    $191 = $2;
    __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEEC2EjjS5_($92,$184,$187,$191);
    $192 = ((($97)) + 4|0);
    $193 = HEAP32[$192>>2]|0;
    $14 = $93;
    $15 = $193;
    $194 = $14;
    $195 = $15;
    HEAP32[$194>>2] = $195;
    $196 = ((($97)) + 8|0);
    $197 = HEAP32[$196>>2]|0;
    $16 = $96;
    $17 = $197;
    $198 = $16;
    $199 = $17;
    HEAP32[$198>>2] = $199;
    __THREW__ = 0;
    ;HEAP32[$$byval_copy>>2]=HEAP32[$93>>2]|0;
    ;HEAP32[$$byval_copy1>>2]=HEAP32[$96>>2]|0;
    invoke_viii(65,($92|0),($$byval_copy|0),($$byval_copy1|0));
    $200 = __THREW__; __THREW__ = 0;
    $201 = $200&1;
    if ($201) {
     $254 = ___cxa_find_matching_catch_2()|0;
     $255 = tempRet0;
     $94 = $254;
     $95 = $255;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($92);
     $256 = $94;
     $257 = $95;
     ___resumeException($256|0);
     // unreachable;
    } else {
     $24 = $97;
     $25 = $92;
     $202 = $24;
     $23 = $202;
     $203 = $23;
     $204 = HEAP32[$203>>2]|0;
     HEAP32[$26>>2] = $204;
     $205 = $25;
     $21 = $205;
     $206 = $21;
     $207 = HEAP32[$206>>2]|0;
     $208 = $24;
     HEAP32[$208>>2] = $207;
     $22 = $26;
     $209 = $22;
     $210 = HEAP32[$209>>2]|0;
     $211 = $25;
     HEAP32[$211>>2] = $210;
     $212 = ((($97)) + 4|0);
     $213 = ((($92)) + 4|0);
     $30 = $212;
     $31 = $213;
     $214 = $30;
     $29 = $214;
     $215 = $29;
     $216 = HEAP32[$215>>2]|0;
     HEAP32[$32>>2] = $216;
     $217 = $31;
     $27 = $217;
     $218 = $27;
     $219 = HEAP32[$218>>2]|0;
     $220 = $30;
     HEAP32[$220>>2] = $219;
     $28 = $32;
     $221 = $28;
     $222 = HEAP32[$221>>2]|0;
     $223 = $31;
     HEAP32[$223>>2] = $222;
     $224 = ((($97)) + 8|0);
     $225 = ((($92)) + 8|0);
     $36 = $224;
     $37 = $225;
     $226 = $36;
     $35 = $226;
     $227 = $35;
     $228 = HEAP32[$227>>2]|0;
     HEAP32[$38>>2] = $228;
     $229 = $37;
     $33 = $229;
     $230 = $33;
     $231 = HEAP32[$230>>2]|0;
     $232 = $36;
     HEAP32[$232>>2] = $231;
     $34 = $38;
     $233 = $34;
     $234 = HEAP32[$233>>2]|0;
     $235 = $37;
     HEAP32[$235>>2] = $234;
     $41 = $97;
     $236 = $41;
     $237 = ((($236)) + 12|0);
     $40 = $237;
     $238 = $40;
     $39 = $238;
     $239 = $39;
     $44 = $92;
     $240 = $44;
     $241 = ((($240)) + 12|0);
     $43 = $241;
     $242 = $43;
     $42 = $242;
     $243 = $42;
     $48 = $239;
     $49 = $243;
     $244 = $48;
     $47 = $244;
     $245 = $47;
     $246 = HEAP32[$245>>2]|0;
     HEAP32[$50>>2] = $246;
     $247 = $49;
     $45 = $247;
     $248 = $45;
     $249 = HEAP32[$248>>2]|0;
     $250 = $48;
     HEAP32[$250>>2] = $249;
     $46 = $50;
     $251 = $46;
     $252 = HEAP32[$251>>2]|0;
     $253 = $49;
     HEAP32[$253>>2] = $252;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($92);
     break;
    }
   }
  }
 } while(0);
 $66 = $97;
 $258 = $66;
 $259 = ((($258)) + 12|0);
 $65 = $259;
 $260 = $65;
 $64 = $260;
 $261 = $64;
 $262 = ((($97)) + 4|0);
 $263 = HEAP32[$262>>2]|0;
 $264 = ((($263)) + -4|0);
 $67 = $264;
 $265 = $67;
 $266 = $87;
 $68 = $266;
 $267 = $68;
 $79 = $261;
 $80 = $265;
 $81 = $267;
 $268 = $79;
 $269 = $80;
 $270 = $81;
 $78 = $270;
 $271 = $78;
 ;HEAP8[$77>>0]=HEAP8[$82>>0]|0;
 $74 = $268;
 $75 = $269;
 $76 = $271;
 $272 = $74;
 $273 = $75;
 $274 = $76;
 $73 = $274;
 $275 = $73;
 $70 = $272;
 $71 = $273;
 $72 = $275;
 $276 = $71;
 $277 = $72;
 $69 = $277;
 $278 = $69;
 $279 = HEAP32[$278>>2]|0;
 HEAP32[$276>>2] = $279;
 $280 = ((($97)) + 4|0);
 $281 = HEAP32[$280>>2]|0;
 $282 = ((($281)) + -4|0);
 HEAP32[$280>>2] = $282;
 STACKTOP = sp;return;
}
function __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEEC2EjjS5_($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0;
 var $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0;
 var $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0;
 var $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0;
 var $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 128|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(128|0);
 $26 = sp + 36|0;
 $30 = sp + 20|0;
 $32 = $0;
 $33 = $1;
 $34 = $2;
 $35 = $3;
 $36 = $32;
 $37 = ((($36)) + 12|0);
 $38 = $35;
 $29 = $37;
 HEAP32[$30>>2] = 0;
 $31 = $38;
 $39 = $29;
 $28 = $30;
 $40 = $28;
 $41 = HEAP32[$40>>2]|0;
 $42 = $31;
 $22 = $42;
 $43 = $22;
 $25 = $39;
 HEAP32[$26>>2] = $41;
 $27 = $43;
 $44 = $25;
 $24 = $26;
 $45 = $24;
 $46 = HEAP32[$45>>2]|0;
 HEAP32[$44>>2] = $46;
 $47 = ((($44)) + 4|0);
 $48 = $27;
 $23 = $48;
 $49 = $23;
 HEAP32[$47>>2] = $49;
 $50 = $33;
 $51 = ($50|0)!=(0);
 do {
  if ($51) {
   $6 = $36;
   $52 = $6;
   $53 = ((($52)) + 12|0);
   $5 = $53;
   $54 = $5;
   $4 = $54;
   $55 = $4;
   $56 = ((($55)) + 4|0);
   $57 = HEAP32[$56>>2]|0;
   $58 = $33;
   $17 = $57;
   $18 = $58;
   $59 = $17;
   $60 = $18;
   $14 = $59;
   $15 = $60;
   $16 = 0;
   $61 = $14;
   $62 = $15;
   $13 = $61;
   $63 = ($62>>>0)>(1073741823);
   if (!($63)) {
    $74 = $15;
    $75 = $74<<2;
    $12 = $75;
    $76 = $12;
    $77 = (__Znwj($76)|0);
    $78 = $77;
    break;
   }
   $9 = 1363;
   $64 = (___cxa_allocate_exception(8)|0);
   $65 = $9;
   $7 = $64;
   $8 = $65;
   $66 = $7;
   $67 = $8;
   __THREW__ = 0;
   invoke_vii(66,($66|0),($67|0));
   $68 = __THREW__; __THREW__ = 0;
   $69 = $68&1;
   if ($69) {
    $70 = ___cxa_find_matching_catch_2()|0;
    $71 = tempRet0;
    $10 = $70;
    $11 = $71;
    ___cxa_free_exception(($64|0));
    $72 = $10;
    $73 = $11;
    ___resumeException($72|0);
    // unreachable;
   } else {
    HEAP32[$66>>2] = (1216);
    ___cxa_throw(($64|0),(392|0),(36|0));
    // unreachable;
   }
  } else {
   $78 = 0;
  }
 } while(0);
 HEAP32[$36>>2] = $78;
 $79 = HEAP32[$36>>2]|0;
 $80 = $34;
 $81 = (($79) + ($80<<2)|0);
 $82 = ((($36)) + 8|0);
 HEAP32[$82>>2] = $81;
 $83 = ((($36)) + 4|0);
 HEAP32[$83>>2] = $81;
 $84 = HEAP32[$36>>2]|0;
 $85 = $33;
 $86 = (($84) + ($85<<2)|0);
 $21 = $36;
 $87 = $21;
 $88 = ((($87)) + 12|0);
 $20 = $88;
 $89 = $20;
 $19 = $89;
 $90 = $19;
 HEAP32[$90>>2] = $86;
 STACKTOP = sp;return;
}
function __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEE9push_backEOS2_($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$byval_copy = 0, $$byval_copy1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0;
 var $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0;
 var $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0;
 var $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0;
 var $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0;
 var $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0;
 var $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0;
 var $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0;
 var $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $28 = 0;
 var $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0;
 var $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0;
 var $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0;
 var $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 400|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(400|0);
 $$byval_copy1 = sp + 384|0;
 $$byval_copy = sp + 380|0;
 $14 = sp + 8|0;
 $17 = sp + 389|0;
 $23 = sp + 300|0;
 $29 = sp + 276|0;
 $35 = sp + 252|0;
 $47 = sp + 204|0;
 $74 = sp;
 $79 = sp + 388|0;
 $87 = sp + 52|0;
 $88 = sp + 48|0;
 $89 = sp + 28|0;
 $90 = sp + 24|0;
 $93 = sp + 12|0;
 $83 = $0;
 $84 = $1;
 $94 = $83;
 $95 = ((($94)) + 8|0);
 $96 = HEAP32[$95>>2]|0;
 $82 = $94;
 $97 = $82;
 $98 = ((($97)) + 12|0);
 $81 = $98;
 $99 = $81;
 $80 = $99;
 $100 = $80;
 $101 = HEAP32[$100>>2]|0;
 $102 = ($96|0)==($101|0);
 do {
  if ($102) {
   $103 = ((($94)) + 4|0);
   $104 = HEAP32[$103>>2]|0;
   $105 = HEAP32[$94>>2]|0;
   $106 = ($104>>>0)>($105>>>0);
   if ($106) {
    $107 = ((($94)) + 4|0);
    $108 = HEAP32[$107>>2]|0;
    $109 = HEAP32[$94>>2]|0;
    $110 = $108;
    $111 = $109;
    $112 = (($110) - ($111))|0;
    $113 = (($112|0) / 4)&-1;
    $85 = $113;
    $114 = $85;
    $115 = (($114) + 1)|0;
    $116 = (($115|0) / 2)&-1;
    $85 = $116;
    $117 = ((($94)) + 4|0);
    $118 = HEAP32[$117>>2]|0;
    $119 = ((($94)) + 8|0);
    $120 = HEAP32[$119>>2]|0;
    $121 = ((($94)) + 4|0);
    $122 = HEAP32[$121>>2]|0;
    $123 = $85;
    $124 = (0 - ($123))|0;
    $125 = (($122) + ($124<<2)|0);
    $58 = $118;
    $59 = $120;
    $60 = $125;
    $126 = $58;
    $57 = $126;
    $127 = $57;
    $128 = $59;
    $51 = $128;
    $129 = $51;
    $130 = $60;
    $52 = $130;
    $131 = $52;
    $53 = $127;
    $54 = $129;
    $55 = $131;
    $132 = $54;
    $133 = $53;
    $134 = $132;
    $135 = $133;
    $136 = (($134) - ($135))|0;
    $137 = (($136|0) / 4)&-1;
    $56 = $137;
    $138 = $56;
    $139 = ($138>>>0)>(0);
    if ($139) {
     $140 = $55;
     $141 = $53;
     $142 = $56;
     $143 = $142<<2;
     _memmove(($140|0),($141|0),($143|0))|0;
    }
    $144 = $55;
    $145 = $56;
    $146 = (($144) + ($145<<2)|0);
    $147 = ((($94)) + 8|0);
    HEAP32[$147>>2] = $146;
    $148 = $85;
    $149 = ((($94)) + 4|0);
    $150 = HEAP32[$149>>2]|0;
    $151 = (0 - ($148))|0;
    $152 = (($150) + ($151<<2)|0);
    HEAP32[$149>>2] = $152;
    break;
   } else {
    $50 = $94;
    $153 = $50;
    $154 = ((($153)) + 12|0);
    $49 = $154;
    $155 = $49;
    $48 = $155;
    $156 = $48;
    $157 = HEAP32[$156>>2]|0;
    $158 = HEAP32[$94>>2]|0;
    $159 = $157;
    $160 = $158;
    $161 = (($159) - ($160))|0;
    $162 = (($161|0) / 4)&-1;
    $163 = $162<<1;
    HEAP32[$87>>2] = $163;
    HEAP32[$88>>2] = 1;
    $15 = $87;
    $16 = $88;
    $164 = $15;
    $165 = $16;
    ;HEAP8[$14>>0]=HEAP8[$17>>0]|0;
    $12 = $164;
    $13 = $165;
    $166 = $12;
    $167 = $13;
    $9 = $14;
    $10 = $166;
    $11 = $167;
    $168 = $10;
    $169 = HEAP32[$168>>2]|0;
    $170 = $11;
    $171 = HEAP32[$170>>2]|0;
    $172 = ($169>>>0)<($171>>>0);
    $173 = $13;
    $174 = $12;
    $175 = $172 ? $173 : $174;
    $176 = HEAP32[$175>>2]|0;
    $86 = $176;
    $177 = $86;
    $178 = $86;
    $179 = (($178>>>0) / 4)&-1;
    $4 = $94;
    $180 = $4;
    $181 = ((($180)) + 12|0);
    $3 = $181;
    $182 = $3;
    $2 = $182;
    $183 = $2;
    $184 = ((($183)) + 4|0);
    $185 = HEAP32[$184>>2]|0;
    __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEEC2EjjS5_($89,$177,$179,$185);
    $186 = ((($94)) + 4|0);
    $187 = HEAP32[$186>>2]|0;
    $5 = $90;
    $6 = $187;
    $188 = $5;
    $189 = $6;
    HEAP32[$188>>2] = $189;
    $190 = ((($94)) + 8|0);
    $191 = HEAP32[$190>>2]|0;
    $7 = $93;
    $8 = $191;
    $192 = $7;
    $193 = $8;
    HEAP32[$192>>2] = $193;
    __THREW__ = 0;
    ;HEAP32[$$byval_copy>>2]=HEAP32[$90>>2]|0;
    ;HEAP32[$$byval_copy1>>2]=HEAP32[$93>>2]|0;
    invoke_viii(65,($89|0),($$byval_copy|0),($$byval_copy1|0));
    $194 = __THREW__; __THREW__ = 0;
    $195 = $194&1;
    if ($195) {
     $248 = ___cxa_find_matching_catch_2()|0;
     $249 = tempRet0;
     $91 = $248;
     $92 = $249;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($89);
     $250 = $91;
     $251 = $92;
     ___resumeException($250|0);
     // unreachable;
    } else {
     $21 = $94;
     $22 = $89;
     $196 = $21;
     $20 = $196;
     $197 = $20;
     $198 = HEAP32[$197>>2]|0;
     HEAP32[$23>>2] = $198;
     $199 = $22;
     $18 = $199;
     $200 = $18;
     $201 = HEAP32[$200>>2]|0;
     $202 = $21;
     HEAP32[$202>>2] = $201;
     $19 = $23;
     $203 = $19;
     $204 = HEAP32[$203>>2]|0;
     $205 = $22;
     HEAP32[$205>>2] = $204;
     $206 = ((($94)) + 4|0);
     $207 = ((($89)) + 4|0);
     $27 = $206;
     $28 = $207;
     $208 = $27;
     $26 = $208;
     $209 = $26;
     $210 = HEAP32[$209>>2]|0;
     HEAP32[$29>>2] = $210;
     $211 = $28;
     $24 = $211;
     $212 = $24;
     $213 = HEAP32[$212>>2]|0;
     $214 = $27;
     HEAP32[$214>>2] = $213;
     $25 = $29;
     $215 = $25;
     $216 = HEAP32[$215>>2]|0;
     $217 = $28;
     HEAP32[$217>>2] = $216;
     $218 = ((($94)) + 8|0);
     $219 = ((($89)) + 8|0);
     $33 = $218;
     $34 = $219;
     $220 = $33;
     $32 = $220;
     $221 = $32;
     $222 = HEAP32[$221>>2]|0;
     HEAP32[$35>>2] = $222;
     $223 = $34;
     $30 = $223;
     $224 = $30;
     $225 = HEAP32[$224>>2]|0;
     $226 = $33;
     HEAP32[$226>>2] = $225;
     $31 = $35;
     $227 = $31;
     $228 = HEAP32[$227>>2]|0;
     $229 = $34;
     HEAP32[$229>>2] = $228;
     $38 = $94;
     $230 = $38;
     $231 = ((($230)) + 12|0);
     $37 = $231;
     $232 = $37;
     $36 = $232;
     $233 = $36;
     $41 = $89;
     $234 = $41;
     $235 = ((($234)) + 12|0);
     $40 = $235;
     $236 = $40;
     $39 = $236;
     $237 = $39;
     $45 = $233;
     $46 = $237;
     $238 = $45;
     $44 = $238;
     $239 = $44;
     $240 = HEAP32[$239>>2]|0;
     HEAP32[$47>>2] = $240;
     $241 = $46;
     $42 = $241;
     $242 = $42;
     $243 = HEAP32[$242>>2]|0;
     $244 = $45;
     HEAP32[$244>>2] = $243;
     $43 = $47;
     $245 = $43;
     $246 = HEAP32[$245>>2]|0;
     $247 = $46;
     HEAP32[$247>>2] = $246;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($89);
     break;
    }
   }
  }
 } while(0);
 $63 = $94;
 $252 = $63;
 $253 = ((($252)) + 12|0);
 $62 = $253;
 $254 = $62;
 $61 = $254;
 $255 = $61;
 $256 = ((($255)) + 4|0);
 $257 = HEAP32[$256>>2]|0;
 $258 = ((($94)) + 8|0);
 $259 = HEAP32[$258>>2]|0;
 $64 = $259;
 $260 = $64;
 $261 = $84;
 $65 = $261;
 $262 = $65;
 $76 = $257;
 $77 = $260;
 $78 = $262;
 $263 = $76;
 $264 = $77;
 $265 = $78;
 $75 = $265;
 $266 = $75;
 ;HEAP8[$74>>0]=HEAP8[$79>>0]|0;
 $71 = $263;
 $72 = $264;
 $73 = $266;
 $267 = $71;
 $268 = $72;
 $269 = $73;
 $70 = $269;
 $270 = $70;
 $67 = $267;
 $68 = $268;
 $69 = $270;
 $271 = $68;
 $272 = $69;
 $66 = $272;
 $273 = $66;
 $274 = HEAP32[$273>>2]|0;
 HEAP32[$271>>2] = $274;
 $275 = ((($94)) + 8|0);
 $276 = HEAP32[$275>>2]|0;
 $277 = ((($276)) + 4|0);
 HEAP32[$275>>2] = $277;
 STACKTOP = sp;return;
}
function __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEE10push_frontERKS2_($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$byval_copy = 0, $$byval_copy1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0;
 var $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0;
 var $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0;
 var $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0;
 var $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0;
 var $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0;
 var $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0;
 var $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0;
 var $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0;
 var $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0;
 var $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0;
 var $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0;
 var $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0;
 var $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 400|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(400|0);
 $$byval_copy1 = sp + 392|0;
 $$byval_copy = sp + 388|0;
 $10 = sp + 8|0;
 $13 = sp + 397|0;
 $26 = sp + 296|0;
 $32 = sp + 272|0;
 $38 = sp + 248|0;
 $50 = sp + 200|0;
 $76 = sp;
 $81 = sp + 396|0;
 $89 = sp + 52|0;
 $90 = sp + 48|0;
 $91 = sp + 28|0;
 $92 = sp + 24|0;
 $95 = sp + 12|0;
 $85 = $0;
 $86 = $1;
 $96 = $85;
 $97 = ((($96)) + 4|0);
 $98 = HEAP32[$97>>2]|0;
 $99 = HEAP32[$96>>2]|0;
 $100 = ($98|0)==($99|0);
 do {
  if ($100) {
   $101 = ((($96)) + 8|0);
   $102 = HEAP32[$101>>2]|0;
   $84 = $96;
   $103 = $84;
   $104 = ((($103)) + 12|0);
   $83 = $104;
   $105 = $83;
   $82 = $105;
   $106 = $82;
   $107 = HEAP32[$106>>2]|0;
   $108 = ($102>>>0)<($107>>>0);
   if ($108) {
    $63 = $96;
    $109 = $63;
    $110 = ((($109)) + 12|0);
    $62 = $110;
    $111 = $62;
    $61 = $111;
    $112 = $61;
    $113 = HEAP32[$112>>2]|0;
    $114 = ((($96)) + 8|0);
    $115 = HEAP32[$114>>2]|0;
    $116 = $113;
    $117 = $115;
    $118 = (($116) - ($117))|0;
    $119 = (($118|0) / 4)&-1;
    $87 = $119;
    $120 = $87;
    $121 = (($120) + 1)|0;
    $122 = (($121|0) / 2)&-1;
    $87 = $122;
    $123 = ((($96)) + 4|0);
    $124 = HEAP32[$123>>2]|0;
    $125 = ((($96)) + 8|0);
    $126 = HEAP32[$125>>2]|0;
    $127 = ((($96)) + 8|0);
    $128 = HEAP32[$127>>2]|0;
    $129 = $87;
    $130 = (($128) + ($129<<2)|0);
    $58 = $124;
    $59 = $126;
    $60 = $130;
    $131 = $58;
    $57 = $131;
    $132 = $57;
    $133 = $59;
    $51 = $133;
    $134 = $51;
    $135 = $60;
    $52 = $135;
    $136 = $52;
    $53 = $132;
    $54 = $134;
    $55 = $136;
    $137 = $54;
    $138 = $53;
    $139 = $137;
    $140 = $138;
    $141 = (($139) - ($140))|0;
    $142 = (($141|0) / 4)&-1;
    $56 = $142;
    $143 = $56;
    $144 = ($143>>>0)>(0);
    if ($144) {
     $145 = $56;
     $146 = $55;
     $147 = (0 - ($145))|0;
     $148 = (($146) + ($147<<2)|0);
     $55 = $148;
     $149 = $55;
     $150 = $53;
     $151 = $56;
     $152 = $151<<2;
     _memmove(($149|0),($150|0),($152|0))|0;
    }
    $153 = $55;
    $154 = ((($96)) + 4|0);
    HEAP32[$154>>2] = $153;
    $155 = $87;
    $156 = ((($96)) + 8|0);
    $157 = HEAP32[$156>>2]|0;
    $158 = (($157) + ($155<<2)|0);
    HEAP32[$156>>2] = $158;
    break;
   } else {
    $20 = $96;
    $159 = $20;
    $160 = ((($159)) + 12|0);
    $19 = $160;
    $161 = $19;
    $18 = $161;
    $162 = $18;
    $163 = HEAP32[$162>>2]|0;
    $164 = HEAP32[$96>>2]|0;
    $165 = $163;
    $166 = $164;
    $167 = (($165) - ($166))|0;
    $168 = (($167|0) / 4)&-1;
    $169 = $168<<1;
    HEAP32[$89>>2] = $169;
    HEAP32[$90>>2] = 1;
    $11 = $89;
    $12 = $90;
    $170 = $11;
    $171 = $12;
    ;HEAP8[$10>>0]=HEAP8[$13>>0]|0;
    $8 = $170;
    $9 = $171;
    $172 = $8;
    $173 = $9;
    $5 = $10;
    $6 = $172;
    $7 = $173;
    $174 = $6;
    $175 = HEAP32[$174>>2]|0;
    $176 = $7;
    $177 = HEAP32[$176>>2]|0;
    $178 = ($175>>>0)<($177>>>0);
    $179 = $9;
    $180 = $8;
    $181 = $178 ? $179 : $180;
    $182 = HEAP32[$181>>2]|0;
    $88 = $182;
    $183 = $88;
    $184 = $88;
    $185 = (($184) + 3)|0;
    $186 = (($185>>>0) / 4)&-1;
    $4 = $96;
    $187 = $4;
    $188 = ((($187)) + 12|0);
    $3 = $188;
    $189 = $3;
    $2 = $189;
    $190 = $2;
    $191 = ((($190)) + 4|0);
    $192 = HEAP32[$191>>2]|0;
    __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEEC2EjjS5_($91,$183,$186,$192);
    $193 = ((($96)) + 4|0);
    $194 = HEAP32[$193>>2]|0;
    $14 = $92;
    $15 = $194;
    $195 = $14;
    $196 = $15;
    HEAP32[$195>>2] = $196;
    $197 = ((($96)) + 8|0);
    $198 = HEAP32[$197>>2]|0;
    $16 = $95;
    $17 = $198;
    $199 = $16;
    $200 = $17;
    HEAP32[$199>>2] = $200;
    __THREW__ = 0;
    ;HEAP32[$$byval_copy>>2]=HEAP32[$92>>2]|0;
    ;HEAP32[$$byval_copy1>>2]=HEAP32[$95>>2]|0;
    invoke_viii(65,($91|0),($$byval_copy|0),($$byval_copy1|0));
    $201 = __THREW__; __THREW__ = 0;
    $202 = $201&1;
    if ($202) {
     $255 = ___cxa_find_matching_catch_2()|0;
     $256 = tempRet0;
     $93 = $255;
     $94 = $256;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($91);
     $257 = $93;
     $258 = $94;
     ___resumeException($257|0);
     // unreachable;
    } else {
     $24 = $96;
     $25 = $91;
     $203 = $24;
     $23 = $203;
     $204 = $23;
     $205 = HEAP32[$204>>2]|0;
     HEAP32[$26>>2] = $205;
     $206 = $25;
     $21 = $206;
     $207 = $21;
     $208 = HEAP32[$207>>2]|0;
     $209 = $24;
     HEAP32[$209>>2] = $208;
     $22 = $26;
     $210 = $22;
     $211 = HEAP32[$210>>2]|0;
     $212 = $25;
     HEAP32[$212>>2] = $211;
     $213 = ((($96)) + 4|0);
     $214 = ((($91)) + 4|0);
     $30 = $213;
     $31 = $214;
     $215 = $30;
     $29 = $215;
     $216 = $29;
     $217 = HEAP32[$216>>2]|0;
     HEAP32[$32>>2] = $217;
     $218 = $31;
     $27 = $218;
     $219 = $27;
     $220 = HEAP32[$219>>2]|0;
     $221 = $30;
     HEAP32[$221>>2] = $220;
     $28 = $32;
     $222 = $28;
     $223 = HEAP32[$222>>2]|0;
     $224 = $31;
     HEAP32[$224>>2] = $223;
     $225 = ((($96)) + 8|0);
     $226 = ((($91)) + 8|0);
     $36 = $225;
     $37 = $226;
     $227 = $36;
     $35 = $227;
     $228 = $35;
     $229 = HEAP32[$228>>2]|0;
     HEAP32[$38>>2] = $229;
     $230 = $37;
     $33 = $230;
     $231 = $33;
     $232 = HEAP32[$231>>2]|0;
     $233 = $36;
     HEAP32[$233>>2] = $232;
     $34 = $38;
     $234 = $34;
     $235 = HEAP32[$234>>2]|0;
     $236 = $37;
     HEAP32[$236>>2] = $235;
     $41 = $96;
     $237 = $41;
     $238 = ((($237)) + 12|0);
     $40 = $238;
     $239 = $40;
     $39 = $239;
     $240 = $39;
     $44 = $91;
     $241 = $44;
     $242 = ((($241)) + 12|0);
     $43 = $242;
     $243 = $43;
     $42 = $243;
     $244 = $42;
     $48 = $240;
     $49 = $244;
     $245 = $48;
     $47 = $245;
     $246 = $47;
     $247 = HEAP32[$246>>2]|0;
     HEAP32[$50>>2] = $247;
     $248 = $49;
     $45 = $248;
     $249 = $45;
     $250 = HEAP32[$249>>2]|0;
     $251 = $48;
     HEAP32[$251>>2] = $250;
     $46 = $50;
     $252 = $46;
     $253 = HEAP32[$252>>2]|0;
     $254 = $49;
     HEAP32[$254>>2] = $253;
     __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($91);
     break;
    }
   }
  }
 } while(0);
 $66 = $96;
 $259 = $66;
 $260 = ((($259)) + 12|0);
 $65 = $260;
 $261 = $65;
 $64 = $261;
 $262 = $64;
 $263 = ((($262)) + 4|0);
 $264 = HEAP32[$263>>2]|0;
 $265 = ((($96)) + 4|0);
 $266 = HEAP32[$265>>2]|0;
 $267 = ((($266)) + -4|0);
 $67 = $267;
 $268 = $67;
 $269 = $86;
 $78 = $264;
 $79 = $268;
 $80 = $269;
 $270 = $78;
 $271 = $79;
 $272 = $80;
 $77 = $272;
 $273 = $77;
 ;HEAP8[$76>>0]=HEAP8[$81>>0]|0;
 $73 = $270;
 $74 = $271;
 $75 = $273;
 $274 = $73;
 $275 = $74;
 $276 = $75;
 $72 = $276;
 $277 = $72;
 $69 = $274;
 $70 = $275;
 $71 = $277;
 $278 = $70;
 $279 = $71;
 $68 = $279;
 $280 = $68;
 $281 = HEAP32[$280>>2]|0;
 HEAP32[$278>>2] = $281;
 $282 = ((($96)) + 4|0);
 $283 = HEAP32[$282>>2]|0;
 $284 = ((($283)) + -4|0);
 HEAP32[$282>>2] = $284;
 STACKTOP = sp;return;
}
function __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEED2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0;
 var $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0;
 var $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0;
 var $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0;
 var $82 = 0, $83 = 0, $84 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 144|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(144|0);
 $19 = sp + 8|0;
 $22 = sp + 133|0;
 $29 = sp;
 $32 = sp + 132|0;
 $34 = $0;
 $35 = $34;
 $33 = $35;
 $36 = $33;
 $37 = ((($36)) + 4|0);
 $38 = HEAP32[$37>>2]|0;
 $30 = $36;
 $31 = $38;
 $39 = $30;
 $40 = $31;
 ;HEAP8[$29>>0]=HEAP8[$32>>0]|0;
 $27 = $39;
 $28 = $40;
 $41 = $27;
 while(1) {
  $42 = $28;
  $43 = ((($41)) + 8|0);
  $44 = HEAP32[$43>>2]|0;
  $45 = ($42|0)!=($44|0);
  if (!($45)) {
   break;
  }
  $26 = $41;
  $46 = $26;
  $47 = ((($46)) + 12|0);
  $25 = $47;
  $48 = $25;
  $24 = $48;
  $49 = $24;
  $50 = ((($49)) + 4|0);
  $51 = HEAP32[$50>>2]|0;
  $52 = ((($41)) + 8|0);
  $53 = HEAP32[$52>>2]|0;
  $54 = ((($53)) + -4|0);
  HEAP32[$52>>2] = $54;
  $23 = $54;
  $55 = $23;
  $20 = $51;
  $21 = $55;
  $56 = $20;
  $57 = $21;
  ;HEAP8[$19>>0]=HEAP8[$22>>0]|0;
  $17 = $56;
  $18 = $57;
  $58 = $17;
  $59 = $18;
  $15 = $58;
  $16 = $59;
 }
 $60 = HEAP32[$35>>2]|0;
 $61 = ($60|0)!=(0|0);
 if (!($61)) {
  STACKTOP = sp;return;
 }
 $14 = $35;
 $62 = $14;
 $63 = ((($62)) + 12|0);
 $13 = $63;
 $64 = $13;
 $12 = $64;
 $65 = $12;
 $66 = ((($65)) + 4|0);
 $67 = HEAP32[$66>>2]|0;
 $68 = HEAP32[$35>>2]|0;
 $4 = $35;
 $69 = $4;
 $3 = $69;
 $70 = $3;
 $71 = ((($70)) + 12|0);
 $2 = $71;
 $72 = $2;
 $1 = $72;
 $73 = $1;
 $74 = HEAP32[$73>>2]|0;
 $75 = HEAP32[$69>>2]|0;
 $76 = $74;
 $77 = $75;
 $78 = (($76) - ($77))|0;
 $79 = (($78|0) / 4)&-1;
 $9 = $67;
 $10 = $68;
 $11 = $79;
 $80 = $9;
 $81 = $10;
 $82 = $11;
 $6 = $80;
 $7 = $81;
 $8 = $82;
 $83 = $7;
 $5 = $83;
 $84 = $5;
 __ZdlPv($84);
 STACKTOP = sp;return;
}
function __ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEE18__construct_at_endINS_13move_iteratorIPS2_EEEENS_9enable_ifIXsr21__is_forward_iteratorIT_EE5valueEvE4typeESC_SC_($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0;
 var $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0;
 var $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0;
 var $66 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 112|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(112|0);
 $17 = sp;
 $22 = sp + 100|0;
 $27 = $0;
 $29 = $27;
 $26 = $29;
 $30 = $26;
 $31 = ((($30)) + 12|0);
 $25 = $31;
 $32 = $25;
 $24 = $32;
 $33 = $24;
 $34 = ((($33)) + 4|0);
 $35 = HEAP32[$34>>2]|0;
 $28 = $35;
 while(1) {
  $5 = $1;
  $6 = $2;
  $36 = $5;
  $4 = $36;
  $37 = $4;
  $38 = HEAP32[$37>>2]|0;
  $39 = $6;
  $3 = $39;
  $40 = $3;
  $41 = HEAP32[$40>>2]|0;
  $42 = ($38|0)!=($41|0);
  if (!($42)) {
   break;
  }
  $43 = $28;
  $44 = ((($29)) + 8|0);
  $45 = HEAP32[$44>>2]|0;
  $7 = $45;
  $46 = $7;
  $8 = $1;
  $47 = $8;
  $48 = HEAP32[$47>>2]|0;
  $19 = $43;
  $20 = $46;
  $21 = $48;
  $49 = $19;
  $50 = $20;
  $51 = $21;
  $18 = $51;
  $52 = $18;
  ;HEAP8[$17>>0]=HEAP8[$22>>0]|0;
  $14 = $49;
  $15 = $50;
  $16 = $52;
  $53 = $14;
  $54 = $15;
  $55 = $16;
  $13 = $55;
  $56 = $13;
  $10 = $53;
  $11 = $54;
  $12 = $56;
  $57 = $11;
  $58 = $12;
  $9 = $58;
  $59 = $9;
  $60 = HEAP32[$59>>2]|0;
  HEAP32[$57>>2] = $60;
  $61 = ((($29)) + 8|0);
  $62 = HEAP32[$61>>2]|0;
  $63 = ((($62)) + 4|0);
  HEAP32[$61>>2] = $63;
  $23 = $1;
  $64 = $23;
  $65 = HEAP32[$64>>2]|0;
  $66 = ((($65)) + 4|0);
  HEAP32[$64>>2] = $66;
 }
 STACKTOP = sp;return;
}
function __ZN7MessageC2EOS_($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $3 = 0;
 var $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(48|0);
 $10 = $0;
 $11 = $1;
 $12 = $10;
 $13 = $11;
 $8 = $12;
 $9 = $13;
 $14 = $8;
 $15 = $9;
 $7 = $15;
 $16 = $7;
 ;HEAP32[$14>>2]=HEAP32[$16>>2]|0;HEAP32[$14+4>>2]=HEAP32[$16+4>>2]|0;HEAP32[$14+8>>2]=HEAP32[$16+8>>2]|0;
 $17 = $9;
 $4 = $17;
 $18 = $4;
 $3 = $18;
 $19 = $3;
 $2 = $19;
 $20 = $2;
 $5 = $20;
 $6 = 0;
 while(1) {
  $21 = $6;
  $22 = ($21>>>0)<(3);
  if (!($22)) {
   break;
  }
  $23 = $5;
  $24 = $6;
  $25 = (($23) + ($24<<2)|0);
  HEAP32[$25>>2] = 0;
  $26 = $6;
  $27 = (($26) + 1)|0;
  $6 = $27;
 }
 STACKTOP = sp;return;
}
function __ZZ3popvENK3__0clEv($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 32|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(32|0);
 $5 = $0;
 $4 = 7316;
 $6 = $4;
 $3 = $6;
 $7 = $3;
 $8 = ((($7)) + 20|0);
 $2 = $8;
 $9 = $2;
 $1 = $9;
 $10 = $1;
 $11 = HEAP32[$10>>2]|0;
 $12 = ($11|0)==(0);
 $13 = $12 ^ 1;
 STACKTOP = sp;return ($13|0);
}
function __ZNSt3__214__thread_proxyINS_5tupleIJNS_10unique_ptrINS_15__thread_structENS_14default_deleteIS3_EEEEPFvvEEEEEEPvSA_($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0;
 var $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0;
 var $135 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0;
 var $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0;
 var $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0;
 var $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0;
 var $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 240|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(240|0);
 $7 = sp;
 $48 = sp + 44|0;
 $51 = sp + 32|0;
 $54 = sp + 20|0;
 $56 = sp + 12|0;
 $59 = sp + 232|0;
 $55 = $0;
 $60 = $55;
 $53 = $56;
 HEAP32[$54>>2] = $60;
 $61 = $53;
 $52 = $54;
 $62 = $52;
 $63 = HEAP32[$62>>2]|0;
 $50 = $61;
 HEAP32[$51>>2] = $63;
 $64 = $50;
 $49 = $51;
 $65 = $49;
 $66 = HEAP32[$65>>2]|0;
 $47 = $64;
 HEAP32[$48>>2] = $66;
 $67 = $47;
 $46 = $48;
 $68 = $46;
 $69 = HEAP32[$68>>2]|0;
 HEAP32[$67>>2] = $69;
 __THREW__ = 0;
 $70 = (invoke_i(70)|0);
 $71 = __THREW__; __THREW__ = 0;
 $72 = $71&1;
 if (!($72)) {
  $33 = $56;
  $73 = $33;
  $32 = $73;
  $74 = $32;
  $31 = $74;
  $75 = $31;
  $76 = HEAP32[$75>>2]|0;
  $30 = $76;
  $77 = $30;
  $29 = $77;
  $78 = $29;
  $15 = $78;
  $79 = $15;
  $14 = $79;
  $80 = $14;
  $13 = $80;
  $81 = $13;
  $82 = HEAP32[$81>>2]|0;
  $16 = $82;
  $12 = $79;
  $83 = $12;
  $11 = $83;
  $84 = $11;
  HEAP32[$84>>2] = 0;
  $85 = $16;
  __THREW__ = 0;
  invoke_vii(71,($70|0),($85|0));
  $86 = __THREW__; __THREW__ = 0;
  $87 = $86&1;
  if (!($87)) {
   $10 = $56;
   $88 = $10;
   $9 = $88;
   $89 = $9;
   $8 = $89;
   $90 = $8;
   $91 = HEAP32[$90>>2]|0;
   ;HEAP8[$7>>0]=HEAP8[$59>>0]|0;
   $6 = $91;
   $92 = $6;
   $5 = $92;
   $93 = $5;
   $94 = ((($93)) + 4|0);
   $4 = $94;
   $95 = $4;
   $1 = $95;
   $96 = $1;
   $3 = $96;
   $97 = $3;
   $2 = $97;
   $98 = $2;
   $99 = HEAP32[$98>>2]|0;
   __THREW__ = 0;
   invoke_v($99|0);
   $100 = __THREW__; __THREW__ = 0;
   $101 = $100&1;
   if (!($101)) {
    $28 = $56;
    $102 = $28;
    $25 = $102;
    $26 = 0;
    $103 = $25;
    $24 = $103;
    $104 = $24;
    $23 = $104;
    $105 = $23;
    $106 = HEAP32[$105>>2]|0;
    $27 = $106;
    $107 = $26;
    $20 = $103;
    $108 = $20;
    $19 = $108;
    $109 = $19;
    HEAP32[$109>>2] = $107;
    $110 = $27;
    $111 = ($110|0)!=(0|0);
    if (!($111)) {
     STACKTOP = sp;return (0|0);
    }
    $18 = $103;
    $112 = $18;
    $17 = $112;
    $113 = $17;
    $114 = $27;
    $21 = $113;
    $22 = $114;
    $115 = $22;
    $116 = ($115|0)==(0|0);
    if ($116) {
     STACKTOP = sp;return (0|0);
    }
    __ZNSt3__25tupleIJNS_10unique_ptrINS_15__thread_structENS_14default_deleteIS2_EEEEPFvvEEED2Ev($115);
    __ZdlPv($115);
    STACKTOP = sp;return (0|0);
   }
  }
 }
 $117 = ___cxa_find_matching_catch_2()|0;
 $118 = tempRet0;
 $57 = $117;
 $58 = $118;
 $45 = $56;
 $119 = $45;
 $42 = $119;
 $43 = 0;
 $120 = $42;
 $41 = $120;
 $121 = $41;
 $40 = $121;
 $122 = $40;
 $123 = HEAP32[$122>>2]|0;
 $44 = $123;
 $124 = $43;
 $37 = $120;
 $125 = $37;
 $36 = $125;
 $126 = $36;
 HEAP32[$126>>2] = $124;
 $127 = $44;
 $128 = ($127|0)!=(0|0);
 if (!($128)) {
  $134 = $57;
  $135 = $58;
  ___resumeException($134|0);
  // unreachable;
 }
 $35 = $120;
 $129 = $35;
 $34 = $129;
 $130 = $34;
 $131 = $44;
 $38 = $130;
 $39 = $131;
 $132 = $39;
 $133 = ($132|0)==(0|0);
 if ($133) {
  $134 = $57;
  $135 = $58;
  ___resumeException($134|0);
  // unreachable;
 }
 __ZNSt3__25tupleIJNS_10unique_ptrINS_15__thread_structENS_14default_deleteIS2_EEEEPFvvEEED2Ev($132);
 __ZdlPv($132);
 $134 = $57;
 $135 = $58;
 ___resumeException($134|0);
 // unreachable;
 return (0)|0;
}
function __ZNSt3__221__thread_specific_ptrINS_15__thread_structEE11set_pointerEPS1_($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $4 = $0;
 $5 = $1;
 $6 = $4;
 $7 = HEAP32[$6>>2]|0;
 $8 = $5;
 $2 = $7;
 $3 = $8;
 $9 = $2;
 $10 = $3;
 (_pthread_setspecific($9,$10)|0);
 STACKTOP = sp;return;
}
function __ZNSt3__25tupleIJNS_10unique_ptrINS_15__thread_structENS_14default_deleteIS2_EEEEPFvvEEED2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = $1;
 __ZNSt3__212__tuple_implINS_15__tuple_indicesIJLj0ELj1EEEEJNS_10unique_ptrINS_15__thread_structENS_14default_deleteIS4_EEEEPFvvEEED2Ev($2);
 STACKTOP = sp;return;
}
function __ZNSt3__212__tuple_implINS_15__tuple_indicesIJLj0ELj1EEEEJNS_10unique_ptrINS_15__thread_structENS_14default_deleteIS4_EEEEPFvvEEED2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = $1;
 __ZNSt3__212__tuple_leafILj0ENS_10unique_ptrINS_15__thread_structENS_14default_deleteIS2_EEEELb0EED2Ev($2);
 STACKTOP = sp;return;
}
function __ZNSt3__212__tuple_leafILj0ENS_10unique_ptrINS_15__thread_structENS_14default_deleteIS2_EEEELb0EED2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0;
 var $28 = 0, $29 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 64|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(64|0);
 $13 = $0;
 $14 = $13;
 $12 = $14;
 $15 = $12;
 $9 = $15;
 $10 = 0;
 $16 = $9;
 $8 = $16;
 $17 = $8;
 $7 = $17;
 $18 = $7;
 $19 = HEAP32[$18>>2]|0;
 $11 = $19;
 $20 = $10;
 $4 = $16;
 $21 = $4;
 $3 = $21;
 $22 = $3;
 HEAP32[$22>>2] = $20;
 $23 = $11;
 $24 = ($23|0)!=(0|0);
 if (!($24)) {
  STACKTOP = sp;return;
 }
 $2 = $16;
 $25 = $2;
 $1 = $25;
 $26 = $1;
 $27 = $11;
 $5 = $26;
 $6 = $27;
 $28 = $6;
 $29 = ($28|0)==(0|0);
 if ($29) {
  STACKTOP = sp;return;
 }
 __ZNSt3__215__thread_structD2Ev($28);
 __ZdlPv($28);
 STACKTOP = sp;return;
}
function __GLOBAL__sub_I_test_cpp() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 ___cxx_global_var_init();
 ___cxx_global_var_init_1();
 ___cxx_global_var_init_2();
 return;
}
function __GLOBAL__sub_I_bind_cpp() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 ___cxx_global_var_init_3();
 return;
}
function ___cxx_global_var_init_3() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZN53EmscriptenBindingInitializer_native_and_builtin_typesC2Ev(10604);
 return;
}
function __ZN53EmscriptenBindingInitializer_native_and_builtin_typesC2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDIvE3getEv()|0);
 __embind_register_void(($2|0),(1457|0));
 $3 = (__ZN10emscripten8internal6TypeIDIbE3getEv()|0);
 __embind_register_bool(($3|0),(1462|0),1,1,0);
 __ZN12_GLOBAL__N_1L16register_integerIcEEvPKc(1467);
 __ZN12_GLOBAL__N_1L16register_integerIaEEvPKc(1472);
 __ZN12_GLOBAL__N_1L16register_integerIhEEvPKc(1484);
 __ZN12_GLOBAL__N_1L16register_integerIsEEvPKc(1498);
 __ZN12_GLOBAL__N_1L16register_integerItEEvPKc(1504);
 __ZN12_GLOBAL__N_1L16register_integerIiEEvPKc(1519);
 __ZN12_GLOBAL__N_1L16register_integerIjEEvPKc(1523);
 __ZN12_GLOBAL__N_1L16register_integerIlEEvPKc(1536);
 __ZN12_GLOBAL__N_1L16register_integerImEEvPKc(1541);
 __ZN12_GLOBAL__N_1L14register_floatIfEEvPKc(1555);
 __ZN12_GLOBAL__N_1L14register_floatIdEEvPKc(1561);
 $4 = (__ZN10emscripten8internal6TypeIDINSt3__212basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEEE3getEv()|0);
 __embind_register_std_string(($4|0),(1568|0));
 $5 = (__ZN10emscripten8internal6TypeIDINSt3__212basic_stringIhNS2_11char_traitsIhEENS2_9allocatorIhEEEEE3getEv()|0);
 __embind_register_std_string(($5|0),(1580|0));
 $6 = (__ZN10emscripten8internal6TypeIDINSt3__212basic_stringIwNS2_11char_traitsIwEENS2_9allocatorIwEEEEE3getEv()|0);
 __embind_register_std_wstring(($6|0),4,(1613|0));
 $7 = (__ZN10emscripten8internal6TypeIDINS_3valEE3getEv()|0);
 __embind_register_emval(($7|0),(1626|0));
 __ZN12_GLOBAL__N_1L20register_memory_viewIcEEvPKc(1642);
 __ZN12_GLOBAL__N_1L20register_memory_viewIaEEvPKc(1672);
 __ZN12_GLOBAL__N_1L20register_memory_viewIhEEvPKc(1709);
 __ZN12_GLOBAL__N_1L20register_memory_viewIsEEvPKc(1748);
 __ZN12_GLOBAL__N_1L20register_memory_viewItEEvPKc(1779);
 __ZN12_GLOBAL__N_1L20register_memory_viewIiEEvPKc(1819);
 __ZN12_GLOBAL__N_1L20register_memory_viewIjEEvPKc(1848);
 __ZN12_GLOBAL__N_1L20register_memory_viewIlEEvPKc(1886);
 __ZN12_GLOBAL__N_1L20register_memory_viewImEEvPKc(1916);
 __ZN12_GLOBAL__N_1L20register_memory_viewIaEEvPKc(1955);
 __ZN12_GLOBAL__N_1L20register_memory_viewIhEEvPKc(1987);
 __ZN12_GLOBAL__N_1L20register_memory_viewIsEEvPKc(2020);
 __ZN12_GLOBAL__N_1L20register_memory_viewItEEvPKc(2053);
 __ZN12_GLOBAL__N_1L20register_memory_viewIiEEvPKc(2087);
 __ZN12_GLOBAL__N_1L20register_memory_viewIjEEvPKc(2120);
 __ZN12_GLOBAL__N_1L20register_memory_viewIfEEvPKc(2154);
 __ZN12_GLOBAL__N_1L20register_memory_viewIdEEvPKc(2185);
 __ZN12_GLOBAL__N_1L20register_memory_viewIeEEvPKc(2217);
 STACKTOP = sp;return;
}
function __ZN10emscripten8internal6TypeIDIvE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIvE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal6TypeIDIbE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIbE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_1L16register_integerIcEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDIcE3getEv()|0);
 $3 = $1;
 $4 = -128 << 24 >> 24;
 $5 = 127 << 24 >> 24;
 __embind_register_integer(($2|0),($3|0),1,($4|0),($5|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L16register_integerIaEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDIaE3getEv()|0);
 $3 = $1;
 $4 = -128 << 24 >> 24;
 $5 = 127 << 24 >> 24;
 __embind_register_integer(($2|0),($3|0),1,($4|0),($5|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L16register_integerIhEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDIhE3getEv()|0);
 $3 = $1;
 $4 = 0;
 $5 = 255;
 __embind_register_integer(($2|0),($3|0),1,($4|0),($5|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L16register_integerIsEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDIsE3getEv()|0);
 $3 = $1;
 $4 = -32768 << 16 >> 16;
 $5 = 32767 << 16 >> 16;
 __embind_register_integer(($2|0),($3|0),2,($4|0),($5|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L16register_integerItEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDItE3getEv()|0);
 $3 = $1;
 $4 = 0;
 $5 = 65535;
 __embind_register_integer(($2|0),($3|0),2,($4|0),($5|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L16register_integerIiEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDIiE3getEv()|0);
 $3 = $1;
 __embind_register_integer(($2|0),($3|0),4,-2147483648,2147483647);
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L16register_integerIjEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDIjE3getEv()|0);
 $3 = $1;
 __embind_register_integer(($2|0),($3|0),4,0,-1);
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L16register_integerIlEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDIlE3getEv()|0);
 $3 = $1;
 __embind_register_integer(($2|0),($3|0),4,-2147483648,2147483647);
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L16register_integerImEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDImE3getEv()|0);
 $3 = $1;
 __embind_register_integer(($2|0),($3|0),4,0,-1);
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L14register_floatIfEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDIfE3getEv()|0);
 $3 = $1;
 __embind_register_float(($2|0),($3|0),4);
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L14register_floatIdEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDIdE3getEv()|0);
 $3 = $1;
 __embind_register_float(($2|0),($3|0),8);
 STACKTOP = sp;return;
}
function __ZN10emscripten8internal6TypeIDINSt3__212basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINSt3__212basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEEE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal6TypeIDINSt3__212basic_stringIhNS2_11char_traitsIhEENS2_9allocatorIhEEEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINSt3__212basic_stringIhNS2_11char_traitsIhEENS2_9allocatorIhEEEEE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal6TypeIDINSt3__212basic_stringIwNS2_11char_traitsIwEENS2_9allocatorIwEEEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINSt3__212basic_stringIwNS2_11char_traitsIwEENS2_9allocatorIwEEEEE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal6TypeIDINS_3valEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_3valEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_1L20register_memory_viewIcEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewIcEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexIcEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewIaEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewIaEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexIaEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewIhEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewIhEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexIhEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewIsEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewIsEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexIsEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewItEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewItEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexItEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewIiEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewIiEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexIiEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewIjEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewIjEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexIjEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewIlEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewIlEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexIlEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewImEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewImEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexImEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewIfEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewIfEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexIfEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewIdEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewIdEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexIdEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN12_GLOBAL__N_1L20register_memory_viewIeEEvPKc($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = $0;
 $2 = (__ZN10emscripten8internal6TypeIDINS_11memory_viewIeEEE3getEv()|0);
 $3 = (__ZN12_GLOBAL__N_118getTypedArrayIndexIeEENS_15TypedArrayIndexEv()|0);
 $4 = $1;
 __embind_register_memory_view(($2|0),($3|0),($4|0));
 STACKTOP = sp;return;
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewIeEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewIeEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexIeEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 7;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewIeEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (24|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewIdEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewIdEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexIdEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 7;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewIdEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (32|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewIfEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewIfEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexIfEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 6;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewIfEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (40|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewImEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewImEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexImEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 5;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewImEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (48|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewIlEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewIlEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexIlEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 4;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewIlEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (56|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewIjEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewIjEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexIjEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 5;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewIjEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (64|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewIiEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewIiEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexIiEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 4;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewIiEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (72|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewItEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewItEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexItEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 3;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewItEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (80|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewIsEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewIsEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexIsEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 2;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewIsEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (88|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewIhEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewIhEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexIhEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 1;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewIhEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (96|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewIaEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewIaEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexIaEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 0;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewIaEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (104|0);
}
function __ZN10emscripten8internal6TypeIDINS_11memory_viewIcEEE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDINS_11memory_viewIcEEE3getEv()|0);
 return ($0|0);
}
function __ZN12_GLOBAL__N_118getTypedArrayIndexIcEENS_15TypedArrayIndexEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 0;
}
function __ZN10emscripten8internal11LightTypeIDINS_11memory_viewIcEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (112|0);
}
function __ZN10emscripten8internal11LightTypeIDINS_3valEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (120|0);
}
function __ZN10emscripten8internal11LightTypeIDINSt3__212basic_stringIwNS2_11char_traitsIwEENS2_9allocatorIwEEEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (128|0);
}
function __ZN10emscripten8internal11LightTypeIDINSt3__212basic_stringIhNS2_11char_traitsIhEENS2_9allocatorIhEEEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (160|0);
}
function __ZN10emscripten8internal11LightTypeIDINSt3__212basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEEE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (184|0);
}
function __ZN10emscripten8internal6TypeIDIdE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIdE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDIdE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (552|0);
}
function __ZN10emscripten8internal6TypeIDIfE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIfE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDIfE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (544|0);
}
function __ZN10emscripten8internal6TypeIDImE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDImE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDImE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (536|0);
}
function __ZN10emscripten8internal6TypeIDIlE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIlE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDIlE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (528|0);
}
function __ZN10emscripten8internal6TypeIDIjE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIjE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDIjE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (520|0);
}
function __ZN10emscripten8internal6TypeIDIiE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIiE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDIiE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (512|0);
}
function __ZN10emscripten8internal6TypeIDItE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDItE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDItE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (504|0);
}
function __ZN10emscripten8internal6TypeIDIsE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIsE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDIsE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (496|0);
}
function __ZN10emscripten8internal6TypeIDIhE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIhE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDIhE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (480|0);
}
function __ZN10emscripten8internal6TypeIDIaE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIaE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDIaE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (488|0);
}
function __ZN10emscripten8internal6TypeIDIcE3getEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10emscripten8internal11LightTypeIDIcE3getEv()|0);
 return ($0|0);
}
function __ZN10emscripten8internal11LightTypeIDIcE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (472|0);
}
function __ZN10emscripten8internal11LightTypeIDIbE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (464|0);
}
function __ZN10emscripten8internal11LightTypeIDIvE3getEv() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (456|0);
}
function ___getTypeName($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $2 = $0;
 $3 = $2;
 $1 = $3;
 $4 = $1;
 $5 = ((($4)) + 4|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = (___strdup($6)|0);
 STACKTOP = sp;return ($7|0);
}
function _malloc($0) {
 $0 = $0|0;
 var $$$0172$i = 0, $$$0173$i = 0, $$$4230$i = 0, $$$4236$i = 0, $$$4329$i = 0, $$$i = 0, $$0$i = 0, $$0$i$i = 0, $$0$i$i$i = 0, $$0$i17$i = 0, $$01$i$i = 0, $$0172$lcssa$i = 0, $$01726$i = 0, $$0173$lcssa$i = 0, $$01735$i = 0, $$0193 = 0, $$0195 = 0, $$0201$i$i = 0, $$0202$i$i = 0, $$0206$i$i = 0;
 var $$0207$i$i = 0, $$024362$i = 0, $$0260$i$i = 0, $$0261$i$i = 0, $$0262$i$i = 0, $$0268$i$i = 0, $$0269$i$i = 0, $$0320$i = 0, $$0322$i = 0, $$0323$i = 0, $$0325$i = 0, $$0331$i = 0, $$0336$i = 0, $$0337$$i = 0, $$0337$i = 0, $$0339$i = 0, $$0340$i = 0, $$0345$i = 0, $$1 = 0, $$1176$i = 0;
 var $$1178$i = 0, $$124461$i = 0, $$1264$i$i = 0, $$1266$i$i = 0, $$1321$i = 0, $$1326$i = 0, $$1341$i = 0, $$1347$i = 0, $$1351$i = 0, $$2 = 0, $$2234243136$i = 0, $$2247$ph$i = 0, $$2253$ph$i = 0, $$2333$i = 0, $$3$i = 0, $$3$i$i = 0, $$3$i196 = 0, $$3229$i = 0, $$3235$i = 0, $$3328$i = 0;
 var $$3349$i = 0, $$4$lcssa$i = 0, $$4$ph$i = 0, $$411$i = 0, $$4230$i = 0, $$4236$i = 0, $$4329$lcssa$i = 0, $$432910$i = 0, $$4335$$4$i = 0, $$4335$ph$i = 0, $$43359$i = 0, $$7$i = 0, $$7239$i = 0, $$pre = 0, $$pre$i = 0, $$pre$i$i = 0, $$pre$i18$i = 0, $$pre$i205 = 0, $$pre$phi$i$iZ2D = 0, $$pre$phi$i19$iZ2D = 0;
 var $$pre$phi$i206Z2D = 0, $$pre$phi$iZ2D = 0, $$pre$phiZ2D = 0, $$sink1$i = 0, $$sink1$i$i = 0, $$sink14$i = 0, $$sink2$i = 0, $$sink2$i199 = 0, $$sink3$i = 0, $1 = 0, $10 = 0, $100 = 0, $1000 = 0, $1001 = 0, $1002 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0;
 var $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0;
 var $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0;
 var $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0;
 var $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0;
 var $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0;
 var $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0;
 var $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0;
 var $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0;
 var $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0;
 var $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0, $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0;
 var $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0, $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0;
 var $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0, $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0;
 var $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0, $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0;
 var $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0, $35 = 0, $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0;
 var $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0, $366 = 0, $367 = 0, $368 = 0, $369 = 0, $37 = 0, $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0, $376 = 0;
 var $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0, $381 = 0, $382 = 0, $383 = 0, $384 = 0, $385 = 0, $386 = 0, $387 = 0, $388 = 0, $389 = 0, $39 = 0, $390 = 0, $391 = 0, $392 = 0, $393 = 0, $394 = 0;
 var $395 = 0, $396 = 0, $397 = 0, $398 = 0, $399 = 0, $4 = 0, $40 = 0, $400 = 0, $401 = 0, $402 = 0, $403 = 0, $404 = 0, $405 = 0, $406 = 0, $407 = 0, $408 = 0, $409 = 0, $41 = 0, $410 = 0, $411 = 0;
 var $412 = 0, $413 = 0, $414 = 0, $415 = 0, $416 = 0, $417 = 0, $418 = 0, $419 = 0, $42 = 0, $420 = 0, $421 = 0, $422 = 0, $423 = 0, $424 = 0, $425 = 0, $426 = 0, $427 = 0, $428 = 0, $429 = 0, $43 = 0;
 var $430 = 0, $431 = 0, $432 = 0, $433 = 0, $434 = 0, $435 = 0, $436 = 0, $437 = 0, $438 = 0, $439 = 0, $44 = 0, $440 = 0, $441 = 0, $442 = 0, $443 = 0, $444 = 0, $445 = 0, $446 = 0, $447 = 0, $448 = 0;
 var $449 = 0, $45 = 0, $450 = 0, $451 = 0, $452 = 0, $453 = 0, $454 = 0, $455 = 0, $456 = 0, $457 = 0, $458 = 0, $459 = 0, $46 = 0, $460 = 0, $461 = 0, $462 = 0, $463 = 0, $464 = 0, $465 = 0, $466 = 0;
 var $467 = 0, $468 = 0, $469 = 0, $47 = 0, $470 = 0, $471 = 0, $472 = 0, $473 = 0, $474 = 0, $475 = 0, $476 = 0, $477 = 0, $478 = 0, $479 = 0, $48 = 0, $480 = 0, $481 = 0, $482 = 0, $483 = 0, $484 = 0;
 var $485 = 0, $486 = 0, $487 = 0, $488 = 0, $489 = 0, $49 = 0, $490 = 0, $491 = 0, $492 = 0, $493 = 0, $494 = 0, $495 = 0, $496 = 0, $497 = 0, $498 = 0, $499 = 0, $5 = 0, $50 = 0, $500 = 0, $501 = 0;
 var $502 = 0, $503 = 0, $504 = 0, $505 = 0, $506 = 0, $507 = 0, $508 = 0, $509 = 0, $51 = 0, $510 = 0, $511 = 0, $512 = 0, $513 = 0, $514 = 0, $515 = 0, $516 = 0, $517 = 0, $518 = 0, $519 = 0, $52 = 0;
 var $520 = 0, $521 = 0, $522 = 0, $523 = 0, $524 = 0, $525 = 0, $526 = 0, $527 = 0, $528 = 0, $529 = 0, $53 = 0, $530 = 0, $531 = 0, $532 = 0, $533 = 0, $534 = 0, $535 = 0, $536 = 0, $537 = 0, $538 = 0;
 var $539 = 0, $54 = 0, $540 = 0, $541 = 0, $542 = 0, $543 = 0, $544 = 0, $545 = 0, $546 = 0, $547 = 0, $548 = 0, $549 = 0, $55 = 0, $550 = 0, $551 = 0, $552 = 0, $553 = 0, $554 = 0, $555 = 0, $556 = 0;
 var $557 = 0, $558 = 0, $559 = 0, $56 = 0, $560 = 0, $561 = 0, $562 = 0, $563 = 0, $564 = 0, $565 = 0, $566 = 0, $567 = 0, $568 = 0, $569 = 0, $57 = 0, $570 = 0, $571 = 0, $572 = 0, $573 = 0, $574 = 0;
 var $575 = 0, $576 = 0, $577 = 0, $578 = 0, $579 = 0, $58 = 0, $580 = 0, $581 = 0, $582 = 0, $583 = 0, $584 = 0, $585 = 0, $586 = 0, $587 = 0, $588 = 0, $589 = 0, $59 = 0, $590 = 0, $591 = 0, $592 = 0;
 var $593 = 0, $594 = 0, $595 = 0, $596 = 0, $597 = 0, $598 = 0, $599 = 0, $6 = 0, $60 = 0, $600 = 0, $601 = 0, $602 = 0, $603 = 0, $604 = 0, $605 = 0, $606 = 0, $607 = 0, $608 = 0, $609 = 0, $61 = 0;
 var $610 = 0, $611 = 0, $612 = 0, $613 = 0, $614 = 0, $615 = 0, $616 = 0, $617 = 0, $618 = 0, $619 = 0, $62 = 0, $620 = 0, $621 = 0, $622 = 0, $623 = 0, $624 = 0, $625 = 0, $626 = 0, $627 = 0, $628 = 0;
 var $629 = 0, $63 = 0, $630 = 0, $631 = 0, $632 = 0, $633 = 0, $634 = 0, $635 = 0, $636 = 0, $637 = 0, $638 = 0, $639 = 0, $64 = 0, $640 = 0, $641 = 0, $642 = 0, $643 = 0, $644 = 0, $645 = 0, $646 = 0;
 var $647 = 0, $648 = 0, $649 = 0, $65 = 0, $650 = 0, $651 = 0, $652 = 0, $653 = 0, $654 = 0, $655 = 0, $656 = 0, $657 = 0, $658 = 0, $659 = 0, $66 = 0, $660 = 0, $661 = 0, $662 = 0, $663 = 0, $664 = 0;
 var $665 = 0, $666 = 0, $667 = 0, $668 = 0, $669 = 0, $67 = 0, $670 = 0, $671 = 0, $672 = 0, $673 = 0, $674 = 0, $675 = 0, $676 = 0, $677 = 0, $678 = 0, $679 = 0, $68 = 0, $680 = 0, $681 = 0, $682 = 0;
 var $683 = 0, $684 = 0, $685 = 0, $686 = 0, $687 = 0, $688 = 0, $689 = 0, $69 = 0, $690 = 0, $691 = 0, $692 = 0, $693 = 0, $694 = 0, $695 = 0, $696 = 0, $697 = 0, $698 = 0, $699 = 0, $7 = 0, $70 = 0;
 var $700 = 0, $701 = 0, $702 = 0, $703 = 0, $704 = 0, $705 = 0, $706 = 0, $707 = 0, $708 = 0, $709 = 0, $71 = 0, $710 = 0, $711 = 0, $712 = 0, $713 = 0, $714 = 0, $715 = 0, $716 = 0, $717 = 0, $718 = 0;
 var $719 = 0, $72 = 0, $720 = 0, $721 = 0, $722 = 0, $723 = 0, $724 = 0, $725 = 0, $726 = 0, $727 = 0, $728 = 0, $729 = 0, $73 = 0, $730 = 0, $731 = 0, $732 = 0, $733 = 0, $734 = 0, $735 = 0, $736 = 0;
 var $737 = 0, $738 = 0, $739 = 0, $74 = 0, $740 = 0, $741 = 0, $742 = 0, $743 = 0, $744 = 0, $745 = 0, $746 = 0, $747 = 0, $748 = 0, $749 = 0, $75 = 0, $750 = 0, $751 = 0, $752 = 0, $753 = 0, $754 = 0;
 var $755 = 0, $756 = 0, $757 = 0, $758 = 0, $759 = 0, $76 = 0, $760 = 0, $761 = 0, $762 = 0, $763 = 0, $764 = 0, $765 = 0, $766 = 0, $767 = 0, $768 = 0, $769 = 0, $77 = 0, $770 = 0, $771 = 0, $772 = 0;
 var $773 = 0, $774 = 0, $775 = 0, $776 = 0, $777 = 0, $778 = 0, $779 = 0, $78 = 0, $780 = 0, $781 = 0, $782 = 0, $783 = 0, $784 = 0, $785 = 0, $786 = 0, $787 = 0, $788 = 0, $789 = 0, $79 = 0, $790 = 0;
 var $791 = 0, $792 = 0, $793 = 0, $794 = 0, $795 = 0, $796 = 0, $797 = 0, $798 = 0, $799 = 0, $8 = 0, $80 = 0, $800 = 0, $801 = 0, $802 = 0, $803 = 0, $804 = 0, $805 = 0, $806 = 0, $807 = 0, $808 = 0;
 var $809 = 0, $81 = 0, $810 = 0, $811 = 0, $812 = 0, $813 = 0, $814 = 0, $815 = 0, $816 = 0, $817 = 0, $818 = 0, $819 = 0, $82 = 0, $820 = 0, $821 = 0, $822 = 0, $823 = 0, $824 = 0, $825 = 0, $826 = 0;
 var $827 = 0, $828 = 0, $829 = 0, $83 = 0, $830 = 0, $831 = 0, $832 = 0, $833 = 0, $834 = 0, $835 = 0, $836 = 0, $837 = 0, $838 = 0, $839 = 0, $84 = 0, $840 = 0, $841 = 0, $842 = 0, $843 = 0, $844 = 0;
 var $845 = 0, $846 = 0, $847 = 0, $848 = 0, $849 = 0, $85 = 0, $850 = 0, $851 = 0, $852 = 0, $853 = 0, $854 = 0, $855 = 0, $856 = 0, $857 = 0, $858 = 0, $859 = 0, $86 = 0, $860 = 0, $861 = 0, $862 = 0;
 var $863 = 0, $864 = 0, $865 = 0, $866 = 0, $867 = 0, $868 = 0, $869 = 0, $87 = 0, $870 = 0, $871 = 0, $872 = 0, $873 = 0, $874 = 0, $875 = 0, $876 = 0, $877 = 0, $878 = 0, $879 = 0, $88 = 0, $880 = 0;
 var $881 = 0, $882 = 0, $883 = 0, $884 = 0, $885 = 0, $886 = 0, $887 = 0, $888 = 0, $889 = 0, $89 = 0, $890 = 0, $891 = 0, $892 = 0, $893 = 0, $894 = 0, $895 = 0, $896 = 0, $897 = 0, $898 = 0, $899 = 0;
 var $9 = 0, $90 = 0, $900 = 0, $901 = 0, $902 = 0, $903 = 0, $904 = 0, $905 = 0, $906 = 0, $907 = 0, $908 = 0, $909 = 0, $91 = 0, $910 = 0, $911 = 0, $912 = 0, $913 = 0, $914 = 0, $915 = 0, $916 = 0;
 var $917 = 0, $918 = 0, $919 = 0, $92 = 0, $920 = 0, $921 = 0, $922 = 0, $923 = 0, $924 = 0, $925 = 0, $926 = 0, $927 = 0, $928 = 0, $929 = 0, $93 = 0, $930 = 0, $931 = 0, $932 = 0, $933 = 0, $934 = 0;
 var $935 = 0, $936 = 0, $937 = 0, $938 = 0, $939 = 0, $94 = 0, $940 = 0, $941 = 0, $942 = 0, $943 = 0, $944 = 0, $945 = 0, $946 = 0, $947 = 0, $948 = 0, $949 = 0, $95 = 0, $950 = 0, $951 = 0, $952 = 0;
 var $953 = 0, $954 = 0, $955 = 0, $956 = 0, $957 = 0, $958 = 0, $959 = 0, $96 = 0, $960 = 0, $961 = 0, $962 = 0, $963 = 0, $964 = 0, $965 = 0, $966 = 0, $967 = 0, $968 = 0, $969 = 0, $97 = 0, $970 = 0;
 var $971 = 0, $972 = 0, $973 = 0, $974 = 0, $975 = 0, $976 = 0, $977 = 0, $978 = 0, $979 = 0, $98 = 0, $980 = 0, $981 = 0, $982 = 0, $983 = 0, $984 = 0, $985 = 0, $986 = 0, $987 = 0, $988 = 0, $989 = 0;
 var $99 = 0, $990 = 0, $991 = 0, $992 = 0, $993 = 0, $994 = 0, $995 = 0, $996 = 0, $997 = 0, $998 = 0, $999 = 0, $cond$i = 0, $cond$i$i = 0, $cond$i203 = 0, $exitcond$i$i = 0, $not$$i = 0, $not$$i$i = 0, $not$$i204 = 0, $not$1$i = 0, $not$1$i198 = 0;
 var $not$3$i = 0, $not$5$i = 0, $or$cond$i = 0, $or$cond$i207 = 0, $or$cond1$i = 0, $or$cond10$i = 0, $or$cond11$i = 0, $or$cond12$i = 0, $or$cond2$i = 0, $or$cond2$i208 = 0, $or$cond42$i = 0, $or$cond5$i = 0, $or$cond7$i = 0, $or$cond9$i = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = sp + 12|0;
 $2 = sp + 8|0;
 $3 = sp + 4|0;
 $4 = sp;
 $5 = HEAP32[1835]|0;
 $6 = ($5|0)==(0);
 if ($6) {
  (___pthread_mutex_lock(7364)|0);
  $7 = HEAP32[1835]|0;
  $8 = ($7|0)==(0);
  if ($8) {
   HEAP32[(7348)>>2] = 4096;
   HEAP32[(7344)>>2] = 4096;
   HEAP32[(7352)>>2] = -1;
   HEAP32[(7356)>>2] = -1;
   HEAP32[(7360)>>2] = 2;
   HEAP32[(7836)>>2] = 2;
   $9 = (_pthread_mutexattr_init($3)|0);
   $10 = ($9|0)==(0);
   if ($10) {
    $11 = (_pthread_mutex_init((7840),$3)|0);
    $12 = ($11|0)==(0);
    if ($12) {
    }
   }
   $13 = $4;
   $14 = $13 & -16;
   $15 = $14 ^ 1431655768;
   HEAP32[$4>>2] = $15;
   Atomics_store(HEAP32,1835,$15)|0;
  }
  (___pthread_mutex_unlock(7364)|0);
 }
 $16 = HEAP32[(7836)>>2]|0;
 $17 = $16 & 2;
 $18 = ($17|0)==(0);
 if (!($18)) {
  $19 = (___pthread_mutex_lock((7840))|0);
  $20 = ($19|0)==(0);
  if (!($20)) {
   $$1 = 0;
   STACKTOP = sp;return ($$1|0);
  }
 }
 $21 = ($0>>>0)<(245);
 do {
  if ($21) {
   $22 = ($0>>>0)<(11);
   $23 = (($0) + 11)|0;
   $24 = $23 & -8;
   $25 = $22 ? 16 : $24;
   $26 = $25 >>> 3;
   $27 = HEAP32[1848]|0;
   $28 = $27 >>> $26;
   $29 = $28 & 3;
   $30 = ($29|0)==(0);
   if (!($30)) {
    $31 = $28 & 1;
    $32 = $31 ^ 1;
    $33 = (($32) + ($26))|0;
    $34 = $33 << 1;
    $35 = (7432 + ($34<<2)|0);
    $36 = ((($35)) + 8|0);
    $37 = HEAP32[$36>>2]|0;
    $38 = ((($37)) + 8|0);
    $39 = HEAP32[$38>>2]|0;
    $40 = ($35|0)==($39|0);
    if ($40) {
     $41 = 1 << $33;
     $42 = $41 ^ -1;
     $43 = $27 & $42;
     HEAP32[1848] = $43;
    } else {
     $44 = ((($39)) + 12|0);
     HEAP32[$44>>2] = $35;
     HEAP32[$36>>2] = $39;
    }
    $45 = $33 << 3;
    $46 = $45 | 3;
    $47 = ((($37)) + 4|0);
    HEAP32[$47>>2] = $46;
    $48 = (($37) + ($45)|0);
    $49 = ((($48)) + 4|0);
    $50 = HEAP32[$49>>2]|0;
    $51 = $50 | 1;
    HEAP32[$49>>2] = $51;
    $$2 = $38;
    break;
   }
   $52 = HEAP32[(7400)>>2]|0;
   $53 = ($25>>>0)>($52>>>0);
   if ($53) {
    $54 = ($28|0)==(0);
    if (!($54)) {
     $55 = $28 << $26;
     $56 = 2 << $26;
     $57 = (0 - ($56))|0;
     $58 = $56 | $57;
     $59 = $55 & $58;
     $60 = (0 - ($59))|0;
     $61 = $59 & $60;
     $62 = (($61) + -1)|0;
     $63 = $62 >>> 12;
     $64 = $63 & 16;
     $65 = $62 >>> $64;
     $66 = $65 >>> 5;
     $67 = $66 & 8;
     $68 = $67 | $64;
     $69 = $65 >>> $67;
     $70 = $69 >>> 2;
     $71 = $70 & 4;
     $72 = $68 | $71;
     $73 = $69 >>> $71;
     $74 = $73 >>> 1;
     $75 = $74 & 2;
     $76 = $72 | $75;
     $77 = $73 >>> $75;
     $78 = $77 >>> 1;
     $79 = $78 & 1;
     $80 = $76 | $79;
     $81 = $77 >>> $79;
     $82 = (($80) + ($81))|0;
     $83 = $82 << 1;
     $84 = (7432 + ($83<<2)|0);
     $85 = ((($84)) + 8|0);
     $86 = HEAP32[$85>>2]|0;
     $87 = ((($86)) + 8|0);
     $88 = HEAP32[$87>>2]|0;
     $89 = ($84|0)==($88|0);
     if ($89) {
      $90 = 1 << $82;
      $91 = $90 ^ -1;
      $92 = $27 & $91;
      HEAP32[1848] = $92;
      $109 = $92;
     } else {
      $93 = ((($88)) + 12|0);
      HEAP32[$93>>2] = $84;
      HEAP32[$85>>2] = $88;
      $109 = $27;
     }
     $94 = $82 << 3;
     $95 = (($94) - ($25))|0;
     $96 = $25 | 3;
     $97 = ((($86)) + 4|0);
     HEAP32[$97>>2] = $96;
     $98 = (($86) + ($25)|0);
     $99 = $95 | 1;
     $100 = ((($98)) + 4|0);
     HEAP32[$100>>2] = $99;
     $101 = (($98) + ($95)|0);
     HEAP32[$101>>2] = $95;
     $102 = ($52|0)==(0);
     if (!($102)) {
      $103 = HEAP32[(7412)>>2]|0;
      $104 = $52 >>> 3;
      $105 = $104 << 1;
      $106 = (7432 + ($105<<2)|0);
      $107 = 1 << $104;
      $108 = $109 & $107;
      $110 = ($108|0)==(0);
      if ($110) {
       $111 = $109 | $107;
       HEAP32[1848] = $111;
       $$pre = ((($106)) + 8|0);
       $$0195 = $106;$$pre$phiZ2D = $$pre;
      } else {
       $112 = ((($106)) + 8|0);
       $113 = HEAP32[$112>>2]|0;
       $$0195 = $113;$$pre$phiZ2D = $112;
      }
      HEAP32[$$pre$phiZ2D>>2] = $103;
      $114 = ((($$0195)) + 12|0);
      HEAP32[$114>>2] = $103;
      $115 = ((($103)) + 8|0);
      HEAP32[$115>>2] = $$0195;
      $116 = ((($103)) + 12|0);
      HEAP32[$116>>2] = $106;
     }
     HEAP32[(7400)>>2] = $95;
     HEAP32[(7412)>>2] = $98;
     $$2 = $87;
     break;
    }
    $117 = HEAP32[(7396)>>2]|0;
    $118 = ($117|0)==(0);
    if ($118) {
     $$0193 = $25;
     label = 108;
    } else {
     $119 = (0 - ($117))|0;
     $120 = $117 & $119;
     $121 = (($120) + -1)|0;
     $122 = $121 >>> 12;
     $123 = $122 & 16;
     $124 = $121 >>> $123;
     $125 = $124 >>> 5;
     $126 = $125 & 8;
     $127 = $126 | $123;
     $128 = $124 >>> $126;
     $129 = $128 >>> 2;
     $130 = $129 & 4;
     $131 = $127 | $130;
     $132 = $128 >>> $130;
     $133 = $132 >>> 1;
     $134 = $133 & 2;
     $135 = $131 | $134;
     $136 = $132 >>> $134;
     $137 = $136 >>> 1;
     $138 = $137 & 1;
     $139 = $135 | $138;
     $140 = $136 >>> $138;
     $141 = (($139) + ($140))|0;
     $142 = (7696 + ($141<<2)|0);
     $143 = HEAP32[$142>>2]|0;
     $144 = ((($143)) + 4|0);
     $145 = HEAP32[$144>>2]|0;
     $146 = $145 & -8;
     $147 = (($146) - ($25))|0;
     $148 = ((($143)) + 16|0);
     $149 = HEAP32[$148>>2]|0;
     $not$3$i = ($149|0)==(0|0);
     $$sink14$i = $not$3$i&1;
     $150 = (((($143)) + 16|0) + ($$sink14$i<<2)|0);
     $151 = HEAP32[$150>>2]|0;
     $152 = ($151|0)==(0|0);
     if ($152) {
      $$0172$lcssa$i = $143;$$0173$lcssa$i = $147;
     } else {
      $$01726$i = $143;$$01735$i = $147;$154 = $151;
      while(1) {
       $153 = ((($154)) + 4|0);
       $155 = HEAP32[$153>>2]|0;
       $156 = $155 & -8;
       $157 = (($156) - ($25))|0;
       $158 = ($157>>>0)<($$01735$i>>>0);
       $$$0173$i = $158 ? $157 : $$01735$i;
       $$$0172$i = $158 ? $154 : $$01726$i;
       $159 = ((($154)) + 16|0);
       $160 = HEAP32[$159>>2]|0;
       $not$$i = ($160|0)==(0|0);
       $$sink1$i = $not$$i&1;
       $161 = (((($154)) + 16|0) + ($$sink1$i<<2)|0);
       $162 = HEAP32[$161>>2]|0;
       $163 = ($162|0)==(0|0);
       if ($163) {
        $$0172$lcssa$i = $$$0172$i;$$0173$lcssa$i = $$$0173$i;
        break;
       } else {
        $$01726$i = $$$0172$i;$$01735$i = $$$0173$i;$154 = $162;
       }
      }
     }
     $164 = (($$0172$lcssa$i) + ($25)|0);
     $165 = ($$0172$lcssa$i>>>0)<($164>>>0);
     if ($165) {
      $166 = ((($$0172$lcssa$i)) + 24|0);
      $167 = HEAP32[$166>>2]|0;
      $168 = ((($$0172$lcssa$i)) + 12|0);
      $169 = HEAP32[$168>>2]|0;
      $170 = ($169|0)==($$0172$lcssa$i|0);
      do {
       if ($170) {
        $175 = ((($$0172$lcssa$i)) + 20|0);
        $176 = HEAP32[$175>>2]|0;
        $177 = ($176|0)==(0|0);
        if ($177) {
         $178 = ((($$0172$lcssa$i)) + 16|0);
         $179 = HEAP32[$178>>2]|0;
         $180 = ($179|0)==(0|0);
         if ($180) {
          $$3$i = 0;
          break;
         } else {
          $$1176$i = $179;$$1178$i = $178;
         }
        } else {
         $$1176$i = $176;$$1178$i = $175;
        }
        while(1) {
         $181 = ((($$1176$i)) + 20|0);
         $182 = HEAP32[$181>>2]|0;
         $183 = ($182|0)==(0|0);
         if (!($183)) {
          $$1176$i = $182;$$1178$i = $181;
          continue;
         }
         $184 = ((($$1176$i)) + 16|0);
         $185 = HEAP32[$184>>2]|0;
         $186 = ($185|0)==(0|0);
         if ($186) {
          break;
         } else {
          $$1176$i = $185;$$1178$i = $184;
         }
        }
        HEAP32[$$1178$i>>2] = 0;
        $$3$i = $$1176$i;
       } else {
        $171 = ((($$0172$lcssa$i)) + 8|0);
        $172 = HEAP32[$171>>2]|0;
        $173 = ((($172)) + 12|0);
        HEAP32[$173>>2] = $169;
        $174 = ((($169)) + 8|0);
        HEAP32[$174>>2] = $172;
        $$3$i = $169;
       }
      } while(0);
      $187 = ($167|0)==(0|0);
      do {
       if (!($187)) {
        $188 = ((($$0172$lcssa$i)) + 28|0);
        $189 = HEAP32[$188>>2]|0;
        $190 = (7696 + ($189<<2)|0);
        $191 = HEAP32[$190>>2]|0;
        $192 = ($$0172$lcssa$i|0)==($191|0);
        if ($192) {
         HEAP32[$190>>2] = $$3$i;
         $cond$i = ($$3$i|0)==(0|0);
         if ($cond$i) {
          $193 = 1 << $189;
          $194 = $193 ^ -1;
          $195 = $117 & $194;
          HEAP32[(7396)>>2] = $195;
          break;
         }
        } else {
         $196 = ((($167)) + 16|0);
         $197 = HEAP32[$196>>2]|0;
         $not$1$i = ($197|0)!=($$0172$lcssa$i|0);
         $$sink2$i = $not$1$i&1;
         $198 = (((($167)) + 16|0) + ($$sink2$i<<2)|0);
         HEAP32[$198>>2] = $$3$i;
         $199 = ($$3$i|0)==(0|0);
         if ($199) {
          break;
         }
        }
        $200 = ((($$3$i)) + 24|0);
        HEAP32[$200>>2] = $167;
        $201 = ((($$0172$lcssa$i)) + 16|0);
        $202 = HEAP32[$201>>2]|0;
        $203 = ($202|0)==(0|0);
        if (!($203)) {
         $204 = ((($$3$i)) + 16|0);
         HEAP32[$204>>2] = $202;
         $205 = ((($202)) + 24|0);
         HEAP32[$205>>2] = $$3$i;
        }
        $206 = ((($$0172$lcssa$i)) + 20|0);
        $207 = HEAP32[$206>>2]|0;
        $208 = ($207|0)==(0|0);
        if (!($208)) {
         $209 = ((($$3$i)) + 20|0);
         HEAP32[$209>>2] = $207;
         $210 = ((($207)) + 24|0);
         HEAP32[$210>>2] = $$3$i;
        }
       }
      } while(0);
      $211 = ($$0173$lcssa$i>>>0)<(16);
      if ($211) {
       $212 = (($$0173$lcssa$i) + ($25))|0;
       $213 = $212 | 3;
       $214 = ((($$0172$lcssa$i)) + 4|0);
       HEAP32[$214>>2] = $213;
       $215 = (($$0172$lcssa$i) + ($212)|0);
       $216 = ((($215)) + 4|0);
       $217 = HEAP32[$216>>2]|0;
       $218 = $217 | 1;
       HEAP32[$216>>2] = $218;
      } else {
       $219 = $25 | 3;
       $220 = ((($$0172$lcssa$i)) + 4|0);
       HEAP32[$220>>2] = $219;
       $221 = $$0173$lcssa$i | 1;
       $222 = ((($164)) + 4|0);
       HEAP32[$222>>2] = $221;
       $223 = (($164) + ($$0173$lcssa$i)|0);
       HEAP32[$223>>2] = $$0173$lcssa$i;
       $224 = ($52|0)==(0);
       if (!($224)) {
        $225 = HEAP32[(7412)>>2]|0;
        $226 = $52 >>> 3;
        $227 = $226 << 1;
        $228 = (7432 + ($227<<2)|0);
        $229 = 1 << $226;
        $230 = $27 & $229;
        $231 = ($230|0)==(0);
        if ($231) {
         $232 = $27 | $229;
         HEAP32[1848] = $232;
         $$pre$i = ((($228)) + 8|0);
         $$0$i = $228;$$pre$phi$iZ2D = $$pre$i;
        } else {
         $233 = ((($228)) + 8|0);
         $234 = HEAP32[$233>>2]|0;
         $$0$i = $234;$$pre$phi$iZ2D = $233;
        }
        HEAP32[$$pre$phi$iZ2D>>2] = $225;
        $235 = ((($$0$i)) + 12|0);
        HEAP32[$235>>2] = $225;
        $236 = ((($225)) + 8|0);
        HEAP32[$236>>2] = $$0$i;
        $237 = ((($225)) + 12|0);
        HEAP32[$237>>2] = $228;
       }
       HEAP32[(7400)>>2] = $$0173$lcssa$i;
       HEAP32[(7412)>>2] = $164;
      }
      $238 = ((($$0172$lcssa$i)) + 8|0);
      $$2 = $238;
     } else {
      $$0193 = $25;
      label = 108;
     }
    }
   } else {
    $$0193 = $25;
    label = 108;
   }
  } else {
   $239 = ($0>>>0)>(4294967231);
   if ($239) {
    $$0193 = -1;
    label = 108;
   } else {
    $240 = (($0) + 11)|0;
    $241 = $240 & -8;
    $242 = HEAP32[(7396)>>2]|0;
    $243 = ($242|0)==(0);
    if ($243) {
     $$0193 = $241;
     label = 108;
    } else {
     $244 = (0 - ($241))|0;
     $245 = $240 >>> 8;
     $246 = ($245|0)==(0);
     if ($246) {
      $$0336$i = 0;
     } else {
      $247 = ($241>>>0)>(16777215);
      if ($247) {
       $$0336$i = 31;
      } else {
       $248 = (($245) + 1048320)|0;
       $249 = $248 >>> 16;
       $250 = $249 & 8;
       $251 = $245 << $250;
       $252 = (($251) + 520192)|0;
       $253 = $252 >>> 16;
       $254 = $253 & 4;
       $255 = $254 | $250;
       $256 = $251 << $254;
       $257 = (($256) + 245760)|0;
       $258 = $257 >>> 16;
       $259 = $258 & 2;
       $260 = $255 | $259;
       $261 = (14 - ($260))|0;
       $262 = $256 << $259;
       $263 = $262 >>> 15;
       $264 = (($261) + ($263))|0;
       $265 = $264 << 1;
       $266 = (($264) + 7)|0;
       $267 = $241 >>> $266;
       $268 = $267 & 1;
       $269 = $268 | $265;
       $$0336$i = $269;
      }
     }
     $270 = (7696 + ($$0336$i<<2)|0);
     $271 = HEAP32[$270>>2]|0;
     $272 = ($271|0)==(0|0);
     L85: do {
      if ($272) {
       $$2333$i = 0;$$3$i196 = 0;$$3328$i = $244;
       label = 66;
      } else {
       $273 = ($$0336$i|0)==(31);
       $274 = $$0336$i >>> 1;
       $275 = (25 - ($274))|0;
       $276 = $273 ? 0 : $275;
       $277 = $241 << $276;
       $$0320$i = 0;$$0325$i = $244;$$0331$i = $271;$$0337$i = $277;$$0340$i = 0;
       while(1) {
        $278 = ((($$0331$i)) + 4|0);
        $279 = HEAP32[$278>>2]|0;
        $280 = $279 & -8;
        $281 = (($280) - ($241))|0;
        $282 = ($281>>>0)<($$0325$i>>>0);
        if ($282) {
         $283 = ($281|0)==(0);
         if ($283) {
          $$411$i = $$0331$i;$$432910$i = 0;$$43359$i = $$0331$i;
          label = 70;
          break L85;
         } else {
          $$1321$i = $$0331$i;$$1326$i = $281;
         }
        } else {
         $$1321$i = $$0320$i;$$1326$i = $$0325$i;
        }
        $284 = ((($$0331$i)) + 20|0);
        $285 = HEAP32[$284>>2]|0;
        $286 = $$0337$i >>> 31;
        $287 = (((($$0331$i)) + 16|0) + ($286<<2)|0);
        $288 = HEAP32[$287>>2]|0;
        $289 = ($285|0)==(0|0);
        $290 = ($285|0)==($288|0);
        $or$cond2$i = $289 | $290;
        $$1341$i = $or$cond2$i ? $$0340$i : $285;
        $291 = ($288|0)==(0|0);
        $not$5$i = $291 ^ 1;
        $292 = $not$5$i&1;
        $$0337$$i = $$0337$i << $292;
        if ($291) {
         $$2333$i = $$1341$i;$$3$i196 = $$1321$i;$$3328$i = $$1326$i;
         label = 66;
         break;
        } else {
         $$0320$i = $$1321$i;$$0325$i = $$1326$i;$$0331$i = $288;$$0337$i = $$0337$$i;$$0340$i = $$1341$i;
        }
       }
      }
     } while(0);
     if ((label|0) == 66) {
      $293 = ($$2333$i|0)==(0|0);
      $294 = ($$3$i196|0)==(0|0);
      $or$cond$i = $293 & $294;
      if ($or$cond$i) {
       $295 = 2 << $$0336$i;
       $296 = (0 - ($295))|0;
       $297 = $295 | $296;
       $298 = $242 & $297;
       $299 = ($298|0)==(0);
       if ($299) {
        $$0193 = $241;
        label = 108;
        break;
       }
       $300 = (0 - ($298))|0;
       $301 = $298 & $300;
       $302 = (($301) + -1)|0;
       $303 = $302 >>> 12;
       $304 = $303 & 16;
       $305 = $302 >>> $304;
       $306 = $305 >>> 5;
       $307 = $306 & 8;
       $308 = $307 | $304;
       $309 = $305 >>> $307;
       $310 = $309 >>> 2;
       $311 = $310 & 4;
       $312 = $308 | $311;
       $313 = $309 >>> $311;
       $314 = $313 >>> 1;
       $315 = $314 & 2;
       $316 = $312 | $315;
       $317 = $313 >>> $315;
       $318 = $317 >>> 1;
       $319 = $318 & 1;
       $320 = $316 | $319;
       $321 = $317 >>> $319;
       $322 = (($320) + ($321))|0;
       $323 = (7696 + ($322<<2)|0);
       $324 = HEAP32[$323>>2]|0;
       $$4$ph$i = 0;$$4335$ph$i = $324;
      } else {
       $$4$ph$i = $$3$i196;$$4335$ph$i = $$2333$i;
      }
      $325 = ($$4335$ph$i|0)==(0|0);
      if ($325) {
       $$4$lcssa$i = $$4$ph$i;$$4329$lcssa$i = $$3328$i;
      } else {
       $$411$i = $$4$ph$i;$$432910$i = $$3328$i;$$43359$i = $$4335$ph$i;
       label = 70;
      }
     }
     if ((label|0) == 70) {
      while(1) {
       label = 0;
       $326 = ((($$43359$i)) + 4|0);
       $327 = HEAP32[$326>>2]|0;
       $328 = $327 & -8;
       $329 = (($328) - ($241))|0;
       $330 = ($329>>>0)<($$432910$i>>>0);
       $$$4329$i = $330 ? $329 : $$432910$i;
       $$4335$$4$i = $330 ? $$43359$i : $$411$i;
       $331 = ((($$43359$i)) + 16|0);
       $332 = HEAP32[$331>>2]|0;
       $not$1$i198 = ($332|0)==(0|0);
       $$sink2$i199 = $not$1$i198&1;
       $333 = (((($$43359$i)) + 16|0) + ($$sink2$i199<<2)|0);
       $334 = HEAP32[$333>>2]|0;
       $335 = ($334|0)==(0|0);
       if ($335) {
        $$4$lcssa$i = $$4335$$4$i;$$4329$lcssa$i = $$$4329$i;
        break;
       } else {
        $$411$i = $$4335$$4$i;$$432910$i = $$$4329$i;$$43359$i = $334;
        label = 70;
       }
      }
     }
     $336 = ($$4$lcssa$i|0)==(0|0);
     if ($336) {
      $$0193 = $241;
      label = 108;
     } else {
      $337 = HEAP32[(7400)>>2]|0;
      $338 = (($337) - ($241))|0;
      $339 = ($$4329$lcssa$i>>>0)<($338>>>0);
      if ($339) {
       $340 = (($$4$lcssa$i) + ($241)|0);
       $341 = ($$4$lcssa$i>>>0)<($340>>>0);
       if ($341) {
        $342 = ((($$4$lcssa$i)) + 24|0);
        $343 = HEAP32[$342>>2]|0;
        $344 = ((($$4$lcssa$i)) + 12|0);
        $345 = HEAP32[$344>>2]|0;
        $346 = ($345|0)==($$4$lcssa$i|0);
        do {
         if ($346) {
          $351 = ((($$4$lcssa$i)) + 20|0);
          $352 = HEAP32[$351>>2]|0;
          $353 = ($352|0)==(0|0);
          if ($353) {
           $354 = ((($$4$lcssa$i)) + 16|0);
           $355 = HEAP32[$354>>2]|0;
           $356 = ($355|0)==(0|0);
           if ($356) {
            $$3349$i = 0;
            break;
           } else {
            $$1347$i = $355;$$1351$i = $354;
           }
          } else {
           $$1347$i = $352;$$1351$i = $351;
          }
          while(1) {
           $357 = ((($$1347$i)) + 20|0);
           $358 = HEAP32[$357>>2]|0;
           $359 = ($358|0)==(0|0);
           if (!($359)) {
            $$1347$i = $358;$$1351$i = $357;
            continue;
           }
           $360 = ((($$1347$i)) + 16|0);
           $361 = HEAP32[$360>>2]|0;
           $362 = ($361|0)==(0|0);
           if ($362) {
            break;
           } else {
            $$1347$i = $361;$$1351$i = $360;
           }
          }
          HEAP32[$$1351$i>>2] = 0;
          $$3349$i = $$1347$i;
         } else {
          $347 = ((($$4$lcssa$i)) + 8|0);
          $348 = HEAP32[$347>>2]|0;
          $349 = ((($348)) + 12|0);
          HEAP32[$349>>2] = $345;
          $350 = ((($345)) + 8|0);
          HEAP32[$350>>2] = $348;
          $$3349$i = $345;
         }
        } while(0);
        $363 = ($343|0)==(0|0);
        do {
         if ($363) {
          $445 = $242;
         } else {
          $364 = ((($$4$lcssa$i)) + 28|0);
          $365 = HEAP32[$364>>2]|0;
          $366 = (7696 + ($365<<2)|0);
          $367 = HEAP32[$366>>2]|0;
          $368 = ($$4$lcssa$i|0)==($367|0);
          if ($368) {
           HEAP32[$366>>2] = $$3349$i;
           $cond$i203 = ($$3349$i|0)==(0|0);
           if ($cond$i203) {
            $369 = 1 << $365;
            $370 = $369 ^ -1;
            $371 = $242 & $370;
            HEAP32[(7396)>>2] = $371;
            $445 = $371;
            break;
           }
          } else {
           $372 = ((($343)) + 16|0);
           $373 = HEAP32[$372>>2]|0;
           $not$$i204 = ($373|0)!=($$4$lcssa$i|0);
           $$sink3$i = $not$$i204&1;
           $374 = (((($343)) + 16|0) + ($$sink3$i<<2)|0);
           HEAP32[$374>>2] = $$3349$i;
           $375 = ($$3349$i|0)==(0|0);
           if ($375) {
            $445 = $242;
            break;
           }
          }
          $376 = ((($$3349$i)) + 24|0);
          HEAP32[$376>>2] = $343;
          $377 = ((($$4$lcssa$i)) + 16|0);
          $378 = HEAP32[$377>>2]|0;
          $379 = ($378|0)==(0|0);
          if (!($379)) {
           $380 = ((($$3349$i)) + 16|0);
           HEAP32[$380>>2] = $378;
           $381 = ((($378)) + 24|0);
           HEAP32[$381>>2] = $$3349$i;
          }
          $382 = ((($$4$lcssa$i)) + 20|0);
          $383 = HEAP32[$382>>2]|0;
          $384 = ($383|0)==(0|0);
          if ($384) {
           $445 = $242;
          } else {
           $385 = ((($$3349$i)) + 20|0);
           HEAP32[$385>>2] = $383;
           $386 = ((($383)) + 24|0);
           HEAP32[$386>>2] = $$3349$i;
           $445 = $242;
          }
         }
        } while(0);
        $387 = ($$4329$lcssa$i>>>0)<(16);
        do {
         if ($387) {
          $388 = (($$4329$lcssa$i) + ($241))|0;
          $389 = $388 | 3;
          $390 = ((($$4$lcssa$i)) + 4|0);
          HEAP32[$390>>2] = $389;
          $391 = (($$4$lcssa$i) + ($388)|0);
          $392 = ((($391)) + 4|0);
          $393 = HEAP32[$392>>2]|0;
          $394 = $393 | 1;
          HEAP32[$392>>2] = $394;
         } else {
          $395 = $241 | 3;
          $396 = ((($$4$lcssa$i)) + 4|0);
          HEAP32[$396>>2] = $395;
          $397 = $$4329$lcssa$i | 1;
          $398 = ((($340)) + 4|0);
          HEAP32[$398>>2] = $397;
          $399 = (($340) + ($$4329$lcssa$i)|0);
          HEAP32[$399>>2] = $$4329$lcssa$i;
          $400 = $$4329$lcssa$i >>> 3;
          $401 = ($$4329$lcssa$i>>>0)<(256);
          if ($401) {
           $402 = $400 << 1;
           $403 = (7432 + ($402<<2)|0);
           $404 = HEAP32[1848]|0;
           $405 = 1 << $400;
           $406 = $404 & $405;
           $407 = ($406|0)==(0);
           if ($407) {
            $408 = $404 | $405;
            HEAP32[1848] = $408;
            $$pre$i205 = ((($403)) + 8|0);
            $$0345$i = $403;$$pre$phi$i206Z2D = $$pre$i205;
           } else {
            $409 = ((($403)) + 8|0);
            $410 = HEAP32[$409>>2]|0;
            $$0345$i = $410;$$pre$phi$i206Z2D = $409;
           }
           HEAP32[$$pre$phi$i206Z2D>>2] = $340;
           $411 = ((($$0345$i)) + 12|0);
           HEAP32[$411>>2] = $340;
           $412 = ((($340)) + 8|0);
           HEAP32[$412>>2] = $$0345$i;
           $413 = ((($340)) + 12|0);
           HEAP32[$413>>2] = $403;
           break;
          }
          $414 = $$4329$lcssa$i >>> 8;
          $415 = ($414|0)==(0);
          if ($415) {
           $$0339$i = 0;
          } else {
           $416 = ($$4329$lcssa$i>>>0)>(16777215);
           if ($416) {
            $$0339$i = 31;
           } else {
            $417 = (($414) + 1048320)|0;
            $418 = $417 >>> 16;
            $419 = $418 & 8;
            $420 = $414 << $419;
            $421 = (($420) + 520192)|0;
            $422 = $421 >>> 16;
            $423 = $422 & 4;
            $424 = $423 | $419;
            $425 = $420 << $423;
            $426 = (($425) + 245760)|0;
            $427 = $426 >>> 16;
            $428 = $427 & 2;
            $429 = $424 | $428;
            $430 = (14 - ($429))|0;
            $431 = $425 << $428;
            $432 = $431 >>> 15;
            $433 = (($430) + ($432))|0;
            $434 = $433 << 1;
            $435 = (($433) + 7)|0;
            $436 = $$4329$lcssa$i >>> $435;
            $437 = $436 & 1;
            $438 = $437 | $434;
            $$0339$i = $438;
           }
          }
          $439 = (7696 + ($$0339$i<<2)|0);
          $440 = ((($340)) + 28|0);
          HEAP32[$440>>2] = $$0339$i;
          $441 = ((($340)) + 16|0);
          $442 = ((($441)) + 4|0);
          HEAP32[$442>>2] = 0;
          HEAP32[$441>>2] = 0;
          $443 = 1 << $$0339$i;
          $444 = $445 & $443;
          $446 = ($444|0)==(0);
          if ($446) {
           $447 = $445 | $443;
           HEAP32[(7396)>>2] = $447;
           HEAP32[$439>>2] = $340;
           $448 = ((($340)) + 24|0);
           HEAP32[$448>>2] = $439;
           $449 = ((($340)) + 12|0);
           HEAP32[$449>>2] = $340;
           $450 = ((($340)) + 8|0);
           HEAP32[$450>>2] = $340;
           break;
          }
          $451 = HEAP32[$439>>2]|0;
          $452 = ($$0339$i|0)==(31);
          $453 = $$0339$i >>> 1;
          $454 = (25 - ($453))|0;
          $455 = $452 ? 0 : $454;
          $456 = $$4329$lcssa$i << $455;
          $$0322$i = $456;$$0323$i = $451;
          while(1) {
           $457 = ((($$0323$i)) + 4|0);
           $458 = HEAP32[$457>>2]|0;
           $459 = $458 & -8;
           $460 = ($459|0)==($$4329$lcssa$i|0);
           if ($460) {
            label = 106;
            break;
           }
           $461 = $$0322$i >>> 31;
           $462 = (((($$0323$i)) + 16|0) + ($461<<2)|0);
           $463 = $$0322$i << 1;
           $464 = HEAP32[$462>>2]|0;
           $465 = ($464|0)==(0|0);
           if ($465) {
            label = 105;
            break;
           } else {
            $$0322$i = $463;$$0323$i = $464;
           }
          }
          if ((label|0) == 105) {
           HEAP32[$462>>2] = $340;
           $466 = ((($340)) + 24|0);
           HEAP32[$466>>2] = $$0323$i;
           $467 = ((($340)) + 12|0);
           HEAP32[$467>>2] = $340;
           $468 = ((($340)) + 8|0);
           HEAP32[$468>>2] = $340;
           break;
          }
          else if ((label|0) == 106) {
           $469 = ((($$0323$i)) + 8|0);
           $470 = HEAP32[$469>>2]|0;
           $471 = ((($470)) + 12|0);
           HEAP32[$471>>2] = $340;
           HEAP32[$469>>2] = $340;
           $472 = ((($340)) + 8|0);
           HEAP32[$472>>2] = $470;
           $473 = ((($340)) + 12|0);
           HEAP32[$473>>2] = $$0323$i;
           $474 = ((($340)) + 24|0);
           HEAP32[$474>>2] = 0;
           break;
          }
         }
        } while(0);
        $475 = ((($$4$lcssa$i)) + 8|0);
        $$2 = $475;
       } else {
        $$2 = 0;
       }
      } else {
       $$0193 = $241;
       label = 108;
      }
     }
    }
   }
  }
 } while(0);
 L151: do {
  if ((label|0) == 108) {
   $476 = HEAP32[(7400)>>2]|0;
   $477 = ($476>>>0)<($$0193>>>0);
   if (!($477)) {
    $478 = (($476) - ($$0193))|0;
    $479 = HEAP32[(7412)>>2]|0;
    $480 = ($478>>>0)>(15);
    if ($480) {
     $481 = (($479) + ($$0193)|0);
     HEAP32[(7412)>>2] = $481;
     HEAP32[(7400)>>2] = $478;
     $482 = $478 | 1;
     $483 = ((($481)) + 4|0);
     HEAP32[$483>>2] = $482;
     $484 = (($481) + ($478)|0);
     HEAP32[$484>>2] = $478;
     $485 = $$0193 | 3;
     $486 = ((($479)) + 4|0);
     HEAP32[$486>>2] = $485;
    } else {
     HEAP32[(7400)>>2] = 0;
     HEAP32[(7412)>>2] = 0;
     $487 = $476 | 3;
     $488 = ((($479)) + 4|0);
     HEAP32[$488>>2] = $487;
     $489 = (($479) + ($476)|0);
     $490 = ((($489)) + 4|0);
     $491 = HEAP32[$490>>2]|0;
     $492 = $491 | 1;
     HEAP32[$490>>2] = $492;
    }
    $493 = ((($479)) + 8|0);
    $$2 = $493;
    break;
   }
   $494 = HEAP32[(7404)>>2]|0;
   $495 = ($494>>>0)>($$0193>>>0);
   if ($495) {
    $496 = (($494) - ($$0193))|0;
    HEAP32[(7404)>>2] = $496;
    $497 = HEAP32[(7416)>>2]|0;
    $498 = (($497) + ($$0193)|0);
    HEAP32[(7416)>>2] = $498;
    $499 = $496 | 1;
    $500 = ((($498)) + 4|0);
    HEAP32[$500>>2] = $499;
    $501 = $$0193 | 3;
    $502 = ((($497)) + 4|0);
    HEAP32[$502>>2] = $501;
    $503 = ((($497)) + 8|0);
    $$2 = $503;
    break;
   }
   $504 = HEAP32[1835]|0;
   $505 = ($504|0)==(0);
   if ($505) {
    (___pthread_mutex_lock(7364)|0);
    $506 = HEAP32[1835]|0;
    $507 = ($506|0)==(0);
    if ($507) {
     HEAP32[(7348)>>2] = 4096;
     HEAP32[(7344)>>2] = 4096;
     HEAP32[(7352)>>2] = -1;
     HEAP32[(7356)>>2] = -1;
     HEAP32[(7360)>>2] = 2;
     HEAP32[(7836)>>2] = 2;
     $508 = (_pthread_mutexattr_init($1)|0);
     $509 = ($508|0)==(0);
     if ($509) {
      $510 = (_pthread_mutex_init((7840),$1)|0);
      $511 = ($510|0)==(0);
      if ($511) {
      }
     }
     $512 = $2;
     $513 = $512 & -16;
     $514 = $513 ^ 1431655768;
     HEAP32[$2>>2] = $514;
     Atomics_store(HEAP32,1835,$514)|0;
    }
    (___pthread_mutex_unlock(7364)|0);
   }
   $515 = (($$0193) + 48)|0;
   $516 = HEAP32[(7348)>>2]|0;
   $517 = (($$0193) + 47)|0;
   $518 = (($516) + ($517))|0;
   $519 = (0 - ($516))|0;
   $520 = $518 & $519;
   $521 = ($520>>>0)>($$0193>>>0);
   if ($521) {
    $522 = HEAP32[(7832)>>2]|0;
    $523 = ($522|0)==(0);
    if (!($523)) {
     $524 = HEAP32[(7824)>>2]|0;
     $525 = (($524) + ($520))|0;
     $526 = ($525>>>0)<=($524>>>0);
     $527 = ($525>>>0)>($522>>>0);
     $or$cond1$i = $526 | $527;
     if ($or$cond1$i) {
      $$2 = 0;
      break;
     }
    }
    $528 = HEAP32[(7836)>>2]|0;
    $529 = $528 & 4;
    $530 = ($529|0)==(0);
    if ($530) {
     $531 = HEAP32[(7416)>>2]|0;
     $532 = ($531|0)==(0|0);
     L179: do {
      if ($532) {
       label = 131;
      } else {
       $$0$i$i = (7868);
       while(1) {
        $533 = HEAP32[$$0$i$i>>2]|0;
        $534 = ($533>>>0)>($531>>>0);
        if (!($534)) {
         $535 = ((($$0$i$i)) + 4|0);
         $536 = HEAP32[$535>>2]|0;
         $537 = (($533) + ($536)|0);
         $538 = ($537>>>0)>($531>>>0);
         if ($538) {
          break;
         }
        }
        $539 = ((($$0$i$i)) + 8|0);
        $540 = HEAP32[$539>>2]|0;
        $541 = ($540|0)==(0|0);
        if ($541) {
         label = 131;
         break L179;
        } else {
         $$0$i$i = $540;
        }
       }
       (___pthread_mutex_lock(7364)|0);
       $564 = HEAP32[(7404)>>2]|0;
       $565 = HEAP32[(7348)>>2]|0;
       $566 = (($517) - ($564))|0;
       $567 = (($566) + ($565))|0;
       $568 = (0 - ($565))|0;
       $569 = $567 & $568;
       $570 = ($569>>>0)<(2147483647);
       if ($570) {
        $571 = (_sbrk(($569|0))|0);
        $572 = HEAP32[$$0$i$i>>2]|0;
        $573 = HEAP32[$535>>2]|0;
        $574 = (($572) + ($573)|0);
        $575 = ($571|0)==($574|0);
        if ($575) {
         $576 = ($571|0)==((-1)|0);
         if ($576) {
          $$2234243136$i = $569;
          label = 145;
         } else {
          $$3229$i = $571;$$3235$i = $569;
         }
        } else {
         $$2247$ph$i = $571;$$2253$ph$i = $569;
         label = 139;
        }
       } else {
        $$2234243136$i = 0;
        label = 145;
       }
      }
     } while(0);
     do {
      if ((label|0) == 131) {
       (___pthread_mutex_lock(7364)|0);
       $542 = (_sbrk(0)|0);
       $543 = ($542|0)==((-1)|0);
       if ($543) {
        $$2234243136$i = 0;
        label = 145;
       } else {
        $544 = $542;
        $545 = HEAP32[(7344)>>2]|0;
        $546 = (($545) + -1)|0;
        $547 = $546 & $544;
        $548 = ($547|0)==(0);
        $549 = (($546) + ($544))|0;
        $550 = (0 - ($545))|0;
        $551 = $549 & $550;
        $552 = (($551) - ($544))|0;
        $553 = $548 ? 0 : $552;
        $$$i = (($553) + ($520))|0;
        $554 = HEAP32[(7824)>>2]|0;
        $555 = (($$$i) + ($554))|0;
        $556 = ($$$i>>>0)>($$0193>>>0);
        $557 = ($$$i>>>0)<(2147483647);
        $or$cond$i207 = $556 & $557;
        if ($or$cond$i207) {
         $558 = HEAP32[(7832)>>2]|0;
         $559 = ($558|0)==(0);
         if (!($559)) {
          $560 = ($555>>>0)<=($554>>>0);
          $561 = ($555>>>0)>($558>>>0);
          $or$cond2$i208 = $560 | $561;
          if ($or$cond2$i208) {
           $$2234243136$i = 0;
           label = 145;
           break;
          }
         }
         $562 = (_sbrk(($$$i|0))|0);
         $563 = ($562|0)==($542|0);
         if ($563) {
          $$3229$i = $542;$$3235$i = $$$i;
         } else {
          $$2247$ph$i = $562;$$2253$ph$i = $$$i;
          label = 139;
         }
        } else {
         $$2234243136$i = 0;
         label = 145;
        }
       }
      }
     } while(0);
     do {
      if ((label|0) == 139) {
       $577 = (0 - ($$2253$ph$i))|0;
       $578 = ($$2247$ph$i|0)!=((-1)|0);
       $579 = ($$2253$ph$i>>>0)<(2147483647);
       $or$cond7$i = $579 & $578;
       $580 = ($515>>>0)>($$2253$ph$i>>>0);
       $or$cond10$i = $580 & $or$cond7$i;
       if (!($or$cond10$i)) {
        $590 = ($$2247$ph$i|0)==((-1)|0);
        if ($590) {
         $$2234243136$i = 0;
         label = 145;
         break;
        } else {
         $$3229$i = $$2247$ph$i;$$3235$i = $$2253$ph$i;
         break;
        }
       }
       $581 = HEAP32[(7348)>>2]|0;
       $582 = (($517) - ($$2253$ph$i))|0;
       $583 = (($582) + ($581))|0;
       $584 = (0 - ($581))|0;
       $585 = $583 & $584;
       $586 = ($585>>>0)<(2147483647);
       if ($586) {
        $587 = (_sbrk(($585|0))|0);
        $588 = ($587|0)==((-1)|0);
        if ($588) {
         (_sbrk(($577|0))|0);
         $$2234243136$i = 0;
         label = 145;
         break;
        } else {
         $589 = (($585) + ($$2253$ph$i))|0;
         $$3229$i = $$2247$ph$i;$$3235$i = $589;
         break;
        }
       } else {
        $$3229$i = $$2247$ph$i;$$3235$i = $$2253$ph$i;
       }
      }
     } while(0);
     if ((label|0) == 145) {
      $591 = HEAP32[(7836)>>2]|0;
      $592 = $591 | 4;
      HEAP32[(7836)>>2] = $592;
      $$3229$i = (-1);$$3235$i = $$2234243136$i;
     }
     (___pthread_mutex_unlock(7364)|0);
     $$4230$i = $$3229$i;$$4236$i = $$3235$i;
    } else {
     $$4230$i = (-1);$$4236$i = 0;
    }
    $593 = ($$4230$i|0)==((-1)|0);
    $594 = ($520>>>0)<(2147483647);
    $or$cond9$i = $594 & $593;
    if ($or$cond9$i) {
     (___pthread_mutex_lock(7364)|0);
     $595 = (_sbrk(($520|0))|0);
     $596 = (_sbrk(0)|0);
     (___pthread_mutex_unlock(7364)|0);
     $597 = ($595|0)!=((-1)|0);
     $598 = ($596|0)!=((-1)|0);
     $or$cond5$i = $597 & $598;
     $599 = ($595>>>0)<($596>>>0);
     $or$cond11$i = $599 & $or$cond5$i;
     $600 = $596;
     $601 = $595;
     $602 = (($600) - ($601))|0;
     $603 = (($$0193) + 40)|0;
     $604 = ($602>>>0)>($603>>>0);
     $$$4236$i = $604 ? $602 : $$4236$i;
     $$$4230$i = $604 ? $595 : (-1);
     if ($or$cond11$i) {
      $$7$i = $$$4230$i;$$7239$i = $$$4236$i;
      label = 149;
     }
    } else {
     $$7$i = $$4230$i;$$7239$i = $$4236$i;
     label = 149;
    }
    if ((label|0) == 149) {
     $605 = ($$7$i|0)==((-1)|0);
     if (!($605)) {
      $606 = HEAP32[(7824)>>2]|0;
      $607 = (($606) + ($$7239$i))|0;
      HEAP32[(7824)>>2] = $607;
      $608 = HEAP32[(7828)>>2]|0;
      $609 = ($607>>>0)>($608>>>0);
      if ($609) {
       HEAP32[(7828)>>2] = $607;
      }
      $610 = HEAP32[(7416)>>2]|0;
      $611 = ($610|0)==(0|0);
      do {
       if ($611) {
        $612 = HEAP32[(7408)>>2]|0;
        $613 = ($612|0)==(0|0);
        $614 = ($$7$i>>>0)<($612>>>0);
        $or$cond12$i = $613 | $614;
        if ($or$cond12$i) {
         HEAP32[(7408)>>2] = $$7$i;
        }
        HEAP32[(7868)>>2] = $$7$i;
        HEAP32[(7872)>>2] = $$7239$i;
        HEAP32[(7880)>>2] = 0;
        $615 = HEAP32[1835]|0;
        HEAP32[(7428)>>2] = $615;
        HEAP32[(7424)>>2] = -1;
        $$01$i$i = 0;
        while(1) {
         $616 = $$01$i$i << 1;
         $617 = (7432 + ($616<<2)|0);
         $618 = ((($617)) + 12|0);
         HEAP32[$618>>2] = $617;
         $619 = ((($617)) + 8|0);
         HEAP32[$619>>2] = $617;
         $620 = (($$01$i$i) + 1)|0;
         $exitcond$i$i = ($620|0)==(32);
         if ($exitcond$i$i) {
          break;
         } else {
          $$01$i$i = $620;
         }
        }
        $621 = (($$7239$i) + -40)|0;
        $622 = ((($$7$i)) + 8|0);
        $623 = $622;
        $624 = $623 & 7;
        $625 = ($624|0)==(0);
        $626 = (0 - ($623))|0;
        $627 = $626 & 7;
        $628 = $625 ? 0 : $627;
        $629 = (($$7$i) + ($628)|0);
        $630 = (($621) - ($628))|0;
        HEAP32[(7416)>>2] = $629;
        HEAP32[(7404)>>2] = $630;
        $631 = $630 | 1;
        $632 = ((($629)) + 4|0);
        HEAP32[$632>>2] = $631;
        $633 = (($629) + ($630)|0);
        $634 = ((($633)) + 4|0);
        HEAP32[$634>>2] = 40;
        $635 = HEAP32[(7356)>>2]|0;
        HEAP32[(7420)>>2] = $635;
       } else {
        $$024362$i = (7868);
        while(1) {
         $636 = HEAP32[$$024362$i>>2]|0;
         $637 = ((($$024362$i)) + 4|0);
         $638 = HEAP32[$637>>2]|0;
         $639 = (($636) + ($638)|0);
         $640 = ($$7$i|0)==($639|0);
         if ($640) {
          label = 160;
          break;
         }
         $641 = ((($$024362$i)) + 8|0);
         $642 = HEAP32[$641>>2]|0;
         $643 = ($642|0)==(0|0);
         if ($643) {
          break;
         } else {
          $$024362$i = $642;
         }
        }
        if ((label|0) == 160) {
         $644 = ((($$024362$i)) + 12|0);
         $645 = HEAP32[$644>>2]|0;
         $646 = $645 & 8;
         $647 = ($646|0)==(0);
         if ($647) {
          $648 = ($610>>>0)>=($636>>>0);
          $649 = ($610>>>0)<($$7$i>>>0);
          $or$cond42$i = $649 & $648;
          if ($or$cond42$i) {
           $650 = (($638) + ($$7239$i))|0;
           HEAP32[$637>>2] = $650;
           $651 = HEAP32[(7404)>>2]|0;
           $652 = ((($610)) + 8|0);
           $653 = $652;
           $654 = $653 & 7;
           $655 = ($654|0)==(0);
           $656 = (0 - ($653))|0;
           $657 = $656 & 7;
           $658 = $655 ? 0 : $657;
           $659 = (($610) + ($658)|0);
           $660 = (($$7239$i) - ($658))|0;
           $661 = (($651) + ($660))|0;
           HEAP32[(7416)>>2] = $659;
           HEAP32[(7404)>>2] = $661;
           $662 = $661 | 1;
           $663 = ((($659)) + 4|0);
           HEAP32[$663>>2] = $662;
           $664 = (($659) + ($661)|0);
           $665 = ((($664)) + 4|0);
           HEAP32[$665>>2] = 40;
           $666 = HEAP32[(7356)>>2]|0;
           HEAP32[(7420)>>2] = $666;
           break;
          }
         }
        }
        $667 = HEAP32[(7408)>>2]|0;
        $668 = ($$7$i>>>0)<($667>>>0);
        if ($668) {
         HEAP32[(7408)>>2] = $$7$i;
        }
        $669 = (($$7$i) + ($$7239$i)|0);
        $$124461$i = (7868);
        while(1) {
         $670 = HEAP32[$$124461$i>>2]|0;
         $671 = ($670|0)==($669|0);
         if ($671) {
          label = 168;
          break;
         }
         $672 = ((($$124461$i)) + 8|0);
         $673 = HEAP32[$672>>2]|0;
         $674 = ($673|0)==(0|0);
         if ($674) {
          break;
         } else {
          $$124461$i = $673;
         }
        }
        if ((label|0) == 168) {
         $675 = ((($$124461$i)) + 12|0);
         $676 = HEAP32[$675>>2]|0;
         $677 = $676 & 8;
         $678 = ($677|0)==(0);
         if ($678) {
          HEAP32[$$124461$i>>2] = $$7$i;
          $679 = ((($$124461$i)) + 4|0);
          $680 = HEAP32[$679>>2]|0;
          $681 = (($680) + ($$7239$i))|0;
          HEAP32[$679>>2] = $681;
          $682 = ((($$7$i)) + 8|0);
          $683 = $682;
          $684 = $683 & 7;
          $685 = ($684|0)==(0);
          $686 = (0 - ($683))|0;
          $687 = $686 & 7;
          $688 = $685 ? 0 : $687;
          $689 = (($$7$i) + ($688)|0);
          $690 = ((($669)) + 8|0);
          $691 = $690;
          $692 = $691 & 7;
          $693 = ($692|0)==(0);
          $694 = (0 - ($691))|0;
          $695 = $694 & 7;
          $696 = $693 ? 0 : $695;
          $697 = (($669) + ($696)|0);
          $698 = $697;
          $699 = $689;
          $700 = (($698) - ($699))|0;
          $701 = (($689) + ($$0193)|0);
          $702 = (($700) - ($$0193))|0;
          $703 = $$0193 | 3;
          $704 = ((($689)) + 4|0);
          HEAP32[$704>>2] = $703;
          $705 = ($697|0)==($610|0);
          do {
           if ($705) {
            $706 = HEAP32[(7404)>>2]|0;
            $707 = (($706) + ($702))|0;
            HEAP32[(7404)>>2] = $707;
            HEAP32[(7416)>>2] = $701;
            $708 = $707 | 1;
            $709 = ((($701)) + 4|0);
            HEAP32[$709>>2] = $708;
           } else {
            $710 = HEAP32[(7412)>>2]|0;
            $711 = ($697|0)==($710|0);
            if ($711) {
             $712 = HEAP32[(7400)>>2]|0;
             $713 = (($712) + ($702))|0;
             HEAP32[(7400)>>2] = $713;
             HEAP32[(7412)>>2] = $701;
             $714 = $713 | 1;
             $715 = ((($701)) + 4|0);
             HEAP32[$715>>2] = $714;
             $716 = (($701) + ($713)|0);
             HEAP32[$716>>2] = $713;
             break;
            }
            $717 = ((($697)) + 4|0);
            $718 = HEAP32[$717>>2]|0;
            $719 = $718 & 3;
            $720 = ($719|0)==(1);
            if ($720) {
             $721 = $718 & -8;
             $722 = $718 >>> 3;
             $723 = ($718>>>0)<(256);
             L250: do {
              if ($723) {
               $724 = ((($697)) + 8|0);
               $725 = HEAP32[$724>>2]|0;
               $726 = ((($697)) + 12|0);
               $727 = HEAP32[$726>>2]|0;
               $728 = ($727|0)==($725|0);
               if ($728) {
                $729 = 1 << $722;
                $730 = $729 ^ -1;
                $731 = HEAP32[1848]|0;
                $732 = $731 & $730;
                HEAP32[1848] = $732;
                break;
               } else {
                $733 = ((($725)) + 12|0);
                HEAP32[$733>>2] = $727;
                $734 = ((($727)) + 8|0);
                HEAP32[$734>>2] = $725;
                break;
               }
              } else {
               $735 = ((($697)) + 24|0);
               $736 = HEAP32[$735>>2]|0;
               $737 = ((($697)) + 12|0);
               $738 = HEAP32[$737>>2]|0;
               $739 = ($738|0)==($697|0);
               do {
                if ($739) {
                 $744 = ((($697)) + 16|0);
                 $745 = ((($744)) + 4|0);
                 $746 = HEAP32[$745>>2]|0;
                 $747 = ($746|0)==(0|0);
                 if ($747) {
                  $748 = HEAP32[$744>>2]|0;
                  $749 = ($748|0)==(0|0);
                  if ($749) {
                   $$3$i$i = 0;
                   break;
                  } else {
                   $$1264$i$i = $748;$$1266$i$i = $744;
                  }
                 } else {
                  $$1264$i$i = $746;$$1266$i$i = $745;
                 }
                 while(1) {
                  $750 = ((($$1264$i$i)) + 20|0);
                  $751 = HEAP32[$750>>2]|0;
                  $752 = ($751|0)==(0|0);
                  if (!($752)) {
                   $$1264$i$i = $751;$$1266$i$i = $750;
                   continue;
                  }
                  $753 = ((($$1264$i$i)) + 16|0);
                  $754 = HEAP32[$753>>2]|0;
                  $755 = ($754|0)==(0|0);
                  if ($755) {
                   break;
                  } else {
                   $$1264$i$i = $754;$$1266$i$i = $753;
                  }
                 }
                 HEAP32[$$1266$i$i>>2] = 0;
                 $$3$i$i = $$1264$i$i;
                } else {
                 $740 = ((($697)) + 8|0);
                 $741 = HEAP32[$740>>2]|0;
                 $742 = ((($741)) + 12|0);
                 HEAP32[$742>>2] = $738;
                 $743 = ((($738)) + 8|0);
                 HEAP32[$743>>2] = $741;
                 $$3$i$i = $738;
                }
               } while(0);
               $756 = ($736|0)==(0|0);
               if ($756) {
                break;
               }
               $757 = ((($697)) + 28|0);
               $758 = HEAP32[$757>>2]|0;
               $759 = (7696 + ($758<<2)|0);
               $760 = HEAP32[$759>>2]|0;
               $761 = ($697|0)==($760|0);
               do {
                if ($761) {
                 HEAP32[$759>>2] = $$3$i$i;
                 $cond$i$i = ($$3$i$i|0)==(0|0);
                 if (!($cond$i$i)) {
                  break;
                 }
                 $762 = 1 << $758;
                 $763 = $762 ^ -1;
                 $764 = HEAP32[(7396)>>2]|0;
                 $765 = $764 & $763;
                 HEAP32[(7396)>>2] = $765;
                 break L250;
                } else {
                 $766 = ((($736)) + 16|0);
                 $767 = HEAP32[$766>>2]|0;
                 $not$$i$i = ($767|0)!=($697|0);
                 $$sink1$i$i = $not$$i$i&1;
                 $768 = (((($736)) + 16|0) + ($$sink1$i$i<<2)|0);
                 HEAP32[$768>>2] = $$3$i$i;
                 $769 = ($$3$i$i|0)==(0|0);
                 if ($769) {
                  break L250;
                 }
                }
               } while(0);
               $770 = ((($$3$i$i)) + 24|0);
               HEAP32[$770>>2] = $736;
               $771 = ((($697)) + 16|0);
               $772 = HEAP32[$771>>2]|0;
               $773 = ($772|0)==(0|0);
               if (!($773)) {
                $774 = ((($$3$i$i)) + 16|0);
                HEAP32[$774>>2] = $772;
                $775 = ((($772)) + 24|0);
                HEAP32[$775>>2] = $$3$i$i;
               }
               $776 = ((($771)) + 4|0);
               $777 = HEAP32[$776>>2]|0;
               $778 = ($777|0)==(0|0);
               if ($778) {
                break;
               }
               $779 = ((($$3$i$i)) + 20|0);
               HEAP32[$779>>2] = $777;
               $780 = ((($777)) + 24|0);
               HEAP32[$780>>2] = $$3$i$i;
              }
             } while(0);
             $781 = (($697) + ($721)|0);
             $782 = (($721) + ($702))|0;
             $$0$i17$i = $781;$$0260$i$i = $782;
            } else {
             $$0$i17$i = $697;$$0260$i$i = $702;
            }
            $783 = ((($$0$i17$i)) + 4|0);
            $784 = HEAP32[$783>>2]|0;
            $785 = $784 & -2;
            HEAP32[$783>>2] = $785;
            $786 = $$0260$i$i | 1;
            $787 = ((($701)) + 4|0);
            HEAP32[$787>>2] = $786;
            $788 = (($701) + ($$0260$i$i)|0);
            HEAP32[$788>>2] = $$0260$i$i;
            $789 = $$0260$i$i >>> 3;
            $790 = ($$0260$i$i>>>0)<(256);
            if ($790) {
             $791 = $789 << 1;
             $792 = (7432 + ($791<<2)|0);
             $793 = HEAP32[1848]|0;
             $794 = 1 << $789;
             $795 = $793 & $794;
             $796 = ($795|0)==(0);
             if ($796) {
              $797 = $793 | $794;
              HEAP32[1848] = $797;
              $$pre$i$i = ((($792)) + 8|0);
              $$0268$i$i = $792;$$pre$phi$i$iZ2D = $$pre$i$i;
             } else {
              $798 = ((($792)) + 8|0);
              $799 = HEAP32[$798>>2]|0;
              $$0268$i$i = $799;$$pre$phi$i$iZ2D = $798;
             }
             HEAP32[$$pre$phi$i$iZ2D>>2] = $701;
             $800 = ((($$0268$i$i)) + 12|0);
             HEAP32[$800>>2] = $701;
             $801 = ((($701)) + 8|0);
             HEAP32[$801>>2] = $$0268$i$i;
             $802 = ((($701)) + 12|0);
             HEAP32[$802>>2] = $792;
             break;
            }
            $803 = $$0260$i$i >>> 8;
            $804 = ($803|0)==(0);
            do {
             if ($804) {
              $$0269$i$i = 0;
             } else {
              $805 = ($$0260$i$i>>>0)>(16777215);
              if ($805) {
               $$0269$i$i = 31;
               break;
              }
              $806 = (($803) + 1048320)|0;
              $807 = $806 >>> 16;
              $808 = $807 & 8;
              $809 = $803 << $808;
              $810 = (($809) + 520192)|0;
              $811 = $810 >>> 16;
              $812 = $811 & 4;
              $813 = $812 | $808;
              $814 = $809 << $812;
              $815 = (($814) + 245760)|0;
              $816 = $815 >>> 16;
              $817 = $816 & 2;
              $818 = $813 | $817;
              $819 = (14 - ($818))|0;
              $820 = $814 << $817;
              $821 = $820 >>> 15;
              $822 = (($819) + ($821))|0;
              $823 = $822 << 1;
              $824 = (($822) + 7)|0;
              $825 = $$0260$i$i >>> $824;
              $826 = $825 & 1;
              $827 = $826 | $823;
              $$0269$i$i = $827;
             }
            } while(0);
            $828 = (7696 + ($$0269$i$i<<2)|0);
            $829 = ((($701)) + 28|0);
            HEAP32[$829>>2] = $$0269$i$i;
            $830 = ((($701)) + 16|0);
            $831 = ((($830)) + 4|0);
            HEAP32[$831>>2] = 0;
            HEAP32[$830>>2] = 0;
            $832 = HEAP32[(7396)>>2]|0;
            $833 = 1 << $$0269$i$i;
            $834 = $832 & $833;
            $835 = ($834|0)==(0);
            if ($835) {
             $836 = $832 | $833;
             HEAP32[(7396)>>2] = $836;
             HEAP32[$828>>2] = $701;
             $837 = ((($701)) + 24|0);
             HEAP32[$837>>2] = $828;
             $838 = ((($701)) + 12|0);
             HEAP32[$838>>2] = $701;
             $839 = ((($701)) + 8|0);
             HEAP32[$839>>2] = $701;
             break;
            }
            $840 = HEAP32[$828>>2]|0;
            $841 = ($$0269$i$i|0)==(31);
            $842 = $$0269$i$i >>> 1;
            $843 = (25 - ($842))|0;
            $844 = $841 ? 0 : $843;
            $845 = $$0260$i$i << $844;
            $$0261$i$i = $845;$$0262$i$i = $840;
            while(1) {
             $846 = ((($$0262$i$i)) + 4|0);
             $847 = HEAP32[$846>>2]|0;
             $848 = $847 & -8;
             $849 = ($848|0)==($$0260$i$i|0);
             if ($849) {
              label = 209;
              break;
             }
             $850 = $$0261$i$i >>> 31;
             $851 = (((($$0262$i$i)) + 16|0) + ($850<<2)|0);
             $852 = $$0261$i$i << 1;
             $853 = HEAP32[$851>>2]|0;
             $854 = ($853|0)==(0|0);
             if ($854) {
              label = 208;
              break;
             } else {
              $$0261$i$i = $852;$$0262$i$i = $853;
             }
            }
            if ((label|0) == 208) {
             HEAP32[$851>>2] = $701;
             $855 = ((($701)) + 24|0);
             HEAP32[$855>>2] = $$0262$i$i;
             $856 = ((($701)) + 12|0);
             HEAP32[$856>>2] = $701;
             $857 = ((($701)) + 8|0);
             HEAP32[$857>>2] = $701;
             break;
            }
            else if ((label|0) == 209) {
             $858 = ((($$0262$i$i)) + 8|0);
             $859 = HEAP32[$858>>2]|0;
             $860 = ((($859)) + 12|0);
             HEAP32[$860>>2] = $701;
             HEAP32[$858>>2] = $701;
             $861 = ((($701)) + 8|0);
             HEAP32[$861>>2] = $859;
             $862 = ((($701)) + 12|0);
             HEAP32[$862>>2] = $$0262$i$i;
             $863 = ((($701)) + 24|0);
             HEAP32[$863>>2] = 0;
             break;
            }
           }
          } while(0);
          $988 = ((($689)) + 8|0);
          $$2 = $988;
          break L151;
         }
        }
        $$0$i$i$i = (7868);
        while(1) {
         $864 = HEAP32[$$0$i$i$i>>2]|0;
         $865 = ($864>>>0)>($610>>>0);
         if (!($865)) {
          $866 = ((($$0$i$i$i)) + 4|0);
          $867 = HEAP32[$866>>2]|0;
          $868 = (($864) + ($867)|0);
          $869 = ($868>>>0)>($610>>>0);
          if ($869) {
           break;
          }
         }
         $870 = ((($$0$i$i$i)) + 8|0);
         $871 = HEAP32[$870>>2]|0;
         $$0$i$i$i = $871;
        }
        $872 = ((($868)) + -47|0);
        $873 = ((($872)) + 8|0);
        $874 = $873;
        $875 = $874 & 7;
        $876 = ($875|0)==(0);
        $877 = (0 - ($874))|0;
        $878 = $877 & 7;
        $879 = $876 ? 0 : $878;
        $880 = (($872) + ($879)|0);
        $881 = ((($610)) + 16|0);
        $882 = ($880>>>0)<($881>>>0);
        $883 = $882 ? $610 : $880;
        $884 = ((($883)) + 8|0);
        $885 = ((($883)) + 24|0);
        $886 = (($$7239$i) + -40)|0;
        $887 = ((($$7$i)) + 8|0);
        $888 = $887;
        $889 = $888 & 7;
        $890 = ($889|0)==(0);
        $891 = (0 - ($888))|0;
        $892 = $891 & 7;
        $893 = $890 ? 0 : $892;
        $894 = (($$7$i) + ($893)|0);
        $895 = (($886) - ($893))|0;
        HEAP32[(7416)>>2] = $894;
        HEAP32[(7404)>>2] = $895;
        $896 = $895 | 1;
        $897 = ((($894)) + 4|0);
        HEAP32[$897>>2] = $896;
        $898 = (($894) + ($895)|0);
        $899 = ((($898)) + 4|0);
        HEAP32[$899>>2] = 40;
        $900 = HEAP32[(7356)>>2]|0;
        HEAP32[(7420)>>2] = $900;
        $901 = ((($883)) + 4|0);
        HEAP32[$901>>2] = 27;
        ;HEAP32[$884>>2]=HEAP32[(7868)>>2]|0;HEAP32[$884+4>>2]=HEAP32[(7868)+4>>2]|0;HEAP32[$884+8>>2]=HEAP32[(7868)+8>>2]|0;HEAP32[$884+12>>2]=HEAP32[(7868)+12>>2]|0;
        HEAP32[(7868)>>2] = $$7$i;
        HEAP32[(7872)>>2] = $$7239$i;
        HEAP32[(7880)>>2] = 0;
        HEAP32[(7876)>>2] = $884;
        $903 = $885;
        while(1) {
         $902 = ((($903)) + 4|0);
         HEAP32[$902>>2] = 7;
         $904 = ((($903)) + 8|0);
         $905 = ($904>>>0)<($868>>>0);
         if ($905) {
          $903 = $902;
         } else {
          break;
         }
        }
        $906 = ($883|0)==($610|0);
        if (!($906)) {
         $907 = $883;
         $908 = $610;
         $909 = (($907) - ($908))|0;
         $910 = HEAP32[$901>>2]|0;
         $911 = $910 & -2;
         HEAP32[$901>>2] = $911;
         $912 = $909 | 1;
         $913 = ((($610)) + 4|0);
         HEAP32[$913>>2] = $912;
         HEAP32[$883>>2] = $909;
         $914 = $909 >>> 3;
         $915 = ($909>>>0)<(256);
         if ($915) {
          $916 = $914 << 1;
          $917 = (7432 + ($916<<2)|0);
          $918 = HEAP32[1848]|0;
          $919 = 1 << $914;
          $920 = $918 & $919;
          $921 = ($920|0)==(0);
          if ($921) {
           $922 = $918 | $919;
           HEAP32[1848] = $922;
           $$pre$i18$i = ((($917)) + 8|0);
           $$0206$i$i = $917;$$pre$phi$i19$iZ2D = $$pre$i18$i;
          } else {
           $923 = ((($917)) + 8|0);
           $924 = HEAP32[$923>>2]|0;
           $$0206$i$i = $924;$$pre$phi$i19$iZ2D = $923;
          }
          HEAP32[$$pre$phi$i19$iZ2D>>2] = $610;
          $925 = ((($$0206$i$i)) + 12|0);
          HEAP32[$925>>2] = $610;
          $926 = ((($610)) + 8|0);
          HEAP32[$926>>2] = $$0206$i$i;
          $927 = ((($610)) + 12|0);
          HEAP32[$927>>2] = $917;
          break;
         }
         $928 = $909 >>> 8;
         $929 = ($928|0)==(0);
         do {
          if ($929) {
           $$0207$i$i = 0;
          } else {
           $930 = ($909>>>0)>(16777215);
           if ($930) {
            $$0207$i$i = 31;
            break;
           }
           $931 = (($928) + 1048320)|0;
           $932 = $931 >>> 16;
           $933 = $932 & 8;
           $934 = $928 << $933;
           $935 = (($934) + 520192)|0;
           $936 = $935 >>> 16;
           $937 = $936 & 4;
           $938 = $937 | $933;
           $939 = $934 << $937;
           $940 = (($939) + 245760)|0;
           $941 = $940 >>> 16;
           $942 = $941 & 2;
           $943 = $938 | $942;
           $944 = (14 - ($943))|0;
           $945 = $939 << $942;
           $946 = $945 >>> 15;
           $947 = (($944) + ($946))|0;
           $948 = $947 << 1;
           $949 = (($947) + 7)|0;
           $950 = $909 >>> $949;
           $951 = $950 & 1;
           $952 = $951 | $948;
           $$0207$i$i = $952;
          }
         } while(0);
         $953 = (7696 + ($$0207$i$i<<2)|0);
         $954 = ((($610)) + 28|0);
         HEAP32[$954>>2] = $$0207$i$i;
         $955 = ((($610)) + 20|0);
         HEAP32[$955>>2] = 0;
         HEAP32[$881>>2] = 0;
         $956 = HEAP32[(7396)>>2]|0;
         $957 = 1 << $$0207$i$i;
         $958 = $956 & $957;
         $959 = ($958|0)==(0);
         if ($959) {
          $960 = $956 | $957;
          HEAP32[(7396)>>2] = $960;
          HEAP32[$953>>2] = $610;
          $961 = ((($610)) + 24|0);
          HEAP32[$961>>2] = $953;
          $962 = ((($610)) + 12|0);
          HEAP32[$962>>2] = $610;
          $963 = ((($610)) + 8|0);
          HEAP32[$963>>2] = $610;
          break;
         }
         $964 = HEAP32[$953>>2]|0;
         $965 = ($$0207$i$i|0)==(31);
         $966 = $$0207$i$i >>> 1;
         $967 = (25 - ($966))|0;
         $968 = $965 ? 0 : $967;
         $969 = $909 << $968;
         $$0201$i$i = $969;$$0202$i$i = $964;
         while(1) {
          $970 = ((($$0202$i$i)) + 4|0);
          $971 = HEAP32[$970>>2]|0;
          $972 = $971 & -8;
          $973 = ($972|0)==($909|0);
          if ($973) {
           label = 231;
           break;
          }
          $974 = $$0201$i$i >>> 31;
          $975 = (((($$0202$i$i)) + 16|0) + ($974<<2)|0);
          $976 = $$0201$i$i << 1;
          $977 = HEAP32[$975>>2]|0;
          $978 = ($977|0)==(0|0);
          if ($978) {
           label = 230;
           break;
          } else {
           $$0201$i$i = $976;$$0202$i$i = $977;
          }
         }
         if ((label|0) == 230) {
          HEAP32[$975>>2] = $610;
          $979 = ((($610)) + 24|0);
          HEAP32[$979>>2] = $$0202$i$i;
          $980 = ((($610)) + 12|0);
          HEAP32[$980>>2] = $610;
          $981 = ((($610)) + 8|0);
          HEAP32[$981>>2] = $610;
          break;
         }
         else if ((label|0) == 231) {
          $982 = ((($$0202$i$i)) + 8|0);
          $983 = HEAP32[$982>>2]|0;
          $984 = ((($983)) + 12|0);
          HEAP32[$984>>2] = $610;
          HEAP32[$982>>2] = $610;
          $985 = ((($610)) + 8|0);
          HEAP32[$985>>2] = $983;
          $986 = ((($610)) + 12|0);
          HEAP32[$986>>2] = $$0202$i$i;
          $987 = ((($610)) + 24|0);
          HEAP32[$987>>2] = 0;
          break;
         }
        }
       }
      } while(0);
      $989 = HEAP32[(7404)>>2]|0;
      $990 = ($989>>>0)>($$0193>>>0);
      if ($990) {
       $991 = (($989) - ($$0193))|0;
       HEAP32[(7404)>>2] = $991;
       $992 = HEAP32[(7416)>>2]|0;
       $993 = (($992) + ($$0193)|0);
       HEAP32[(7416)>>2] = $993;
       $994 = $991 | 1;
       $995 = ((($993)) + 4|0);
       HEAP32[$995>>2] = $994;
       $996 = $$0193 | 3;
       $997 = ((($992)) + 4|0);
       HEAP32[$997>>2] = $996;
       $998 = ((($992)) + 8|0);
       $$2 = $998;
       break;
      }
     }
    }
    $999 = (___errno_location()|0);
    HEAP32[$999>>2] = 12;
    $$2 = 0;
   } else {
    $$2 = 0;
   }
  }
 } while(0);
 $1000 = HEAP32[(7836)>>2]|0;
 $1001 = $1000 & 2;
 $1002 = ($1001|0)==(0);
 if ($1002) {
  $$1 = $$2;
  STACKTOP = sp;return ($$1|0);
 }
 (___pthread_mutex_unlock((7840))|0);
 $$1 = $$2;
 STACKTOP = sp;return ($$1|0);
}
function _free($0) {
 $0 = $0|0;
 var $$0195$i = 0, $$0195$in$i = 0, $$0348 = 0, $$0349 = 0, $$0361 = 0, $$0368 = 0, $$1 = 0, $$1347 = 0, $$1352 = 0, $$1355 = 0, $$1363 = 0, $$1367 = 0, $$2 = 0, $$3 = 0, $$3365 = 0, $$pre = 0, $$pre$phiZ2D = 0, $$sink3 = 0, $$sink5 = 0, $1 = 0;
 var $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0;
 var $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0;
 var $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0;
 var $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0;
 var $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0;
 var $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0;
 var $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0;
 var $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0;
 var $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0;
 var $262 = 0, $263 = 0, $264 = 0, $265 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0;
 var $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0;
 var $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0;
 var $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0;
 var $96 = 0, $97 = 0, $98 = 0, $99 = 0, $cond374 = 0, $cond375 = 0, $not$ = 0, $not$370 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ($0|0)==(0|0);
 if ($1) {
  return;
 }
 $2 = ((($0)) + -8|0);
 $3 = HEAP32[(7836)>>2]|0;
 $4 = $3 & 2;
 $5 = ($4|0)==(0);
 if (!($5)) {
  $6 = (___pthread_mutex_lock((7840))|0);
  $7 = ($6|0)==(0);
  if (!($7)) {
   return;
  }
 }
 $8 = HEAP32[(7408)>>2]|0;
 $9 = ((($0)) + -4|0);
 $10 = HEAP32[$9>>2]|0;
 $11 = $10 & -8;
 $12 = (($2) + ($11)|0);
 $13 = $10 & 1;
 $14 = ($13|0)==(0);
 do {
  if ($14) {
   $15 = HEAP32[$2>>2]|0;
   $16 = $10 & 3;
   $17 = ($16|0)==(0);
   if (!($17)) {
    $18 = (0 - ($15))|0;
    $19 = (($2) + ($18)|0);
    $20 = (($15) + ($11))|0;
    $21 = ($19>>>0)<($8>>>0);
    if (!($21)) {
     $22 = HEAP32[(7412)>>2]|0;
     $23 = ($19|0)==($22|0);
     if ($23) {
      $83 = ((($12)) + 4|0);
      $84 = HEAP32[$83>>2]|0;
      $85 = $84 & 3;
      $86 = ($85|0)==(3);
      if (!($86)) {
       $$1 = $19;$$1347 = $20;$92 = $19;
       label = 30;
       break;
      }
      $87 = (($19) + ($20)|0);
      $88 = ((($19)) + 4|0);
      $89 = $20 | 1;
      $90 = $84 & -2;
      HEAP32[(7400)>>2] = $20;
      HEAP32[$83>>2] = $90;
      HEAP32[$88>>2] = $89;
      HEAP32[$87>>2] = $20;
      break;
     }
     $24 = $15 >>> 3;
     $25 = ($15>>>0)<(256);
     if ($25) {
      $26 = ((($19)) + 8|0);
      $27 = HEAP32[$26>>2]|0;
      $28 = ((($19)) + 12|0);
      $29 = HEAP32[$28>>2]|0;
      $30 = ($29|0)==($27|0);
      if ($30) {
       $31 = 1 << $24;
       $32 = $31 ^ -1;
       $33 = HEAP32[1848]|0;
       $34 = $33 & $32;
       HEAP32[1848] = $34;
       $$1 = $19;$$1347 = $20;$92 = $19;
       label = 30;
       break;
      } else {
       $35 = ((($27)) + 12|0);
       HEAP32[$35>>2] = $29;
       $36 = ((($29)) + 8|0);
       HEAP32[$36>>2] = $27;
       $$1 = $19;$$1347 = $20;$92 = $19;
       label = 30;
       break;
      }
     }
     $37 = ((($19)) + 24|0);
     $38 = HEAP32[$37>>2]|0;
     $39 = ((($19)) + 12|0);
     $40 = HEAP32[$39>>2]|0;
     $41 = ($40|0)==($19|0);
     do {
      if ($41) {
       $46 = ((($19)) + 16|0);
       $47 = ((($46)) + 4|0);
       $48 = HEAP32[$47>>2]|0;
       $49 = ($48|0)==(0|0);
       if ($49) {
        $50 = HEAP32[$46>>2]|0;
        $51 = ($50|0)==(0|0);
        if ($51) {
         $$3 = 0;
         break;
        } else {
         $$1352 = $50;$$1355 = $46;
        }
       } else {
        $$1352 = $48;$$1355 = $47;
       }
       while(1) {
        $52 = ((($$1352)) + 20|0);
        $53 = HEAP32[$52>>2]|0;
        $54 = ($53|0)==(0|0);
        if (!($54)) {
         $$1352 = $53;$$1355 = $52;
         continue;
        }
        $55 = ((($$1352)) + 16|0);
        $56 = HEAP32[$55>>2]|0;
        $57 = ($56|0)==(0|0);
        if ($57) {
         break;
        } else {
         $$1352 = $56;$$1355 = $55;
        }
       }
       HEAP32[$$1355>>2] = 0;
       $$3 = $$1352;
      } else {
       $42 = ((($19)) + 8|0);
       $43 = HEAP32[$42>>2]|0;
       $44 = ((($43)) + 12|0);
       HEAP32[$44>>2] = $40;
       $45 = ((($40)) + 8|0);
       HEAP32[$45>>2] = $43;
       $$3 = $40;
      }
     } while(0);
     $58 = ($38|0)==(0|0);
     if ($58) {
      $$1 = $19;$$1347 = $20;$92 = $19;
      label = 30;
     } else {
      $59 = ((($19)) + 28|0);
      $60 = HEAP32[$59>>2]|0;
      $61 = (7696 + ($60<<2)|0);
      $62 = HEAP32[$61>>2]|0;
      $63 = ($19|0)==($62|0);
      if ($63) {
       HEAP32[$61>>2] = $$3;
       $cond374 = ($$3|0)==(0|0);
       if ($cond374) {
        $64 = 1 << $60;
        $65 = $64 ^ -1;
        $66 = HEAP32[(7396)>>2]|0;
        $67 = $66 & $65;
        HEAP32[(7396)>>2] = $67;
        $$1 = $19;$$1347 = $20;$92 = $19;
        label = 30;
        break;
       }
      } else {
       $68 = ((($38)) + 16|0);
       $69 = HEAP32[$68>>2]|0;
       $not$370 = ($69|0)!=($19|0);
       $$sink3 = $not$370&1;
       $70 = (((($38)) + 16|0) + ($$sink3<<2)|0);
       HEAP32[$70>>2] = $$3;
       $71 = ($$3|0)==(0|0);
       if ($71) {
        $$1 = $19;$$1347 = $20;$92 = $19;
        label = 30;
        break;
       }
      }
      $72 = ((($$3)) + 24|0);
      HEAP32[$72>>2] = $38;
      $73 = ((($19)) + 16|0);
      $74 = HEAP32[$73>>2]|0;
      $75 = ($74|0)==(0|0);
      if (!($75)) {
       $76 = ((($$3)) + 16|0);
       HEAP32[$76>>2] = $74;
       $77 = ((($74)) + 24|0);
       HEAP32[$77>>2] = $$3;
      }
      $78 = ((($73)) + 4|0);
      $79 = HEAP32[$78>>2]|0;
      $80 = ($79|0)==(0|0);
      if ($80) {
       $$1 = $19;$$1347 = $20;$92 = $19;
       label = 30;
      } else {
       $81 = ((($$3)) + 20|0);
       HEAP32[$81>>2] = $79;
       $82 = ((($79)) + 24|0);
       HEAP32[$82>>2] = $$3;
       $$1 = $19;$$1347 = $20;$92 = $19;
       label = 30;
      }
     }
    }
   }
  } else {
   $$1 = $2;$$1347 = $11;$92 = $2;
   label = 30;
  }
 } while(0);
 do {
  if ((label|0) == 30) {
   $91 = ($92>>>0)<($12>>>0);
   if ($91) {
    $93 = ((($12)) + 4|0);
    $94 = HEAP32[$93>>2]|0;
    $95 = $94 & 1;
    $96 = ($95|0)==(0);
    if (!($96)) {
     $97 = $94 & 2;
     $98 = ($97|0)==(0);
     if ($98) {
      $99 = HEAP32[(7416)>>2]|0;
      $100 = ($12|0)==($99|0);
      $101 = HEAP32[(7412)>>2]|0;
      if ($100) {
       $102 = HEAP32[(7404)>>2]|0;
       $103 = (($102) + ($$1347))|0;
       HEAP32[(7404)>>2] = $103;
       HEAP32[(7416)>>2] = $$1;
       $104 = $103 | 1;
       $105 = ((($$1)) + 4|0);
       HEAP32[$105>>2] = $104;
       $106 = ($$1|0)==($101|0);
       if (!($106)) {
        break;
       }
       HEAP32[(7412)>>2] = 0;
       HEAP32[(7400)>>2] = 0;
       break;
      }
      $107 = ($12|0)==($101|0);
      if ($107) {
       $108 = HEAP32[(7400)>>2]|0;
       $109 = (($108) + ($$1347))|0;
       HEAP32[(7400)>>2] = $109;
       HEAP32[(7412)>>2] = $92;
       $110 = $109 | 1;
       $111 = ((($$1)) + 4|0);
       HEAP32[$111>>2] = $110;
       $112 = (($92) + ($109)|0);
       HEAP32[$112>>2] = $109;
       break;
      }
      $113 = $94 & -8;
      $114 = (($113) + ($$1347))|0;
      $115 = $94 >>> 3;
      $116 = ($94>>>0)<(256);
      do {
       if ($116) {
        $117 = ((($12)) + 8|0);
        $118 = HEAP32[$117>>2]|0;
        $119 = ((($12)) + 12|0);
        $120 = HEAP32[$119>>2]|0;
        $121 = ($120|0)==($118|0);
        if ($121) {
         $122 = 1 << $115;
         $123 = $122 ^ -1;
         $124 = HEAP32[1848]|0;
         $125 = $124 & $123;
         HEAP32[1848] = $125;
         break;
        } else {
         $126 = ((($118)) + 12|0);
         HEAP32[$126>>2] = $120;
         $127 = ((($120)) + 8|0);
         HEAP32[$127>>2] = $118;
         break;
        }
       } else {
        $128 = ((($12)) + 24|0);
        $129 = HEAP32[$128>>2]|0;
        $130 = ((($12)) + 12|0);
        $131 = HEAP32[$130>>2]|0;
        $132 = ($131|0)==($12|0);
        do {
         if ($132) {
          $137 = ((($12)) + 16|0);
          $138 = ((($137)) + 4|0);
          $139 = HEAP32[$138>>2]|0;
          $140 = ($139|0)==(0|0);
          if ($140) {
           $141 = HEAP32[$137>>2]|0;
           $142 = ($141|0)==(0|0);
           if ($142) {
            $$3365 = 0;
            break;
           } else {
            $$1363 = $141;$$1367 = $137;
           }
          } else {
           $$1363 = $139;$$1367 = $138;
          }
          while(1) {
           $143 = ((($$1363)) + 20|0);
           $144 = HEAP32[$143>>2]|0;
           $145 = ($144|0)==(0|0);
           if (!($145)) {
            $$1363 = $144;$$1367 = $143;
            continue;
           }
           $146 = ((($$1363)) + 16|0);
           $147 = HEAP32[$146>>2]|0;
           $148 = ($147|0)==(0|0);
           if ($148) {
            break;
           } else {
            $$1363 = $147;$$1367 = $146;
           }
          }
          HEAP32[$$1367>>2] = 0;
          $$3365 = $$1363;
         } else {
          $133 = ((($12)) + 8|0);
          $134 = HEAP32[$133>>2]|0;
          $135 = ((($134)) + 12|0);
          HEAP32[$135>>2] = $131;
          $136 = ((($131)) + 8|0);
          HEAP32[$136>>2] = $134;
          $$3365 = $131;
         }
        } while(0);
        $149 = ($129|0)==(0|0);
        if (!($149)) {
         $150 = ((($12)) + 28|0);
         $151 = HEAP32[$150>>2]|0;
         $152 = (7696 + ($151<<2)|0);
         $153 = HEAP32[$152>>2]|0;
         $154 = ($12|0)==($153|0);
         if ($154) {
          HEAP32[$152>>2] = $$3365;
          $cond375 = ($$3365|0)==(0|0);
          if ($cond375) {
           $155 = 1 << $151;
           $156 = $155 ^ -1;
           $157 = HEAP32[(7396)>>2]|0;
           $158 = $157 & $156;
           HEAP32[(7396)>>2] = $158;
           break;
          }
         } else {
          $159 = ((($129)) + 16|0);
          $160 = HEAP32[$159>>2]|0;
          $not$ = ($160|0)!=($12|0);
          $$sink5 = $not$&1;
          $161 = (((($129)) + 16|0) + ($$sink5<<2)|0);
          HEAP32[$161>>2] = $$3365;
          $162 = ($$3365|0)==(0|0);
          if ($162) {
           break;
          }
         }
         $163 = ((($$3365)) + 24|0);
         HEAP32[$163>>2] = $129;
         $164 = ((($12)) + 16|0);
         $165 = HEAP32[$164>>2]|0;
         $166 = ($165|0)==(0|0);
         if (!($166)) {
          $167 = ((($$3365)) + 16|0);
          HEAP32[$167>>2] = $165;
          $168 = ((($165)) + 24|0);
          HEAP32[$168>>2] = $$3365;
         }
         $169 = ((($164)) + 4|0);
         $170 = HEAP32[$169>>2]|0;
         $171 = ($170|0)==(0|0);
         if (!($171)) {
          $172 = ((($$3365)) + 20|0);
          HEAP32[$172>>2] = $170;
          $173 = ((($170)) + 24|0);
          HEAP32[$173>>2] = $$3365;
         }
        }
       }
      } while(0);
      $174 = $114 | 1;
      $175 = ((($$1)) + 4|0);
      HEAP32[$175>>2] = $174;
      $176 = (($92) + ($114)|0);
      HEAP32[$176>>2] = $114;
      $177 = HEAP32[(7412)>>2]|0;
      $178 = ($$1|0)==($177|0);
      if ($178) {
       HEAP32[(7400)>>2] = $114;
       break;
      } else {
       $$2 = $114;
      }
     } else {
      $179 = $94 & -2;
      HEAP32[$93>>2] = $179;
      $180 = $$1347 | 1;
      $181 = ((($$1)) + 4|0);
      HEAP32[$181>>2] = $180;
      $182 = (($92) + ($$1347)|0);
      HEAP32[$182>>2] = $$1347;
      $$2 = $$1347;
     }
     $183 = $$2 >>> 3;
     $184 = ($$2>>>0)<(256);
     if ($184) {
      $185 = $183 << 1;
      $186 = (7432 + ($185<<2)|0);
      $187 = HEAP32[1848]|0;
      $188 = 1 << $183;
      $189 = $187 & $188;
      $190 = ($189|0)==(0);
      if ($190) {
       $191 = $187 | $188;
       HEAP32[1848] = $191;
       $$pre = ((($186)) + 8|0);
       $$0368 = $186;$$pre$phiZ2D = $$pre;
      } else {
       $192 = ((($186)) + 8|0);
       $193 = HEAP32[$192>>2]|0;
       $$0368 = $193;$$pre$phiZ2D = $192;
      }
      HEAP32[$$pre$phiZ2D>>2] = $$1;
      $194 = ((($$0368)) + 12|0);
      HEAP32[$194>>2] = $$1;
      $195 = ((($$1)) + 8|0);
      HEAP32[$195>>2] = $$0368;
      $196 = ((($$1)) + 12|0);
      HEAP32[$196>>2] = $186;
      break;
     }
     $197 = $$2 >>> 8;
     $198 = ($197|0)==(0);
     if ($198) {
      $$0361 = 0;
     } else {
      $199 = ($$2>>>0)>(16777215);
      if ($199) {
       $$0361 = 31;
      } else {
       $200 = (($197) + 1048320)|0;
       $201 = $200 >>> 16;
       $202 = $201 & 8;
       $203 = $197 << $202;
       $204 = (($203) + 520192)|0;
       $205 = $204 >>> 16;
       $206 = $205 & 4;
       $207 = $206 | $202;
       $208 = $203 << $206;
       $209 = (($208) + 245760)|0;
       $210 = $209 >>> 16;
       $211 = $210 & 2;
       $212 = $207 | $211;
       $213 = (14 - ($212))|0;
       $214 = $208 << $211;
       $215 = $214 >>> 15;
       $216 = (($213) + ($215))|0;
       $217 = $216 << 1;
       $218 = (($216) + 7)|0;
       $219 = $$2 >>> $218;
       $220 = $219 & 1;
       $221 = $220 | $217;
       $$0361 = $221;
      }
     }
     $222 = (7696 + ($$0361<<2)|0);
     $223 = ((($$1)) + 28|0);
     HEAP32[$223>>2] = $$0361;
     $224 = ((($$1)) + 16|0);
     $225 = ((($$1)) + 20|0);
     HEAP32[$225>>2] = 0;
     HEAP32[$224>>2] = 0;
     $226 = HEAP32[(7396)>>2]|0;
     $227 = 1 << $$0361;
     $228 = $226 & $227;
     $229 = ($228|0)==(0);
     do {
      if ($229) {
       $230 = $226 | $227;
       HEAP32[(7396)>>2] = $230;
       HEAP32[$222>>2] = $$1;
       $231 = ((($$1)) + 24|0);
       HEAP32[$231>>2] = $222;
       $232 = ((($$1)) + 12|0);
       HEAP32[$232>>2] = $$1;
       $233 = ((($$1)) + 8|0);
       HEAP32[$233>>2] = $$1;
      } else {
       $234 = HEAP32[$222>>2]|0;
       $235 = ($$0361|0)==(31);
       $236 = $$0361 >>> 1;
       $237 = (25 - ($236))|0;
       $238 = $235 ? 0 : $237;
       $239 = $$2 << $238;
       $$0348 = $239;$$0349 = $234;
       while(1) {
        $240 = ((($$0349)) + 4|0);
        $241 = HEAP32[$240>>2]|0;
        $242 = $241 & -8;
        $243 = ($242|0)==($$2|0);
        if ($243) {
         label = 75;
         break;
        }
        $244 = $$0348 >>> 31;
        $245 = (((($$0349)) + 16|0) + ($244<<2)|0);
        $246 = $$0348 << 1;
        $247 = HEAP32[$245>>2]|0;
        $248 = ($247|0)==(0|0);
        if ($248) {
         label = 74;
         break;
        } else {
         $$0348 = $246;$$0349 = $247;
        }
       }
       if ((label|0) == 74) {
        HEAP32[$245>>2] = $$1;
        $249 = ((($$1)) + 24|0);
        HEAP32[$249>>2] = $$0349;
        $250 = ((($$1)) + 12|0);
        HEAP32[$250>>2] = $$1;
        $251 = ((($$1)) + 8|0);
        HEAP32[$251>>2] = $$1;
        break;
       }
       else if ((label|0) == 75) {
        $252 = ((($$0349)) + 8|0);
        $253 = HEAP32[$252>>2]|0;
        $254 = ((($253)) + 12|0);
        HEAP32[$254>>2] = $$1;
        HEAP32[$252>>2] = $$1;
        $255 = ((($$1)) + 8|0);
        HEAP32[$255>>2] = $253;
        $256 = ((($$1)) + 12|0);
        HEAP32[$256>>2] = $$0349;
        $257 = ((($$1)) + 24|0);
        HEAP32[$257>>2] = 0;
        break;
       }
      }
     } while(0);
     $258 = HEAP32[(7424)>>2]|0;
     $259 = (($258) + -1)|0;
     HEAP32[(7424)>>2] = $259;
     $260 = ($259|0)==(0);
     if ($260) {
      $$0195$in$i = (7876);
      while(1) {
       $$0195$i = HEAP32[$$0195$in$i>>2]|0;
       $261 = ($$0195$i|0)==(0|0);
       $262 = ((($$0195$i)) + 8|0);
       if ($261) {
        break;
       } else {
        $$0195$in$i = $262;
       }
      }
      HEAP32[(7424)>>2] = -1;
     }
    }
   }
  }
 } while(0);
 $263 = HEAP32[(7836)>>2]|0;
 $264 = $263 & 2;
 $265 = ($264|0)==(0);
 if ($265) {
  return;
 }
 (___pthread_mutex_unlock((7840))|0);
 return;
}
function _emscripten_get_global_libc() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (7892|0);
}
function ___emscripten_pthread_data_constructor() {
 var $0 = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_pthread_self()|0);
 $1 = ((($0)) + 188|0);
 HEAP32[$1>>2] = (7932);
 return;
}
function ___stdio_close($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $vararg_buffer = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $vararg_buffer = sp;
 $1 = ((($0)) + 60|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = (_dummy_568($2)|0);
 HEAP32[$vararg_buffer>>2] = $3;
 $4 = (___syscall6(6,($vararg_buffer|0))|0);
 $5 = (___syscall_ret($4)|0);
 STACKTOP = sp;return ($5|0);
}
function ___stdio_write($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$0 = 0, $$04756 = 0, $$04855 = 0, $$04954 = 0, $$051 = 0, $$1 = 0, $$150 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0;
 var $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0;
 var $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $vararg_buffer = 0, $vararg_buffer3 = 0, $vararg_ptr1 = 0, $vararg_ptr2 = 0, $vararg_ptr6 = 0;
 var $vararg_ptr7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(48|0);
 $vararg_buffer3 = sp + 16|0;
 $vararg_buffer = sp;
 $3 = sp + 32|0;
 $4 = ((($0)) + 28|0);
 $5 = HEAP32[$4>>2]|0;
 HEAP32[$3>>2] = $5;
 $6 = ((($3)) + 4|0);
 $7 = ((($0)) + 20|0);
 $8 = HEAP32[$7>>2]|0;
 $9 = (($8) - ($5))|0;
 HEAP32[$6>>2] = $9;
 $10 = ((($3)) + 8|0);
 HEAP32[$10>>2] = $1;
 $11 = ((($3)) + 12|0);
 HEAP32[$11>>2] = $2;
 $12 = (($9) + ($2))|0;
 $13 = ((($0)) + 60|0);
 $14 = HEAP32[$13>>2]|0;
 $15 = $3;
 HEAP32[$vararg_buffer>>2] = $14;
 $vararg_ptr1 = ((($vararg_buffer)) + 4|0);
 HEAP32[$vararg_ptr1>>2] = $15;
 $vararg_ptr2 = ((($vararg_buffer)) + 8|0);
 HEAP32[$vararg_ptr2>>2] = 2;
 $16 = (___syscall146(146,($vararg_buffer|0))|0);
 $17 = (___syscall_ret($16)|0);
 $18 = ($12|0)==($17|0);
 L1: do {
  if ($18) {
   label = 3;
  } else {
   $$04756 = 2;$$04855 = $12;$$04954 = $3;$26 = $17;
   while(1) {
    $25 = ($26|0)<(0);
    if ($25) {
     break;
    }
    $34 = (($$04855) - ($26))|0;
    $35 = ((($$04954)) + 4|0);
    $36 = HEAP32[$35>>2]|0;
    $37 = ($26>>>0)>($36>>>0);
    $38 = ((($$04954)) + 8|0);
    $$150 = $37 ? $38 : $$04954;
    $39 = $37 << 31 >> 31;
    $$1 = (($39) + ($$04756))|0;
    $40 = $37 ? $36 : 0;
    $$0 = (($26) - ($40))|0;
    $41 = HEAP32[$$150>>2]|0;
    $42 = (($41) + ($$0)|0);
    HEAP32[$$150>>2] = $42;
    $43 = ((($$150)) + 4|0);
    $44 = HEAP32[$43>>2]|0;
    $45 = (($44) - ($$0))|0;
    HEAP32[$43>>2] = $45;
    $46 = HEAP32[$13>>2]|0;
    $47 = $$150;
    HEAP32[$vararg_buffer3>>2] = $46;
    $vararg_ptr6 = ((($vararg_buffer3)) + 4|0);
    HEAP32[$vararg_ptr6>>2] = $47;
    $vararg_ptr7 = ((($vararg_buffer3)) + 8|0);
    HEAP32[$vararg_ptr7>>2] = $$1;
    $48 = (___syscall146(146,($vararg_buffer3|0))|0);
    $49 = (___syscall_ret($48)|0);
    $50 = ($34|0)==($49|0);
    if ($50) {
     label = 3;
     break L1;
    } else {
     $$04756 = $$1;$$04855 = $34;$$04954 = $$150;$26 = $49;
    }
   }
   $27 = ((($0)) + 16|0);
   HEAP32[$27>>2] = 0;
   HEAP32[$4>>2] = 0;
   HEAP32[$7>>2] = 0;
   $28 = HEAP32[$0>>2]|0;
   $29 = $28 | 32;
   HEAP32[$0>>2] = $29;
   $30 = ($$04756|0)==(2);
   if ($30) {
    $$051 = 0;
   } else {
    $31 = ((($$04954)) + 4|0);
    $32 = HEAP32[$31>>2]|0;
    $33 = (($2) - ($32))|0;
    $$051 = $33;
   }
  }
 } while(0);
 if ((label|0) == 3) {
  $19 = ((($0)) + 44|0);
  $20 = HEAP32[$19>>2]|0;
  $21 = ((($0)) + 48|0);
  $22 = HEAP32[$21>>2]|0;
  $23 = (($20) + ($22)|0);
  $24 = ((($0)) + 16|0);
  HEAP32[$24>>2] = $23;
  HEAP32[$4>>2] = $20;
  HEAP32[$7>>2] = $20;
  $$051 = $2;
 }
 STACKTOP = sp;return ($$051|0);
}
function ___stdio_seek($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$pre = 0, $10 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $vararg_buffer = 0, $vararg_ptr1 = 0, $vararg_ptr2 = 0, $vararg_ptr3 = 0, $vararg_ptr4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 32|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(32|0);
 $vararg_buffer = sp;
 $3 = sp + 20|0;
 $4 = ((($0)) + 60|0);
 $5 = HEAP32[$4>>2]|0;
 $6 = $3;
 HEAP32[$vararg_buffer>>2] = $5;
 $vararg_ptr1 = ((($vararg_buffer)) + 4|0);
 HEAP32[$vararg_ptr1>>2] = 0;
 $vararg_ptr2 = ((($vararg_buffer)) + 8|0);
 HEAP32[$vararg_ptr2>>2] = $1;
 $vararg_ptr3 = ((($vararg_buffer)) + 12|0);
 HEAP32[$vararg_ptr3>>2] = $6;
 $vararg_ptr4 = ((($vararg_buffer)) + 16|0);
 HEAP32[$vararg_ptr4>>2] = $2;
 $7 = (___syscall140(140,($vararg_buffer|0))|0);
 $8 = (___syscall_ret($7)|0);
 $9 = ($8|0)<(0);
 if ($9) {
  HEAP32[$3>>2] = -1;
  $10 = -1;
 } else {
  $$pre = HEAP32[$3>>2]|0;
  $10 = $$pre;
 }
 STACKTOP = sp;return ($10|0);
}
function ___syscall_ret($0) {
 $0 = $0|0;
 var $$0 = 0, $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ($0>>>0)>(4294963200);
 if ($1) {
  $2 = (0 - ($0))|0;
  $3 = (___errno_location()|0);
  HEAP32[$3>>2] = $2;
  $$0 = -1;
 } else {
  $$0 = $0;
 }
 return ($$0|0);
}
function ___errno_location() {
 var $0 = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (___pthread_self_103()|0);
 $1 = ((($0)) + 64|0);
 return ($1|0);
}
function ___pthread_self_103() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_pthread_self()|0);
 return ($0|0);
}
function _dummy_568($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return ($0|0);
}
function ___stdout_write($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $vararg_buffer = 0, $vararg_ptr1 = 0, $vararg_ptr2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 32|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(32|0);
 $vararg_buffer = sp;
 $3 = sp + 16|0;
 $4 = ((($0)) + 36|0);
 HEAP32[$4>>2] = 2;
 $5 = HEAP32[$0>>2]|0;
 $6 = $5 & 64;
 $7 = ($6|0)==(0);
 if ($7) {
  $8 = ((($0)) + 60|0);
  $9 = HEAP32[$8>>2]|0;
  $10 = $3;
  HEAP32[$vararg_buffer>>2] = $9;
  $vararg_ptr1 = ((($vararg_buffer)) + 4|0);
  HEAP32[$vararg_ptr1>>2] = 21523;
  $vararg_ptr2 = ((($vararg_buffer)) + 8|0);
  HEAP32[$vararg_ptr2>>2] = $10;
  $11 = (___syscall54(54,($vararg_buffer|0))|0);
  $12 = ($11|0)==(0);
  if (!($12)) {
   $13 = ((($0)) + 75|0);
   HEAP8[$13>>0] = -1;
  }
 }
 $14 = (___stdio_write($0,$1,$2)|0);
 STACKTOP = sp;return ($14|0);
}
function _strcmp($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$011 = 0, $$0710 = 0, $$lcssa = 0, $$lcssa8 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, $or$cond9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $2 = HEAP8[$0>>0]|0;
 $3 = HEAP8[$1>>0]|0;
 $4 = ($2<<24>>24)!=($3<<24>>24);
 $5 = ($2<<24>>24)==(0);
 $or$cond9 = $5 | $4;
 if ($or$cond9) {
  $$lcssa = $3;$$lcssa8 = $2;
 } else {
  $$011 = $1;$$0710 = $0;
  while(1) {
   $6 = ((($$0710)) + 1|0);
   $7 = ((($$011)) + 1|0);
   $8 = HEAP8[$6>>0]|0;
   $9 = HEAP8[$7>>0]|0;
   $10 = ($8<<24>>24)!=($9<<24>>24);
   $11 = ($8<<24>>24)==(0);
   $or$cond = $11 | $10;
   if ($or$cond) {
    $$lcssa = $9;$$lcssa8 = $8;
    break;
   } else {
    $$011 = $7;$$0710 = $6;
   }
  }
 }
 $12 = $$lcssa8&255;
 $13 = $$lcssa&255;
 $14 = (($12) - ($13))|0;
 return ($14|0);
}
function _vsnprintf($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $$$015 = 0, $$0 = 0, $$014 = 0, $$015 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0;
 var $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, dest = 0, label = 0, sp = 0, src = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 128|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(128|0);
 $4 = sp + 124|0;
 $5 = sp;
 dest=$5; src=836; stop=dest+124|0; do { HEAP32[dest>>2]=HEAP32[src>>2]|0; dest=dest+4|0; src=src+4|0; } while ((dest|0) < (stop|0));
 $6 = (($1) + -1)|0;
 $7 = ($6>>>0)>(2147483646);
 if ($7) {
  $8 = ($1|0)==(0);
  if ($8) {
   $$014 = $4;$$015 = 1;
   label = 4;
  } else {
   $9 = (___errno_location()|0);
   HEAP32[$9>>2] = 75;
   $$0 = -1;
  }
 } else {
  $$014 = $0;$$015 = $1;
  label = 4;
 }
 if ((label|0) == 4) {
  $10 = $$014;
  $11 = (-2 - ($10))|0;
  $12 = ($$015>>>0)>($11>>>0);
  $$$015 = $12 ? $11 : $$015;
  $13 = ((($5)) + 48|0);
  HEAP32[$13>>2] = $$$015;
  $14 = ((($5)) + 20|0);
  HEAP32[$14>>2] = $$014;
  $15 = ((($5)) + 44|0);
  HEAP32[$15>>2] = $$014;
  $16 = (($$014) + ($$$015)|0);
  $17 = ((($5)) + 16|0);
  HEAP32[$17>>2] = $16;
  $18 = ((($5)) + 28|0);
  HEAP32[$18>>2] = $16;
  $19 = (_vfprintf($5,$2,$3)|0);
  $20 = ($$$015|0)==(0);
  if ($20) {
   $$0 = $19;
  } else {
   $21 = HEAP32[$14>>2]|0;
   $22 = HEAP32[$17>>2]|0;
   $23 = ($21|0)==($22|0);
   $24 = $23 << 31 >> 31;
   $25 = (($21) + ($24)|0);
   HEAP8[$25>>0] = 0;
   $$0 = $19;
  }
 }
 STACKTOP = sp;return ($$0|0);
}
function _vfprintf($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$ = 0, $$0 = 0, $$1 = 0, $$1$ = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0;
 var $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $5 = 0, $6 = 0, $7 = 0;
 var $8 = 0, $9 = 0, $vacopy_currentptr = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 224|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(224|0);
 $3 = sp + 120|0;
 $4 = sp + 80|0;
 $5 = sp;
 $6 = sp + 136|0;
 dest=$4; stop=dest+40|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 $vacopy_currentptr = HEAP32[$2>>2]|0;
 HEAP32[$3>>2] = $vacopy_currentptr;
 $7 = (_printf_core(0,$1,$3,$5,$4)|0);
 $8 = ($7|0)<(0);
 if ($8) {
  $$0 = -1;
 } else {
  $9 = ((($0)) + 76|0);
  $10 = (Atomics_load(HEAP32,$9>>2)|0);
  $11 = ($10|0)>(-1);
  if ($11) {
   $12 = (___lockfile($0)|0);
   $40 = $12;
  } else {
   $40 = 0;
  }
  $13 = HEAP32[$0>>2]|0;
  $14 = $13 & 32;
  $15 = ((($0)) + 74|0);
  $16 = HEAP8[$15>>0]|0;
  $17 = ($16<<24>>24)<(1);
  if ($17) {
   $18 = $13 & -33;
   HEAP32[$0>>2] = $18;
  }
  $19 = ((($0)) + 48|0);
  $20 = HEAP32[$19>>2]|0;
  $21 = ($20|0)==(0);
  if ($21) {
   $23 = ((($0)) + 44|0);
   $24 = HEAP32[$23>>2]|0;
   HEAP32[$23>>2] = $6;
   $25 = ((($0)) + 28|0);
   HEAP32[$25>>2] = $6;
   $26 = ((($0)) + 20|0);
   HEAP32[$26>>2] = $6;
   HEAP32[$19>>2] = 80;
   $27 = ((($6)) + 80|0);
   $28 = ((($0)) + 16|0);
   HEAP32[$28>>2] = $27;
   $29 = (_printf_core($0,$1,$3,$5,$4)|0);
   $30 = ($24|0)==(0|0);
   if ($30) {
    $$1 = $29;
   } else {
    $31 = ((($0)) + 36|0);
    $32 = HEAP32[$31>>2]|0;
    (FUNCTION_TABLE_iiii[$32 & 127]($0,0,0)|0);
    $33 = HEAP32[$26>>2]|0;
    $34 = ($33|0)==(0|0);
    $$ = $34 ? -1 : $29;
    HEAP32[$23>>2] = $24;
    HEAP32[$19>>2] = 0;
    HEAP32[$28>>2] = 0;
    HEAP32[$25>>2] = 0;
    HEAP32[$26>>2] = 0;
    $$1 = $$;
   }
  } else {
   $22 = (_printf_core($0,$1,$3,$5,$4)|0);
   $$1 = $22;
  }
  $35 = HEAP32[$0>>2]|0;
  $36 = $35 & 32;
  $37 = ($36|0)==(0);
  $$1$ = $37 ? $$1 : -1;
  $38 = $35 | $14;
  HEAP32[$0>>2] = $38;
  $39 = ($40|0)==(0);
  if (!($39)) {
   ___unlockfile($0);
  }
  $$0 = $$1$;
 }
 STACKTOP = sp;return ($$0|0);
}
function _printf_core($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $$ = 0, $$$ = 0, $$$0259 = 0, $$$0262 = 0, $$$0269 = 0, $$$4266 = 0, $$$5 = 0, $$0 = 0, $$0228 = 0, $$0228$ = 0, $$0229322 = 0, $$0232 = 0, $$0235 = 0, $$0237 = 0, $$0240$lcssa = 0, $$0240$lcssa357 = 0, $$0240321 = 0, $$0243 = 0, $$0247 = 0, $$0249$lcssa = 0;
 var $$0249306 = 0, $$0252 = 0, $$0253 = 0, $$0254 = 0, $$0254$$0254$ = 0, $$0259 = 0, $$0262$lcssa = 0, $$0262311 = 0, $$0269 = 0, $$0269$phi = 0, $$1 = 0, $$1230333 = 0, $$1233 = 0, $$1236 = 0, $$1238 = 0, $$1241332 = 0, $$1244320 = 0, $$1248 = 0, $$1250 = 0, $$1255 = 0;
 var $$1260 = 0, $$1263 = 0, $$1263$ = 0, $$1270 = 0, $$2 = 0, $$2234 = 0, $$2239 = 0, $$2242305 = 0, $$2245 = 0, $$2251 = 0, $$2256 = 0, $$2256$ = 0, $$2256$$$2256 = 0, $$2261 = 0, $$2271 = 0, $$284$ = 0, $$289 = 0, $$290 = 0, $$3257 = 0, $$3265 = 0;
 var $$3272 = 0, $$3303 = 0, $$377 = 0, $$4258355 = 0, $$4266 = 0, $$5 = 0, $$6268 = 0, $$lcssa295 = 0, $$pre = 0, $$pre346 = 0, $$pre347 = 0, $$pre347$pre = 0, $$pre349 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0;
 var $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0;
 var $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0;
 var $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0;
 var $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0;
 var $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0;
 var $197 = 0, $198 = 0, $199 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0;
 var $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0;
 var $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0;
 var $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0;
 var $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0, $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0;
 var $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0, $297 = 0, $298 = 0, $299 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0;
 var $306 = 0.0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0, $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0;
 var $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0;
 var $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0;
 var $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0;
 var $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0;
 var $arglist_current = 0, $arglist_current2 = 0, $arglist_next = 0, $arglist_next3 = 0, $expanded = 0, $expanded10 = 0, $expanded11 = 0, $expanded13 = 0, $expanded14 = 0, $expanded15 = 0, $expanded4 = 0, $expanded6 = 0, $expanded7 = 0, $expanded8 = 0, $isdigit = 0, $isdigit275 = 0, $isdigit277 = 0, $isdigittmp = 0, $isdigittmp$ = 0, $isdigittmp274 = 0;
 var $isdigittmp276 = 0, $narrow = 0, $or$cond = 0, $or$cond281 = 0, $or$cond283 = 0, $or$cond286 = 0, $storemerge = 0, $storemerge273310 = 0, $storemerge278 = 0, $trunc = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 64|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(64|0);
 $5 = sp + 16|0;
 $6 = sp;
 $7 = sp + 24|0;
 $8 = sp + 8|0;
 $9 = sp + 20|0;
 HEAP32[$5>>2] = $1;
 $10 = ($0|0)!=(0|0);
 $11 = ((($7)) + 40|0);
 $12 = $11;
 $13 = ((($7)) + 39|0);
 $14 = ((($8)) + 4|0);
 $$0243 = 0;$$0247 = 0;$$0269 = 0;$21 = $1;
 L1: while(1) {
  $15 = ($$0247|0)>(-1);
  do {
   if ($15) {
    $16 = (2147483647 - ($$0247))|0;
    $17 = ($$0243|0)>($16|0);
    if ($17) {
     $18 = (___errno_location()|0);
     HEAP32[$18>>2] = 75;
     $$1248 = -1;
     break;
    } else {
     $19 = (($$0243) + ($$0247))|0;
     $$1248 = $19;
     break;
    }
   } else {
    $$1248 = $$0247;
   }
  } while(0);
  $20 = HEAP8[$21>>0]|0;
  $22 = ($20<<24>>24)==(0);
  if ($22) {
   label = 87;
   break;
  } else {
   $23 = $20;$25 = $21;
  }
  L9: while(1) {
   switch ($23<<24>>24) {
   case 37:  {
    $$0249306 = $25;$27 = $25;
    label = 9;
    break L9;
    break;
   }
   case 0:  {
    $$0249$lcssa = $25;$39 = $25;
    break L9;
    break;
   }
   default: {
   }
   }
   $24 = ((($25)) + 1|0);
   HEAP32[$5>>2] = $24;
   $$pre = HEAP8[$24>>0]|0;
   $23 = $$pre;$25 = $24;
  }
  L12: do {
   if ((label|0) == 9) {
    while(1) {
     label = 0;
     $26 = ((($27)) + 1|0);
     $28 = HEAP8[$26>>0]|0;
     $29 = ($28<<24>>24)==(37);
     if (!($29)) {
      $$0249$lcssa = $$0249306;$39 = $27;
      break L12;
     }
     $30 = ((($$0249306)) + 1|0);
     $31 = ((($27)) + 2|0);
     HEAP32[$5>>2] = $31;
     $32 = HEAP8[$31>>0]|0;
     $33 = ($32<<24>>24)==(37);
     if ($33) {
      $$0249306 = $30;$27 = $31;
      label = 9;
     } else {
      $$0249$lcssa = $30;$39 = $31;
      break;
     }
    }
   }
  } while(0);
  $34 = $$0249$lcssa;
  $35 = $21;
  $36 = (($34) - ($35))|0;
  if ($10) {
   _out($0,$21,$36);
  }
  $37 = ($36|0)==(0);
  if (!($37)) {
   $$0269$phi = $$0269;$$0243 = $36;$$0247 = $$1248;$21 = $39;$$0269 = $$0269$phi;
   continue;
  }
  $38 = ((($39)) + 1|0);
  $40 = HEAP8[$38>>0]|0;
  $41 = $40 << 24 >> 24;
  $isdigittmp = (($41) + -48)|0;
  $isdigit = ($isdigittmp>>>0)<(10);
  if ($isdigit) {
   $42 = ((($39)) + 2|0);
   $43 = HEAP8[$42>>0]|0;
   $44 = ($43<<24>>24)==(36);
   $45 = ((($39)) + 3|0);
   $$377 = $44 ? $45 : $38;
   $$$0269 = $44 ? 1 : $$0269;
   $isdigittmp$ = $44 ? $isdigittmp : -1;
   $$0253 = $isdigittmp$;$$1270 = $$$0269;$storemerge = $$377;
  } else {
   $$0253 = -1;$$1270 = $$0269;$storemerge = $38;
  }
  HEAP32[$5>>2] = $storemerge;
  $46 = HEAP8[$storemerge>>0]|0;
  $47 = $46 << 24 >> 24;
  $48 = (($47) + -32)|0;
  $49 = ($48>>>0)<(32);
  L24: do {
   if ($49) {
    $$0262311 = 0;$329 = $46;$51 = $48;$storemerge273310 = $storemerge;
    while(1) {
     $50 = 1 << $51;
     $52 = $50 & 75913;
     $53 = ($52|0)==(0);
     if ($53) {
      $$0262$lcssa = $$0262311;$$lcssa295 = $329;$62 = $storemerge273310;
      break L24;
     }
     $54 = $50 | $$0262311;
     $55 = ((($storemerge273310)) + 1|0);
     HEAP32[$5>>2] = $55;
     $56 = HEAP8[$55>>0]|0;
     $57 = $56 << 24 >> 24;
     $58 = (($57) + -32)|0;
     $59 = ($58>>>0)<(32);
     if ($59) {
      $$0262311 = $54;$329 = $56;$51 = $58;$storemerge273310 = $55;
     } else {
      $$0262$lcssa = $54;$$lcssa295 = $56;$62 = $55;
      break;
     }
    }
   } else {
    $$0262$lcssa = 0;$$lcssa295 = $46;$62 = $storemerge;
   }
  } while(0);
  $60 = ($$lcssa295<<24>>24)==(42);
  if ($60) {
   $61 = ((($62)) + 1|0);
   $63 = HEAP8[$61>>0]|0;
   $64 = $63 << 24 >> 24;
   $isdigittmp276 = (($64) + -48)|0;
   $isdigit277 = ($isdigittmp276>>>0)<(10);
   if ($isdigit277) {
    $65 = ((($62)) + 2|0);
    $66 = HEAP8[$65>>0]|0;
    $67 = ($66<<24>>24)==(36);
    if ($67) {
     $68 = (($4) + ($isdigittmp276<<2)|0);
     HEAP32[$68>>2] = 10;
     $69 = HEAP8[$61>>0]|0;
     $70 = $69 << 24 >> 24;
     $71 = (($70) + -48)|0;
     $72 = (($3) + ($71<<3)|0);
     $73 = $72;
     $74 = $73;
     $75 = HEAP32[$74>>2]|0;
     $76 = (($73) + 4)|0;
     $77 = $76;
     $78 = HEAP32[$77>>2]|0;
     $79 = ((($62)) + 3|0);
     $$0259 = $75;$$2271 = 1;$storemerge278 = $79;
    } else {
     label = 23;
    }
   } else {
    label = 23;
   }
   if ((label|0) == 23) {
    label = 0;
    $80 = ($$1270|0)==(0);
    if (!($80)) {
     $$0 = -1;
     break;
    }
    if ($10) {
     $arglist_current = HEAP32[$2>>2]|0;
     $81 = $arglist_current;
     $82 = ((0) + 4|0);
     $expanded4 = $82;
     $expanded = (($expanded4) - 1)|0;
     $83 = (($81) + ($expanded))|0;
     $84 = ((0) + 4|0);
     $expanded8 = $84;
     $expanded7 = (($expanded8) - 1)|0;
     $expanded6 = $expanded7 ^ -1;
     $85 = $83 & $expanded6;
     $86 = $85;
     $87 = HEAP32[$86>>2]|0;
     $arglist_next = ((($86)) + 4|0);
     HEAP32[$2>>2] = $arglist_next;
     $$0259 = $87;$$2271 = 0;$storemerge278 = $61;
    } else {
     $$0259 = 0;$$2271 = 0;$storemerge278 = $61;
    }
   }
   HEAP32[$5>>2] = $storemerge278;
   $88 = ($$0259|0)<(0);
   $89 = $$0262$lcssa | 8192;
   $90 = (0 - ($$0259))|0;
   $$$0262 = $88 ? $89 : $$0262$lcssa;
   $$$0259 = $88 ? $90 : $$0259;
   $$1260 = $$$0259;$$1263 = $$$0262;$$3272 = $$2271;$94 = $storemerge278;
  } else {
   $91 = (_getint($5)|0);
   $92 = ($91|0)<(0);
   if ($92) {
    $$0 = -1;
    break;
   }
   $$pre346 = HEAP32[$5>>2]|0;
   $$1260 = $91;$$1263 = $$0262$lcssa;$$3272 = $$1270;$94 = $$pre346;
  }
  $93 = HEAP8[$94>>0]|0;
  $95 = ($93<<24>>24)==(46);
  do {
   if ($95) {
    $96 = ((($94)) + 1|0);
    $97 = HEAP8[$96>>0]|0;
    $98 = ($97<<24>>24)==(42);
    if (!($98)) {
     $125 = ((($94)) + 1|0);
     HEAP32[$5>>2] = $125;
     $126 = (_getint($5)|0);
     $$pre347$pre = HEAP32[$5>>2]|0;
     $$0254 = $126;$$pre347 = $$pre347$pre;
     break;
    }
    $99 = ((($94)) + 2|0);
    $100 = HEAP8[$99>>0]|0;
    $101 = $100 << 24 >> 24;
    $isdigittmp274 = (($101) + -48)|0;
    $isdigit275 = ($isdigittmp274>>>0)<(10);
    if ($isdigit275) {
     $102 = ((($94)) + 3|0);
     $103 = HEAP8[$102>>0]|0;
     $104 = ($103<<24>>24)==(36);
     if ($104) {
      $105 = (($4) + ($isdigittmp274<<2)|0);
      HEAP32[$105>>2] = 10;
      $106 = HEAP8[$99>>0]|0;
      $107 = $106 << 24 >> 24;
      $108 = (($107) + -48)|0;
      $109 = (($3) + ($108<<3)|0);
      $110 = $109;
      $111 = $110;
      $112 = HEAP32[$111>>2]|0;
      $113 = (($110) + 4)|0;
      $114 = $113;
      $115 = HEAP32[$114>>2]|0;
      $116 = ((($94)) + 4|0);
      HEAP32[$5>>2] = $116;
      $$0254 = $112;$$pre347 = $116;
      break;
     }
    }
    $117 = ($$3272|0)==(0);
    if (!($117)) {
     $$0 = -1;
     break L1;
    }
    if ($10) {
     $arglist_current2 = HEAP32[$2>>2]|0;
     $118 = $arglist_current2;
     $119 = ((0) + 4|0);
     $expanded11 = $119;
     $expanded10 = (($expanded11) - 1)|0;
     $120 = (($118) + ($expanded10))|0;
     $121 = ((0) + 4|0);
     $expanded15 = $121;
     $expanded14 = (($expanded15) - 1)|0;
     $expanded13 = $expanded14 ^ -1;
     $122 = $120 & $expanded13;
     $123 = $122;
     $124 = HEAP32[$123>>2]|0;
     $arglist_next3 = ((($123)) + 4|0);
     HEAP32[$2>>2] = $arglist_next3;
     $330 = $124;
    } else {
     $330 = 0;
    }
    HEAP32[$5>>2] = $99;
    $$0254 = $330;$$pre347 = $99;
   } else {
    $$0254 = -1;$$pre347 = $94;
   }
  } while(0);
  $$0252 = 0;$128 = $$pre347;
  while(1) {
   $127 = HEAP8[$128>>0]|0;
   $129 = $127 << 24 >> 24;
   $130 = (($129) + -65)|0;
   $131 = ($130>>>0)>(57);
   if ($131) {
    $$0 = -1;
    break L1;
   }
   $132 = ((($128)) + 1|0);
   HEAP32[$5>>2] = $132;
   $133 = HEAP8[$128>>0]|0;
   $134 = $133 << 24 >> 24;
   $135 = (($134) + -65)|0;
   $136 = ((2872 + (($$0252*58)|0)|0) + ($135)|0);
   $137 = HEAP8[$136>>0]|0;
   $138 = $137&255;
   $139 = (($138) + -1)|0;
   $140 = ($139>>>0)<(8);
   if ($140) {
    $$0252 = $138;$128 = $132;
   } else {
    break;
   }
  }
  $141 = ($137<<24>>24)==(0);
  if ($141) {
   $$0 = -1;
   break;
  }
  $142 = ($137<<24>>24)==(19);
  $143 = ($$0253|0)>(-1);
  do {
   if ($142) {
    if ($143) {
     $$0 = -1;
     break L1;
    } else {
     label = 49;
    }
   } else {
    if ($143) {
     $144 = (($4) + ($$0253<<2)|0);
     HEAP32[$144>>2] = $138;
     $145 = (($3) + ($$0253<<3)|0);
     $146 = $145;
     $147 = $146;
     $148 = HEAP32[$147>>2]|0;
     $149 = (($146) + 4)|0;
     $150 = $149;
     $151 = HEAP32[$150>>2]|0;
     $152 = $6;
     $153 = $152;
     HEAP32[$153>>2] = $148;
     $154 = (($152) + 4)|0;
     $155 = $154;
     HEAP32[$155>>2] = $151;
     label = 49;
     break;
    }
    if (!($10)) {
     $$0 = 0;
     break L1;
    }
    _pop_arg($6,$138,$2);
   }
  } while(0);
  if ((label|0) == 49) {
   label = 0;
   if (!($10)) {
    $$0243 = 0;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
    continue;
   }
  }
  $156 = HEAP8[$128>>0]|0;
  $157 = $156 << 24 >> 24;
  $158 = ($$0252|0)!=(0);
  $159 = $157 & 15;
  $160 = ($159|0)==(3);
  $or$cond281 = $158 & $160;
  $161 = $157 & -33;
  $$0235 = $or$cond281 ? $161 : $157;
  $162 = $$1263 & 8192;
  $163 = ($162|0)==(0);
  $164 = $$1263 & -65537;
  $$1263$ = $163 ? $$1263 : $164;
  L71: do {
   switch ($$0235|0) {
   case 110:  {
    $trunc = $$0252&255;
    switch ($trunc<<24>>24) {
    case 0:  {
     $171 = HEAP32[$6>>2]|0;
     HEAP32[$171>>2] = $$1248;
     $$0243 = 0;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
     continue L1;
     break;
    }
    case 1:  {
     $172 = HEAP32[$6>>2]|0;
     HEAP32[$172>>2] = $$1248;
     $$0243 = 0;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
     continue L1;
     break;
    }
    case 2:  {
     $173 = ($$1248|0)<(0);
     $174 = $173 << 31 >> 31;
     $175 = HEAP32[$6>>2]|0;
     $176 = $175;
     $177 = $176;
     HEAP32[$177>>2] = $$1248;
     $178 = (($176) + 4)|0;
     $179 = $178;
     HEAP32[$179>>2] = $174;
     $$0243 = 0;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
     continue L1;
     break;
    }
    case 3:  {
     $180 = $$1248&65535;
     $181 = HEAP32[$6>>2]|0;
     HEAP16[$181>>1] = $180;
     $$0243 = 0;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
     continue L1;
     break;
    }
    case 4:  {
     $182 = $$1248&255;
     $183 = HEAP32[$6>>2]|0;
     HEAP8[$183>>0] = $182;
     $$0243 = 0;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
     continue L1;
     break;
    }
    case 6:  {
     $184 = HEAP32[$6>>2]|0;
     HEAP32[$184>>2] = $$1248;
     $$0243 = 0;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
     continue L1;
     break;
    }
    case 7:  {
     $185 = ($$1248|0)<(0);
     $186 = $185 << 31 >> 31;
     $187 = HEAP32[$6>>2]|0;
     $188 = $187;
     $189 = $188;
     HEAP32[$189>>2] = $$1248;
     $190 = (($188) + 4)|0;
     $191 = $190;
     HEAP32[$191>>2] = $186;
     $$0243 = 0;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
     continue L1;
     break;
    }
    default: {
     $$0243 = 0;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
     continue L1;
    }
    }
    break;
   }
   case 112:  {
    $192 = ($$0254>>>0)>(8);
    $193 = $192 ? $$0254 : 8;
    $194 = $$1263$ | 8;
    $$1236 = 120;$$1255 = $193;$$3265 = $194;
    label = 61;
    break;
   }
   case 88: case 120:  {
    $$1236 = $$0235;$$1255 = $$0254;$$3265 = $$1263$;
    label = 61;
    break;
   }
   case 111:  {
    $210 = $6;
    $211 = $210;
    $212 = HEAP32[$211>>2]|0;
    $213 = (($210) + 4)|0;
    $214 = $213;
    $215 = HEAP32[$214>>2]|0;
    $216 = (_fmt_o($212,$215,$11)|0);
    $217 = $$1263$ & 8;
    $218 = ($217|0)==(0);
    $219 = $216;
    $220 = (($12) - ($219))|0;
    $221 = ($$0254|0)>($220|0);
    $222 = (($220) + 1)|0;
    $223 = $218 | $221;
    $$0254$$0254$ = $223 ? $$0254 : $222;
    $$0228 = $216;$$1233 = 0;$$1238 = 3336;$$2256 = $$0254$$0254$;$$4266 = $$1263$;$248 = $212;$250 = $215;
    label = 67;
    break;
   }
   case 105: case 100:  {
    $224 = $6;
    $225 = $224;
    $226 = HEAP32[$225>>2]|0;
    $227 = (($224) + 4)|0;
    $228 = $227;
    $229 = HEAP32[$228>>2]|0;
    $230 = ($229|0)<(0);
    if ($230) {
     $231 = (_i64Subtract(0,0,($226|0),($229|0))|0);
     $232 = tempRet0;
     $233 = $6;
     $234 = $233;
     HEAP32[$234>>2] = $231;
     $235 = (($233) + 4)|0;
     $236 = $235;
     HEAP32[$236>>2] = $232;
     $$0232 = 1;$$0237 = 3336;$242 = $231;$243 = $232;
     label = 66;
     break L71;
    } else {
     $237 = $$1263$ & 2048;
     $238 = ($237|0)==(0);
     $239 = $$1263$ & 1;
     $240 = ($239|0)==(0);
     $$ = $240 ? 3336 : (3338);
     $$$ = $238 ? $$ : (3337);
     $241 = $$1263$ & 2049;
     $narrow = ($241|0)!=(0);
     $$284$ = $narrow&1;
     $$0232 = $$284$;$$0237 = $$$;$242 = $226;$243 = $229;
     label = 66;
     break L71;
    }
    break;
   }
   case 117:  {
    $165 = $6;
    $166 = $165;
    $167 = HEAP32[$166>>2]|0;
    $168 = (($165) + 4)|0;
    $169 = $168;
    $170 = HEAP32[$169>>2]|0;
    $$0232 = 0;$$0237 = 3336;$242 = $167;$243 = $170;
    label = 66;
    break;
   }
   case 99:  {
    $259 = $6;
    $260 = $259;
    $261 = HEAP32[$260>>2]|0;
    $262 = (($259) + 4)|0;
    $263 = $262;
    $264 = HEAP32[$263>>2]|0;
    $265 = $261&255;
    HEAP8[$13>>0] = $265;
    $$2 = $13;$$2234 = 0;$$2239 = 3336;$$2251 = $11;$$5 = 1;$$6268 = $164;
    break;
   }
   case 109:  {
    $266 = (___errno_location()|0);
    $267 = HEAP32[$266>>2]|0;
    $268 = (_strerror($267)|0);
    $$1 = $268;
    label = 71;
    break;
   }
   case 115:  {
    $269 = HEAP32[$6>>2]|0;
    $270 = ($269|0)!=(0|0);
    $271 = $270 ? $269 : 3346;
    $$1 = $271;
    label = 71;
    break;
   }
   case 67:  {
    $278 = $6;
    $279 = $278;
    $280 = HEAP32[$279>>2]|0;
    $281 = (($278) + 4)|0;
    $282 = $281;
    $283 = HEAP32[$282>>2]|0;
    HEAP32[$8>>2] = $280;
    HEAP32[$14>>2] = 0;
    HEAP32[$6>>2] = $8;
    $$4258355 = -1;$331 = $8;
    label = 75;
    break;
   }
   case 83:  {
    $$pre349 = HEAP32[$6>>2]|0;
    $284 = ($$0254|0)==(0);
    if ($284) {
     _pad_682($0,32,$$1260,0,$$1263$);
     $$0240$lcssa357 = 0;
     label = 84;
    } else {
     $$4258355 = $$0254;$331 = $$pre349;
     label = 75;
    }
    break;
   }
   case 65: case 71: case 70: case 69: case 97: case 103: case 102: case 101:  {
    $306 = +HEAPF64[$6>>3];
    $307 = (_fmt_fp($0,$306,$$1260,$$0254,$$1263$,$$0235)|0);
    $$0243 = $307;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
    continue L1;
    break;
   }
   default: {
    $$2 = $21;$$2234 = 0;$$2239 = 3336;$$2251 = $11;$$5 = $$0254;$$6268 = $$1263$;
   }
   }
  } while(0);
  L95: do {
   if ((label|0) == 61) {
    label = 0;
    $195 = $6;
    $196 = $195;
    $197 = HEAP32[$196>>2]|0;
    $198 = (($195) + 4)|0;
    $199 = $198;
    $200 = HEAP32[$199>>2]|0;
    $201 = $$1236 & 32;
    $202 = (_fmt_x($197,$200,$11,$201)|0);
    $203 = ($197|0)==(0);
    $204 = ($200|0)==(0);
    $205 = $203 & $204;
    $206 = $$3265 & 8;
    $207 = ($206|0)==(0);
    $or$cond283 = $207 | $205;
    $208 = $$1236 >> 4;
    $209 = (3336 + ($208)|0);
    $$289 = $or$cond283 ? 3336 : $209;
    $$290 = $or$cond283 ? 0 : 2;
    $$0228 = $202;$$1233 = $$290;$$1238 = $$289;$$2256 = $$1255;$$4266 = $$3265;$248 = $197;$250 = $200;
    label = 67;
   }
   else if ((label|0) == 66) {
    label = 0;
    $244 = (_fmt_u($242,$243,$11)|0);
    $$0228 = $244;$$1233 = $$0232;$$1238 = $$0237;$$2256 = $$0254;$$4266 = $$1263$;$248 = $242;$250 = $243;
    label = 67;
   }
   else if ((label|0) == 71) {
    label = 0;
    $272 = (_memchr($$1,0,$$0254)|0);
    $273 = ($272|0)==(0|0);
    $274 = $272;
    $275 = $$1;
    $276 = (($274) - ($275))|0;
    $277 = (($$1) + ($$0254)|0);
    $$3257 = $273 ? $$0254 : $276;
    $$1250 = $273 ? $277 : $272;
    $$2 = $$1;$$2234 = 0;$$2239 = 3336;$$2251 = $$1250;$$5 = $$3257;$$6268 = $164;
   }
   else if ((label|0) == 75) {
    label = 0;
    $$0229322 = $331;$$0240321 = 0;$$1244320 = 0;
    while(1) {
     $285 = HEAP32[$$0229322>>2]|0;
     $286 = ($285|0)==(0);
     if ($286) {
      $$0240$lcssa = $$0240321;$$2245 = $$1244320;
      break;
     }
     $287 = (_wctomb($9,$285)|0);
     $288 = ($287|0)<(0);
     $289 = (($$4258355) - ($$0240321))|0;
     $290 = ($287>>>0)>($289>>>0);
     $or$cond286 = $288 | $290;
     if ($or$cond286) {
      $$0240$lcssa = $$0240321;$$2245 = $287;
      break;
     }
     $291 = ((($$0229322)) + 4|0);
     $292 = (($287) + ($$0240321))|0;
     $293 = ($$4258355>>>0)>($292>>>0);
     if ($293) {
      $$0229322 = $291;$$0240321 = $292;$$1244320 = $287;
     } else {
      $$0240$lcssa = $292;$$2245 = $287;
      break;
     }
    }
    $294 = ($$2245|0)<(0);
    if ($294) {
     $$0 = -1;
     break L1;
    }
    _pad_682($0,32,$$1260,$$0240$lcssa,$$1263$);
    $295 = ($$0240$lcssa|0)==(0);
    if ($295) {
     $$0240$lcssa357 = 0;
     label = 84;
    } else {
     $$1230333 = $331;$$1241332 = 0;
     while(1) {
      $296 = HEAP32[$$1230333>>2]|0;
      $297 = ($296|0)==(0);
      if ($297) {
       $$0240$lcssa357 = $$0240$lcssa;
       label = 84;
       break L95;
      }
      $298 = (_wctomb($9,$296)|0);
      $299 = (($298) + ($$1241332))|0;
      $300 = ($299|0)>($$0240$lcssa|0);
      if ($300) {
       $$0240$lcssa357 = $$0240$lcssa;
       label = 84;
       break L95;
      }
      $301 = ((($$1230333)) + 4|0);
      _out($0,$9,$298);
      $302 = ($299>>>0)<($$0240$lcssa>>>0);
      if ($302) {
       $$1230333 = $301;$$1241332 = $299;
      } else {
       $$0240$lcssa357 = $$0240$lcssa;
       label = 84;
       break;
      }
     }
    }
   }
  } while(0);
  if ((label|0) == 67) {
   label = 0;
   $245 = ($$2256|0)>(-1);
   $246 = $$4266 & -65537;
   $$$4266 = $245 ? $246 : $$4266;
   $247 = ($248|0)!=(0);
   $249 = ($250|0)!=(0);
   $251 = $247 | $249;
   $252 = ($$2256|0)!=(0);
   $or$cond = $252 | $251;
   $253 = $$0228;
   $254 = (($12) - ($253))|0;
   $255 = $251 ^ 1;
   $256 = $255&1;
   $257 = (($256) + ($254))|0;
   $258 = ($$2256|0)>($257|0);
   $$2256$ = $258 ? $$2256 : $257;
   $$2256$$$2256 = $or$cond ? $$2256$ : $$2256;
   $$0228$ = $or$cond ? $$0228 : $11;
   $$2 = $$0228$;$$2234 = $$1233;$$2239 = $$1238;$$2251 = $11;$$5 = $$2256$$$2256;$$6268 = $$$4266;
  }
  else if ((label|0) == 84) {
   label = 0;
   $303 = $$1263$ ^ 8192;
   _pad_682($0,32,$$1260,$$0240$lcssa357,$303);
   $304 = ($$1260|0)>($$0240$lcssa357|0);
   $305 = $304 ? $$1260 : $$0240$lcssa357;
   $$0243 = $305;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
   continue;
  }
  $308 = $$2251;
  $309 = $$2;
  $310 = (($308) - ($309))|0;
  $311 = ($$5|0)<($310|0);
  $$$5 = $311 ? $310 : $$5;
  $312 = (($$$5) + ($$2234))|0;
  $313 = ($$1260|0)<($312|0);
  $$2261 = $313 ? $312 : $$1260;
  _pad_682($0,32,$$2261,$312,$$6268);
  _out($0,$$2239,$$2234);
  $314 = $$6268 ^ 65536;
  _pad_682($0,48,$$2261,$312,$314);
  _pad_682($0,48,$$$5,$310,0);
  _out($0,$$2,$310);
  $315 = $$6268 ^ 8192;
  _pad_682($0,32,$$2261,$312,$315);
  $$0243 = $$2261;$$0247 = $$1248;$$0269 = $$3272;$21 = $132;
 }
 L114: do {
  if ((label|0) == 87) {
   $316 = ($0|0)==(0|0);
   if ($316) {
    $317 = ($$0269|0)==(0);
    if ($317) {
     $$0 = 0;
    } else {
     $$2242305 = 1;
     while(1) {
      $318 = (($4) + ($$2242305<<2)|0);
      $319 = HEAP32[$318>>2]|0;
      $320 = ($319|0)==(0);
      if ($320) {
       $$3303 = $$2242305;
       break;
      }
      $321 = (($3) + ($$2242305<<3)|0);
      _pop_arg($321,$319,$2);
      $322 = (($$2242305) + 1)|0;
      $323 = ($322|0)<(10);
      if ($323) {
       $$2242305 = $322;
      } else {
       $$0 = 1;
       break L114;
      }
     }
     while(1) {
      $326 = (($4) + ($$3303<<2)|0);
      $327 = HEAP32[$326>>2]|0;
      $328 = ($327|0)==(0);
      $325 = (($$3303) + 1)|0;
      if (!($328)) {
       $$0 = -1;
       break L114;
      }
      $324 = ($325|0)<(10);
      if ($324) {
       $$3303 = $325;
      } else {
       $$0 = 1;
       break;
      }
     }
    }
   } else {
    $$0 = $$1248;
   }
  }
 } while(0);
 STACKTOP = sp;return ($$0|0);
}
function ___lockfile($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 0;
}
function ___unlockfile($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function _out($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = HEAP32[$0>>2]|0;
 $4 = $3 & 32;
 $5 = ($4|0)==(0);
 if ($5) {
  (___fwritex($1,$2,$0)|0);
 }
 return;
}
function _getint($0) {
 $0 = $0|0;
 var $$0$lcssa = 0, $$06 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $isdigit = 0, $isdigit5 = 0, $isdigittmp = 0, $isdigittmp4 = 0, $isdigittmp7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = HEAP8[$1>>0]|0;
 $3 = $2 << 24 >> 24;
 $isdigittmp4 = (($3) + -48)|0;
 $isdigit5 = ($isdigittmp4>>>0)<(10);
 if ($isdigit5) {
  $$06 = 0;$7 = $1;$isdigittmp7 = $isdigittmp4;
  while(1) {
   $4 = ($$06*10)|0;
   $5 = (($isdigittmp7) + ($4))|0;
   $6 = ((($7)) + 1|0);
   HEAP32[$0>>2] = $6;
   $8 = HEAP8[$6>>0]|0;
   $9 = $8 << 24 >> 24;
   $isdigittmp = (($9) + -48)|0;
   $isdigit = ($isdigittmp>>>0)<(10);
   if ($isdigit) {
    $$06 = $5;$7 = $6;$isdigittmp7 = $isdigittmp;
   } else {
    $$0$lcssa = $5;
    break;
   }
  }
 } else {
  $$0$lcssa = 0;
 }
 return ($$0$lcssa|0);
}
function _pop_arg($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$mask = 0, $$mask31 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0.0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0.0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0;
 var $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0;
 var $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0;
 var $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0;
 var $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $arglist_current = 0, $arglist_current11 = 0, $arglist_current14 = 0, $arglist_current17 = 0;
 var $arglist_current2 = 0, $arglist_current20 = 0, $arglist_current23 = 0, $arglist_current26 = 0, $arglist_current5 = 0, $arglist_current8 = 0, $arglist_next = 0, $arglist_next12 = 0, $arglist_next15 = 0, $arglist_next18 = 0, $arglist_next21 = 0, $arglist_next24 = 0, $arglist_next27 = 0, $arglist_next3 = 0, $arglist_next6 = 0, $arglist_next9 = 0, $expanded = 0, $expanded28 = 0, $expanded30 = 0, $expanded31 = 0;
 var $expanded32 = 0, $expanded34 = 0, $expanded35 = 0, $expanded37 = 0, $expanded38 = 0, $expanded39 = 0, $expanded41 = 0, $expanded42 = 0, $expanded44 = 0, $expanded45 = 0, $expanded46 = 0, $expanded48 = 0, $expanded49 = 0, $expanded51 = 0, $expanded52 = 0, $expanded53 = 0, $expanded55 = 0, $expanded56 = 0, $expanded58 = 0, $expanded59 = 0;
 var $expanded60 = 0, $expanded62 = 0, $expanded63 = 0, $expanded65 = 0, $expanded66 = 0, $expanded67 = 0, $expanded69 = 0, $expanded70 = 0, $expanded72 = 0, $expanded73 = 0, $expanded74 = 0, $expanded76 = 0, $expanded77 = 0, $expanded79 = 0, $expanded80 = 0, $expanded81 = 0, $expanded83 = 0, $expanded84 = 0, $expanded86 = 0, $expanded87 = 0;
 var $expanded88 = 0, $expanded90 = 0, $expanded91 = 0, $expanded93 = 0, $expanded94 = 0, $expanded95 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = ($1>>>0)>(20);
 L1: do {
  if (!($3)) {
   do {
    switch ($1|0) {
    case 9:  {
     $arglist_current = HEAP32[$2>>2]|0;
     $4 = $arglist_current;
     $5 = ((0) + 4|0);
     $expanded28 = $5;
     $expanded = (($expanded28) - 1)|0;
     $6 = (($4) + ($expanded))|0;
     $7 = ((0) + 4|0);
     $expanded32 = $7;
     $expanded31 = (($expanded32) - 1)|0;
     $expanded30 = $expanded31 ^ -1;
     $8 = $6 & $expanded30;
     $9 = $8;
     $10 = HEAP32[$9>>2]|0;
     $arglist_next = ((($9)) + 4|0);
     HEAP32[$2>>2] = $arglist_next;
     HEAP32[$0>>2] = $10;
     break L1;
     break;
    }
    case 10:  {
     $arglist_current2 = HEAP32[$2>>2]|0;
     $11 = $arglist_current2;
     $12 = ((0) + 4|0);
     $expanded35 = $12;
     $expanded34 = (($expanded35) - 1)|0;
     $13 = (($11) + ($expanded34))|0;
     $14 = ((0) + 4|0);
     $expanded39 = $14;
     $expanded38 = (($expanded39) - 1)|0;
     $expanded37 = $expanded38 ^ -1;
     $15 = $13 & $expanded37;
     $16 = $15;
     $17 = HEAP32[$16>>2]|0;
     $arglist_next3 = ((($16)) + 4|0);
     HEAP32[$2>>2] = $arglist_next3;
     $18 = ($17|0)<(0);
     $19 = $18 << 31 >> 31;
     $20 = $0;
     $21 = $20;
     HEAP32[$21>>2] = $17;
     $22 = (($20) + 4)|0;
     $23 = $22;
     HEAP32[$23>>2] = $19;
     break L1;
     break;
    }
    case 11:  {
     $arglist_current5 = HEAP32[$2>>2]|0;
     $24 = $arglist_current5;
     $25 = ((0) + 4|0);
     $expanded42 = $25;
     $expanded41 = (($expanded42) - 1)|0;
     $26 = (($24) + ($expanded41))|0;
     $27 = ((0) + 4|0);
     $expanded46 = $27;
     $expanded45 = (($expanded46) - 1)|0;
     $expanded44 = $expanded45 ^ -1;
     $28 = $26 & $expanded44;
     $29 = $28;
     $30 = HEAP32[$29>>2]|0;
     $arglist_next6 = ((($29)) + 4|0);
     HEAP32[$2>>2] = $arglist_next6;
     $31 = $0;
     $32 = $31;
     HEAP32[$32>>2] = $30;
     $33 = (($31) + 4)|0;
     $34 = $33;
     HEAP32[$34>>2] = 0;
     break L1;
     break;
    }
    case 12:  {
     $arglist_current8 = HEAP32[$2>>2]|0;
     $35 = $arglist_current8;
     $36 = ((0) + 8|0);
     $expanded49 = $36;
     $expanded48 = (($expanded49) - 1)|0;
     $37 = (($35) + ($expanded48))|0;
     $38 = ((0) + 8|0);
     $expanded53 = $38;
     $expanded52 = (($expanded53) - 1)|0;
     $expanded51 = $expanded52 ^ -1;
     $39 = $37 & $expanded51;
     $40 = $39;
     $41 = $40;
     $42 = $41;
     $43 = HEAP32[$42>>2]|0;
     $44 = (($41) + 4)|0;
     $45 = $44;
     $46 = HEAP32[$45>>2]|0;
     $arglist_next9 = ((($40)) + 8|0);
     HEAP32[$2>>2] = $arglist_next9;
     $47 = $0;
     $48 = $47;
     HEAP32[$48>>2] = $43;
     $49 = (($47) + 4)|0;
     $50 = $49;
     HEAP32[$50>>2] = $46;
     break L1;
     break;
    }
    case 13:  {
     $arglist_current11 = HEAP32[$2>>2]|0;
     $51 = $arglist_current11;
     $52 = ((0) + 4|0);
     $expanded56 = $52;
     $expanded55 = (($expanded56) - 1)|0;
     $53 = (($51) + ($expanded55))|0;
     $54 = ((0) + 4|0);
     $expanded60 = $54;
     $expanded59 = (($expanded60) - 1)|0;
     $expanded58 = $expanded59 ^ -1;
     $55 = $53 & $expanded58;
     $56 = $55;
     $57 = HEAP32[$56>>2]|0;
     $arglist_next12 = ((($56)) + 4|0);
     HEAP32[$2>>2] = $arglist_next12;
     $58 = $57&65535;
     $59 = $58 << 16 >> 16;
     $60 = ($59|0)<(0);
     $61 = $60 << 31 >> 31;
     $62 = $0;
     $63 = $62;
     HEAP32[$63>>2] = $59;
     $64 = (($62) + 4)|0;
     $65 = $64;
     HEAP32[$65>>2] = $61;
     break L1;
     break;
    }
    case 14:  {
     $arglist_current14 = HEAP32[$2>>2]|0;
     $66 = $arglist_current14;
     $67 = ((0) + 4|0);
     $expanded63 = $67;
     $expanded62 = (($expanded63) - 1)|0;
     $68 = (($66) + ($expanded62))|0;
     $69 = ((0) + 4|0);
     $expanded67 = $69;
     $expanded66 = (($expanded67) - 1)|0;
     $expanded65 = $expanded66 ^ -1;
     $70 = $68 & $expanded65;
     $71 = $70;
     $72 = HEAP32[$71>>2]|0;
     $arglist_next15 = ((($71)) + 4|0);
     HEAP32[$2>>2] = $arglist_next15;
     $$mask31 = $72 & 65535;
     $73 = $0;
     $74 = $73;
     HEAP32[$74>>2] = $$mask31;
     $75 = (($73) + 4)|0;
     $76 = $75;
     HEAP32[$76>>2] = 0;
     break L1;
     break;
    }
    case 15:  {
     $arglist_current17 = HEAP32[$2>>2]|0;
     $77 = $arglist_current17;
     $78 = ((0) + 4|0);
     $expanded70 = $78;
     $expanded69 = (($expanded70) - 1)|0;
     $79 = (($77) + ($expanded69))|0;
     $80 = ((0) + 4|0);
     $expanded74 = $80;
     $expanded73 = (($expanded74) - 1)|0;
     $expanded72 = $expanded73 ^ -1;
     $81 = $79 & $expanded72;
     $82 = $81;
     $83 = HEAP32[$82>>2]|0;
     $arglist_next18 = ((($82)) + 4|0);
     HEAP32[$2>>2] = $arglist_next18;
     $84 = $83&255;
     $85 = $84 << 24 >> 24;
     $86 = ($85|0)<(0);
     $87 = $86 << 31 >> 31;
     $88 = $0;
     $89 = $88;
     HEAP32[$89>>2] = $85;
     $90 = (($88) + 4)|0;
     $91 = $90;
     HEAP32[$91>>2] = $87;
     break L1;
     break;
    }
    case 16:  {
     $arglist_current20 = HEAP32[$2>>2]|0;
     $92 = $arglist_current20;
     $93 = ((0) + 4|0);
     $expanded77 = $93;
     $expanded76 = (($expanded77) - 1)|0;
     $94 = (($92) + ($expanded76))|0;
     $95 = ((0) + 4|0);
     $expanded81 = $95;
     $expanded80 = (($expanded81) - 1)|0;
     $expanded79 = $expanded80 ^ -1;
     $96 = $94 & $expanded79;
     $97 = $96;
     $98 = HEAP32[$97>>2]|0;
     $arglist_next21 = ((($97)) + 4|0);
     HEAP32[$2>>2] = $arglist_next21;
     $$mask = $98 & 255;
     $99 = $0;
     $100 = $99;
     HEAP32[$100>>2] = $$mask;
     $101 = (($99) + 4)|0;
     $102 = $101;
     HEAP32[$102>>2] = 0;
     break L1;
     break;
    }
    case 17:  {
     $arglist_current23 = HEAP32[$2>>2]|0;
     $103 = $arglist_current23;
     $104 = ((0) + 8|0);
     $expanded84 = $104;
     $expanded83 = (($expanded84) - 1)|0;
     $105 = (($103) + ($expanded83))|0;
     $106 = ((0) + 8|0);
     $expanded88 = $106;
     $expanded87 = (($expanded88) - 1)|0;
     $expanded86 = $expanded87 ^ -1;
     $107 = $105 & $expanded86;
     $108 = $107;
     $109 = +HEAPF64[$108>>3];
     $arglist_next24 = ((($108)) + 8|0);
     HEAP32[$2>>2] = $arglist_next24;
     HEAPF64[$0>>3] = $109;
     break L1;
     break;
    }
    case 18:  {
     $arglist_current26 = HEAP32[$2>>2]|0;
     $110 = $arglist_current26;
     $111 = ((0) + 8|0);
     $expanded91 = $111;
     $expanded90 = (($expanded91) - 1)|0;
     $112 = (($110) + ($expanded90))|0;
     $113 = ((0) + 8|0);
     $expanded95 = $113;
     $expanded94 = (($expanded95) - 1)|0;
     $expanded93 = $expanded94 ^ -1;
     $114 = $112 & $expanded93;
     $115 = $114;
     $116 = +HEAPF64[$115>>3];
     $arglist_next27 = ((($115)) + 8|0);
     HEAP32[$2>>2] = $arglist_next27;
     HEAPF64[$0>>3] = $116;
     break L1;
     break;
    }
    default: {
     break L1;
    }
    }
   } while(0);
  }
 } while(0);
 return;
}
function _fmt_x($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $$05$lcssa = 0, $$056 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $4 = ($0|0)==(0);
 $5 = ($1|0)==(0);
 $6 = $4 & $5;
 if ($6) {
  $$05$lcssa = $2;
 } else {
  $$056 = $2;$15 = $1;$8 = $0;
  while(1) {
   $7 = $8 & 15;
   $9 = (3388 + ($7)|0);
   $10 = HEAP8[$9>>0]|0;
   $11 = $10&255;
   $12 = $11 | $3;
   $13 = $12&255;
   $14 = ((($$056)) + -1|0);
   HEAP8[$14>>0] = $13;
   $16 = (_bitshift64Lshr(($8|0),($15|0),4)|0);
   $17 = tempRet0;
   $18 = ($16|0)==(0);
   $19 = ($17|0)==(0);
   $20 = $18 & $19;
   if ($20) {
    $$05$lcssa = $14;
    break;
   } else {
    $$056 = $14;$15 = $17;$8 = $16;
   }
  }
 }
 return ($$05$lcssa|0);
}
function _fmt_o($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$0$lcssa = 0, $$06 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = ($0|0)==(0);
 $4 = ($1|0)==(0);
 $5 = $3 & $4;
 if ($5) {
  $$0$lcssa = $2;
 } else {
  $$06 = $2;$11 = $1;$7 = $0;
  while(1) {
   $6 = $7&255;
   $8 = $6 & 7;
   $9 = $8 | 48;
   $10 = ((($$06)) + -1|0);
   HEAP8[$10>>0] = $9;
   $12 = (_bitshift64Lshr(($7|0),($11|0),3)|0);
   $13 = tempRet0;
   $14 = ($12|0)==(0);
   $15 = ($13|0)==(0);
   $16 = $14 & $15;
   if ($16) {
    $$0$lcssa = $10;
    break;
   } else {
    $$06 = $10;$11 = $13;$7 = $12;
   }
  }
 }
 return ($$0$lcssa|0);
}
function _fmt_u($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$010$lcssa$off0 = 0, $$012 = 0, $$09$lcssa = 0, $$0914 = 0, $$1$lcssa = 0, $$111 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0;
 var $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = ($1>>>0)>(0);
 $4 = ($0>>>0)>(4294967295);
 $5 = ($1|0)==(0);
 $6 = $5 & $4;
 $7 = $3 | $6;
 if ($7) {
  $$0914 = $2;$8 = $0;$9 = $1;
  while(1) {
   $10 = (___uremdi3(($8|0),($9|0),10,0)|0);
   $11 = tempRet0;
   $12 = $10&255;
   $13 = $12 | 48;
   $14 = ((($$0914)) + -1|0);
   HEAP8[$14>>0] = $13;
   $15 = (___udivdi3(($8|0),($9|0),10,0)|0);
   $16 = tempRet0;
   $17 = ($9>>>0)>(9);
   $18 = ($8>>>0)>(4294967295);
   $19 = ($9|0)==(9);
   $20 = $19 & $18;
   $21 = $17 | $20;
   if ($21) {
    $$0914 = $14;$8 = $15;$9 = $16;
   } else {
    break;
   }
  }
  $$010$lcssa$off0 = $15;$$09$lcssa = $14;
 } else {
  $$010$lcssa$off0 = $0;$$09$lcssa = $2;
 }
 $22 = ($$010$lcssa$off0|0)==(0);
 if ($22) {
  $$1$lcssa = $$09$lcssa;
 } else {
  $$012 = $$010$lcssa$off0;$$111 = $$09$lcssa;
  while(1) {
   $23 = (($$012>>>0) % 10)&-1;
   $24 = $23 | 48;
   $25 = $24&255;
   $26 = ((($$111)) + -1|0);
   HEAP8[$26>>0] = $25;
   $27 = (($$012>>>0) / 10)&-1;
   $28 = ($$012>>>0)<(10);
   if ($28) {
    $$1$lcssa = $26;
    break;
   } else {
    $$012 = $27;$$111 = $26;
   }
  }
 }
 return ($$1$lcssa|0);
}
function _strerror($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (___pthread_self_104()|0);
 $2 = ((($1)) + 188|0);
 $3 = HEAP32[$2>>2]|0;
 $4 = (___strerror_l($0,$3)|0);
 return ($4|0);
}
function _memchr($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$0$lcssa = 0, $$035$lcssa = 0, $$035$lcssa65 = 0, $$03555 = 0, $$036$lcssa = 0, $$036$lcssa64 = 0, $$03654 = 0, $$046 = 0, $$137$lcssa = 0, $$13745 = 0, $$140 = 0, $$2 = 0, $$23839 = 0, $$3 = 0, $$lcssa = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0;
 var $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0;
 var $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, $or$cond53 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = $1 & 255;
 $4 = $0;
 $5 = $4 & 3;
 $6 = ($5|0)!=(0);
 $7 = ($2|0)!=(0);
 $or$cond53 = $7 & $6;
 L1: do {
  if ($or$cond53) {
   $8 = $1&255;
   $$03555 = $0;$$03654 = $2;
   while(1) {
    $9 = HEAP8[$$03555>>0]|0;
    $10 = ($9<<24>>24)==($8<<24>>24);
    if ($10) {
     $$035$lcssa65 = $$03555;$$036$lcssa64 = $$03654;
     label = 6;
     break L1;
    }
    $11 = ((($$03555)) + 1|0);
    $12 = (($$03654) + -1)|0;
    $13 = $11;
    $14 = $13 & 3;
    $15 = ($14|0)!=(0);
    $16 = ($12|0)!=(0);
    $or$cond = $16 & $15;
    if ($or$cond) {
     $$03555 = $11;$$03654 = $12;
    } else {
     $$035$lcssa = $11;$$036$lcssa = $12;$$lcssa = $16;
     label = 5;
     break;
    }
   }
  } else {
   $$035$lcssa = $0;$$036$lcssa = $2;$$lcssa = $7;
   label = 5;
  }
 } while(0);
 if ((label|0) == 5) {
  if ($$lcssa) {
   $$035$lcssa65 = $$035$lcssa;$$036$lcssa64 = $$036$lcssa;
   label = 6;
  } else {
   $$2 = $$035$lcssa;$$3 = 0;
  }
 }
 L8: do {
  if ((label|0) == 6) {
   $17 = HEAP8[$$035$lcssa65>>0]|0;
   $18 = $1&255;
   $19 = ($17<<24>>24)==($18<<24>>24);
   if ($19) {
    $$2 = $$035$lcssa65;$$3 = $$036$lcssa64;
   } else {
    $20 = Math_imul($3, 16843009)|0;
    $21 = ($$036$lcssa64>>>0)>(3);
    L11: do {
     if ($21) {
      $$046 = $$035$lcssa65;$$13745 = $$036$lcssa64;
      while(1) {
       $22 = HEAP32[$$046>>2]|0;
       $23 = $22 ^ $20;
       $24 = (($23) + -16843009)|0;
       $25 = $23 & -2139062144;
       $26 = $25 ^ -2139062144;
       $27 = $26 & $24;
       $28 = ($27|0)==(0);
       if (!($28)) {
        break;
       }
       $29 = ((($$046)) + 4|0);
       $30 = (($$13745) + -4)|0;
       $31 = ($30>>>0)>(3);
       if ($31) {
        $$046 = $29;$$13745 = $30;
       } else {
        $$0$lcssa = $29;$$137$lcssa = $30;
        label = 11;
        break L11;
       }
      }
      $$140 = $$046;$$23839 = $$13745;
     } else {
      $$0$lcssa = $$035$lcssa65;$$137$lcssa = $$036$lcssa64;
      label = 11;
     }
    } while(0);
    if ((label|0) == 11) {
     $32 = ($$137$lcssa|0)==(0);
     if ($32) {
      $$2 = $$0$lcssa;$$3 = 0;
      break;
     } else {
      $$140 = $$0$lcssa;$$23839 = $$137$lcssa;
     }
    }
    while(1) {
     $33 = HEAP8[$$140>>0]|0;
     $34 = ($33<<24>>24)==($18<<24>>24);
     if ($34) {
      $$2 = $$140;$$3 = $$23839;
      break L8;
     }
     $35 = ((($$140)) + 1|0);
     $36 = (($$23839) + -1)|0;
     $37 = ($36|0)==(0);
     if ($37) {
      $$2 = $35;$$3 = 0;
      break;
     } else {
      $$140 = $35;$$23839 = $36;
     }
    }
   }
  }
 } while(0);
 $38 = ($$3|0)!=(0);
 $39 = $38 ? $$2 : 0;
 return ($39|0);
}
function _pad_682($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $$0$lcssa = 0, $$011 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 256|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(256|0);
 $5 = sp;
 $6 = $4 & 73728;
 $7 = ($6|0)==(0);
 $8 = ($2|0)>($3|0);
 $or$cond = $8 & $7;
 if ($or$cond) {
  $9 = (($2) - ($3))|0;
  $10 = ($9>>>0)<(256);
  $11 = $10 ? $9 : 256;
  _memset(($5|0),($1|0),($11|0))|0;
  $12 = ($9>>>0)>(255);
  if ($12) {
   $13 = (($2) - ($3))|0;
   $$011 = $9;
   while(1) {
    _out($0,$5,256);
    $14 = (($$011) + -256)|0;
    $15 = ($14>>>0)>(255);
    if ($15) {
     $$011 = $14;
    } else {
     break;
    }
   }
   $16 = $13 & 255;
   $$0$lcssa = $16;
  } else {
   $$0$lcssa = $9;
  }
  _out($0,$5,$$0$lcssa);
 }
 STACKTOP = sp;return;
}
function _wctomb($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0|0);
 if ($2) {
  $$0 = 0;
 } else {
  $3 = (_wcrtomb($0,$1,0)|0);
  $$0 = $3;
 }
 return ($$0|0);
}
function _fmt_fp($0,$1,$2,$3,$4,$5) {
 $0 = $0|0;
 $1 = +$1;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 $5 = $5|0;
 var $$ = 0, $$$ = 0, $$$$559 = 0.0, $$$3484 = 0, $$$3484691 = 0, $$$3484692 = 0, $$$3501 = 0, $$$4502 = 0, $$$542 = 0.0, $$$559 = 0.0, $$0 = 0, $$0463$lcssa = 0, $$0463584 = 0, $$0464594 = 0, $$0471 = 0.0, $$0479 = 0, $$0487642 = 0, $$0488 = 0, $$0488653 = 0, $$0488655 = 0;
 var $$0496$$9 = 0, $$0497654 = 0, $$0498 = 0, $$0509582 = 0.0, $$0510 = 0, $$0511 = 0, $$0514637 = 0, $$0520 = 0, $$0521 = 0, $$0521$ = 0, $$0523 = 0, $$0525 = 0, $$0527 = 0, $$0527629 = 0, $$0527631 = 0, $$0530636 = 0, $$1465 = 0, $$1467 = 0.0, $$1469 = 0.0, $$1472 = 0.0;
 var $$1480 = 0, $$1482$lcssa = 0, $$1482661 = 0, $$1489641 = 0, $$1499$lcssa = 0, $$1499660 = 0, $$1508583 = 0, $$1512$lcssa = 0, $$1512607 = 0, $$1515 = 0, $$1524 = 0, $$1526 = 0, $$1528614 = 0, $$1531$lcssa = 0, $$1531630 = 0, $$1598 = 0, $$2 = 0, $$2473 = 0.0, $$2476 = 0, $$2476$$547 = 0;
 var $$2476$$549 = 0, $$2483$ph = 0, $$2500 = 0, $$2513 = 0, $$2516618 = 0, $$2529 = 0, $$2532617 = 0, $$3 = 0.0, $$3477 = 0, $$3484$lcssa = 0, $$3484648 = 0, $$3501$lcssa = 0, $$3501647 = 0, $$3533613 = 0, $$4 = 0.0, $$4478$lcssa = 0, $$4478590 = 0, $$4492 = 0, $$4502 = 0, $$4518 = 0;
 var $$5$lcssa = 0, $$534$ = 0, $$539 = 0, $$539$ = 0, $$542 = 0.0, $$546 = 0, $$548 = 0, $$5486$lcssa = 0, $$5486623 = 0, $$5493597 = 0, $$5519$ph = 0, $$555 = 0, $$556 = 0, $$559 = 0.0, $$5602 = 0, $$6 = 0, $$6494589 = 0, $$7495601 = 0, $$7505 = 0, $$7505$ = 0;
 var $$7505$ph = 0, $$8 = 0, $$9$ph = 0, $$lcssa673 = 0, $$neg = 0, $$neg567 = 0, $$pn = 0, $$pn566 = 0, $$pr = 0, $$pr564 = 0, $$pre = 0, $$pre$phi690Z2D = 0, $$pre689 = 0, $$sink545$lcssa = 0, $$sink545622 = 0, $$sink562 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0;
 var $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0.0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0.0, $117 = 0.0, $118 = 0.0, $119 = 0, $12 = 0, $120 = 0;
 var $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0;
 var $14 = 0.0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0;
 var $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0;
 var $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0;
 var $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0;
 var $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0.0, $229 = 0.0, $23 = 0;
 var $230 = 0, $231 = 0.0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0;
 var $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0;
 var $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0, $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0;
 var $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0, $297 = 0, $298 = 0, $299 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0;
 var $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0, $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0;
 var $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0, $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0;
 var $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0, $35 = 0.0, $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0;
 var $358 = 0, $359 = 0, $36 = 0.0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0, $366 = 0, $367 = 0, $368 = 0, $369 = 0, $37 = 0, $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0;
 var $376 = 0, $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0, $381 = 0, $382 = 0, $383 = 0, $384 = 0, $385 = 0, $386 = 0, $387 = 0, $388 = 0, $39 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0;
 var $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $50 = 0, $51 = 0.0, $52 = 0, $53 = 0, $54 = 0, $55 = 0.0, $56 = 0.0, $57 = 0.0, $58 = 0.0, $59 = 0.0, $6 = 0, $60 = 0.0, $61 = 0, $62 = 0, $63 = 0;
 var $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0;
 var $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0.0, $88 = 0.0, $89 = 0.0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $exitcond = 0;
 var $narrow = 0, $not$ = 0, $notlhs = 0, $notrhs = 0, $or$cond = 0, $or$cond3$not = 0, $or$cond537 = 0, $or$cond541 = 0, $or$cond544 = 0, $or$cond554 = 0, $or$cond6 = 0, $scevgep684 = 0, $scevgep684685 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 560|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(560|0);
 $6 = sp + 8|0;
 $7 = sp;
 $8 = sp + 524|0;
 $9 = $8;
 $10 = sp + 512|0;
 HEAP32[$7>>2] = 0;
 $11 = ((($10)) + 12|0);
 (___DOUBLE_BITS_683($1)|0);
 $12 = tempRet0;
 $13 = ($12|0)<(0);
 if ($13) {
  $14 = -$1;
  $$0471 = $14;$$0520 = 1;$$0521 = 3353;
 } else {
  $15 = $4 & 2048;
  $16 = ($15|0)==(0);
  $17 = $4 & 1;
  $18 = ($17|0)==(0);
  $$ = $18 ? (3354) : (3359);
  $$$ = $16 ? $$ : (3356);
  $19 = $4 & 2049;
  $narrow = ($19|0)!=(0);
  $$534$ = $narrow&1;
  $$0471 = $1;$$0520 = $$534$;$$0521 = $$$;
 }
 (___DOUBLE_BITS_683($$0471)|0);
 $20 = tempRet0;
 $21 = $20 & 2146435072;
 $22 = ($21>>>0)<(2146435072);
 $23 = (0)<(0);
 $24 = ($21|0)==(2146435072);
 $25 = $24 & $23;
 $26 = $22 | $25;
 do {
  if ($26) {
   $35 = (+_frexpl($$0471,$7));
   $36 = $35 * 2.0;
   $37 = $36 != 0.0;
   if ($37) {
    $38 = HEAP32[$7>>2]|0;
    $39 = (($38) + -1)|0;
    HEAP32[$7>>2] = $39;
   }
   $40 = $5 | 32;
   $41 = ($40|0)==(97);
   if ($41) {
    $42 = $5 & 32;
    $43 = ($42|0)==(0);
    $44 = ((($$0521)) + 9|0);
    $$0521$ = $43 ? $$0521 : $44;
    $45 = $$0520 | 2;
    $46 = ($3>>>0)>(11);
    $47 = (12 - ($3))|0;
    $48 = ($47|0)==(0);
    $49 = $46 | $48;
    do {
     if ($49) {
      $$1472 = $36;
     } else {
      $$0509582 = 8.0;$$1508583 = $47;
      while(1) {
       $50 = (($$1508583) + -1)|0;
       $51 = $$0509582 * 16.0;
       $52 = ($50|0)==(0);
       if ($52) {
        break;
       } else {
        $$0509582 = $51;$$1508583 = $50;
       }
      }
      $53 = HEAP8[$$0521$>>0]|0;
      $54 = ($53<<24>>24)==(45);
      if ($54) {
       $55 = -$36;
       $56 = $55 - $51;
       $57 = $51 + $56;
       $58 = -$57;
       $$1472 = $58;
       break;
      } else {
       $59 = $36 + $51;
       $60 = $59 - $51;
       $$1472 = $60;
       break;
      }
     }
    } while(0);
    $61 = HEAP32[$7>>2]|0;
    $62 = ($61|0)<(0);
    $63 = (0 - ($61))|0;
    $64 = $62 ? $63 : $61;
    $65 = ($64|0)<(0);
    $66 = $65 << 31 >> 31;
    $67 = (_fmt_u($64,$66,$11)|0);
    $68 = ($67|0)==($11|0);
    if ($68) {
     $69 = ((($10)) + 11|0);
     HEAP8[$69>>0] = 48;
     $$0511 = $69;
    } else {
     $$0511 = $67;
    }
    $70 = $61 >> 31;
    $71 = $70 & 2;
    $72 = (($71) + 43)|0;
    $73 = $72&255;
    $74 = ((($$0511)) + -1|0);
    HEAP8[$74>>0] = $73;
    $75 = (($5) + 15)|0;
    $76 = $75&255;
    $77 = ((($$0511)) + -2|0);
    HEAP8[$77>>0] = $76;
    $notrhs = ($3|0)<(1);
    $78 = $4 & 8;
    $79 = ($78|0)==(0);
    $$0523 = $8;$$2473 = $$1472;
    while(1) {
     $80 = (~~(($$2473)));
     $81 = (3388 + ($80)|0);
     $82 = HEAP8[$81>>0]|0;
     $83 = $82&255;
     $84 = $83 | $42;
     $85 = $84&255;
     $86 = ((($$0523)) + 1|0);
     HEAP8[$$0523>>0] = $85;
     $87 = (+($80|0));
     $88 = $$2473 - $87;
     $89 = $88 * 16.0;
     $90 = $86;
     $91 = (($90) - ($9))|0;
     $92 = ($91|0)==(1);
     if ($92) {
      $notlhs = $89 == 0.0;
      $or$cond3$not = $notrhs & $notlhs;
      $or$cond = $79 & $or$cond3$not;
      if ($or$cond) {
       $$1524 = $86;
      } else {
       $93 = ((($$0523)) + 2|0);
       HEAP8[$86>>0] = 46;
       $$1524 = $93;
      }
     } else {
      $$1524 = $86;
     }
     $94 = $89 != 0.0;
     if ($94) {
      $$0523 = $$1524;$$2473 = $89;
     } else {
      break;
     }
    }
    $95 = ($3|0)!=(0);
    $96 = $77;
    $97 = $11;
    $98 = $$1524;
    $99 = (($98) - ($9))|0;
    $100 = (($97) - ($96))|0;
    $101 = (($99) + -2)|0;
    $102 = ($101|0)<($3|0);
    $or$cond537 = $95 & $102;
    $103 = (($3) + 2)|0;
    $$pn = $or$cond537 ? $103 : $99;
    $$0525 = (($100) + ($45))|0;
    $104 = (($$0525) + ($$pn))|0;
    _pad_682($0,32,$2,$104,$4);
    _out($0,$$0521$,$45);
    $105 = $4 ^ 65536;
    _pad_682($0,48,$2,$104,$105);
    _out($0,$8,$99);
    $106 = (($$pn) - ($99))|0;
    _pad_682($0,48,$106,0,0);
    _out($0,$77,$100);
    $107 = $4 ^ 8192;
    _pad_682($0,32,$2,$104,$107);
    $$sink562 = $104;
    break;
   }
   $108 = ($3|0)<(0);
   $$539 = $108 ? 6 : $3;
   if ($37) {
    $109 = $36 * 268435456.0;
    $110 = HEAP32[$7>>2]|0;
    $111 = (($110) + -28)|0;
    HEAP32[$7>>2] = $111;
    $$3 = $109;$$pr = $111;
   } else {
    $$pre = HEAP32[$7>>2]|0;
    $$3 = $36;$$pr = $$pre;
   }
   $112 = ($$pr|0)<(0);
   $113 = ((($6)) + 288|0);
   $$556 = $112 ? $6 : $113;
   $$0498 = $$556;$$4 = $$3;
   while(1) {
    $114 = (~~(($$4))>>>0);
    HEAP32[$$0498>>2] = $114;
    $115 = ((($$0498)) + 4|0);
    $116 = (+($114>>>0));
    $117 = $$4 - $116;
    $118 = $117 * 1.0E+9;
    $119 = $118 != 0.0;
    if ($119) {
     $$0498 = $115;$$4 = $118;
    } else {
     break;
    }
   }
   $120 = ($$pr|0)>(0);
   if ($120) {
    $$1482661 = $$556;$$1499660 = $115;$122 = $$pr;
    while(1) {
     $121 = ($122|0)<(29);
     $123 = $121 ? $122 : 29;
     $$0488653 = ((($$1499660)) + -4|0);
     $124 = ($$0488653>>>0)<($$1482661>>>0);
     if ($124) {
      $$2483$ph = $$1482661;
     } else {
      $$0488655 = $$0488653;$$0497654 = 0;
      while(1) {
       $125 = HEAP32[$$0488655>>2]|0;
       $126 = (_bitshift64Shl(($125|0),0,($123|0))|0);
       $127 = tempRet0;
       $128 = (_i64Add(($126|0),($127|0),($$0497654|0),0)|0);
       $129 = tempRet0;
       $130 = (___uremdi3(($128|0),($129|0),1000000000,0)|0);
       $131 = tempRet0;
       HEAP32[$$0488655>>2] = $130;
       $132 = (___udivdi3(($128|0),($129|0),1000000000,0)|0);
       $133 = tempRet0;
       $$0488 = ((($$0488655)) + -4|0);
       $134 = ($$0488>>>0)<($$1482661>>>0);
       if ($134) {
        break;
       } else {
        $$0488655 = $$0488;$$0497654 = $132;
       }
      }
      $135 = ($132|0)==(0);
      if ($135) {
       $$2483$ph = $$1482661;
      } else {
       $136 = ((($$1482661)) + -4|0);
       HEAP32[$136>>2] = $132;
       $$2483$ph = $136;
      }
     }
     $$2500 = $$1499660;
     while(1) {
      $137 = ($$2500>>>0)>($$2483$ph>>>0);
      if (!($137)) {
       break;
      }
      $138 = ((($$2500)) + -4|0);
      $139 = HEAP32[$138>>2]|0;
      $140 = ($139|0)==(0);
      if ($140) {
       $$2500 = $138;
      } else {
       break;
      }
     }
     $141 = HEAP32[$7>>2]|0;
     $142 = (($141) - ($123))|0;
     HEAP32[$7>>2] = $142;
     $143 = ($142|0)>(0);
     if ($143) {
      $$1482661 = $$2483$ph;$$1499660 = $$2500;$122 = $142;
     } else {
      $$1482$lcssa = $$2483$ph;$$1499$lcssa = $$2500;$$pr564 = $142;
      break;
     }
    }
   } else {
    $$1482$lcssa = $$556;$$1499$lcssa = $115;$$pr564 = $$pr;
   }
   $144 = ($$pr564|0)<(0);
   if ($144) {
    $145 = (($$539) + 25)|0;
    $146 = (($145|0) / 9)&-1;
    $147 = (($146) + 1)|0;
    $148 = ($40|0)==(102);
    $$3484648 = $$1482$lcssa;$$3501647 = $$1499$lcssa;$150 = $$pr564;
    while(1) {
     $149 = (0 - ($150))|0;
     $151 = ($149|0)<(9);
     $152 = $151 ? $149 : 9;
     $153 = ($$3484648>>>0)<($$3501647>>>0);
     if ($153) {
      $157 = 1 << $152;
      $158 = (($157) + -1)|0;
      $159 = 1000000000 >>> $152;
      $$0487642 = 0;$$1489641 = $$3484648;
      while(1) {
       $160 = HEAP32[$$1489641>>2]|0;
       $161 = $160 & $158;
       $162 = $160 >>> $152;
       $163 = (($162) + ($$0487642))|0;
       HEAP32[$$1489641>>2] = $163;
       $164 = Math_imul($161, $159)|0;
       $165 = ((($$1489641)) + 4|0);
       $166 = ($165>>>0)<($$3501647>>>0);
       if ($166) {
        $$0487642 = $164;$$1489641 = $165;
       } else {
        break;
       }
      }
      $167 = HEAP32[$$3484648>>2]|0;
      $168 = ($167|0)==(0);
      $169 = ((($$3484648)) + 4|0);
      $$$3484 = $168 ? $169 : $$3484648;
      $170 = ($164|0)==(0);
      if ($170) {
       $$$3484692 = $$$3484;$$4502 = $$3501647;
      } else {
       $171 = ((($$3501647)) + 4|0);
       HEAP32[$$3501647>>2] = $164;
       $$$3484692 = $$$3484;$$4502 = $171;
      }
     } else {
      $154 = HEAP32[$$3484648>>2]|0;
      $155 = ($154|0)==(0);
      $156 = ((($$3484648)) + 4|0);
      $$$3484691 = $155 ? $156 : $$3484648;
      $$$3484692 = $$$3484691;$$4502 = $$3501647;
     }
     $172 = $148 ? $$556 : $$$3484692;
     $173 = $$4502;
     $174 = $172;
     $175 = (($173) - ($174))|0;
     $176 = $175 >> 2;
     $177 = ($176|0)>($147|0);
     $178 = (($172) + ($147<<2)|0);
     $$$4502 = $177 ? $178 : $$4502;
     $179 = HEAP32[$7>>2]|0;
     $180 = (($179) + ($152))|0;
     HEAP32[$7>>2] = $180;
     $181 = ($180|0)<(0);
     if ($181) {
      $$3484648 = $$$3484692;$$3501647 = $$$4502;$150 = $180;
     } else {
      $$3484$lcssa = $$$3484692;$$3501$lcssa = $$$4502;
      break;
     }
    }
   } else {
    $$3484$lcssa = $$1482$lcssa;$$3501$lcssa = $$1499$lcssa;
   }
   $182 = ($$3484$lcssa>>>0)<($$3501$lcssa>>>0);
   $183 = $$556;
   if ($182) {
    $184 = $$3484$lcssa;
    $185 = (($183) - ($184))|0;
    $186 = $185 >> 2;
    $187 = ($186*9)|0;
    $188 = HEAP32[$$3484$lcssa>>2]|0;
    $189 = ($188>>>0)<(10);
    if ($189) {
     $$1515 = $187;
    } else {
     $$0514637 = $187;$$0530636 = 10;
     while(1) {
      $190 = ($$0530636*10)|0;
      $191 = (($$0514637) + 1)|0;
      $192 = ($188>>>0)<($190>>>0);
      if ($192) {
       $$1515 = $191;
       break;
      } else {
       $$0514637 = $191;$$0530636 = $190;
      }
     }
    }
   } else {
    $$1515 = 0;
   }
   $193 = ($40|0)!=(102);
   $194 = $193 ? $$1515 : 0;
   $195 = (($$539) - ($194))|0;
   $196 = ($40|0)==(103);
   $197 = ($$539|0)!=(0);
   $198 = $197 & $196;
   $$neg = $198 << 31 >> 31;
   $199 = (($195) + ($$neg))|0;
   $200 = $$3501$lcssa;
   $201 = (($200) - ($183))|0;
   $202 = $201 >> 2;
   $203 = ($202*9)|0;
   $204 = (($203) + -9)|0;
   $205 = ($199|0)<($204|0);
   if ($205) {
    $206 = ((($$556)) + 4|0);
    $207 = (($199) + 9216)|0;
    $208 = (($207|0) / 9)&-1;
    $209 = (($208) + -1024)|0;
    $210 = (($206) + ($209<<2)|0);
    $211 = (($207|0) % 9)&-1;
    $$0527629 = (($211) + 1)|0;
    $212 = ($$0527629|0)<(9);
    if ($212) {
     $$0527631 = $$0527629;$$1531630 = 10;
     while(1) {
      $213 = ($$1531630*10)|0;
      $$0527 = (($$0527631) + 1)|0;
      $exitcond = ($$0527|0)==(9);
      if ($exitcond) {
       $$1531$lcssa = $213;
       break;
      } else {
       $$0527631 = $$0527;$$1531630 = $213;
      }
     }
    } else {
     $$1531$lcssa = 10;
    }
    $214 = HEAP32[$210>>2]|0;
    $215 = (($214>>>0) % ($$1531$lcssa>>>0))&-1;
    $216 = ($215|0)==(0);
    $217 = ((($210)) + 4|0);
    $218 = ($217|0)==($$3501$lcssa|0);
    $or$cond541 = $218 & $216;
    if ($or$cond541) {
     $$4492 = $210;$$4518 = $$1515;$$8 = $$3484$lcssa;
    } else {
     $219 = (($214>>>0) / ($$1531$lcssa>>>0))&-1;
     $220 = $219 & 1;
     $221 = ($220|0)==(0);
     $$542 = $221 ? 9007199254740992.0 : 9007199254740994.0;
     $222 = (($$1531$lcssa|0) / 2)&-1;
     $223 = ($215>>>0)<($222>>>0);
     $224 = ($215|0)==($222|0);
     $or$cond544 = $218 & $224;
     $$559 = $or$cond544 ? 1.0 : 1.5;
     $$$559 = $223 ? 0.5 : $$559;
     $225 = ($$0520|0)==(0);
     if ($225) {
      $$1467 = $$$559;$$1469 = $$542;
     } else {
      $226 = HEAP8[$$0521>>0]|0;
      $227 = ($226<<24>>24)==(45);
      $228 = -$$542;
      $229 = -$$$559;
      $$$542 = $227 ? $228 : $$542;
      $$$$559 = $227 ? $229 : $$$559;
      $$1467 = $$$$559;$$1469 = $$$542;
     }
     $230 = (($214) - ($215))|0;
     HEAP32[$210>>2] = $230;
     $231 = $$1469 + $$1467;
     $232 = $231 != $$1469;
     if ($232) {
      $233 = (($230) + ($$1531$lcssa))|0;
      HEAP32[$210>>2] = $233;
      $234 = ($233>>>0)>(999999999);
      if ($234) {
       $$5486623 = $$3484$lcssa;$$sink545622 = $210;
       while(1) {
        $235 = ((($$sink545622)) + -4|0);
        HEAP32[$$sink545622>>2] = 0;
        $236 = ($235>>>0)<($$5486623>>>0);
        if ($236) {
         $237 = ((($$5486623)) + -4|0);
         HEAP32[$237>>2] = 0;
         $$6 = $237;
        } else {
         $$6 = $$5486623;
        }
        $238 = HEAP32[$235>>2]|0;
        $239 = (($238) + 1)|0;
        HEAP32[$235>>2] = $239;
        $240 = ($239>>>0)>(999999999);
        if ($240) {
         $$5486623 = $$6;$$sink545622 = $235;
        } else {
         $$5486$lcssa = $$6;$$sink545$lcssa = $235;
         break;
        }
       }
      } else {
       $$5486$lcssa = $$3484$lcssa;$$sink545$lcssa = $210;
      }
      $241 = $$5486$lcssa;
      $242 = (($183) - ($241))|0;
      $243 = $242 >> 2;
      $244 = ($243*9)|0;
      $245 = HEAP32[$$5486$lcssa>>2]|0;
      $246 = ($245>>>0)<(10);
      if ($246) {
       $$4492 = $$sink545$lcssa;$$4518 = $244;$$8 = $$5486$lcssa;
      } else {
       $$2516618 = $244;$$2532617 = 10;
       while(1) {
        $247 = ($$2532617*10)|0;
        $248 = (($$2516618) + 1)|0;
        $249 = ($245>>>0)<($247>>>0);
        if ($249) {
         $$4492 = $$sink545$lcssa;$$4518 = $248;$$8 = $$5486$lcssa;
         break;
        } else {
         $$2516618 = $248;$$2532617 = $247;
        }
       }
      }
     } else {
      $$4492 = $210;$$4518 = $$1515;$$8 = $$3484$lcssa;
     }
    }
    $250 = ((($$4492)) + 4|0);
    $251 = ($$3501$lcssa>>>0)>($250>>>0);
    $$$3501 = $251 ? $250 : $$3501$lcssa;
    $$5519$ph = $$4518;$$7505$ph = $$$3501;$$9$ph = $$8;
   } else {
    $$5519$ph = $$1515;$$7505$ph = $$3501$lcssa;$$9$ph = $$3484$lcssa;
   }
   $$7505 = $$7505$ph;
   while(1) {
    $252 = ($$7505>>>0)>($$9$ph>>>0);
    if (!($252)) {
     $$lcssa673 = 0;
     break;
    }
    $253 = ((($$7505)) + -4|0);
    $254 = HEAP32[$253>>2]|0;
    $255 = ($254|0)==(0);
    if ($255) {
     $$7505 = $253;
    } else {
     $$lcssa673 = 1;
     break;
    }
   }
   $256 = (0 - ($$5519$ph))|0;
   do {
    if ($196) {
     $not$ = $197 ^ 1;
     $257 = $not$&1;
     $$539$ = (($257) + ($$539))|0;
     $258 = ($$539$|0)>($$5519$ph|0);
     $259 = ($$5519$ph|0)>(-5);
     $or$cond6 = $258 & $259;
     if ($or$cond6) {
      $260 = (($5) + -1)|0;
      $$neg567 = (($$539$) + -1)|0;
      $261 = (($$neg567) - ($$5519$ph))|0;
      $$0479 = $260;$$2476 = $261;
     } else {
      $262 = (($5) + -2)|0;
      $263 = (($$539$) + -1)|0;
      $$0479 = $262;$$2476 = $263;
     }
     $264 = $4 & 8;
     $265 = ($264|0)==(0);
     if ($265) {
      if ($$lcssa673) {
       $266 = ((($$7505)) + -4|0);
       $267 = HEAP32[$266>>2]|0;
       $268 = ($267|0)==(0);
       if ($268) {
        $$2529 = 9;
       } else {
        $269 = (($267>>>0) % 10)&-1;
        $270 = ($269|0)==(0);
        if ($270) {
         $$1528614 = 0;$$3533613 = 10;
         while(1) {
          $271 = ($$3533613*10)|0;
          $272 = (($$1528614) + 1)|0;
          $273 = (($267>>>0) % ($271>>>0))&-1;
          $274 = ($273|0)==(0);
          if ($274) {
           $$1528614 = $272;$$3533613 = $271;
          } else {
           $$2529 = $272;
           break;
          }
         }
        } else {
         $$2529 = 0;
        }
       }
      } else {
       $$2529 = 9;
      }
      $275 = $$0479 | 32;
      $276 = ($275|0)==(102);
      $277 = $$7505;
      $278 = (($277) - ($183))|0;
      $279 = $278 >> 2;
      $280 = ($279*9)|0;
      $281 = (($280) + -9)|0;
      if ($276) {
       $282 = (($281) - ($$2529))|0;
       $283 = ($282|0)>(0);
       $$546 = $283 ? $282 : 0;
       $284 = ($$2476|0)<($$546|0);
       $$2476$$547 = $284 ? $$2476 : $$546;
       $$1480 = $$0479;$$3477 = $$2476$$547;$$pre$phi690Z2D = 0;
       break;
      } else {
       $285 = (($281) + ($$5519$ph))|0;
       $286 = (($285) - ($$2529))|0;
       $287 = ($286|0)>(0);
       $$548 = $287 ? $286 : 0;
       $288 = ($$2476|0)<($$548|0);
       $$2476$$549 = $288 ? $$2476 : $$548;
       $$1480 = $$0479;$$3477 = $$2476$$549;$$pre$phi690Z2D = 0;
       break;
      }
     } else {
      $$1480 = $$0479;$$3477 = $$2476;$$pre$phi690Z2D = $264;
     }
    } else {
     $$pre689 = $4 & 8;
     $$1480 = $5;$$3477 = $$539;$$pre$phi690Z2D = $$pre689;
    }
   } while(0);
   $289 = $$3477 | $$pre$phi690Z2D;
   $290 = ($289|0)!=(0);
   $291 = $290&1;
   $292 = $$1480 | 32;
   $293 = ($292|0)==(102);
   if ($293) {
    $294 = ($$5519$ph|0)>(0);
    $295 = $294 ? $$5519$ph : 0;
    $$2513 = 0;$$pn566 = $295;
   } else {
    $296 = ($$5519$ph|0)<(0);
    $297 = $296 ? $256 : $$5519$ph;
    $298 = ($297|0)<(0);
    $299 = $298 << 31 >> 31;
    $300 = (_fmt_u($297,$299,$11)|0);
    $301 = $11;
    $302 = $300;
    $303 = (($301) - ($302))|0;
    $304 = ($303|0)<(2);
    if ($304) {
     $$1512607 = $300;
     while(1) {
      $305 = ((($$1512607)) + -1|0);
      HEAP8[$305>>0] = 48;
      $306 = $305;
      $307 = (($301) - ($306))|0;
      $308 = ($307|0)<(2);
      if ($308) {
       $$1512607 = $305;
      } else {
       $$1512$lcssa = $305;
       break;
      }
     }
    } else {
     $$1512$lcssa = $300;
    }
    $309 = $$5519$ph >> 31;
    $310 = $309 & 2;
    $311 = (($310) + 43)|0;
    $312 = $311&255;
    $313 = ((($$1512$lcssa)) + -1|0);
    HEAP8[$313>>0] = $312;
    $314 = $$1480&255;
    $315 = ((($$1512$lcssa)) + -2|0);
    HEAP8[$315>>0] = $314;
    $316 = $315;
    $317 = (($301) - ($316))|0;
    $$2513 = $315;$$pn566 = $317;
   }
   $318 = (($$0520) + 1)|0;
   $319 = (($318) + ($$3477))|0;
   $$1526 = (($319) + ($291))|0;
   $320 = (($$1526) + ($$pn566))|0;
   _pad_682($0,32,$2,$320,$4);
   _out($0,$$0521,$$0520);
   $321 = $4 ^ 65536;
   _pad_682($0,48,$2,$320,$321);
   if ($293) {
    $322 = ($$9$ph>>>0)>($$556>>>0);
    $$0496$$9 = $322 ? $$556 : $$9$ph;
    $323 = ((($8)) + 9|0);
    $324 = $323;
    $325 = ((($8)) + 8|0);
    $$5493597 = $$0496$$9;
    while(1) {
     $326 = HEAP32[$$5493597>>2]|0;
     $327 = (_fmt_u($326,0,$323)|0);
     $328 = ($$5493597|0)==($$0496$$9|0);
     if ($328) {
      $334 = ($327|0)==($323|0);
      if ($334) {
       HEAP8[$325>>0] = 48;
       $$1465 = $325;
      } else {
       $$1465 = $327;
      }
     } else {
      $329 = ($327>>>0)>($8>>>0);
      if ($329) {
       $330 = $327;
       $331 = (($330) - ($9))|0;
       _memset(($8|0),48,($331|0))|0;
       $$0464594 = $327;
       while(1) {
        $332 = ((($$0464594)) + -1|0);
        $333 = ($332>>>0)>($8>>>0);
        if ($333) {
         $$0464594 = $332;
        } else {
         $$1465 = $332;
         break;
        }
       }
      } else {
       $$1465 = $327;
      }
     }
     $335 = $$1465;
     $336 = (($324) - ($335))|0;
     _out($0,$$1465,$336);
     $337 = ((($$5493597)) + 4|0);
     $338 = ($337>>>0)>($$556>>>0);
     if ($338) {
      break;
     } else {
      $$5493597 = $337;
     }
    }
    $339 = ($289|0)==(0);
    if (!($339)) {
     _out($0,3404,1);
    }
    $340 = ($337>>>0)<($$7505>>>0);
    $341 = ($$3477|0)>(0);
    $342 = $340 & $341;
    if ($342) {
     $$4478590 = $$3477;$$6494589 = $337;
     while(1) {
      $343 = HEAP32[$$6494589>>2]|0;
      $344 = (_fmt_u($343,0,$323)|0);
      $345 = ($344>>>0)>($8>>>0);
      if ($345) {
       $346 = $344;
       $347 = (($346) - ($9))|0;
       _memset(($8|0),48,($347|0))|0;
       $$0463584 = $344;
       while(1) {
        $348 = ((($$0463584)) + -1|0);
        $349 = ($348>>>0)>($8>>>0);
        if ($349) {
         $$0463584 = $348;
        } else {
         $$0463$lcssa = $348;
         break;
        }
       }
      } else {
       $$0463$lcssa = $344;
      }
      $350 = ($$4478590|0)<(9);
      $351 = $350 ? $$4478590 : 9;
      _out($0,$$0463$lcssa,$351);
      $352 = ((($$6494589)) + 4|0);
      $353 = (($$4478590) + -9)|0;
      $354 = ($352>>>0)<($$7505>>>0);
      $355 = ($$4478590|0)>(9);
      $356 = $354 & $355;
      if ($356) {
       $$4478590 = $353;$$6494589 = $352;
      } else {
       $$4478$lcssa = $353;
       break;
      }
     }
    } else {
     $$4478$lcssa = $$3477;
    }
    $357 = (($$4478$lcssa) + 9)|0;
    _pad_682($0,48,$357,9,0);
   } else {
    $358 = ((($$9$ph)) + 4|0);
    $$7505$ = $$lcssa673 ? $$7505 : $358;
    $359 = ($$3477|0)>(-1);
    if ($359) {
     $360 = ((($8)) + 9|0);
     $361 = ($$pre$phi690Z2D|0)==(0);
     $362 = $360;
     $363 = (0 - ($9))|0;
     $364 = ((($8)) + 8|0);
     $$5602 = $$3477;$$7495601 = $$9$ph;
     while(1) {
      $365 = HEAP32[$$7495601>>2]|0;
      $366 = (_fmt_u($365,0,$360)|0);
      $367 = ($366|0)==($360|0);
      if ($367) {
       HEAP8[$364>>0] = 48;
       $$0 = $364;
      } else {
       $$0 = $366;
      }
      $368 = ($$7495601|0)==($$9$ph|0);
      do {
       if ($368) {
        $372 = ((($$0)) + 1|0);
        _out($0,$$0,1);
        $373 = ($$5602|0)<(1);
        $or$cond554 = $361 & $373;
        if ($or$cond554) {
         $$2 = $372;
         break;
        }
        _out($0,3404,1);
        $$2 = $372;
       } else {
        $369 = ($$0>>>0)>($8>>>0);
        if (!($369)) {
         $$2 = $$0;
         break;
        }
        $scevgep684 = (($$0) + ($363)|0);
        $scevgep684685 = $scevgep684;
        _memset(($8|0),48,($scevgep684685|0))|0;
        $$1598 = $$0;
        while(1) {
         $370 = ((($$1598)) + -1|0);
         $371 = ($370>>>0)>($8>>>0);
         if ($371) {
          $$1598 = $370;
         } else {
          $$2 = $370;
          break;
         }
        }
       }
      } while(0);
      $374 = $$2;
      $375 = (($362) - ($374))|0;
      $376 = ($$5602|0)>($375|0);
      $377 = $376 ? $375 : $$5602;
      _out($0,$$2,$377);
      $378 = (($$5602) - ($375))|0;
      $379 = ((($$7495601)) + 4|0);
      $380 = ($379>>>0)<($$7505$>>>0);
      $381 = ($378|0)>(-1);
      $382 = $380 & $381;
      if ($382) {
       $$5602 = $378;$$7495601 = $379;
      } else {
       $$5$lcssa = $378;
       break;
      }
     }
    } else {
     $$5$lcssa = $$3477;
    }
    $383 = (($$5$lcssa) + 18)|0;
    _pad_682($0,48,$383,18,0);
    $384 = $11;
    $385 = $$2513;
    $386 = (($384) - ($385))|0;
    _out($0,$$2513,$386);
   }
   $387 = $4 ^ 8192;
   _pad_682($0,32,$2,$320,$387);
   $$sink562 = $320;
  } else {
   $27 = $5 & 32;
   $28 = ($27|0)!=(0);
   $29 = $28 ? 3372 : 3376;
   $30 = ($$0471 != $$0471) | (0.0 != 0.0);
   $31 = $28 ? 3380 : 3384;
   $$0510 = $30 ? $31 : $29;
   $32 = (($$0520) + 3)|0;
   $33 = $4 & -65537;
   _pad_682($0,32,$2,$32,$33);
   _out($0,$$0521,$$0520);
   _out($0,$$0510,3);
   $34 = $4 ^ 8192;
   _pad_682($0,32,$2,$32,$34);
   $$sink562 = $32;
  }
 } while(0);
 $388 = ($$sink562|0)<($2|0);
 $$555 = $388 ? $2 : $$sink562;
 STACKTOP = sp;return ($$555|0);
}
function ___DOUBLE_BITS_683($0) {
 $0 = +$0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAPF64[tempDoublePtr>>3] = $0;$1 = HEAP32[tempDoublePtr>>2]|0;
 $2 = HEAP32[tempDoublePtr+4>>2]|0;
 tempRet0 = ($2);
 return ($1|0);
}
function _frexpl($0,$1) {
 $0 = +$0;
 $1 = $1|0;
 var $2 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = (+_frexp($0,$1));
 return (+$2);
}
function _frexp($0,$1) {
 $0 = +$0;
 $1 = $1|0;
 var $$0 = 0.0, $$016 = 0.0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0.0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0.0, $9 = 0.0, $storemerge = 0, $trunc$clear = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 HEAPF64[tempDoublePtr>>3] = $0;$2 = HEAP32[tempDoublePtr>>2]|0;
 $3 = HEAP32[tempDoublePtr+4>>2]|0;
 $4 = (_bitshift64Lshr(($2|0),($3|0),52)|0);
 $5 = tempRet0;
 $6 = $4&65535;
 $trunc$clear = $6 & 2047;
 switch ($trunc$clear<<16>>16) {
 case 0:  {
  $7 = $0 != 0.0;
  if ($7) {
   $8 = $0 * 1.8446744073709552E+19;
   $9 = (+_frexp($8,$1));
   $10 = HEAP32[$1>>2]|0;
   $11 = (($10) + -64)|0;
   $$016 = $9;$storemerge = $11;
  } else {
   $$016 = $0;$storemerge = 0;
  }
  HEAP32[$1>>2] = $storemerge;
  $$0 = $$016;
  break;
 }
 case 2047:  {
  $$0 = $0;
  break;
 }
 default: {
  $12 = $4 & 2047;
  $13 = (($12) + -1022)|0;
  HEAP32[$1>>2] = $13;
  $14 = $3 & -2146435073;
  $15 = $14 | 1071644672;
  HEAP32[tempDoublePtr>>2] = $2;HEAP32[tempDoublePtr+4>>2] = $15;$16 = +HEAPF64[tempDoublePtr>>3];
  $$0 = $16;
 }
 }
 return (+$$0);
}
function _wcrtomb($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$0 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0;
 var $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $not$ = 0, $or$cond = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = ($0|0)==(0|0);
 do {
  if ($3) {
   $$0 = 1;
  } else {
   $4 = ($1>>>0)<(128);
   if ($4) {
    $5 = $1&255;
    HEAP8[$0>>0] = $5;
    $$0 = 1;
    break;
   }
   $6 = (___pthread_self_429()|0);
   $7 = ((($6)) + 188|0);
   $8 = HEAP32[$7>>2]|0;
   $9 = (Atomics_load(HEAP32,$8>>2)|0);
   $not$ = ($9|0)==(0|0);
   if ($not$) {
    $10 = $1 & -128;
    $11 = ($10|0)==(57216);
    if ($11) {
     $13 = $1&255;
     HEAP8[$0>>0] = $13;
     $$0 = 1;
     break;
    } else {
     $12 = (___errno_location()|0);
     HEAP32[$12>>2] = 84;
     $$0 = -1;
     break;
    }
   }
   $14 = ($1>>>0)<(2048);
   if ($14) {
    $15 = $1 >>> 6;
    $16 = $15 | 192;
    $17 = $16&255;
    $18 = ((($0)) + 1|0);
    HEAP8[$0>>0] = $17;
    $19 = $1 & 63;
    $20 = $19 | 128;
    $21 = $20&255;
    HEAP8[$18>>0] = $21;
    $$0 = 2;
    break;
   }
   $22 = ($1>>>0)<(55296);
   $23 = $1 & -8192;
   $24 = ($23|0)==(57344);
   $or$cond = $22 | $24;
   if ($or$cond) {
    $25 = $1 >>> 12;
    $26 = $25 | 224;
    $27 = $26&255;
    $28 = ((($0)) + 1|0);
    HEAP8[$0>>0] = $27;
    $29 = $1 >>> 6;
    $30 = $29 & 63;
    $31 = $30 | 128;
    $32 = $31&255;
    $33 = ((($0)) + 2|0);
    HEAP8[$28>>0] = $32;
    $34 = $1 & 63;
    $35 = $34 | 128;
    $36 = $35&255;
    HEAP8[$33>>0] = $36;
    $$0 = 3;
    break;
   }
   $37 = (($1) + -65536)|0;
   $38 = ($37>>>0)<(1048576);
   if ($38) {
    $39 = $1 >>> 18;
    $40 = $39 | 240;
    $41 = $40&255;
    $42 = ((($0)) + 1|0);
    HEAP8[$0>>0] = $41;
    $43 = $1 >>> 12;
    $44 = $43 & 63;
    $45 = $44 | 128;
    $46 = $45&255;
    $47 = ((($0)) + 2|0);
    HEAP8[$42>>0] = $46;
    $48 = $1 >>> 6;
    $49 = $48 & 63;
    $50 = $49 | 128;
    $51 = $50&255;
    $52 = ((($0)) + 3|0);
    HEAP8[$47>>0] = $51;
    $53 = $1 & 63;
    $54 = $53 | 128;
    $55 = $54&255;
    HEAP8[$52>>0] = $55;
    $$0 = 4;
    break;
   } else {
    $56 = (___errno_location()|0);
    HEAP32[$56>>2] = 84;
    $$0 = -1;
    break;
   }
  }
 } while(0);
 return ($$0|0);
}
function ___pthread_self_429() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_pthread_self()|0);
 return ($0|0);
}
function ___pthread_self_104() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_pthread_self()|0);
 return ($0|0);
}
function ___strerror_l($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$012$lcssa = 0, $$01214 = 0, $$016 = 0, $$113 = 0, $$115 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 $$016 = 0;
 while(1) {
  $3 = (3406 + ($$016)|0);
  $4 = HEAP8[$3>>0]|0;
  $5 = $4&255;
  $6 = ($5|0)==($0|0);
  if ($6) {
   label = 2;
   break;
  }
  $7 = (($$016) + 1)|0;
  $8 = ($7|0)==(87);
  if ($8) {
   $$01214 = 3494;$$115 = 87;
   label = 5;
   break;
  } else {
   $$016 = $7;
  }
 }
 if ((label|0) == 2) {
  $2 = ($$016|0)==(0);
  if ($2) {
   $$012$lcssa = 3494;
  } else {
   $$01214 = 3494;$$115 = $$016;
   label = 5;
  }
 }
 if ((label|0) == 5) {
  while(1) {
   label = 0;
   $$113 = $$01214;
   while(1) {
    $9 = HEAP8[$$113>>0]|0;
    $10 = ($9<<24>>24)==(0);
    $11 = ((($$113)) + 1|0);
    if ($10) {
     break;
    } else {
     $$113 = $11;
    }
   }
   $12 = (($$115) + -1)|0;
   $13 = ($12|0)==(0);
   if ($13) {
    $$012$lcssa = $11;
    break;
   } else {
    $$01214 = $11;$$115 = $12;
    label = 5;
   }
  }
 }
 $14 = ((($1)) + 20|0);
 $15 = (Atomics_load(HEAP32,$14>>2)|0);
 $16 = (___lctrans($$012$lcssa,$15)|0);
 return ($16|0);
}
function ___lctrans($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = (___lctrans_impl($0,$1)|0);
 return ($2|0);
}
function ___lctrans_impl($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($1|0)==(0|0);
 if ($2) {
  $$0 = 0;
 } else {
  $3 = HEAP32[$1>>2]|0;
  $4 = ((($1)) + 4|0);
  $5 = HEAP32[$4>>2]|0;
  $6 = (___mo_lookup($3,$5,$0)|0);
  $$0 = $6;
 }
 $7 = ($$0|0)!=(0|0);
 $8 = $7 ? $$0 : $0;
 return ($8|0);
}
function ___mo_lookup($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$ = 0, $$090 = 0, $$094 = 0, $$191 = 0, $$195 = 0, $$4 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0;
 var $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0;
 var $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0;
 var $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, $or$cond102 = 0, $or$cond104 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = HEAP32[$0>>2]|0;
 $4 = (($3) + 1794895138)|0;
 $5 = ((($0)) + 8|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = (_swapc($6,$4)|0);
 $8 = ((($0)) + 12|0);
 $9 = HEAP32[$8>>2]|0;
 $10 = (_swapc($9,$4)|0);
 $11 = ((($0)) + 16|0);
 $12 = HEAP32[$11>>2]|0;
 $13 = (_swapc($12,$4)|0);
 $14 = $1 >>> 2;
 $15 = ($7>>>0)<($14>>>0);
 L1: do {
  if ($15) {
   $16 = $7 << 2;
   $17 = (($1) - ($16))|0;
   $18 = ($10>>>0)<($17>>>0);
   $19 = ($13>>>0)<($17>>>0);
   $or$cond = $18 & $19;
   if ($or$cond) {
    $20 = $13 | $10;
    $21 = $20 & 3;
    $22 = ($21|0)==(0);
    if ($22) {
     $23 = $10 >>> 2;
     $24 = $13 >>> 2;
     $$090 = 0;$$094 = $7;
     while(1) {
      $25 = $$094 >>> 1;
      $26 = (($$090) + ($25))|0;
      $27 = $26 << 1;
      $28 = (($27) + ($23))|0;
      $29 = (($0) + ($28<<2)|0);
      $30 = HEAP32[$29>>2]|0;
      $31 = (_swapc($30,$4)|0);
      $32 = (($28) + 1)|0;
      $33 = (($0) + ($32<<2)|0);
      $34 = HEAP32[$33>>2]|0;
      $35 = (_swapc($34,$4)|0);
      $36 = ($35>>>0)<($1>>>0);
      $37 = (($1) - ($35))|0;
      $38 = ($31>>>0)<($37>>>0);
      $or$cond102 = $36 & $38;
      if (!($or$cond102)) {
       $$4 = 0;
       break L1;
      }
      $39 = (($35) + ($31))|0;
      $40 = (($0) + ($39)|0);
      $41 = HEAP8[$40>>0]|0;
      $42 = ($41<<24>>24)==(0);
      if (!($42)) {
       $$4 = 0;
       break L1;
      }
      $43 = (($0) + ($35)|0);
      $44 = (_strcmp($2,$43)|0);
      $45 = ($44|0)==(0);
      if ($45) {
       break;
      }
      $62 = ($$094|0)==(1);
      $63 = ($44|0)<(0);
      $64 = (($$094) - ($25))|0;
      $$195 = $63 ? $25 : $64;
      $$191 = $63 ? $$090 : $26;
      if ($62) {
       $$4 = 0;
       break L1;
      } else {
       $$090 = $$191;$$094 = $$195;
      }
     }
     $46 = (($27) + ($24))|0;
     $47 = (($0) + ($46<<2)|0);
     $48 = HEAP32[$47>>2]|0;
     $49 = (_swapc($48,$4)|0);
     $50 = (($46) + 1)|0;
     $51 = (($0) + ($50<<2)|0);
     $52 = HEAP32[$51>>2]|0;
     $53 = (_swapc($52,$4)|0);
     $54 = ($53>>>0)<($1>>>0);
     $55 = (($1) - ($53))|0;
     $56 = ($49>>>0)<($55>>>0);
     $or$cond104 = $54 & $56;
     if ($or$cond104) {
      $57 = (($0) + ($53)|0);
      $58 = (($53) + ($49))|0;
      $59 = (($0) + ($58)|0);
      $60 = HEAP8[$59>>0]|0;
      $61 = ($60<<24>>24)==(0);
      $$ = $61 ? $57 : 0;
      $$4 = $$;
     } else {
      $$4 = 0;
     }
    } else {
     $$4 = 0;
    }
   } else {
    $$4 = 0;
   }
  } else {
   $$4 = 0;
  }
 } while(0);
 return ($$4|0);
}
function _swapc($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$ = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($1|0)==(0);
 $3 = (_llvm_bswap_i32(($0|0))|0);
 $$ = $2 ? $0 : $3;
 return ($$|0);
}
function ___fwritex($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$038 = 0, $$042 = 0, $$1 = 0, $$139 = 0, $$141 = 0, $$143 = 0, $$pre = 0, $$pre47 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0;
 var $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 $3 = ((($2)) + 16|0);
 $4 = HEAP32[$3>>2]|0;
 $5 = ($4|0)==(0|0);
 if ($5) {
  $7 = (___towrite($2)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   $$pre = HEAP32[$3>>2]|0;
   $12 = $$pre;
   label = 5;
  } else {
   $$1 = 0;
  }
 } else {
  $6 = $4;
  $12 = $6;
  label = 5;
 }
 L5: do {
  if ((label|0) == 5) {
   $9 = ((($2)) + 20|0);
   $10 = HEAP32[$9>>2]|0;
   $11 = (($12) - ($10))|0;
   $13 = ($11>>>0)<($1>>>0);
   $14 = $10;
   if ($13) {
    $15 = ((($2)) + 36|0);
    $16 = HEAP32[$15>>2]|0;
    $17 = (FUNCTION_TABLE_iiii[$16 & 127]($2,$0,$1)|0);
    $$1 = $17;
    break;
   }
   $18 = ((($2)) + 75|0);
   $19 = HEAP8[$18>>0]|0;
   $20 = ($19<<24>>24)>(-1);
   L10: do {
    if ($20) {
     $$038 = $1;
     while(1) {
      $21 = ($$038|0)==(0);
      if ($21) {
       $$139 = 0;$$141 = $0;$$143 = $1;$31 = $14;
       break L10;
      }
      $22 = (($$038) + -1)|0;
      $23 = (($0) + ($22)|0);
      $24 = HEAP8[$23>>0]|0;
      $25 = ($24<<24>>24)==(10);
      if ($25) {
       break;
      } else {
       $$038 = $22;
      }
     }
     $26 = ((($2)) + 36|0);
     $27 = HEAP32[$26>>2]|0;
     $28 = (FUNCTION_TABLE_iiii[$27 & 127]($2,$0,$$038)|0);
     $29 = ($28>>>0)<($$038>>>0);
     if ($29) {
      $$1 = $28;
      break L5;
     }
     $30 = (($0) + ($$038)|0);
     $$042 = (($1) - ($$038))|0;
     $$pre47 = HEAP32[$9>>2]|0;
     $$139 = $$038;$$141 = $30;$$143 = $$042;$31 = $$pre47;
    } else {
     $$139 = 0;$$141 = $0;$$143 = $1;$31 = $14;
    }
   } while(0);
   _memcpy(($31|0),($$141|0),($$143|0))|0;
   $32 = HEAP32[$9>>2]|0;
   $33 = (($32) + ($$143)|0);
   HEAP32[$9>>2] = $33;
   $34 = (($$139) + ($$143))|0;
   $$1 = $34;
  }
 } while(0);
 return ($$1|0);
}
function ___towrite($0) {
 $0 = $0|0;
 var $$0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0;
 var $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + 74|0);
 $2 = HEAP8[$1>>0]|0;
 $3 = $2 << 24 >> 24;
 $4 = (($3) + 255)|0;
 $5 = $4 | $3;
 $6 = $5&255;
 HEAP8[$1>>0] = $6;
 $7 = HEAP32[$0>>2]|0;
 $8 = $7 & 8;
 $9 = ($8|0)==(0);
 if ($9) {
  $11 = ((($0)) + 8|0);
  HEAP32[$11>>2] = 0;
  $12 = ((($0)) + 4|0);
  HEAP32[$12>>2] = 0;
  $13 = ((($0)) + 44|0);
  $14 = HEAP32[$13>>2]|0;
  $15 = ((($0)) + 28|0);
  HEAP32[$15>>2] = $14;
  $16 = ((($0)) + 20|0);
  HEAP32[$16>>2] = $14;
  $17 = ((($0)) + 48|0);
  $18 = HEAP32[$17>>2]|0;
  $19 = (($14) + ($18)|0);
  $20 = ((($0)) + 16|0);
  HEAP32[$20>>2] = $19;
  $$0 = 0;
 } else {
  $10 = $7 | 32;
  HEAP32[$0>>2] = $10;
  $$0 = -1;
 }
 return ($$0|0);
}
function _sn_write($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$ = 0, $10 = 0, $11 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = ((($0)) + 16|0);
 $4 = HEAP32[$3>>2]|0;
 $5 = ((($0)) + 20|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = $6;
 $8 = (($4) - ($7))|0;
 $9 = ($8>>>0)>($2>>>0);
 $$ = $9 ? $2 : $8;
 _memcpy(($6|0),($1|0),($$|0))|0;
 $10 = HEAP32[$5>>2]|0;
 $11 = (($10) + ($$)|0);
 HEAP32[$5>>2] = $11;
 return ($2|0);
}
function _strlen($0) {
 $0 = $0|0;
 var $$0 = 0, $$015$lcssa = 0, $$01519 = 0, $$1$lcssa = 0, $$pn = 0, $$pre = 0, $$sink = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0;
 var $21 = 0, $22 = 0, $23 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = $0;
 $2 = $1 & 3;
 $3 = ($2|0)==(0);
 L1: do {
  if ($3) {
   $$015$lcssa = $0;
   label = 4;
  } else {
   $$01519 = $0;$23 = $1;
   while(1) {
    $4 = HEAP8[$$01519>>0]|0;
    $5 = ($4<<24>>24)==(0);
    if ($5) {
     $$sink = $23;
     break L1;
    }
    $6 = ((($$01519)) + 1|0);
    $7 = $6;
    $8 = $7 & 3;
    $9 = ($8|0)==(0);
    if ($9) {
     $$015$lcssa = $6;
     label = 4;
     break;
    } else {
     $$01519 = $6;$23 = $7;
    }
   }
  }
 } while(0);
 if ((label|0) == 4) {
  $$0 = $$015$lcssa;
  while(1) {
   $10 = HEAP32[$$0>>2]|0;
   $11 = (($10) + -16843009)|0;
   $12 = $10 & -2139062144;
   $13 = $12 ^ -2139062144;
   $14 = $13 & $11;
   $15 = ($14|0)==(0);
   $16 = ((($$0)) + 4|0);
   if ($15) {
    $$0 = $16;
   } else {
    break;
   }
  }
  $17 = $10&255;
  $18 = ($17<<24>>24)==(0);
  if ($18) {
   $$1$lcssa = $$0;
  } else {
   $$pn = $$0;
   while(1) {
    $19 = ((($$pn)) + 1|0);
    $$pre = HEAP8[$19>>0]|0;
    $20 = ($$pre<<24>>24)==(0);
    if ($20) {
     $$1$lcssa = $19;
     break;
    } else {
     $$pn = $19;
    }
   }
  }
  $21 = $$1$lcssa;
  $$sink = $21;
 }
 $22 = (($$sink) - ($1))|0;
 return ($22|0);
}
function _snprintf($0,$1,$2,$varargs) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $varargs = $varargs|0;
 var $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $3 = sp;
 HEAP32[$3>>2] = $varargs;
 $4 = (_vsnprintf($0,$1,$2,$3)|0);
 STACKTOP = sp;return ($4|0);
}
function ___strdup($0) {
 $0 = $0|0;
 var $$0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (_strlen($0)|0);
 $2 = (($1) + 1)|0;
 $3 = (_malloc($2)|0);
 $4 = ($3|0)==(0|0);
 if ($4) {
  $$0 = 0;
 } else {
  _memcpy(($3|0),($0|0),($2|0))|0;
  $$0 = $3;
 }
 return ($$0|0);
}
function ___overflow($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $$pre = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $3 = 0, $4 = 0;
 var $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $2 = sp;
 $3 = $1&255;
 HEAP8[$2>>0] = $3;
 $4 = ((($0)) + 16|0);
 $5 = HEAP32[$4>>2]|0;
 $6 = ($5|0)==(0|0);
 if ($6) {
  $7 = (___towrite($0)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   $$pre = HEAP32[$4>>2]|0;
   $12 = $$pre;
   label = 4;
  } else {
   $$0 = -1;
  }
 } else {
  $12 = $5;
  label = 4;
 }
 do {
  if ((label|0) == 4) {
   $9 = ((($0)) + 20|0);
   $10 = HEAP32[$9>>2]|0;
   $11 = ($10>>>0)<($12>>>0);
   if ($11) {
    $13 = $1 & 255;
    $14 = ((($0)) + 75|0);
    $15 = HEAP8[$14>>0]|0;
    $16 = $15 << 24 >> 24;
    $17 = ($13|0)==($16|0);
    if (!($17)) {
     $18 = ((($10)) + 1|0);
     HEAP32[$9>>2] = $18;
     HEAP8[$10>>0] = $3;
     $$0 = $13;
     break;
    }
   }
   $19 = ((($0)) + 36|0);
   $20 = HEAP32[$19>>2]|0;
   $21 = (FUNCTION_TABLE_iiii[$20 & 127]($0,$2,1)|0);
   $22 = ($21|0)==(1);
   if ($22) {
    $23 = HEAP8[$2>>0]|0;
    $24 = $23&255;
    $$0 = $24;
   } else {
    $$0 = -1;
   }
  }
 } while(0);
 STACKTOP = sp;return ($$0|0);
}
function ___ofl_lock() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 ___lock((7956|0));
 return (7964|0);
}
function ___ofl_unlock() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 ___unlock((7956|0));
 return;
}
function _fflush($0) {
 $0 = $0|0;
 var $$0 = 0, $$023 = 0, $$02325 = 0, $$02327 = 0, $$024$lcssa = 0, $$02426 = 0, $$1 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0;
 var $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $phitmp = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ($0|0)==(0|0);
 do {
  if ($1) {
   $8 = (Atomics_load(HEAP32,208)|0);
   $9 = ($8|0)==(0|0);
   if ($9) {
    $29 = 0;
   } else {
    $10 = (Atomics_load(HEAP32,208)|0);
    $11 = (_fflush($10)|0);
    $29 = $11;
   }
   $12 = (___ofl_lock()|0);
   $$02325 = HEAP32[$12>>2]|0;
   $13 = ($$02325|0)==(0|0);
   if ($13) {
    $$024$lcssa = $29;
   } else {
    $$02327 = $$02325;$$02426 = $29;
    while(1) {
     $14 = ((($$02327)) + 76|0);
     $15 = (Atomics_load(HEAP32,$14>>2)|0);
     $16 = ($15|0)>(-1);
     if ($16) {
      $17 = (___lockfile($$02327)|0);
      $26 = $17;
     } else {
      $26 = 0;
     }
     $18 = ((($$02327)) + 20|0);
     $19 = HEAP32[$18>>2]|0;
     $20 = ((($$02327)) + 28|0);
     $21 = HEAP32[$20>>2]|0;
     $22 = ($19>>>0)>($21>>>0);
     if ($22) {
      $23 = (___fflush_unlocked($$02327)|0);
      $24 = $23 | $$02426;
      $$1 = $24;
     } else {
      $$1 = $$02426;
     }
     $25 = ($26|0)==(0);
     if (!($25)) {
      ___unlockfile($$02327);
     }
     $27 = ((($$02327)) + 56|0);
     $$023 = HEAP32[$27>>2]|0;
     $28 = ($$023|0)==(0|0);
     if ($28) {
      $$024$lcssa = $$1;
      break;
     } else {
      $$02327 = $$023;$$02426 = $$1;
     }
    }
   }
   ___ofl_unlock();
   $$0 = $$024$lcssa;
  } else {
   $2 = ((($0)) + 76|0);
   $3 = (Atomics_load(HEAP32,$2>>2)|0);
   $4 = ($3|0)>(-1);
   if (!($4)) {
    $5 = (___fflush_unlocked($0)|0);
    $$0 = $5;
    break;
   }
   $6 = (___lockfile($0)|0);
   $phitmp = ($6|0)==(0);
   $7 = (___fflush_unlocked($0)|0);
   if ($phitmp) {
    $$0 = $7;
   } else {
    ___unlockfile($0);
    $$0 = $7;
   }
  }
 } while(0);
 return ($$0|0);
}
function ___fflush_unlocked($0) {
 $0 = $0|0;
 var $$0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0;
 var $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + 20|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = ((($0)) + 28|0);
 $4 = HEAP32[$3>>2]|0;
 $5 = ($2>>>0)>($4>>>0);
 if ($5) {
  $6 = ((($0)) + 36|0);
  $7 = HEAP32[$6>>2]|0;
  (FUNCTION_TABLE_iiii[$7 & 127]($0,0,0)|0);
  $8 = HEAP32[$1>>2]|0;
  $9 = ($8|0)==(0|0);
  if ($9) {
   $$0 = -1;
  } else {
   label = 3;
  }
 } else {
  label = 3;
 }
 if ((label|0) == 3) {
  $10 = ((($0)) + 4|0);
  $11 = HEAP32[$10>>2]|0;
  $12 = ((($0)) + 8|0);
  $13 = HEAP32[$12>>2]|0;
  $14 = ($11>>>0)<($13>>>0);
  if ($14) {
   $15 = $11;
   $16 = $13;
   $17 = (($15) - ($16))|0;
   $18 = ((($0)) + 40|0);
   $19 = HEAP32[$18>>2]|0;
   (FUNCTION_TABLE_iiii[$19 & 127]($0,$17,1)|0);
  }
  $20 = ((($0)) + 16|0);
  HEAP32[$20>>2] = 0;
  HEAP32[$3>>2] = 0;
  HEAP32[$1>>2] = 0;
  HEAP32[$12>>2] = 0;
  HEAP32[$10>>2] = 0;
  $$0 = 0;
 }
 return ($$0|0);
}
function _fputc($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0;
 var $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ((($1)) + 76|0);
 $3 = (Atomics_load(HEAP32,$2>>2)|0);
 $4 = ($3|0)<(0);
 $5 = $0&255;
 $6 = $0 & 255;
 if ($4) {
  label = 3;
 } else {
  $7 = (___lockfile($1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   label = 3;
  } else {
   $20 = ((($1)) + 75|0);
   $21 = HEAP8[$20>>0]|0;
   $22 = $21 << 24 >> 24;
   $23 = ($6|0)==($22|0);
   if ($23) {
    label = 10;
   } else {
    $24 = ((($1)) + 20|0);
    $25 = HEAP32[$24>>2]|0;
    $26 = ((($1)) + 16|0);
    $27 = HEAP32[$26>>2]|0;
    $28 = ($25>>>0)<($27>>>0);
    if ($28) {
     $29 = ((($25)) + 1|0);
     HEAP32[$24>>2] = $29;
     HEAP8[$25>>0] = $5;
     $31 = $6;
    } else {
     label = 10;
    }
   }
   if ((label|0) == 10) {
    $30 = (___overflow($1,$0)|0);
    $31 = $30;
   }
   ___unlockfile($1);
   $$0 = $31;
  }
 }
 do {
  if ((label|0) == 3) {
   $9 = ((($1)) + 75|0);
   $10 = HEAP8[$9>>0]|0;
   $11 = $10 << 24 >> 24;
   $12 = ($6|0)==($11|0);
   if (!($12)) {
    $13 = ((($1)) + 20|0);
    $14 = HEAP32[$13>>2]|0;
    $15 = ((($1)) + 16|0);
    $16 = HEAP32[$15>>2]|0;
    $17 = ($14>>>0)<($16>>>0);
    if ($17) {
     $18 = ((($14)) + 1|0);
     HEAP32[$13>>2] = $18;
     HEAP8[$14>>0] = $5;
     $$0 = $6;
     break;
    }
   }
   $19 = (___overflow($1,$0)|0);
   $$0 = $19;
  }
 } while(0);
 return ($$0|0);
}
function _printf($0,$varargs) {
 $0 = $0|0;
 $varargs = $varargs|0;
 var $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = sp;
 HEAP32[$1>>2] = $varargs;
 $2 = HEAP32[176]|0;
 $3 = (_vfprintf($2,$0,$1)|0);
 STACKTOP = sp;return ($3|0);
}
function _strerror_r($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$0 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = (_strerror($0)|0);
 $4 = (_strlen($3)|0);
 $5 = ($4>>>0)<($2>>>0);
 if ($5) {
  $9 = (($4) + 1)|0;
  _memcpy(($1|0),($3|0),($9|0))|0;
  $$0 = 0;
 } else {
  $6 = ($2|0)==(0);
  $7 = (($2) + -1)|0;
  if ($6) {
   $$0 = 34;
  } else {
   $8 = (($1) + ($7)|0);
   _memcpy(($1|0),($3|0),($7|0))|0;
   HEAP8[$8>>0] = 0;
   $$0 = 34;
  }
 }
 return ($$0|0);
}
function ___pthread_tsd_run_dtors() {
 var $$02427 = 0, $$026 = 0, $$125 = 0, $$2 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0;
 var $8 = 0, $9 = 0, $exitcond = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_pthread_self()|0);
 $1 = ((($0)) + 60|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = ($2|0)==(0);
 if ($3) {
  return;
 }
 $4 = ((($0)) + 116|0);
 $$02427 = 0;
 while(1) {
  $$026 = 0;$$125 = 0;
  while(1) {
   $5 = HEAP32[$4>>2]|0;
   $6 = (($5) + ($$026<<2)|0);
   $7 = HEAP32[$6>>2]|0;
   $8 = ($7|0)==(0|0);
   if ($8) {
    $$2 = $$125;
   } else {
    $9 = (10072 + ($$026<<2)|0);
    $10 = (Atomics_load(HEAP32,$9>>2)|0);
    $11 = ($10|0)==(0|0);
    if ($11) {
     $$2 = $$125;
    } else {
     HEAP32[$6>>2] = 0;
     $12 = (Atomics_load(HEAP32,$9>>2)|0);
     FUNCTION_TABLE_vi[$12 & 127]($7);
     $$2 = 1;
    }
   }
   $13 = (($$026) + 1)|0;
   $exitcond = ($13|0)==(128);
   if ($exitcond) {
    break;
   } else {
    $$026 = $13;$$125 = $$2;
   }
  }
  $14 = (($$02427) + 1)|0;
  $15 = ($$2|0)!=(0);
  $16 = ($14|0)<(4);
  $17 = $16 & $15;
  if ($17) {
   $$02427 = $14;
  } else {
   break;
  }
 }
 return;
}
function __emscripten_atomic_fetch_and_add_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = (_i64Add(($11|0),($14|0),($1|0),($2|0))|0);
 $16 = tempRet0;
 $17 = $0;
 $18 = $17;
 HEAP32[$18>>2] = $15;
 $19 = (($17) + 4)|0;
 $20 = $19;
 HEAP32[$20>>2] = $16;
 $21 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($14);
 return ($11|0);
}
function __emscripten_atomic_fetch_and_and_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = $11 & $1;
 $16 = $14 & $2;
 $17 = $0;
 $18 = $17;
 HEAP32[$18>>2] = $15;
 $19 = (($17) + 4)|0;
 $20 = $19;
 HEAP32[$20>>2] = $16;
 $21 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($14);
 return ($11|0);
}
function __emscripten_atomic_fetch_and_or_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = $11 | $1;
 $16 = $14 | $2;
 $17 = $0;
 $18 = $17;
 HEAP32[$18>>2] = $15;
 $19 = (($17) + 4)|0;
 $20 = $19;
 HEAP32[$20>>2] = $16;
 $21 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($14);
 return ($11|0);
}
function __emscripten_atomic_fetch_and_sub_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = (_i64Subtract(($11|0),($14|0),($1|0),($2|0))|0);
 $16 = tempRet0;
 $17 = $0;
 $18 = $17;
 HEAP32[$18>>2] = $15;
 $19 = (($17) + 4)|0;
 $20 = $19;
 HEAP32[$20>>2] = $16;
 $21 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($14);
 return ($11|0);
}
function __emscripten_atomic_fetch_and_xor_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = $11 ^ $1;
 $16 = $14 ^ $2;
 $17 = $0;
 $18 = $17;
 HEAP32[$18>>2] = $15;
 $19 = (($17) + 4)|0;
 $20 = $19;
 HEAP32[$20>>2] = $16;
 $21 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($14);
 return ($11|0);
}
function _emscripten_async_run_in_main_thread($0) {
 $0 = $0|0;
 var $$0 = 0, $$0$in = 0, $$0$in19 = 0, $$0$lcssa = 0, $$020 = 0, $$expand_i1_val = 0, $$lcssa = 0, $$lcssa18 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0;
 var $8 = 0, $9 = 0, $call_queue$init$val = 0, $call_queue$init$val$pre_trunc = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ($0|0)==(0|0);
 if ($1) {
  ___assert_fail((5713|0),(5516|0),264,(5718|0));
  // unreachable;
 }
 $2 = (_emscripten_is_main_runtime_thread()|0);
 $3 = ($2|0)==(0);
 if (!($3)) {
  __do_call($0);
  return;
 }
 (___pthread_mutex_lock(8492)|0);
 $call_queue$init$val$pre_trunc = HEAP8[11645]|0;
 $call_queue$init$val = $call_queue$init$val$pre_trunc&1;
 if (!($call_queue$init$val)) {
  $$expand_i1_val = 1;
  HEAP8[11645] = $$expand_i1_val;
 }
 $4 = (Atomics_load(HEAP32, 2130)|0);
 $5 = (Atomics_load(HEAP32, 2131)|0);
 $$0$in19 = (($5) + 1)|0;
 $$020 = (($$0$in19|0) % 128)&-1;
 $6 = ($$020|0)==($4|0);
 if ($6) {
  $7 = $4;
  while(1) {
   (___pthread_mutex_unlock(8492)|0);
   (_emscripten_futex_wait((8520|0),($7|0),inf)|0);
   (___pthread_mutex_lock(8492)|0);
   $8 = (Atomics_load(HEAP32, 2130)|0);
   $9 = (Atomics_load(HEAP32, 2131)|0);
   $$0$in = (($9) + 1)|0;
   $$0 = (($$0$in|0) % 128)&-1;
   $10 = ($$0|0)==($8|0);
   if ($10) {
    $7 = $8;
   } else {
    $$0$lcssa = $$0;$$lcssa = $9;$$lcssa18 = $8;
    break;
   }
  }
 } else {
  $$0$lcssa = $$020;$$lcssa = $5;$$lcssa18 = $4;
 }
 $11 = (8528 + ($$lcssa<<2)|0);
 HEAP32[$11>>2] = $0;
 $12 = ($$lcssa18|0)==($$lcssa|0);
 if ($12) {
  $13 = _emscripten_asm_const_i(0)|0;
 }
 $14 = (Atomics_store(HEAP32, 2131, $$0$lcssa)|0);
 (___pthread_mutex_unlock(8492)|0);
 return;
}
function _emscripten_atomic_add_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = (_i64Add(($11|0),($14|0),($1|0),($2|0))|0);
 $16 = tempRet0;
 $17 = $0;
 $18 = $17;
 HEAP32[$18>>2] = $15;
 $19 = (($17) + 4)|0;
 $20 = $19;
 HEAP32[$20>>2] = $16;
 $21 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($16);
 return ($15|0);
}
function _emscripten_atomic_and_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = $11 & $1;
 $16 = $14 & $2;
 $17 = $0;
 $18 = $17;
 HEAP32[$18>>2] = $15;
 $19 = (($17) + 4)|0;
 $20 = $19;
 HEAP32[$20>>2] = $16;
 $21 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($16);
 return ($15|0);
}
function _emscripten_atomic_cas_u64($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 $5 = $0;
 $6 = $5 >>> 3;
 $7 = $6 & 255;
 $8 = (9048 + ($7<<2)|0);
 while(1) {
  $9 = (Atomics_exchange(HEAP32, $8>>2, 1)|0);
  $10 = ($9|0)==(0);
  if ($10) {
   break;
  }
 }
 $11 = $0;
 $12 = $11;
 $13 = HEAP32[$12>>2]|0;
 $14 = (($11) + 4)|0;
 $15 = $14;
 $16 = HEAP32[$15>>2]|0;
 $17 = ($13|0)==($1|0);
 $18 = ($16|0)==($2|0);
 $19 = $17 & $18;
 if (!($19)) {
  $24 = (Atomics_store(HEAP32, $8>>2, 0)|0);
  tempRet0 = ($16);
  return ($13|0);
 }
 $20 = $0;
 $21 = $20;
 HEAP32[$21>>2] = $3;
 $22 = (($20) + 4)|0;
 $23 = $22;
 HEAP32[$23>>2] = $4;
 $24 = (Atomics_store(HEAP32, $8>>2, 0)|0);
 tempRet0 = ($16);
 return ($13|0);
}
function _emscripten_atomic_exchange_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = $0;
 $16 = $15;
 HEAP32[$16>>2] = $1;
 $17 = (($15) + 4)|0;
 $18 = $17;
 HEAP32[$18>>2] = $2;
 $19 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($14);
 return ($11|0);
}
function _emscripten_atomic_load_f32($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (Atomics_load(HEAP32, $0>>2)|0);
 $2 = (HEAP32[tempDoublePtr>>2]=$1,+HEAPF32[tempDoublePtr>>2]);
 return (+$2);
}
function _emscripten_atomic_load_f64($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0.0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = $0;
 $2 = $1 >>> 3;
 $3 = $2 & 255;
 $4 = (9048 + ($3<<2)|0);
 while(1) {
  $5 = (Atomics_exchange(HEAP32, $4>>2, 1)|0);
  $6 = ($5|0)==(0);
  if ($6) {
   break;
  }
 }
 $7 = +HEAPF64[$0>>3];
 $8 = (Atomics_store(HEAP32, $4>>2, 0)|0);
 return (+$7);
}
function _emscripten_atomic_load_u64($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = $0;
 $2 = $1 >>> 3;
 $3 = $2 & 255;
 $4 = (9048 + ($3<<2)|0);
 while(1) {
  $5 = (Atomics_exchange(HEAP32, $4>>2, 1)|0);
  $6 = ($5|0)==(0);
  if ($6) {
   break;
  }
 }
 $7 = $0;
 $8 = $7;
 $9 = HEAP32[$8>>2]|0;
 $10 = (($7) + 4)|0;
 $11 = $10;
 $12 = HEAP32[$11>>2]|0;
 $13 = (Atomics_store(HEAP32, $4>>2, 0)|0);
 tempRet0 = ($12);
 return ($9|0);
}
function _emscripten_atomic_or_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = $11 | $1;
 $16 = $14 | $2;
 $17 = $0;
 $18 = $17;
 HEAP32[$18>>2] = $15;
 $19 = (($17) + 4)|0;
 $20 = $19;
 HEAP32[$20>>2] = $16;
 $21 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($16);
 return ($15|0);
}
function _emscripten_atomic_store_f32($0,$1) {
 $0 = $0|0;
 $1 = +$1;
 var $2 = 0, $3 = 0, $4 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = (HEAPF32[tempDoublePtr>>2]=$1,HEAP32[tempDoublePtr>>2]|0);
 $3 = (Atomics_store(HEAP32, $0>>2, $2)|0);
 $4 = (+($3>>>0));
 return (+$4);
}
function _emscripten_atomic_store_f64($0,$1) {
 $0 = $0|0;
 $1 = +$1;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = $0;
 $3 = $2 >>> 3;
 $4 = $3 & 255;
 $5 = (9048 + ($4<<2)|0);
 while(1) {
  $6 = (Atomics_exchange(HEAP32, $5>>2, 1)|0);
  $7 = ($6|0)==(0);
  if ($7) {
   break;
  }
 }
 HEAPF64[$0>>3] = $1;
 $8 = (Atomics_store(HEAP32, $5>>2, 0)|0);
 return (+$1);
}
function _emscripten_atomic_store_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 HEAP32[$10>>2] = $1;
 $11 = (($9) + 4)|0;
 $12 = $11;
 HEAP32[$12>>2] = $2;
 $13 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($2);
 return ($1|0);
}
function _emscripten_atomic_sub_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = (_i64Subtract(($11|0),($14|0),($1|0),($2|0))|0);
 $16 = tempRet0;
 $17 = $0;
 $18 = $17;
 HEAP32[$18>>2] = $15;
 $19 = (($17) + 4)|0;
 $20 = $19;
 HEAP32[$20>>2] = $16;
 $21 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($16);
 return ($15|0);
}
function _emscripten_atomic_xor_u64($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $3 = $0;
 $4 = $3 >>> 3;
 $5 = $4 & 255;
 $6 = (9048 + ($5<<2)|0);
 while(1) {
  $7 = (Atomics_exchange(HEAP32, $6>>2, 1)|0);
  $8 = ($7|0)==(0);
  if ($8) {
   break;
  }
 }
 $9 = $0;
 $10 = $9;
 $11 = HEAP32[$10>>2]|0;
 $12 = (($9) + 4)|0;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = $11 ^ $1;
 $16 = $14 ^ $2;
 $17 = $0;
 $18 = $17;
 HEAP32[$18>>2] = $15;
 $19 = (($17) + 4)|0;
 $20 = $19;
 HEAP32[$20>>2] = $16;
 $21 = (Atomics_store(HEAP32, $6>>2, 0)|0);
 tempRet0 = ($16);
 return ($15|0);
}
function _emscripten_main_thread_process_queued_calls() {
 var $$0910 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_emscripten_is_main_runtime_thread()|0);
 $1 = ($0|0)==(0);
 if ($1) {
  ___assert_fail((5394|0),(5516|0),428,(5609|0));
  // unreachable;
 }
 $2 = (_emscripten_is_main_runtime_thread()|0);
 $3 = ($2|0)==(0);
 $4 = HEAP32[2122]|0;
 $5 = ($4|0)!=(0);
 $or$cond = $3 | $5;
 if ($or$cond) {
  return;
 }
 HEAP32[2122] = 1;
 (___pthread_mutex_lock(8492)|0);
 $6 = (Atomics_load(HEAP32, 2130)|0);
 $7 = (Atomics_load(HEAP32, 2131)|0);
 $8 = ($6|0)==($7|0);
 (___pthread_mutex_unlock(8492)|0);
 if (!($8)) {
  $$0910 = $6;
  while(1) {
   $9 = (8528 + ($$0910<<2)|0);
   $10 = HEAP32[$9>>2]|0;
   __do_call($10);
   (___pthread_mutex_lock(8492)|0);
   $11 = (($$0910) + 1)|0;
   $12 = (($11|0) % 128)&-1;
   $13 = (Atomics_store(HEAP32, 2130, $12)|0);
   $14 = (Atomics_load(HEAP32, 2131)|0);
   $15 = ($12|0)==($14|0);
   (___pthread_mutex_unlock(8492)|0);
   if ($15) {
    break;
   } else {
    $$0910 = $12;
   }
  }
 }
 (_emscripten_futex_wake((8520|0),2147483647)|0);
 HEAP32[2122] = 0;
 return;
}
function _emscripten_sync_run_in_main_thread($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 _emscripten_async_run_in_main_thread($0);
 (_emscripten_wait_for_call_v($0,inf)|0);
 return;
}
function _emscripten_sync_run_in_main_thread_0($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 96|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(96|0);
 $1 = sp;
 dest=$1; stop=dest+96|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 HEAP32[$1>>2] = $0;
 $2 = ((($1)) + 80|0);
 HEAP32[$2>>2] = 0;
 _emscripten_async_run_in_main_thread($1);
 (_emscripten_wait_for_call_v($1,inf)|0);
 $3 = HEAP32[$2>>2]|0;
 STACKTOP = sp;return ($3|0);
}
function _emscripten_sync_run_in_main_thread_1($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 96|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(96|0);
 $2 = sp;
 dest=$2; stop=dest+96|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 HEAP32[$2>>2] = $0;
 $3 = ((($2)) + 16|0);
 HEAP32[$3>>2] = $1;
 $4 = ((($2)) + 80|0);
 HEAP32[$4>>2] = 0;
 _emscripten_async_run_in_main_thread($2);
 (_emscripten_wait_for_call_v($2,inf)|0);
 $5 = HEAP32[$4>>2]|0;
 STACKTOP = sp;return ($5|0);
}
function _emscripten_sync_run_in_main_thread_2($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 96|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(96|0);
 $3 = sp;
 dest=$3; stop=dest+96|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 HEAP32[$3>>2] = $0;
 $4 = ((($3)) + 16|0);
 HEAP32[$4>>2] = $1;
 $5 = ((($3)) + 24|0);
 HEAP32[$5>>2] = $2;
 $6 = ((($3)) + 80|0);
 HEAP32[$6>>2] = 0;
 _emscripten_async_run_in_main_thread($3);
 (_emscripten_wait_for_call_v($3,inf)|0);
 $7 = HEAP32[$6>>2]|0;
 STACKTOP = sp;return ($7|0);
}
function _emscripten_sync_run_in_main_thread_3($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 96|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(96|0);
 $4 = sp;
 dest=$4; stop=dest+96|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 HEAP32[$4>>2] = $0;
 $5 = ((($4)) + 16|0);
 HEAP32[$5>>2] = $1;
 $6 = ((($4)) + 24|0);
 HEAP32[$6>>2] = $2;
 $7 = ((($4)) + 32|0);
 HEAP32[$7>>2] = $3;
 $8 = ((($4)) + 80|0);
 HEAP32[$8>>2] = 0;
 _emscripten_async_run_in_main_thread($4);
 (_emscripten_wait_for_call_v($4,inf)|0);
 $9 = HEAP32[$8>>2]|0;
 STACKTOP = sp;return ($9|0);
}
function _emscripten_sync_run_in_main_thread_4($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $10 = 0, $11 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 96|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(96|0);
 $5 = sp;
 dest=$5; stop=dest+96|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 HEAP32[$5>>2] = $0;
 $6 = ((($5)) + 16|0);
 HEAP32[$6>>2] = $1;
 $7 = ((($5)) + 24|0);
 HEAP32[$7>>2] = $2;
 $8 = ((($5)) + 32|0);
 HEAP32[$8>>2] = $3;
 $9 = ((($5)) + 40|0);
 HEAP32[$9>>2] = $4;
 $10 = ((($5)) + 80|0);
 HEAP32[$10>>2] = 0;
 _emscripten_async_run_in_main_thread($5);
 (_emscripten_wait_for_call_v($5,inf)|0);
 $11 = HEAP32[$10>>2]|0;
 STACKTOP = sp;return ($11|0);
}
function _emscripten_sync_run_in_main_thread_5($0,$1,$2,$3,$4,$5) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 $5 = $5|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 96|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(96|0);
 $6 = sp;
 dest=$6; stop=dest+96|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 HEAP32[$6>>2] = $0;
 $7 = ((($6)) + 16|0);
 HEAP32[$7>>2] = $1;
 $8 = ((($6)) + 24|0);
 HEAP32[$8>>2] = $2;
 $9 = ((($6)) + 32|0);
 HEAP32[$9>>2] = $3;
 $10 = ((($6)) + 40|0);
 HEAP32[$10>>2] = $4;
 $11 = ((($6)) + 48|0);
 HEAP32[$11>>2] = $5;
 $12 = ((($6)) + 80|0);
 HEAP32[$12>>2] = 0;
 _emscripten_async_run_in_main_thread($6);
 (_emscripten_wait_for_call_v($6,inf)|0);
 $13 = HEAP32[$12>>2]|0;
 STACKTOP = sp;return ($13|0);
}
function _emscripten_sync_run_in_main_thread_6($0,$1,$2,$3,$4,$5,$6) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 $5 = $5|0;
 $6 = $6|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $7 = 0, $8 = 0, $9 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 96|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(96|0);
 $7 = sp;
 dest=$7; stop=dest+96|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 HEAP32[$7>>2] = $0;
 $8 = ((($7)) + 16|0);
 HEAP32[$8>>2] = $1;
 $9 = ((($7)) + 24|0);
 HEAP32[$9>>2] = $2;
 $10 = ((($7)) + 32|0);
 HEAP32[$10>>2] = $3;
 $11 = ((($7)) + 40|0);
 HEAP32[$11>>2] = $4;
 $12 = ((($7)) + 48|0);
 HEAP32[$12>>2] = $5;
 $13 = ((($7)) + 56|0);
 HEAP32[$13>>2] = $6;
 $14 = ((($7)) + 80|0);
 HEAP32[$14>>2] = 0;
 _emscripten_async_run_in_main_thread($7);
 (_emscripten_wait_for_call_v($7,inf)|0);
 $15 = HEAP32[$14>>2]|0;
 STACKTOP = sp;return ($15|0);
}
function _emscripten_sync_run_in_main_thread_7($0,$1,$2,$3,$4,$5,$6,$7) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 $5 = $5|0;
 $6 = $6|0;
 $7 = $7|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $8 = 0, $9 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 96|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(96|0);
 $8 = sp;
 dest=$8; stop=dest+96|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 HEAP32[$8>>2] = $0;
 $9 = ((($8)) + 16|0);
 HEAP32[$9>>2] = $1;
 $10 = ((($8)) + 24|0);
 HEAP32[$10>>2] = $2;
 $11 = ((($8)) + 32|0);
 HEAP32[$11>>2] = $3;
 $12 = ((($8)) + 40|0);
 HEAP32[$12>>2] = $4;
 $13 = ((($8)) + 48|0);
 HEAP32[$13>>2] = $5;
 $14 = ((($8)) + 56|0);
 HEAP32[$14>>2] = $6;
 $15 = ((($8)) + 64|0);
 HEAP32[$15>>2] = $7;
 $16 = ((($8)) + 80|0);
 HEAP32[$16>>2] = 0;
 _emscripten_async_run_in_main_thread($8);
 (_emscripten_wait_for_call_v($8,inf)|0);
 $17 = HEAP32[$16>>2]|0;
 STACKTOP = sp;return ($17|0);
}
function _emscripten_sync_run_in_main_thread_xprintf_varargs($0,$1,$2,$varargs) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $varargs = $varargs|0;
 var $$0 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 240|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(240|0);
 $3 = sp + 96|0;
 $4 = sp + 112|0;
 $5 = sp;
 HEAP32[$3>>2] = $varargs;
 $6 = (_vsnprintf($4,128,$2,$3)|0);
 $7 = ($6|0)>(127);
 $8 = (($6) + 1)|0;
 if ($7) {
  $9 = (_malloc($8)|0);
  HEAP32[$3>>2] = $varargs;
  (_vsnprintf($9,$8,$2,$3)|0);
  $$0 = $9;
 } else {
  $$0 = $4;
 }
 dest=$5; stop=dest+96|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 HEAP32[$5>>2] = $0;
 $10 = $1;
 $11 = ((($5)) + 16|0);
 HEAP32[$11>>2] = $10;
 $12 = ((($5)) + 24|0);
 HEAP32[$12>>2] = $$0;
 $13 = ((($5)) + 80|0);
 HEAP32[$13>>2] = 0;
 _emscripten_async_run_in_main_thread($5);
 (_emscripten_wait_for_call_v($5,inf)|0);
 $14 = ($$0|0)==($4|0);
 if ($14) {
  $15 = HEAP32[$13>>2]|0;
  STACKTOP = sp;return ($15|0);
 }
 _free($$0);
 $15 = HEAP32[$13>>2]|0;
 STACKTOP = sp;return ($15|0);
}
function _proxy_main($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $$1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(48|0);
 $2 = sp + 4|0;
 $3 = sp;
 $4 = (_emscripten_has_threading_support()|0);
 $5 = ($4|0)==(0);
 if ($5) {
  $15 = (Atomics_load(HEAP32,2120)|0);
  $16 = (Atomics_load(HEAP32,(8484)>>2)|0);
  $17 = (___call_main(($15|0),($16|0))|0);
  $$1 = $17;
  STACKTOP = sp;return ($$1|0);
 }
 (_pthread_attr_init($2)|0);
 (_pthread_attr_setdetachstate($2,0)|0);
 (_pthread_attr_setstacksize($2,131072)|0);
 $6 = _emscripten_asm_const_i(1)|0;
 $7 = ($6|0)==(0);
 if (!($7)) {
  $8 = ((($2)) + 36|0);
  HEAP32[$8>>2] = (5331);
 }
 Atomics_store(HEAP32,2120,$0)|0;
 Atomics_store(HEAP32,(8484)>>2,$1)|0;
 $9 = (_pthread_create(($3|0),($2|0),(72|0),(8480|0))|0);
 $10 = ($9|0)==(0);
 if ($10) {
  $14 = _emscripten_asm_const_i(2)|0;
  $$0 = 0;
 } else {
  $11 = (Atomics_load(HEAP32,2120)|0);
  $12 = (Atomics_load(HEAP32,(8484)>>2)|0);
  $13 = (___call_main(($11|0),($12|0))|0);
  $$0 = $13;
 }
 $$1 = $$0;
 STACKTOP = sp;return ($$1|0);
}
function _pthread_attr_init($0) {
 $0 = $0|0;
 var $$sroa$0 = 0, dest = 0, label = 0, sp = 0, src = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(48|0);
 $$sroa$0 = sp;
 dest=$$sroa$0; stop=dest+44|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 dest=$0; src=$$sroa$0; stop=dest+44|0; do { HEAP32[dest>>2]=HEAP32[src>>2]|0; dest=dest+4|0; src=src+4|0; } while ((dest|0) < (stop|0));
 STACKTOP = sp;return 0;
}
function _pthread_attr_setdetachstate($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($1>>>0)>(1);
 if ($2) {
  $$0 = 22;
 } else {
  $3 = ((($0)) + 12|0);
  HEAP32[$3>>2] = $1;
  $$0 = 0;
 }
 return ($$0|0);
}
function _pthread_attr_setstacksize($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = (($1) + -2048)|0;
 $3 = ($2>>>0)>(1073741823);
 if ($3) {
  $$0 = 22;
  return ($$0|0);
 }
 $4 = (($1) + -81920)|0;
 $5 = ((($0)) + 8|0);
 HEAP32[$5>>2] = 0;
 HEAP32[$0>>2] = $4;
 $$0 = 0;
 return ($$0|0);
}
function ___emscripten_thread_main($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (_pthread_self()|0);
 _emscripten_set_thread_name(($1|0),(5370|0));
 $2 = HEAP32[$0>>2]|0;
 $3 = ((($0)) + 4|0);
 $4 = HEAP32[$3>>2]|0;
 $5 = (___call_main(($2|0),($4|0))|0);
 $6 = $5;
 return ($6|0);
}
function _pthread_attr_destroy($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 0;
}
function _emscripten_wait_for_call_v($0,$1) {
 $0 = $0|0;
 $1 = +$1;
 var $$ = 0, $$01921 = 0.0, $$020$lcssa = 0, $$1 = 0, $10 = 0.0, $11 = 0, $12 = 0, $13 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0.0, $6 = 0.0, $7 = 0, $8 = 0.0, $9 = 0, $or$cond = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ((($0)) + 8|0);
 $3 = (Atomics_load(HEAP32, $2>>2)|0);
 $4 = ($3|0)==(0);
 if (!($4)) {
  $$1 = $3;
  $13 = ($$1|0)==(0);
  $$ = $13 ? -8 : 0;
  return ($$|0);
 }
 $5 = (+_emscripten_get_now());
 $6 = $5 + $1;
 _emscripten_set_current_thread_status(5);
 $7 = $5 < $6;
 if ($7) {
  $$01921 = $5;
  while(1) {
   $8 = $6 - $$01921;
   (_emscripten_futex_wait(($2|0),0,(+$8))|0);
   $9 = (Atomics_load(HEAP32, $2>>2)|0);
   $10 = (+_emscripten_get_now());
   $11 = ($9|0)==(0);
   $12 = $10 < $6;
   $or$cond = $11 & $12;
   if ($or$cond) {
    $$01921 = $10;
   } else {
    $$020$lcssa = $9;
    break;
   }
  }
 } else {
  $$020$lcssa = 0;
 }
 _emscripten_set_current_thread_status(1);
 $$1 = $$020$lcssa;
 $13 = ($$1|0)==(0);
 $$ = $13 ? -8 : 0;
 return ($$|0);
}
function __do_call($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0;
 var $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0;
 var $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0;
 var $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0;
 var $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0;
 var $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0;
 var $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 do {
  switch ($1|0) {
  case 12:  {
   $2 = ((($0)) + 16|0);
   $3 = HEAP32[$2>>2]|0;
   $4 = ((($0)) + 24|0);
   $5 = HEAP32[$4>>2]|0;
   $6 = (_utime(($3|0),($5|0))|0);
   $7 = ((($0)) + 80|0);
   HEAP32[$7>>2] = $6;
   break;
  }
  case 13:  {
   $8 = ((($0)) + 16|0);
   $9 = HEAP32[$8>>2]|0;
   $10 = ((($0)) + 24|0);
   $11 = HEAP32[$10>>2]|0;
   $12 = (_utimes(($9|0),($11|0))|0);
   $13 = ((($0)) + 80|0);
   HEAP32[$13>>2] = $12;
   break;
  }
  case 37:  {
   $14 = ((($0)) + 16|0);
   $15 = HEAP32[$14>>2]|0;
   $16 = (_chroot(($15|0))|0);
   $17 = ((($0)) + 80|0);
   HEAP32[$17>>2] = $16;
   break;
  }
  case 46:  {
   $18 = ((($0)) + 16|0);
   $19 = HEAP32[$18>>2]|0;
   $20 = ((($0)) + 24|0);
   $21 = HEAP32[$20>>2]|0;
   $22 = (_fpathconf(($19|0),($21|0))|0);
   $23 = ((($0)) + 80|0);
   HEAP32[$23>>2] = $22;
   break;
  }
  case 68:  {
   $24 = ((($0)) + 16|0);
   $25 = HEAP32[$24>>2]|0;
   $26 = ((($0)) + 24|0);
   $27 = HEAP32[$26>>2]|0;
   $28 = ((($0)) + 32|0);
   $29 = HEAP32[$28>>2]|0;
   $30 = (_confstr(($25|0),($27|0),($29|0))|0);
   $31 = ((($0)) + 80|0);
   HEAP32[$31>>2] = $30;
   break;
  }
  case 72:  {
   $32 = ((($0)) + 16|0);
   $33 = HEAP32[$32>>2]|0;
   $34 = (_sysconf(($33|0))|0);
   $35 = ((($0)) + 80|0);
   HEAP32[$35>>2] = $34;
   break;
  }
  case 110:  {
   $36 = ((($0)) + 16|0);
   $37 = HEAP32[$36>>2]|0;
   $38 = (_atexit(($37|0))|0);
   $39 = ((($0)) + 80|0);
   HEAP32[$39>>2] = $38;
   break;
  }
  case 111:  {
   $40 = ((($0)) + 16|0);
   $41 = HEAP32[$40>>2]|0;
   $42 = (_getenv(($41|0))|0);
   $43 = ((($0)) + 80|0);
   HEAP32[$43>>2] = $42;
   break;
  }
  case 112:  {
   $44 = (_clearenv()|0);
   $45 = ((($0)) + 80|0);
   HEAP32[$45>>2] = $44;
   break;
  }
  case 113:  {
   $46 = ((($0)) + 16|0);
   $47 = HEAP32[$46>>2]|0;
   $48 = ((($0)) + 24|0);
   $49 = HEAP32[$48>>2]|0;
   $50 = ((($0)) + 32|0);
   $51 = HEAP32[$50>>2]|0;
   $52 = (_setenv(($47|0),($49|0),($51|0))|0);
   $53 = ((($0)) + 80|0);
   HEAP32[$53>>2] = $52;
   break;
  }
  case 114:  {
   $54 = ((($0)) + 16|0);
   $55 = HEAP32[$54>>2]|0;
   $56 = (_unsetenv(($55|0))|0);
   $57 = ((($0)) + 80|0);
   HEAP32[$57>>2] = $56;
   break;
  }
  case 115:  {
   $58 = ((($0)) + 16|0);
   $59 = HEAP32[$58>>2]|0;
   $60 = (_putenv(($59|0))|0);
   $61 = ((($0)) + 80|0);
   HEAP32[$61>>2] = $60;
   break;
  }
  case 119:  {
   _tzset();
   break;
  }
  case 137:  {
   $62 = ((($0)) + 16|0);
   $63 = HEAP32[$62>>2]|0;
   $64 = ((($0)) + 24|0);
   $65 = HEAP32[$64>>2]|0;
   $66 = ((($0)) + 32|0);
   $67 = HEAP32[$66>>2]|0;
   $68 = ((($0)) + 40|0);
   $69 = HEAP32[$68>>2]|0;
   $70 = (_pthread_create(($63|0),($65|0),($67|0),($69|0))|0);
   $71 = ((($0)) + 80|0);
   HEAP32[$71>>2] = $70;
   break;
  }
  case 138:  {
   $72 = ((($0)) + 16|0);
   $73 = HEAP32[$72>>2]|0;
   $74 = ((($0)) + 24|0);
   $75 = HEAP32[$74>>2]|0;
   $76 = (_emscripten_syscall(($73|0),($75|0))|0);
   $77 = ((($0)) + 80|0);
   HEAP32[$77>>2] = $76;
   break;
  }
  case 1024:  {
   $78 = ((($0)) + 4|0);
   $79 = HEAP32[$78>>2]|0;
   FUNCTION_TABLE_v[$79 & 127]();
   break;
  }
  case 1025:  {
   $80 = ((($0)) + 4|0);
   $81 = HEAP32[$80>>2]|0;
   $82 = ((($0)) + 16|0);
   $83 = HEAP32[$82>>2]|0;
   FUNCTION_TABLE_vi[$81 & 127]($83);
   break;
  }
  case 1026:  {
   $84 = ((($0)) + 4|0);
   $85 = HEAP32[$84>>2]|0;
   $86 = ((($0)) + 16|0);
   $87 = HEAP32[$86>>2]|0;
   $88 = ((($0)) + 24|0);
   $89 = HEAP32[$88>>2]|0;
   FUNCTION_TABLE_vii[$85 & 127]($87,$89);
   break;
  }
  case 1027:  {
   $90 = ((($0)) + 4|0);
   $91 = HEAP32[$90>>2]|0;
   $92 = ((($0)) + 16|0);
   $93 = HEAP32[$92>>2]|0;
   $94 = ((($0)) + 24|0);
   $95 = HEAP32[$94>>2]|0;
   $96 = ((($0)) + 32|0);
   $97 = HEAP32[$96>>2]|0;
   FUNCTION_TABLE_viii[$91 & 127]($93,$95,$97);
   break;
  }
  case 2048:  {
   $98 = ((($0)) + 4|0);
   $99 = HEAP32[$98>>2]|0;
   $100 = (FUNCTION_TABLE_i[$99 & 127]()|0);
   $101 = ((($0)) + 80|0);
   HEAP32[$101>>2] = $100;
   break;
  }
  case 2049:  {
   $102 = ((($0)) + 4|0);
   $103 = HEAP32[$102>>2]|0;
   $104 = ((($0)) + 16|0);
   $105 = HEAP32[$104>>2]|0;
   $106 = (FUNCTION_TABLE_ii[$103 & 127]($105)|0);
   $107 = ((($0)) + 80|0);
   HEAP32[$107>>2] = $106;
   break;
  }
  case 2050:  {
   $108 = ((($0)) + 4|0);
   $109 = HEAP32[$108>>2]|0;
   $110 = ((($0)) + 16|0);
   $111 = HEAP32[$110>>2]|0;
   $112 = ((($0)) + 24|0);
   $113 = HEAP32[$112>>2]|0;
   $114 = (FUNCTION_TABLE_iii[$109 & 127]($111,$113)|0);
   $115 = ((($0)) + 80|0);
   HEAP32[$115>>2] = $114;
   break;
  }
  case 2051:  {
   $116 = ((($0)) + 4|0);
   $117 = HEAP32[$116>>2]|0;
   $118 = ((($0)) + 16|0);
   $119 = HEAP32[$118>>2]|0;
   $120 = ((($0)) + 24|0);
   $121 = HEAP32[$120>>2]|0;
   $122 = ((($0)) + 32|0);
   $123 = HEAP32[$122>>2]|0;
   $124 = (FUNCTION_TABLE_iiii[$117 & 127]($119,$121,$123)|0);
   $125 = ((($0)) + 80|0);
   HEAP32[$125>>2] = $124;
   break;
  }
  default: {
   ___assert_fail((5653|0),(5516|0),215,(5704|0));
   // unreachable;
  }
  }
 } while(0);
 $126 = ((($0)) + 88|0);
 $127 = HEAP32[$126>>2]|0;
 $128 = ($127|0)==(0);
 if ($128) {
  $129 = ((($0)) + 8|0);
  HEAP32[$129>>2] = 1;
  (_emscripten_futex_wake(($129|0),2147483647)|0);
  return;
 } else {
  _free($0);
  return;
 }
}
function ___pthread_mutex_unlock($0) {
 $0 = $0|0;
 var $$0 = 0, $$045 = 0, $$pre = 0, $$pre$phiZ2D = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0;
 var $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $5 = 0, $6 = 0;
 var $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, $or$cond3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + 8|0);
 $2 = (Atomics_load(HEAP32,$1>>2)|0);
 $3 = HEAP32[$0>>2]|0;
 $4 = $3 & 15;
 $5 = $3 & 128;
 $6 = $5 ^ 128;
 $7 = ($4|0)==(0);
 if ($7) {
  $$pre = ((($0)) + 4|0);
  $$045 = 0;$$pre$phiZ2D = $$pre;
 } else {
  $8 = (_pthread_self()|0);
  $9 = ((($0)) + 4|0);
  $10 = (Atomics_load(HEAP32,$9>>2)|0);
  $11 = $10 & 2147483647;
  $12 = ((($8)) + 52|0);
  $13 = HEAP32[$12>>2]|0;
  $14 = ($11|0)==($13|0);
  if (!($14)) {
   $$0 = 1;
   return ($$0|0);
  }
  $15 = $3 & 3;
  $16 = ($15|0)==(1);
  if ($16) {
   $17 = ((($0)) + 20|0);
   $18 = HEAP32[$17>>2]|0;
   $19 = ($18|0)==(0);
   if (!($19)) {
    $20 = (($18) + -1)|0;
    HEAP32[$17>>2] = $20;
    $$0 = 0;
    return ($$0|0);
   }
  }
  $21 = ($6|0)==(0);
  $22 = ((($0)) + 16|0);
  if ($21) {
   $23 = ((($8)) + 176|0);
   Atomics_store(HEAP32,$23>>2,$22)|0;
   ___vm_lock();
  }
  $24 = ((($0)) + 12|0);
  $25 = HEAP32[$24>>2]|0;
  $26 = HEAP32[$22>>2]|0;
  Atomics_store(HEAP32,$25>>2,$26)|0;
  $27 = ((($8)) + 168|0);
  $28 = ($26|0)==($27|0);
  if ($28) {
   $$045 = $8;$$pre$phiZ2D = $9;
  } else {
   $29 = ((($26)) + -4|0);
   Atomics_store(HEAP32,$29>>2,$25)|0;
   $$045 = $8;$$pre$phiZ2D = $9;
  }
 }
 $30 = $3 & 8;
 $31 = ($30|0)!=(0);
 $32 = $31 ? 2147483647 : 0;
 while(1) {
  $33 = (Atomics_load(HEAP32, $$pre$phiZ2D>>2)|0);
  $34 = (Atomics_compareExchange(HEAP32, $$pre$phiZ2D>>2, $33, $32)|0);
  $35 = ($34|0)==($33|0);
  if ($35) {
   break;
  }
 }
 $36 = ($6|0)!=(0);
 $or$cond = $7 | $36;
 if (!($or$cond)) {
  $37 = ((($$045)) + 176|0);
  Atomics_store(HEAP32,$37>>2,0)|0;
  ___vm_unlock();
 }
 $38 = ($2|0)!=(0);
 $39 = ($33|0)<(0);
 $or$cond3 = $38 | $39;
 if (!($or$cond3)) {
  $$0 = 0;
  return ($$0|0);
 }
 (_emscripten_futex_wake(($$pre$phiZ2D|0),1)|0);
 $$0 = 0;
 return ($$0|0);
}
function ___vm_lock() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (Atomics_add(HEAP32, 2260, 1)|0);
 return;
}
function ___vm_unlock() {
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (Atomics_add(HEAP32, 2260, -1)|0);
 $1 = ($0|0)==(1);
 if (!($1)) {
  return;
 }
 $2 = (Atomics_load(HEAP32,(9044)>>2)|0);
 $3 = ($2|0)==(0);
 if ($3) {
  return;
 }
 (_emscripten_futex_wake((9040|0),2147483647)|0);
 return;
}
function ___pthread_mutex_lock($0) {
 $0 = $0|0;
 var $$0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = $1 & 15;
 $3 = ($2|0)==(0);
 if ($3) {
  $4 = ((($0)) + 4|0);
  $5 = (Atomics_compareExchange(HEAP32, $4>>2, 0, 16)|0);
  $6 = ($5|0)==(0);
  if ($6) {
   $$0 = 0;
   return ($$0|0);
  }
 }
 $7 = (___pthread_mutex_timedlock($0,0)|0);
 $$0 = $7;
 return ($$0|0);
}
function ___pthread_mutex_timedlock($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $$2 = 0, $$pre = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0;
 var $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0;
 var $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond40 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = HEAP32[$0>>2]|0;
 $3 = $2 & 15;
 $4 = ($3|0)==(0);
 do {
  if ($4) {
   $5 = ((($0)) + 4|0);
   $6 = (Atomics_compareExchange(HEAP32, $5>>2, 0, 16)|0);
   $7 = ($6|0)==(0);
   if ($7) {
    $$2 = 0;
    return ($$2|0);
   } else {
    $$pre = HEAP32[$0>>2]|0;
    $9 = $$pre;
    break;
   }
  } else {
   $9 = $2;
  }
 } while(0);
 $8 = $9 & 128;
 $10 = $8 ^ 128;
 $11 = (___pthread_mutex_trylock($0)|0);
 $12 = ($11|0)==(16);
 if (!($12)) {
  $$2 = $11;
  return ($$2|0);
 }
 $13 = ((($0)) + 4|0);
 $14 = ((($0)) + 8|0);
 $$0 = 100;
 while(1) {
  $15 = (($$0) + -1)|0;
  $16 = ($$0|0)==(0);
  if ($16) {
   break;
  }
  $17 = (Atomics_load(HEAP32,$13>>2)|0);
  $18 = ($17|0)==(0);
  if ($18) {
   break;
  }
  $19 = (Atomics_load(HEAP32,$14>>2)|0);
  $20 = ($19|0)==(0);
  if ($20) {
   $$0 = $15;
  } else {
   break;
  }
 }
 $21 = (___pthread_mutex_trylock($0)|0);
 $22 = ($21|0)==(16);
 if (!($22)) {
  $$2 = $21;
  return ($$2|0);
 }
 L18: while(1) {
  $23 = (Atomics_load(HEAP32,$13>>2)|0);
  $24 = ($23|0)==(0);
  if (!($24)) {
   $27 = $23 & 1073741824;
   $28 = ($27|0)==(0);
   $29 = HEAP32[$0>>2]|0;
   $30 = $29 & 4;
   $31 = ($30|0)==(0);
   $or$cond40 = $28 | $31;
   if ($or$cond40) {
    $32 = $29 & 3;
    $33 = ($32|0)==(2);
    if ($33) {
     $34 = $23 & 2147483647;
     $35 = (_pthread_self()|0);
     $36 = ((($35)) + 52|0);
     $37 = HEAP32[$36>>2]|0;
     $38 = ($34|0)==($37|0);
     if ($38) {
      $$2 = 35;
      label = 17;
      break;
     }
    }
    $39 = (Atomics_add(HEAP32, $14>>2, 1)|0);
    $40 = $23 | -2147483648;
    $41 = (Atomics_compareExchange(HEAP32, $13>>2, $23, $40)|0);
    $42 = (___timedwait($13,$40,0,$1,$10)|0);
    $43 = (Atomics_sub(HEAP32, $14>>2, 1)|0);
    switch ($42|0) {
    case 0: case 4:  {
     break;
    }
    default: {
     $$2 = $42;
     label = 17;
     break L18;
    }
    }
   }
  }
  $25 = (___pthread_mutex_trylock($0)|0);
  $26 = ($25|0)==(16);
  if (!($26)) {
   $$2 = $25;
   label = 17;
   break;
  }
 }
 if ((label|0) == 17) {
  return ($$2|0);
 }
 return (0)|0;
}
function ___timedwait($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $5 = sp;
 (___pthread_setcancelstate(1,$5)|0);
 _emscripten_conditional_set_current_thread_status(1,4);
 $6 = (___timedwait_cp($0,$1,$2,$3,$4)|0);
 _emscripten_conditional_set_current_thread_status(4,1);
 $7 = HEAP32[$5>>2]|0;
 (___pthread_setcancelstate($7,0)|0);
 STACKTOP = sp;return ($6|0);
}
function ___pthread_setcancelstate($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $$pre = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0>>>0)>(2);
 if ($2) {
  $$0 = 22;
  return ($$0|0);
 }
 $3 = (_pthread_self()|0);
 $4 = ($1|0)==(0|0);
 $$pre = ((($3)) + 72|0);
 if (!($4)) {
  $5 = (Atomics_load(HEAP32,$$pre>>2)|0);
  HEAP32[$1>>2] = $5;
 }
 Atomics_store(HEAP32,$$pre>>2,$0)|0;
 $$0 = 0;
 return ($$0|0);
}
function ___timedwait_cp($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $$$0$us = 0.0, $$$045 = 0.0, $$$046$us = 0.0, $$0$us = 0.0, $$0$us53 = 0.0, $$138 = 0, $$138$ph = 0, $$138$ph70 = 0, $$138$ph72 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0;
 var $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0.0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0.0, $39 = 0, $40 = 0;
 var $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $5 = sp;
 $6 = ($3|0)!=(0|0);
 if ($6) {
  $7 = ((($3)) + 4|0);
  $8 = HEAP32[$7>>2]|0;
  $9 = ($8>>>0)>(999999999);
  if ($9) {
   $$138 = 22;
   STACKTOP = sp;return ($$138|0);
  }
  $10 = (___clock_gettime(($2|0),($5|0))|0);
  $11 = ($10|0)==(0);
  if (!($11)) {
   $$138 = 22;
   STACKTOP = sp;return ($$138|0);
  }
  $12 = HEAP32[$3>>2]|0;
  $13 = HEAP32[$5>>2]|0;
  $14 = (($12) - ($13))|0;
  HEAP32[$5>>2] = $14;
  $15 = HEAP32[$7>>2]|0;
  $16 = ((($5)) + 4|0);
  $17 = HEAP32[$16>>2]|0;
  $18 = (($15) - ($17))|0;
  HEAP32[$16>>2] = $18;
  $19 = ($18|0)<(0);
  if ($19) {
   $20 = (($14) + -1)|0;
   HEAP32[$5>>2] = $20;
   $21 = (($18) + 1000000000)|0;
   HEAP32[$16>>2] = $21;
   $23 = $20;
  } else {
   $23 = $14;
  }
  $22 = ($23|0)<(0);
  if ($22) {
   $$138 = 110;
   STACKTOP = sp;return ($$138|0);
  }
 }
 $24 = (_emscripten_is_main_runtime_thread()|0);
 $25 = ($24|0)!=(0);
 $$$045 = $25 ? 1.0 : 100.0;
 if ($25) {
  L15: while(1) {
   $26 = (_pthread_self()|0);
   $27 = (__pthread_isduecanceled($26)|0);
   $28 = ($27|0)==(0);
   if (!($28)) {
    $$138$ph = 125;
    break;
   }
   _emscripten_main_thread_process_queued_calls();
   if ($6) {
    $29 = (+__pthread_msecs_until($3));
    $30 = !($29 <= 0.0);
    $31 = $29 > 100.0;
    $$0$us = $31 ? 100.0 : $29;
    $32 = $$0$us > 1.0;
    $$$0$us = $32 ? 1.0 : $$0$us;
    if ($30) {
     $$$046$us = $$$0$us;
    } else {
     $$138$ph = 110;
     break;
    }
   } else {
    $$$046$us = $$$045;
   }
   $33 = (_emscripten_futex_wait(($0|0),($1|0),(+$$$046$us))|0);
   $34 = (0 - ($33))|0;
   switch ($34|0) {
   case 110:  {
    break;
   }
   case 4: case 125:  {
    $$138$ph = $34;
    break L15;
    break;
   }
   default: {
    $$138 = 0;
    label = 21;
    break L15;
   }
   }
  }
  if ((label|0) == 21) {
   STACKTOP = sp;return ($$138|0);
  }
  $$138 = $$138$ph;
  STACKTOP = sp;return ($$138|0);
 }
 if (!($6)) {
  L27: while(1) {
   $43 = (_pthread_self()|0);
   $44 = (__pthread_isduecanceled($43)|0);
   $45 = ($44|0)==(0);
   if (!($45)) {
    $$138$ph72 = 125;
    break;
   }
   $46 = (_emscripten_futex_wait(($0|0),($1|0),(+$$$045))|0);
   $47 = (0 - ($46))|0;
   switch ($47|0) {
   case 110:  {
    break;
   }
   case 4: case 125:  {
    $$138$ph72 = $47;
    break L27;
    break;
   }
   default: {
    $$138 = 0;
    label = 21;
    break L27;
   }
   }
  }
  if ((label|0) == 21) {
   STACKTOP = sp;return ($$138|0);
  }
  $$138 = $$138$ph72;
  STACKTOP = sp;return ($$138|0);
 }
 L34: while(1) {
  $35 = (_pthread_self()|0);
  $36 = (__pthread_isduecanceled($35)|0);
  $37 = ($36|0)==(0);
  if (!($37)) {
   $$138$ph70 = 125;
   break;
  }
  $38 = (+__pthread_msecs_until($3));
  $39 = !($38 <= 0.0);
  if (!($39)) {
   $$138$ph70 = 110;
   break;
  }
  $40 = $38 > 100.0;
  $$0$us53 = $40 ? 100.0 : $38;
  $41 = (_emscripten_futex_wait(($0|0),($1|0),(+$$0$us53))|0);
  $42 = (0 - ($41))|0;
  switch ($42|0) {
  case 110:  {
   break;
  }
  case 4: case 125:  {
   $$138$ph70 = $42;
   break L34;
   break;
  }
  default: {
   $$138 = 0;
   label = 21;
   break L34;
  }
  }
 }
 if ((label|0) == 21) {
  STACKTOP = sp;return ($$138|0);
 }
 $$138 = $$138$ph70;
 STACKTOP = sp;return ($$138|0);
}
function __pthread_isduecanceled($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(2);
 $3 = $2&1;
 return ($3|0);
}
function __pthread_msecs_until($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $11 = 0.0, $12 = 0.0, $13 = 0, $14 = 0, $15 = 0.0, $16 = 0.0, $17 = 0.0, $18 = 0.0, $2 = 0, $3 = 0.0, $4 = 0.0, $5 = 0, $6 = 0, $7 = 0.0, $8 = 0.0, $9 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = sp;
 (_gettimeofday(($1|0),(0|0))|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = (+($2|0));
 $4 = $3 * 1000.0;
 $5 = ((($1)) + 4|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = (+($6|0));
 $8 = $7 * 0.001;
 $9 = $4 + $8;
 $10 = HEAP32[$0>>2]|0;
 $11 = (+($10|0));
 $12 = $11 * 1000.0;
 $13 = ((($0)) + 4|0);
 $14 = HEAP32[$13>>2]|0;
 $15 = (+($14|0));
 $16 = $15 * 9.9999999999999995E-7;
 $17 = $12 + $16;
 $18 = $17 - $9;
 STACKTOP = sp;return (+$18);
}
function ___pthread_mutex_trylock($0) {
 $0 = $0|0;
 var $$0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = $1 & 15;
 $3 = ($2|0)==(0);
 if ($3) {
  $4 = ((($0)) + 4|0);
  $5 = (Atomics_compareExchange(HEAP32, $4>>2, 0, 16)|0);
  $6 = $5 & 16;
  $$0 = $6;
  return ($$0|0);
 } else {
  $7 = (___pthread_mutex_trylock_owner($0)|0);
  $$0 = $7;
  return ($$0|0);
 }
 return (0)|0;
}
function ___pthread_mutex_trylock_owner($0) {
 $0 = $0|0;
 var $$ = 0, $$1 = 0, $$154 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0;
 var $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0;
 var $43 = 0, $44 = 0, $45 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, $or$cond57 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = (_pthread_self()|0);
 $3 = ((($2)) + 52|0);
 $4 = HEAP32[$3>>2]|0;
 $5 = ((($0)) + 4|0);
 $6 = (Atomics_load(HEAP32,$5>>2)|0);
 $7 = $6 & 2147483647;
 $8 = ($7|0)==($4|0);
 $9 = $1 & 3;
 $10 = ($9|0)==(1);
 $or$cond = $10 & $8;
 if ($or$cond) {
  $11 = ((($0)) + 20|0);
  $12 = HEAP32[$11>>2]|0;
  $13 = ($12>>>0)>(2147483646);
  if ($13) {
   $$1 = 11;
   return ($$1|0);
  }
  $14 = (($12) + 1)|0;
  HEAP32[$11>>2] = $14;
  $$1 = 0;
  return ($$1|0);
 }
 $15 = ($7|0)==(2147483647);
 if ($15) {
  $$1 = 131;
  return ($$1|0);
 }
 $16 = HEAP32[$0>>2]|0;
 $17 = $16 & 128;
 $18 = ($17|0)==(0);
 if ($18) {
  $$154 = $4;
 } else {
  $19 = ((($2)) + 172|0);
  $20 = HEAP32[$19>>2]|0;
  $21 = ($20|0)==(0);
  if ($21) {
   HEAP32[$19>>2] = -12;
  }
  $22 = ((($0)) + 8|0);
  $23 = (Atomics_load(HEAP32,$22>>2)|0);
  $24 = ($23|0)==(0);
  $25 = $4 | -2147483648;
  $$ = $24 ? $4 : $25;
  $26 = ((($0)) + 16|0);
  $27 = ((($2)) + 176|0);
  Atomics_store(HEAP32,$27>>2,$26)|0;
  $$154 = $$;
 }
 $28 = ($7|0)!=(0);
 if ($28) {
  $29 = $6 & 1073741824;
  $30 = ($29|0)==(0);
  $31 = $1 & 4;
  $32 = ($31|0)==(0);
  $or$cond57 = $32 | $30;
  if (!($or$cond57)) {
   label = 11;
  }
 } else {
  label = 11;
 }
 if ((label|0) == 11) {
  $33 = (Atomics_compareExchange(HEAP32, $5>>2, $6, $$154)|0);
  $34 = ($33|0)==($6|0);
  if ($34) {
   $36 = ((($2)) + 168|0);
   $37 = (Atomics_load(HEAP32,$36>>2)|0);
   $38 = ((($0)) + 16|0);
   HEAP32[$38>>2] = $37;
   $39 = ((($0)) + 12|0);
   HEAP32[$39>>2] = $36;
   $40 = ($37|0)==($36|0);
   if (!($40)) {
    $41 = ((($37)) + -4|0);
    Atomics_store(HEAP32,$41>>2,$38)|0;
   }
   Atomics_store(HEAP32,$36>>2,$38)|0;
   $42 = ((($2)) + 176|0);
   Atomics_store(HEAP32,$42>>2,0)|0;
   if (!($28)) {
    $$1 = 0;
    return ($$1|0);
   }
   $43 = ((($0)) + 20|0);
   HEAP32[$43>>2] = 0;
   $44 = HEAP32[$0>>2]|0;
   $45 = $44 | 8;
   HEAP32[$0>>2] = $45;
   $$1 = 130;
   return ($$1|0);
  }
 }
 $35 = ((($2)) + 176|0);
 Atomics_store(HEAP32,$35>>2,0)|0;
 $$1 = 16;
 return ($$1|0);
}
function _pthread_cond_broadcast($0) {
 $0 = $0|0;
 var $$0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(0|0);
 if ($2) {
  $3 = (___private_cond_signal($0,-1)|0);
  $$0 = $3;
  return ($$0|0);
 }
 $4 = ((($0)) + 12|0);
 $5 = (Atomics_load(HEAP32,$4>>2)|0);
 $6 = ($5|0)==(0);
 if ($6) {
  $$0 = 0;
  return ($$0|0);
 }
 $7 = ((($0)) + 8|0);
 $8 = (Atomics_add(HEAP32, $7>>2, 1)|0);
 (_emscripten_futex_wake(($7|0),2147483647)|0);
 $$0 = 0;
 return ($$0|0);
}
function ___private_cond_signal($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$024$lcssa = 0, $$02432 = 0, $$026 = 0, $$026$$024 = 0, $$026$lcssa = 0, $$02631 = 0, $$02634 = 0, $$033 = 0, $$1 = 0, $$125 = 0, $$lcssa30 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0;
 var $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0;
 var $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $2 = sp;
 Atomics_store(HEAP32,$2>>2,0)|0;
 $3 = ((($0)) + 32|0);
 $4 = (Atomics_compareExchange(HEAP32, $3>>2, 0, 1)|0);
 $5 = ($4|0)==(0);
 if (!($5)) {
  $6 = (Atomics_compareExchange(HEAP32, $3>>2, 1, 2)|0);
  while(1) {
   ___wait($3,0,2,1);
   $7 = (Atomics_compareExchange(HEAP32, $3>>2, 0, 2)|0);
   $8 = ($7|0)==(0);
   if ($8) {
    break;
   }
  }
 }
 $9 = ((($0)) + 20|0);
 $$02631 = HEAP32[$9>>2]|0;
 $10 = ($1|0)!=(0);
 $11 = ($$02631|0)!=(0|0);
 $12 = $10 & $11;
 if ($12) {
  $$02432 = 0;$$02634 = $$02631;$$033 = $1;
  while(1) {
   $13 = ((($$02634)) + 8|0);
   $14 = (Atomics_compareExchange(HEAP32, $13>>2, 0, 1)|0);
   $15 = ($14|0)==(0);
   if ($15) {
    $19 = (($$033) + -1)|0;
    $20 = ($$02432|0)==(0|0);
    $$026$$024 = $20 ? $$02634 : $$02432;
    $$1 = $19;$$125 = $$026$$024;
   } else {
    $16 = (Atomics_load(HEAP32,$2>>2)|0);
    $17 = (($16) + 1)|0;
    Atomics_store(HEAP32,$2>>2,$17)|0;
    $18 = ((($$02634)) + 16|0);
    HEAP32[$18>>2] = $2;
    $$1 = $$033;$$125 = $$02432;
   }
   $$026 = HEAP32[$$02634>>2]|0;
   $21 = ($$1|0)!=(0);
   $22 = ($$026|0)!=(0|0);
   $23 = $21 & $22;
   if ($23) {
    $$02432 = $$125;$$02634 = $$026;$$033 = $$1;
   } else {
    $$024$lcssa = $$125;$$026$lcssa = $$026;$$lcssa30 = $22;
    break;
   }
  }
 } else {
  $$024$lcssa = 0;$$026$lcssa = $$02631;$$lcssa30 = $11;
 }
 if ($$lcssa30) {
  $24 = ((($$026$lcssa)) + 4|0);
  $25 = HEAP32[$24>>2]|0;
  $26 = ($25|0)==(0|0);
  if (!($26)) {
   HEAP32[$25>>2] = 0;
  }
  HEAP32[$24>>2] = 0;
 } else {
  $27 = ((($0)) + 4|0);
  HEAP32[$27>>2] = 0;
 }
 HEAP32[$9>>2] = $$026$lcssa;
 while(1) {
  $28 = (Atomics_load(HEAP32, $3>>2)|0);
  $29 = (Atomics_compareExchange(HEAP32, $3>>2, $28, 0)|0);
  $30 = ($29|0)==($28|0);
  if ($30) {
   break;
  }
 }
 $31 = ($28|0)==(2);
 if ($31) {
  (_emscripten_futex_wake(($3|0),1)|0);
 }
 $32 = (Atomics_load(HEAP32,$2>>2)|0);
 $33 = ($32|0)==(0);
 if (!($33)) {
  $34 = $32;
  while(1) {
   ___wait($2,0,$34,1);
   $35 = (Atomics_load(HEAP32,$2>>2)|0);
   $36 = ($35|0)==(0);
   if ($36) {
    break;
   } else {
    $34 = $35;
   }
  }
 }
 $37 = ($$024$lcssa|0)==(0|0);
 if ($37) {
  STACKTOP = sp;return 0;
 }
 $38 = ((($$024$lcssa)) + 12|0);
 while(1) {
  $39 = (Atomics_load(HEAP32, $38>>2)|0);
  $40 = (Atomics_compareExchange(HEAP32, $38>>2, $39, 0)|0);
  $41 = ($40|0)==($39|0);
  if ($41) {
   break;
  }
 }
 $42 = ($39|0)==(2);
 if (!($42)) {
  STACKTOP = sp;return 0;
 }
 (_emscripten_futex_wake(($38|0),1)|0);
 STACKTOP = sp;return 0;
}
function ___wait($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $$0 = 0, $$0$us = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0.0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0;
 var $28 = 0, $29 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $5 = 0, $6 = 0;
 var $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $4 = ($1|0)!=(0|0);
 L1: do {
  if ($4) {
   $$0$us = 100;
   while(1) {
    $5 = (($$0$us) + -1)|0;
    $6 = ($$0$us|0)==(0);
    if ($6) {
     label = 7;
     break L1;
    }
    $7 = (Atomics_load(HEAP32,$1>>2)|0);
    $8 = ($7|0)==(0);
    if (!($8)) {
     label = 8;
     break L1;
    }
    $9 = (Atomics_load(HEAP32,$0>>2)|0);
    $10 = ($9|0)==($2|0);
    if ($10) {
     $$0$us = $5;
    } else {
     break;
    }
   }
   return;
  } else {
   $$0 = 100;
   while(1) {
    $11 = ($$0|0)==(0);
    if ($11) {
     label = 7;
     break L1;
    }
    $12 = (($$0) + -1)|0;
    $13 = (Atomics_load(HEAP32,$0>>2)|0);
    $14 = ($13|0)==($2|0);
    if ($14) {
     $$0 = $12;
    } else {
     break;
    }
   }
   return;
  }
 } while(0);
 if ((label|0) == 7) {
  if ($4) {
   label = 8;
  }
 }
 if ((label|0) == 8) {
  $15 = (Atomics_add(HEAP32, $1>>2, 1)|0);
 }
 $16 = (_emscripten_is_main_runtime_thread()|0);
 $17 = (Atomics_load(HEAP32,$0>>2)|0);
 $18 = ($17|0)==($2|0);
 L16: do {
  if ($18) {
   $19 = ($16|0)!=(0);
   $20 = $19 ? 1.0 : 100.0;
   L18: do {
    if ($19) {
     while(1) {
      $21 = (_pthread_self()|0);
      $22 = ((($21)) + 76|0);
      $23 = (Atomics_load(HEAP32,$22>>2)|0);
      $24 = ($23|0)==(1);
      if ($24) {
       while(1) {
        $27 = (_pthread_self()|0);
        $28 = (__pthread_isduecanceled($27)|0);
        $29 = ($28|0)==(0);
        if (!($29)) {
         break L18;
        }
        _emscripten_main_thread_process_queued_calls();
        $30 = (_emscripten_futex_wait(($0|0),($2|0),(+$20))|0);
        $31 = ($30|0)==(-110);
        if (!($31)) {
         break;
        }
       }
      } else {
       (_emscripten_futex_wait(($0|0),($2|0),inf)|0);
      }
      $25 = (Atomics_load(HEAP32,$0>>2)|0);
      $26 = ($25|0)==($2|0);
      if (!($26)) {
       break L16;
      }
     }
    } else {
     while(1) {
      $32 = (_pthread_self()|0);
      $33 = ((($32)) + 76|0);
      $34 = (Atomics_load(HEAP32,$33>>2)|0);
      $35 = ($34|0)==(1);
      if ($35) {
       while(1) {
        $36 = (_pthread_self()|0);
        $37 = (__pthread_isduecanceled($36)|0);
        $38 = ($37|0)==(0);
        if (!($38)) {
         break L18;
        }
        $40 = (_emscripten_futex_wait(($0|0),($2|0),(+$20))|0);
        $41 = ($40|0)==(-110);
        if (!($41)) {
         break;
        }
       }
      } else {
       (_emscripten_futex_wait(($0|0),($2|0),inf)|0);
      }
      $42 = (Atomics_load(HEAP32,$0>>2)|0);
      $43 = ($42|0)==($2|0);
      if (!($43)) {
       break L16;
      }
     }
    }
   } while(0);
   if (!($4)) {
    return;
   }
   $39 = (Atomics_sub(HEAP32, $1>>2, 1)|0);
   return;
  }
 } while(0);
 if (!($4)) {
  return;
 }
 $44 = (Atomics_sub(HEAP32, $1>>2, 1)|0);
 return;
}
function _pthread_cond_destroy($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(0|0);
 if ($2) {
  return 0;
 }
 $3 = ((($0)) + 12|0);
 $4 = (Atomics_load(HEAP32,$3>>2)|0);
 $5 = ($4|0)==(0);
 if ($5) {
  return 0;
 }
 $6 = (Atomics_or(HEAP32, $3>>2, -2147483648)|0);
 $7 = ((($0)) + 8|0);
 $8 = (Atomics_add(HEAP32, $7>>2, 1)|0);
 (_emscripten_futex_wake(($7|0),2147483647)|0);
 $9 = (Atomics_load(HEAP32,$3>>2)|0);
 $10 = $9 & 2147483647;
 $11 = ($10|0)==(0);
 if ($11) {
  return 0;
 } else {
  $12 = $9;
 }
 while(1) {
  ___wait($3,0,$12,0);
  $13 = (Atomics_load(HEAP32,$3>>2)|0);
  $14 = $13 & 2147483647;
  $15 = ($14|0)==(0);
  if ($15) {
   break;
  } else {
   $12 = $13;
  }
 }
 return 0;
}
function ___pthread_cond_timedwait($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$ = 0, $$$ = 0, $$$2$ = 0, $$0 = 0, $$062 = 0, $$063 = 0, $$064 = 0, $$066 = 0, $$1 = 0, $$2 = 0, $$2$ = 0, $$472 = 0, $$sink = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0;
 var $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0;
 var $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0;
 var $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0;
 var $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0;
 var $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0;
 var $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $or$cond = 0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 32|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(32|0);
 $3 = sp + 4|0;
 $4 = sp;
 ;HEAP32[$3>>2]=0|0;HEAP32[$3+4>>2]=0|0;HEAP32[$3+8>>2]=0|0;HEAP32[$3+12>>2]=0|0;HEAP32[$3+16>>2]=0|0;
 $5 = ((($0)) + 16|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = HEAP32[$1>>2]|0;
 $8 = $7 & 15;
 $9 = ($8|0)==(0);
 if (!($9)) {
  $10 = ((($1)) + 4|0);
  $11 = (Atomics_load(HEAP32,$10>>2)|0);
  $12 = $11 & 2147483647;
  $13 = (_pthread_self()|0);
  $14 = ((($13)) + 52|0);
  $15 = HEAP32[$14>>2]|0;
  $16 = ($12|0)==($15|0);
  if (!($16)) {
   $$062 = 1;
   STACKTOP = sp;return ($$062|0);
  }
 }
 $17 = ($2|0)==(0|0);
 if (!($17)) {
  $18 = ((($2)) + 4|0);
  $19 = HEAP32[$18>>2]|0;
  $20 = ($19>>>0)>(999999999);
  if ($20) {
   $$062 = 22;
   STACKTOP = sp;return ($$062|0);
  }
 }
 ___pthread_testcancel();
 $21 = HEAP32[$0>>2]|0;
 $22 = ($21|0)==(0|0);
 if ($22) {
  $27 = ((($0)) + 32|0);
  $28 = (Atomics_compareExchange(HEAP32, $27>>2, 0, 1)|0);
  $29 = ($28|0)==(0);
  if (!($29)) {
   $30 = (Atomics_compareExchange(HEAP32, $27>>2, 1, 2)|0);
   while(1) {
    ___wait($27,0,2,1);
    $31 = (Atomics_compareExchange(HEAP32, $27>>2, 0, 2)|0);
    $32 = ($31|0)==(0);
    if ($32) {
     break;
    }
   }
  }
  $33 = ((($3)) + 12|0);
  Atomics_store(HEAP32,$33>>2,2)|0;
  $34 = ((($3)) + 8|0);
  Atomics_store(HEAP32,$34>>2,0)|0;
  $35 = ((($0)) + 4|0);
  $36 = HEAP32[$35>>2]|0;
  $37 = ((($3)) + 4|0);
  HEAP32[$37>>2] = $36;
  HEAP32[$35>>2] = $3;
  $38 = ((($0)) + 20|0);
  $39 = HEAP32[$38>>2]|0;
  $40 = ($39|0)==(0|0);
  $41 = $36;
  $$sink = $40 ? $38 : $41;
  HEAP32[$$sink>>2] = $3;
  while(1) {
   $42 = (Atomics_load(HEAP32, $27>>2)|0);
   $43 = (Atomics_compareExchange(HEAP32, $27>>2, $42, 0)|0);
   $44 = ($43|0)==($42|0);
   if ($44) {
    break;
   }
  }
  $45 = ($42|0)==(2);
  if ($45) {
   (_emscripten_futex_wake(($27|0),1)|0);
   $$0 = $33;$$064 = 0;$$066 = 2;
  } else {
   $$0 = $33;$$064 = 0;$$066 = 2;
  }
 } else {
  $23 = ((($0)) + 8|0);
  $24 = (Atomics_load(HEAP32,$23>>2)|0);
  $25 = ((($0)) + 12|0);
  $26 = (Atomics_add(HEAP32, $25>>2, 1)|0);
  $$0 = $23;$$064 = 1;$$066 = $24;
 }
 (___pthread_mutex_unlock($1)|0);
 (___pthread_setcancelstate(2,$4)|0);
 $46 = HEAP32[$4>>2]|0;
 $47 = ($46|0)==(1);
 if ($47) {
  (___pthread_setcancelstate(1,0)|0);
 }
 $48 = ($$064|0)!=(0);
 $49 = $48 ^ 1;
 $50 = $49&1;
 while(1) {
  $51 = (___timedwait_cp($$0,$$066,$6,$2,$50)|0);
  $52 = (Atomics_load(HEAP32,$$0>>2)|0);
  $53 = ($52|0)==($$066|0);
  $54 = $51 | 4;
  $55 = ($54|0)==(4);
  $or$cond = $53 & $55;
  if (!($or$cond)) {
   break;
  }
 }
 $56 = ($51|0)==(4);
 $$ = $56 ? 0 : $51;
 L28: do {
  if ($48) {
   $57 = ($$|0)==(125);
   if ($57) {
    $58 = ((($0)) + 8|0);
    $59 = (Atomics_load(HEAP32,$58>>2)|0);
    $60 = ($59|0)==($$066|0);
    $$$ = $60 ? 125 : 0;
    $$1 = $$$;
   } else {
    $$1 = $$;
   }
   $61 = ((($0)) + 12|0);
   $62 = (Atomics_add(HEAP32, $61>>2, -1)|0);
   $63 = ($62|0)==(-2147483647);
   if ($63) {
    (_emscripten_futex_wake(($61|0),1)|0);
    $$063 = 0;$$2 = $$1;
   } else {
    $$063 = 0;$$2 = $$1;
   }
  } else {
   $64 = ((($3)) + 8|0);
   $65 = (Atomics_compareExchange(HEAP32, $64>>2, 0, 2)|0);
   $66 = ($65|0)==(0);
   if (!($66)) {
    $101 = ((($3)) + 12|0);
    $102 = (Atomics_compareExchange(HEAP32, $101>>2, 0, 1)|0);
    $103 = ($102|0)==(0);
    if ($103) {
     $$063 = $65;$$2 = $$;
     break;
    }
    $104 = (Atomics_compareExchange(HEAP32, $101>>2, 1, 2)|0);
    while(1) {
     ___wait($101,0,2,1);
     $105 = (Atomics_compareExchange(HEAP32, $101>>2, 0, 2)|0);
     $106 = ($105|0)==(0);
     if ($106) {
      $$063 = $65;$$2 = $$;
      break L28;
     }
    }
   }
   $67 = ((($0)) + 32|0);
   $68 = (Atomics_compareExchange(HEAP32, $67>>2, 0, 1)|0);
   $69 = ($68|0)==(0);
   if (!($69)) {
    $70 = (Atomics_compareExchange(HEAP32, $67>>2, 1, 2)|0);
    while(1) {
     ___wait($67,0,2,1);
     $71 = (Atomics_compareExchange(HEAP32, $67>>2, 0, 2)|0);
     $72 = ($71|0)==(0);
     if ($72) {
      break;
     }
    }
   }
   $73 = ((($0)) + 4|0);
   $74 = HEAP32[$73>>2]|0;
   $75 = ($74|0)==($3|0);
   if ($75) {
    $76 = ((($3)) + 4|0);
    $77 = HEAP32[$76>>2]|0;
    HEAP32[$73>>2] = $77;
   } else {
    $78 = HEAP32[$3>>2]|0;
    $79 = ($78|0)==(0|0);
    if (!($79)) {
     $80 = ((($3)) + 4|0);
     $81 = HEAP32[$80>>2]|0;
     $82 = ((($78)) + 4|0);
     HEAP32[$82>>2] = $81;
    }
   }
   $83 = ((($0)) + 20|0);
   $84 = HEAP32[$83>>2]|0;
   $85 = ($84|0)==($3|0);
   if ($85) {
    $86 = HEAP32[$3>>2]|0;
    HEAP32[$83>>2] = $86;
   } else {
    $87 = ((($3)) + 4|0);
    $88 = HEAP32[$87>>2]|0;
    $89 = ($88|0)==(0|0);
    if (!($89)) {
     $90 = HEAP32[$3>>2]|0;
     HEAP32[$88>>2] = $90;
    }
   }
   while(1) {
    $91 = (Atomics_load(HEAP32, $67>>2)|0);
    $92 = (Atomics_compareExchange(HEAP32, $67>>2, $91, 0)|0);
    $93 = ($92|0)==($91|0);
    if ($93) {
     break;
    }
   }
   $94 = ($91|0)==(2);
   if ($94) {
    (_emscripten_futex_wake(($67|0),1)|0);
   }
   $95 = ((($3)) + 16|0);
   $96 = HEAP32[$95>>2]|0;
   $97 = ($96|0)==(0|0);
   if ($97) {
    $$063 = 0;$$2 = $$;
   } else {
    $98 = (Atomics_add(HEAP32, $96>>2, -1)|0);
    $99 = ($98|0)==(1);
    if ($99) {
     $100 = HEAP32[$95>>2]|0;
     (_emscripten_futex_wake(($100|0),1)|0);
     $$063 = 0;$$2 = $$;
    } else {
     $$063 = 0;$$2 = $$;
    }
   }
  }
 } while(0);
 $107 = (___pthread_mutex_lock($1)|0);
 $108 = ($107|0)==(0);
 $$2$ = $108 ? $$2 : $107;
 $109 = ($$063|0)==(0);
 if ($109) {
  $127 = HEAP32[$4>>2]|0;
  (___pthread_setcancelstate($127,0)|0);
  $128 = ($$2$|0)==(125);
  if ($128) {
   ___pthread_testcancel();
   (___pthread_setcancelstate(1,0)|0);
   $$472 = 125;
  } else {
   $$472 = $$2$;
  }
 } else {
  $110 = ((($3)) + 4|0);
  $111 = HEAP32[$110>>2]|0;
  $112 = ($111|0)==(0|0);
  if ($112) {
   $113 = ((($1)) + 8|0);
   $114 = (Atomics_add(HEAP32, $113>>2, 1)|0);
  }
  $115 = HEAP32[$3>>2]|0;
  $116 = ($115|0)==(0|0);
  if ($116) {
   $123 = ((($1)) + 8|0);
   $124 = (Atomics_sub(HEAP32, $123>>2, 1)|0);
  } else {
   $117 = ((($115)) + 12|0);
   $118 = ((($1)) + 4|0);
   $119 = (Atomics_store(HEAP32, $117>>2, 0)|0);
   while(1) {
    $120 = (Atomics_load(HEAP32,$117>>2)|0);
    $121 = (_emscripten_futex_wake_or_requeue(($117|0),0,($118|0),($120|0))|0);
    $122 = ($121|0)==(-11);
    if (!($122)) {
     break;
    }
   }
  }
  $125 = ($$2$|0)==(125);
  $$$2$ = $125 ? 0 : $$2$;
  $126 = HEAP32[$4>>2]|0;
  (___pthread_setcancelstate($126,0)|0);
  $$472 = $$$2$;
 }
 ___pthread_testcancel();
 $$062 = $$472;
 STACKTOP = sp;return ($$062|0);
}
function ___pthread_testcancel() {
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_pthread_self()|0);
 $1 = ((($0)) + 72|0);
 $2 = (Atomics_load(HEAP32,$1>>2)|0);
 $3 = ($2|0)==(0);
 if (!($3)) {
  return;
 }
 $4 = HEAP32[$0>>2]|0;
 $5 = ($4|0)==(2);
 if (!($5)) {
  return;
 }
 $6 = _emscripten_asm_const_i(3)|0;
 return;
}
function ___pthread_once_full($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 L1: while(1) {
  $2 = (Atomics_compareExchange(HEAP32, $0>>2, 0, 1)|0);
  switch ($2|0) {
  case 0:  {
   break L1;
   break;
  }
  case 2:  {
   label = 9;
   break L1;
   break;
  }
  case 1:  {
   $7 = (Atomics_compareExchange(HEAP32, $0>>2, 1, 3)|0);
   break;
  }
  case 3:  {
   break;
  }
  default: {
   continue L1;
  }
  }
  ___wait($0,0,3,1);
 }
 if ((label|0) == 9) {
  return 0;
 }
 _pthread_cleanup_push((73|0),($0|0));
 FUNCTION_TABLE_v[$1 & 127]();
 _pthread_cleanup_pop(0);
 while(1) {
  $3 = (Atomics_load(HEAP32, $0>>2)|0);
  $4 = (Atomics_compareExchange(HEAP32, $0>>2, $3, 2)|0);
  $5 = ($4|0)==($3|0);
  if ($5) {
   break;
  }
 }
 $6 = ($3|0)==(3);
 if (!($6)) {
  return 0;
 }
 (_emscripten_futex_wake(($0|0),2147483647)|0);
 return 0;
}
function _undo($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 while(1) {
  $1 = (Atomics_load(HEAP32, $0>>2)|0);
  $2 = (Atomics_compareExchange(HEAP32, $0>>2, $1, 0)|0);
  $3 = ($2|0)==($1|0);
  if ($3) {
   break;
  }
 }
 $4 = ($1|0)==(3);
 if (!($4)) {
  return;
 }
 (_emscripten_futex_wake(($0|0),2147483647)|0);
 return;
}
function ___pthread_once($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $2 = sp;
 $3 = (Atomics_load(HEAP32,$0>>2)|0);
 $4 = ($3|0)==(2);
 if ($4) {
  Atomics_store(HEAP32,$2>>2,0)|0;
  $5 = (Atomics_compareExchange(HEAP32, $2>>2, 0, 0)|0);
  STACKTOP = sp;return 0;
 } else {
  (___pthread_once_full($0,$1)|0);
  STACKTOP = sp;return 0;
 }
 return (0)|0;
}
function _pthread_cond_wait($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = (___pthread_cond_timedwait($0,$1,0)|0);
 return ($2|0);
}
function ___pthread_key_create($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $$013 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $2 = sp;
 HEAP32[$2>>2] = $0;
 $3 = $2;
 $4 = $3 >>> 4;
 $5 = $4 & 127;
 $6 = (_pthread_self()|0);
 $7 = ((($6)) + 116|0);
 $8 = HEAP32[$7>>2]|0;
 $9 = ($8|0)==(0|0);
 if ($9) {
  HEAP32[$7>>2] = 7968;
 }
 $10 = ($1|0)==(0|0);
 $11 = $1;
 $12 = $10 ? (74) : $11;
 $$013 = $5;
 while(1) {
  $13 = (10072 + ($$013<<2)|0);
  $14 = (Atomics_compareExchange(HEAP32, $13>>2, 0, $12)|0);
  $15 = ($14|0)==(0);
  if ($15) {
   break;
  }
  $17 = (($$013) + 1)|0;
  $18 = $17 & 127;
  $19 = ($18|0)==($5|0);
  if ($19) {
   $$0 = 11;
   label = 7;
   break;
  } else {
   $$013 = $18;
  }
 }
 if ((label|0) == 7) {
  STACKTOP = sp;return ($$0|0);
 }
 $16 = HEAP32[$2>>2]|0;
 HEAP32[$16>>2] = $$013;
 $$0 = 0;
 STACKTOP = sp;return ($$0|0);
}
function _nodtor($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function _pthread_mutexattr_destroy($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 0;
}
function _pthread_mutexattr_init($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 HEAP32[$0>>2] = 0;
 return 0;
}
function _pthread_mutex_destroy($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 0;
}
function _pthread_mutex_init($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$sroa$0 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 32|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(32|0);
 $$sroa$0 = sp;
 ;HEAP32[$$sroa$0>>2]=0|0;HEAP32[$$sroa$0+4>>2]=0|0;HEAP32[$$sroa$0+8>>2]=0|0;HEAP32[$$sroa$0+12>>2]=0|0;HEAP32[$$sroa$0+16>>2]=0|0;HEAP32[$$sroa$0+20>>2]=0|0;HEAP32[$$sroa$0+24>>2]=0|0;
 ;HEAP32[$0>>2]=HEAP32[$$sroa$0>>2]|0;HEAP32[$0+4>>2]=HEAP32[$$sroa$0+4>>2]|0;HEAP32[$0+8>>2]=HEAP32[$$sroa$0+8>>2]|0;HEAP32[$0+12>>2]=HEAP32[$$sroa$0+12>>2]|0;HEAP32[$0+16>>2]=HEAP32[$$sroa$0+16>>2]|0;HEAP32[$0+20>>2]=HEAP32[$$sroa$0+20>>2]|0;HEAP32[$0+24>>2]=HEAP32[$$sroa$0+24>>2]|0;
 $2 = ($1|0)==(0|0);
 if ($2) {
  STACKTOP = sp;return 0;
 }
 $3 = HEAP32[$1>>2]|0;
 HEAP32[$0>>2] = $3;
 STACKTOP = sp;return 0;
}
function _pthread_setspecific($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = (_pthread_self()|0);
 $3 = ((($2)) + 116|0);
 $4 = HEAP32[$3>>2]|0;
 $5 = (($4) + ($0<<2)|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = ($6|0)==($1|0);
 if ($7) {
  return 0;
 }
 HEAP32[$5>>2] = $1;
 $8 = ((($2)) + 60|0);
 HEAP32[$8>>2] = 1;
 return 0;
}
function _nanosleep($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0 = 0, $10 = 0.0, $11 = 0.0, $12 = 0.0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0.0, $9 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0|0);
 if ($2) {
  $$0 = 22;
  return ($$0|0);
 }
 $3 = ((($0)) + 4|0);
 $4 = HEAP32[$3>>2]|0;
 $5 = ($4>>>0)>(999999999);
 if ($5) {
  $$0 = 22;
  return ($$0|0);
 }
 $6 = HEAP32[$0>>2]|0;
 $7 = ($6|0)<(0);
 if ($7) {
  $$0 = 22;
  return ($$0|0);
 }
 $8 = (+($6|0));
 $9 = $8 * 1000.0;
 $10 = (+($4|0));
 $11 = $10 / 1.0E+6;
 $12 = $11 + $9;
 _do_sleep($12);
 $$0 = 0;
 return ($$0|0);
}
function _do_sleep($0) {
 $0 = +$0;
 var $$$0$us = 0.0, $$0 = 0.0, $$0$us = 0.0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0.0, $14 = 0.0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0.0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0;
 var $25 = 0, $26 = 0.0, $27 = 0.0, $28 = 0, $29 = 0, $3 = 0.0, $30 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (_emscripten_is_main_runtime_thread()|0);
 $2 = (+_emscripten_get_now());
 $3 = $2 + $0;
 _emscripten_conditional_set_current_thread_status(1,2);
 $4 = $2 < $3;
 if (!($4)) {
  _emscripten_conditional_set_current_thread_status(2,1);
  return;
 }
 $5 = ($1|0)==(0);
 if ($5) {
  while(1) {
   $19 = (_pthread_self()|0);
   $20 = ((($19)) + 72|0);
   $21 = (Atomics_load(HEAP32,$20>>2)|0);
   $22 = ($21|0)==(0);
   if ($22) {
    $23 = HEAP32[$19>>2]|0;
    $24 = ($23|0)==(2);
    if ($24) {
     $25 = _emscripten_asm_const_i(3)|0;
    }
   }
   $26 = (+_emscripten_get_now());
   $27 = $3 - $26;
   $28 = $27 > 1.0;
   if ($28) {
    $29 = $27 > 100.0;
    $$0 = $29 ? 100.0 : $27;
    (_emscripten_futex_wait((10584|0),0,(+$$0))|0);
   }
   $30 = $26 < $3;
   if (!($30)) {
    break;
   }
  }
  _emscripten_conditional_set_current_thread_status(2,1);
  return;
 } else {
  while(1) {
   _emscripten_main_thread_process_queued_calls();
   $6 = (_pthread_self()|0);
   $7 = ((($6)) + 72|0);
   $8 = (Atomics_load(HEAP32,$7>>2)|0);
   $9 = ($8|0)==(0);
   if ($9) {
    $10 = HEAP32[$6>>2]|0;
    $11 = ($10|0)==(2);
    if ($11) {
     $12 = _emscripten_asm_const_i(3)|0;
    }
   }
   $13 = (+_emscripten_get_now());
   $14 = $3 - $13;
   $15 = $14 > 1.0;
   $16 = $14 > 100.0;
   $$0$us = $16 ? 100.0 : $14;
   if ($15) {
    $17 = $$0$us > 1.0;
    $$$0$us = $17 ? 1.0 : $$0$us;
    (_emscripten_futex_wait((10584|0),0,(+$$$0$us))|0);
   }
   $18 = $13 < $3;
   if (!($18)) {
    break;
   }
  }
  _emscripten_conditional_set_current_thread_status(2,1);
  return;
 }
}
function ___pthread_getspecific($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (_pthread_self()|0);
 $2 = ((($1)) + 116|0);
 $3 = HEAP32[$2>>2]|0;
 $4 = (($3) + ($0<<2)|0);
 $5 = HEAP32[$4>>2]|0;
 return ($5|0);
}
function __ZNSt3__218condition_variableD2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 __THREW__ = 0;
 (invoke_ii(75,($0|0))|0);
 $1 = __THREW__; __THREW__ = 0;
 $2 = $1&1;
 if ($2) {
  $3 = ___cxa_find_matching_catch_3(0|0)|0;
  $4 = tempRet0;
  ___clang_call_terminate($3);
  // unreachable;
 } else {
  return;
 }
}
function __ZNSt3__218condition_variable10notify_allEv($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 __THREW__ = 0;
 (invoke_ii(76,($0|0))|0);
 $1 = __THREW__; __THREW__ = 0;
 $2 = $1&1;
 if ($2) {
  $3 = ___cxa_find_matching_catch_3(0|0)|0;
  $4 = tempRet0;
  ___clang_call_terminate($3);
  // unreachable;
 } else {
  return;
 }
}
function __ZNSt3__218condition_variable4waitERNS_11unique_lockINS_5mutexEEE($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ((($1)) + 4|0);
 $3 = HEAP8[$2>>0]|0;
 $4 = ($3<<24>>24)==(0);
 if ($4) {
  __THREW__ = 0;
  invoke_vii(64,1,(5824|0));
  $5 = __THREW__; __THREW__ = 0;
 } else {
  $6 = HEAP32[$1>>2]|0;
  __THREW__ = 0;
  $7 = (invoke_iii(77,($0|0),($6|0))|0);
  $8 = __THREW__; __THREW__ = 0;
  $9 = $8&1;
  if (!($9)) {
   $10 = ($7|0)==(0);
   if ($10) {
    return;
   } else {
    __THREW__ = 0;
    invoke_vii(64,($7|0),(5867|0));
    $11 = __THREW__; __THREW__ = 0;
    $12 = ___cxa_find_matching_catch_3(0|0)|0;
    $13 = tempRet0;
    ___clang_call_terminate($12);
    // unreachable;
   }
  }
 }
 $14 = ___cxa_find_matching_catch_3(0|0)|0;
 $15 = tempRet0;
 ___clang_call_terminate($14);
 // unreachable;
}
function __ZNSt3__25mutexD2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 __THREW__ = 0;
 $1 = __THREW__; __THREW__ = 0;
 $2 = $1&1;
 if ($2) {
  $3 = ___cxa_find_matching_catch_3(0|0)|0;
  $4 = tempRet0;
  ___clang_call_terminate($3);
  // unreachable;
 } else {
  return;
 }
}
function __ZNSt3__25mutex4lockEv($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (___pthread_mutex_lock($0)|0);
 $2 = ($1|0)==(0);
 if ($2) {
  return;
 } else {
  __ZNSt3__220__throw_system_errorEiPKc($1,5898);
  // unreachable;
 }
}
function __ZNSt3__25mutex6unlockEv($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 __THREW__ = 0;
 $1 = (invoke_ii(78,($0|0))|0);
 $2 = __THREW__; __THREW__ = 0;
 $3 = $2&1;
 if ($3) {
  $8 = ___cxa_find_matching_catch_3(0|0)|0;
  $9 = tempRet0;
  ___clang_call_terminate($8);
  // unreachable;
 }
 $4 = ($1|0)==(0);
 if ($4) {
  return;
 } else {
  __THREW__ = 0;
  invoke_viiii(79,(5916|0),(5924|0),48,(6008|0));
  $5 = __THREW__; __THREW__ = 0;
  $6 = ___cxa_find_matching_catch_3(0|0)|0;
  $7 = tempRet0;
  ___clang_call_terminate($6);
  // unreachable;
 }
}
function __Znwj($0) {
 $0 = $0|0;
 var $$ = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ($0|0)==(0);
 $$ = $1 ? 1 : $0;
 while(1) {
  $2 = (_malloc($$)|0);
  $3 = ($2|0)==(0|0);
  if (!($3)) {
   label = 6;
   break;
  }
  $4 = (__ZSt15get_new_handlerv()|0);
  $5 = ($4|0)==(0|0);
  if ($5) {
   label = 5;
   break;
  }
  FUNCTION_TABLE_v[$4 & 127]();
 }
 if ((label|0) == 5) {
  $6 = (___cxa_allocate_exception(4)|0);
  __ZNSt9bad_allocC2Ev($6);
  ___cxa_throw(($6|0),(344|0),(33|0));
  // unreachable;
 }
 else if ((label|0) == 6) {
  return ($2|0);
 }
 return (0)|0;
}
function __ZdlPv($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 _free($0);
 return;
}
function __ZNSt3__218__libcpp_refstringC2EPKc($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = (_strlen($1)|0);
 $3 = (($2) + 13)|0;
 $4 = (__Znwj($3)|0);
 HEAP32[$4>>2] = $2;
 $5 = ((($4)) + 4|0);
 HEAP32[$5>>2] = $2;
 $6 = ((($4)) + 8|0);
 HEAP32[$6>>2] = 0;
 $7 = (__ZNSt3__215__refstring_imp12_GLOBAL__N_113data_from_repEPNS1_9_Rep_baseE($4)|0);
 $8 = (($2) + 1)|0;
 _memcpy(($7|0),($1|0),($8|0))|0;
 HEAP32[$0>>2] = $7;
 return;
}
function __ZNSt3__215__refstring_imp12_GLOBAL__N_113data_from_repEPNS1_9_Rep_baseE($0) {
 $0 = $0|0;
 var $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + 12|0);
 return ($1|0);
}
function __ZNSt11logic_errorC2EPKc($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAP32[$0>>2] = (1176);
 $2 = ((($0)) + 4|0);
 __THREW__ = 0;
 invoke_vii(80,($2|0),($1|0));
 $3 = __THREW__; __THREW__ = 0;
 $4 = $3&1;
 if ($4) {
  $5 = ___cxa_find_matching_catch_2()|0;
  $6 = tempRet0;
  ___resumeException($5|0);
  // unreachable;
 } else {
  return;
 }
}
function __ZNKSt3__218__libcpp_refstring15__uses_refcountEv($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 1;
}
function __ZNSt13runtime_errorC2ERKNSt3__212basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAP32[$0>>2] = (1196);
 $2 = ((($0)) + 4|0);
 $3 = ((($1)) + 11|0);
 $4 = HEAP8[$3>>0]|0;
 $5 = ($4<<24>>24)<(0);
 $6 = HEAP32[$1>>2]|0;
 $7 = $5 ? $6 : $1;
 __THREW__ = 0;
 invoke_vii(80,($2|0),($7|0));
 $8 = __THREW__; __THREW__ = 0;
 $9 = $8&1;
 if ($9) {
  $10 = ___cxa_find_matching_catch_2()|0;
  $11 = tempRet0;
  ___resumeException($10|0);
  // unreachable;
 } else {
  return;
 }
}
function __ZNKSt3__221__basic_string_commonILb1EE20__throw_length_errorEv($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (___cxa_allocate_exception(8)|0);
 __THREW__ = 0;
 invoke_vii(66,($1|0),(6015|0));
 $2 = __THREW__; __THREW__ = 0;
 $3 = $2&1;
 if ($3) {
  $4 = ___cxa_find_matching_catch_2()|0;
  $5 = tempRet0;
  ___cxa_free_exception(($1|0));
  ___resumeException($4|0);
  // unreachable;
 } else {
  HEAP32[$1>>2] = (1216);
  ___cxa_throw(($1|0),(392|0),(36|0));
  // unreachable;
 }
}
function __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEEC2ERKS5_($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0$i = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $2 = sp;
 ;HEAP32[$0>>2]=0|0;HEAP32[$0+4>>2]=0|0;HEAP32[$0+8>>2]=0|0;
 $3 = ((($1)) + 11|0);
 $4 = HEAP8[$3>>0]|0;
 $5 = ($4<<24>>24)<(0);
 if ($5) {
  $6 = HEAP32[$1>>2]|0;
  $7 = ((($1)) + 4|0);
  $8 = HEAP32[$7>>2]|0;
  $9 = ($8>>>0)>(4294967279);
  if ($9) {
   __ZNKSt3__221__basic_string_commonILb1EE20__throw_length_errorEv($0);
   // unreachable;
  }
  $10 = ($8>>>0)<(11);
  if ($10) {
   $11 = $8&255;
   $12 = ((($0)) + 11|0);
   HEAP8[$12>>0] = $11;
   $$0$i = $0;
  } else {
   $13 = (($8) + 16)|0;
   $14 = $13 & -16;
   $15 = (__Znwj($14)|0);
   HEAP32[$0>>2] = $15;
   $16 = $14 | -2147483648;
   $17 = ((($0)) + 8|0);
   HEAP32[$17>>2] = $16;
   $18 = ((($0)) + 4|0);
   HEAP32[$18>>2] = $8;
   $$0$i = $15;
  }
  (__ZNSt3__211char_traitsIcE4copyEPcPKcj($$0$i,$6,$8)|0);
  $19 = (($$0$i) + ($8)|0);
  HEAP8[$2>>0] = 0;
  __ZNSt3__211char_traitsIcE6assignERcRKc($19,$2);
 } else {
  ;HEAP32[$0>>2]=HEAP32[$1>>2]|0;HEAP32[$0+4>>2]=HEAP32[$1+4>>2]|0;HEAP32[$0+8>>2]=HEAP32[$1+8>>2]|0;
 }
 STACKTOP = sp;return;
}
function __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + 11|0);
 $2 = HEAP8[$1>>0]|0;
 $3 = ($2<<24>>24)<(0);
 if ($3) {
  $4 = HEAP32[$0>>2]|0;
  __ZdlPv($4);
 }
 return;
}
function __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE21__grow_by_and_replaceEjjjjjjPKc($0,$1,$2,$3,$4,$5,$6,$7) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 $5 = $5|0;
 $6 = $6|0;
 $7 = $7|0;
 var $$sroa$speculated = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $40 = 0, $8 = 0, $9 = 0, $phitmp = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $8 = sp;
 $9 = (-18 - ($1))|0;
 $10 = ($9>>>0)<($2>>>0);
 if ($10) {
  __ZNKSt3__221__basic_string_commonILb1EE20__throw_length_errorEv($0);
  // unreachable;
 }
 $11 = ((($0)) + 11|0);
 $12 = HEAP8[$11>>0]|0;
 $13 = ($12<<24>>24)<(0);
 if ($13) {
  $14 = HEAP32[$0>>2]|0;
  $25 = $14;
 } else {
  $25 = $0;
 }
 $15 = ($1>>>0)<(2147483623);
 if ($15) {
  $16 = (($2) + ($1))|0;
  $17 = $1 << 1;
  $18 = ($16>>>0)<($17>>>0);
  $$sroa$speculated = $18 ? $17 : $16;
  $19 = ($$sroa$speculated>>>0)<(11);
  $20 = (($$sroa$speculated) + 16)|0;
  $21 = $20 & -16;
  $phitmp = $19 ? 11 : $21;
  $22 = $phitmp;
 } else {
  $22 = -17;
 }
 $23 = (__Znwj($22)|0);
 $24 = ($4|0)==(0);
 if (!($24)) {
  (__ZNSt3__211char_traitsIcE4copyEPcPKcj($23,$25,$4)|0);
 }
 $26 = ($6|0)==(0);
 if (!($26)) {
  $27 = (($23) + ($4)|0);
  (__ZNSt3__211char_traitsIcE4copyEPcPKcj($27,$7,$6)|0);
 }
 $28 = (($3) - ($5))|0;
 $29 = (($28) - ($4))|0;
 $30 = ($29|0)==(0);
 if (!($30)) {
  $31 = (($23) + ($4)|0);
  $32 = (($31) + ($6)|0);
  $33 = (($25) + ($4)|0);
  $34 = (($33) + ($5)|0);
  (__ZNSt3__211char_traitsIcE4copyEPcPKcj($32,$34,$29)|0);
 }
 $35 = ($1|0)==(10);
 if (!($35)) {
  __ZdlPv($25);
 }
 HEAP32[$0>>2] = $23;
 $36 = $22 | -2147483648;
 $37 = ((($0)) + 8|0);
 HEAP32[$37>>2] = $36;
 $38 = (($28) + ($6))|0;
 $39 = ((($0)) + 4|0);
 HEAP32[$39>>2] = $38;
 $40 = (($23) + ($38)|0);
 HEAP8[$8>>0] = 0;
 __ZNSt3__211char_traitsIcE6assignERcRKc($40,$8);
 STACKTOP = sp;return;
}
function __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6appendEPKcj($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $3 = 0, $4 = 0;
 var $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $phitmp$i = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $3 = sp;
 $4 = ((($0)) + 11|0);
 $5 = HEAP8[$4>>0]|0;
 $6 = ($5<<24>>24)<(0);
 if ($6) {
  $7 = ((($0)) + 8|0);
  $8 = HEAP32[$7>>2]|0;
  $9 = $8 & 2147483647;
  $phitmp$i = (($9) + -1)|0;
  $10 = ((($0)) + 4|0);
  $11 = HEAP32[$10>>2]|0;
  $14 = $phitmp$i;$15 = $11;
 } else {
  $12 = $5&255;
  $14 = 10;$15 = $12;
 }
 $13 = (($14) - ($15))|0;
 $16 = ($13>>>0)<($2>>>0);
 $17 = (($15) + ($2))|0;
 if ($16) {
  $27 = (($17) - ($14))|0;
  __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE21__grow_by_and_replaceEjjjjjjPKc($0,$14,$27,$15,$15,0,$2,$1);
 } else {
  $18 = ($2|0)==(0);
  if (!($18)) {
   if ($6) {
    $19 = HEAP32[$0>>2]|0;
    $21 = $19;
   } else {
    $21 = $0;
   }
   $20 = (($21) + ($15)|0);
   (__ZNSt3__211char_traitsIcE4copyEPcPKcj($20,$1,$2)|0);
   $22 = HEAP8[$4>>0]|0;
   $23 = ($22<<24>>24)<(0);
   if ($23) {
    $24 = ((($0)) + 4|0);
    HEAP32[$24>>2] = $17;
   } else {
    $25 = $17&255;
    HEAP8[$4>>0] = $25;
   }
   $26 = (($21) + ($17)|0);
   HEAP8[$3>>0] = 0;
   __ZNSt3__211char_traitsIcE6assignERcRKc($26,$3);
  }
 }
 STACKTOP = sp;return ($0|0);
}
function __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6appendEPKc($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = (__ZNSt3__211char_traitsIcE6lengthEPKc($1)|0);
 $3 = (__ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6appendEPKcj($0,$1,$2)|0);
 return ($3|0);
}
function __ZNSt3__214error_categoryD2Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNSt3__224__generic_error_categoryD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZdlPv($0);
 return;
}
function __ZNKSt3__224__generic_error_category4nameEv($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (6205|0);
}
function __ZNKSt3__214error_category23default_error_conditionEi($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAP32[$0>>2] = $2;
 $3 = ((($0)) + 4|0);
 HEAP32[$3>>2] = $1;
 return;
}
function __ZNKSt3__214error_category10equivalentEiRKNS_15error_conditionE($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $3 = sp;
 $4 = HEAP32[$0>>2]|0;
 $5 = ((($4)) + 12|0);
 $6 = HEAP32[$5>>2]|0;
 FUNCTION_TABLE_viii[$6 & 127]($3,$0,$1);
 $7 = ((($3)) + 4|0);
 $8 = HEAP32[$7>>2]|0;
 $9 = ((($2)) + 4|0);
 $10 = HEAP32[$9>>2]|0;
 $11 = ($8|0)==($10|0);
 if ($11) {
  $12 = HEAP32[$3>>2]|0;
  $13 = HEAP32[$2>>2]|0;
  $14 = ($12|0)==($13|0);
  $15 = $14;
 } else {
  $15 = 0;
 }
 STACKTOP = sp;return ($15|0);
}
function __ZNKSt3__214error_category10equivalentERKNS_10error_codeEi($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = ((($1)) + 4|0);
 $4 = HEAP32[$3>>2]|0;
 $5 = ($4|0)==($0|0);
 $6 = HEAP32[$1>>2]|0;
 $7 = ($6|0)==($2|0);
 $8 = $5 & $7;
 return ($8|0);
}
function __ZNKSt3__224__generic_error_category7messageEi($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$0$i$i = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $3 = sp;
 $4 = ($2|0)>(256);
 if ($4) {
  ;HEAP32[$0>>2]=0|0;HEAP32[$0+4>>2]=0|0;HEAP32[$0+8>>2]=0|0;
  $5 = (__ZNSt3__211char_traitsIcE6lengthEPKc(6028)|0);
  $6 = ($5>>>0)>(4294967279);
  if ($6) {
   __ZNKSt3__221__basic_string_commonILb1EE20__throw_length_errorEv($0);
   // unreachable;
  }
  $7 = ($5>>>0)<(11);
  if ($7) {
   $8 = $5&255;
   $9 = ((($0)) + 11|0);
   HEAP8[$9>>0] = $8;
   $$0$i$i = $0;
  } else {
   $10 = (($5) + 16)|0;
   $11 = $10 & -16;
   $12 = (__Znwj($11)|0);
   HEAP32[$0>>2] = $12;
   $13 = $11 | -2147483648;
   $14 = ((($0)) + 8|0);
   HEAP32[$14>>2] = $13;
   $15 = ((($0)) + 4|0);
   HEAP32[$15>>2] = $5;
   $$0$i$i = $12;
  }
  (__ZNSt3__211char_traitsIcE4copyEPcPKcj($$0$i$i,6028,$5)|0);
  $16 = (($$0$i$i) + ($5)|0);
  HEAP8[$3>>0] = 0;
  __ZNSt3__211char_traitsIcE6assignERcRKc($16,$3);
 } else {
  __ZNKSt3__212__do_message7messageEi($0,0,$2);
 }
 STACKTOP = sp;return;
}
function __ZNKSt3__212__do_message7messageEi($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZNSt3__212_GLOBAL__N_113do_strerror_rEi($0,$2);
 return;
}
function __ZNSt3__212_GLOBAL__N_113do_strerror_rEi($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$0$i$i = 0, $$0$i$i12 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $vararg_buffer = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 1040|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(1040|0);
 $vararg_buffer = sp;
 $2 = sp + 1033|0;
 $3 = sp + 1032|0;
 $4 = sp + 8|0;
 $5 = (___errno_location()|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = (_strerror_r($1,$4,1024)|0);
 switch ($7|0) {
 case 0:  {
  ;HEAP32[$0>>2]=0|0;HEAP32[$0+4>>2]=0|0;HEAP32[$0+8>>2]=0|0;
  $24 = (__ZNSt3__211char_traitsIcE6lengthEPKc($4)|0);
  $25 = ($24>>>0)>(4294967279);
  if ($25) {
   __ZNKSt3__221__basic_string_commonILb1EE20__throw_length_errorEv($0);
   // unreachable;
  }
  $26 = ($24>>>0)<(11);
  if ($26) {
   $27 = $24&255;
   $28 = ((($0)) + 11|0);
   HEAP8[$28>>0] = $27;
   $$0$i$i12 = $0;
  } else {
   $29 = (($24) + 16)|0;
   $30 = $29 & -16;
   $31 = (__Znwj($30)|0);
   HEAP32[$0>>2] = $31;
   $32 = $30 | -2147483648;
   $33 = ((($0)) + 8|0);
   HEAP32[$33>>2] = $32;
   $34 = ((($0)) + 4|0);
   HEAP32[$34>>2] = $24;
   $$0$i$i12 = $31;
  }
  (__ZNSt3__211char_traitsIcE4copyEPcPKcj($$0$i$i12,$4,$24)|0);
  $35 = (($$0$i$i12) + ($24)|0);
  HEAP8[$2>>0] = 0;
  __ZNSt3__211char_traitsIcE6assignERcRKc($35,$2);
  break;
 }
 case -1:  {
  $8 = (___errno_location()|0);
  $9 = HEAP32[$8>>2]|0;
  $11 = $9;
  label = 3;
  break;
 }
 default: {
  $11 = $7;
  label = 3;
 }
 }
 L11: do {
  if ((label|0) == 3) {
   $10 = (___errno_location()|0);
   HEAP32[$10>>2] = $6;
   switch ($11|0) {
   case 22:  {
    HEAP32[$vararg_buffer>>2] = $1;
    (_snprintf($4,1024,6063,$vararg_buffer)|0);
    ;HEAP32[$0>>2]=0|0;HEAP32[$0+4>>2]=0|0;HEAP32[$0+8>>2]=0|0;
    $12 = (__ZNSt3__211char_traitsIcE6lengthEPKc($4)|0);
    $13 = ($12>>>0)>(4294967279);
    if ($13) {
     __ZNKSt3__221__basic_string_commonILb1EE20__throw_length_errorEv($0);
     // unreachable;
    }
    $14 = ($12>>>0)<(11);
    if ($14) {
     $15 = $12&255;
     $16 = ((($0)) + 11|0);
     HEAP8[$16>>0] = $15;
     $$0$i$i = $0;
    } else {
     $17 = (($12) + 16)|0;
     $18 = $17 & -16;
     $19 = (__Znwj($18)|0);
     HEAP32[$0>>2] = $19;
     $20 = $18 | -2147483648;
     $21 = ((($0)) + 8|0);
     HEAP32[$21>>2] = $20;
     $22 = ((($0)) + 4|0);
     HEAP32[$22>>2] = $12;
     $$0$i$i = $19;
    }
    (__ZNSt3__211char_traitsIcE4copyEPcPKcj($$0$i$i,$4,$12)|0);
    $23 = (($$0$i$i) + ($12)|0);
    HEAP8[$3>>0] = 0;
    __ZNSt3__211char_traitsIcE6assignERcRKc($23,$3);
    break L11;
    break;
   }
   case 34:  {
    _abort();
    // unreachable;
    break;
   }
   default: {
    ___assert_fail((6080|0),(6100|0),99,(6191|0));
    // unreachable;
   }
   }
  }
 } while(0);
 STACKTOP = sp;return;
}
function __ZNSt3__223__system_error_categoryD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZdlPv($0);
 return;
}
function __ZNKSt3__223__system_error_category4nameEv($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (6330|0);
}
function __ZNKSt3__223__system_error_category23default_error_conditionEi($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$sink = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = ($2|0)>(256);
 if ($3) {
  (__ZNSt3__215system_categoryEv()|0);
  $$sink = 1036;
 } else {
  (__ZNSt3__216generic_categoryEv()|0);
  $$sink = 1032;
 }
 HEAP32[$0>>2] = $2;
 $4 = ((($0)) + 4|0);
 HEAP32[$4>>2] = $$sink;
 return;
}
function __ZNKSt3__223__system_error_category7messageEi($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$0$i$i = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $3 = sp;
 $4 = ($2|0)>(256);
 if ($4) {
  ;HEAP32[$0>>2]=0|0;HEAP32[$0+4>>2]=0|0;HEAP32[$0+8>>2]=0|0;
  $5 = (__ZNSt3__211char_traitsIcE6lengthEPKc(6296)|0);
  $6 = ($5>>>0)>(4294967279);
  if ($6) {
   __ZNKSt3__221__basic_string_commonILb1EE20__throw_length_errorEv($0);
   // unreachable;
  }
  $7 = ($5>>>0)<(11);
  if ($7) {
   $8 = $5&255;
   $9 = ((($0)) + 11|0);
   HEAP8[$9>>0] = $8;
   $$0$i$i = $0;
  } else {
   $10 = (($5) + 16)|0;
   $11 = $10 & -16;
   $12 = (__Znwj($11)|0);
   HEAP32[$0>>2] = $12;
   $13 = $11 | -2147483648;
   $14 = ((($0)) + 8|0);
   HEAP32[$14>>2] = $13;
   $15 = ((($0)) + 4|0);
   HEAP32[$15>>2] = $5;
   $$0$i$i = $12;
  }
  (__ZNSt3__211char_traitsIcE4copyEPcPKcj($$0$i$i,6296,$5)|0);
  $16 = (($$0$i$i) + ($5)|0);
  HEAP8[$3>>0] = 0;
  __ZNSt3__211char_traitsIcE6assignERcRKc($16,$3);
 } else {
  __ZNKSt3__212__do_message7messageEi($0,0,$2);
 }
 STACKTOP = sp;return;
}
function __ZNSt3__215system_categoryEv() {
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP8[7224]|0;
 $1 = ($0<<24>>24)==(0);
 if ($1) {
  $2 = (___cxa_guard_acquire(7224)|0);
  $3 = ($2|0)==(0);
  if (!($3)) {
  }
 }
 return (1036|0);
}
function __ZNSt3__216generic_categoryEv() {
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP8[7216]|0;
 $1 = ($0<<24>>24)==(0);
 if ($1) {
  $2 = (___cxa_guard_acquire(7216)|0);
  $3 = ($2|0)==(0);
  if (!($3)) {
  }
 }
 return (1032|0);
}
function __ZNSt3__212system_errorD2Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZNSt13runtime_errorD2Ev($0);
 return;
}
function __ZNSt3__212system_errorD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZNSt3__212system_errorD2Ev($0);
 __ZdlPv($0);
 return;
}
function __ZNKSt3__210error_code7messageEv($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ((($1)) + 4|0);
 $3 = HEAP32[$2>>2]|0;
 $4 = HEAP32[$3>>2]|0;
 $5 = ((($4)) + 24|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = HEAP32[$1>>2]|0;
 FUNCTION_TABLE_viii[$6 & 127]($0,$3,$7);
 return;
}
function __ZNSt3__212system_error6__initERKNS_10error_codeENS_12basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEEE($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$0$i$i = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $exitcond$i$i = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $3 = sp;
 $4 = HEAP32[$1>>2]|0;
 $5 = ($4|0)==(0);
 do {
  if (!($5)) {
   $6 = ((($2)) + 11|0);
   $7 = HEAP8[$6>>0]|0;
   $8 = ($7<<24>>24)<(0);
   if ($8) {
    $9 = ((($2)) + 4|0);
    $10 = HEAP32[$9>>2]|0;
    $13 = $10;
   } else {
    $11 = $7&255;
    $13 = $11;
   }
   $12 = ($13|0)==(0);
   if (!($12)) {
    (__ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6appendEPKc($2,6394)|0);
   }
   __ZNKSt3__210error_code7messageEv($3,$1);
   $14 = ((($3)) + 11|0);
   $15 = HEAP8[$14>>0]|0;
   $16 = ($15<<24>>24)<(0);
   $17 = HEAP32[$3>>2]|0;
   $18 = $16 ? $17 : $3;
   $19 = ((($3)) + 4|0);
   $20 = HEAP32[$19>>2]|0;
   $21 = $15&255;
   $22 = $16 ? $20 : $21;
   __THREW__ = 0;
   (invoke_iiii(81,($2|0),($18|0),($22|0))|0);
   $23 = __THREW__; __THREW__ = 0;
   $24 = $23&1;
   if ($24) {
    $25 = ___cxa_find_matching_catch_2()|0;
    $26 = tempRet0;
    __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($3);
    ___resumeException($25|0);
    // unreachable;
   } else {
    __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($3);
    break;
   }
  }
 } while(0);
 ;HEAP32[$0>>2]=HEAP32[$2>>2]|0;HEAP32[$0+4>>2]=HEAP32[$2+4>>2]|0;HEAP32[$0+8>>2]=HEAP32[$2+8>>2]|0;
 $$0$i$i = 0;
 while(1) {
  $exitcond$i$i = ($$0$i$i|0)==(3);
  if ($exitcond$i$i) {
   break;
  }
  $27 = (($2) + ($$0$i$i<<2)|0);
  HEAP32[$27>>2] = 0;
  $28 = (($$0$i$i) + 1)|0;
  $$0$i$i = $28;
 }
 STACKTOP = sp;return;
}
function __ZNSt3__212system_errorC2ENS_10error_codeEPKc($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$0 = 0, $$0$i$i = 0, $$03 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 32|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(32|0);
 $3 = sp + 24|0;
 $4 = sp + 12|0;
 $5 = sp;
 ;HEAP32[$5>>2]=0|0;HEAP32[$5+4>>2]=0|0;HEAP32[$5+8>>2]=0|0;
 $6 = (__ZNSt3__211char_traitsIcE6lengthEPKc($2)|0);
 $7 = ($6>>>0)>(4294967279);
 if ($7) {
  __ZNKSt3__221__basic_string_commonILb1EE20__throw_length_errorEv($5);
  // unreachable;
 }
 $8 = ($6>>>0)<(11);
 if ($8) {
  $9 = $6&255;
  $10 = ((($5)) + 11|0);
  HEAP8[$10>>0] = $9;
  $$0$i$i = $5;
 } else {
  $11 = (($6) + 16)|0;
  $12 = $11 & -16;
  $13 = (__Znwj($12)|0);
  HEAP32[$5>>2] = $13;
  $14 = $12 | -2147483648;
  $15 = ((($5)) + 8|0);
  HEAP32[$15>>2] = $14;
  $16 = ((($5)) + 4|0);
  HEAP32[$16>>2] = $6;
  $$0$i$i = $13;
 }
 (__ZNSt3__211char_traitsIcE4copyEPcPKcj($$0$i$i,$2,$6)|0);
 $17 = (($$0$i$i) + ($6)|0);
 HEAP8[$3>>0] = 0;
 __ZNSt3__211char_traitsIcE6assignERcRKc($17,$3);
 __THREW__ = 0;
 invoke_viii(82,($4|0),($1|0),($5|0));
 $18 = __THREW__; __THREW__ = 0;
 $19 = $18&1;
 do {
  if ($19) {
   $33 = ___cxa_find_matching_catch_2()|0;
   $34 = tempRet0;
   $$0 = $34;$$03 = $33;
  } else {
   __THREW__ = 0;
   invoke_vii(83,($0|0),($4|0));
   $20 = __THREW__; __THREW__ = 0;
   $21 = $20&1;
   if ($21) {
    $35 = ___cxa_find_matching_catch_2()|0;
    $36 = tempRet0;
    __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($4);
    $$0 = $36;$$03 = $35;
    break;
   } else {
    __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($4);
    __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($5);
    HEAP32[$0>>2] = (1048);
    $22 = ((($0)) + 8|0);
    $23 = $1;
    $24 = $23;
    $25 = HEAP32[$24>>2]|0;
    $26 = (($23) + 4)|0;
    $27 = $26;
    $28 = HEAP32[$27>>2]|0;
    $29 = $22;
    $30 = $29;
    HEAP32[$30>>2] = $25;
    $31 = (($29) + 4)|0;
    $32 = $31;
    HEAP32[$32>>2] = $28;
    STACKTOP = sp;return;
   }
  }
 } while(0);
 __ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($5);
 ___resumeException($$03|0);
 // unreachable;
}
function __ZNSt3__220__throw_system_errorEiPKc($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$byval_copy = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $$byval_copy = sp + 8|0;
 $2 = sp;
 $3 = (___cxa_allocate_exception(16)|0);
 (__ZNSt3__215system_categoryEv()|0);
 HEAP32[$2>>2] = $0;
 $4 = ((($2)) + 4|0);
 HEAP32[$4>>2] = 1036;
 __THREW__ = 0;
 ;HEAP32[$$byval_copy>>2]=HEAP32[$2>>2]|0;HEAP32[$$byval_copy+4>>2]=HEAP32[$2+4>>2]|0;
 invoke_viii(84,($3|0),($$byval_copy|0),($1|0));
 $5 = __THREW__; __THREW__ = 0;
 $6 = $5&1;
 if ($6) {
  $7 = ___cxa_find_matching_catch_2()|0;
  $8 = tempRet0;
  ___cxa_free_exception(($3|0));
  ___resumeException($7|0);
  // unreachable;
 } else {
  ___cxa_throw(($3|0),(264|0),(17|0));
  // unreachable;
 }
}
function __ZNSt3__26threadD2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(0);
 if ($2) {
  return;
 } else {
  __ZSt9terminatev();
  // unreachable;
 }
}
function __ZNSt3__211this_thread9sleep_forERKNS_6chrono8durationIxNS_5ratioILx1ELx1000000000EEEEE($0) {
 $0 = $0|0;
 var $$sink = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = sp;
 $2 = $0;
 $3 = $2;
 $4 = HEAP32[$3>>2]|0;
 $5 = (($2) + 4)|0;
 $6 = $5;
 $7 = HEAP32[$6>>2]|0;
 $8 = ($7|0)>(0);
 $9 = ($4>>>0)>(0);
 $10 = ($7|0)==(0);
 $11 = $10 & $9;
 $12 = $8 | $11;
 if ($12) {
  $13 = (___udivdi3(($4|0),($7|0),1000000000,0)|0);
  $14 = tempRet0;
  $15 = ($7>>>0)<(499999999);
  $16 = ($4>>>0)<(3294967296);
  $17 = ($7|0)==(499999999);
  $18 = $17 & $16;
  $19 = $15 | $18;
  if ($19) {
   HEAP32[$1>>2] = $13;
   $20 = (___muldi3(($13|0),($14|0),-1000000000,-1)|0);
   $21 = tempRet0;
   $22 = (_i64Add(($4|0),($7|0),($20|0),($21|0))|0);
   $23 = tempRet0;
   $$sink = $22;
  } else {
   HEAP32[$1>>2] = 2147483647;
   $$sink = 999999999;
  }
  $24 = ((($1)) + 4|0);
  HEAP32[$24>>2] = $$sink;
  while(1) {
   $25 = (_nanosleep($1,$1)|0);
   $26 = ($25|0)==(-1);
   if (!($26)) {
    break;
   }
   $27 = (___errno_location()|0);
   $28 = HEAP32[$27>>2]|0;
   $29 = ($28|0)==(4);
   if (!($29)) {
    break;
   }
  }
 }
 STACKTOP = sp;return;
}
function __ZNSt3__219__thread_local_dataEv() {
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP8[7232]|0;
 $1 = ($0<<24>>24)==(0);
 do {
  if ($1) {
   $2 = (___cxa_guard_acquire(7232)|0);
   $3 = ($2|0)==(0);
   if (!($3)) {
    __THREW__ = 0;
    invoke_vi(85,(10588|0));
    $4 = __THREW__; __THREW__ = 0;
    $5 = $4&1;
    if ($5) {
     $6 = ___cxa_find_matching_catch_2()|0;
     $7 = tempRet0;
     ___resumeException($6|0);
     // unreachable;
    } else {
     break;
    }
   }
  }
 } while(0);
 return (10588|0);
}
function __ZNSt3__221__thread_specific_ptrINS_15__thread_structEEC2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (___pthread_key_create($0,86)|0);
 $2 = ($1|0)==(0);
 if ($2) {
  return;
 } else {
  __ZNSt3__220__throw_system_errorEiPKc($1,6397);
  // unreachable;
 }
}
function __ZNSt3__221__thread_specific_ptrINS_15__thread_structEE16__at_thread_exitEPv($0) {
 $0 = $0|0;
 var $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ($0|0)==(0|0);
 if (!($1)) {
  __ZNSt3__215__thread_structD2Ev($0);
  __ZdlPv($0);
 }
 return;
}
function __ZNSt3__215__thread_structD2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(0|0);
 if (!($2)) {
  __ZNSt3__219__thread_struct_impD2Ev($1);
  __ZdlPv($1);
 }
 return;
}
function __ZNSt3__219__thread_struct_impD2Ev($0) {
 $0 = $0|0;
 var $$sroa$012$0 = 0, $$sroa$04$0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0;
 var $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + 12|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = ((($0)) + 16|0);
 $4 = HEAP32[$3>>2]|0;
 $$sroa$012$0 = $2;
 while(1) {
  $5 = ($$sroa$012$0|0)==($4|0);
  if ($5) {
   break;
  }
  $9 = ((($$sroa$012$0)) + 4|0);
  $10 = HEAP32[$9>>2]|0;
  __ZNSt3__25mutex6unlockEv($10);
  $11 = HEAP32[$$sroa$012$0>>2]|0;
  __ZNSt3__218condition_variable10notify_allEv($11);
  $12 = ((($$sroa$012$0)) + 8|0);
  $$sroa$012$0 = $12;
 }
 $6 = HEAP32[$0>>2]|0;
 $7 = ((($0)) + 4|0);
 $8 = HEAP32[$7>>2]|0;
 $$sroa$04$0 = $6;
 while(1) {
  $13 = ($$sroa$04$0|0)==($8|0);
  if ($13) {
   label = 6;
   break;
  }
  $14 = HEAP32[$$sroa$04$0>>2]|0;
  __THREW__ = 0;
  invoke_vi(87,($14|0));
  $15 = __THREW__; __THREW__ = 0;
  $16 = $15&1;
  if ($16) {
   label = 9;
   break;
  }
  $17 = HEAP32[$$sroa$04$0>>2]|0;
  (__ZNSt3__214__shared_count16__release_sharedEv($17)|0);
  $18 = ((($$sroa$04$0)) + 4|0);
  $$sroa$04$0 = $18;
 }
 if ((label|0) == 6) {
  __ZNSt3__213__vector_baseINS_4pairIPNS_18condition_variableEPNS_5mutexEEENS_18__hidden_allocatorIS6_EEED2Ev($1);
  __ZNSt3__213__vector_baseIPNS_17__assoc_sub_stateENS_18__hidden_allocatorIS2_EEED2Ev($0);
  return;
 }
 else if ((label|0) == 9) {
  $19 = ___cxa_find_matching_catch_3(0|0)|0;
  $20 = tempRet0;
  __ZNSt3__213__vector_baseINS_4pairIPNS_18condition_variableEPNS_5mutexEEENS_18__hidden_allocatorIS6_EEED2Ev($1);
  __ZNSt3__213__vector_baseIPNS_17__assoc_sub_stateENS_18__hidden_allocatorIS2_EEED2Ev($0);
  ___clang_call_terminate($19);
  // unreachable;
 }
}
function __ZNSt3__213__vector_baseINS_4pairIPNS_18condition_variableEPNS_5mutexEEENS_18__hidden_allocatorIS6_EEED2Ev($0) {
 $0 = $0|0;
 var $$cast = 0, $$pre$i$i = 0, $1 = 0, $10 = 0, $11 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(0|0);
 if (!($2)) {
  $3 = ((($0)) + 4|0);
  $$pre$i$i = HEAP32[$3>>2]|0;
  $5 = $$pre$i$i;
  while(1) {
   $4 = ($5|0)==($1|0);
   if ($4) {
    break;
   }
   $6 = ((($5)) + -8|0);
   HEAP32[$3>>2] = $6;
   $5 = $6;
  }
  $7 = ((($0)) + 8|0);
  $8 = ((($0)) + 8|0);
  $9 = HEAP32[$8>>2]|0;
  $$cast = $1;
  $10 = (($9) - ($$cast))|0;
  $11 = $10 >> 3;
  __ZNSt3__218__hidden_allocatorINS_4pairIPNS_18condition_variableEPNS_5mutexEEEE10deallocateEPS6_j($7,$1,$11);
 }
 return;
}
function __ZNSt3__213__vector_baseIPNS_17__assoc_sub_stateENS_18__hidden_allocatorIS2_EEED2Ev($0) {
 $0 = $0|0;
 var $$cast = 0, $$pre$i$i = 0, $1 = 0, $10 = 0, $11 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(0|0);
 if (!($2)) {
  $3 = ((($0)) + 4|0);
  $$pre$i$i = HEAP32[$3>>2]|0;
  $5 = $$pre$i$i;
  while(1) {
   $4 = ($5|0)==($1|0);
   if ($4) {
    break;
   }
   $6 = ((($5)) + -4|0);
   HEAP32[$3>>2] = $6;
   $5 = $6;
  }
  $7 = ((($0)) + 8|0);
  $8 = ((($0)) + 8|0);
  $9 = HEAP32[$8>>2]|0;
  $$cast = $1;
  $10 = (($9) - ($$cast))|0;
  $11 = $10 >> 2;
  __ZNSt3__218__hidden_allocatorIPNS_17__assoc_sub_stateEE10deallocateEPS2_j($7,$1,$11);
 }
 return;
}
function __ZNSt3__218__hidden_allocatorIPNS_17__assoc_sub_stateEE10deallocateEPS2_j($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZdlPv($1);
 return;
}
function __ZNSt3__218__hidden_allocatorINS_4pairIPNS_18condition_variableEPNS_5mutexEEEE10deallocateEPS6_j($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZdlPv($1);
 return;
}
function __ZNSt3__215__thread_structC2Ev($0) {
 $0 = $0|0;
 var $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (__Znwj(24)|0);
 __ZNSt3__219__thread_struct_impC2Ev($1);
 HEAP32[$0>>2] = $1;
 return;
}
function __ZNSt3__219__thread_struct_impC2Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 ;HEAP32[$0>>2]=0|0;HEAP32[$0+4>>2]=0|0;HEAP32[$0+8>>2]=0|0;HEAP32[$0+12>>2]=0|0;HEAP32[$0+16>>2]=0|0;HEAP32[$0+20>>2]=0|0;
 return;
}
function __ZNSt3__217__assoc_sub_state12__make_readyEv($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + 12|0);
 __ZNSt3__25mutex4lockEv($1);
 $2 = ((($0)) + 88|0);
 $3 = HEAP32[$2>>2]|0;
 $4 = $3 | 4;
 HEAP32[$2>>2] = $4;
 $5 = ((($0)) + 40|0);
 __ZNSt3__218condition_variable10notify_allEv($5);
 __ZNSt3__25mutex6unlockEv($1);
 return;
}
function __ZNSt3__214__shared_count16__release_sharedEv($0) {
 $0 = $0|0;
 var $$0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + 4|0);
 $2 = (__ZNSt3__212_GLOBAL__N_19decrementIlEET_RS2_($1)|0);
 $3 = ($2|0)==(-1);
 if ($3) {
  $4 = HEAP32[$0>>2]|0;
  $5 = ((($4)) + 8|0);
  $6 = HEAP32[$5>>2]|0;
  FUNCTION_TABLE_vi[$6 & 127]($0);
  $$0 = 1;
 } else {
  $$0 = 0;
 }
 return ($$0|0);
}
function __ZNSt3__212_GLOBAL__N_19decrementIlEET_RS2_($0) {
 $0 = $0|0;
 var $$0$i = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (Atomics_add(HEAP32, $0>>2, -1)|0);
 $$0$i = (($1) + -1)|0;
 return ($$0$i|0);
}
function __ZL25default_terminate_handlerv() {
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $vararg_buffer = 0, $vararg_buffer10 = 0, $vararg_buffer3 = 0;
 var $vararg_buffer7 = 0, $vararg_ptr1 = 0, $vararg_ptr2 = 0, $vararg_ptr6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(48|0);
 $vararg_buffer10 = sp + 32|0;
 $vararg_buffer7 = sp + 24|0;
 $vararg_buffer3 = sp + 16|0;
 $vararg_buffer = sp;
 $0 = sp + 36|0;
 $1 = (___cxa_get_globals_fast()|0);
 $2 = ($1|0)==(0|0);
 if (!($2)) {
  $3 = HEAP32[$1>>2]|0;
  $4 = ($3|0)==(0|0);
  if (!($4)) {
   $5 = ((($3)) + 80|0);
   $6 = ((($3)) + 48|0);
   $7 = $6;
   $8 = $7;
   $9 = HEAP32[$8>>2]|0;
   $10 = (($7) + 4)|0;
   $11 = $10;
   $12 = HEAP32[$11>>2]|0;
   $13 = $9 & -256;
   $14 = ($13|0)==(1126902528);
   $15 = ($12|0)==(1129074247);
   $16 = $14 & $15;
   if (!($16)) {
    $36 = HEAP32[266]|0;
    HEAP32[$vararg_buffer7>>2] = $36;
    _abort_message(6525,$vararg_buffer7);
    // unreachable;
   }
   $17 = ($9|0)==(1126902529);
   $18 = ($12|0)==(1129074247);
   $19 = $17 & $18;
   if ($19) {
    $20 = ((($3)) + 44|0);
    $21 = HEAP32[$20>>2]|0;
    $22 = $21;
   } else {
    $22 = $5;
   }
   HEAP32[$0>>2] = $22;
   $23 = HEAP32[$3>>2]|0;
   $24 = ((($23)) + 4|0);
   $25 = HEAP32[$24>>2]|0;
   $26 = HEAP32[70]|0;
   $27 = ((($26)) + 16|0);
   $28 = HEAP32[$27>>2]|0;
   $29 = (FUNCTION_TABLE_iiii[$28 & 127](280,$23,$0)|0);
   $30 = HEAP32[266]|0;
   if ($29) {
    $31 = HEAP32[$0>>2]|0;
    $32 = HEAP32[$31>>2]|0;
    $33 = ((($32)) + 8|0);
    $34 = HEAP32[$33>>2]|0;
    $35 = (FUNCTION_TABLE_ii[$34 & 127]($31)|0);
    HEAP32[$vararg_buffer>>2] = $30;
    $vararg_ptr1 = ((($vararg_buffer)) + 4|0);
    HEAP32[$vararg_ptr1>>2] = $25;
    $vararg_ptr2 = ((($vararg_buffer)) + 8|0);
    HEAP32[$vararg_ptr2>>2] = $35;
    _abort_message(6439,$vararg_buffer);
    // unreachable;
   } else {
    HEAP32[$vararg_buffer3>>2] = $30;
    $vararg_ptr6 = ((($vararg_buffer3)) + 4|0);
    HEAP32[$vararg_ptr6>>2] = $25;
    _abort_message(6484,$vararg_buffer3);
    // unreachable;
   }
  }
 }
 _abort_message(6563,$vararg_buffer10);
 // unreachable;
}
function ___cxa_get_globals_fast() {
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $vararg_buffer = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $vararg_buffer = sp;
 $0 = (___pthread_once(10592,88)|0);
 $1 = ($0|0)==(0);
 if ($1) {
  $2 = HEAP32[2649]|0;
  $3 = (___pthread_getspecific($2)|0);
  STACKTOP = sp;return ($3|0);
 } else {
  _abort_message(6714,$vararg_buffer);
  // unreachable;
 }
 return (0)|0;
}
function _abort_message($0,$varargs) {
 $0 = $0|0;
 $varargs = $varargs|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $1 = sp;
 HEAP32[$1>>2] = $varargs;
 $2 = HEAP32[144]|0;
 (_vfprintf($2,$0,$1)|0);
 (_fputc(10,$2)|0);
 _abort();
 // unreachable;
}
function __ZN10__cxxabiv116__shim_type_infoD2Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZN10__cxxabiv117__class_type_infoD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZN10__cxxabiv116__shim_type_infoD2Ev($0);
 __ZdlPv($0);
 return;
}
function __ZNK10__cxxabiv116__shim_type_info5noop1Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNK10__cxxabiv116__shim_type_info5noop2Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNK10__cxxabiv117__class_type_info9can_catchEPKNS_16__shim_type_infoERPv($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $$0 = 0, $$2 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0;
 var dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 64|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(64|0);
 $3 = sp;
 $4 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$1,0)|0);
 if ($4) {
  $$2 = 1;
 } else {
  $5 = ($1|0)==(0|0);
  if ($5) {
   $$2 = 0;
  } else {
   $6 = (___dynamic_cast($1,304,288,0)|0);
   $7 = ($6|0)==(0|0);
   if ($7) {
    $$2 = 0;
   } else {
    $8 = ((($3)) + 4|0);
    dest=$8; stop=dest+52|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
    HEAP32[$3>>2] = $6;
    $9 = ((($3)) + 8|0);
    HEAP32[$9>>2] = $0;
    $10 = ((($3)) + 12|0);
    HEAP32[$10>>2] = -1;
    $11 = ((($3)) + 48|0);
    HEAP32[$11>>2] = 1;
    $12 = HEAP32[$6>>2]|0;
    $13 = ((($12)) + 28|0);
    $14 = HEAP32[$13>>2]|0;
    $15 = HEAP32[$2>>2]|0;
    FUNCTION_TABLE_viiii[$14 & 127]($6,$3,$15,1);
    $16 = ((($3)) + 24|0);
    $17 = HEAP32[$16>>2]|0;
    $18 = ($17|0)==(1);
    if ($18) {
     $19 = ((($3)) + 16|0);
     $20 = HEAP32[$19>>2]|0;
     HEAP32[$2>>2] = $20;
     $$0 = 1;
    } else {
     $$0 = 0;
    }
    $$2 = $$0;
   }
  }
 }
 STACKTOP = sp;return ($$2|0);
}
function __ZNK10__cxxabiv117__class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib($0,$1,$2,$3,$4,$5) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 $5 = $5|0;
 var $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $6 = ((($1)) + 8|0);
 $7 = HEAP32[$6>>2]|0;
 $8 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$7,$5)|0);
 if ($8) {
  __ZNK10__cxxabiv117__class_type_info29process_static_type_above_dstEPNS_19__dynamic_cast_infoEPKvS4_i(0,$1,$2,$3,$4);
 }
 return;
}
function __ZNK10__cxxabiv117__class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $5 = 0;
 var $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $5 = ((($1)) + 8|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$6,$4)|0);
 do {
  if ($7) {
   __ZNK10__cxxabiv117__class_type_info29process_static_type_below_dstEPNS_19__dynamic_cast_infoEPKvi(0,$1,$2,$3);
  } else {
   $8 = HEAP32[$1>>2]|0;
   $9 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$8,$4)|0);
   if ($9) {
    $10 = ((($1)) + 16|0);
    $11 = HEAP32[$10>>2]|0;
    $12 = ($11|0)==($2|0);
    $13 = ((($1)) + 32|0);
    if (!($12)) {
     $14 = ((($1)) + 20|0);
     $15 = HEAP32[$14>>2]|0;
     $16 = ($15|0)==($2|0);
     if (!($16)) {
      HEAP32[$13>>2] = $3;
      HEAP32[$14>>2] = $2;
      $18 = ((($1)) + 40|0);
      $19 = HEAP32[$18>>2]|0;
      $20 = (($19) + 1)|0;
      HEAP32[$18>>2] = $20;
      $21 = ((($1)) + 36|0);
      $22 = HEAP32[$21>>2]|0;
      $23 = ($22|0)==(1);
      if ($23) {
       $24 = ((($1)) + 24|0);
       $25 = HEAP32[$24>>2]|0;
       $26 = ($25|0)==(2);
       if ($26) {
        $27 = ((($1)) + 54|0);
        HEAP8[$27>>0] = 1;
       }
      }
      $28 = ((($1)) + 44|0);
      HEAP32[$28>>2] = 4;
      break;
     }
    }
    $17 = ($3|0)==(1);
    if ($17) {
     HEAP32[$13>>2] = 1;
    }
   }
  }
 } while(0);
 return;
}
function __ZNK10__cxxabiv117__class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $4 = 0, $5 = 0, $6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $4 = ((($1)) + 8|0);
 $5 = HEAP32[$4>>2]|0;
 $6 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$5,0)|0);
 if ($6) {
  __ZNK10__cxxabiv117__class_type_info24process_found_base_classEPNS_19__dynamic_cast_infoEPvi(0,$1,$2,$3);
 }
 return;
}
function __ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = ($0|0)==($1|0);
 return ($3|0);
}
function __ZNK10__cxxabiv117__class_type_info24process_found_base_classEPNS_19__dynamic_cast_infoEPvi($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $4 = ((($1)) + 16|0);
 $5 = HEAP32[$4>>2]|0;
 $6 = ($5|0)==(0|0);
 $7 = ((($1)) + 36|0);
 $8 = ((($1)) + 24|0);
 do {
  if ($6) {
   HEAP32[$4>>2] = $2;
   HEAP32[$8>>2] = $3;
   HEAP32[$7>>2] = 1;
  } else {
   $9 = ($5|0)==($2|0);
   if (!($9)) {
    $12 = HEAP32[$7>>2]|0;
    $13 = (($12) + 1)|0;
    HEAP32[$7>>2] = $13;
    HEAP32[$8>>2] = 2;
    $14 = ((($1)) + 54|0);
    HEAP8[$14>>0] = 1;
    break;
   }
   $10 = HEAP32[$8>>2]|0;
   $11 = ($10|0)==(2);
   if ($11) {
    HEAP32[$8>>2] = $3;
   }
  }
 } while(0);
 return;
}
function __ZNK10__cxxabiv117__class_type_info29process_static_type_below_dstEPNS_19__dynamic_cast_infoEPKvi($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $4 = ((($1)) + 4|0);
 $5 = HEAP32[$4>>2]|0;
 $6 = ($5|0)==($2|0);
 if ($6) {
  $7 = ((($1)) + 28|0);
  $8 = HEAP32[$7>>2]|0;
  $9 = ($8|0)==(1);
  if (!($9)) {
   HEAP32[$7>>2] = $3;
  }
 }
 return;
}
function __ZNK10__cxxabiv117__class_type_info29process_static_type_above_dstEPNS_19__dynamic_cast_infoEPKvS4_i($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $5 = 0;
 var $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, $or$cond22 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $5 = ((($1)) + 53|0);
 HEAP8[$5>>0] = 1;
 $6 = ((($1)) + 4|0);
 $7 = HEAP32[$6>>2]|0;
 $8 = ($7|0)==($3|0);
 do {
  if ($8) {
   $9 = ((($1)) + 52|0);
   HEAP8[$9>>0] = 1;
   $10 = ((($1)) + 16|0);
   $11 = HEAP32[$10>>2]|0;
   $12 = ($11|0)==(0|0);
   $13 = ((($1)) + 54|0);
   $14 = ((($1)) + 48|0);
   $15 = ((($1)) + 24|0);
   $16 = ((($1)) + 36|0);
   if ($12) {
    HEAP32[$10>>2] = $2;
    HEAP32[$15>>2] = $4;
    HEAP32[$16>>2] = 1;
    $17 = HEAP32[$14>>2]|0;
    $18 = ($17|0)==(1);
    $19 = ($4|0)==(1);
    $or$cond = $18 & $19;
    if (!($or$cond)) {
     break;
    }
    HEAP8[$13>>0] = 1;
    break;
   }
   $20 = ($11|0)==($2|0);
   if (!($20)) {
    $27 = HEAP32[$16>>2]|0;
    $28 = (($27) + 1)|0;
    HEAP32[$16>>2] = $28;
    HEAP8[$13>>0] = 1;
    break;
   }
   $21 = HEAP32[$15>>2]|0;
   $22 = ($21|0)==(2);
   if ($22) {
    HEAP32[$15>>2] = $4;
    $26 = $4;
   } else {
    $26 = $21;
   }
   $23 = HEAP32[$14>>2]|0;
   $24 = ($23|0)==(1);
   $25 = ($26|0)==(1);
   $or$cond22 = $24 & $25;
   if ($or$cond22) {
    HEAP8[$13>>0] = 1;
   }
  }
 } while(0);
 return;
}
function ___dynamic_cast($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $$ = 0, $$0 = 0, $$33 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0;
 var $46 = 0, $47 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, $or$cond28 = 0, $or$cond30 = 0, $or$cond32 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 64|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(64|0);
 $4 = sp;
 $5 = HEAP32[$0>>2]|0;
 $6 = ((($5)) + -8|0);
 $7 = HEAP32[$6>>2]|0;
 $8 = (($0) + ($7)|0);
 $9 = ((($5)) + -4|0);
 $10 = HEAP32[$9>>2]|0;
 HEAP32[$4>>2] = $2;
 $11 = ((($4)) + 4|0);
 HEAP32[$11>>2] = $0;
 $12 = ((($4)) + 8|0);
 HEAP32[$12>>2] = $1;
 $13 = ((($4)) + 12|0);
 HEAP32[$13>>2] = $3;
 $14 = ((($4)) + 16|0);
 $15 = ((($4)) + 20|0);
 $16 = ((($4)) + 24|0);
 $17 = ((($4)) + 28|0);
 $18 = ((($4)) + 32|0);
 $19 = ((($4)) + 40|0);
 dest=$14; stop=dest+36|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));HEAP16[$14+36>>1]=0|0;HEAP8[$14+38>>0]=0|0;
 $20 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($10,$2,0)|0);
 L1: do {
  if ($20) {
   $21 = ((($4)) + 48|0);
   HEAP32[$21>>2] = 1;
   $22 = HEAP32[$10>>2]|0;
   $23 = ((($22)) + 20|0);
   $24 = HEAP32[$23>>2]|0;
   FUNCTION_TABLE_viiiiii[$24 & 63]($10,$4,$8,$8,1,0);
   $25 = HEAP32[$16>>2]|0;
   $26 = ($25|0)==(1);
   $$ = $26 ? $8 : 0;
   $$0 = $$;
  } else {
   $27 = ((($4)) + 36|0);
   $28 = HEAP32[$10>>2]|0;
   $29 = ((($28)) + 24|0);
   $30 = HEAP32[$29>>2]|0;
   FUNCTION_TABLE_viiiii[$30 & 63]($10,$4,$8,1,0);
   $31 = HEAP32[$27>>2]|0;
   switch ($31|0) {
   case 0:  {
    $32 = HEAP32[$19>>2]|0;
    $33 = ($32|0)==(1);
    $34 = HEAP32[$17>>2]|0;
    $35 = ($34|0)==(1);
    $or$cond = $33 & $35;
    $36 = HEAP32[$18>>2]|0;
    $37 = ($36|0)==(1);
    $or$cond28 = $or$cond & $37;
    $38 = HEAP32[$15>>2]|0;
    $$33 = $or$cond28 ? $38 : 0;
    $$0 = $$33;
    break L1;
    break;
   }
   case 1:  {
    break;
   }
   default: {
    $$0 = 0;
    break L1;
   }
   }
   $39 = HEAP32[$16>>2]|0;
   $40 = ($39|0)==(1);
   if (!($40)) {
    $41 = HEAP32[$19>>2]|0;
    $42 = ($41|0)==(0);
    $43 = HEAP32[$17>>2]|0;
    $44 = ($43|0)==(1);
    $or$cond30 = $42 & $44;
    $45 = HEAP32[$18>>2]|0;
    $46 = ($45|0)==(1);
    $or$cond32 = $or$cond30 & $46;
    if (!($or$cond32)) {
     $$0 = 0;
     break;
    }
   }
   $47 = HEAP32[$14>>2]|0;
   $$0 = $47;
  }
 } while(0);
 STACKTOP = sp;return ($$0|0);
}
function __ZN10__cxxabiv120__si_class_type_infoD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZN10__cxxabiv116__shim_type_infoD2Ev($0);
 __ZdlPv($0);
 return;
}
function __ZNK10__cxxabiv120__si_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib($0,$1,$2,$3,$4,$5) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 $5 = $5|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $6 = ((($1)) + 8|0);
 $7 = HEAP32[$6>>2]|0;
 $8 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$7,$5)|0);
 if ($8) {
  __ZNK10__cxxabiv117__class_type_info29process_static_type_above_dstEPNS_19__dynamic_cast_infoEPKvS4_i(0,$1,$2,$3,$4);
 } else {
  $9 = ((($0)) + 8|0);
  $10 = HEAP32[$9>>2]|0;
  $11 = HEAP32[$10>>2]|0;
  $12 = ((($11)) + 20|0);
  $13 = HEAP32[$12>>2]|0;
  FUNCTION_TABLE_viiiiii[$13 & 63]($10,$1,$2,$3,$4,$5);
 }
 return;
}
function __ZNK10__cxxabiv120__si_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $$037$off038 = 0, $$037$off039 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0;
 var $28 = 0, $29 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $5 = 0, $6 = 0, $7 = 0;
 var $8 = 0, $9 = 0, $not$ = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $5 = ((($1)) + 8|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$6,$4)|0);
 do {
  if ($7) {
   __ZNK10__cxxabiv117__class_type_info29process_static_type_below_dstEPNS_19__dynamic_cast_infoEPKvi(0,$1,$2,$3);
  } else {
   $8 = HEAP32[$1>>2]|0;
   $9 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$8,$4)|0);
   $10 = ((($0)) + 8|0);
   if (!($9)) {
    $41 = HEAP32[$10>>2]|0;
    $42 = HEAP32[$41>>2]|0;
    $43 = ((($42)) + 24|0);
    $44 = HEAP32[$43>>2]|0;
    FUNCTION_TABLE_viiiii[$44 & 63]($41,$1,$2,$3,$4);
    break;
   }
   $11 = ((($1)) + 16|0);
   $12 = HEAP32[$11>>2]|0;
   $13 = ($12|0)==($2|0);
   $14 = ((($1)) + 32|0);
   if (!($13)) {
    $15 = ((($1)) + 20|0);
    $16 = HEAP32[$15>>2]|0;
    $17 = ($16|0)==($2|0);
    if (!($17)) {
     HEAP32[$14>>2] = $3;
     $19 = ((($1)) + 44|0);
     $20 = HEAP32[$19>>2]|0;
     $21 = ($20|0)==(4);
     if ($21) {
      break;
     }
     $22 = ((($1)) + 52|0);
     HEAP8[$22>>0] = 0;
     $23 = ((($1)) + 53|0);
     HEAP8[$23>>0] = 0;
     $24 = HEAP32[$10>>2]|0;
     $25 = HEAP32[$24>>2]|0;
     $26 = ((($25)) + 20|0);
     $27 = HEAP32[$26>>2]|0;
     FUNCTION_TABLE_viiiiii[$27 & 63]($24,$1,$2,$2,1,$4);
     $28 = HEAP8[$23>>0]|0;
     $29 = ($28<<24>>24)==(0);
     if ($29) {
      $$037$off038 = 4;
      label = 11;
     } else {
      $30 = HEAP8[$22>>0]|0;
      $not$ = ($30<<24>>24)==(0);
      if ($not$) {
       $$037$off038 = 3;
       label = 11;
      } else {
       $$037$off039 = 3;
      }
     }
     if ((label|0) == 11) {
      HEAP32[$15>>2] = $2;
      $31 = ((($1)) + 40|0);
      $32 = HEAP32[$31>>2]|0;
      $33 = (($32) + 1)|0;
      HEAP32[$31>>2] = $33;
      $34 = ((($1)) + 36|0);
      $35 = HEAP32[$34>>2]|0;
      $36 = ($35|0)==(1);
      if ($36) {
       $37 = ((($1)) + 24|0);
       $38 = HEAP32[$37>>2]|0;
       $39 = ($38|0)==(2);
       if ($39) {
        $40 = ((($1)) + 54|0);
        HEAP8[$40>>0] = 1;
        $$037$off039 = $$037$off038;
       } else {
        $$037$off039 = $$037$off038;
       }
      } else {
       $$037$off039 = $$037$off038;
      }
     }
     HEAP32[$19>>2] = $$037$off039;
     break;
    }
   }
   $18 = ($3|0)==(1);
   if ($18) {
    HEAP32[$14>>2] = 1;
   }
  }
 } while(0);
 return;
}
function __ZNK10__cxxabiv120__si_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $10 = 0, $11 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $4 = ((($1)) + 8|0);
 $5 = HEAP32[$4>>2]|0;
 $6 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$5,0)|0);
 if ($6) {
  __ZNK10__cxxabiv117__class_type_info24process_found_base_classEPNS_19__dynamic_cast_infoEPvi(0,$1,$2,$3);
 } else {
  $7 = ((($0)) + 8|0);
  $8 = HEAP32[$7>>2]|0;
  $9 = HEAP32[$8>>2]|0;
  $10 = ((($9)) + 28|0);
  $11 = HEAP32[$10>>2]|0;
  FUNCTION_TABLE_viiii[$11 & 127]($8,$1,$2,$3);
 }
 return;
}
function __ZNSt9type_infoD2Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZN10__cxxabiv112_GLOBAL__N_110construct_Ev() {
 var $0 = 0, $1 = 0, $vararg_buffer = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $vararg_buffer = sp;
 $0 = (___pthread_key_create(10596,89)|0);
 $1 = ($0|0)==(0);
 if ($1) {
  STACKTOP = sp;return;
 } else {
  _abort_message(6763,$vararg_buffer);
  // unreachable;
 }
}
function __ZN10__cxxabiv112_GLOBAL__N_19destruct_EPv($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $vararg_buffer = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $vararg_buffer = sp;
 _free($0);
 $1 = HEAP32[2649]|0;
 $2 = (_pthread_setspecific($1,0)|0);
 $3 = ($2|0)==(0);
 if ($3) {
  STACKTOP = sp;return;
 } else {
  _abort_message(6813,$vararg_buffer);
  // unreachable;
 }
}
function __ZSt9terminatev() {
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0;
 var $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 __THREW__ = 0;
 $0 = (invoke_i(90)|0);
 $1 = __THREW__; __THREW__ = 0;
 $2 = $1&1;
 if ($2) {
  $20 = ___cxa_find_matching_catch_3(0|0)|0;
  $21 = tempRet0;
  ___clang_call_terminate($20);
  // unreachable;
 }
 $3 = ($0|0)==(0|0);
 if (!($3)) {
  $4 = HEAP32[$0>>2]|0;
  $5 = ($4|0)==(0|0);
  if (!($5)) {
   $6 = ((($4)) + 48|0);
   $7 = $6;
   $8 = $7;
   $9 = HEAP32[$8>>2]|0;
   $10 = (($7) + 4)|0;
   $11 = $10;
   $12 = HEAP32[$11>>2]|0;
   $13 = $9 & -256;
   $14 = ($13|0)==(1126902528);
   $15 = ($12|0)==(1129074247);
   $16 = $14 & $15;
   if ($16) {
    $17 = ((($4)) + 12|0);
    $18 = HEAP32[$17>>2]|0;
    __ZSt11__terminatePFvvE($18);
    // unreachable;
   }
  }
 }
 $19 = (__ZSt13get_terminatev()|0);
 __ZSt11__terminatePFvvE($19);
 // unreachable;
}
function __ZSt11__terminatePFvvE($0) {
 $0 = $0|0;
 var $1 = 0, $10 = 0, $11 = 0, $12 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $vararg_buffer = 0, $vararg_buffer1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $vararg_buffer1 = sp + 8|0;
 $vararg_buffer = sp;
 __THREW__ = 0;
 invoke_v($0|0);
 $1 = __THREW__; __THREW__ = 0;
 $2 = $1&1;
 if (!($2)) {
  __THREW__ = 0;
  invoke_vii(91,(6866|0),($vararg_buffer|0));
  $3 = __THREW__; __THREW__ = 0;
 }
 $4 = ___cxa_find_matching_catch_3(0|0)|0;
 $5 = tempRet0;
 (___cxa_begin_catch(($4|0))|0);
 __THREW__ = 0;
 invoke_vii(91,(6906|0),($vararg_buffer1|0));
 $6 = __THREW__; __THREW__ = 0;
 $7 = ___cxa_find_matching_catch_3(0|0)|0;
 $8 = tempRet0;
 __THREW__ = 0;
 invoke_v(92);
 $9 = __THREW__; __THREW__ = 0;
 $10 = $9&1;
 if ($10) {
  $11 = ___cxa_find_matching_catch_3(0|0)|0;
  $12 = tempRet0;
  ___clang_call_terminate($11);
  // unreachable;
 } else {
  ___clang_call_terminate($7);
  // unreachable;
 }
}
function __ZSt13get_terminatev() {
 var $0 = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (Atomics_add(HEAP32, 265, 0)|0);
 $1 = $0;
 return ($1|0);
}
function __ZNSt9bad_allocD2Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNSt9bad_allocD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZNSt9bad_allocD2Ev($0);
 __ZdlPv($0);
 return;
}
function __ZNKSt9bad_alloc4whatEv($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (6956|0);
}
function __ZNSt9exceptionD2Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNSt11logic_errorD2Ev($0) {
 $0 = $0|0;
 var $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAP32[$0>>2] = (1176);
 $1 = ((($0)) + 4|0);
 __ZNSt3__218__libcpp_refstringD2Ev($1);
 return;
}
function __ZNSt11logic_errorD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZNSt11logic_errorD2Ev($0);
 __ZdlPv($0);
 return;
}
function __ZNKSt11logic_error4whatEv($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + 4|0);
 $2 = (__ZNKSt3__218__libcpp_refstring5c_strEv($1)|0);
 return ($2|0);
}
function __ZNKSt3__218__libcpp_refstring5c_strEv($0) {
 $0 = $0|0;
 var $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP32[$0>>2]|0;
 return ($1|0);
}
function __ZNSt3__218__libcpp_refstringD2Ev($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = (__ZNKSt3__218__libcpp_refstring15__uses_refcountEv($0)|0);
 if ($1) {
  $2 = HEAP32[$0>>2]|0;
  $3 = (__ZNSt3__215__refstring_imp12_GLOBAL__N_113rep_from_dataEPKc_303($2)|0);
  $4 = ((($3)) + 8|0);
  $5 = (Atomics_add(HEAP32, $4>>2, -1)|0);
  $6 = (($5) + -1)|0;
  $7 = ($6|0)<(0);
  if ($7) {
   __ZdlPv($3);
  }
 }
 return;
}
function __ZNSt3__215__refstring_imp12_GLOBAL__N_113rep_from_dataEPKc_303($0) {
 $0 = $0|0;
 var $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + -12|0);
 return ($1|0);
}
function __ZNSt13runtime_errorD2Ev($0) {
 $0 = $0|0;
 var $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAP32[$0>>2] = (1196);
 $1 = ((($0)) + 4|0);
 __ZNSt3__218__libcpp_refstringD2Ev($1);
 return;
}
function __ZNSt13runtime_errorD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZNSt13runtime_errorD2Ev($0);
 __ZdlPv($0);
 return;
}
function __ZNKSt13runtime_error4whatEv($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ((($0)) + 4|0);
 $2 = (__ZNKSt3__218__libcpp_refstring5c_strEv($1)|0);
 return ($2|0);
}
function __ZNSt12length_errorD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZNSt11logic_errorD2Ev($0);
 __ZdlPv($0);
 return;
}
function __ZN10__cxxabiv123__fundamental_type_infoD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZN10__cxxabiv116__shim_type_infoD2Ev($0);
 __ZdlPv($0);
 return;
}
function __ZNK10__cxxabiv123__fundamental_type_info9can_catchEPKNS_16__shim_type_infoERPv($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $3 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$1,0)|0);
 return ($3|0);
}
function __ZN10__cxxabiv121__vmi_class_type_infoD0Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZN10__cxxabiv116__shim_type_infoD2Ev($0);
 __ZdlPv($0);
 return;
}
function __ZNK10__cxxabiv121__vmi_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib($0,$1,$2,$3,$4,$5) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 $5 = $5|0;
 var $$0 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $6 = ((($1)) + 8|0);
 $7 = HEAP32[$6>>2]|0;
 $8 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$7,$5)|0);
 if ($8) {
  __ZNK10__cxxabiv117__class_type_info29process_static_type_above_dstEPNS_19__dynamic_cast_infoEPKvS4_i(0,$1,$2,$3,$4);
 } else {
  $9 = ((($1)) + 52|0);
  $10 = HEAP8[$9>>0]|0;
  $11 = ((($1)) + 53|0);
  $12 = HEAP8[$11>>0]|0;
  $13 = ((($0)) + 16|0);
  $14 = ((($0)) + 12|0);
  $15 = HEAP32[$14>>2]|0;
  $16 = (((($0)) + 16|0) + ($15<<3)|0);
  HEAP8[$9>>0] = 0;
  HEAP8[$11>>0] = 0;
  __ZNK10__cxxabiv122__base_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib($13,$1,$2,$3,$4,$5);
  $17 = ($15|0)>(1);
  L4: do {
   if ($17) {
    $18 = ((($0)) + 24|0);
    $19 = ((($1)) + 24|0);
    $20 = ((($1)) + 54|0);
    $21 = ((($0)) + 8|0);
    $$0 = $18;
    while(1) {
     $22 = HEAP8[$20>>0]|0;
     $23 = ($22<<24>>24)==(0);
     if (!($23)) {
      break L4;
     }
     $24 = HEAP8[$9>>0]|0;
     $25 = ($24<<24>>24)==(0);
     if ($25) {
      $31 = HEAP8[$11>>0]|0;
      $32 = ($31<<24>>24)==(0);
      if (!($32)) {
       $33 = HEAP32[$21>>2]|0;
       $34 = $33 & 1;
       $35 = ($34|0)==(0);
       if ($35) {
        break L4;
       }
      }
     } else {
      $26 = HEAP32[$19>>2]|0;
      $27 = ($26|0)==(1);
      if ($27) {
       break L4;
      }
      $28 = HEAP32[$21>>2]|0;
      $29 = $28 & 2;
      $30 = ($29|0)==(0);
      if ($30) {
       break L4;
      }
     }
     HEAP8[$9>>0] = 0;
     HEAP8[$11>>0] = 0;
     __ZNK10__cxxabiv122__base_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib($$0,$1,$2,$3,$4,$5);
     $36 = ((($$0)) + 8|0);
     $37 = ($36>>>0)<($16>>>0);
     if ($37) {
      $$0 = $36;
     } else {
      break;
     }
    }
   }
  } while(0);
  HEAP8[$9>>0] = $10;
  HEAP8[$11>>0] = $12;
 }
 return;
}
function __ZNK10__cxxabiv121__vmi_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $$0 = 0, $$081$off0 = 0, $$084 = 0, $$085$off0 = 0, $$1 = 0, $$182$off0 = 0, $$186$off0 = 0, $$2 = 0, $$283$off0 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0;
 var $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $40 = 0;
 var $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0;
 var $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0;
 var $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $5 = ((($1)) + 8|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$6,$4)|0);
 L1: do {
  if ($7) {
   __ZNK10__cxxabiv117__class_type_info29process_static_type_below_dstEPNS_19__dynamic_cast_infoEPKvi(0,$1,$2,$3);
  } else {
   $8 = HEAP32[$1>>2]|0;
   $9 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$8,$4)|0);
   $10 = ((($0)) + 12|0);
   $11 = ((($1)) + 24|0);
   $12 = ((($1)) + 36|0);
   $13 = ((($1)) + 54|0);
   $14 = ((($0)) + 8|0);
   $15 = ((($0)) + 16|0);
   if (!($9)) {
    $55 = HEAP32[$10>>2]|0;
    $56 = (((($0)) + 16|0) + ($55<<3)|0);
    __ZNK10__cxxabiv122__base_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib($15,$1,$2,$3,$4);
    $57 = ((($0)) + 24|0);
    $58 = ($55|0)>(1);
    if (!($58)) {
     break;
    }
    $59 = HEAP32[$14>>2]|0;
    $60 = $59 & 2;
    $61 = ($60|0)==(0);
    if ($61) {
     $62 = HEAP32[$12>>2]|0;
     $63 = ($62|0)==(1);
     if ($63) {
      $$0 = $57;
     } else {
      $68 = $59 & 1;
      $69 = ($68|0)==(0);
      if ($69) {
       $$2 = $57;
       while(1) {
        $78 = HEAP8[$13>>0]|0;
        $79 = ($78<<24>>24)==(0);
        if (!($79)) {
         break L1;
        }
        $80 = HEAP32[$12>>2]|0;
        $81 = ($80|0)==(1);
        if ($81) {
         break L1;
        }
        __ZNK10__cxxabiv122__base_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib($$2,$1,$2,$3,$4);
        $82 = ((($$2)) + 8|0);
        $83 = ($82>>>0)<($56>>>0);
        if ($83) {
         $$2 = $82;
        } else {
         break L1;
        }
       }
      } else {
       $$1 = $57;
      }
      while(1) {
       $70 = HEAP8[$13>>0]|0;
       $71 = ($70<<24>>24)==(0);
       if (!($71)) {
        break L1;
       }
       $72 = HEAP32[$12>>2]|0;
       $73 = ($72|0)==(1);
       if ($73) {
        $74 = HEAP32[$11>>2]|0;
        $75 = ($74|0)==(1);
        if ($75) {
         break L1;
        }
       }
       __ZNK10__cxxabiv122__base_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib($$1,$1,$2,$3,$4);
       $76 = ((($$1)) + 8|0);
       $77 = ($76>>>0)<($56>>>0);
       if ($77) {
        $$1 = $76;
       } else {
        break L1;
       }
      }
     }
    } else {
     $$0 = $57;
    }
    while(1) {
     $64 = HEAP8[$13>>0]|0;
     $65 = ($64<<24>>24)==(0);
     if (!($65)) {
      break L1;
     }
     __ZNK10__cxxabiv122__base_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib($$0,$1,$2,$3,$4);
     $66 = ((($$0)) + 8|0);
     $67 = ($66>>>0)<($56>>>0);
     if ($67) {
      $$0 = $66;
     } else {
      break L1;
     }
    }
   }
   $16 = ((($1)) + 16|0);
   $17 = HEAP32[$16>>2]|0;
   $18 = ($17|0)==($2|0);
   $19 = ((($1)) + 32|0);
   if (!($18)) {
    $20 = ((($1)) + 20|0);
    $21 = HEAP32[$20>>2]|0;
    $22 = ($21|0)==($2|0);
    if (!($22)) {
     HEAP32[$19>>2] = $3;
     $24 = ((($1)) + 44|0);
     $25 = HEAP32[$24>>2]|0;
     $26 = ($25|0)==(4);
     if ($26) {
      break;
     }
     $27 = HEAP32[$10>>2]|0;
     $28 = (((($0)) + 16|0) + ($27<<3)|0);
     $29 = ((($1)) + 52|0);
     $30 = ((($1)) + 53|0);
     $$081$off0 = 0;$$084 = $15;$$085$off0 = 0;
     L29: while(1) {
      $31 = ($$084>>>0)<($28>>>0);
      if (!($31)) {
       $$283$off0 = $$081$off0;
       label = 18;
       break;
      }
      HEAP8[$29>>0] = 0;
      HEAP8[$30>>0] = 0;
      __ZNK10__cxxabiv122__base_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib($$084,$1,$2,$2,1,$4);
      $32 = HEAP8[$13>>0]|0;
      $33 = ($32<<24>>24)==(0);
      if (!($33)) {
       $$283$off0 = $$081$off0;
       label = 18;
       break;
      }
      $34 = HEAP8[$30>>0]|0;
      $35 = ($34<<24>>24)==(0);
      do {
       if ($35) {
        $$182$off0 = $$081$off0;$$186$off0 = $$085$off0;
       } else {
        $36 = HEAP8[$29>>0]|0;
        $37 = ($36<<24>>24)==(0);
        if ($37) {
         $43 = HEAP32[$14>>2]|0;
         $44 = $43 & 1;
         $45 = ($44|0)==(0);
         if ($45) {
          $$283$off0 = 1;
          label = 18;
          break L29;
         } else {
          $$182$off0 = 1;$$186$off0 = $$085$off0;
          break;
         }
        }
        $38 = HEAP32[$11>>2]|0;
        $39 = ($38|0)==(1);
        if ($39) {
         label = 23;
         break L29;
        }
        $40 = HEAP32[$14>>2]|0;
        $41 = $40 & 2;
        $42 = ($41|0)==(0);
        if ($42) {
         label = 23;
         break L29;
        } else {
         $$182$off0 = 1;$$186$off0 = 1;
        }
       }
      } while(0);
      $46 = ((($$084)) + 8|0);
      $$081$off0 = $$182$off0;$$084 = $46;$$085$off0 = $$186$off0;
     }
     do {
      if ((label|0) == 18) {
       if (!($$085$off0)) {
        HEAP32[$20>>2] = $2;
        $47 = ((($1)) + 40|0);
        $48 = HEAP32[$47>>2]|0;
        $49 = (($48) + 1)|0;
        HEAP32[$47>>2] = $49;
        $50 = HEAP32[$12>>2]|0;
        $51 = ($50|0)==(1);
        if ($51) {
         $52 = HEAP32[$11>>2]|0;
         $53 = ($52|0)==(2);
         if ($53) {
          HEAP8[$13>>0] = 1;
          if ($$283$off0) {
           label = 23;
           break;
          } else {
           $54 = 4;
           break;
          }
         }
        }
       }
       if ($$283$off0) {
        label = 23;
       } else {
        $54 = 4;
       }
      }
     } while(0);
     if ((label|0) == 23) {
      $54 = 3;
     }
     HEAP32[$24>>2] = $54;
     break;
    }
   }
   $23 = ($3|0)==(1);
   if ($23) {
    HEAP32[$19>>2] = 1;
   }
  }
 } while(0);
 return;
}
function __ZNK10__cxxabiv121__vmi_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $$0 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $4 = ((($1)) + 8|0);
 $5 = HEAP32[$4>>2]|0;
 $6 = (__ZN10__cxxabiv18is_equalEPKSt9type_infoS2_b($0,$5,0)|0);
 L1: do {
  if ($6) {
   __ZNK10__cxxabiv117__class_type_info24process_found_base_classEPNS_19__dynamic_cast_infoEPvi(0,$1,$2,$3);
  } else {
   $7 = ((($0)) + 16|0);
   $8 = ((($0)) + 12|0);
   $9 = HEAP32[$8>>2]|0;
   $10 = (((($0)) + 16|0) + ($9<<3)|0);
   __ZNK10__cxxabiv122__base_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi($7,$1,$2,$3);
   $11 = ($9|0)>(1);
   if ($11) {
    $12 = ((($0)) + 24|0);
    $13 = ((($1)) + 54|0);
    $$0 = $12;
    while(1) {
     __ZNK10__cxxabiv122__base_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi($$0,$1,$2,$3);
     $14 = HEAP8[$13>>0]|0;
     $15 = ($14<<24>>24)==(0);
     if (!($15)) {
      break L1;
     }
     $16 = ((($$0)) + 8|0);
     $17 = ($16>>>0)<($10>>>0);
     if ($17) {
      $$0 = $16;
     } else {
      break;
     }
    }
   }
  }
 } while(0);
 return;
}
function __ZNK10__cxxabiv122__base_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi($0,$1,$2,$3) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 var $$0 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $4 = ((($0)) + 4|0);
 $5 = HEAP32[$4>>2]|0;
 $6 = $5 >> 8;
 $7 = $5 & 1;
 $8 = ($7|0)==(0);
 if ($8) {
  $$0 = $6;
 } else {
  $9 = HEAP32[$2>>2]|0;
  $10 = (($9) + ($6)|0);
  $11 = HEAP32[$10>>2]|0;
  $$0 = $11;
 }
 $12 = HEAP32[$0>>2]|0;
 $13 = HEAP32[$12>>2]|0;
 $14 = ((($13)) + 28|0);
 $15 = HEAP32[$14>>2]|0;
 $16 = (($2) + ($$0)|0);
 $17 = $5 & 2;
 $18 = ($17|0)!=(0);
 $19 = $18 ? $3 : 2;
 FUNCTION_TABLE_viiii[$15 & 127]($12,$1,$16,$19);
 return;
}
function __ZNK10__cxxabiv122__base_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib($0,$1,$2,$3,$4,$5) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 $5 = $5|0;
 var $$0 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $6 = ((($0)) + 4|0);
 $7 = HEAP32[$6>>2]|0;
 $8 = $7 >> 8;
 $9 = $7 & 1;
 $10 = ($9|0)==(0);
 if ($10) {
  $$0 = $8;
 } else {
  $11 = HEAP32[$3>>2]|0;
  $12 = (($11) + ($8)|0);
  $13 = HEAP32[$12>>2]|0;
  $$0 = $13;
 }
 $14 = HEAP32[$0>>2]|0;
 $15 = HEAP32[$14>>2]|0;
 $16 = ((($15)) + 20|0);
 $17 = HEAP32[$16>>2]|0;
 $18 = (($3) + ($$0)|0);
 $19 = $7 & 2;
 $20 = ($19|0)!=(0);
 $21 = $20 ? $4 : 2;
 FUNCTION_TABLE_viiiiii[$17 & 63]($14,$1,$2,$18,$21,$5);
 return;
}
function __ZNK10__cxxabiv122__base_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib($0,$1,$2,$3,$4) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 var $$0 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $5 = ((($0)) + 4|0);
 $6 = HEAP32[$5>>2]|0;
 $7 = $6 >> 8;
 $8 = $6 & 1;
 $9 = ($8|0)==(0);
 if ($9) {
  $$0 = $7;
 } else {
  $10 = HEAP32[$2>>2]|0;
  $11 = (($10) + ($7)|0);
  $12 = HEAP32[$11>>2]|0;
  $$0 = $12;
 }
 $13 = HEAP32[$0>>2]|0;
 $14 = HEAP32[$13>>2]|0;
 $15 = ((($14)) + 24|0);
 $16 = HEAP32[$15>>2]|0;
 $17 = (($2) + ($$0)|0);
 $18 = $6 & 2;
 $19 = ($18|0)!=(0);
 $20 = $19 ? $3 : 2;
 FUNCTION_TABLE_viiiii[$16 & 63]($13,$1,$17,$20,$4);
 return;
}
function ___cxa_guard_acquire($0) {
 $0 = $0|0;
 var $$0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = HEAP8[$0>>0]|0;
 $2 = ($1<<24>>24)==(1);
 if ($2) {
  $$0 = 0;
 } else {
  HEAP8[$0>>0] = 1;
  $$0 = 1;
 }
 return ($$0|0);
}
function ___cxa_guard_release($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function ___cxa_guard_abort($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNSt9bad_allocC2Ev($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 HEAP32[$0>>2] = (1156);
 return;
}
function __ZSt15get_new_handlerv() {
 var $0 = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (Atomics_add(HEAP32, 2650, 0)|0);
 $1 = $0;
 return ($1|0);
}
function ___cxa_can_catch($0,$1,$2) {
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 var $10 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0; if ((STACKTOP|0) >= (STACK_MAX|0)) abortStackOverflow(16|0);
 $3 = sp;
 $4 = HEAP32[$2>>2]|0;
 HEAP32[$3>>2] = $4;
 $5 = HEAP32[$0>>2]|0;
 $6 = ((($5)) + 16|0);
 $7 = HEAP32[$6>>2]|0;
 $8 = (FUNCTION_TABLE_iiii[$7 & 127]($0,$1,$3)|0);
 $9 = $8&1;
 if ($8) {
  $10 = HEAP32[$3>>2]|0;
  HEAP32[$2>>2] = $10;
 }
 STACKTOP = sp;return ($9|0);
}
function ___cxa_is_pointer_type($0) {
 $0 = $0|0;
 var $1 = 0, $2 = 0, $3 = 0, $4 = 0, $phitmp = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $1 = ($0|0)==(0|0);
 if ($1) {
  $4 = 0;
 } else {
  $2 = (___dynamic_cast($0,304,424,0)|0);
  $phitmp = ($2|0)!=(0|0);
  $4 = $phitmp;
 }
 $3 = $4&1;
 return ($3|0);
}
function runPostSets() {
}
function _i64Subtract(a, b, c, d) {
    a = a|0; b = b|0; c = c|0; d = d|0;
    var l = 0, h = 0;
    l = (a - c)>>>0;
    h = (b - d)>>>0;
    h = (b - d - (((c>>>0) > (a>>>0))|0))>>>0; // Borrow one from high word to low word on underflow.
    return ((tempRet0 = h,l|0)|0);
}
function _i64Add(a, b, c, d) {
    /*
      x = a + b*2^32
      y = c + d*2^32
      result = l + h*2^32
    */
    a = a|0; b = b|0; c = c|0; d = d|0;
    var l = 0, h = 0;
    l = (a + c)>>>0;
    h = (b + d + (((l>>>0) < (a>>>0))|0))>>>0; // Add carry from low word to high word on overflow.
    return ((tempRet0 = h,l|0)|0);
}
function __register_pthread_ptr(pthreadPtr, isMainBrowserThread, isMainRuntimeThread) {
    pthreadPtr = pthreadPtr|0;
    isMainBrowserThread = isMainBrowserThread|0;
    isMainRuntimeThread = isMainRuntimeThread|0;
    __pthread_ptr = pthreadPtr;
    __pthread_is_main_browser_thread = isMainBrowserThread;
    __pthread_is_main_runtime_thread = isMainRuntimeThread;
}
function _emscripten_set_thread_name(threadId, name) {
    threadId = threadId|0;
    name = name|0;
}
function _pthread_self() {
    return __pthread_ptr|0;
}
function _bitshift64Lshr(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      tempRet0 = high >>> bits;
      return (low >>> bits) | ((high&ander) << (32 - bits));
    }
    tempRet0 = 0;
    return (high >>> (bits - 32))|0;
}
function _emscripten_conditional_set_current_thread_status(expectedStatus, newStatus) {
    expectedStatus = expectedStatus|0;
    newStatus = newStatus|0;
}
function _memcpy(dest, src, num) {
    dest = dest|0; src = src|0; num = num|0;
    var ret = 0;
    var aligned_dest_end = 0;
    var block_aligned_dest_end = 0;
    var dest_end = 0;
    // Test against a benchmarked cutoff limit for when HEAPU8.set() becomes faster to use.
    if ((num|0) >=
      8192
    ) {
      return _emscripten_memcpy_big(dest|0, src|0, num|0)|0;
    }

    ret = dest|0;
    dest_end = (dest + num)|0;
    if ((dest&3) == (src&3)) {
      // The initial unaligned < 4-byte front.
      while (dest & 3) {
        if ((num|0) == 0) return ret|0;
        HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
        dest = (dest+1)|0;
        src = (src+1)|0;
        num = (num-1)|0;
      }
      aligned_dest_end = (dest_end & -4)|0;
      block_aligned_dest_end = (aligned_dest_end - 64)|0;
      while ((dest|0) <= (block_aligned_dest_end|0) ) {
        HEAP32[((dest)>>2)]=((HEAP32[((src)>>2)])|0);
        HEAP32[(((dest)+(4))>>2)]=((HEAP32[(((src)+(4))>>2)])|0);
        HEAP32[(((dest)+(8))>>2)]=((HEAP32[(((src)+(8))>>2)])|0);
        HEAP32[(((dest)+(12))>>2)]=((HEAP32[(((src)+(12))>>2)])|0);
        HEAP32[(((dest)+(16))>>2)]=((HEAP32[(((src)+(16))>>2)])|0);
        HEAP32[(((dest)+(20))>>2)]=((HEAP32[(((src)+(20))>>2)])|0);
        HEAP32[(((dest)+(24))>>2)]=((HEAP32[(((src)+(24))>>2)])|0);
        HEAP32[(((dest)+(28))>>2)]=((HEAP32[(((src)+(28))>>2)])|0);
        HEAP32[(((dest)+(32))>>2)]=((HEAP32[(((src)+(32))>>2)])|0);
        HEAP32[(((dest)+(36))>>2)]=((HEAP32[(((src)+(36))>>2)])|0);
        HEAP32[(((dest)+(40))>>2)]=((HEAP32[(((src)+(40))>>2)])|0);
        HEAP32[(((dest)+(44))>>2)]=((HEAP32[(((src)+(44))>>2)])|0);
        HEAP32[(((dest)+(48))>>2)]=((HEAP32[(((src)+(48))>>2)])|0);
        HEAP32[(((dest)+(52))>>2)]=((HEAP32[(((src)+(52))>>2)])|0);
        HEAP32[(((dest)+(56))>>2)]=((HEAP32[(((src)+(56))>>2)])|0);
        HEAP32[(((dest)+(60))>>2)]=((HEAP32[(((src)+(60))>>2)])|0);
        dest = (dest+64)|0;
        src = (src+64)|0;
      }
      while ((dest|0) < (aligned_dest_end|0) ) {
        HEAP32[((dest)>>2)]=((HEAP32[((src)>>2)])|0);
        dest = (dest+4)|0;
        src = (src+4)|0;
      }
    } else {
      // In the unaligned copy case, unroll a bit as well.
      aligned_dest_end = (dest_end - 4)|0;
      while ((dest|0) < (aligned_dest_end|0) ) {
        HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
        HEAP8[(((dest)+(1))>>0)]=((HEAP8[(((src)+(1))>>0)])|0);
        HEAP8[(((dest)+(2))>>0)]=((HEAP8[(((src)+(2))>>0)])|0);
        HEAP8[(((dest)+(3))>>0)]=((HEAP8[(((src)+(3))>>0)])|0);
        dest = (dest+4)|0;
        src = (src+4)|0;
      }
    }
    // The remaining unaligned < 4 byte tail.
    while ((dest|0) < (dest_end|0)) {
      HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
      dest = (dest+1)|0;
      src = (src+1)|0;
    }
    return ret|0;
}
function _sbrk(increment) {
    increment = increment|0;
    var oldDynamicTop = 0;
    var oldDynamicTopOnChange = 0;
    var newDynamicTop = 0;
    var totalMemory = 0;
    increment = ((increment + 15) & -16)|0;
    totalMemory = getTotalMemory()|0;

    // Perform a compare-and-swap loop to update the new dynamic top value. This is because
    // this function can becalled simultaneously in multiple threads.
    do {
      oldDynamicTop = Atomics_load(HEAP32, DYNAMICTOP_PTR>>2)|0;
      newDynamicTop = oldDynamicTop + increment | 0;
      // Asking to increase dynamic top to a too high value? In pthreads builds we cannot
      // enlarge memory, so this needs to fail.
      if (((increment|0) > 0 & (newDynamicTop|0) < (oldDynamicTop|0)) // Detect and fail if we would wrap around signed 32-bit int.
        | (newDynamicTop|0) < 0 // Also underflow, sbrk() should be able to be used to subtract.
        | (newDynamicTop|0) > (totalMemory|0)) {
        abortOnCannotGrowMemory()|0;
      }
      // Attempt to update the dynamic top to new value. Another thread may have beat this thread to the update,
      // in which case we will need to start over by iterating the loop body again.
      oldDynamicTopOnChange = Atomics_compareExchange(HEAP32, DYNAMICTOP_PTR>>2, oldDynamicTop|0, newDynamicTop|0)|0;
    } while((oldDynamicTopOnChange|0) != (oldDynamicTop|0));
    return oldDynamicTop|0;
}
function _bitshift64Shl(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      tempRet0 = (high << bits) | ((low&(ander << (32 - bits))) >>> (32 - bits));
      return low << bits;
    }
    tempRet0 = low << (bits - 32);
    return 0;
}
function _memmove(dest, src, num) {
    dest = dest|0; src = src|0; num = num|0;
    var ret = 0;
    if (((src|0) < (dest|0)) & ((dest|0) < ((src + num)|0))) {
      // Unlikely case: Copy backwards in a safe manner
      ret = dest;
      src = (src + num)|0;
      dest = (dest + num)|0;
      while ((num|0) > 0) {
        dest = (dest - 1)|0;
        src = (src - 1)|0;
        num = (num - 1)|0;
        HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
      }
      dest = ret;
    } else {
      _memcpy(dest, src, num) | 0;
    }
    return dest | 0;
}
function _emscripten_is_main_runtime_thread() {
    return __pthread_is_main_runtime_thread|0; // Semantically the same as testing "!ENVIRONMENT_IS_PTHREAD" outside the asm.js scope
}
function _llvm_cttz_i32(x) {
    x = x|0;
    var ret = 0;
    ret = ((HEAP8[(((cttz_i8)+(x & 0xff))>>0)])|0);
    if ((ret|0) < 8) return ret|0;
    ret = ((HEAP8[(((cttz_i8)+((x >> 8)&0xff))>>0)])|0);
    if ((ret|0) < 8) return (ret + 8)|0;
    ret = ((HEAP8[(((cttz_i8)+((x >> 16)&0xff))>>0)])|0);
    if ((ret|0) < 8) return (ret + 16)|0;
    return (((HEAP8[(((cttz_i8)+(x >>> 24))>>0)])|0) + 24)|0;
}
function ___udivmoddi4($a$0, $a$1, $b$0, $b$1, $rem) {
    $a$0 = $a$0 | 0;
    $a$1 = $a$1 | 0;
    $b$0 = $b$0 | 0;
    $b$1 = $b$1 | 0;
    $rem = $rem | 0;
    var $n_sroa_0_0_extract_trunc = 0, $n_sroa_1_4_extract_shift$0 = 0, $n_sroa_1_4_extract_trunc = 0, $d_sroa_0_0_extract_trunc = 0, $d_sroa_1_4_extract_shift$0 = 0, $d_sroa_1_4_extract_trunc = 0, $4 = 0, $17 = 0, $37 = 0, $49 = 0, $51 = 0, $57 = 0, $58 = 0, $66 = 0, $78 = 0, $86 = 0, $88 = 0, $89 = 0, $91 = 0, $92 = 0, $95 = 0, $105 = 0, $117 = 0, $119 = 0, $125 = 0, $126 = 0, $130 = 0, $q_sroa_1_1_ph = 0, $q_sroa_0_1_ph = 0, $r_sroa_1_1_ph = 0, $r_sroa_0_1_ph = 0, $sr_1_ph = 0, $d_sroa_0_0_insert_insert99$0 = 0, $d_sroa_0_0_insert_insert99$1 = 0, $137$0 = 0, $137$1 = 0, $carry_0203 = 0, $sr_1202 = 0, $r_sroa_0_1201 = 0, $r_sroa_1_1200 = 0, $q_sroa_0_1199 = 0, $q_sroa_1_1198 = 0, $147 = 0, $149 = 0, $r_sroa_0_0_insert_insert42$0 = 0, $r_sroa_0_0_insert_insert42$1 = 0, $150$1 = 0, $151$0 = 0, $152 = 0, $154$0 = 0, $r_sroa_0_0_extract_trunc = 0, $r_sroa_1_4_extract_trunc = 0, $155 = 0, $carry_0_lcssa$0 = 0, $carry_0_lcssa$1 = 0, $r_sroa_0_1_lcssa = 0, $r_sroa_1_1_lcssa = 0, $q_sroa_0_1_lcssa = 0, $q_sroa_1_1_lcssa = 0, $q_sroa_0_0_insert_ext75$0 = 0, $q_sroa_0_0_insert_ext75$1 = 0, $q_sroa_0_0_insert_insert77$1 = 0, $_0$0 = 0, $_0$1 = 0;
    $n_sroa_0_0_extract_trunc = $a$0;
    $n_sroa_1_4_extract_shift$0 = $a$1;
    $n_sroa_1_4_extract_trunc = $n_sroa_1_4_extract_shift$0;
    $d_sroa_0_0_extract_trunc = $b$0;
    $d_sroa_1_4_extract_shift$0 = $b$1;
    $d_sroa_1_4_extract_trunc = $d_sroa_1_4_extract_shift$0;
    if (($n_sroa_1_4_extract_trunc | 0) == 0) {
      $4 = ($rem | 0) != 0;
      if (($d_sroa_1_4_extract_trunc | 0) == 0) {
        if ($4) {
          HEAP32[$rem >> 2] = ($n_sroa_0_0_extract_trunc >>> 0) % ($d_sroa_0_0_extract_trunc >>> 0);
          HEAP32[$rem + 4 >> 2] = 0;
        }
        $_0$1 = 0;
        $_0$0 = ($n_sroa_0_0_extract_trunc >>> 0) / ($d_sroa_0_0_extract_trunc >>> 0) >>> 0;
        return (tempRet0 = $_0$1, $_0$0) | 0;
      } else {
        if (!$4) {
          $_0$1 = 0;
          $_0$0 = 0;
          return (tempRet0 = $_0$1, $_0$0) | 0;
        }
        HEAP32[$rem >> 2] = $a$0 & -1;
        HEAP32[$rem + 4 >> 2] = $a$1 & 0;
        $_0$1 = 0;
        $_0$0 = 0;
        return (tempRet0 = $_0$1, $_0$0) | 0;
      }
    }
    $17 = ($d_sroa_1_4_extract_trunc | 0) == 0;
    do {
      if (($d_sroa_0_0_extract_trunc | 0) == 0) {
        if ($17) {
          if (($rem | 0) != 0) {
            HEAP32[$rem >> 2] = ($n_sroa_1_4_extract_trunc >>> 0) % ($d_sroa_0_0_extract_trunc >>> 0);
            HEAP32[$rem + 4 >> 2] = 0;
          }
          $_0$1 = 0;
          $_0$0 = ($n_sroa_1_4_extract_trunc >>> 0) / ($d_sroa_0_0_extract_trunc >>> 0) >>> 0;
          return (tempRet0 = $_0$1, $_0$0) | 0;
        }
        if (($n_sroa_0_0_extract_trunc | 0) == 0) {
          if (($rem | 0) != 0) {
            HEAP32[$rem >> 2] = 0;
            HEAP32[$rem + 4 >> 2] = ($n_sroa_1_4_extract_trunc >>> 0) % ($d_sroa_1_4_extract_trunc >>> 0);
          }
          $_0$1 = 0;
          $_0$0 = ($n_sroa_1_4_extract_trunc >>> 0) / ($d_sroa_1_4_extract_trunc >>> 0) >>> 0;
          return (tempRet0 = $_0$1, $_0$0) | 0;
        }
        $37 = $d_sroa_1_4_extract_trunc - 1 | 0;
        if (($37 & $d_sroa_1_4_extract_trunc | 0) == 0) {
          if (($rem | 0) != 0) {
            HEAP32[$rem >> 2] = 0 | $a$0 & -1;
            HEAP32[$rem + 4 >> 2] = $37 & $n_sroa_1_4_extract_trunc | $a$1 & 0;
          }
          $_0$1 = 0;
          $_0$0 = $n_sroa_1_4_extract_trunc >>> ((_llvm_cttz_i32($d_sroa_1_4_extract_trunc | 0) | 0) >>> 0);
          return (tempRet0 = $_0$1, $_0$0) | 0;
        }
        $49 = Math_clz32($d_sroa_1_4_extract_trunc | 0) | 0;
        $51 = $49 - (Math_clz32($n_sroa_1_4_extract_trunc | 0) | 0) | 0;
        if ($51 >>> 0 <= 30) {
          $57 = $51 + 1 | 0;
          $58 = 31 - $51 | 0;
          $sr_1_ph = $57;
          $r_sroa_0_1_ph = $n_sroa_1_4_extract_trunc << $58 | $n_sroa_0_0_extract_trunc >>> ($57 >>> 0);
          $r_sroa_1_1_ph = $n_sroa_1_4_extract_trunc >>> ($57 >>> 0);
          $q_sroa_0_1_ph = 0;
          $q_sroa_1_1_ph = $n_sroa_0_0_extract_trunc << $58;
          break;
        }
        if (($rem | 0) == 0) {
          $_0$1 = 0;
          $_0$0 = 0;
          return (tempRet0 = $_0$1, $_0$0) | 0;
        }
        HEAP32[$rem >> 2] = 0 | $a$0 & -1;
        HEAP32[$rem + 4 >> 2] = $n_sroa_1_4_extract_shift$0 | $a$1 & 0;
        $_0$1 = 0;
        $_0$0 = 0;
        return (tempRet0 = $_0$1, $_0$0) | 0;
      } else {
        if (!$17) {
          $117 = Math_clz32($d_sroa_1_4_extract_trunc | 0) | 0;
          $119 = $117 - (Math_clz32($n_sroa_1_4_extract_trunc | 0) | 0) | 0;
          if ($119 >>> 0 <= 31) {
            $125 = $119 + 1 | 0;
            $126 = 31 - $119 | 0;
            $130 = $119 - 31 >> 31;
            $sr_1_ph = $125;
            $r_sroa_0_1_ph = $n_sroa_0_0_extract_trunc >>> ($125 >>> 0) & $130 | $n_sroa_1_4_extract_trunc << $126;
            $r_sroa_1_1_ph = $n_sroa_1_4_extract_trunc >>> ($125 >>> 0) & $130;
            $q_sroa_0_1_ph = 0;
            $q_sroa_1_1_ph = $n_sroa_0_0_extract_trunc << $126;
            break;
          }
          if (($rem | 0) == 0) {
            $_0$1 = 0;
            $_0$0 = 0;
            return (tempRet0 = $_0$1, $_0$0) | 0;
          }
          HEAP32[$rem >> 2] = 0 | $a$0 & -1;
          HEAP32[$rem + 4 >> 2] = $n_sroa_1_4_extract_shift$0 | $a$1 & 0;
          $_0$1 = 0;
          $_0$0 = 0;
          return (tempRet0 = $_0$1, $_0$0) | 0;
        }
        $66 = $d_sroa_0_0_extract_trunc - 1 | 0;
        if (($66 & $d_sroa_0_0_extract_trunc | 0) != 0) {
          $86 = (Math_clz32($d_sroa_0_0_extract_trunc | 0) | 0) + 33 | 0;
          $88 = $86 - (Math_clz32($n_sroa_1_4_extract_trunc | 0) | 0) | 0;
          $89 = 64 - $88 | 0;
          $91 = 32 - $88 | 0;
          $92 = $91 >> 31;
          $95 = $88 - 32 | 0;
          $105 = $95 >> 31;
          $sr_1_ph = $88;
          $r_sroa_0_1_ph = $91 - 1 >> 31 & $n_sroa_1_4_extract_trunc >>> ($95 >>> 0) | ($n_sroa_1_4_extract_trunc << $91 | $n_sroa_0_0_extract_trunc >>> ($88 >>> 0)) & $105;
          $r_sroa_1_1_ph = $105 & $n_sroa_1_4_extract_trunc >>> ($88 >>> 0);
          $q_sroa_0_1_ph = $n_sroa_0_0_extract_trunc << $89 & $92;
          $q_sroa_1_1_ph = ($n_sroa_1_4_extract_trunc << $89 | $n_sroa_0_0_extract_trunc >>> ($95 >>> 0)) & $92 | $n_sroa_0_0_extract_trunc << $91 & $88 - 33 >> 31;
          break;
        }
        if (($rem | 0) != 0) {
          HEAP32[$rem >> 2] = $66 & $n_sroa_0_0_extract_trunc;
          HEAP32[$rem + 4 >> 2] = 0;
        }
        if (($d_sroa_0_0_extract_trunc | 0) == 1) {
          $_0$1 = $n_sroa_1_4_extract_shift$0 | $a$1 & 0;
          $_0$0 = 0 | $a$0 & -1;
          return (tempRet0 = $_0$1, $_0$0) | 0;
        } else {
          $78 = _llvm_cttz_i32($d_sroa_0_0_extract_trunc | 0) | 0;
          $_0$1 = 0 | $n_sroa_1_4_extract_trunc >>> ($78 >>> 0);
          $_0$0 = $n_sroa_1_4_extract_trunc << 32 - $78 | $n_sroa_0_0_extract_trunc >>> ($78 >>> 0) | 0;
          return (tempRet0 = $_0$1, $_0$0) | 0;
        }
      }
    } while (0);
    if (($sr_1_ph | 0) == 0) {
      $q_sroa_1_1_lcssa = $q_sroa_1_1_ph;
      $q_sroa_0_1_lcssa = $q_sroa_0_1_ph;
      $r_sroa_1_1_lcssa = $r_sroa_1_1_ph;
      $r_sroa_0_1_lcssa = $r_sroa_0_1_ph;
      $carry_0_lcssa$1 = 0;
      $carry_0_lcssa$0 = 0;
    } else {
      $d_sroa_0_0_insert_insert99$0 = 0 | $b$0 & -1;
      $d_sroa_0_0_insert_insert99$1 = $d_sroa_1_4_extract_shift$0 | $b$1 & 0;
      $137$0 = _i64Add($d_sroa_0_0_insert_insert99$0 | 0, $d_sroa_0_0_insert_insert99$1 | 0, -1, -1) | 0;
      $137$1 = tempRet0;
      $q_sroa_1_1198 = $q_sroa_1_1_ph;
      $q_sroa_0_1199 = $q_sroa_0_1_ph;
      $r_sroa_1_1200 = $r_sroa_1_1_ph;
      $r_sroa_0_1201 = $r_sroa_0_1_ph;
      $sr_1202 = $sr_1_ph;
      $carry_0203 = 0;
      while (1) {
        $147 = $q_sroa_0_1199 >>> 31 | $q_sroa_1_1198 << 1;
        $149 = $carry_0203 | $q_sroa_0_1199 << 1;
        $r_sroa_0_0_insert_insert42$0 = 0 | ($r_sroa_0_1201 << 1 | $q_sroa_1_1198 >>> 31);
        $r_sroa_0_0_insert_insert42$1 = $r_sroa_0_1201 >>> 31 | $r_sroa_1_1200 << 1 | 0;
        _i64Subtract($137$0 | 0, $137$1 | 0, $r_sroa_0_0_insert_insert42$0 | 0, $r_sroa_0_0_insert_insert42$1 | 0) | 0;
        $150$1 = tempRet0;
        $151$0 = $150$1 >> 31 | (($150$1 | 0) < 0 ? -1 : 0) << 1;
        $152 = $151$0 & 1;
        $154$0 = _i64Subtract($r_sroa_0_0_insert_insert42$0 | 0, $r_sroa_0_0_insert_insert42$1 | 0, $151$0 & $d_sroa_0_0_insert_insert99$0 | 0, ((($150$1 | 0) < 0 ? -1 : 0) >> 31 | (($150$1 | 0) < 0 ? -1 : 0) << 1) & $d_sroa_0_0_insert_insert99$1 | 0) | 0;
        $r_sroa_0_0_extract_trunc = $154$0;
        $r_sroa_1_4_extract_trunc = tempRet0;
        $155 = $sr_1202 - 1 | 0;
        if (($155 | 0) == 0) {
          break;
        } else {
          $q_sroa_1_1198 = $147;
          $q_sroa_0_1199 = $149;
          $r_sroa_1_1200 = $r_sroa_1_4_extract_trunc;
          $r_sroa_0_1201 = $r_sroa_0_0_extract_trunc;
          $sr_1202 = $155;
          $carry_0203 = $152;
        }
      }
      $q_sroa_1_1_lcssa = $147;
      $q_sroa_0_1_lcssa = $149;
      $r_sroa_1_1_lcssa = $r_sroa_1_4_extract_trunc;
      $r_sroa_0_1_lcssa = $r_sroa_0_0_extract_trunc;
      $carry_0_lcssa$1 = 0;
      $carry_0_lcssa$0 = $152;
    }
    $q_sroa_0_0_insert_ext75$0 = $q_sroa_0_1_lcssa;
    $q_sroa_0_0_insert_ext75$1 = 0;
    $q_sroa_0_0_insert_insert77$1 = $q_sroa_1_1_lcssa | $q_sroa_0_0_insert_ext75$1;
    if (($rem | 0) != 0) {
      HEAP32[$rem >> 2] = 0 | $r_sroa_0_1_lcssa;
      HEAP32[$rem + 4 >> 2] = $r_sroa_1_1_lcssa | 0;
    }
    $_0$1 = (0 | $q_sroa_0_0_insert_ext75$0) >>> 31 | $q_sroa_0_0_insert_insert77$1 << 1 | ($q_sroa_0_0_insert_ext75$1 << 1 | $q_sroa_0_0_insert_ext75$0 >>> 31) & 0 | $carry_0_lcssa$1;
    $_0$0 = ($q_sroa_0_0_insert_ext75$0 << 1 | 0 >>> 31) & -2 | $carry_0_lcssa$0;
    return (tempRet0 = $_0$1, $_0$0) | 0;
}
function ___uremdi3($a$0, $a$1, $b$0, $b$1) {
    $a$0 = $a$0 | 0;
    $a$1 = $a$1 | 0;
    $b$0 = $b$0 | 0;
    $b$1 = $b$1 | 0;
    var $rem = 0, __stackBase__ = 0;
    __stackBase__ = STACKTOP;
    STACKTOP = STACKTOP + 16 | 0;
    $rem = __stackBase__ | 0;
    ___udivmoddi4($a$0, $a$1, $b$0, $b$1, $rem) | 0;
    STACKTOP = __stackBase__;
    return (tempRet0 = HEAP32[$rem + 4 >> 2] | 0, HEAP32[$rem >> 2] | 0) | 0;
}
function _llvm_bswap_i32(x) {
    x = x|0;
    return (((x&0xff)<<24) | (((x>>8)&0xff)<<16) | (((x>>16)&0xff)<<8) | (x>>>24))|0;
}
function _emscripten_set_current_thread_status(newStatus) {
    newStatus = newStatus|0;
}
function _memset(ptr, value, num) {
    ptr = ptr|0; value = value|0; num = num|0;
    var end = 0, aligned_end = 0, block_aligned_end = 0, value4 = 0;
    end = (ptr + num)|0;

    value = value & 0xff;
    if ((num|0) >= 67 /* 64 bytes for an unrolled loop + 3 bytes for unaligned head*/) {
      while ((ptr&3) != 0) {
        HEAP8[((ptr)>>0)]=value;
        ptr = (ptr+1)|0;
      }

      aligned_end = (end & -4)|0;
      block_aligned_end = (aligned_end - 64)|0;
      value4 = value | (value << 8) | (value << 16) | (value << 24);

      while((ptr|0) <= (block_aligned_end|0)) {
        HEAP32[((ptr)>>2)]=value4;
        HEAP32[(((ptr)+(4))>>2)]=value4;
        HEAP32[(((ptr)+(8))>>2)]=value4;
        HEAP32[(((ptr)+(12))>>2)]=value4;
        HEAP32[(((ptr)+(16))>>2)]=value4;
        HEAP32[(((ptr)+(20))>>2)]=value4;
        HEAP32[(((ptr)+(24))>>2)]=value4;
        HEAP32[(((ptr)+(28))>>2)]=value4;
        HEAP32[(((ptr)+(32))>>2)]=value4;
        HEAP32[(((ptr)+(36))>>2)]=value4;
        HEAP32[(((ptr)+(40))>>2)]=value4;
        HEAP32[(((ptr)+(44))>>2)]=value4;
        HEAP32[(((ptr)+(48))>>2)]=value4;
        HEAP32[(((ptr)+(52))>>2)]=value4;
        HEAP32[(((ptr)+(56))>>2)]=value4;
        HEAP32[(((ptr)+(60))>>2)]=value4;
        ptr = (ptr + 64)|0;
      }

      while ((ptr|0) < (aligned_end|0) ) {
        HEAP32[((ptr)>>2)]=value4;
        ptr = (ptr+4)|0;
      }
    }
    // The remaining bytes.
    while ((ptr|0) < (end|0)) {
      HEAP8[((ptr)>>0)]=value;
      ptr = (ptr+1)|0;
    }
    return (end-num)|0;
}
function ___udivdi3($a$0, $a$1, $b$0, $b$1) {
    $a$0 = $a$0 | 0;
    $a$1 = $a$1 | 0;
    $b$0 = $b$0 | 0;
    $b$1 = $b$1 | 0;
    var $1$0 = 0;
    $1$0 = ___udivmoddi4($a$0, $a$1, $b$0, $b$1, 0) | 0;
    return $1$0 | 0;
}
function ___muldsi3($a, $b) {
    $a = $a | 0;
    $b = $b | 0;
    var $1 = 0, $2 = 0, $3 = 0, $6 = 0, $8 = 0, $11 = 0, $12 = 0;
    $1 = $a & 65535;
    $2 = $b & 65535;
    $3 = Math_imul($2, $1) | 0;
    $6 = $a >>> 16;
    $8 = ($3 >>> 16) + (Math_imul($2, $6) | 0) | 0;
    $11 = $b >>> 16;
    $12 = Math_imul($11, $1) | 0;
    return (tempRet0 = (($8 >>> 16) + (Math_imul($11, $6) | 0) | 0) + ((($8 & 65535) + $12 | 0) >>> 16) | 0, 0 | ($8 + $12 << 16 | $3 & 65535)) | 0;
}
function ___muldi3($a$0, $a$1, $b$0, $b$1) {
    $a$0 = $a$0 | 0;
    $a$1 = $a$1 | 0;
    $b$0 = $b$0 | 0;
    $b$1 = $b$1 | 0;
    var $x_sroa_0_0_extract_trunc = 0, $y_sroa_0_0_extract_trunc = 0, $1$0 = 0, $1$1 = 0, $2 = 0;
    $x_sroa_0_0_extract_trunc = $a$0;
    $y_sroa_0_0_extract_trunc = $b$0;
    $1$0 = ___muldsi3($x_sroa_0_0_extract_trunc, $y_sroa_0_0_extract_trunc) | 0;
    $1$1 = tempRet0;
    $2 = Math_imul($a$1, $y_sroa_0_0_extract_trunc) | 0;
    return (tempRet0 = ((Math_imul($b$1, $x_sroa_0_0_extract_trunc) | 0) + $2 | 0) + $1$1 | $1$1 & 0, 0 | $1$0 & -1) | 0;
}

  
function dynCall_iiii(index,a1,a2,a3) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0;
  return FUNCTION_TABLE_iiii[index&127](a1|0,a2|0,a3|0)|0;
}


function dynCall_viiiii(index,a1,a2,a3,a4,a5) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  FUNCTION_TABLE_viiiii[index&63](a1|0,a2|0,a3|0,a4|0,a5|0);
}


function dynCall_i(index) {
  index = index|0;
  
  return FUNCTION_TABLE_i[index&127]()|0;
}


function dynCall_vi(index,a1) {
  index = index|0;
  a1=a1|0;
  FUNCTION_TABLE_vi[index&127](a1|0);
}


function dynCall_vii(index,a1,a2) {
  index = index|0;
  a1=a1|0; a2=a2|0;
  FUNCTION_TABLE_vii[index&127](a1|0,a2|0);
}


function dynCall_ii(index,a1) {
  index = index|0;
  a1=a1|0;
  return FUNCTION_TABLE_ii[index&127](a1|0)|0;
}


function dynCall_viii(index,a1,a2,a3) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0;
  FUNCTION_TABLE_viii[index&127](a1|0,a2|0,a3|0);
}


function dynCall_v(index) {
  index = index|0;
  
  FUNCTION_TABLE_v[index&127]();
}


function dynCall_iiiii(index,a1,a2,a3,a4) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return FUNCTION_TABLE_iiiii[index&63](a1|0,a2|0,a3|0,a4|0)|0;
}


function dynCall_viiiiii(index,a1,a2,a3,a4,a5,a6) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  FUNCTION_TABLE_viiiiii[index&63](a1|0,a2|0,a3|0,a4|0,a5|0,a6|0);
}


function dynCall_iii(index,a1,a2) {
  index = index|0;
  a1=a1|0; a2=a2|0;
  return FUNCTION_TABLE_iii[index&127](a1|0,a2|0)|0;
}


function dynCall_viiii(index,a1,a2,a3,a4) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  FUNCTION_TABLE_viiii[index&127](a1|0,a2|0,a3|0,a4|0);
}

function b0(p0,p1,p2) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0; nullFunc_iiii(0);return 0;
}
function b1(p0,p1,p2,p3,p4) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0;p3 = p3|0;p4 = p4|0; nullFunc_viiiii(1);
}
function b2() {
 ; nullFunc_i(2);return 0;
}
function b3(p0) {
 p0 = p0|0; nullFunc_vi(3);
}
function b4(p0,p1) {
 p0 = p0|0;p1 = p1|0; nullFunc_vii(4);
}
function b5(p0) {
 p0 = p0|0; nullFunc_ii(5);return 0;
}
function b6(p0,p1,p2) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0; nullFunc_viii(6);
}
function ___cxa_throw__wrapper(p0,p1,p2) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0; ___cxa_throw(p0|0,p1|0,p2|0);
}
function b7() {
 ; nullFunc_v(7);
}
function ___cxa_end_catch__wrapper() {
 ; ___cxa_end_catch();
}
function b8(p0,p1,p2,p3) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0;p3 = p3|0; nullFunc_iiiii(8);return 0;
}
function _pthread_create__wrapper(p0,p1,p2,p3) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0;p3 = p3|0; return _pthread_create(p0|0,p1|0,p2|0,p3|0)|0;
}
function b9(p0,p1,p2,p3,p4,p5) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0;p3 = p3|0;p4 = p4|0;p5 = p5|0; nullFunc_viiiiii(9);
}
function b10(p0,p1) {
 p0 = p0|0;p1 = p1|0; nullFunc_iii(10);return 0;
}
function b11(p0,p1,p2,p3) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0;p3 = p3|0; nullFunc_viiii(11);
}
function ___assert_fail__wrapper(p0,p1,p2,p3) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0;p3 = p3|0; ___assert_fail(p0|0,p1|0,p2|0,p3|0);
}

// EMSCRIPTEN_END_FUNCS
var FUNCTION_TABLE_iiii = [b0,b0,___stdio_write,___stdio_seek,___stdout_write,_sn_write,b0,b0,b0,b0,__ZNKSt3__214error_category10equivalentEiRKNS_15error_conditionE,__ZNKSt3__214error_category10equivalentERKNS_10error_codeEi,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,__ZNK10__cxxabiv117__class_type_info9can_catchEPKNS_16__shim_type_infoERPv,b0,b0,b0
,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,__ZNK10__cxxabiv123__fundamental_type_info9can_catchEPKNS_16__shim_type_infoERPv,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0
,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,__ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6appendEPKcj,b0,b0,b0,b0,b0,b0,b0
,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0,b0
,b0,b0,b0,b0,b0,b0,b0,b0,b0];
var FUNCTION_TABLE_viiiii = [b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,__ZNK10__cxxabiv117__class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib,b1
,b1,b1,__ZNK10__cxxabiv120__si_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,__ZNK10__cxxabiv121__vmi_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1,b1
,b1,b1,b1,b1,b1];
var FUNCTION_TABLE_i = [b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2
,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2
,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,__ZNSt3__219__thread_local_dataEv,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2
,b2,___cxa_get_globals_fast,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2,b2
,b2,b2,b2,b2,b2,b2,b2,b2,b2];
var FUNCTION_TABLE_vi = [b3,b3,b3,b3,b3,b3,__ZNSt3__214error_categoryD2Ev,__ZNSt3__224__generic_error_categoryD0Ev,b3,b3,b3,b3,b3,__ZNSt3__223__system_error_categoryD0Ev,b3,b3,b3,__ZNSt3__212system_errorD2Ev,__ZNSt3__212system_errorD0Ev,b3,b3,__ZN10__cxxabiv116__shim_type_infoD2Ev,__ZN10__cxxabiv117__class_type_infoD0Ev,__ZNK10__cxxabiv116__shim_type_info5noop1Ev,__ZNK10__cxxabiv116__shim_type_info5noop2Ev,b3,b3,b3,b3
,__ZN10__cxxabiv120__si_class_type_infoD0Ev,b3,b3,b3,__ZNSt9bad_allocD2Ev,__ZNSt9bad_allocD0Ev,b3,__ZNSt11logic_errorD2Ev,__ZNSt11logic_errorD0Ev,b3,__ZNSt13runtime_errorD2Ev,__ZNSt13runtime_errorD0Ev,__ZNSt12length_errorD0Ev,__ZN10__cxxabiv123__fundamental_type_infoD0Ev,b3,__ZN10__cxxabiv121__vmi_class_type_infoD0Ev,b3,b3,b3,__ZNSt3__25mutexD2Ev,__ZNSt3__218condition_variableD2Ev,__ZNSt3__25dequeI7MessageNS_9allocatorIS1_EEED2Ev,b3,__ZNKSt3__221__basic_string_commonILb1EE20__throw_length_errorEv,b3,b3,b3,b3,__ZNSt3__25dequeI7MessageNS_9allocatorIS1_EEE9pop_frontEv,b3
,b3,b3,__ZNSt3__215__thread_structC2Ev,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,_undo,_nodtor,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,__ZNSt3__221__thread_specific_ptrINS_15__thread_structEEC2Ev,__ZNSt3__221__thread_specific_ptrINS_15__thread_structEE16__at_thread_exitEPv,__ZNSt3__217__assoc_sub_state12__make_readyEv,b3
,__ZN10__cxxabiv112_GLOBAL__N_19destruct_EPv,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3,b3
,b3,b3,b3,b3,b3,b3,b3,b3,b3];
var FUNCTION_TABLE_vii = [b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4
,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,__ZNSt3__25dequeI7MessageNS_9allocatorIS1_EEE9push_backEOS1_,b4,__ZN7MessageC2ERKS_,b4,b4
,__ZNSt3__26threadC2IRFvvEJEvEEOT_DpOT0_,b4,b4,b4,b4,__ZNSt3__220__throw_system_errorEiPKc,b4,__ZNSt11logic_errorC2EPKc,b4,__ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEE9push_backEOS2_,__ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEE10push_frontERKS2_,b4,__ZNSt3__221__thread_specific_ptrINS_15__thread_structEE11set_pointerEPS1_,b4,b4,b4,b4,b4,b4,b4,b4,__ZNSt3__218__libcpp_refstringC2EPKc,b4,b4,__ZNSt13runtime_errorC2ERKNSt3__212basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE,b4,b4,b4,b4,b4
,b4,b4,_abort_message,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4,b4
,b4,b4,b4,b4,b4,b4,b4,b4,b4];
var FUNCTION_TABLE_ii = [b5,___stdio_close,b5,b5,b5,b5,b5,b5,__ZNKSt3__224__generic_error_category4nameEv,b5,b5,b5,b5,b5,__ZNKSt3__223__system_error_category4nameEv,b5,b5,b5,b5,__ZNKSt13runtime_error4whatEv,b5,b5,b5,b5,b5,b5,b5,b5,b5
,b5,b5,b5,b5,b5,b5,__ZNKSt9bad_alloc4whatEv,b5,b5,__ZNKSt11logic_error4whatEv,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,__Znwj,b5,b5,b5,b5,b5
,b5,b5,b5,__ZNSt3__214__thread_proxyINS_5tupleIJNS_10unique_ptrINS_15__thread_structENS_14default_deleteIS3_EEEEPFvvEEEEEEPvSA_,b5,b5,b5,b5,b5,b5,b5,b5,b5,___emscripten_thread_main,b5,b5,_pthread_cond_destroy,_pthread_cond_broadcast,b5,___pthread_mutex_unlock,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5
,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5,b5
,b5,b5,b5,b5,b5,b5,b5,b5,b5];
var FUNCTION_TABLE_viii = [b6,b6,b6,b6,b6,b6,b6,b6,b6,__ZNKSt3__214error_category23default_error_conditionEi,b6,b6,__ZNKSt3__224__generic_error_category7messageEi,b6,b6,__ZNKSt3__223__system_error_category23default_error_conditionEi,__ZNKSt3__223__system_error_category7messageEi,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6
,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,__ZNSt3__218condition_variable4waitIZ3popvE3__0EEvRNS_11unique_lockINS_5mutexEEET_,b6,b6,b6
,b6,b6,b6,b6,b6,b6,__ZNSt3__214__split_bufferIP7MessageRNS_9allocatorIS2_EEE18__construct_at_endINS_13move_iteratorIPS2_EEEENS_9enable_ifIXsr21__is_forward_iteratorIT_EE5valueEvE4typeESC_SC_,b6,___cxa_throw__wrapper,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,__ZNSt3__212system_error6__initERKNS_10error_codeENS_12basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEEE,b6,__ZNSt3__212system_errorC2ENS_10error_codeEPKc,b6,b6,b6,b6
,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6,b6
,b6,b6,b6,b6,b6,b6,b6,b6,b6];
var FUNCTION_TABLE_v = [b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,__ZL25default_terminate_handlerv,b7,b7,b7,b7,b7,b7,b7,b7
,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,__Z4pushv
,b7,__Z3popv,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,__ZN10__cxxabiv112_GLOBAL__N_110construct_Ev
,b7,b7,b7,___cxa_end_catch__wrapper,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7
,b7,b7,b7,b7,b7,b7,b7,b7,b7];
var FUNCTION_TABLE_iiiii = [b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8
,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8,b8
,b8,b8,b8,b8,_pthread_create__wrapper];
var FUNCTION_TABLE_viiiiii = [b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,__ZNK10__cxxabiv117__class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib,b9,b9
,b9,__ZNK10__cxxabiv120__si_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,__ZNK10__cxxabiv121__vmi_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9,b9
,b9,b9,b9,b9,b9];
var FUNCTION_TABLE_iii = [b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10
,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,_printf,b10,b10,b10,b10,b10,b10,b10
,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,_pthread_cond_wait,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10
,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10,b10
,b10,b10,b10,b10,b10,b10,b10,b10,b10];
var FUNCTION_TABLE_viiii = [b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,__ZNK10__cxxabiv117__class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi
,b11,b11,b11,__ZNK10__cxxabiv120__si_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,__ZNK10__cxxabiv121__vmi_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11
,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,___assert_fail__wrapper,b11,b11,b11,b11,b11,b11,b11,b11,b11
,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11,b11
,b11,b11,b11,b11,b11,b11,b11,b11,b11];

  return { _proxy_main: _proxy_main, _bitshift64Shl: _bitshift64Shl, _emscripten_atomic_load_f32: _emscripten_atomic_load_f32, dynCall_viii: dynCall_viii, _emscripten_is_main_runtime_thread: _emscripten_is_main_runtime_thread, _emscripten_atomic_xor_u64: _emscripten_atomic_xor_u64, ___udivdi3: ___udivdi3, _bitshift64Lshr: _bitshift64Lshr, setThrew: setThrew, _emscripten_atomic_and_u64: _emscripten_atomic_and_u64, _emscripten_sync_run_in_main_thread: _emscripten_sync_run_in_main_thread, _emscripten_sync_run_in_main_thread_4: _emscripten_sync_run_in_main_thread_4, _emscripten_sync_run_in_main_thread_5: _emscripten_sync_run_in_main_thread_5, _emscripten_sync_run_in_main_thread_6: _emscripten_sync_run_in_main_thread_6, _emscripten_sync_run_in_main_thread_7: _emscripten_sync_run_in_main_thread_7, _emscripten_sync_run_in_main_thread_0: _emscripten_sync_run_in_main_thread_0, _emscripten_sync_run_in_main_thread_1: _emscripten_sync_run_in_main_thread_1, _emscripten_sync_run_in_main_thread_2: _emscripten_sync_run_in_main_thread_2, __emscripten_atomic_fetch_and_sub_u64: __emscripten_atomic_fetch_and_sub_u64, _sbrk: _sbrk, dynCall_viiii: dynCall_viiii, _fflush: _fflush, ___cxa_is_pointer_type: ___cxa_is_pointer_type, dynCall_iii: dynCall_iii, _emscripten_atomic_cas_u64: _emscripten_atomic_cas_u64, _memset: _memset, dynCall_ii: dynCall_ii, _emscripten_atomic_sub_u64: _emscripten_atomic_sub_u64, _emscripten_sync_run_in_main_thread_xprintf_varargs: _emscripten_sync_run_in_main_thread_xprintf_varargs, _memcpy: _memcpy, _emscripten_set_thread_name: _emscripten_set_thread_name, ___errno_location: ___errno_location, ___muldi3: ___muldi3, __emscripten_atomic_fetch_and_and_u64: __emscripten_atomic_fetch_and_and_u64, _emscripten_atomic_load_u64: _emscripten_atomic_load_u64, ___uremdi3: ___uremdi3, ___emscripten_pthread_data_constructor: ___emscripten_pthread_data_constructor, dynCall_viiiii: dynCall_viiiii, stackAlloc: stackAlloc, __GLOBAL__sub_I_test_cpp: __GLOBAL__sub_I_test_cpp, _pthread_self: _pthread_self, getTempRet0: getTempRet0, __GLOBAL__sub_I_bind_cpp: __GLOBAL__sub_I_bind_cpp, dynCall_vii: dynCall_vii, setTempRet0: setTempRet0, _i64Add: _i64Add, dynCall_iiii: dynCall_iiii, _emscripten_atomic_store_u64: _emscripten_atomic_store_u64, _emscripten_atomic_load_f64: _emscripten_atomic_load_f64, ___cxa_can_catch: ___cxa_can_catch, _emscripten_sync_run_in_main_thread_3: _emscripten_sync_run_in_main_thread_3, stackRestore: stackRestore, dynCall_iiiii: dynCall_iiiii, __emscripten_atomic_fetch_and_add_u64: __emscripten_atomic_fetch_and_add_u64, _i64Subtract: _i64Subtract, __emscripten_atomic_fetch_and_or_u64: __emscripten_atomic_fetch_and_or_u64, dynCall_i: dynCall_i, _emscripten_async_run_in_main_thread: _emscripten_async_run_in_main_thread, __register_pthread_ptr: __register_pthread_ptr, stackSave: stackSave, _emscripten_atomic_store_f32: _emscripten_atomic_store_f32, _main: _main, _emscripten_main_thread_process_queued_calls: _emscripten_main_thread_process_queued_calls, _emscripten_atomic_add_u64: _emscripten_atomic_add_u64, _free: _free, runPostSets: runPostSets, dynCall_viiiiii: dynCall_viiiiii, _emscripten_atomic_exchange_u64: _emscripten_atomic_exchange_u64, _emscripten_atomic_store_f64: _emscripten_atomic_store_f64, ___pthread_tsd_run_dtors: ___pthread_tsd_run_dtors, _emscripten_set_current_thread_status: _emscripten_set_current_thread_status, _emscripten_get_global_libc: _emscripten_get_global_libc, dynCall_vi: dynCall_vi, _malloc: _malloc, establishStackSpace: establishStackSpace, _emscripten_conditional_set_current_thread_status: _emscripten_conditional_set_current_thread_status, _memmove: _memmove, ___getTypeName: ___getTypeName, _emscripten_atomic_or_u64: _emscripten_atomic_or_u64, dynCall_v: dynCall_v, _llvm_bswap_i32: _llvm_bswap_i32, __emscripten_atomic_fetch_and_xor_u64: __emscripten_atomic_fetch_and_xor_u64 };
})
// EMSCRIPTEN_END_ASM
(Module.asmGlobalArg, Module.asmLibraryArg, buffer);

var real__proxy_main = asm["_proxy_main"]; asm["_proxy_main"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__proxy_main.apply(null, arguments);
};

var real__bitshift64Shl = asm["_bitshift64Shl"]; asm["_bitshift64Shl"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__bitshift64Shl.apply(null, arguments);
};

var real__emscripten_atomic_load_f32 = asm["_emscripten_atomic_load_f32"]; asm["_emscripten_atomic_load_f32"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_load_f32.apply(null, arguments);
};

var real__emscripten_is_main_runtime_thread = asm["_emscripten_is_main_runtime_thread"]; asm["_emscripten_is_main_runtime_thread"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_is_main_runtime_thread.apply(null, arguments);
};

var real_stackSave = asm["stackSave"]; asm["stackSave"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_stackSave.apply(null, arguments);
};

var real__emscripten_atomic_xor_u64 = asm["_emscripten_atomic_xor_u64"]; asm["_emscripten_atomic_xor_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_xor_u64.apply(null, arguments);
};

var real__emscripten_atomic_load_u64 = asm["_emscripten_atomic_load_u64"]; asm["_emscripten_atomic_load_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_load_u64.apply(null, arguments);
};

var real____udivdi3 = asm["___udivdi3"]; asm["___udivdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____udivdi3.apply(null, arguments);
};

var real__bitshift64Lshr = asm["_bitshift64Lshr"]; asm["_bitshift64Lshr"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__bitshift64Lshr.apply(null, arguments);
};

var real_getTempRet0 = asm["getTempRet0"]; asm["getTempRet0"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_getTempRet0.apply(null, arguments);
};

var real___GLOBAL__sub_I_bind_cpp = asm["__GLOBAL__sub_I_bind_cpp"]; asm["__GLOBAL__sub_I_bind_cpp"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real___GLOBAL__sub_I_bind_cpp.apply(null, arguments);
};

var real__emscripten_atomic_and_u64 = asm["_emscripten_atomic_and_u64"]; asm["_emscripten_atomic_and_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_and_u64.apply(null, arguments);
};

var real__emscripten_sync_run_in_main_thread = asm["_emscripten_sync_run_in_main_thread"]; asm["_emscripten_sync_run_in_main_thread"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_sync_run_in_main_thread.apply(null, arguments);
};

var real__emscripten_sync_run_in_main_thread_4 = asm["_emscripten_sync_run_in_main_thread_4"]; asm["_emscripten_sync_run_in_main_thread_4"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_sync_run_in_main_thread_4.apply(null, arguments);
};

var real__emscripten_sync_run_in_main_thread_5 = asm["_emscripten_sync_run_in_main_thread_5"]; asm["_emscripten_sync_run_in_main_thread_5"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_sync_run_in_main_thread_5.apply(null, arguments);
};

var real__emscripten_sync_run_in_main_thread_6 = asm["_emscripten_sync_run_in_main_thread_6"]; asm["_emscripten_sync_run_in_main_thread_6"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_sync_run_in_main_thread_6.apply(null, arguments);
};

var real__emscripten_sync_run_in_main_thread_7 = asm["_emscripten_sync_run_in_main_thread_7"]; asm["_emscripten_sync_run_in_main_thread_7"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_sync_run_in_main_thread_7.apply(null, arguments);
};

var real__emscripten_sync_run_in_main_thread_0 = asm["_emscripten_sync_run_in_main_thread_0"]; asm["_emscripten_sync_run_in_main_thread_0"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_sync_run_in_main_thread_0.apply(null, arguments);
};

var real__emscripten_sync_run_in_main_thread_1 = asm["_emscripten_sync_run_in_main_thread_1"]; asm["_emscripten_sync_run_in_main_thread_1"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_sync_run_in_main_thread_1.apply(null, arguments);
};

var real__emscripten_sync_run_in_main_thread_2 = asm["_emscripten_sync_run_in_main_thread_2"]; asm["_emscripten_sync_run_in_main_thread_2"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_sync_run_in_main_thread_2.apply(null, arguments);
};

var real___emscripten_atomic_fetch_and_sub_u64 = asm["__emscripten_atomic_fetch_and_sub_u64"]; asm["__emscripten_atomic_fetch_and_sub_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real___emscripten_atomic_fetch_and_sub_u64.apply(null, arguments);
};

var real__emscripten_atomic_sub_u64 = asm["_emscripten_atomic_sub_u64"]; asm["_emscripten_atomic_sub_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_sub_u64.apply(null, arguments);
};

var real__fflush = asm["_fflush"]; asm["_fflush"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__fflush.apply(null, arguments);
};

var real____cxa_is_pointer_type = asm["___cxa_is_pointer_type"]; asm["___cxa_is_pointer_type"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____cxa_is_pointer_type.apply(null, arguments);
};

var real__emscripten_atomic_cas_u64 = asm["_emscripten_atomic_cas_u64"]; asm["_emscripten_atomic_cas_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_cas_u64.apply(null, arguments);
};

var real__sbrk = asm["_sbrk"]; asm["_sbrk"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__sbrk.apply(null, arguments);
};

var real__emscripten_sync_run_in_main_thread_xprintf_varargs = asm["_emscripten_sync_run_in_main_thread_xprintf_varargs"]; asm["_emscripten_sync_run_in_main_thread_xprintf_varargs"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_sync_run_in_main_thread_xprintf_varargs.apply(null, arguments);
};

var real__emscripten_set_thread_name = asm["_emscripten_set_thread_name"]; asm["_emscripten_set_thread_name"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_set_thread_name.apply(null, arguments);
};

var real____errno_location = asm["___errno_location"]; asm["___errno_location"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____errno_location.apply(null, arguments);
};

var real____muldi3 = asm["___muldi3"]; asm["___muldi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____muldi3.apply(null, arguments);
};

var real___emscripten_atomic_fetch_and_and_u64 = asm["__emscripten_atomic_fetch_and_and_u64"]; asm["__emscripten_atomic_fetch_and_and_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real___emscripten_atomic_fetch_and_and_u64.apply(null, arguments);
};

var real__emscripten_sync_run_in_main_thread_3 = asm["_emscripten_sync_run_in_main_thread_3"]; asm["_emscripten_sync_run_in_main_thread_3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_sync_run_in_main_thread_3.apply(null, arguments);
};

var real____uremdi3 = asm["___uremdi3"]; asm["___uremdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____uremdi3.apply(null, arguments);
};

var real____emscripten_pthread_data_constructor = asm["___emscripten_pthread_data_constructor"]; asm["___emscripten_pthread_data_constructor"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____emscripten_pthread_data_constructor.apply(null, arguments);
};

var real_stackAlloc = asm["stackAlloc"]; asm["stackAlloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_stackAlloc.apply(null, arguments);
};

var real__i64Subtract = asm["_i64Subtract"]; asm["_i64Subtract"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__i64Subtract.apply(null, arguments);
};

var real__emscripten_atomic_store_u64 = asm["_emscripten_atomic_store_u64"]; asm["_emscripten_atomic_store_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_store_u64.apply(null, arguments);
};

var real_stackRestore = asm["stackRestore"]; asm["stackRestore"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_stackRestore.apply(null, arguments);
};

var real_setTempRet0 = asm["setTempRet0"]; asm["setTempRet0"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_setTempRet0.apply(null, arguments);
};

var real__i64Add = asm["_i64Add"]; asm["_i64Add"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__i64Add.apply(null, arguments);
};

var real__pthread_self = asm["_pthread_self"]; asm["_pthread_self"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__pthread_self.apply(null, arguments);
};

var real__emscripten_atomic_load_f64 = asm["_emscripten_atomic_load_f64"]; asm["_emscripten_atomic_load_f64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_load_f64.apply(null, arguments);
};

var real__emscripten_main_thread_process_queued_calls = asm["_emscripten_main_thread_process_queued_calls"]; asm["_emscripten_main_thread_process_queued_calls"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_main_thread_process_queued_calls.apply(null, arguments);
};

var real__emscripten_get_global_libc = asm["_emscripten_get_global_libc"]; asm["_emscripten_get_global_libc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_get_global_libc.apply(null, arguments);
};

var real___emscripten_atomic_fetch_and_add_u64 = asm["__emscripten_atomic_fetch_and_add_u64"]; asm["__emscripten_atomic_fetch_and_add_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real___emscripten_atomic_fetch_and_add_u64.apply(null, arguments);
};

var real___emscripten_atomic_fetch_and_or_u64 = asm["__emscripten_atomic_fetch_and_or_u64"]; asm["__emscripten_atomic_fetch_and_or_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real___emscripten_atomic_fetch_and_or_u64.apply(null, arguments);
};

var real__emscripten_async_run_in_main_thread = asm["_emscripten_async_run_in_main_thread"]; asm["_emscripten_async_run_in_main_thread"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_async_run_in_main_thread.apply(null, arguments);
};

var real___register_pthread_ptr = asm["__register_pthread_ptr"]; asm["__register_pthread_ptr"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real___register_pthread_ptr.apply(null, arguments);
};

var real__llvm_bswap_i32 = asm["_llvm_bswap_i32"]; asm["_llvm_bswap_i32"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__llvm_bswap_i32.apply(null, arguments);
};

var real__main = asm["_main"]; asm["_main"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__main.apply(null, arguments);
};

var real____cxa_can_catch = asm["___cxa_can_catch"]; asm["___cxa_can_catch"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____cxa_can_catch.apply(null, arguments);
};

var real__emscripten_atomic_add_u64 = asm["_emscripten_atomic_add_u64"]; asm["_emscripten_atomic_add_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_add_u64.apply(null, arguments);
};

var real__free = asm["_free"]; asm["_free"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__free.apply(null, arguments);
};

var real__emscripten_atomic_store_f32 = asm["_emscripten_atomic_store_f32"]; asm["_emscripten_atomic_store_f32"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_store_f32.apply(null, arguments);
};

var real_setThrew = asm["setThrew"]; asm["setThrew"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_setThrew.apply(null, arguments);
};

var real__emscripten_atomic_exchange_u64 = asm["_emscripten_atomic_exchange_u64"]; asm["_emscripten_atomic_exchange_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_exchange_u64.apply(null, arguments);
};

var real__emscripten_atomic_store_f64 = asm["_emscripten_atomic_store_f64"]; asm["_emscripten_atomic_store_f64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_store_f64.apply(null, arguments);
};

var real____pthread_tsd_run_dtors = asm["___pthread_tsd_run_dtors"]; asm["___pthread_tsd_run_dtors"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____pthread_tsd_run_dtors.apply(null, arguments);
};

var real__emscripten_set_current_thread_status = asm["_emscripten_set_current_thread_status"]; asm["_emscripten_set_current_thread_status"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_set_current_thread_status.apply(null, arguments);
};

var real___GLOBAL__sub_I_test_cpp = asm["__GLOBAL__sub_I_test_cpp"]; asm["__GLOBAL__sub_I_test_cpp"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real___GLOBAL__sub_I_test_cpp.apply(null, arguments);
};

var real__malloc = asm["_malloc"]; asm["_malloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__malloc.apply(null, arguments);
};

var real_establishStackSpace = asm["establishStackSpace"]; asm["establishStackSpace"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_establishStackSpace.apply(null, arguments);
};

var real__emscripten_conditional_set_current_thread_status = asm["_emscripten_conditional_set_current_thread_status"]; asm["_emscripten_conditional_set_current_thread_status"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_conditional_set_current_thread_status.apply(null, arguments);
};

var real__memmove = asm["_memmove"]; asm["_memmove"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__memmove.apply(null, arguments);
};

var real____getTypeName = asm["___getTypeName"]; asm["___getTypeName"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____getTypeName.apply(null, arguments);
};

var real__emscripten_atomic_or_u64 = asm["_emscripten_atomic_or_u64"]; asm["_emscripten_atomic_or_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__emscripten_atomic_or_u64.apply(null, arguments);
};

var real___emscripten_atomic_fetch_and_xor_u64 = asm["__emscripten_atomic_fetch_and_xor_u64"]; asm["__emscripten_atomic_fetch_and_xor_u64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real___emscripten_atomic_fetch_and_xor_u64.apply(null, arguments);
};
var _proxy_main = Module["_proxy_main"] = asm["_proxy_main"];
var _bitshift64Shl = Module["_bitshift64Shl"] = asm["_bitshift64Shl"];
var _emscripten_atomic_load_f32 = Module["_emscripten_atomic_load_f32"] = asm["_emscripten_atomic_load_f32"];
var _emscripten_is_main_runtime_thread = Module["_emscripten_is_main_runtime_thread"] = asm["_emscripten_is_main_runtime_thread"];
var stackSave = Module["stackSave"] = asm["stackSave"];
var _emscripten_atomic_xor_u64 = Module["_emscripten_atomic_xor_u64"] = asm["_emscripten_atomic_xor_u64"];
var _emscripten_atomic_load_u64 = Module["_emscripten_atomic_load_u64"] = asm["_emscripten_atomic_load_u64"];
var ___udivdi3 = Module["___udivdi3"] = asm["___udivdi3"];
var _bitshift64Lshr = Module["_bitshift64Lshr"] = asm["_bitshift64Lshr"];
var getTempRet0 = Module["getTempRet0"] = asm["getTempRet0"];
var __GLOBAL__sub_I_bind_cpp = Module["__GLOBAL__sub_I_bind_cpp"] = asm["__GLOBAL__sub_I_bind_cpp"];
var _emscripten_atomic_and_u64 = Module["_emscripten_atomic_and_u64"] = asm["_emscripten_atomic_and_u64"];
var _emscripten_sync_run_in_main_thread = Module["_emscripten_sync_run_in_main_thread"] = asm["_emscripten_sync_run_in_main_thread"];
var _emscripten_sync_run_in_main_thread_4 = Module["_emscripten_sync_run_in_main_thread_4"] = asm["_emscripten_sync_run_in_main_thread_4"];
var _emscripten_sync_run_in_main_thread_5 = Module["_emscripten_sync_run_in_main_thread_5"] = asm["_emscripten_sync_run_in_main_thread_5"];
var _emscripten_sync_run_in_main_thread_6 = Module["_emscripten_sync_run_in_main_thread_6"] = asm["_emscripten_sync_run_in_main_thread_6"];
var _emscripten_sync_run_in_main_thread_7 = Module["_emscripten_sync_run_in_main_thread_7"] = asm["_emscripten_sync_run_in_main_thread_7"];
var _emscripten_sync_run_in_main_thread_0 = Module["_emscripten_sync_run_in_main_thread_0"] = asm["_emscripten_sync_run_in_main_thread_0"];
var _emscripten_sync_run_in_main_thread_1 = Module["_emscripten_sync_run_in_main_thread_1"] = asm["_emscripten_sync_run_in_main_thread_1"];
var _emscripten_sync_run_in_main_thread_2 = Module["_emscripten_sync_run_in_main_thread_2"] = asm["_emscripten_sync_run_in_main_thread_2"];
var __emscripten_atomic_fetch_and_sub_u64 = Module["__emscripten_atomic_fetch_and_sub_u64"] = asm["__emscripten_atomic_fetch_and_sub_u64"];
var _emscripten_atomic_sub_u64 = Module["_emscripten_atomic_sub_u64"] = asm["_emscripten_atomic_sub_u64"];
var _fflush = Module["_fflush"] = asm["_fflush"];
var ___cxa_is_pointer_type = Module["___cxa_is_pointer_type"] = asm["___cxa_is_pointer_type"];
var _emscripten_atomic_cas_u64 = Module["_emscripten_atomic_cas_u64"] = asm["_emscripten_atomic_cas_u64"];
var _memset = Module["_memset"] = asm["_memset"];
var _sbrk = Module["_sbrk"] = asm["_sbrk"];
var _emscripten_sync_run_in_main_thread_xprintf_varargs = Module["_emscripten_sync_run_in_main_thread_xprintf_varargs"] = asm["_emscripten_sync_run_in_main_thread_xprintf_varargs"];
var _memcpy = Module["_memcpy"] = asm["_memcpy"];
var _emscripten_set_thread_name = Module["_emscripten_set_thread_name"] = asm["_emscripten_set_thread_name"];
var ___errno_location = Module["___errno_location"] = asm["___errno_location"];
var ___muldi3 = Module["___muldi3"] = asm["___muldi3"];
var __emscripten_atomic_fetch_and_and_u64 = Module["__emscripten_atomic_fetch_and_and_u64"] = asm["__emscripten_atomic_fetch_and_and_u64"];
var _emscripten_sync_run_in_main_thread_3 = Module["_emscripten_sync_run_in_main_thread_3"] = asm["_emscripten_sync_run_in_main_thread_3"];
var ___uremdi3 = Module["___uremdi3"] = asm["___uremdi3"];
var ___emscripten_pthread_data_constructor = Module["___emscripten_pthread_data_constructor"] = asm["___emscripten_pthread_data_constructor"];
var stackAlloc = Module["stackAlloc"] = asm["stackAlloc"];
var _i64Subtract = Module["_i64Subtract"] = asm["_i64Subtract"];
var _emscripten_atomic_store_u64 = Module["_emscripten_atomic_store_u64"] = asm["_emscripten_atomic_store_u64"];
var stackRestore = Module["stackRestore"] = asm["stackRestore"];
var setTempRet0 = Module["setTempRet0"] = asm["setTempRet0"];
var _i64Add = Module["_i64Add"] = asm["_i64Add"];
var _pthread_self = Module["_pthread_self"] = asm["_pthread_self"];
var _emscripten_atomic_load_f64 = Module["_emscripten_atomic_load_f64"] = asm["_emscripten_atomic_load_f64"];
var _emscripten_main_thread_process_queued_calls = Module["_emscripten_main_thread_process_queued_calls"] = asm["_emscripten_main_thread_process_queued_calls"];
var _emscripten_get_global_libc = Module["_emscripten_get_global_libc"] = asm["_emscripten_get_global_libc"];
var __emscripten_atomic_fetch_and_add_u64 = Module["__emscripten_atomic_fetch_and_add_u64"] = asm["__emscripten_atomic_fetch_and_add_u64"];
var __emscripten_atomic_fetch_and_or_u64 = Module["__emscripten_atomic_fetch_and_or_u64"] = asm["__emscripten_atomic_fetch_and_or_u64"];
var _emscripten_async_run_in_main_thread = Module["_emscripten_async_run_in_main_thread"] = asm["_emscripten_async_run_in_main_thread"];
var __register_pthread_ptr = Module["__register_pthread_ptr"] = asm["__register_pthread_ptr"];
var _llvm_bswap_i32 = Module["_llvm_bswap_i32"] = asm["_llvm_bswap_i32"];
var runPostSets = Module["runPostSets"] = asm["runPostSets"];
var _main = Module["_main"] = asm["_main"];
var ___cxa_can_catch = Module["___cxa_can_catch"] = asm["___cxa_can_catch"];
var _emscripten_atomic_add_u64 = Module["_emscripten_atomic_add_u64"] = asm["_emscripten_atomic_add_u64"];
var _free = Module["_free"] = asm["_free"];
var _emscripten_atomic_store_f32 = Module["_emscripten_atomic_store_f32"] = asm["_emscripten_atomic_store_f32"];
var setThrew = Module["setThrew"] = asm["setThrew"];
var _emscripten_atomic_exchange_u64 = Module["_emscripten_atomic_exchange_u64"] = asm["_emscripten_atomic_exchange_u64"];
var _emscripten_atomic_store_f64 = Module["_emscripten_atomic_store_f64"] = asm["_emscripten_atomic_store_f64"];
var ___pthread_tsd_run_dtors = Module["___pthread_tsd_run_dtors"] = asm["___pthread_tsd_run_dtors"];
var _emscripten_set_current_thread_status = Module["_emscripten_set_current_thread_status"] = asm["_emscripten_set_current_thread_status"];
var __GLOBAL__sub_I_test_cpp = Module["__GLOBAL__sub_I_test_cpp"] = asm["__GLOBAL__sub_I_test_cpp"];
var _malloc = Module["_malloc"] = asm["_malloc"];
var establishStackSpace = Module["establishStackSpace"] = asm["establishStackSpace"];
var _emscripten_conditional_set_current_thread_status = Module["_emscripten_conditional_set_current_thread_status"] = asm["_emscripten_conditional_set_current_thread_status"];
var _memmove = Module["_memmove"] = asm["_memmove"];
var ___getTypeName = Module["___getTypeName"] = asm["___getTypeName"];
var _emscripten_atomic_or_u64 = Module["_emscripten_atomic_or_u64"] = asm["_emscripten_atomic_or_u64"];
var __emscripten_atomic_fetch_and_xor_u64 = Module["__emscripten_atomic_fetch_and_xor_u64"] = asm["__emscripten_atomic_fetch_and_xor_u64"];
var dynCall_iiii = Module["dynCall_iiii"] = asm["dynCall_iiii"];
var dynCall_viiiii = Module["dynCall_viiiii"] = asm["dynCall_viiiii"];
var dynCall_i = Module["dynCall_i"] = asm["dynCall_i"];
var dynCall_vi = Module["dynCall_vi"] = asm["dynCall_vi"];
var dynCall_vii = Module["dynCall_vii"] = asm["dynCall_vii"];
var dynCall_ii = Module["dynCall_ii"] = asm["dynCall_ii"];
var dynCall_viii = Module["dynCall_viii"] = asm["dynCall_viii"];
var dynCall_v = Module["dynCall_v"] = asm["dynCall_v"];
var dynCall_iiiii = Module["dynCall_iiiii"] = asm["dynCall_iiiii"];
var dynCall_viiiiii = Module["dynCall_viiiiii"] = asm["dynCall_viiiiii"];
var dynCall_iii = Module["dynCall_iii"] = asm["dynCall_iii"];
var dynCall_viiii = Module["dynCall_viiii"] = asm["dynCall_viiii"];
;
Runtime.stackAlloc = Module['stackAlloc'];
Runtime.stackSave = Module['stackSave'];
Runtime.stackRestore = Module['stackRestore'];
Runtime.establishStackSpace = Module['establishStackSpace'];
Runtime.setTempRet0 = Module['setTempRet0'];
Runtime.getTempRet0 = Module['getTempRet0'];


// === Auto-generated postamble setup entry stuff ===

Module['asm'] = asm;







/**
 * @constructor
 * @extends {Error}
 */
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
};
ExitStatus.prototype = new Error();
ExitStatus.prototype.constructor = ExitStatus;

var initialStackTop;
var preloadStartTime = null;
var calledMain = false;

dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!Module['calledRun']) run();
  if (!Module['calledRun']) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
}

Module['callMain'] = Module.callMain = function callMain(args) {
  assert(runDependencies == 0, 'cannot call main when async dependencies remain! (listen on __ATMAIN__)');
  assert(__ATPRERUN__.length == 0, 'cannot call main when preRun functions remain to be called');

  args = args || [];

  ensureInitRuntime();

  var argc = args.length+1;
  function pad() {
    for (var i = 0; i < 4-1; i++) {
      argv.push(0);
    }
  }
  var argv = [allocate(intArrayFromString(Module['thisProgram']), 'i8', ALLOC_NORMAL) ];
  pad();
  for (var i = 0; i < argc-1; i = i + 1) {
    argv.push(allocate(intArrayFromString(args[i]), 'i8', ALLOC_NORMAL));
    pad();
  }
  argv.push(0);
  argv = allocate(argv, 'i32', ALLOC_NORMAL);


  try {

    var ret = Module['_main'](argc, argv, 0);


    // if we're not running an evented main loop, it's time to exit
    exit(ret, /* implicit = */ true);
  }
  catch(e) {
    if (e instanceof ExitStatus) {
      // exit() throws this once it's done to make sure execution
      // has been stopped completely
      return;
    } else if (e == 'SimulateInfiniteLoop') {
      // running an evented main loop, don't immediately exit
      Module['noExitRuntime'] = true;
      return;
    } else {
      var toLog = e;
      if (e && typeof e === 'object' && e.stack) {
        toLog = [e, e.stack];
      }
      Module.printErr('exception thrown: ' + toLog);
      Module['quit'](1, e);
    }
  } finally {
    calledMain = true;
  }
}




/** @type {function(Array=)} */
function run(args) {
  args = args || Module['arguments'];

  if (preloadStartTime === null) preloadStartTime = Date.now();

  if (runDependencies > 0) {
    return;
  }

  writeStackCookie();

  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later
  if (Module['calledRun']) return; // run may have just been called through dependencies being fulfilled just in this very frame

  function doRun() {
    if (Module['calledRun']) return; // run may have just been called while the async setStatus time below was happening
    Module['calledRun'] = true;

    if (ABORT) return;

    ensureInitRuntime();

    preMain();

    if (ENVIRONMENT_IS_WEB && preloadStartTime !== null) {
      Module.printErr('pre-main prep time: ' + (Date.now() - preloadStartTime) + ' ms');
    }

    if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();

    if (Module['_main'] && shouldRunNow) Module['callMain'](args);

    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      doRun();
    }, 1);
  } else {
    doRun();
  }
  checkStackCookie();
}
Module['run'] = Module.run = run;

function exit(status, implicit) {
  if (implicit && Module['noExitRuntime']) {
    Module.printErr('exit(' + status + ') implicitly called by end of main(), but noExitRuntime, so not exiting the runtime (you can use emscripten_force_exit, if you want to force a true shutdown)');
    return;
  }

  if (Module['noExitRuntime']) {
    Module.printErr('exit(' + status + ') called, but noExitRuntime, so halting execution but not exiting the runtime or preventing further async execution (you can use emscripten_force_exit, if you want to force a true shutdown)');
  } else {
    PThread.terminateAllThreads();

    ABORT = true;
    EXITSTATUS = status;
    STACKTOP = initialStackTop;

    exitRuntime();

    if (Module['onExit']) Module['onExit'](status);
  }

  if (ENVIRONMENT_IS_NODE) {
    process['exit'](status);
  }
  Module['quit'](status, new ExitStatus(status));
}
Module['exit'] = Module.exit = exit;

var abortDecorators = [];

function abort(what) {
  if (Module['onAbort']) {
    Module['onAbort'](what);
  }

  if (ENVIRONMENT_IS_PTHREAD) console.error('Pthread aborting at ' + new Error().stack);
  if (what !== undefined) {
    Module.print(what);
    Module.printErr(what);
    what = JSON.stringify(what)
  } else {
    what = '';
  }

  ABORT = true;
  EXITSTATUS = 1;

  var extra = '';

  var output = 'abort(' + what + ') at ' + stackTrace() + extra;
  if (abortDecorators) {
    abortDecorators.forEach(function(decorator) {
      output = decorator(output, what);
    });
  }
  throw output;
}
Module['abort'] = Module.abort = abort;

// {{PRE_RUN_ADDITIONS}}

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}

// shouldRunNow refers to calling main(), not run().
var shouldRunNow = true;
if (Module['noInitialRun']) {
  shouldRunNow = false;
}


if (!ENVIRONMENT_IS_PTHREAD) run();

// {{POST_RUN_ADDITIONS}}





// {{MODULE_ADDITIONS}}



