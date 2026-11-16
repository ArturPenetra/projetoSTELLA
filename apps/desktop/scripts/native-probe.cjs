// Executado DENTRO do Electron (ELECTRON_RUN_AS_NODE=1), com o ABI do Electron.
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const db = new Database(':memory:');
sqliteVec.load(db);

const { sqlite, vec } = db.prepare('select sqlite_version() as sqlite, vec_version() as vec').get();

db.exec('create virtual table t using vec0(embedding float[3])');
const insert = db.prepare('insert into t(rowid, embedding) values (?, ?)');
insert.run(1n, new Float32Array([1, 0, 0]));
insert.run(2n, new Float32Array([0, 1, 0]));
const nearest = db
  .prepare('select rowid from t where embedding match ? order by distance limit 1')
  .get(new Float32Array([0.9, 0.1, 0]));

if (nearest.rowid !== 1) {
  console.error('Busca vetorial retornou resultado inesperado:', nearest);
  process.exit(1);
}

console.log(
  `OK nativos no Electron ${process.versions.electron}: SQLite ${sqlite}, sqlite-vec ${vec}, busca vetorial funcionando.`,
);
