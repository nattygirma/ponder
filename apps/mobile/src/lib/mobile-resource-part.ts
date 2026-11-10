type ReadableFileHandle = {
  close: () => void;
  offset: number | null;
  readBytes: (length: number) => Uint8Array<ArrayBuffer>;
};

/** Read only the requested part without passing bytes through React Native's Blob constructor. */
export const readMobileResourcePart = (
  open: () => ReadableFileHandle,
  start: number,
  end: number,
): Uint8Array<ArrayBuffer> => {
  const handle = open();
  try {
    handle.offset = start;
    const bytes = handle.readBytes(end - start);
    if (bytes.byteLength !== end - start) {
      throw new Error("The attachment could not be read completely. Choose the file again.");
    }
    return bytes;
  } finally {
    handle.close();
  }
};
