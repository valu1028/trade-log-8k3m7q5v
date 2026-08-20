const DB_NAME = "trade-log-db";
const DB_VERSION = 1;

const DEFAULT_TAGS = [
  {
    id: "tag-scalping",
    name: "スキャルピング",
    color: "#2563eb",
    archived: false,
    createdAt: "2026-08-20T00:00:00.000Z"
  },
  {
    id: "tag-swing",
    name: "スイング",
    color: "#7957c8",
    archived: false,
    createdAt: "2026-08-20T00:00:00.000Z"
  }
];

let databasePromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("データ保存が中断されました。")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

export function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.addEventListener("upgradeneeded", () => {
        const database = request.result;

        if (!database.objectStoreNames.contains("records")) {
          const records = database.createObjectStore("records", { keyPath: "id" });
          records.createIndex("date", "date", { unique: false });
          records.createIndex("updatedAt", "updatedAt", { unique: false });
        }

        if (!database.objectStoreNames.contains("tags")) {
          const tags = database.createObjectStore("tags", { keyPath: "id" });
          tags.createIndex("name", "name", { unique: false });
        }

        if (!database.objectStoreNames.contains("settings")) {
          database.createObjectStore("settings", { keyPath: "key" });
        }
      });

      request.addEventListener("success", () => {
        const database = request.result;
        database.addEventListener("versionchange", () => database.close());
        resolve(database);
      }, { once: true });

      request.addEventListener("error", () => reject(request.error), { once: true });
      request.addEventListener("blocked", () => reject(new Error("別の画面でアプリが開かれています。すべて閉じてから再読み込みしてください。")), { once: true });
    });
  }

  return databasePromise;
}

async function runTransaction(storeNames, mode, operation) {
  const database = await openDatabase();
  const transaction = database.transaction(storeNames, mode);
  const stores = Object.fromEntries(storeNames.map((name) => [name, transaction.objectStore(name)]));
  const result = await operation(stores, transaction);
  await transactionToPromise(transaction);
  return result;
}

export async function initializeDatabase() {
  await runTransaction(["tags"], "readwrite", async ({ tags }) => {
    const count = await requestToPromise(tags.count());
    if (count === 0) {
      DEFAULT_TAGS.forEach((tag) => tags.add(tag));
    }
  });
}

export async function getAllRecords() {
  return runTransaction(["records"], "readonly", ({ records }) => requestToPromise(records.getAll()));
}

export async function putRecord(record) {
  return runTransaction(["records"], "readwrite", ({ records }) => requestToPromise(records.put(record)));
}

export async function removeRecord(recordId) {
  return runTransaction(["records"], "readwrite", ({ records }) => requestToPromise(records.delete(recordId)));
}

export async function getAllTags({ includeArchived = false } = {}) {
  const tags = await runTransaction(["tags"], "readonly", ({ tags: tagStore }) => requestToPromise(tagStore.getAll()));
  return tags
    .filter((tag) => includeArchived || !tag.archived)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putTag(tag) {
  return runTransaction(["tags"], "readwrite", ({ tags }) => requestToPromise(tags.put(tag)));
}

export async function deleteTagAndDetach(tagId) {
  return runTransaction(["records", "tags", "settings"], "readwrite", async (stores) => {
    const recordsRequest = stores.records.getAll();
    const lastTagIdsRequest = stores.settings.get("lastTagIds");
    const [records, lastTagIdsSetting] = await Promise.all([
      requestToPromise(recordsRequest),
      requestToPromise(lastTagIdsRequest)
    ]);
    const affectedRecords = records.filter((record) => record.tagIds.includes(tagId));
    const updatedAt = new Date().toISOString();

    affectedRecords.forEach((record) => {
      stores.records.put({
        ...record,
        tagIds: record.tagIds.filter((id) => id !== tagId),
        updatedAt
      });
    });
    stores.tags.delete(tagId);

    if (Array.isArray(lastTagIdsSetting?.value)) {
      stores.settings.put({
        key: "lastTagIds",
        value: lastTagIdsSetting.value.filter((id) => id !== tagId)
      });
    }

    return affectedRecords.length;
  });
}

export async function getSetting(key) {
  const item = await runTransaction(["settings"], "readonly", ({ settings }) => requestToPromise(settings.get(key)));
  return item?.value;
}

export async function putSetting(key, value) {
  return runTransaction(["settings"], "readwrite", ({ settings }) => requestToPromise(settings.put({ key, value })));
}

export async function createBackup() {
  const [records, tags, settings] = await Promise.all([
    getAllRecords(),
    getAllTags({ includeArchived: true }),
    runTransaction(["settings"], "readonly", ({ settings: settingsStore }) => requestToPromise(settingsStore.getAll()))
  ]);

  return {
    app: "trade-log-pwa",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    records,
    tags,
    settings
  };
}

function validateBackup(backup) {
  if (!backup || backup.app !== "trade-log-pwa" || backup.schemaVersion !== 1) {
    throw new Error("このアプリのバックアップファイルではありません。");
  }

  if (!Array.isArray(backup.records) || !Array.isArray(backup.tags)) {
    throw new Error("バックアップデータの形式が正しくありません。");
  }

  const recordsValid = backup.records.every((record) => (
    typeof record.id === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.date) &&
    Number.isFinite(record.investment) &&
    Number.isFinite(record.returnAmount) &&
    Array.isArray(record.tagIds)
  ));

  const tagsValid = backup.tags.every((tag) => typeof tag.id === "string" && typeof tag.name === "string");

  if (!recordsValid || !tagsValid) {
    throw new Error("バックアップ内に読み込めない記録があります。");
  }
}

export async function restoreBackup(backup) {
  validateBackup(backup);
  const settings = Array.isArray(backup.settings) ? backup.settings : [];

  await runTransaction(["records", "tags", "settings"], "readwrite", async (stores) => {
    stores.records.clear();
    stores.tags.clear();
    stores.settings.clear();

    backup.records.forEach((record) => stores.records.put(record));
    backup.tags.forEach((tag) => stores.tags.put(tag));
    settings.forEach((setting) => {
      if (setting && typeof setting.key === "string") stores.settings.put(setting);
    });
  });
}
