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
import { url } from "inspector";

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

/*// Utilisation d'un objet en mémoire pour stocker les commandes
const orderCache = {};
console.log("orderCache à l'initialisation :", orderCache);*/

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
function configurePayDunyaStore(newOrder) {
  var store = new paydunya.Store({
    name: process.env.STORE_NAME,
    tagline: process.env.STORE_TAGLINE,
    phoneNumber: process.env.STORE_PHONE,
    postalAddress: process.env.STORE_ADDRESS,
    websiteURL: process.env.STORE_WEBSITE,
    logoURL: process.env.STORE_LOGO_URL,
    callbackURL: process.env.STORE_GLOBAL_CALLBACK_URL,
    cancelURL: process.env.STORE_GLOBAL_CANCEL_URL,
    //returnURL: newOrder.order_status_url, // Utilisez l'URL du statut de commande pour retour vers la boutique Shopify après paiement
  });

  return store;
}

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

// Fonction pour marquer une commande comme "Paid" dans la boutique shopify une fois qu'elle a été validé par l'IPN Paydunya
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
        email
        canNotifyCustomer
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
    console.log(response.data);
    return true;
  } catch (error) {
    console.error("Erreur lors de la mutation GraphQL:", error);
    return false;
  }
}

// Fonction pour créer une facture paydunya
function createInvoice(store, newOrder) {
  /*// Configuration de la boutique PayDunya
  const store = configurePayDunyaStore(newOrder);
  console.log("Store dans la fonction createInvoice :", store);*/

  // Création de l'instance de la facture PayDunya
  const invoice = new paydunya.CheckoutInvoice(setup, store);

  // Ajout de l'ID de la commande Shopify dans la description
  invoice.description = `Order ID: ${newOrder.id}`;

  // Ajout des articles à la facture
  newOrder.line_items.forEach((item) => {
    invoice.addItem(
      item.name,
      item.quantity,
      parseFloat(item.price),
      item.quantity * parseFloat(item.price),
      item.title
    );
  });

  // Configuration du montant total
  invoice.totalAmount = parseFloat(newOrder.current_total_price);

  /*// Crée la facture et redirige le client vers PayDunya
  await invoice.create();*/

  // Création de la facture et traitement du résultat
  console.log("Création de la facture...");

  return invoice
    .create()
    .then(() => {
      console.log("Création de la facture réussie");
      console.log("Statut de la facture :", invoice.status);
      console.log("Token de facture :", invoice.token);
      console.log("Texte de réponse :", invoice.responseText);
      console.log("URL de redirection :", invoice.url);

      return { token: invoice.token, url: invoice.url };
    })
    .catch((e) => {
      console.error("Erreur lors de la création de la facture :", e);
      throw new Error("Erreur lors de la création de la facture.");
    });
}

// Fonction pour vérifier le statut du paiement avec le token de facture
function checkPaymentStatus(store, token) {
  /*if (!token) {
    throw new Error("L'ID de commande est manquant ou invalide.");
  }

  const token = orderId; // Remplacer par le token du cache si nécessaire*/

  const invoice = new paydunya.CheckoutInvoice(setup, store);

  //await invoice.confirm(token);

  // Création de la facture et traitement du résultat
  /*let status;
  let responseText;*/

  return invoice
    .confirm(token)
    .then(() => {
      console.log("Confirmation de la facture réussie");
      console.log("Status de facture:", invoice.status);
      console.log("Réponse du serveur Paydunya:", invoice.responseText);

      return { status: invoice.status, responseText: invoice.responseText };
    })
    .catch((e) => {
      console.error("Erreur lors de la confirmation de la facture:", e);
      throw new Error("Erreur lors de la confirmation de la facture.");
    });
}

// Route pour gérer le Webhook de création de commande
app.post("/webhook/orders/create", async (req, res) => {
  try {
    const hmacReceived = req.headers["x-shopify-hmac-sha256"];
    const body = req.rawBody;

    if (!verifyWebhookHmac(body, hmacReceived)) {
      return res.status(401).send("Échec de validation HMAC.");
    }

    const newOrder = req.body;

    const store = configurePayDunyaStore(newOrder); // Configuration du store

    createInvoice(store, newOrder).then(({ token, url }) => {
      return checkPaymentStatus(store, token).then(
        ({ status, responseText }) => {
          res.status(200).json({
            redirect_url: url,
            payment_status: status,
            response_text: responseText,
          });
        }
      );
    });
  } catch (error) {
    console.error("Erreur lors de la création de la commande:", error);
    res.status(500).send("Erreur lors de la création de la commande.");
  }
});

// Route pour recevoir les notifications de paiement de PayDunya (IPN)
app.post("/paydunya/ipn", async (req, res) => {
  try {
    const status = req.body.data.status; // Statut du paiement
    const receivedHash = req.body.data.hash; // Hash pour validation

    const expectedHash = generateSHA512Hash(process.env.PAYDUNYA_MASTER_KEY);

    if (receivedHash !== expectedHash) {
      return res.status(401).send("Requête non authentique.");
    }

    const description = req.body.data.invoice.description;
    const orderIdMatch = description.match(/Order ID: (\d+)/);
    const orderId = orderIdMatch ? orderIdMatch[1] : null;

    if (!orderId) {
      return res.status(400).send("L'ID de commande n'a pas pu être extrait.");
    }

    if (status === "completed") {
      const success = await markOrderAsPaid(session, orderId);

      if (success) {
        res.status(200).send(`Paiement réussi pour la commande ${orderId}.`);
      } else {
        res
          .status(500)
          .send("Erreur lors de la mise à jour du statut de commande.");
      }
    } else {
      res.status(200).send("Paiement échoué ou annulé.");
    }
  } catch (error) {
    console.error("Erreur lors du traitement de l'IPN:", error);
    res.status(500).send("Erreur lors du traitement de l'IPN.");
  }
});

// Démarre le serveur
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
});
