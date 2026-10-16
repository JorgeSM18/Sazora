// Base de datos de Sazora (SQLite integrado en Node, sin dependencias).
// Cada usuario tiene sus propios datos: su lista de alimentos, su pauta, su plan y lo que come.
// ponytail: los datos de cada usuario se guardan como un documento JSON versionado; pasar a tablas
// normalizadas solo si hace falta consultar entre usuarios o el documento crece demasiado.

import { createRequire } from 'node:module';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// require en vez de import: Vitest todavía no reconoce node:sqlite como módulo integrado.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const SESSION_DAYS = 30;
const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_data (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const q = {
    insertUser: db.prepare('INSERT INTO users (username, name, password_hash) VALUES (?, ?, ?)'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE username = ?'),
    listUsers: db.prepare('SELECT id, username, name, created_at FROM users ORDER BY id'),
    deleteUser: db.prepare('DELETE FROM users WHERE username = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare('SELECT u.id, u.username, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)'),
    pruneSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    getData: db.prepare('SELECT data, version FROM user_data WHERE user_id = ?'),
    insertData: db.prepare('INSERT INTO user_data (user_id, data, version) VALUES (?, ?, 1)'),
    updateData: db.prepare("UPDATE user_data SET data = ?, version = version + 1, updated_at = datetime('now') WHERE user_id = ? AND version = ?"),
  };

  const publicUser = (u) => u && { id: Number(u.id), username: u.username, name: u.name };

  return {
    close: () => db.close(),
    /** Copia coherente de la base de datos a otro archivo, aunque haya escrituras en curso. */
    backupTo: (file) => db.prepare('VACUUM INTO ?').run(file),

    createUser(username, name, password) {
      if (!/^[a-z0-9._-]{2,32}$/i.test(username)) throw new Error('Usuario no válido: 2-32 caracteres (letras, números, punto, guion).');
      if (String(password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      q.insertUser.run(username, name || username, hashPassword(password));
      return publicUser(q.userByName.get(username));
    },
    setPassword(username, password) {
      if (String(password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      const changed = q.setPassword.run(hashPassword(password), username).changes > 0;
      if (changed) q.deleteUserSessions.run(username); // cierra las sesiones abiertas
      return changed;
    },
    listUsers: () => q.listUsers.all().map((u) => ({ ...publicUser(u), createdAt: u.created_at })),
    deleteUser: (username) => q.deleteUser.run(username).changes > 0,

    /** Usuario si la contraseña es correcta; null si no (sin revelar cuál de los dos falla). */
    authenticate(username, password) {
      const u = q.userByName.get(String(username));
      // Se calcula el hash aunque el usuario no exista, para no revelar qué usuarios existen por el tiempo de respuesta.
      const ok = verifyPassword(String(password), u?.password_hash ?? DUMMY_HASH);
      return u && ok ? publicUser(u) : null;
    },

    createSession(userId, now = Date.now()) {
      q.pruneSessions.run(now);
      const token = randomBytes(32).toString('base64url');
      q.insertSession.run(hashToken(token), userId, now + SESSION_DAYS * 86_400_000);
      return { token, maxAge: SESSION_DAYS * 86_400 };
    },
    userForSession: (token, now = Date.now()) => (token ? publicUser(q.sessionUser.get(hashToken(token), now)) : null),
    deleteSession: (token) => token && q.deleteSession.run(hashToken(token)),

    getData(userId) {
      const row = q.getData.get(userId);
      return row ? { data: JSON.parse(row.data), version: Number(row.version) } : { data: null, version: 0 };
    },
    /**
     * Guarda si `version` es la última conocida (control optimista). Si otro dispositivo guardó
     * antes, devuelve { conflict: true } con la versión actual para no pisar sus cambios.
     */
    putData(userId, data, version) {
      const json = JSON.stringify(data);
      if (version === 0) {
        try {
          q.insertData.run(userId, json);
          return { conflict: false, version: 1 };
        } catch {
          return { conflict: true, ...this.getData(userId) };
        }
      }
      const ok = q.updateData.run(json, userId, version).changes > 0;
      return ok ? { conflict: false, version: version + 1 } : { conflict: true, ...this.getData(userId) };
    },
  };
}
