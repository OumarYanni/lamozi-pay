require("newrelic");

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

// Importe Nodemailer pour envoyer des e-mails depuis notre serveur express
import nodemailer from "nodemailer";
import { error } from "console";

//Importe Memecached Cloud pour le caching
import memjs from "memjs";

//Ajout de node-cron pour la planifaction des tâches principalement pour memjs
import cron from "node-cron";

// Configurez Memcached Cloud
const memcached = memjs.Client.create(process.env.MEMCACHEDCLOUD_SERVERS, {
  username: process.env.MEMCACHEDCLOUD_USERNAME,
  password: process.env.MEMCACHEDCLOUD_PASSWORD,
});

// Configuration du transport SMTP avec Nodemailer et OVH
const transporter = nodemailer.createTransport({
  host: "ssl0.ovh.net", // Hôte SMTP d'OVH
  port: 587, // Port SMTP pour TLS
  secure: false, // `false` pour TLS, `true` pour SSL
  auth: {
    user: process.env.EMAIL_USER, // Nom d'utilisateur (votre adresse e-mail OVH)
    pass: process.env.EMAIL_PASS, // Mot de passe SMTP
  },
});

// Fonction pour envoyer un e-mail avec le lien de paiement
function sendPaymentLinkEmail(toEmail, subject, body) {
  const mailOptions = {
    //remplacer par process.env.EMAIL_USER ou "contact@lamozi.sn"
    from: process.env.EMAIL_USER, // Adresse e-mail de l'expéditeur
    to: toEmail,
    subject,
    html: body,
  };

  /*try {
    await transporter.sendMail(mailOptions);
    console.log("E-mail envoyé avec succès");
  } catch (error) {
    console.error("Erreur lors de l'envoi de l'e-mail :", error);
  }*/

  return transporter
    .sendMail(mailOptions)
    .then(() => {
      console.log("E-mail envoyé avec succès");
    })
    .catch((error) => {
      console.error("Erreur lors de l'envoi de l'e-mail :", error);
    });
}

// Fonction pour créer le corps de l'e-mail avec le lien de paiement
function createEmailBody(paymentUrl) {
  return `
    <div style="text-align: center;">
      <img src="https://cdn.shopify.com/s/files/1/0677/0399/6674/files/LAMOZI_Logo_Type_4_-_BIG_TYPO.png?v=1711412421" alt="Logo LAMOZI" style="width: 200px; margin-bottom: 20px; border-radius: 5px;" />
      <h2 style="color: #D4641C; font-weight: bold; text-align: center;">Complétez votre paiement</h2>
      <p>Merci pour votre commande !<br> Pour compléter votre paiement, veuillez utiliser le lien suivant :</p>
      <a 
        href="${paymentUrl}"
        style="
          text-decoration: none;
          background-color: #d4641c;
          border: 1px solid transparent;
          border-radius: 5px;
          color: white;
          font-weight: bold;
          padding: 1.4em 1.7em;
          display: inline-block;
          cursor: pointer;
          transition: opacity 0.3s ease-in-out;
          text-align: center;
        "
        onmouseover="this.style.opacity = 0.8"
        onmouseout="this.style.opacity = 1"
      >
        Payer maintenant
      </a>
      <p>Si vous avez des questions, contactez-nous à contact@lamozi.sn.</p>
    </div>
  `;
}

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
  mode: "live", // Utilisez 'live' pour le mode production
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
    returnURL: newOrder.order_status_url, // Utilisez l'URL du statut de commande pour retour vers la boutique Shopify après paiement
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

  // Afficher le HMAC calculé dans la console
  //console.log("HMAC calculé:", hash);

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

/*// Fonction pour ajouter l'URL de paiement aux métadonnées de la commande
function addPaymentUrlToOrder(orderId, paymentUrl) {
  return new shopify.clients.Rest({ session })
    .post({
      path: `orders/${orderId}/metafields`,
      data: {
        metafield: {
          namespace: "payment",
          key: "paydunya_url",
          value: paymentUrl,
          type: "url",
        },
      },
    })
    .then(() => {
      console.log(`URL de paiement ajoutée à la commande ${orderId}`);
      return paymentUrl; // Retourne l'URL après l'ajout réussi
    })
    .catch((error) => {
      console.error("Erreur lors de l'ajout des métadonnées:", error);
      throw new Error("Erreur lors de l'ajout des métadonnées.");
    });
}*/

