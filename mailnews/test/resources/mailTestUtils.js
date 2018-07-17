/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ['mailTestUtils'];

Components.utils.import("resource://gre/modules/ctypes.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var CC = Components.Constructor;

// See Bug 903946
function avoidUncaughtExceptionInExternalProtocolService() {
  try {
    Services.prefs.setCharPref("helpers.private_mime_types_file",
      Services.prefs.getCharPref("helpers.global_mime_types_file"));
  } catch (ex) {}
  try {
    Services.prefs.setCharPref("helpers.private_mailcap_file",
      Services.prefs.getCharPref("helpers.global_mailcap_file"));
  } catch (ex) {}
}
avoidUncaughtExceptionInExternalProtocolService();

var mailTestUtils = {
  // Loads a file to a string
  // If aCharset is specified, treats the file as being of that charset
  loadFileToString: function(aFile, aCharset) {
    var data = "";
    var fstream = Cc["@mozilla.org/network/file-input-stream;1"]
                    .createInstance(Ci.nsIFileInputStream);
    fstream.init(aFile, -1, 0, 0);

    if (aCharset)
    {
      var cstream = Cc["@mozilla.org/intl/converter-input-stream;1"]
                      .createInstance(Ci.nsIConverterInputStream);
      cstream.init(fstream, aCharset, 4096, 0x0000);
      var str = {};
      while (cstream.readString(4096, str) != 0)
        data += str.value;

      cstream.close();
    }
    else
    {
      var sstream = Cc["@mozilla.org/scriptableinputstream;1"]
                      .createInstance(Ci.nsIScriptableInputStream);

      sstream.init(fstream);

      var str = sstream.read(4096);
      while (str.length > 0) {
        data += str;
        str = sstream.read(4096);
      }

      sstream.close();
    }

    fstream.close();

    return data;
  },

  // Loads a message to a string
  // If aCharset is specified, treats the file as being of that charset
  loadMessageToString: function(aFolder, aMsgHdr, aCharset)
  {
    var data = "";
    let reusable = new Object;
    let bytesLeft = aMsgHdr.messageSize;
    let stream = aFolder.getMsgInputStream(aMsgHdr, reusable);
    if (aCharset)
    {
      let cstream = Cc["@mozilla.org/intl/converter-input-stream;1"]
                      .createInstance(Ci.nsIConverterInputStream);
      cstream.init(stream, aCharset, 4096, 0x0000);
      let str = {};
      let bytesToRead = Math.min(bytesLeft, 4096);
      while (cstream.readString(bytesToRead, str) != 0) {
        data += str.value;
        bytesLeft -= bytesToRead;
        if (bytesLeft <= 0)
          break;
        bytesToRead = Math.min(bytesLeft, 4096);
      }
      cstream.close();
    }
    else
    {
      var sstream = Cc["@mozilla.org/scriptableinputstream;1"]
                      .createInstance(Ci.nsIScriptableInputStream);

      sstream.init(stream);

      let bytesToRead = Math.min(bytesLeft, 4096);
      var str = sstream.read(bytesToRead);
      bytesLeft -= bytesToRead;
      while (str.length > 0) {
        data += str;
        if (bytesLeft <= 0)
          break;
        bytesToRead = Math.min(bytesLeft, 4096);
        str = sstream.read(bytesToRead);
        bytesLeft -= bytesToRead;
      }
      sstream.close();
    }
    stream.close();

    return data;
  },

  /// Gets the first message header in a folder.
  firstMsgHdr: function(folder)
  {
    let enumerator = folder.msgDatabase.EnumerateMessages();
    if (enumerator.hasMoreElements())
      return enumerator.getNext().QueryInterface(Ci.nsIMsgDBHdr);
    return null;
  },

  /// Gets message header number N (0 based index) in a folder.
  getMsgHdrN: function(folder, n)
  {
    let i = 0;
    let enumerator = folder.msgDatabase.EnumerateMessages();
    while (enumerator.hasMoreElements()) {
      let next = enumerator.getNext();
      if (i == n)
        return next.QueryInterface(Ci.nsIMsgDBHdr);
      i++;
    }
    return null;
  },

  /**
   * Returns the file system a particular file is on.
   * Currently supported on Windows only.
   *
   * @param aFile The file to get the file system for.
   * @return The file system a particular file is on, or 'null' if not on Windows.
   */
  get_file_system: function(aFile) {
    if (!("@mozilla.org/windows-registry-key;1" in Cc)) {
      dump("get_file_system() is supported on Windows only.\n");
      return null;
    }

    // Win32 type and other constants.
    const BOOL = ctypes.int32_t;
    const MAX_PATH = 260;

    let kernel32 = ctypes.open("kernel32.dll");

    try {
      // Returns the path of the volume a file is on.
      let GetVolumePathName = kernel32.declare(
        "GetVolumePathNameW",
        ctypes.winapi_abi,
        BOOL,              // return type: 1 indicates success, 0 failure
        ctypes.char16_t.ptr, // in: lpszFileName
        ctypes.char16_t.ptr, // out: lpszVolumePathName
        ctypes.uint32_t    // in: cchBufferLength
      );

      let filePath = aFile.path;
      // The volume path should be at most 1 greater than than the length of the
      // path -- add 1 for a trailing backslash if necessary, and 1 for the
      // terminating null character. Note that the parentheses around the type are
      // necessary for new to apply correctly.
      let volumePath = new (ctypes.char16_t.array(filePath.length + 2));

      if (!GetVolumePathName(filePath, volumePath, volumePath.length)) {
        throw new Error("Unable to get volume path for " + filePath + ", error " +
                        ctypes.winLastError);
      }

      // Returns information about the file system for the given volume path. We just need
      // the file system name.
      let GetVolumeInformation = kernel32.declare(
        "GetVolumeInformationW",
        ctypes.winapi_abi,
        BOOL,                // return type: 1 indicates success, 0 failure
        ctypes.char16_t.ptr,   // in, optional: lpRootPathName
        ctypes.char16_t.ptr,   // out: lpVolumeNameBuffer
        ctypes.uint32_t,     // in: nVolumeNameSize
        ctypes.uint32_t.ptr, // out, optional: lpVolumeSerialNumber
        ctypes.uint32_t.ptr, // out, optional: lpMaximumComponentLength
        ctypes.uint32_t.ptr, // out, optional: lpFileSystemFlags
        ctypes.char16_t.ptr,   // out: lpFileSystemNameBuffer
        ctypes.uint32_t      // in: nFileSystemNameSize
      );

      // We're only interested in the name of the file system.
      let fsName = new (ctypes.char16_t.array(MAX_PATH + 1));

      if (!GetVolumeInformation(volumePath, null, 0, null, null, null, fsName,
                                fsName.length)) {
        throw new Error("Unable to get volume information for " +
                        volumePath.readString() + ", error " + ctypes.winLastError);
      }

      return fsName.readString();
    }
    finally {
      kernel32.close();
    }
  },

  /**
   * Try marking a region of a file as sparse, so that zeros don't consume
   * significant amounts of disk space.  This is a platform-dependent routine and
   * is not supported on all platforms. The current status of this function is:
   * - Windows: Supported, but only on NTFS volumes.
   * - Mac: Not supported.
   * - Linux: As long as you seek to a position before writing, happens automatically
   *   on most file systems, so this function is a no-op.
   *
   * @param aFile The file to mark as sparse.
   * @param aRegionStart The start position of the sparse region, in bytes.
   * @param aRegionBytes The number of bytes to mark as sparse.
   * @return Whether the OS and file system supports marking files as sparse. If
   *          this is true, then the file has been marked as sparse. If this is
   *          false, then the underlying system doesn't support marking files as
   *          sparse. If an exception is thrown, then the system does support
   *          marking files as sparse, but an error occured while doing so.
   *
   */
  mark_file_region_sparse: function(aFile, aRegionStart, aRegionBytes) {
    let fileSystem = this.get_file_system(aFile);
    dump("[mark_file_region_sparse()] File system = " + (fileSystem || "(unknown)") +
           ", file region = at " + this.toMiBString(aRegionStart) +
           " for " + this.toMiBString(aRegionBytes) + "\n");

    if ("@mozilla.org/windows-registry-key;1" in Cc) {
      // On Windows, check whether the drive is NTFS. If it is, proceed.
      // If it isn't, then bail out now, because in all probability it is
      // FAT32, which doesn't support sparse files.
      if (fileSystem != "NTFS")
        return false;

      // Win32 type and other constants.
      const BOOL = ctypes.int32_t;
      const HANDLE = ctypes.voidptr_t;
      // A BOOLEAN (= BYTE = unsigned char) is distinct from a BOOL.
      // http://blogs.msdn.com/b/oldnewthing/archive/2004/12/22/329884.aspx
      const BOOLEAN = ctypes.unsigned_char;
      const FILE_SET_SPARSE_BUFFER = new ctypes.StructType(
        "FILE_SET_SPARSE_BUFFER",
        [{"SetSparse": BOOLEAN}]
      );
      // LARGE_INTEGER is actually a type union. We'll use the int64 representation
      const LARGE_INTEGER = ctypes.int64_t;
      const FILE_ZERO_DATA_INFORMATION = new ctypes.StructType(
        "FILE_ZERO_DATA_INFORMATION",
        [{"FileOffset": LARGE_INTEGER},
         {"BeyondFinalZero": LARGE_INTEGER}]
      );

      const GENERIC_WRITE = 0x40000000;
      const OPEN_ALWAYS = 4;
      const FILE_ATTRIBUTE_NORMAL = 0x80;
      const INVALID_HANDLE_VALUE = new ctypes.Int64(-1);
      const FSCTL_SET_SPARSE = 0x900c4;
      const FSCTL_SET_ZERO_DATA = 0x980c8;
      const FILE_BEGIN = 0;

      let kernel32 = ctypes.open("kernel32.dll");

      try {
        let CreateFile = kernel32.declare(
          "CreateFileW",
          ctypes.winapi_abi,
          HANDLE,            // return type: handle to the file
          ctypes.char16_t.ptr, // in: lpFileName
          ctypes.uint32_t,   // in: dwDesiredAccess
          ctypes.uint32_t,   // in: dwShareMode
          ctypes.voidptr_t,  // in, optional: lpSecurityAttributes (note that
                             // we're cheating here by not declaring a
                             // SECURITY_ATTRIBUTES structure -- that's because
                             // we're going to pass in null anyway)
          ctypes.uint32_t,   // in: dwCreationDisposition
          ctypes.uint32_t,   // in: dwFlagsAndAttributes
          HANDLE             // in, optional: hTemplateFile
        );

        let filePath = aFile.path;
        let hFile = CreateFile(filePath, GENERIC_WRITE, 0, null, OPEN_ALWAYS,
                               FILE_ATTRIBUTE_NORMAL, null);
        let hFileInt = ctypes.cast(hFile, ctypes.intptr_t);
        if (ctypes.Int64.compare(hFileInt.value, INVALID_HANDLE_VALUE) == 0) {
          throw new Error("CreateFile failed for " + filePath + ", error " +
                          ctypes.winLastError);
        }

        try {
          let DeviceIoControl = kernel32.declare(
            "DeviceIoControl",
            ctypes.winapi_abi,
            BOOL,                // return type: 1 indicates success, 0 failure
            HANDLE,              // in: hDevice
            ctypes.uint32_t,     // in: dwIoControlCode
            ctypes.voidptr_t,    // in, optional: lpInBuffer
            ctypes.uint32_t,     // in: nInBufferSize
            ctypes.voidptr_t,    // out, optional: lpOutBuffer
            ctypes.uint32_t,     // in: nOutBufferSize
            ctypes.uint32_t.ptr, // out, optional: lpBytesReturned
            ctypes.voidptr_t     // inout, optional: lpOverlapped (again, we're
                                 // cheating here by not having this as an
                                 // OVERLAPPED structure
          );
          // bytesReturned needs to be passed in, even though it's meaningless
          let bytesReturned = new ctypes.uint32_t();
          let sparseBuffer = new FILE_SET_SPARSE_BUFFER();
          sparseBuffer.SetSparse = 1;

          // Mark the file as sparse
          if (!DeviceIoControl(hFile, FSCTL_SET_SPARSE, sparseBuffer.address(),
                               FILE_SET_SPARSE_BUFFER.size, null, 0,
                               bytesReturned.address(), null)) {
            throw new Error("Unable to mark file as sparse, error " +
                            ctypes.winLastError);
          }

          let zdInfo = new FILE_ZERO_DATA_INFORMATION();
          zdInfo.FileOffset = aRegionStart;
          let regionEnd = aRegionStart + aRegionBytes;
          zdInfo.BeyondFinalZero = regionEnd;
          // Mark the region as a sparse region
          if (!DeviceIoControl(hFile, FSCTL_SET_ZERO_DATA, zdInfo.address(),
                               FILE_ZERO_DATA_INFORMATION.size, null, 0,
                               bytesReturned.address(), null)) {
            throw new Error("Unable to mark region as zero, error " +
                            ctypes.winLastError);
          }

          // Move to past the sparse region and mark it as the end of the file. The
          // above DeviceIoControl call is useless unless followed by this.
          let SetFilePointerEx = kernel32.declare(
            "SetFilePointerEx",
            ctypes.winapi_abi,
            BOOL,              // return type: 1 indicates success, 0 failure
            HANDLE,            // in: hFile
            LARGE_INTEGER,     // in: liDistanceToMove
            LARGE_INTEGER.ptr, // out, optional: lpNewFilePointer
            ctypes.uint32_t    // in: dwMoveMethod
          );
          if (!SetFilePointerEx(hFile, regionEnd, null, FILE_BEGIN)) {
            throw new Error("Unable to set file pointer to end, error " +
                            ctypes.winLastError);
          }

          let SetEndOfFile = kernel32.declare(
            "SetEndOfFile",
            ctypes.winapi_abi,
            BOOL,  // return type: 1 indicates success, 0 failure
            HANDLE // in: hFile
          );
          if (!SetEndOfFile(hFile))
            throw new Error("Unable to set end of file, error " + ctypes.winLastError);

          return true;
        }
        finally {
          let CloseHandle = kernel32.declare(
            "CloseHandle",
            ctypes.winapi_abi,
            BOOL,  // return type: 1 indicates success, 0 failure
            HANDLE // in: hObject
          );
          CloseHandle(hFile);
        }
      }
      finally {
        kernel32.close();
      }
    }
    else if ("nsILocalFileMac" in Ci) {
      // Macs don't support marking files as sparse.
      return false;
    }
    else {
      // Assuming Unix here. Unix file systems generally automatically sparsify
      // files.
      return true;
    }
  },

  /**
   * Converts a size in bytes into its mebibytes string representation.
   * NB: 1 MiB = 1024 * 1024 = 1048576 B.
   *
   * @param aSize The size in bytes.
   * @return A string representing the size in medibytes.
   */
  toMiBString: function(aSize) {
    return (aSize / 1048576) + " MiB";
  },

  /**
   * A variant of do_timeout that accepts an actual function instead of
   *  requiring you to pass a string to evaluate.  If the function throws an
   *  exception when invoked, we will use do_throw to ensure that the test fails.
   *
   * @param aDelayInMS The number of milliseconds to wait before firing the timer.
   * @param aFunc The function to invoke when the timer fires.
   * @param aFuncThis Optional 'this' pointer to use.
   * @param aFuncArgs Optional list of arguments to pass to the function.
   */
  do_timeout_function: function(aDelayInMS, aFunc, aFuncThis, aFuncArgs) {
    let timer = Components.classes["@mozilla.org/timer;1"]
                          .createInstance(Components.interfaces.nsITimer);
    let wrappedFunc = function() {
      try {
        aFunc.apply(aFuncThis, aFuncArgs);
      }
      catch (ex) {
        // we want to make sure that if the thing we call throws an exception,
        //  that this terminates the test.
        do_throw(ex);
      }
    };
    timer.initWithCallback(wrappedFunc, aDelayInMS,
      Components.interfaces.nsITimer.TYPE_ONE_SHOT);
  },

  /**
   * Ensure the given nsIMsgFolder's database is up-to-date, calling the provided
   *  callback once the folder has been loaded.  (This may be instantly or
   *  after a re-parse.)
   *
   * @param aFolder The nsIMsgFolder whose database you want to ensure is
   *     up-to-date.
   * @param aCallback The callback function to invoke once the folder has been
   *     loaded.
   * @param aCallbackThis The 'this' to use when calling the callback.  Pass null
   *     if your callback does not rely on 'this'.
   * @param aCallbackArgs A list of arguments to pass to the callback via apply.
   *     If you provide [1,2,3], we will effectively call:
   *     aCallbackThis.aCallback(1,2,3);
   * @param [aSomeoneElseWillTriggerTheUpdate=false] If this is true, we do not
   *     trigger the updateFolder call and it is assumed someone else is taking
   *     care of that.
   */
  updateFolderAndNotify: function(aFolder, aCallback, aCallbackThis,
      aCallbackArgs, aSomeoneElseWillTriggerTheUpdate) {
    // register for the folder loaded notification ahead of time... even though
    //  we may not need it...
    let atomService = Cc["@mozilla.org/atom-service;1"]
                        .getService(Ci.nsIAtomService);
    let kFolderLoadedAtom = atomService.getAtom("FolderLoaded");

    let folderListener = {
      OnItemEvent: function (aEventFolder, aEvent) {
        if (aEvent == kFolderLoadedAtom && aFolder.URI == aEventFolder.URI) {
          MailServices.mailSession.RemoveFolderListener(this);
          aCallback.apply(aCallbackThis, aCallbackArgs);
        }
      }
    };

    MailServices.mailSession.AddFolderListener(folderListener, Ci.nsIFolderListener.event);

    if (!aSomeoneElseWillTriggerTheUpdate)
      aFolder.updateFolder(null);
  },

  /**
   * For when you want to compare elements non-strictly.
   */
  non_strict_index_of: function(aArray, aElem) {
    for (let [i, elem] in Iterator(aArray)) {
      if (elem == aElem)
        return i;
    }
    return -1;
  },

  /**
   * Registers a directory provider for UMimTyp for when its needed.
   */
  registerUMimTypProvider: function() {
    if (this._providerSvc)
      return;

    // Register our own provider for the profile directory.
    // It will simply return the current directory.
    const provider = {
      getFile : function(prop, persistent) {
        if (prop == "UMimTyp") {
          var mimeTypes = Services.dirsvc.get("ProfD", Ci.nsIFile);
          mimeTypes.append("mimeTypes.rdf");
          return mimeTypes;
        }
        throw Components.results.NS_ERROR_FAILURE;
      },

      QueryInterface:
        XPCOMUtils.generateQI([Ci.nsIDirectoryServiceProvider])
    };

    this._providerSvc = provider;
    Services.dirsvc.QueryInterface(Ci.nsIDirectoryService)
                   .registerProvider(provider);
  }
};
