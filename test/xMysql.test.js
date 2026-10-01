const test = require("node:test");
const assert = require("node:assert/strict");
const bunyan = require("bunyan");
const { XMySQL } = require("../build/xMysql");

const logger = bunyan.createLogger({ name: "t", level: "fatal" });
const cfg = { master: { ip: "127.0.0.1", port: 3306, id: "u", password: "p", database: "d", pool_limit: 5 } };

test("poolStats: fresh pool reports 0/0/0 and max=pool_limit without connecting", () => {
  const db = new XMySQL("T", cfg, logger);              // createPool은 접속하지 않는다
  assert.deepEqual(db.poolStats(), { active: 0, idle: 0, waiting: 0, max: 5 });
});

test("acquire listener receives wait ms and readOnly for query and transaction", async () => {
  const db = new XMySQL("T", cfg, logger);
  const fakeCon = { release() {}, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {} };
  db.master = { getConnection: async () => { await new Promise((r) => setTimeout(r, 20)); return fakeCon; } };
  const seen = [];
  db.setAcquireListener((ms, ro) => seen.push([ms, ro]));
  assert.equal(await db.query(false, "u", async () => 7), 7);
  assert.equal(await db.transaction(false, "u", async () => 8), 8);
  assert.equal(seen.length, 2);
  assert.ok(seen[0][0] >= 10 && seen[0][1] === false);
  assert.ok(seen[1][0] >= 10 && seen[1][1] === false);
  db.setAcquireListener(() => { throw new Error("listener boom"); });   // 리스너 예외는 삼킨다
  assert.equal(await db.query(false, "u", async () => 9), 9);
});
