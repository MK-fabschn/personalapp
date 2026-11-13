// Erzeugt den Argon2-Hash für APP_PASSWORD_HASH.
// Verwendung: npm run hash-password -- "deinPasswort"
import { hash } from '@node-rs/argon2';

const pw = process.argv[2];
if (!pw || pw.length < 10) {
	console.error('Bitte ein Passwort mit mindestens 10 Zeichen angeben.');
	process.exit(1);
}
const h = await hash(pw);
// Für die .env von docker compose muss jedes $ verdoppelt werden
console.log(`APP_PASSWORD_HASH=${h.replaceAll('$', '$$$$')}`);
