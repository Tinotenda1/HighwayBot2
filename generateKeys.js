import crypto from "crypto";
import fs from "fs";

// Generate 2048-bit RSA key pair
crypto.generateKeyPair(
  "rsa",
  {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  },
  (err, publicKey, privateKey) => {
    if (err) {
      console.error("Error generating keys:", err);
      return;
    }

    // Save private.pem
    fs.writeFileSync("private.pem", privateKey);
    // Save public.pem
    fs.writeFileSync("public.pem", publicKey);

    console.log("Success! private.pem and public.pem have been generated in your project folder.");
  }
);