// Fonction pour créer une facture paydunya
function createInvoiceAndStoreUrl(store, newOrder) {
  /*// Configuration de la boutique PayDunya
  const store = configurePayDunyaStore(newOrder);
  console.log("Store dans la fonction createInvoice :", store);*/

  const orderCreatedDate = new Date(newOrder.created_at);
  const now = new Date();
  const ageInHours = (now - orderCreatedDate) / 36e5; // Convertir en heures

  if (ageInHours > 24) {
    // Au lieu de lancer une exception, retournez un message d'erreur
    return Promise.reject(
      new Error(
        "La commande est trop ancienne pour créer une nouvelle facture."
      )
    );
  }

  if (newOrder.financial_status === "paid") {
    return Promise.reject(
      new Error(
        "La commande est déjà payée. Pas besoin de créer une nouvelle facture."
      )
    );
  }

  if (!store) {
    return Promise.reject(new Error("Le store est manquant."));
  }

  if (!newOrder || !newOrder.id) {
    return Promise.reject(
      new Error("Les données de commande sont manquantes.")
    );
  }

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

  return (
    invoice
      .create()
      .then(() => {
        const paymentUrl = invoice.url; // Récupère l'URL de redirection de la facture
        console.log(
          `Création de la facture réussie, URL de paiement : ${paymentUrl}`
        );
        //console.log("Création de la facture réussie");
        console.log("Statut de la facture :", invoice.status);
        console.log("Token de facture :", invoice.token);
        console.log("Texte de réponse :", invoice.responseText);
        console.log("URL de redirection :", invoice.url);

        return { token: invoice.token, url: invoice.url };
        //return addPaymentUrlToOrder(newOrder.id, paymentUrl); // Ajouter l'URL dans les métadonnées
        //return paymentUrl;
      })
      /*.then(() => {
      console.log(`URL de paiement ajoutée à la commande ${newOrder.id}`);
      // Teste que la méta donnée url paydunya est bien ajoutée
      fetchOrderMetafields(newOrder.id);
    })*/
      .catch((e) => {
        console.error(
          "Erreur lors de la création de la facture ou de l'ajout des métadonnées:",
          e
        );
        throw new Error(
          "Erreur lors de la création de la facture ou de l'ajout des métadonnées."
        );
      })
  );
}

// // Fonction pour vérifier le statut du paiement avec le token de facture
// function checkPaymentStatus(store, token) {
//   /*if (!token) {
//     throw new Error("L'ID de commande est manquant ou invalide.");
//   }

//   const token = orderId; // Remplacer par le token du cache si nécessaire*/

//   const invoice = new paydunya.CheckoutInvoice(setup, store);

//   //await invoice.confirm(token);

//   // Création de la facture et traitement du résultat
//   /*let status;
//   let responseText;*/

//   return invoice
//     .confirm(token)
//     .then(() => {
//       console.log("Confirmation de la facture réussie");
//       console.log("Status de facture:", invoice.status);
//       console.log("Réponse du serveur Paydunya:", invoice.responseText);

//       return { status: invoice.status, responseText: invoice.responseText };
//     })
//     .catch((e) => {
//       console.error("Erreur lors de la confirmation de la facture:", e);
//       throw new Error("Erreur lors de la confirmation de la facture.");
//     });
// }

// Route pour gérer le Webhook de création de commande
app.post("/webhook/orders/create", async (req, res) => {
  try {
    const body = req.rawBody;
    const newOrder = req.body;

    // Vérification du HMAC pour la sécurité
    const hmacReceived = req.headers["x-shopify-hmac-sha256"];
    if (!verifyWebhookHmac(body, hmacReceived)) {
      return res.status(401).send("Échec de validation HMAC.");
    }

    // Filtre pour n'accepter que les commandes provenant de "LAMOZI Pay"
    if (!newOrder.payment_gateway_names.includes("LAMOZI Pay ")) {
      return res
        .status(200)
        .send("Commande ignorée car non issue de LAMOZI Pay.");
    }

    memcached.get(newOrder.id.toString(), (err, value) => {
      if (err) {
        console.error("Erreur lors de la vérification de Memcached:", err);
        return res
          .status(500)
          .send("Erreur serveur lors de la vérification de la commande.");
      }

      if (value) {
        console.log(`Commande ${newOrder.id} déjà traitée.`);
        return res.status(200).send("Commande déjà traitée.");
      }

      const store = configurePayDunyaStore(newOrder); // Configuration du store

      createInvoiceAndStoreUrl(store, newOrder) // Créer la facture et stocker l'URL de paiement
        .then(({ url }) => {
          if (url) {
            console.log(`URL de paiement reçue: ${url}`); // Ajoutez ce log pour confirmer la valeur

            const emailBody = createEmailBody(url); // Crée le corps de l'e-mail
            /*await sendPaymentLinkEmail(
            newOrder.email,
            "Lien de paiement pour votre commande",
            emailBody
          ); // Envoie l'e-mail*/

            // Ajoutez la commande au cache avec une expiration
            memcached.set(newOrder.id.toString(), "processed");

            return sendPaymentLinkEmail(
              newOrder.email,
              //"Lien de paiement pour votre commande LAMOZI",
              `${newOrder.billing_address.name} - Lien de paiement pour votre commande LAMOZI, numéro : ${newOrder.order_number}`,
              emailBody
            ); // Envoie l'e-mail
          } else {
            console.error("URL de paiement est undefined.");
            throw new Error("URL de paiement est undefined.");
          }

          //res.status(200).send("Facture créée avec succès.");
        })
        .then(() => {
          res.status(200).send("Facture créée avec succès.");
        })
        .catch((e) => {
          console.error("Erreur lors de la création de la facture:", e);
          res.status(500).send("Erreur lors de la création de la facture.");
        });
    });
  } catch (error) {
    console.error("Erreur lors de la création de la commande:", error);
    res.status(500).send("Erreur lors de la création de la commande.");
  }
});

