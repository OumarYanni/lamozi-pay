// Importe le module dotenv pour charger les variables d'environnement depuis le fichier .env
import dotenv from "dotenv";
// Exécute la configuration de dotenv pour accéder aux variables d'environnement
dotenv.config();

// Importe les modules nécessaires depuis la librairie @shopify/shopify-api
import {
  Shopify,
  shopifyApi,
  ApiVersion,
  Session,
  DeliveryMethod,
  GraphqlClient,
} from "@shopify/shopify-api";

import { restResources } from "@shopify/shopify-api/rest/admin/2024-01";

// La ligne suivante est commentée car elle montre une alternative d'importation pour paydunya qui n'est pas utilisée ici
//import paydunya from 'paydunya'
var paydunya = require("paydunya");
//import { setup, store } from "./paydunyaWrapper.cjs";
// Importe express, un framework pour créer des applications web avec Node.js
import express, { response } from "express";
// Importe bodyParser, un middleware Express pour analyser le corps des requêtes HTTP
import bodyParser from "body-parser";
// Importe le module crypto pour effectuer des opérations cryptographiques, comme la génération de hachages
import crypto from "crypto";

// Importe l'adaptateur Node.js spécifique pour la Shopify API pour assurer la compatibilité
import "@shopify/shopify-api/adapters/node";

// Initialise la Shopify API en utilisant la fonction shopifyApi avec les paramètres requis
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES.split(","), // Assurez-vous que les scopes sont définis dans votre .env et séparés par des virgules
  hostName: process.env.HOST_NAME, // Votre nom de domaine ngrok ou public
  isEmbeddedApp: false, // Mettez à true si votre application est embarquée
  apiVersion: ApiVersion.January24, // Utilisez la version de l'API que vous préférez
  isCustomStoreApp: true,
  adminApiAccessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  restResources,
});

// Crée une instance de l'application Express
const app = express();

// Initialisation de l'objet session
const session = shopify.session.customAppSession(
  process.env.SHOPIFY_SHOP_DOMAIN
);

// Configure PayDunya en utilisant les variables d'environnement pour les clés API et autres paramètres
var setup = new paydunya.Setup({
  masterKey: process.env.PAYDUNYA_MASTER_KEY,
  privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
  publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
  token: process.env.PAYDUNYA_TOKEN,
  mode: "test", // Utilisez 'live' pour le mode production
});

// Configure les informations de la boutique pour PayDunya
var store = new paydunya.Store({
  name: process.env.STORE_NAME, // Par exemple: 'Ma Boutique'
  tagline: process.env.STORE_TAGLINE,
  phoneNumber: process.env.STORE_PHONE,
  postalAddress: process.env.STORE_ADDRESS,
  websiteURL: process.env.STORE_WEBSITE,
  logoURL: process.env.STORE_LOGO_URL,
  callbackURL: process.env.STORE_GLOBAL_CALLBACK_URL,
  cancelURL: process.env.STORE_GLOBAL_CANCEL_URL,
  returnURL: process.env.STORE_GLOBAL_RETURN_URL,
});

// Middleware pour parser le JSON
app.use(
  bodyParser.json({
    verify: (req, res, buf, encoding) => {
      if (buf && buf.length) {
        req.rawBody = buf.toString(encoding || "utf8");
      }
    },
  })
);

//Ajouter le Middleware pour Parser les Données Encodées en URL
app.use(bodyParser.urlencoded({ extended: true }));

// Définit le port d'écoute du serveur, en utilisant une variable d'environnement ou 8080 par défaut
const PORT = process.env.PORT || 8080;

// Route pour gérer le Webhook de création de commande
app.post("/webhook/orders/create", async (req, res) => {
  try {
    const hmacReceived = req.headers["x-shopify-hmac-sha256"];
    const body = req.rawBody;

    if (!verifyWebhookHmac(body, hmacReceived)) {
      return res.status(401).send("Échec de validation HMAC.");
    }

    const newOrder = req.body;

    // Création de l'instance de la facture PayDunya
    var invoice = new paydunya.CheckoutInvoice(setup, store);

    invoice.description = "Order ID: " + newOrder.id;

    newOrder.line_items.forEach((item) => {
      invoice.addItem(
        item.name,
        item.quantity,
        parseFloat(item.price),
        item.quantity * parseFloat(item.price),
        item.title
      );
    });

    invoice.totalAmount = parseFloat(newOrder.current_total_price);

    await invoice.create();

    res.status(200).send({ redirect_url: invoice.url });
  } catch (error) {
    console.error("Erreur lors de la création de la facture:", error);
    res.status(500).send("Erreur lors de la création de la facture.");
  }
});

// Fonction pour vérifier le HMAC
function verifyWebhookHmac(data, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hash = crypto
    .createHmac("sha256", secret)
    .update(data, "utf8")
    .digest("base64");
  return hash === hmacHeader;
}

//Fonction fournie par le support Paydunya pour générer le hash de la masterkey pour vérification des requêtes en provenance de leur serveur
function generateSHA512Hash(masterKey) {
  try {
    const masterKeyBuffer = Buffer.from(masterKey, "utf-8");
    const hash = crypto.createHash("sha512");
    hash.update(masterKeyBuffer);
    return hash.digest("hex");
  } catch (error) {
    console.error("Erreur lors de la génération du hash:", error);
    throw new Error("Erreur lors de la génération du hash.");
  }
}

async function markOrderAsPaid(session, orderId) {
  if (!orderId || typeof orderId !== "string") {
    console.error("ID de commande invalide ou manquant.");
    return false;
  }

  const mutation = `mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) {
    orderMarkAsPaid(input: $input) {
      order {
        id
        displayFinancialStatus
      }
      userErrors {
        field
        message
      }
    }
  }`;

  try {
    const client = new shopify.clients.Graphql({
      session,
      apiVersion: ApiVersion.January24,
    });

    const response = await client.request(mutation, {
      variables: {
        input: {
          id: `gid://shopify/Order/${orderId}`,
        },
      },
    });

    if (response.errors) {
      console.error("Erreur lors de la mutation GraphQL:", response.errors);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Erreur lors de la mutation GraphQL:", error);
    return false;
  }
}

// Route pour recevoir les notifications de paiement de PayDunya
app.post("/paydunya/ipn", async (req, res) => {
  try {
    const status = req.body.data.status;

    const description = req.body.data.invoice.description;
    const orderIdMatch = description.match(/Order ID: (\d+)/);
    const orderId = orderIdMatch
      ? orderIdMatch[1]
        ? orderIdMatch[1]
        : null
      : null;

    if (!orderId) {
      return res.status(400).send("L'ID de commande n'a pas pu être extrait.");
    }

    const receivedHash = req.body.data.hash;
    const expectedHash = generateSHA512Hash(process.env.PAYDUNYA_MASTER_KEY);

    if (receivedHash !== expectedHash) {
      return res.status(401).send("Requête non authentique.");
    }

    if (status === "completed") {
      const order = await markOrderAsPaid(session, orderId);

      res.status(200).send(`Paiement réussi pour la commande ${orderId}.`);
    } else {
      res.status(200).send("Paiement échoué ou annulé.");
    }
  } catch (error) {
    console.error("Erreur lors du traitement du paiement:", error);
    res.status(500).send("Erreur lors du traitement du paiement.");
  }
});

// Démarre le serveur
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
});
