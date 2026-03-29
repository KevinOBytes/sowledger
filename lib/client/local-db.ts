export type DraftTimer = {
  id: string;
  taskId: string;
  startedAt: string;
  workspaceId: string;
  pomodoroMinutes: number;
  lastSeenAt: string;
};

const DB_NAME = "billabledLocal";
const STORE_NAME = "draftTimers";

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  draftTimers: {
    async put(item: DraftTimer) {
      const connection = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = connection.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      connection.close();
    },
    async delete(id: string) {
      const connection = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = connection.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      connection.close();
    },
    async getAll(): Promise<DraftTimer[]> {
      const connection = await openDb();
      return new Promise((resolve, reject) => {
        const tx = connection.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => {
          resolve(request.result as DraftTimer[]);
          connection.close();
        };
        request.onerror = () => {
          reject(request.error);
          connection.close();
        };
      });
    },
  },
};
