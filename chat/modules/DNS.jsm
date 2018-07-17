/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This module is responsible for performing DNS queries using ctypes for
// loading system DNS libraries on Linux, Mac and Windows.

if (typeof Components !== "undefined") {
  Components.utils.import("resource://gre/modules/ctypes.jsm");
  Components.utils.import("resource://gre/modules/Services.jsm");
  Components.utils.import('resource://gre/modules/PromiseWorker.jsm');
}

var LOCATION = "resource:///modules/DNS.jsm";

// These constants are luckily shared, but with different names
var NS_T_TXT = 16; // DNS_TYPE_TXT
var NS_T_SRV = 33; // DNS_TYPE_SRV

// For Linux and Mac.
function load_libresolv() {
  this._open();
}

load_libresolv.prototype = {
  library: null,

  // Tries to find and load library.
  _open: function() {
    function findLibrary() {
      let lastException = null;
      let libnames =
        [ctypes.libraryName("resolv.9"), ctypes.libraryName("resolv")];
      for (let libname of libnames) {
        try {
          return ctypes.open(libname);
        } catch (ex) {
          lastException = ex;
        }
      }
      throw new Error("Could not find libresolv in any of " + libnames +
                      " Exception: " + lastException + "\n");
    }

    // Declaring functions to be able to call them.
    function declare(aSymbolNames, ...aArgs) {
      let lastException = null;
      if (!Array.isArray(aSymbolNames))
        aSymbolNames = [aSymbolNames];

      for (let name of aSymbolNames) {
        try {
          return library.declare(name, ...aArgs);
        } catch (ex) {
          lastException = ex;
        }
      }
      library.close();
      throw new Error("Failed to declare " + aSymbolNames + " Exception: " +
                      lastException + "\n");
    }

    let library = this.library = findLibrary();
    this.res_search =
      declare(["res_9_search", "res_search", "__res_search"],
              ctypes.default_abi, ctypes.int, ctypes.char.ptr, ctypes.int,
              ctypes.int, ctypes.unsigned_char.ptr, ctypes.int);
    this.res_query =
      declare(["res_9_query", "res_query", "__res_query"],
              ctypes.default_abi, ctypes.int, ctypes.char.ptr, ctypes.int,
              ctypes.int, ctypes.unsigned_char.ptr, ctypes.int);
    this.dn_expand =
      declare(["res_9_dn_expand", "dn_expand", "__dn_expand"],
              ctypes.default_abi, ctypes.int, ctypes.unsigned_char.ptr,
              ctypes.unsigned_char.ptr, ctypes.unsigned_char.ptr,
              ctypes.char.ptr, ctypes.int);
    this.dn_skipname =
      declare(["res_9_dn_skipname", "dn_skipname", "__dn_skipname"],
              ctypes.default_abi, ctypes.int, ctypes.unsigned_char.ptr,
              ctypes.unsigned_char.ptr);
    this.ns_get16 =
      declare(["res_9_ns_get16", "ns_get16"], ctypes.default_abi,
              ctypes.unsigned_int, ctypes.unsigned_char.ptr);
    this.ns_get32 =
      declare(["res_9_ns_get32", "ns_get32"], ctypes.default_abi,
              ctypes.unsigned_long, ctypes.unsigned_char.ptr);

    this.QUERYBUF_SIZE = 1024;
    this.NS_MAXCDNAME = 255;
    this.NS_HFIXEDSZ = 12;
    this.NS_QFIXEDSZ = 4;
    this.NS_RRFIXEDSZ = 10;
    this.NS_C_IN = 1;
  },

  close: function() {
    this.library.close();
    this.library = null;
  },

  // Maps record to SRVRecord or TXTRecord according to aTypeID and return it.
  _mapAnswer: function(aTypeID, aAnswer, aIdx, aLength) {
    if (aTypeID == NS_T_SRV) {
      let prio = this.ns_get16(aAnswer.addressOfElement(aIdx));
      let weight = this.ns_get16(aAnswer.addressOfElement(aIdx + 2));
      let port = this.ns_get16(aAnswer.addressOfElement(aIdx + 4));

      let hostbuf = ctypes.char.array(this.NS_MAXCDNAME)();
      let hostlen = this.dn_expand(aAnswer.addressOfElement(0),
                                   aAnswer.addressOfElement(aLength),
                                   aAnswer.addressOfElement(aIdx + 6),
                                   hostbuf, this.NS_MAXCDNAME);
      let host = hostlen > -1 ? hostbuf.readString() : null;
      return new SRVRecord(prio, weight, host, port);
    }
    else if (aTypeID == NS_T_TXT) {
      // TODO should only read dataLength characters.
      let data = ctypes.unsigned_char.ptr(aAnswer.addressOfElement(aIdx + 1));
      return new TXTRecord(data.readString());
    }
    return {};
  },

  // Performs a DNS query for aTypeID on a certain address (aName) and returns
  // array of records of aTypeID.
  lookup: function(aName, aTypeID) {
    let qname = ctypes.char.array()(aName);
    let answer = ctypes.unsigned_char.array(this.QUERYBUF_SIZE)();
    let length =
      this.res_search(qname, this.NS_C_IN, aTypeID, answer, this.QUERYBUF_SIZE);

    // There is an error.
    if (length < 0)
      return -1;

    let results = [];
    let idx = this.NS_HFIXEDSZ;

    let qdcount = this.ns_get16(answer.addressOfElement(4));
    let ancount = this.ns_get16(answer.addressOfElement(6));

    for (let qdidx = 0; qdidx < qdcount && idx < length; qdidx++) {
      idx += this.NS_QFIXEDSZ + this.dn_skipname(answer.addressOfElement(idx),
                                                 answer.addressOfElement(length));
    }

    for (let anidx = 0; anidx < ancount && idx < length; anidx++) {
      idx += this.dn_skipname(answer.addressOfElement(idx),
                              answer.addressOfElement(length));
      let rridx = idx;
      let type = this.ns_get16(answer.addressOfElement(rridx));
      let dataLength = this.ns_get16(answer.addressOfElement(rridx + 8));

      idx += this.NS_RRFIXEDSZ;

      if (type === aTypeID) {
        let resource = this._mapAnswer(aTypeID, answer, idx, length);
        resource.type = type;
        resource.nsclass = this.ns_get16(answer.addressOfElement(rridx + 2));
        resource.ttl = this.ns_get32(answer.addressOfElement(rridx + 4))|0;
        results.push(resource);
      }
      idx += dataLength;
    }
    return results;
  }
};

