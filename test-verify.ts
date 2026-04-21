import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { consumeMagicLink, createMagicLink } from "./lib/auth";

async function main() {
  try {
    console.log("Generating magic link...");
    const token = await createMagicLink("kevin@kevinbytes.com");
    console.log("Generated token:", token);

    console.log("Consuming magic link...");
    const result = await consumeMagicLink(token);
    console.log("Verified successfully. User ID:", result.user.id);
  } catch (error) {
    console.error("FULL ERROR:");
    console.error(error);
  }
}

main();
