import {mkdir, writeFile} from 'node:fs/promises';
import {KeyPair} from 'near-api-js';

// Writes a new ed25519 key to a private file and prints only the public key.
// The secret never reaches stdout, argv or the environment. Refuses to overwrite.
const [name] = process.argv.slice(2);
if (!name || !/^[a-z][a-z0-9-]{0,30}$/.test(name)) {
  console.error('Usage: tsx scripts/live/keygen.ts <key-name>');
  process.exit(2);
}
const directory = '.local/runtime/live';
await mkdir(directory, {recursive: true, mode: 0o700});
const keyPair = KeyPair.fromRandom('ed25519');
await writeFile(`${directory}/${name}.key`, `${keyPair.toString()}\n`, {mode: 0o600, flag: 'wx'});
console.log(keyPair.getPublicKey().toString());