// For Windows.
function load_dnsapi() {
  this._open();
}

load_dnsapi.prototype = {
  library: null,

  // Tries to find and load library.
  _open: function() {
    function declare(aSymbolName, ...aArgs) {
      try {
        return library.declare(aSymbolName, ...aArgs);
      } catch (ex) {
        throw new Error("Failed to declare " + aSymbolName + " Exception: " +
                        ex + "\n");
      }
    }

    let library = this.library = ctypes.open(ctypes.libraryName("DnsAPI"));

    this.DNS_SRV_DATA = ctypes.StructType("DNS_SRV_DATA", [
      { pNameTarget: ctypes.jschar.ptr },
      { wPriority: ctypes.unsigned_short },
      { wWeight: ctypes.unsigned_short },
      { wPort: ctypes.unsigned_short },
      { Pad: ctypes.unsigned_short }
    ]);

    this.DNS_TXT_DATA = ctypes.StructType("DNS_TXT_DATA", [
      { dwStringCount: ctypes.unsigned_long },
      { pStringArray: ctypes.jschar.ptr.array(1) }
    ]);

    this.DNS_RECORD = ctypes.StructType("_DnsRecord");
    this.DNS_RECORD.define([
      { pNext: this.DNS_RECORD.ptr },
      { pName: ctypes.jschar.ptr },
      { wType: ctypes.unsigned_short },
      { wDataLength: ctypes.unsigned_short },
      { Flags: ctypes.unsigned_long },
      { dwTtl: ctypes.unsigned_long },
      { dwReserved: ctypes.unsigned_long },
      { Data: this.DNS_SRV_DATA } // its a union, can be cast to many things
    ]);

    this.PDNS_RECORD = ctypes.PointerType(this.DNS_RECORD);
    this.DnsQuery_W =
      declare("DnsQuery_W", ctypes.winapi_abi, ctypes.long, ctypes.jschar.ptr,
              ctypes.unsigned_short, ctypes.unsigned_long, ctypes.voidptr_t,
              this.PDNS_RECORD.ptr, ctypes.voidptr_t.ptr);
    this.DnsRecordListFree =
      declare("DnsRecordListFree", ctypes.winapi_abi, ctypes.void_t,
              this.PDNS_RECORD, ctypes.int);

    this.ERROR_SUCCESS = ctypes.Int64(0);
    this.DNS_QUERY_STANDARD = 0;
    this.DnsFreeRecordList = 1;
  },

  close: function() {
    this.library.close();
    this.library = null;
  },

  // Maps record to SRVRecord or TXTRecord according to aTypeID and return it.
  _mapAnswer: function(aTypeID, aData) {
    if (aTypeID == NS_T_SRV) {
      let srvdata = ctypes.cast(aData, this.DNS_SRV_DATA);
      return new SRVRecord(srvdata.wPriority, srvdata.wWeight,
                           srvdata.pNameTarget.readString(),
                           srvdata.wPort);
    }
    else if (aTypeID == NS_T_TXT) {
      let txtdata = ctypes.cast(aData, this.DNS_TXT_DATA);
      if (txtdata.dwStringCount > 0)
        return new TXTRecord(txtdata.pStringArray[0].readString());
    }
    return {};
  },

  // Performs a DNS query for aTypeID on a certain address (aName) and returns
  // array of records of aTypeID (e.g. SRVRecord or TXTRecord).
  lookup: function(aName, aTypeID) {
    let queryResultsSet = this.PDNS_RECORD();
    let qname = ctypes.jschar.array()(aName);
    let dnsStatus = this.DnsQuery_W(qname, aTypeID, this.DNS_QUERY_STANDARD,
                                    null, queryResultsSet.address(), null);

    // There is an error.
    if (ctypes.Int64.compare(dnsStatus, this.ERROR_SUCCESS) != 0)
      return -1;

    let results = [];
    for (let presult = queryResultsSet; presult && !presult.isNull();
         presult = presult.contents.pNext) {
      let result = presult.contents;
      if (result.wType == aTypeID) {
        let resource = this._mapAnswer(aTypeID, result.Data);
        resource.type = result.wType;
        resource.nsclass = 0;
        resource.ttl = result.dwTtl | 0;
        results.push(resource);
      }
    }

    this.DnsRecordListFree(queryResultsSet, this.DnsFreeRecordList);
    return results;
  }
};

