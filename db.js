const DB_NAME = "jagdtrainer_db";
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cards")) db.createObjectStore("cards", { keyPath: "id" });
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
      if (!db.objectStoreNames.contains("stats")) db.createObjectStore("stats", { keyPath: "day" });
      if (!db.objectStoreNames.contains("examRuns")) db.createObjectStore("examRuns", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const result = fn(store);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

export async function dbGetAll(storeName) {
  const db = await openDB();
  return await tx(db, storeName, "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function dbPut(storeName, value) {
  const db = await openDB();
  return await tx(db, storeName, "readwrite", (store) => store.put(value));
}

export async function dbPutMany(storeName, values) {
  const db = await openDB();
  return await tx(db, storeName, "readwrite", (store) => {
    for (const v of values) store.put(v);
  });
}

export async function dbGet(storeName, key) {
  const db = await openDB();
  return await tx(db, storeName, "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function dbClear(storeName) {
  const db = await openDB();
  return await tx(db, storeName, "readwrite", (store) => store.clear());
}
