'use strict';

const { DatabaseSync } = require('node:sqlite');
const { deserialize, serialize } = require('node:v8');

function openCheckpoints(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, checkpoint BLOB NOT NULL);
  `);
  const list = db.prepare('SELECT checkpoint FROM rooms');
  const save = db.prepare('INSERT INTO rooms VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET checkpoint = excluded.checkpoint');
  const remove = db.prepare('DELETE FROM rooms WHERE code = ?');
  return {
    load() { return list.all().map(({ checkpoint }) => deserialize(checkpoint)); },
    write(room, sessions) {
      const { loop, recoveryTimer, savedAt, ...state } = room;
      save.run(room.code, serialize({ format: 1, state, sessions }));
    },
    remove(code) { remove.run(code); }
  };
}

module.exports = { openCheckpoints };
