// Listas de la compra compartidas. Viven en el servidor (no en los datos de cada usuario) porque
// varias personas las editan a la vez: cada cambio es una operación sobre un artículo, sin pisarse.

import { randomUUID } from 'node:crypto';

export const LIMITS = { items: 500, text: 200, quantity: 60, category: 60, name: 60, lists: 20 };

const clip = (v, max) => String(v ?? '').trim().slice(0, max);

/** @param {import('node:sqlite').DatabaseSync} db */
export function shoppingStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopping_lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS shopping_members (
      list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS shopping_items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      quantity TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      checked INTEGER NOT NULL DEFAULT 0,
      added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      position INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS shopping_items_list ON shopping_items(list_id, position);
  `);

  const q = {
    lists: db.prepare(`SELECT l.id, l.name, l.owner_id FROM shopping_lists l JOIN shopping_members m ON m.list_id = l.id WHERE m.user_id = ? ORDER BY l.created_at, l.id`),
    list: db.prepare('SELECT id, name, owner_id FROM shopping_lists WHERE id = ?'),
    members: db.prepare('SELECT u.id, u.username, u.name FROM shopping_members m JOIN users u ON u.id = m.user_id WHERE m.list_id = ? ORDER BY u.id'),
    isMember: db.prepare('SELECT 1 FROM shopping_members WHERE list_id = ? AND user_id = ?'),
    pending: db.prepare('SELECT COUNT(*) AS n FROM shopping_items WHERE list_id = ? AND checked = 0'),
    insertList: db.prepare('INSERT INTO shopping_lists (id, name, owner_id) VALUES (?, ?, ?)'),
    rename: db.prepare('UPDATE shopping_lists SET name = ? WHERE id = ?'),
    deleteList: db.prepare('DELETE FROM shopping_lists WHERE id = ?'),
    insertMember: db.prepare('INSERT OR IGNORE INTO shopping_members (list_id, user_id) VALUES (?, ?)'),
    deleteMember: db.prepare('DELETE FROM shopping_members WHERE list_id = ? AND user_id = ?'),
    countMembers: db.prepare('SELECT COUNT(*) AS n FROM shopping_members WHERE list_id = ?'),
    userByName: db.prepare('SELECT id, username, name FROM users WHERE username = ?'),
    items: db.prepare('SELECT id, text, quantity, category, checked, added_by, position FROM shopping_items WHERE list_id = ? ORDER BY checked, position'),
    countItems: db.prepare('SELECT COUNT(*) AS n FROM shopping_items WHERE list_id = ?'),
    maxPos: db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM shopping_items WHERE list_id = ?'),
    insertItem: db.prepare('INSERT INTO shopping_items (id, list_id, text, quantity, category, added_by, position) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    item: db.prepare('SELECT id, text, quantity, checked FROM shopping_items WHERE id = ? AND list_id = ?'),
    updateItem: db.prepare("UPDATE shopping_items SET text = ?, quantity = ?, checked = ?, updated_at = datetime('now') WHERE id = ? AND list_id = ?"),
    deleteItem: db.prepare('DELETE FROM shopping_items WHERE id = ? AND list_id = ?'),
    clearChecked: db.prepare('DELETE FROM shopping_items WHERE list_id = ? AND checked = 1'),
    countLists: db.prepare('SELECT COUNT(*) AS n FROM shopping_members WHERE user_id = ?'),
  };

  const user = (u) => ({ id: Number(u.id), username: u.username, name: u.name });
  const tx = (fn) => {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const store = {
    isMember: (listId, userId) => !!q.isMember.get(listId, userId),

    listsFor: (userId) =>
      q.lists.all(userId).map((l) => ({ id: l.id, name: l.name, ownerId: Number(l.owner_id), members: q.members.all(l.id).map(user), pending: Number(q.pending.get(l.id).n) })),

    /** Lista con sus miembros y artículos (lo que se envía a los clientes). */
    snapshot(listId) {
      const l = q.list.get(listId);
      if (!l) return null;
      return {
        list: { id: l.id, name: l.name, ownerId: Number(l.owner_id), members: q.members.all(l.id).map(user) },
        items: q.items.all(listId).map((i) => ({ id: i.id, text: i.text, quantity: i.quantity, category: i.category, checked: !!i.checked, addedBy: i.added_by === null ? null : Number(i.added_by) })),
      };
    },

    /** Crea una lista. Con ifNone, si el usuario ya tiene alguna, devuelve la primera (sin duplicar). */
    createList(userId, name, { ifNone = false } = {}) {
      if (ifNone) {
        const first = q.lists.get(userId);
        if (first) return first.id;
      }
      if (Number(q.countLists.get(userId).n) >= LIMITS.lists) throw new Error('Has llegado al máximo de listas.');
      const id = randomUUID();
      tx(() => {
        q.insertList.run(id, clip(name, LIMITS.name) || 'Lista de la compra', userId);
        q.insertMember.run(id, userId);
      });
      return id;
    },

    rename: (listId, name) => q.rename.run(clip(name, LIMITS.name) || 'Lista de la compra', listId),

    /** Comparte la lista con otro usuario por su nombre de usuario. null si no existe. */
    addMember(listId, username) {
      const u = q.userByName.get(clip(username, 64));
      if (!u) return null;
      q.insertMember.run(listId, u.id);
      return user(u);
    },

    /** Sale de la lista; si no queda nadie, se borra. */
    leave(listId, userId) {
      tx(() => {
        q.deleteMember.run(listId, userId);
        if (Number(q.countMembers.get(listId).n) === 0) q.deleteList.run(listId);
      });
    },

    addItems(listId, userId, items) {
      const clean = (Array.isArray(items) ? items : [])
        .map((i) => ({ text: clip(i?.text, LIMITS.text), quantity: clip(i?.quantity, LIMITS.quantity), category: clip(i?.category, LIMITS.category) }))
        .filter((i) => i.text);
      if (!clean.length) throw new Error('No hay nada que añadir.');
      if (Number(q.countItems.get(listId).n) + clean.length > LIMITS.items) throw new Error(`Una lista admite como máximo ${LIMITS.items} artículos.`);
      tx(() => {
        let pos = Number(q.maxPos.get(listId).p);
        for (const i of clean) q.insertItem.run(randomUUID(), listId, i.text, i.quantity, i.category, userId, ++pos);
      });
    },

    /** Cambia texto, cantidad o marcado. false si el artículo ya no existe (lo borró otra persona). */
    updateItem(listId, itemId, patch) {
      const cur = q.item.get(itemId, listId);
      if (!cur) return false;
      const text = patch.text === undefined ? cur.text : clip(patch.text, LIMITS.text) || cur.text;
      const quantity = patch.quantity === undefined ? cur.quantity : clip(patch.quantity, LIMITS.quantity);
      const checked = patch.checked === undefined ? cur.checked : patch.checked ? 1 : 0;
      q.updateItem.run(text, quantity, checked, itemId, listId);
      return true;
    },

    deleteItem: (listId, itemId) => q.deleteItem.run(itemId, listId).changes > 0,
    clearChecked: (listId) => q.clearChecked.run(listId).changes,
  };
  return store;
}
