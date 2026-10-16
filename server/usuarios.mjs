// Gestión de usuarios desde la terminal del servidor (no hay registro público).
//   npm run usuario -- crear <usuario> "<Nombre>"
//   npm run usuario -- clave <usuario>
//   npm run usuario -- listar
//   npm run usuario -- borrar <usuario>
// La contraseña se pide por teclado sin mostrarse; para scripts se puede pasar en SAZORA_CLAVE.

import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb } from './db.mjs';

const DATA = resolve(process.env.SAZORA_DATA_DIR || join(import.meta.dirname, '..', 'server-data'));
mkdirSync(DATA, { recursive: true });
const db = openDb(join(DATA, 'sazora.db'));

function askHidden(question) {
  if (process.env.SAZORA_CLAVE) return Promise.resolve(process.env.SAZORA_CLAVE);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => process.stdout.write(s.includes(question) ? question : '');
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function newPassword() {
  const a = await askHidden('Contraseña (mínimo 8 caracteres): ');
  const b = process.env.SAZORA_CLAVE ? a : await askHidden('Repite la contraseña: ');
  if (a !== b) throw new Error('Las contraseñas no coinciden.');
  return a;
}

const [cmd, username, name] = process.argv.slice(2);
try {
  if (cmd === 'crear' && username) {
    const user = db.createUser(username, name ?? username, await newPassword());
    console.log(`Usuario creado: ${user.username} (${user.name}).`);
  } else if (cmd === 'clave' && username) {
    console.log(db.setPassword(username, await newPassword()) ? 'Contraseña cambiada. Se han cerrado sus sesiones abiertas.' : 'No existe ese usuario.');
  } else if (cmd === 'listar') {
    const users = db.listUsers();
    console.log(users.length ? users.map((u) => `${u.username}\t${u.name}\t${u.createdAt}`).join('\n') : 'No hay usuarios.');
  } else if (cmd === 'borrar' && username) {
    console.log(db.deleteUser(username) ? `Usuario ${username} borrado con todos sus datos.` : 'No existe ese usuario.');
  } else {
    console.log('Uso: npm run usuario -- crear <usuario> "<Nombre>" | clave <usuario> | listar | borrar <usuario>');
  }
} catch (e) {
  console.error(e.message.includes('UNIQUE') ? 'Ese usuario ya existe.' : e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
