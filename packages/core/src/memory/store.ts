import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export type MessageRole = 'user' | 'assistant';

export interface Fact {
  id: number;
  text: string;
  /** Saúde, relacionamentos, dinheiro, religião ou política: só comentar se o usuário puxar. */
  sensitive: boolean;
  /** Persona que ouviu o fato (para citação). Fatos têm origem, não dono. */
  personaId: string;
  createdAt: number;
  updatedAt: number;
}

export interface NewFact {
  text: string;
  sensitive: boolean;
  personaId: string;
  sourceMessageId?: number | undefined;
}

export interface FactMatch {
  fact: Fact;
  /** Distância de cosseno: 0 = igual, 2 = oposto. */
  distance: number;
}

interface FactRow {
  id: number;
  text: string;
  sensitive: number;
  persona_id: string;
  created_at: number;
  updated_at: number;
}

const toFact = (r: FactRow): Fact => ({
  id: r.id,
  text: r.text,
  sensitive: r.sensitive === 1,
  personaId: r.persona_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Mudanças no esquema, em ordem. A posição + 1 é a versão (`PRAGMA user_version`). */
const MIGRATIONS = [
  `
  create table meta (key text primary key, value text not null);
  create table conversations (
    id integer primary key,
    started_at integer not null
  );
  create table messages (
    id integer primary key,
    conversation_id integer not null references conversations(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    persona_id text not null,
    created_at integer not null
  );
  create index messages_conversation on messages(conversation_id, id);
  create table facts (
    id integer primary key,
    text text not null,
    sensitive integer not null default 0,
    persona_id text not null,
    source_message_id integer references messages(id) on delete set null,
    created_at integer not null,
    updated_at integer not null
  );
  `,
];

/**
 * Memória em disco (um arquivo SQLite): histórico de conversas, fatos sobre o usuário e
 * um índice vetorial (sqlite-vec) com o embedding de cada fato.
 * Tudo síncrono (better-sqlite3); não faz chamadas de rede.
 */
export class MemoryStore {
  private readonly db: Database.Database;
  private indexDim: number | undefined;

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
  ) {
    this.db = new Database(path);
    sqliteVec.load(this.db);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    const dim = this.getMeta('embedding_dim');
    this.indexDim = dim ? Number(dim) : undefined;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v] as string);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  private getMeta(key: string): string | undefined {
    const row = this.db.prepare('select value from meta where key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'insert into meta(key, value) values (?, ?) on conflict(key) do update set value = excluded.value',
      )
      .run(key, value);
  }

  // --- Histórico ------------------------------------------------------------------------

  startConversation(): number {
    return Number(
      this.db.prepare('insert into conversations(started_at) values (?)').run(this.now())
        .lastInsertRowid,
    );
  }

  addMessage(
    conversationId: number,
    role: MessageRole,
    content: string,
    personaId: string,
  ): number {
    return Number(
      this.db
        .prepare(
          'insert into messages(conversation_id, role, content, persona_id, created_at) values (?, ?, ?, ?, ?)',
        )
        .run(conversationId, role, content, personaId, this.now()).lastInsertRowid,
    );
  }

  messages(conversationId: number): { role: MessageRole; content: string; personaId: string }[] {
    return (
      this.db
        .prepare(
          'select role, content, persona_id from messages where conversation_id = ? order by id',
        )
        .all(conversationId) as { role: MessageRole; content: string; persona_id: string }[]
    ).map((r) => ({ role: r.role, content: r.content, personaId: r.persona_id }));
  }

  messageCount(): number {
    return (this.db.prepare('select count(*) as n from messages').get() as { n: number }).n;
  }

  /** Apaga todas as conversas guardadas (os fatos ficam). */
  clearHistory(): void {
    this.db.transaction(() => {
      this.db.exec('delete from messages; delete from conversations;');
    })();
  }

  // --- Fatos ----------------------------------------------------------------------------

  listFacts(): Fact[] {
    return (this.db.prepare('select * from facts order by created_at, id').all() as FactRow[]).map(
      toFact,
    );
  }

  getFact(id: number): Fact | undefined {
    const row = this.db.prepare('select * from facts where id = ?').get(id) as FactRow | undefined;
    return row && toFact(row);
  }

  factCount(): number {
    return (this.db.prepare('select count(*) as n from facts').get() as { n: number }).n;
  }

  /** Procura um fato com o mesmo texto, sem diferenciar maiúsculas e espaços. */
  findSameText(text: string): Fact | undefined {
    const row = this.db
      .prepare('select * from facts where lower(trim(text)) = lower(trim(?))')
      .get(text) as FactRow | undefined;
    return row && toFact(row);
  }

  addFact(fact: NewFact, embedding?: Float32Array): Fact {
    const t = this.now();
    return this.db.transaction(() => {
      const id = Number(
        this.db
          .prepare(
            'insert into facts(text, sensitive, persona_id, source_message_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
          )
          .run(
            fact.text,
            fact.sensitive ? 1 : 0,
            fact.personaId,
            fact.sourceMessageId ?? null,
            t,
            t,
          ).lastInsertRowid,
      );
      if (embedding) this.setEmbedding(id, embedding);
      return this.getFact(id) as Fact;
    })();
  }

  /** Troca o texto de um fato. O embedding antigo sai; o novo entra se for informado. */
  updateFact(id: number, text: string, embedding?: Float32Array): Fact | undefined {
    return this.db.transaction(() => {
      const changed = this.db
        .prepare('update facts set text = ?, updated_at = ? where id = ?')
        .run(text, this.now(), id).changes;
      if (!changed) return undefined;
      this.removeEmbedding(id);
      if (embedding) this.setEmbedding(id, embedding);
      return this.getFact(id);
    })();
  }

  /** Marca o fato como ouvido de novo (sobe na ordem de "mais recente"). */
  touchFact(id: number): void {
    this.db.prepare('update facts set updated_at = ? where id = ?').run(this.now(), id);
  }

  deleteFact(id: number): boolean {
    return this.db.transaction(() => {
      this.removeEmbedding(id);
      return this.db.prepare('delete from facts where id = ?').run(id).changes > 0;
    })();
  }

  clearFacts(): void {
    this.db.transaction(() => {
      if (this.indexDim) this.db.exec('delete from vec_facts');
      this.db.exec('delete from facts');
    })();
  }

  // --- Índice vetorial ------------------------------------------------------------------

  /**
   * Prepara o índice para um modelo de embedding. Se o modelo ou a dimensão mudaram, o
   * índice é refeito vazio e os fatos precisam ser reindexados (`factsWithoutEmbedding`).
   */
  ensureIndex(model: string, dim: number): void {
    if (!Number.isInteger(dim) || dim < 1 || dim > 8192) {
      throw new Error(`Dimensão de embedding inválida: ${dim}`);
    }
    if (this.getMeta('embedding_model') === model && this.indexDim === dim) return;
    this.db.transaction(() => {
      this.db.exec('drop table if exists vec_facts');
      this.db.exec(
        `create virtual table vec_facts using vec0(embedding float[${dim}] distance_metric=cosine)`,
      );
      this.setMeta('embedding_model', model);
      this.setMeta('embedding_dim', String(dim));
    })();
    this.indexDim = dim;
  }

  get indexedModel(): string | undefined {
    return this.indexDim ? this.getMeta('embedding_model') : undefined;
  }

  factsWithoutEmbedding(): Fact[] {
    if (!this.indexDim) return this.listFacts();
    return (
      this.db
        .prepare('select * from facts where id not in (select rowid from vec_facts) order by id')
        .all() as FactRow[]
    ).map(toFact);
  }

  setEmbedding(id: number, embedding: Float32Array): void {
    if (embedding.length !== this.indexDim) {
      throw new Error(
        `Embedding com ${embedding.length} dimensões; o índice espera ${this.indexDim ?? 'nenhum'}.`,
      );
    }
    this.removeEmbedding(id);
    this.db
      .prepare('insert into vec_facts(rowid, embedding) values (?, ?)')
      .run(BigInt(id), embedding);
  }

  private removeEmbedding(id: number): void {
    if (this.indexDim) this.db.prepare('delete from vec_facts where rowid = ?').run(BigInt(id));
  }

  /** Os `k` fatos mais parecidos com o vetor, do mais próximo para o mais distante. */
  nearestFacts(embedding: Float32Array, k: number): FactMatch[] {
    if (!this.indexDim || embedding.length !== this.indexDim || k < 1) return [];
    const rows = this.db
      .prepare(
        `select f.*, v.distance from vec_facts v join facts f on f.id = v.rowid
         where v.embedding match ? and k = ? order by v.distance`,
      )
      .all(embedding, k) as (FactRow & { distance: number })[];
    return rows.map((r) => ({ fact: toFact(r), distance: r.distance }));
  }
}
