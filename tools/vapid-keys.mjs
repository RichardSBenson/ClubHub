/** Make the key pair that lets this site send push notifications. Put the three values in the environment. */
import { generateVapidKeys } from '../packages/infrastructure/push/webpush.mjs';
const k = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:you@your-federation.example`);
console.log('\nKeep the private key secret. Changing the pair later switches every device off until it is turned on again.');