// Used to make results of different libraries consistent for SRV queries.
function SRVRecord(aPrio, aWeight, aHost, aPort) {
  this.prio = aPrio;
  this.weight = aWeight;
  this.host = aHost;
  this.port = aPort;
}

// Used to make results of different libraries consistent for TXT queries.
function TXTRecord(aData) {
  this.data = aData;
}

if (typeof Components === "undefined") {
  // We are in a worker, wait for our message then execute the wanted method.
  importScripts("resource://gre/modules/workers/require.js");
  let PromiseWorker = require("resource://gre/modules/workers/PromiseWorker.js");

  let worker = new PromiseWorker.AbstractWorker();
  worker.dispatch = function(aMethod, aArgs = []) {
    return self[aMethod](...aArgs);
  },
  worker.postMessage = function(...aArgs) {
    self.postMessage(...aArgs);
  };
  worker.close = function() {
    self.close();
  };
  self.addEventListener("message", msg => worker.handleMessage(msg));

  function execute(aOS, aMethod, aArgs) {
    let DNS = (aOS == "WINNT" ? new load_dnsapi() : new load_libresolv());
    return DNS[aMethod].apply(DNS, aArgs);
  }
}
else {
  // We are loaded as a JSM, provide the async front that will start the
  // worker.
  var dns_async_front = {
    /**
     * Constants for use with the lookup function.
     */
    TXT: NS_T_TXT,
    SRV: NS_T_SRV,

    /**
     * Do an asynchronous DNS lookup. The returned promise resolves with
     * one of the Answer objects as defined above, or rejects with the
     * error from the worker.
     *
     * Example: DNS.lookup("_caldavs._tcp.example.com", DNS.SRV)
     *
     * @param aName           The aName to look up.
     * @param aTypeID         The RR type to look up as a constant.
     * @return                A promise resolved when completed.
     */
    lookup: function(aName, aTypeID) {
      let worker = new BasePromiseWorker(LOCATION);
      return worker.post("execute",
                         [Services.appinfo.OS, "lookup", [...arguments]]);
    },

    /** Convenience functions */
    srv: function(aName) { return this.lookup(aName, NS_T_SRV); },
    txt: function(aName) { return this.lookup(aName, NS_T_TXT); },
  }
  this.DNS = dns_async_front;
  this.EXPORTED_SYMBOLS = ["DNS"];
}