/*async function fetchOrderMetafields(orderId) {
  const restClient = new shopify.clients.Rest({ session }); // Assurez-vous d'avoir une session active

  try {
    const response = await restClient.get({
      path: `orders/${orderId}/metafields`,
    });

    const metafields = response.body.metafields;
    console.log("Métadonnées de la commande:", metafields);

    // Recherchez le métadonnée contenant l'URL de paiement
    const paymentMetafield = metafields.find(
      (mf) => mf.namespace === "payment" && mf.key === "paydunya_url"
    );

    if (paymentMetafield) {
      console.log("URL de paiement trouvée:", paymentMetafield.value);
    } else {
      console.warn("URL de paiement non trouvée dans les métadonnées.");
    }
  } catch (error) {
    console.error("Erreur lors de la récupération des métadonnées:", error);
  }
}*/

/*// Exemple d'utilisation
const orderId = "5640176566530"; // Remplacez par l'ID de la commande à vérifier
fetchOrderMetafields(orderId);*/

// Fonction pour vérifier le niveau de remplissage du cache
function checkCacheUsage() {
  memcached.stats((err, stats) => {
    if (err) {
      console.error(
        "Erreur lors de la récupération des statistiques du cache :",
        err
      );
    } else {
      const cacheUsage = parseFloat(stats[0].curr_bytes) / (30 * 1024 * 1024); // Convertir en pourcentage
      if (cacheUsage >= 0.8) {
        // Si le cache est à 80 % de remplissage, nettoyez
        memcached.flush((err) => {
          if (err) {
            console.error("Erreur lors du nettoyage du cache :", err);
          } else {
            console.log("Cache Memcached nettoyé car il était à plus de 80 %.");
          }
        });
      }
    }
  });
}

// Planifier la vérification toutes les 12 heures
const CLEAN_INTERVAL = 12 * 60 * 60 * 1000; // 12 heures en millisecondes

setInterval(checkCacheUsage, CLEAN_INTERVAL);

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

    const receiptUrl = req.body.data.receipt_url; // Récupère l'URL du reçu

    if (status === "completed") {
      const success = await markOrderAsPaid(session, orderId);

      if (success) {
        // Ajout du lien de téléchargement du reçu comme métadonnée dans la commande
        await addReceiptUrlToOrder(orderId, receiptUrl);

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

// Fonction pour ajouter le lien du reçu PDF comme métadonnée
function addReceiptUrlToOrder(orderId, receiptUrl) {
  return new shopify.clients.Rest({ session })
    .post({
      path: `orders/${orderId}/metafields`,
      data: {
        metafield: {
          namespace: "payment",
          key: "receipt_url",
          value: receiptUrl,
          type: "url",
        },
      },
    })
    .then(() => {
      console.log(
        `Lien de téléchargement du reçu ajouté à la commande ${orderId}`
      );
    })
    .catch((error) => {
      console.error("Erreur lors de l'ajout des métadonnées:", error);
      throw new Error("Erreur lors de l'ajout des métadonnées.");
    });
}

// Planification de l'écriture périodique dans Memcached pour maintenir l'activité et ne pas perdre la database gratuite au bout de 30j

// Tâche cron toutes les 5 minutes pour maintenir l'activité de Memcached
// cron.schedule("*/5 * * * *", () => {
//   const key = "keepalive";
//   const value = "active";

//   memcached.set(key, value, { expires: 3600 }, (err) => {
//     if (err) {
//       console.error(
//         "Erreur lors de l'écriture de la tâche cron dans Memcached:",
//         err
//       );
//     } else {
//       console.log(
//         "Tâche cron exécutée : Memcached keepalive écrit avec succès."
//       );
//     }
//   });
// });

// Tâche cron journalière à 00h10
// cron.schedule("10 0 * * *", () => {
//   const key = "keepalive";
//   const value = "active";

//   memcached.set(key, value, { expires: 3600 }, (err) => {
//     if (err) {
//       console.error(
//         "Erreur lors de l'écriture de la tâche cron journalière dans Memcached:",
//         err
//       );
//     } else {
//       console.log(
//         "Tâche cron journalière exécutée : Memcached keepalive écrit avec succès."
//       );
//     }
//   });
// });

// Tâche cron hebdomadaire (chaque dimanche à minuit dix 00h10 ("10 0 * * 0")) pour maintenir l'activité de Memcached
cron.schedule("10 0 * * 0", () => {
  const key = "keepalive";
  const value = "active";

  memcached.set(key, value, { expires: 3600 }, (err) => {
    if (err) {
      console.error(
        "Erreur lors de l'écriture de la tâche cron hebdomadaire dans Memcached:",
        err
      );
    } else {
      console.log(
        "Tâche cron hebdomadaire exécutée : Memcached keepalive écrit avec succès."
      );
    }
  });
});

// Démarre le serveur
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
});
